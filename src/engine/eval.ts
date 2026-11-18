import { randomUUID } from 'node:crypto'
import type { Store } from '../store/index.js'
import type { Policy } from '../domain/policy.js'
import type { Eval, Decision, DecisionKind, Strength } from '../domain/eval.js'
import { createEval, decideEval, expireEval, requeueEval, unavailableDecision } from '../domain/eval.js'
import { validateTicketBrief } from '../domain/ticket.js'
import { canGrant } from '../domain/mandate.js'
import { evalId as makeEvalId, decisionId as makeDecisionId, ticketId as makeTicketId } from '../domain/ids.js'
import type { EvalId, ThreadKey, TriggerId, DecisionId, TicketId } from '../domain/ids.js'
import type { TicketBrief } from '../domain/ticket.js'
import type { Mandate } from '../domain/mandate.js'
import type { Actor } from '../domain/trigger.js'
import { isPaused as globalPaused } from './pause.js'

export interface EvalStartOptions {
  readonly now?: () => number
  readonly timeoutMs?: number
  readonly evalId?: EvalId
  readonly maxRequeues?: number
}

export interface EvalDecisionInput {
  readonly id?: DecisionId
  readonly kind: DecisionKind
  readonly reason: string
  readonly strength: Strength
  readonly at?: number
  readonly ticket?: {
    readonly id?: TicketId
    readonly title: string
    readonly brief: TicketBrief
    readonly mandate: Mandate
    readonly workdir: string
  }
}

export interface EvalResult {
  readonly evaluation: Eval
  readonly decision: Decision
  readonly ticketId?: TicketId
}

export interface EvaluationContext {
  readonly evaluation: Eval
  readonly triggerIds: readonly TriggerId[]
  readonly triggers: readonly Record<string, unknown>[]
  readonly signal?: AbortSignal
}

export type Evaluation = (context: EvaluationContext) => Promise<EvalDecisionInput> | EvalDecisionInput

function nowOf(now?: () => number): number {
  const value = now ? now() : Date.now()
  if (!Number.isInteger(value) || value < 0) throw new Error('eval: now must be a non-negative integer')
  return value
}

function mapEval(row: Record<string, unknown>): Eval {
  return {
    id: row.id as EvalId, threadKey: row.thread_key as ThreadKey, policyVersion: String(row.policy_version),
    triggerIds: (row.trigger_ids as TriggerId[]) ?? [], startedAt: Number(row.started_at), deadline: Number(row.deadline),
    state: row.state as Eval['state'], requeues: Number(row.requeues ?? 0),
  }
}

function pendingIds(store: Store, threadKey: ThreadKey): TriggerId[] {
  return (store.db.prepare("SELECT trigger_id FROM thread_trigger WHERE thread_key = ? AND state = 'pending' ORDER BY seq ASC").all(String(threadKey)) as { trigger_id: string }[]).map((row) => row.trigger_id as TriggerId)
}

function updateThreadEvaluating(store: Store, threadKey: ThreadKey, evalId: string | null): void {
  store.db.prepare('UPDATE thread SET evaluating = ? WHERE key = ?').run(evalId, String(threadKey))
}

// Prevent duplicate evaluator calls in one process while the durable thread.evaluating
// column remains the crash-safe source of truth.
const activeEvaluations = new WeakMap<object, Set<string>>()
function activeSet(store: Store): Set<string> {
  let set = activeEvaluations.get(store)
  if (!set) { set = new Set(); activeEvaluations.set(store, set) }
  return set
}

/** Claim one running Eval for a Thread. Concurrent callers are serialized by Store.transaction. */
export function startEval(store: Store, threadKey: ThreadKey, policy: Pick<Policy, 'version' | 'evalTimeoutMs'> & Partial<Pick<Policy, 'paused'>>, options: EvalStartOptions = {}): Eval | undefined {
  const at = nowOf(options.now)
  return store.transaction(() => {
    const thread = store.repos.thread.get(threadKey) as Record<string, unknown> | undefined
    if (!thread) throw new Error(`eval: unknown thread ${String(threadKey)}`)
    if (Boolean(thread.paused) || Boolean(policy.paused) || globalPaused(store)) return undefined
    if (thread.evaluating) {
      const existing = store.repos.eval.get(thread.evaluating) as Record<string, unknown> | undefined
      if (existing?.state === 'running') return undefined
      // A stale pointer is repaired before claiming the queued triggers.
      updateThreadEvaluating(store, threadKey, null)
    }
    const subscribed = store.db.prepare(`SELECT 1 FROM thread_subscription s JOIN ticket t ON t.id = s.ticket_id WHERE s.thread_key = ? AND t.state IN ('open','running','waiting_human') LIMIT 1`).get(String(threadKey))
    // Subscription traffic is delivered to an Assignment (or held until one exists); it never enters Eval.
    if (subscribed) return undefined
    const ids = pendingIds(store, threadKey)
    if (!ids.length) return undefined
    const id = options.evalId ?? makeEvalId(`eval:${randomUUID()}`)
    const timeoutMs = options.timeoutMs ?? policy.evalTimeoutMs
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('eval: timeout must be non-negative')
    const evaluation = createEval({ id, threadKey, policyVersion: policy.version, triggerIds: ids, startedAt: at, deadline: at + timeoutMs })
    store.repos.eval.insert({ id: evaluation.id, thread_key: threadKey, policy_version: policy.version, trigger_ids: ids, started_at: at, deadline: evaluation.deadline, state: 'running', requeues: 0 })
    updateThreadEvaluating(store, threadKey, String(id))
    for (const triggerId of ids) store.db.prepare("UPDATE thread_trigger SET state = 'evaluating' WHERE thread_key = ? AND trigger_id = ? AND state = 'pending'").run(String(threadKey), String(triggerId))
    return evaluation
  })
}

/** Return a durable Eval snapshot. */
export function getEval(store: Store, id: EvalId): Eval | undefined {
  const row = store.repos.eval.get(id) as Record<string, unknown> | undefined
  return row ? mapEval(row) : undefined
}

/**
 * Apply a Decision and finish the Eval. Accept commits decision + ticket + mandate +
 * subscription + trigger dispositions in one SQLite transaction.
 */
export function settleEval(store: Store, evaluationId: EvalId, input: EvalDecisionInput, policy: Pick<Policy, 'version'>, options: { readonly now?: () => number } = {}): EvalResult {
  const checkedAt = nowOf(options.now)
  const at = input.at ?? checkedAt
  return store.transaction(() => {
    const row = store.repos.eval.get(evaluationId) as Record<string, unknown> | undefined
    if (!row) throw new Error(`eval: unknown evaluation ${String(evaluationId)}`)
    const evaluation = mapEval(row)
    if (evaluation.state !== 'running') throw new Error(`eval: cannot decide ${evaluation.state}`)
    if (evaluation.policyVersion !== policy.version) throw new Error('eval: stale policy version')
    if (checkedAt >= evaluation.deadline || at >= evaluation.deadline) throw new Error('eval: deadline has elapsed')
    if (!Number.isSafeInteger(at) || at < evaluation.startedAt) throw new Error('eval: decision time precedes evaluation')
    if (input.kind === 'accept' && !input.ticket) throw new Error('eval: accept requires ticket payload')
    const decision: Decision = decideEval(evaluation, {
      id: input.id ?? makeDecisionId(`decision:${randomUUID()}`), kind: input.kind, reason: input.reason, strength: input.strength, at,
    }, policy as Policy)
    let ticketId: TicketId | undefined
    if (input.kind === 'accept' && input.ticket) {
      ticketId = input.ticket.id ?? makeTicketId(`ticket:${randomUUID()}`)
      const ticket = input.ticket
      if (!validateTicketBrief(ticket.brief)) throw new Error('eval: invalid ticket brief')
      if (ticket.mandate.policyVersion !== policy.version || !canGrant({ kind: 'accept', policyVersion: ticket.mandate.policyVersion, strength: decision.strength }, policy)) throw new Error('eval: mandate policy mismatch')
      store.repos.ticket.insert({
        id: ticketId, thread_key: evaluation.threadKey, decision_id: decision.id, title: ticket.title, state: 'open',
        mandate_json: ticket.mandate, brief_json: ticket.brief, workdir: ticket.workdir, stopped_by_human: false,
        attention_json: null, current_assignment: null, created_at: at, updated_at: at, ended_at: null, ended_by: null, outcome: null,
      })
      store.repos.thread_subscription.insert({ thread_key: evaluation.threadKey, ticket_id: ticketId })
    }
    store.repos.decision.insert({ id: decision.id, eval_id: evaluation.id, thread_key: evaluation.threadKey, policy_version: decision.policyVersion, kind: decision.kind, reason: decision.reason, strength: decision.strength, ticket_id: ticketId ?? null, trigger_ids: evaluation.triggerIds, at })
    for (const triggerId of evaluation.triggerIds) {
      store.db.prepare(`UPDATE trigger_disposition SET eval_id = ?, decision_id = ?, ticket_id = ? WHERE trigger_id = ?`).run(String(evaluation.id), String(decision.id), ticketId ? String(ticketId) : null, String(triggerId))
      store.db.prepare("UPDATE thread_trigger SET state = 'consumed' WHERE thread_key = ? AND trigger_id = ?").run(String(evaluation.threadKey), String(triggerId))
    }
    if (!store.repos.eval.updateByState(evaluation.id, 'running', 'decided')) throw new Error('eval: concurrent state change')
    updateThreadEvaluating(store, evaluation.threadKey, null)
    return { evaluation: { ...evaluation, state: 'decided' }, decision, ...(ticketId ? { ticketId } : {}) }
  })
}

/** Evaluate one Thread through a caller-supplied policy/model adapter. */
export async function evaluateThread(store: Store, threadKey: ThreadKey, policy: Pick<Policy, 'version' | 'evalTimeoutMs'> & Partial<Pick<Policy, 'paused'>>, evaluator: Evaluation, options: EvalStartOptions = {}): Promise<EvalResult | undefined> {
  const active = activeSet(store)
  if (active.has(String(threadKey))) return undefined
  active.add(String(threadKey))
  try {
    let evaluation: Eval | undefined
    for (;;) {
      const thread = store.repos.thread.get(threadKey) as Record<string, unknown> | undefined
      if (Boolean(thread?.paused) || policy.paused || globalPaused(store)) return undefined
      const existing = thread?.evaluating ? store.repos.eval.get(thread.evaluating) as Record<string, unknown> | undefined : undefined
      evaluation = existing?.state === 'running' ? mapEval(existing) : startEval(store, threadKey, policy, options)
      if (!evaluation || evaluation.policyVersion !== policy.version) return undefined
      const triggerRows = store.db.prepare('SELECT * FROM trigger WHERE id IN (' + evaluation.triggerIds.map(() => '?').join(',') + ')').all(...evaluation.triggerIds.map(String)) as Record<string, unknown>[]
      const controller = new AbortController()
      const current = nowOf(options.now)
      const waitMs = Math.max(1, evaluation.deadline - current)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('eval: evaluation timed out')) }, waitMs)
      })
      try {
        const input = await Promise.race([Promise.resolve(evaluator({ evaluation, triggerIds: evaluation.triggerIds, triggers: triggerRows, signal: controller.signal })), timeout])
        const settled = settleEval(store, evaluation.id, input, policy, options)
        // New arrivals during the running Eval remain pending. Pump them serially before
        // releasing the per-thread lock, preserving sequence order and single-Eval invariant.
        if (pendingIds(store, threadKey).length > 0) continue
        return settled
      } catch (error) {
        if (error instanceof Error && error.message === 'eval: evaluation timed out') {
          const retried = expireAndRequeue(store, evaluation.id, { evalTimeoutMs: policy.evalTimeoutMs, maxRequeues: options.maxRequeues ?? 2 }, { now: () => evaluation!.deadline })
          if (retried?.state === 'running') continue
          return undefined
        }
        throw error
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
  } finally {
    active.delete(String(threadKey))
  }
}

/** Expire a running Eval and, while under the retry budget, put its triggers back in pending. */
export function expireAndRequeue(store: Store, evaluationId: EvalId, policy: Pick<Policy, 'evalTimeoutMs'> & { readonly maxRequeues?: number }, options: EvalStartOptions = {}): Eval | undefined {
  const at = nowOf(options.now)
  return store.transaction(() => {
    const row = store.repos.eval.get(evaluationId) as Record<string, unknown> | undefined
    if (!row) return undefined
    const evaluation = mapEval(row)
    if (evaluation.state !== 'running' || at < evaluation.deadline) return evaluation
    const expired = expireEval(evaluation, at)
    store.repos.eval.updateByState(evaluation.id, 'running', 'expired')
    const maxRequeues = policy.maxRequeues ?? 2
    if (expired.requeues < maxRequeues) {
      const next = requeueEval(expired, at, policy.evalTimeoutMs, maxRequeues)
      store.db.prepare('UPDATE eval SET state = ?, requeues = ?, deadline = ? WHERE id = ?').run('running', next.requeues, next.deadline, String(evaluation.id))
      for (const triggerId of evaluation.triggerIds) store.db.prepare("UPDATE thread_trigger SET state = 'pending' WHERE thread_key = ? AND trigger_id = ?").run(String(evaluation.threadKey), String(triggerId))
      // Keep the same Eval claim while retrying; no second running Eval may start on this Thread.
      updateThreadEvaluating(store, evaluation.threadKey, String(evaluation.id))
      for (const triggerId of evaluation.triggerIds) store.db.prepare('UPDATE trigger_disposition SET requeued = 1 WHERE trigger_id = ?').run(String(triggerId))
      return next
    }
    const unavailable = unavailableDecision(expired, at)
    store.repos.decision.insert({ id: unavailable.id, eval_id: expired.id, thread_key: expired.threadKey, policy_version: unavailable.policyVersion, kind: 'unavailable', reason: unavailable.reason, strength: unavailable.strength, ticket_id: null, trigger_ids: expired.triggerIds, at })
    for (const triggerId of expired.triggerIds) {
      store.db.prepare('UPDATE trigger_disposition SET eval_id = ?, decision_id = ?, requeued = 0 WHERE trigger_id = ?').run(String(expired.id), String(unavailable.id), String(triggerId))
      store.db.prepare("UPDATE thread_trigger SET state = 'consumed' WHERE thread_key = ? AND trigger_id = ?").run(String(expired.threadKey), String(triggerId))
    }
    updateThreadEvaluating(store, expired.threadKey, null)
    return expired
  })
}

export const startEvaluation = startEval
export const decideEvaluation = settleEval
export const reconcileEval = expireAndRequeue
