import { createHash } from 'node:crypto'
import { encodeJson, type Store } from '../store/index.js'
import { WorkspaceError } from './commands.js'
import type { SessionTargetBinding } from './session-actions.js'

export interface SessionDecisionTarget { sessionId: string; scopeRevision: string; factRevision: string }
export interface SessionDecisionQuestion {
  id: string; question: string; detail?: string; header?: string
  options?: { label: string; description?: string }[]; multiSelect?: boolean
}
export interface SessionDecisionCall { callId: string; state: 'open' | 'continued'; questions: SessionDecisionQuestion[] }
export interface SessionDecisionProjection {
  availability: 'live' | 'cold' | 'unavailable'; complete: boolean; asOfSeq: number; active: SessionDecisionCall[]
}
export interface SessionDecisionSnapshot extends SessionDecisionProjection { snapshotRevision: string; fence(): void }
export interface SessionDecisionAnswer { id: string; selected: string[]; custom?: string; skip?: true }
export interface SessionDecisionInput {
  epoch: string; requestId: string; actionId: string; target: SessionDecisionTarget; callId: string
  snapshot: { asOfSeq: number; revision: string }; answers: SessionDecisionAnswer[]
}
export interface SessionDecisionRecord {
  version: 1; epoch: string; requestId: string; actionId: string; target: SessionTargetBinding; callId: string
  snapshot: { asOfSeq: number; revision: string }; digest: string
  answerSummary: { digest: string; questions: number; selections: number; customBytes: number; skipped: number }
  seq: number; at: number; updatedAt: number; state: 'recorded' | 'blocked' | 'dispatch_unknown' | 'accepted'
  code?: string; controlRevision?: string; grantRevision?: string
}
export interface SessionDecisionClosure {
  version: 1; epoch: string; requestId: string; actionId: string; target: SessionDecisionTarget; callId: string
  snapshot: SessionDecisionInput['snapshot']; digest: string; seq: 1; at: number; updatedAt: number
  state: 'closed'; bindingVerified: false
}
export interface SessionDecisionEvidence {
  actionId: string; sessionId: string; callId: string; snapshotRevision: string; digest: string; durable: true; accepted: true
}
export interface SessionDecisionPorts {
  requireEpoch(epoch: string): void
  target(input: SessionDecisionTarget): Promise<{ binding: SessionTargetBinding; fence(): void }>
  /** Host-only bounded exact projection. No transcript or inferred summary. */
  questions(target: Readonly<SessionTargetBinding>): Promise<SessionDecisionSnapshot>
  gate(input: Readonly<SessionDecisionInput>, target: Readonly<SessionTargetBinding>): Promise<
    { allowed: false; code: string } | { allowed: true; controlRevision: string; grantRevision: string; fence(): void }>
  /** Synthetic adapters only until real isolation, atomic revision and durable receipt contracts are proved. */
  dispatch?(record: Readonly<SessionDecisionRecord>, answer: Readonly<{ answers: readonly Omit<SessionDecisionAnswer, 'skip'>[] }>): Promise<void>
  evidence?(record: Readonly<SessionDecisionRecord>): Promise<SessionDecisionEvidence | undefined>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/, CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/
const plain = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)))
const only = (v: Record<string, any>, keys: string[]) => Object.keys(v).every(k => keys.includes(k)) && Object.getOwnPropertySymbols(v).length === 0
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v) && !v.includes('://')
const digestValid = (v: unknown): v is string => typeof v === 'string' && HASH.test(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const string = (v: unknown, max = 16_384): v is string => typeof v === 'string' && !v.includes('\0') && Buffer.byteLength(v, 'utf8') <= max
// Question IDs are caller-owned strings in the installed contract, not Session path identities.
const questionId = (v: unknown): v is string => string(v, 512) && Boolean(v.trim())
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min
const fail = (code: string, status = 409): never => { throw new WorkspaceError(code, status) }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const KIND = 'session-decision-v1', key = (v: string) => `session-decision:v1:${v}`
const pointer = (epoch: string, requestId: string) => `session-decision-request:v1:${hash([epoch, requestId])}`
const closureKey = (actionId: string) => `session-decision-closed:v1:${actionId}`
const targetValid = (v: unknown): v is SessionDecisionTarget => plain(v) && only(v, ['sessionId', 'scopeRevision', 'factRevision']) && id(v.sessionId) && digestValid(v.scopeRevision) && digestValid(v.factRevision)
const bindingValid = (v: unknown): v is SessionTargetBinding => plain(v) && only(v, ['sessionId', 'scopeRevision', 'factRevision', 'project']) && targetValid({ sessionId: v.sessionId, scopeRevision: v.scopeRevision, factRevision: v.factRevision }) && plain(v.project) && only(v.project, ['kind', 'key']) && ['project', 'unassigned'].includes(v.project.kind) && id(v.project.key) && (v.project.kind !== 'unassigned' || v.project.key === 'unassigned')
const sameTarget = (a: SessionDecisionTarget, b: SessionDecisionTarget) => a.sessionId === b.sessionId && a.scopeRevision === b.scopeRevision && a.factRevision === b.factRevision
const snapshotValid = (v: unknown): v is SessionDecisionInput['snapshot'] => plain(v) && only(v, ['asOfSeq', 'revision']) && integer(v.asOfSeq, -1) && digestValid(v.revision)
function answerValid(v: unknown): v is SessionDecisionAnswer {
  if (!plain(v) || !only(v, ['id', 'selected', 'custom', 'skip']) || !questionId(v.id) || !Array.isArray(v.selected) || v.selected.length > 64 || v.selected.some((s: unknown) => !string(s, 2_048) || !s.trim()) || new Set(v.selected).size !== v.selected.length || v.custom !== undefined && (!string(v.custom) || !v.custom.trim()) || v.skip !== undefined && v.skip !== true) return false
  return v.skip === true ? v.selected.length === 0 && v.custom === undefined : v.selected.length > 0 || v.custom !== undefined
}
export function validSessionDecision(v: unknown): v is SessionDecisionInput {
  return plain(v) && only(v, ['epoch', 'requestId', 'actionId', 'target', 'callId', 'snapshot', 'answers']) && id(v.epoch) && uuid(v.requestId) && uuid(v.actionId) && targetValid(v.target) && id(v.callId) && snapshotValid(v.snapshot) && Array.isArray(v.answers) && v.answers.length > 0 && v.answers.length <= 64 && v.answers.every(answerValid) && new Set(v.answers.map((a: SessionDecisionAnswer) => a.id)).size === v.answers.length && Buffer.byteLength(JSON.stringify(v.answers), 'utf8') <= 65_536
}
const answerCanonical = (a: SessionDecisionAnswer) => [a.id, a.selected, a.custom === undefined ? null : a.custom, a.skip === true]
export function sessionDecisionDigest(v: SessionDecisionInput): string {
  return hash([v.epoch, v.requestId, v.actionId, v.target.sessionId, v.target.scopeRevision, v.target.factRevision, v.callId, v.snapshot.asOfSeq, v.snapshot.revision, v.answers.map(answerCanonical)])
}
const canonicalCalls = (active: SessionDecisionCall[]) => active.map(c => [c.callId, c.state, c.questions.map(q => [q.id, q.question, q.detail ?? null, q.header ?? null, q.options?.map(o => [o.label, o.description ?? null]) ?? null, q.multiSelect ?? null])])
export function sessionDecisionSnapshotDigest(binding: SessionTargetBinding, projection: SessionDecisionProjection): string {
  return hash([binding.sessionId, binding.project.kind, binding.project.key, binding.scopeRevision, binding.factRevision, projection.availability, projection.complete, projection.asOfSeq, canonicalCalls(projection.active)])
}
function projectionValid(v: unknown): v is SessionDecisionProjection {
  if (!plain(v) || !only(v, ['availability', 'complete', 'asOfSeq', 'active', 'snapshotRevision', 'fence']) || !['live', 'cold', 'unavailable'].includes(v.availability) || typeof v.complete !== 'boolean' || !integer(v.asOfSeq, -1) || !Array.isArray(v.active) || v.active.length > 64) return false
  let total = 0
  return v.active.every((c: unknown) => {
    if (!plain(c) || !only(c, ['callId', 'state', 'questions']) || !id(c.callId) || !['open', 'continued'].includes(c.state) || !Array.isArray(c.questions) || c.questions.length < 1 || (total += c.questions.length) > 64) return false
    return new Set(c.questions.map((q: any) => q?.id)).size === c.questions.length && c.questions.every((q: unknown) => plain(q) && only(q, ['id', 'question', 'detail', 'header', 'options', 'multiSelect']) && questionId(q.id) && string(q.question) && Boolean(q.question.trim()) && (q.detail === undefined || string(q.detail)) && (q.header === undefined || string(q.header, 512)) && (q.multiSelect === undefined || typeof q.multiSelect === 'boolean') && (q.options === undefined || Array.isArray(q.options) && q.options.length <= 64 && new Set(q.options.map((o: any) => o?.label)).size === q.options.length && q.options.every((o: unknown) => plain(o) && only(o, ['label', 'description']) && string(o.label, 2_048) && Boolean(o.label.trim()) && (o.description === undefined || string(o.description)))))
  }) && new Set(v.active.map((c: SessionDecisionCall) => c.callId)).size === v.active.length && Buffer.byteLength(JSON.stringify(v.active), 'utf8') <= 262_144
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') { Object.freeze(v); for (const child of Object.values(v)) freeze(child) }
  return v
}
function recordValid(v: unknown): v is SessionDecisionRecord {
  if (!plain(v) || !only(v, ['version', 'epoch', 'requestId', 'actionId', 'target', 'callId', 'snapshot', 'digest', 'answerSummary', 'seq', 'at', 'updatedAt', 'state', 'code', 'controlRevision', 'grantRevision']) || v.version !== 1 || !id(v.epoch) || !uuid(v.requestId) || !uuid(v.actionId) || !bindingValid(v.target) || !id(v.callId) || !snapshotValid(v.snapshot) || !digestValid(v.digest) || !integer(v.at) || !integer(v.updatedAt) || v.updatedAt < v.at || !['recorded', 'blocked', 'dispatch_unknown', 'accepted'].includes(v.state) || v.seq !== ({ recorded: 1, blocked: 2, dispatch_unknown: 2, accepted: 3 } as Record<string, number>)[v.state] || v.code !== undefined && (typeof v.code !== 'string' || !CODE.test(v.code))) return false
  const s = v.answerSummary
  return plain(s) && only(s, ['digest', 'questions', 'selections', 'customBytes', 'skipped']) && digestValid(s.digest) && integer(s.questions, 1) && s.questions <= 64 && integer(s.selections) && s.selections <= 4096 && integer(s.customBytes) && s.customBytes <= 65_536 && integer(s.skipped) && s.skipped <= s.questions && (v.controlRevision === undefined || digestValid(v.controlRevision)) && (v.grantRevision === undefined || digestValid(v.grantRevision)) && (!['dispatch_unknown', 'accepted'].includes(v.state) || digestValid(v.controlRevision) && digestValid(v.grantRevision))
}
function closureValid(v: unknown): v is SessionDecisionClosure {
  return plain(v) && only(v, ['version', 'epoch', 'requestId', 'actionId', 'target', 'callId', 'snapshot', 'digest', 'seq', 'at', 'updatedAt', 'state', 'bindingVerified'])
    && v.version === 1 && id(v.epoch) && uuid(v.requestId) && uuid(v.actionId) && targetValid(v.target) && id(v.callId) && snapshotValid(v.snapshot)
    && digestValid(v.digest) && v.seq === 1 && integer(v.at) && v.updatedAt === v.at && v.state === 'closed' && v.bindingVerified === false
}
const closureReceipt = (v: SessionDecisionClosure) => ({ ...structuredClone(v), durable: true as const, accepted: false as const, executed: null, completed: null,
  approval: false as const, disposition: 'closed-before-dispatch' as const, code: 'session_decision_id_closed' as const })
const receipt = (v: SessionDecisionRecord) => ({ ...structuredClone(v), durable: true as const, accepted: v.state === 'accepted', executed: ['recorded', 'blocked'].includes(v.state) ? false : null, completed: ['recorded', 'blocked'].includes(v.state) ? false : null, approval: false as const, disposition: v.state === 'accepted' ? 'target-durable-receipt' : v.state === 'dispatch_unknown' ? 'reconcile-only' : 'not-dispatched' })

/** Exact-question business answers. No direct Agent calls, no raw-body persistence and no replay. */
export function createSessionDecisions(store: Store, ports: SessionDecisionPorts) {
  let tail = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>) => { const next = tail.then(fn); tail = next.then(() => {}, () => {}); return next }
  function read(actionId: string): SessionDecisionRecord | undefined {
    const row = store.repos.side_effect.get(key(actionId))
    if (!row) return undefined
    const v = row.detail
    if (row.kind !== KIND || !recordValid(v) || v.actionId !== actionId || row.state !== `v1:${v.seq}` || store.repos.kv.get(closureKey(actionId))) return fail('session_decision_record_invalid', 503)
    const p = store.repos.kv.get(pointer(v.epoch, v.requestId))?.v
    if (!plain(p) || !only(p, ['version', 'actionId']) || p.version !== 1 || p.actionId !== actionId) return fail('session_decision_record_invalid', 503)
    return v
  }
  function readClosure(actionId: string): SessionDecisionClosure | undefined {
    const row = store.repos.kv.get(closureKey(actionId))
    if (!row) return undefined
    const v = row.v
    if (!closureValid(v) || v.actionId !== actionId || store.repos.side_effect.get(key(actionId))) return fail('session_decision_record_invalid', 503)
    const p = store.repos.kv.get(pointer(v.epoch, v.requestId))?.v
    if (!plain(p) || !only(p, ['version', 'actionId']) || p.version !== 1 || p.actionId !== actionId) return fail('session_decision_record_invalid', 503)
    return v
  }
  function existing(input: SessionDecisionInput) {
    // Validate an existing receipt's own pointer before classifying caller ID conflicts.
    const current = readClosure(input.actionId) ?? read(input.actionId)
    const p = store.repos.kv.get(pointer(input.epoch, input.requestId))?.v
    if (p !== undefined && (!plain(p) || !only(p, ['version', 'actionId']) || p.version !== 1 || !uuid(p.actionId))) return fail('session_decision_record_invalid', 503)
    if (p && p.actionId !== input.actionId) return fail('session_decision_request_conflict')
    if (current && (current.epoch !== input.epoch || current.requestId !== input.requestId || current.digest !== sessionDecisionDigest(input))) return fail('session_decision_request_conflict')
    if (Boolean(p) !== Boolean(current)) return fail('session_decision_record_invalid', 503)
    return current
  }
  function update(v: SessionDecisionRecord, patch: { state: SessionDecisionRecord['state']; code?: string; controlRevision?: string; grantRevision?: string }) {
    if (!(v.state === 'recorded' && ['blocked', 'dispatch_unknown'].includes(patch.state) || v.state === 'dispatch_unknown' && patch.state === 'accepted')) return fail('session_decision_conflict')
    const next = { ...v, ...patch, seq: v.seq + 1, updatedAt: Math.max(Date.now(), v.updatedAt) }
    if (patch.code === undefined) delete next.code
    if (!recordValid(next)) return fail('session_decision_record_invalid', 503)
    const changed = store.db.prepare('UPDATE side_effect SET state=?,detail=? WHERE key=? AND state=?').run(`v1:${next.seq}`, encodeJson(next, false), key(v.actionId), `v1:${v.seq}`)
    if (Number(changed.changes) !== 1) return fail('session_decision_conflict')
    return next
  }
  async function current(epoch: string, requested: SessionDecisionTarget) {
    requested = freeze({ ...requested })
    ports.requireEpoch(epoch)
    const resolved = await ports.target(requested)
    if (!bindingValid(resolved.binding) || !sameTarget(requested, resolved.binding) || typeof resolved.fence !== 'function') return fail('session_decision_target_changed')
    const binding = freeze(structuredClone(resolved.binding)), targetFence = resolved.fence.bind(resolved)
    ports.requireEpoch(epoch); targetFence()
    const raw = await ports.questions(binding)
    if (!projectionValid(raw) || !digestValid(raw.snapshotRevision) || typeof raw.fence !== 'function') return fail('session_decision_projection_invalid', 503)
    const projection: SessionDecisionProjection = { availability: raw.availability, complete: raw.complete, asOfSeq: raw.asOfSeq, active: structuredClone(raw.active) }
    const revision = raw.snapshotRevision, questionFence = raw.fence.bind(raw)
    ports.requireEpoch(epoch); targetFence()
    if (revision !== sessionDecisionSnapshotDigest(binding, projection)) return fail('session_decision_projection_invalid', 503)
    const snapshot = freeze({ ...projection, snapshotRevision: revision })
    const fence = () => { ports.requireEpoch(epoch); targetFence(); questionFence() }
    fence()
    return { binding, snapshot, fence }
  }
  function requireAnswerable(input: SessionDecisionInput, cut: Awaited<ReturnType<typeof current>>) {
    if (cut.snapshot.snapshotRevision !== input.snapshot.revision || cut.snapshot.asOfSeq !== input.snapshot.asOfSeq) return fail('session_decision_question_changed')
    if (!cut.snapshot.complete) return fail('session_decision_projection_incomplete')
    if (cut.snapshot.availability !== 'live') return fail('session_decision_target_not_live')
    const call = cut.snapshot.active.find(c => c.callId === input.callId)
    if (!call || call.state !== 'continued') return fail('session_decision_not_continued')
    if (call.questions.length !== input.answers.length || !call.questions.every(q => input.answers.some(a => a.id === q.id))) return fail('session_decision_answer_mismatch', 400)
    for (const answer of input.answers) {
      const question = call.questions.find(q => q.id === answer.id)!
      if (question.multiSelect !== true && answer.selected.length > 1 || !answer.selected.every(label => question.options?.some(o => o.label === label))) return fail('session_decision_answer_mismatch', 400)
    }
    return call
  }
  function hasUnknown(except: string) {
    const rows = store.db.prepare('SELECT key FROM side_effect WHERE kind=?').all(KIND) as { key: string }[]
    return rows.some(row => { const v = read(row.key.slice('session-decision:v1:'.length))!; return v.actionId !== except && v.state === 'dispatch_unknown' })
  }
  async function reconcile(v: SessionDecisionRecord) {
    if (v.state !== 'dispatch_unknown' || !ports.evidence) return v
    // Exclusion/revision changes revoke even further receipt lookup in this slice.
    let cut: Awaited<ReturnType<typeof current>>
    try { cut = await current(v.epoch, { sessionId: v.target.sessionId, scopeRevision: v.target.scopeRevision, factRevision: v.target.factRevision }); if (cut.snapshot.snapshotRevision !== v.snapshot.revision || cut.snapshot.asOfSeq !== v.snapshot.asOfSeq) return v }
    catch { return v }
    let evidence: SessionDecisionEvidence | undefined
    try { const raw = await ports.evidence(freeze(structuredClone(v))); evidence = raw === undefined ? undefined : structuredClone(raw); cut.fence() } catch { return v }
    ports.requireEpoch(v.epoch)
    if (!plain(evidence) || !only(evidence, ['actionId', 'sessionId', 'callId', 'snapshotRevision', 'digest', 'durable', 'accepted']) || evidence.actionId !== v.actionId || evidence.sessionId !== v.target.sessionId || evidence.callId !== v.callId || evidence.snapshotRevision !== v.snapshot.revision || evidence.digest !== v.digest || evidence.durable !== true || evidence.accepted !== true) return v
    return store.transaction(() => { const latest = read(v.actionId)!; return latest.state === 'dispatch_unknown' ? update(latest, { state: 'accepted' }) : latest })
  }
  return {
    async list(raw: { epoch: string; target: SessionDecisionTarget }) {
      if (!plain(raw) || !only(raw, ['epoch', 'target']) || !id(raw.epoch) || !targetValid(raw.target)) return fail('session_decision_invalid', 400)
      const input = structuredClone(raw), cut = await current(input.epoch, input.target)
      cut.fence()
      return { target: structuredClone(cut.binding), availability: cut.snapshot.availability, complete: cut.snapshot.complete, asOfSeq: cut.snapshot.asOfSeq, snapshotRevision: cut.snapshot.snapshotRevision,
        calls: cut.snapshot.active.map(call => ({ ...structuredClone(call), canAnswer: false as const })), canAnswer: false as const, code: 'session_decision_execution_unverified', approval: false as const }
    },
    async prepare(raw: SessionDecisionInput) {
      if (!validSessionDecision(raw)) return fail('session_decision_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const known = existing(input)
        if (known?.state === 'closed') return closureReceipt(known)
        if (known && known.state !== 'recorded') return receipt(known)
        let cut: Awaited<ReturnType<typeof current>>
        try { cut = await current(input.epoch, input.target) }
        catch (error) {
          ports.requireEpoch(input.epoch)
          const closed = existing(input)
          if (closed?.state === 'closed') return closureReceipt(closed)
          throw error
        }
        // A winning close is terminal even if the awaited projection is now stale/denied.
        ports.requireEpoch(input.epoch)
        const afterLookup = existing(input)
        if (afterLookup?.state === 'closed') return closureReceipt(afterLookup)
        requireAnswerable(input, cut); cut.fence()
        const persisted = store.transaction(() => {
          // Another service instance can close while current() awaits; the durable fence wins.
          ports.requireEpoch(input.epoch)
          const prior = existing(input); if (prior) return prior
          const at = Date.now(), value: SessionDecisionRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, target: structuredClone(cut.binding), callId: input.callId, snapshot: { ...input.snapshot }, digest: sessionDecisionDigest(input),
            answerSummary: { digest: hash(input.answers.map(answerCanonical)), questions: input.answers.length, selections: input.answers.reduce((n, a) => n + a.selected.length, 0), customBytes: input.answers.reduce((n, a) => n + Buffer.byteLength(a.custom ?? '', 'utf8'), 0), skipped: input.answers.filter(a => a.skip).length }, seq: 1, at, updatedAt: at, state: 'recorded' }
          if (!recordValid(value)) return fail('session_decision_record_invalid', 503)
          store.repos.kv.insert({ k: pointer(input.epoch, input.requestId), v: { version: 1, actionId: input.actionId } })
          store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(key(input.actionId), KIND, at, 'v1:1', encodeJson(value, false))
          return value
        })
        if (persisted.state === 'closed') return closureReceipt(persisted)
        let record = persisted
        if (record.state !== 'recorded') return receipt(record)
        let gate: Awaited<ReturnType<SessionDecisionPorts['gate']>>
        try { gate = await ports.gate(input, cut.binding) } catch { return receipt(store.transaction(() => update(record!, { state: 'blocked', code: 'session_decision_gate_unavailable' }))) }
        const grant = gate?.allowed === true ? { allowed: true as const, controlRevision: gate.controlRevision, grantRevision: gate.grantRevision, fence: typeof gate.fence === 'function' ? gate.fence.bind(gate) : undefined }
          : { allowed: false as const, code: gate?.allowed === false && typeof gate.code === 'string' && CODE.test(gate.code) ? gate.code : 'session_decision_gate_invalid' }
        ports.requireEpoch(input.epoch)
        try { cut.fence() } catch { return receipt(store.transaction(() => update(record!, { state: 'blocked', code: 'session_decision_target_changed' }))) }
        if (!grant.allowed || !ports.dispatch) return receipt(store.transaction(() => update(record!, { state: 'blocked', code: !grant.allowed ? grant.code : 'session_decision_adapter_unavailable' })))
        if (!digestValid(grant.controlRevision) || !digestValid(grant.grantRevision) || !grant.fence) return receipt(store.transaction(() => update(record!, { state: 'blocked', code: 'session_decision_gate_invalid' })))
        let refreshed: Awaited<ReturnType<typeof current>>
        try {
          refreshed = await current(input.epoch, input.target)
          requireAnswerable(input, refreshed)
          if (hash(refreshed.binding) !== hash(cut.binding)) return fail('session_decision_target_changed')
        } catch { return receipt(store.transaction(() => update(record!, { state: 'blocked', code: 'session_decision_question_changed' }))) }
        record = store.transaction(() => {
          if (hasUnknown(input.actionId)) return update(record!, { state: 'blocked', code: 'session_decision_target_unknown' })
          try { cut.fence(); refreshed.fence(); grant.fence!(); ports.requireEpoch(input.epoch) } catch { return update(record!, { state: 'blocked', code: 'session_decision_target_changed' }) }
          return update(record!, { state: 'dispatch_unknown', code: 'session_decision_reconcile_required', controlRevision: grant.controlRevision, grantRevision: grant.grantRevision })
        })
        if (record.state !== 'dispatch_unknown') return receipt(record)
        const answer = freeze({ answers: input.answers.map(a => ({ id: a.id, selected: [...a.selected], ...(a.custom === undefined ? {} : { custom: a.custom }) })) })
        try { await ports.dispatch(freeze(structuredClone(record)), answer) } catch { /* unknown outcome: only independently reconcile */ }
        ports.requireEpoch(input.epoch)
        return receipt(await reconcile(record))
      })
    },
    /** Close only an unrecorded ID. This is a local no-dispatch fence, never stop/revoke/cancel. */
    async close(raw: SessionDecisionInput) {
      if (!validSessionDecision(raw)) return fail('session_decision_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        return store.transaction(() => {
          const prior = existing(input)
          if (prior) return prior.state === 'closed' ? closureReceipt(prior) : receipt(prior)
          const at = Date.now(), value: SessionDecisionClosure = { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId,
            target: { ...input.target }, callId: input.callId, snapshot: { ...input.snapshot }, digest: sessionDecisionDigest(input),
            seq: 1, at, updatedAt: at, state: 'closed', bindingVerified: false }
          if (!closureValid(value)) return fail('session_decision_record_invalid', 503)
          // Neither exact questions/answers nor a redacted substitute may be persisted.
          store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run(closureKey(input.actionId), encodeJson(value, false))
          store.repos.kv.insert({ k: pointer(input.epoch, input.requestId), v: { version: 1, actionId: input.actionId } })
          return closureReceipt(value)
        })
      })
    },
    async status(raw: { epoch: string; actionId: string }) {
      if (!plain(raw) || !only(raw, ['epoch', 'actionId']) || !id(raw.epoch) || !uuid(raw.actionId)) return fail('session_decision_invalid', 400)
      const input = { ...raw }
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const closed = readClosure(input.actionId)
        if (closed) {
          if (closed.epoch !== input.epoch) return fail('session_decision_not_found', 404)
          return closureReceipt(closed)
        }
        const record = read(input.actionId)
        if (!record || record.epoch !== input.epoch) return fail('session_decision_not_found', 404)
        return receipt(await reconcile(record))
      })
    },
  }
}
