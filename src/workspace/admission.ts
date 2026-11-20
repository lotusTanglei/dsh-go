import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { Store } from '../store/index.js'
import { encodeJson, hasSensitiveContractData } from '../store/codec.js'
import type { Policy } from '../domain/policy.js'
import type { TicketBrief } from '../domain/ticket.js'
import { validateTicketBrief } from '../domain/ticket.js'
import { grantMandate } from '../domain/mandate.js'
import { decisionId, evalId, sourceId, threadKey, ticketId } from '../domain/ids.js'
import { getEval, startEval, settleEval } from '../engine/eval.js'
import { isPaused } from '../engine/pause.js'
import { commandError, createCommandJournal, WorkspaceError, type CommandRecord } from './commands.js'
import { validDocumentOrigin, type DocumentOrigin, type DocumentOriginAuthority } from './document-origin.js'

export type AdmissionState = 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded' | 'consumed'
export interface AdmissionDecision {
  readonly epoch: string
  readonly requestId: string
  readonly planId: string
  readonly fingerprint: string
  readonly decision: 'approve' | 'reject'
}
export interface AdmissionPlanDTO {
  readonly planId: string
  readonly requestId: string
  readonly epoch: string
  readonly fingerprint: string
  readonly state: AdmissionState
  readonly createdAt: number
  readonly expiresAt: number
  readonly policyVersion: string
  readonly brief: TicketBrief
  readonly scope: TicketBrief['scope']
  readonly acceptance: TicketBrief['acceptance']
  readonly risk: Pick<TicketBrief, 'blockers' | 'approvalsRequired' | 'outOfScope'>
  readonly ticketId?: string
  readonly originTicket?: string
  readonly documentOrigin?: DocumentOrigin
  readonly blockedReason?: string
}
export interface AdmissionOptions {
  readonly policy: Policy
  readonly workRoot: string
  /** Lifetime of the pending human confirmation, not the Eval timeout. */
  readonly timeoutMs?: number
  readonly paused?: () => boolean
  readonly documentOrigins?: DocumentOriginAuthority
}
interface Plan {
  readonly version: 1
  readonly planId: string
  readonly fingerprint: string
  readonly command: Pick<CommandRecord, 'requestId' | 'epoch' | 'intent' | 'digest' | 'messageId' | 'threadKey' | 'documentOrigin'>
  readonly brief: TicketBrief
  readonly policy: Policy
  readonly createdAt: number
  readonly expiresAt: number
  readonly evaluationId: string
  readonly decisionId: string
  readonly ticketId: string
  readonly workdir: string
}
interface Pointer { version: 1; requestId: string; planId: string }
const PLAN_KEY = 'admission-plan:v1:'
const CURRENT_KEY = 'admission-current:v1:'
const KIND = 'workspace-admission-v1'
const states: readonly string[] = ['pending', 'approved', 'rejected', 'expired', 'superseded', 'consumed']
const bindingFields = ['requestId', 'epoch', 'intent', 'digest', 'messageId', 'threadKey'] as const

/** Strict JSON: sorted object keys, ordered arrays, no lossy undefined/NaN/toJSON conversion. */
function canonical(value: unknown, seen = new Set<object>(), depth = 0): string {
  if (depth > 64) return commandError('admission_json_invalid', 400)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (!value || typeof value !== 'object' || seen.has(value)) return commandError('admission_json_invalid', 400)
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return commandError('admission_json_invalid', 400)
  if (Object.getOwnPropertySymbols(value).length) return commandError('admission_json_invalid', 400)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertyNames(value).length !== value.length + 1) return commandError('admission_json_invalid', 400)
      const items: string[] = []
      for (let i = 0; i < value.length; i++) {
        const property = Object.getOwnPropertyDescriptor(value, String(i))
        if (!property || !('value' in property)) return commandError('admission_json_invalid', 400)
        items.push(canonical(property.value, seen, depth + 1))
      }
      return `[${items.join(',')}]`
    }
    if (Object.getOwnPropertyNames(value).length !== Object.keys(value).length) return commandError('admission_json_invalid', 400)
    const entries = Object.keys(value).sort().map(key => {
      const property = Object.getOwnPropertyDescriptor(value, key)!
      if (!('value' in property)) return commandError('admission_json_invalid', 400)
      return `${JSON.stringify(key)}:${canonical(property.value, seen, depth + 1)}`
    })
    return `{${entries.join(',')}}`
  } finally { seen.delete(value) }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
  return value
}
function copy<T>(value: T): T { return freeze(JSON.parse(canonical(value)) as T) }
function fingerprint(requestId: string, brief: TicketBrief, policy: Policy, documentOrigin?: DocumentOrigin): string {
  // Omitting provenance preserves every existing v1 fingerprint byte-for-byte.
  return createHash('sha256').update(canonical({ requestId, brief, policy, ...(documentOrigin ? { documentOrigin } : {}) }), 'utf8').digest('hex')
}
function sameBinding(left: Plan['command'], right: Plan['command']): boolean {
  return bindingFields.every(field => left[field] === right[field])
    && canonical(left.documentOrigin ?? null) === canonical(right.documentOrigin ?? null)
}
function checkedBrief(value: TicketBrief): TicketBrief {
  // Check the original graph too: additional properties must not smuggle a secret into kv.
  const cloned = copy(value)
  if (!validateTicketBrief(cloned)) return commandError('admission_brief_invalid', 400)
  if (hasSensitiveContractData(cloned)) return commandError('admission_sensitive_contract', 400)
  return cloned
}

/**
 * One request, one current immutable single-ticket plan. No model, Worker, or service is
 * started here. The Host MUST authenticate the human and validate its current epoch
 * before decide(); matching a stored epoch alone is not authentication.
 */
export function createAdmissionService(store: Store, options: AdmissionOptions) {
  const journal = createCommandJournal(store)
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return commandError('admission_timeout_invalid', 400)
  const policy = copy(options.policy), workRoot = resolve(options.workRoot)
  if (hasSensitiveContractData({ policy, workdir: workRoot })) return commandError('admission_sensitive_contract', 400)
  const effectKey = (id: string) => `admission:${id}`
  function current(requestId: string): string | undefined {
    const value = store.repos.kv.get(CURRENT_KEY + requestId)?.v as Pointer | undefined
    if (!value) return undefined
    if (value.version !== 1 || value.requestId !== requestId || typeof value.planId !== 'string') return commandError('admission_pointer_invalid', 503)
    return value.planId
  }
  function read(id: string): { plan: Plan; state: AdmissionState } {
    const plan = store.repos.kv.get(PLAN_KEY + id)?.v as Plan | undefined
    const effect = store.repos.side_effect.get(effectKey(id))
    if (!plan || !effect) return commandError('admission_not_found', 404)
    if (plan.version !== 1 || plan.planId !== id || effect.kind !== KIND || !states.includes(String(effect.state))
      || !plan.command || plan.command.intent !== 'new-task' || !validateTicketBrief(plan.brief) || hasSensitiveContractData(plan)
      || (plan.command.documentOrigin !== undefined && !validDocumentOrigin(plan.command.documentOrigin))
      || plan.fingerprint !== fingerprint(plan.command.requestId, plan.brief, plan.policy, plan.command.documentOrigin)
      || plan.evaluationId !== `eval:admission:${id}` || plan.decisionId !== `decision:admission:${id}` || plan.ticketId !== `ticket:admission:${id}`
      || !Number.isSafeInteger(plan.createdAt) || !Number.isSafeInteger(plan.expiresAt) || plan.expiresAt <= plan.createdAt) return commandError('admission_record_invalid', 503)
    return { plan: freeze(plan), state: effect.state as AdmissionState }
  }
  function commandFor(plan: Plan): CommandRecord {
    const command = journal.read(plan.command.requestId)
    if (!command || !sameBinding(command, plan.command)) return commandError('admission_command_mismatch')
    if (!command.durable || !['admitted', 'processing', 'published'].includes(command.stage)) return commandError('admission_command_not_admitted')
    return command
  }
  function validateOrigin(command: Plan['command']): void {
    if (!command.documentOrigin) return
    if (!options.documentOrigins) return commandError('document_origin_unavailable', 503)
    options.documentOrigins.validate(command.documentOrigin, command.requestId)
  }
  function sourceTrigger(command: CommandRecord) {
    const rows = store.db.prepare(`SELECT t.*, tt.state AS queue_state, d.filtered, d.decision_id, d.ticket_id, d.delivered_to
      FROM trigger t JOIN thread th ON th.key = t.thread_key AND th.source = t.source
      JOIN thread_trigger tt ON tt.thread_key = t.thread_key AND tt.trigger_id = t.id
      JOIN trigger_disposition d ON d.trigger_id = t.id
      WHERE t.external_id = ? AND t.thread_key = ?`).all(command.messageId, command.threadKey)
    if (rows.length !== 1) return commandError('admission_trigger_missing')
    const row = rows[0]!
    if (row.trust !== 'human' || Boolean(row.actor_bot) || row.addressed !== 'direct'
      || (row.filtered && row.filtered !== 'paused')
      || (policy.acceptedSources.length && !policy.acceptedSources.includes(sourceId(String(row.source))))) return commandError('admission_trigger_denied')
    return row
  }
  function dto(plan: Plan, state: AdmissionState, blockedReason?: string): AdmissionPlanDTO {
    // Explicit allowlist: no actor, message text, mandate, policy budgets, or engine internals.
    // Legal local paths are intentionally exact; the Host route applies its privacy sanitizer.
    return freeze({ planId: plan.planId, requestId: plan.command.requestId, epoch: plan.command.epoch,
      fingerprint: plan.fingerprint, state, createdAt: plan.createdAt, expiresAt: plan.expiresAt, policyVersion: plan.policy.version,
      brief: plan.brief, scope: plan.brief.scope, acceptance: plan.brief.acceptance,
      risk: { blockers: plan.brief.blockers, approvalsRequired: plan.brief.approvalsRequired, outOfScope: plan.brief.outOfScope },
      ...(journal.read(plan.command.requestId)?.originTicket ? { originTicket: journal.read(plan.command.requestId)!.originTicket } : {}),
      ...(plan.command.documentOrigin ? { documentOrigin: plan.command.documentOrigin } : {}),
      ...(state === 'consumed' ? { ticketId: plan.ticketId } : {}), ...(blockedReason ? { blockedReason } : {}) })
  }
  function metadata(plan: Plan) {
    return { version: 1, planId: plan.planId, requestId: plan.command.requestId, epoch: plan.command.epoch, fingerprint: plan.fingerprint, expiresAt: plan.expiresAt }
  }
  /** Caller owns the transaction. Expiry closes only pending confirmation, never an approval. */
  function expirePending(plan: Plan, state: AdmissionState, now: number): AdmissionState {
    if (state !== 'pending' || plan.expiresAt > now) return state
    if (!store.repos.side_effect.updateByState(effectKey(plan.planId), 'pending', 'expired')) return commandError('admission_conflict')
    return 'expired'
  }
  function markConsumed(plan: Plan): AdmissionPlanDTO {
    return store.transaction(() => {
      if (current(plan.command.requestId) !== plan.planId) return commandError('admission_not_current')
      const saved = read(plan.planId)
      if (plan.command.documentOrigin) {
        if (!options.documentOrigins) return commandError('document_origin_unavailable', 503)
        // The authority participates in this transaction; settlement itself is reconciled above.
        options.documentOrigins.link(plan.command.documentOrigin, plan.command.requestId, plan.ticketId)
      }
      if (saved.state !== 'consumed' && !store.repos.side_effect.updateByState(effectKey(plan.planId), 'approved', 'consumed', { ticket_id: plan.ticketId })) return commandError('admission_conflict')
      return dto(plan, 'consumed')
    })
  }
  function consume(plan: Plan): AdmissionPlanDTO {
    // startEval and settleEval EACH own their transaction. Never wrap them in ours.
    if (current(plan.command.requestId) !== plan.planId) return commandError('admission_not_current')
    const saved = read(plan.planId)
    if (saved.state === 'consumed') return dto(plan, 'consumed')
    if (saved.state !== 'approved') return dto(plan, saved.state)
    const command = commandFor(plan), trigger = sourceTrigger(command)
    const evaluation = getEval(store, evalId(plan.evaluationId))
    const ticket = store.repos.ticket.get(plan.ticketId), decision = store.repos.decision.get(plan.decisionId)
    if (ticket || decision || evaluation?.state === 'decided') {
      // settleEval is atomic: a partial or foreign set is corruption, not permission to settle again.
      if (!ticket || !decision || evaluation?.state !== 'decided' || evaluation.threadKey !== command.threadKey
        || evaluation.policyVersion !== plan.policy.version || canonical(evaluation.triggerIds) !== canonical([String(trigger.id)])
        || ticket.decision_id !== plan.decisionId || ticket.thread_key !== command.threadKey
        || canonical(ticket.brief_json) !== canonical(plan.brief) || ticket.workdir !== plan.workdir
        || (ticket.mandate_json as { via?: unknown; policyVersion?: unknown })?.via !== 'admission'
        || (ticket.mandate_json as { policyVersion?: unknown })?.policyVersion !== plan.policy.version
        || decision.eval_id !== plan.evaluationId || decision.ticket_id !== plan.ticketId || decision.thread_key !== command.threadKey
        || decision.kind !== 'accept' || decision.strength !== 'explicit' || decision.policy_version !== plan.policy.version
        || canonical(decision.trigger_ids) !== canonical([String(trigger.id)])
        || trigger.decision_id !== plan.decisionId || trigger.ticket_id !== plan.ticketId || trigger.queue_state !== 'consumed') return commandError('admission_reconciliation_failed', 503)
      return markConsumed(plan)
    }
    validateOrigin(command)
    if (canonical(policy) !== canonical(plan.policy)) return dto(plan, 'approved', 'admission_policy_changed')
    const thread = store.repos.thread.get(command.threadKey)
    if (policy.acceptMode !== 'auto') return dto(plan, 'approved', 'admission_accept_mode')
    if (policy.paused || options.paused?.() || isPaused(store) || Boolean(thread?.paused)) return dto(plan, 'approved', 'admission_paused')
    let active = evaluation
    if (active) {
      if (active.state !== 'running' || active.threadKey !== command.threadKey || active.policyVersion !== policy.version
        || canonical(active.triggerIds) !== canonical([String(trigger.id)]) || thread?.evaluating !== plan.evaluationId
        || trigger.queue_state !== 'evaluating') return commandError('admission_evaluation_mismatch', 503)
      if (Date.now() >= active.deadline) return dto(plan, 'approved', 'admission_evaluation_expired')
    } else {
      if (trigger.queue_state !== 'pending' || trigger.decision_id || trigger.ticket_id || trigger.delivered_to) return commandError('admission_input_consumed')
      const pending = store.db.prepare("SELECT trigger_id FROM thread_trigger WHERE thread_key = ? AND state = 'pending' ORDER BY seq").all(command.threadKey)
      // Existing engine API claims all pending triggers. Refuse mixed-input authorization.
      if (pending.length !== 1 || pending[0]!.trigger_id !== trigger.id) return commandError('admission_input_ambiguous')
      active = startEval(store, threadKey(command.threadKey), policy, { evalId: evalId(plan.evaluationId) })
      if (!active) return dto(plan, 'approved', 'admission_evaluation_unavailable')
    }
    const at = Date.now()
    const mandate = grantMandate({ decision: { kind: 'accept', strength: 'explicit', policyVersion: policy.version },
      grantedBy: { id: String(trigger.actor_id), source: sourceId(String(trigger.source)), bot: false }, at,
      scope: plan.brief.scope.repo, via: 'admission', rules: [] }, policy)
    validateOrigin(command)
    settleEval(store, active.id, { id: decisionId(plan.decisionId), kind: 'accept', reason: 'Human approved immutable admission plan', strength: 'explicit', at,
      ticket: { id: ticketId(plan.ticketId), title: plan.brief.goal, brief: plan.brief, mandate, workdir: plan.workdir } }, policy)
    return markConsumed(plan)
  }
  function propose(command: CommandRecord, brief: TicketBrief): AdmissionPlanDTO {
    const checked = checkedBrief(brief)
    const savedCommand = journal.read(command?.requestId)
    if (!savedCommand || !sameBinding(savedCommand, command)) return commandError('admission_command_mismatch')
    if (savedCommand.intent !== 'new-task' || savedCommand.targetTicket) return commandError('admission_new_task_required')
    if (!savedCommand.durable || !['admitted', 'processing', 'published'].includes(savedCommand.stage)) return commandError('admission_command_not_admitted')
    const digest = fingerprint(savedCommand.requestId, checked, policy, savedCommand.documentOrigin)
    const result = store.transaction(() => {
      const previousId = current(savedCommand.requestId)
      if (previousId) {
        const previous = read(previousId)
        const state = expirePending(previous.plan, previous.state, Date.now())
        if (previous.plan.fingerprint === digest) {
          if (state !== 'consumed') validateOrigin(savedCommand)
          return dto(previous.plan, state)
        }
        // Commit a newly observed expiry before reporting the locked plan to the caller.
        if (state !== 'pending') return { locked: true as const }
        if (!store.repos.side_effect.updateByState(effectKey(previousId), 'pending', 'superseded')) return commandError('admission_conflict')
      }
      validateOrigin(savedCommand)
      const trigger = sourceTrigger(savedCommand)
      if (trigger.queue_state !== 'pending' || trigger.decision_id || trigger.ticket_id || trigger.delivered_to) return commandError('admission_input_consumed')
      const createdAt = Date.now(), planId = randomUUID()
      const expiresAt = createdAt + timeoutMs
      if (!Number.isSafeInteger(expiresAt)) return commandError('admission_timeout_invalid', 400)
      const plan: Plan = { version: 1, planId, fingerprint: digest,
        command: { requestId: savedCommand.requestId, epoch: savedCommand.epoch, intent: savedCommand.intent, digest: savedCommand.digest, messageId: savedCommand.messageId, threadKey: savedCommand.threadKey,
          ...(savedCommand.documentOrigin ? { documentOrigin: copy(savedCommand.documentOrigin) } : {}) },
        brief: checked, policy, createdAt, expiresAt,
        evaluationId: `eval:admission:${planId}`, decisionId: `decision:admission:${planId}`, ticketId: `ticket:admission:${planId}`, workdir: join(workRoot, `admission-${planId}`) }
      if (hasSensitiveContractData(plan)) return commandError('admission_sensitive_contract', 400)
      store.repos.kv.insert({ k: PLAN_KEY + planId, v: plan })
      store.repos.side_effect.insert({ key: effectKey(planId), kind: KIND, ticket_id: null, at: createdAt, state: 'pending', detail: metadata(plan) })
      const pointer: Pointer = { version: 1, requestId: savedCommand.requestId, planId }
      store.repos.kv.insertOrIgnore({ k: CURRENT_KEY + savedCommand.requestId, v: pointer })
      if (previousId) store.db.prepare('UPDATE kv SET v = ? WHERE k = ?').run(encodeJson(pointer, false), CURRENT_KEY + savedCommand.requestId)
      return dto(freeze(plan), 'pending')
    })
    if ('locked' in result) return commandError('admission_plan_locked')
    return result
  }
  function decide(input: AdmissionDecision): AdmissionPlanDTO {
    if (!input || !['approve', 'reject'].includes(input.decision) || ['epoch', 'requestId', 'planId', 'fingerprint'].some(key => typeof input[key as keyof AdmissionDecision] !== 'string' || !input[key as keyof AdmissionDecision])) return commandError('admission_decision_invalid', 400)
    const approved = store.transaction(() => {
      const { plan, state } = read(input.planId)
      if (plan.command.requestId !== input.requestId || plan.command.epoch !== input.epoch || plan.fingerprint !== input.fingerprint) return commandError('admission_binding_mismatch')
      if (current(input.requestId) !== input.planId) return commandError('admission_not_current')
      if (input.decision === 'reject' && state === 'rejected') return { plan, state }
      // A terminal replay may arrive after the Host has finalized the command journal.
      if (state === 'expired') return { expired: true as const }
      commandFor(plan)
      if (input.decision === 'approve' && state !== 'consumed') validateOrigin(plan.command)
      if (state !== 'pending') {
        if (input.decision === 'approve' && ['approved', 'consumed'].includes(state) || input.decision === 'reject' && state === 'rejected') return { plan, state }
        return commandError('admission_not_pending')
      }
      if (expirePending(plan, state, Date.now()) === 'expired') return { expired: true as const }
      if (canonical(policy) !== canonical(plan.policy)) return commandError('admission_policy_changed')
      const next = input.decision === 'approve' ? 'approved' : 'rejected'
      if (!store.repos.side_effect.updateByState(effectKey(plan.planId), 'pending', next, { detail: { ...metadata(plan), decidedAt: Date.now() } })) return commandError('admission_conflict')
      return { plan, state: next as AdmissionState }
    })
    // Throw only after COMMIT: throwing inside the callback would roll back the expiry CAS.
    if ('expired' in approved) return commandError('admission_expired')
    return approved.state === 'approved' ? consume(approved.plan) : dto(approved.plan, approved.state)
  }
  function list(epoch?: string): AdmissionPlanDTO[] {
    const rows = store.db.prepare('SELECT key FROM side_effect WHERE kind = ? ORDER BY at, key').all(KIND)
    return rows.map(row => read(String(row.key).slice('admission:'.length)))
      .filter(({ plan }) => epoch === undefined || plan.command.epoch === epoch)
      .map(({ plan, state }) => dto(plan, state))
  }
  function recover(): AdmissionPlanDTO[] {
    const now = Date.now()
    const expired = store.transaction(() => {
      const pending = store.db.prepare("SELECT key FROM side_effect WHERE kind = ? AND state = 'pending' ORDER BY at, key").all(KIND)
      const records: AdmissionPlanDTO[] = []
      for (const row of pending) {
        const { plan, state } = read(String(row.key).slice('admission:'.length))
        if (state === 'pending' && expirePending(plan, state, now) === 'expired') records.push(dto(plan, 'expired'))
      }
      return records
    })
    const approved = store.db.prepare("SELECT key FROM side_effect WHERE kind = ? AND state = 'approved' ORDER BY at, key").all(KIND)
    return [...expired, ...approved.map(row => {
      const { plan } = read(String(row.key).slice('admission:'.length))
      // An archived binding must never start fresh work after a canonical Session change.
      const binding = store.repos.kv.get('workspace-bindings-v1')?.v as { current?: { epoch?: string } } | undefined
      if (binding?.current?.epoch && binding.current.epoch !== plan.command.epoch) return dto(plan, 'approved', 'admission_epoch_changed')
      try { return consume(plan) } catch (error) {
        if (!(error instanceof WorkspaceError)) throw error
        return dto(plan, 'approved', error.code)
      }
    })]
  }
  return { propose, decide, list, recover }
}
