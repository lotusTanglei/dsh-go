import { createHash } from 'node:crypto'
import { encodeJson, type Store } from '../store/index.js'
import { WorkspaceError } from './commands.js'

export type SessionOperation = 'continue' | 'supplement' | 'steer'
export interface SessionActionInput {
  epoch: string; requestId: string; actionId: string; operation: SessionOperation; text: string
  target: { sessionId: string; scopeRevision: string; factRevision: string }
}
export interface SessionTargetBinding {
  sessionId: string; project: { kind: 'project' | 'unassigned'; key: string }
  scopeRevision: string; factRevision: string
}
export interface SessionActionRecord {
  version: 1; epoch: string; requestId: string; actionId: string; operation: SessionOperation
  target: SessionTargetBinding; digest: string; messageId: string; seq: number; at: number; updatedAt: number
  state: 'recorded' | 'blocked' | 'dispatch_unknown' | 'accepted'; code?: string
  controlRevision?: string; grantRevision?: string
}
export interface SessionActionClosure {
  version: 1; epoch: string; requestId: string; actionId: string; operation: SessionOperation
  target: SessionActionInput['target']; digest: string; seq: 1; at: number; updatedAt: number; state: 'closed'; bindingVerified: false
}
export interface SessionActionEvidence {
  actionId: string; sessionId: string; digest: string; messageId: string; durable: true; accepted: true
}
export interface SessionActionPorts {
  requireEpoch(epoch: string): void
  /** Must read only current authorized facts; a returned binding is not an execution grant. */
  target(input: SessionActionInput['target']): Promise<{ binding: SessionTargetBinding; fence(): void }>
  /** Host owns actor, isolation, approvals and external resource/conflict policy. No browser switches. */
  gate(input: Readonly<SessionActionInput>, binding: Readonly<SessionTargetBinding>): Promise<{ allowed: false; code: string } | { allowed: true; controlRevision: string; grantRevision: string; fence(): void }>
  /** No production adapter until its isolation/authentication contract is proved. */
  dispatch?(record: Readonly<SessionActionRecord>, text: string): Promise<void>
  /** Host-only minimal receipt lookup, never transcript/goal/private content; no automatic resend. */
  evidence?(record: Readonly<SessionActionRecord>): Promise<SessionActionEvidence | undefined>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/, CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/
const validId = (id: unknown): id is string => typeof id === 'string' && ID.test(id) && !id.includes('://')
const validHash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value)
const validUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const plain = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value: Record<string, any>, keys: string[]) => Object.keys(value).every(key => keys.includes(key)) && Object.getOwnPropertySymbols(value).length === 0
const fail = (code: string, status = 409): never => { throw new WorkspaceError(code, status) }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const KIND = 'session-action-v1', key = (id: string) => `session-action:v1:${id}`
const requestKey = (epoch: string, id: string) => `session-action-request:v1:${hash([epoch, id])}`
const closureKey = (id: string) => `session-action-closed:v1:${id}`
const ops = ['continue', 'supplement', 'steer']

export function validSessionAction(input: unknown): input is SessionActionInput {
  return plain(input) && only(input, ['epoch', 'requestId', 'actionId', 'operation', 'text', 'target']) && validId(input.epoch)
    && validUuid(input.requestId) && validUuid(input.actionId) && ops.includes(input.operation)
    && typeof input.text === 'string' && Boolean(input.text.trim()) && !input.text.includes('\0') && Buffer.byteLength(input.text, 'utf8') <= 16_384
    && plain(input.target) && only(input.target, ['sessionId', 'scopeRevision', 'factRevision']) && validId(input.target.sessionId) && validHash(input.target.scopeRevision) && validHash(input.target.factRevision)
}
export function sessionActionDigest(input: SessionActionInput): string {
  return hash([input.epoch, input.requestId, input.actionId, input.operation, input.text, input.target.sessionId, input.target.scopeRevision, input.target.factRevision])
}
function bindingValid(value: unknown): value is SessionTargetBinding {
  return plain(value) && only(value, ['sessionId', 'project', 'scopeRevision', 'factRevision']) && validId(value.sessionId) && validHash(value.scopeRevision) && validHash(value.factRevision)
    && plain(value.project) && only(value.project, ['kind', 'key']) && ['project', 'unassigned'].includes(value.project.kind) && validId(value.project.key)
    && (value.project.kind !== 'unassigned' || value.project.key === 'unassigned')
}
function recordValid(value: unknown): value is SessionActionRecord {
  return plain(value) && only(value, ['version', 'epoch', 'requestId', 'actionId', 'operation', 'target', 'digest', 'messageId', 'seq', 'at', 'updatedAt', 'state', 'code', 'controlRevision', 'grantRevision'])
    && value.version === 1 && validId(value.epoch) && validUuid(value.requestId) && validUuid(value.actionId) && ops.includes(value.operation) && bindingValid(value.target)
    && validHash(value.digest) && value.messageId === `go:${value.actionId}` && Number.isSafeInteger(value.seq) && value.seq >= 1
    && Number.isSafeInteger(value.at) && value.at >= 0 && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= value.at
    && ['recorded', 'blocked', 'dispatch_unknown', 'accepted'].includes(value.state) && value.seq === ({ recorded: 1, blocked: 2, dispatch_unknown: 2, accepted: 3 } as Record<string, number>)[value.state] && (value.code === undefined || typeof value.code === 'string' && CODE.test(value.code))
    && (value.controlRevision === undefined || validHash(value.controlRevision)) && (value.grantRevision === undefined || validHash(value.grantRevision))
    && (!['dispatch_unknown', 'accepted'].includes(value.state) || validHash(value.controlRevision) && validHash(value.grantRevision))
}
function closureValid(value: unknown): value is SessionActionClosure {
  return plain(value) && only(value, ['version', 'epoch', 'requestId', 'actionId', 'operation', 'target', 'digest', 'seq', 'at', 'updatedAt', 'state', 'bindingVerified']) && value.version === 1
    && validId(value.epoch) && validUuid(value.requestId) && validUuid(value.actionId) && ops.includes(value.operation) && validHash(value.digest) && value.seq === 1 && value.state === 'closed' && value.bindingVerified === false
    && Number.isSafeInteger(value.at) && value.at >= 0 && value.updatedAt === value.at && plain(value.target) && only(value.target, ['sessionId', 'scopeRevision', 'factRevision'])
    && validId(value.target.sessionId) && validHash(value.target.scopeRevision) && validHash(value.target.factRevision)
}
function closureReceipt(record: SessionActionClosure) {
  return { ...record, target: { ...record.target }, durable: true as const, accepted: false as const, executed: null, completed: null,
    disposition: 'closed-before-dispatch' as const, code: 'session_action_id_closed' }
}
function receipt(record: SessionActionRecord) {
  return { ...record, target: { ...record.target, project: { ...record.target.project } }, durable: true as const,
    accepted: record.state === 'accepted', executed: ['recorded', 'blocked'].includes(record.state) ? false : null, completed: ['recorded', 'blocked'].includes(record.state) ? false : null,
    disposition: record.state === 'accepted' ? 'target-durable-receipt' : record.state === 'dispatch_unknown' ? 'reconcile-only' : 'not-dispatched' }
}
function frozen(record: SessionActionRecord) { return Object.freeze({ ...record, target: Object.freeze({ ...record.target, project: Object.freeze({ ...record.target.project }) }) }) }

/** Durable, non-replaying dispatch fence. Raw text stays in the caller until one dispatch;
 * it is never persisted in an audit/side_effect record or rehydrated from redacted text.
 */
export function createSessionActions(store: Store, ports: SessionActionPorts) {
  let tail = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>) => { const next = tail.then(fn); tail = next.then(() => {}, () => {}); return next }
  function read(id: string): SessionActionRecord | undefined {
    const row = store.repos.side_effect.get(key(id))
    if (!row) return undefined
    const value = row.detail
    if (row.kind !== KIND || !recordValid(value) || value.actionId !== id || row.state !== `v1:${value.seq}` || store.repos.kv.get(closureKey(id))) return fail('session_action_record_invalid', 503)
    const pointer = store.repos.kv.get(requestKey(value.epoch, value.requestId))?.v
    if (!plain(pointer) || !only(pointer, ['version', 'actionId']) || pointer.version !== 1 || pointer.actionId !== id) return fail('session_action_record_invalid', 503)
    return value
  }
  function readClosure(id: string): SessionActionClosure | undefined {
    const row = store.repos.kv.get(closureKey(id))
    if (!row) return undefined
    if (!closureValid(row.v) || row.v.actionId !== id || store.repos.side_effect.get(key(id))) return fail('session_action_record_invalid', 503)
    const pointer = store.repos.kv.get(requestKey(row.v.epoch, row.v.requestId))?.v
    if (!plain(pointer) || !only(pointer, ['version', 'actionId']) || pointer.version !== 1 || pointer.actionId !== id) return fail('session_action_record_invalid', 503)
    return row.v
  }
  function update(record: SessionActionRecord, patch: Pick<SessionActionRecord, 'state'> & { code?: string; controlRevision?: string; grantRevision?: string }): SessionActionRecord {
    const transitions: Record<SessionActionRecord['state'], SessionActionRecord['state'][]> = { recorded: ['blocked', 'dispatch_unknown'], blocked: [], dispatch_unknown: ['accepted'], accepted: [] }
    if (!transitions[record.state].includes(patch.state)) return fail('session_action_conflict')
    const next = { ...record, ...patch, seq: record.seq + 1, updatedAt: Math.max(Date.now(), record.updatedAt) }
    if (patch.code === undefined) delete next.code
    if (!recordValid(next)) return fail('session_action_record_invalid', 503)
    // Strict schema contains only bounded metadata. Do not redact opaque IDs into a different binding.
    const changed = store.db.prepare('UPDATE side_effect SET state=?, detail=? WHERE key=? AND state=?').run(`v1:${next.seq}`, encodeJson(next, false), key(record.actionId), `v1:${record.seq}`)
    if (Number(changed.changes) !== 1) return fail('session_action_conflict')
    return next
  }
  function assertRequest(input: SessionActionInput): SessionActionRecord | undefined {
    const pointer = store.repos.kv.get(requestKey(input.epoch, input.requestId))?.v as any
    if (pointer !== undefined && (!plain(pointer) || !only(pointer, ['version', 'actionId']) || pointer.version !== 1 || !validUuid(pointer.actionId))) return fail('session_action_record_invalid', 503)
    if (pointer && pointer.actionId !== input.actionId) return fail('session_action_request_conflict')
    const current = read(input.actionId)
    if (current && (current.digest !== sessionActionDigest(input) || current.epoch !== input.epoch || current.requestId !== input.requestId)) return fail('session_action_request_conflict')
    if (Boolean(pointer) !== Boolean(current)) return fail('session_action_record_invalid', 503)
    return current
  }
  function unknownDispatch(except: string): boolean {
    const rows = store.db.prepare('SELECT key FROM side_effect WHERE kind=?').all(KIND) as { key: string }[]
    // Resource independence is unproved in this slice: retain a global durable reservation.
    return rows.some(row => { const record = read(row.key.slice('session-action:v1:'.length))!; return record.actionId !== except && record.state === 'dispatch_unknown' })
  }
  async function reconcile(record: SessionActionRecord): Promise<SessionActionRecord> {
    if (record.state !== 'dispatch_unknown' || !ports.evidence) return record
    let evidence: SessionActionEvidence | undefined
    try { evidence = await ports.evidence(frozen(record)) } catch { return record }
    ports.requireEpoch(record.epoch)
    if (!plain(evidence) || !only(evidence, ['actionId', 'sessionId', 'digest', 'messageId', 'durable', 'accepted']) || evidence.accepted !== true || evidence.durable !== true || evidence.actionId !== record.actionId || evidence.sessionId !== record.target.sessionId || evidence.digest !== record.digest || evidence.messageId !== record.messageId) return record
    return store.transaction(() => {
      const current = read(record.actionId)!
      return current.state === 'dispatch_unknown' ? update(current, { state: 'accepted' }) : current
    })
  }
  return {
    async prepare(raw: SessionActionInput) {
      if (!validSessionAction(raw)) return fail('session_action_invalid', 400)
      const input = Object.freeze({ ...raw, target: Object.freeze({ ...raw.target }) })
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const closed = readClosure(input.actionId)
        if (closed) {
          if (closed.epoch !== input.epoch || closed.requestId !== input.requestId || closed.digest !== sessionActionDigest(input)) return fail('session_action_request_conflict')
          return closureReceipt(closed)
        }
        const existing = assertRequest(input)
        // Never resend an old action, including one whose earlier return was lost.
        if (existing && existing.state !== 'recorded') return receipt(existing)
        const resolved = await ports.target(input.target)
        ports.requireEpoch(input.epoch)
        if (!bindingValid(resolved.binding) || resolved.binding.sessionId !== input.target.sessionId || resolved.binding.scopeRevision !== input.target.scopeRevision || resolved.binding.factRevision !== input.target.factRevision || typeof resolved.fence !== 'function') return fail('session_action_target_changed')
        // Snapshot before invoking even a trusted adapter callback; never dispatch a changed binding.
        const binding = Object.freeze({ ...resolved.binding, project: Object.freeze({ ...resolved.binding.project }) })
        const target = { binding, fence: resolved.fence.bind(resolved) }
        target.fence()
        let record = store.transaction(() => {
          const current = assertRequest(input)
          if (current) return current
          const at = Date.now(), value: SessionActionRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, operation: input.operation,
            target: { ...target.binding, project: { ...target.binding.project } }, digest: sessionActionDigest(input), messageId: `go:${input.actionId}`, seq: 1, at, updatedAt: at, state: 'recorded' }
          store.repos.kv.insert({ k: requestKey(input.epoch, input.requestId), v: { version: 1, actionId: input.actionId } })
          if (!recordValid(value)) return fail('session_action_record_invalid', 503)
          store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(key(input.actionId), KIND, at, 'v1:1', encodeJson(value, false))
          return value
        })
        if (record.state !== 'recorded') return receipt(record)
        let gate: Awaited<ReturnType<SessionActionPorts['gate']>>
        try { gate = await ports.gate(input, Object.freeze({ ...target.binding, project: Object.freeze({ ...target.binding.project }) })) }
        catch { return receipt(store.transaction(() => update(record, { state: 'blocked', code: 'session_action_gate_unavailable' }))) }
        // Capture the entire grant before invoking another adapter callback.
        const decision = gate?.allowed === true ? { allowed: true as const, controlRevision: gate.controlRevision, grantRevision: gate.grantRevision, fence: typeof gate.fence === 'function' ? gate.fence.bind(gate) : undefined }
          : { allowed: false as const, code: gate?.allowed === false && typeof gate.code === 'string' && CODE.test(gate.code) ? gate.code : 'session_action_adapter_unavailable' }
        ports.requireEpoch(input.epoch)
        // Async approval/gate cannot preserve a superseded scope grant.
        try { target.fence() } catch { return receipt(store.transaction(() => update(record, { state: 'blocked', code: 'session_action_target_changed' }))) }
        if (!decision.allowed || !ports.dispatch) return receipt(store.transaction(() => update(record, { state: 'blocked', code: !decision.allowed ? decision.code : 'session_action_adapter_unavailable' })))
        if (!validHash(decision.controlRevision) || !validHash(decision.grantRevision) || typeof decision.fence !== 'function') return receipt(store.transaction(() => update(record, { state: 'blocked', code: 'session_action_gate_invalid' })))
        const permit = Object.freeze({ controlRevision: decision.controlRevision, grantRevision: decision.grantRevision, fence: decision.fence })
        // Gate may have awaited human review: refresh the exact facts as well as scope/control.
        let finalFence: () => void
        try {
          const refreshed = await ports.target(input.target)
          ports.requireEpoch(input.epoch)
          if (!bindingValid(refreshed.binding) || refreshed.binding.sessionId !== binding.sessionId || refreshed.binding.scopeRevision !== binding.scopeRevision || refreshed.binding.factRevision !== binding.factRevision || refreshed.binding.project.kind !== binding.project.kind || refreshed.binding.project.key !== binding.project.key || typeof refreshed.fence !== 'function') return receipt(store.transaction(() => update(record, { state: 'blocked', code: 'session_action_target_changed' })))
          finalFence = refreshed.fence.bind(refreshed)
        } catch { return receipt(store.transaction(() => update(record, { state: 'blocked', code: 'session_action_target_changed' }))) }
        record = store.transaction(() => {
          if (unknownDispatch(input.actionId)) return update(record, { state: 'blocked', code: 'session_action_target_unknown' })
          try { target.fence(); finalFence(); permit.fence(); ports.requireEpoch(input.epoch) } catch { return update(record, { state: 'blocked', code: 'session_action_target_changed' }) }
          return update(record, { state: 'dispatch_unknown', code: 'session_action_reconcile_required', controlRevision: permit.controlRevision, grantRevision: permit.grantRevision })
        })
        if (record.state !== 'dispatch_unknown') return receipt(record)
        // No await or model-selected route between the persisted fence and the one dispatch call.
        try { await ports.dispatch(frozen(record), input.text) } catch { /* possibly accepted: reconcile only */ }
        ports.requireEpoch(input.epoch)
        return receipt(await reconcile(record))
      })
    },
    async close(raw: SessionActionInput) {
      if (!validSessionAction(raw)) return fail('session_action_invalid', 400)
      const input = Object.freeze({ ...raw, target: Object.freeze({ ...raw.target }) })
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        return store.transaction(() => {
          const prior = readClosure(input.actionId)
          if (prior) {
            if (prior.epoch !== input.epoch || prior.requestId !== input.requestId || prior.digest !== sessionActionDigest(input)) return fail('session_action_request_conflict')
            return closureReceipt(prior)
          }
          const current = assertRequest(input)
          // An existing dispatch fence is never canceled by absence of target evidence.
          if (current) return receipt(current)
          const at = Date.now(), value: SessionActionClosure = { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, operation: input.operation,
            target: { ...input.target }, digest: sessionActionDigest(input), seq: 1, at, updatedAt: at, state: 'closed', bindingVerified: false }
          if (!closureValid(value)) return fail('session_action_record_invalid', 503)
          store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run(closureKey(input.actionId), encodeJson(value, false))
          store.repos.kv.insert({ k: requestKey(input.epoch, input.requestId), v: { version: 1, actionId: input.actionId } })
          return closureReceipt(value)
        })
      })
    },
    async status(input: { epoch: string; actionId: string }) {
      if (!plain(input) || !only(input, ['epoch', 'actionId']) || !validId(input.epoch) || !validUuid(input.actionId)) return fail('session_action_invalid', 400)
      const snapshot = { ...input }
      return serialize(async () => {
        ports.requireEpoch(snapshot.epoch)
        const closed = readClosure(snapshot.actionId)
        if (closed) {
          if (closed.epoch !== snapshot.epoch) return fail('session_action_not_found', 404)
          return closureReceipt(closed)
        }
        const record = read(snapshot.actionId)
        if (!record || record.epoch !== snapshot.epoch) return fail('session_action_not_found', 404)
        return receipt(await reconcile(record))
      })
    },
  }
}
