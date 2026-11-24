import { createHash, randomUUID } from 'node:crypto'
import { encodeJson, type Store } from '../store/index.js'
import { WorkspaceError } from './commands.js'
import type { SessionTargetBinding } from './session-actions.js'

export type DeliveryOperation = 'continue' | 'supplement' | 'steer'
export interface DeliveryImageReference { imageId: string; digest: string; seq: number }
export interface DeliveryTargetInput { sessionId: string; scopeRevision: string; factRevision: string }
export interface DeliveryInput {
  epoch: string; requestId: string; confirmationId: string; operation: DeliveryOperation; text: string
  target: DeliveryTargetInput; images: DeliveryImageReference[]
}
export interface DeliveryConfirmationRecord {
  version: 1; epoch: string; requestId: string; confirmationId: string; operation: DeliveryOperation
  target: SessionTargetBinding; digest: string; bodyBytes: number; images: DeliveryImageReference[]
  seq: number; at: number; updatedAt: number; state: 'prepared' | 'confirmed' | 'canceled'; code?: string
}
export type DeliveryConfirmationState = DeliveryConfirmationRecord['state']
export interface DeliveryConfirmationReceipt {
  version: 1; epoch: string; requestId: string; confirmationId: string; operation: DeliveryOperation
  target: SessionTargetBinding; digest: string; bodyBytes: number; images: DeliveryImageReference[]
  seq: number; at: number; updatedAt: number; state: DeliveryConfirmationState
  durable: true; humanConfirmed: boolean; delivered: false; accepted: false; executed: false; completed: false
  disposition: 'not-confirmed' | 'confirmed-pending-delivery' | 'canceled'; code?: string
}
/** One durable dispatch fence per confirmed confirmation. Raw text is never stored. */
export type DeliveryDispatchState = 'dispatching' | 'accepted' | 'dispatch_unknown' | 'blocked'
export type DeliveryDispatchTerminalState = Exclude<DeliveryDispatchState, 'dispatching'>
export interface DeliveryDispatchRecord {
  version: 1; epoch: string; requestId: string; confirmationId: string; dispatchId: string; operation: DeliveryOperation
  target: SessionTargetBinding; digest: string; messageId: string; seq: number; at: number; updatedAt: number
  state: DeliveryDispatchState; code?: string
}
/** accepted means the target has durable evidence of receiving this exact message; never completion. */
export interface DeliveryDispatchReceipt {
  version: 1; epoch: string; requestId: string; confirmationId: string; dispatchId: string; messageId: string
  operation: DeliveryOperation; target: SessionTargetBinding; digest: string; bodyBytes: number; images: DeliveryImageReference[]
  seq: number; at: number; updatedAt: number; state: DeliveryDispatchTerminalState
  durable: true; humanConfirmed: true; delivered: boolean; accepted: boolean; executed: boolean | null; completed: boolean | null
  disposition: 'not-dispatched' | 'reconcile-only' | 'target-durable-receipt'; code?: string
}
export interface DeliveryDispatchDecision { state: DeliveryDispatchTerminalState; code?: string }
export interface DeliveryDispatchEvidence {
  dispatchId: string; confirmationId: string; sessionId: string; digest: string; messageId: string; durable: true; accepted: true
}
export interface DeliveryPorts {
  requireEpoch(epoch: string): void
  /** Must read current authorized facts. A returned binding is not an execution grant. */
  target(input: DeliveryTargetInput): Promise<{ binding: SessionTargetBinding; fence(): void }>
  /** Host-only exact reference check for already bound images; no bytes, no new binding. */
  images?(input: { epoch: string; references: readonly DeliveryImageReference[]; target: DeliveryTargetInput }): Promise<{ references: readonly DeliveryImageReference[]; fence(): void }>
  /**
   * Host-owned live control adapter, invoked once after the durable dispatch fence.
   * `accepted` requires durable evidence at the target; a cold target is `blocked` without
   * any resume; an ambiguous Host call is `dispatch_unknown`, never retried.
   */
  dispatch?(record: Readonly<DeliveryDispatchRecord>, text: string): Promise<DeliveryDispatchDecision>
  /** Read-only durable target evidence lookup by exact message id; never resends. */
  evidence?(record: Readonly<DeliveryDispatchRecord>): Promise<DeliveryDispatchEvidence | undefined>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/, CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/
const ops: readonly DeliveryOperation[] = ['continue', 'supplement', 'steer']
const KIND = 'delivery-confirmation-v1', DISPATCH_KIND = 'delivery-dispatch-v1'
const key = (id: string) => `delivery-confirmation:v1:${id}`
const dispatchKey = (id: string) => `delivery-dispatch:v1:${id}`
const requestKey = (epoch: string, requestId: string) => `delivery-request:v1:${hash([epoch, requestId])}`
const MAX_TEXT = 16_384, MAX_IMAGES = 5
const plain = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value: Record<string, any>, keys: string[]) => Object.keys(value).every(name => keys.includes(name)) && Object.getOwnPropertySymbols(value).length === 0
const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !value.includes('://')
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const digestValid = (value: unknown): value is string => typeof value === 'string' && HASH.test(value)
const codeValid = (value: unknown): value is string => typeof value === 'string' && CODE.test(value)
const textValid = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= MAX_TEXT
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fail(code: string, status = 409): never { throw new WorkspaceError(code, status) }
const targetValid = (value: unknown): value is DeliveryTargetInput => plain(value) && only(value, ['sessionId', 'scopeRevision', 'factRevision'])
  && id(value.sessionId) && digestValid(value.scopeRevision) && digestValid(value.factRevision)
const bindingValid = (value: unknown): value is SessionTargetBinding => plain(value) && only(value, ['sessionId', 'scopeRevision', 'factRevision', 'project'])
  && targetValid({ sessionId: value.sessionId, scopeRevision: value.scopeRevision, factRevision: value.factRevision })
  && plain(value.project) && only(value.project, ['kind', 'key']) && ['project', 'unassigned'].includes(value.project.kind) && id(value.project.key)
  && (value.project.kind !== 'unassigned' || value.project.key === 'unassigned')
const imageValid = (value: unknown): value is DeliveryImageReference => plain(value) && only(value, ['imageId', 'digest', 'seq'])
  && uuid(value.imageId) && digestValid(value.digest) && integer(value.seq, 1)
const imagesValid = (value: unknown): value is DeliveryImageReference[] => Array.isArray(value) && value.length <= MAX_IMAGES
  && new Set(value.map(item => item?.imageId)).size === value.length && value.every(imageValid)
const copyTarget = (value: DeliveryTargetInput): DeliveryTargetInput => ({ sessionId: value.sessionId, scopeRevision: value.scopeRevision, factRevision: value.factRevision })
const copyBinding = (value: SessionTargetBinding): SessionTargetBinding => ({ ...copyTarget(value), project: { kind: value.project.kind, key: value.project.key } })
const copyImages = (value: readonly DeliveryImageReference[]): DeliveryImageReference[] => value.map(item => ({ imageId: item.imageId, digest: item.digest, seq: item.seq }))
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child) }
  return value
}
const sameTarget = (a: DeliveryTargetInput, b: DeliveryTargetInput) => a.sessionId === b.sessionId && a.scopeRevision === b.scopeRevision && a.factRevision === b.factRevision

export function validDeliveryInput(value: unknown): value is DeliveryInput {
  return plain(value) && only(value, ['epoch', 'requestId', 'confirmationId', 'operation', 'text', 'target', 'images'])
    && id(value.epoch) && uuid(value.requestId) && uuid(value.confirmationId) && ops.includes(value.operation)
    && textValid(value.text) && targetValid(value.target) && imagesValid(value.images)
}
export function deliveryDigest(value: DeliveryInput): string {
  // Exact Unicode/newline semantics. No normalization or redacted replay copy.
  return hash([value.epoch, value.requestId, value.confirmationId, value.operation, value.text,
    value.target.sessionId, value.target.scopeRevision, value.target.factRevision,
    value.images.map(item => [item.imageId, item.digest, item.seq])])
}
function recordValid(value: unknown): value is DeliveryConfirmationRecord {
  if (!plain(value) || !only(value, ['version', 'epoch', 'requestId', 'confirmationId', 'operation', 'target', 'digest', 'bodyBytes', 'images', 'seq', 'at', 'updatedAt', 'state', 'code'])
    || value.version !== 1 || !id(value.epoch) || !uuid(value.requestId) || !uuid(value.confirmationId) || !ops.includes(value.operation)
    || !bindingValid(value.target) || !digestValid(value.digest) || !integer(value.bodyBytes, 1) || value.bodyBytes > MAX_TEXT
    || !imagesValid(value.images) || !integer(value.at) || !integer(value.updatedAt) || value.updatedAt < value.at) return false
  const sequence = { prepared: 1, confirmed: 2, canceled: 2 } as Record<string, number>
  if (!(value.state in sequence) || value.seq !== sequence[value.state]) return false
  return (value.code === undefined || codeValid(value.code))
}
const dispatchSequence: Record<DeliveryDispatchState, readonly number[]> = { dispatching: [1], accepted: [2, 3], dispatch_unknown: [2], blocked: [2] }
function dispatchRecordValid(value: unknown): value is DeliveryDispatchRecord {
  return plain(value) && only(value, ['version', 'epoch', 'requestId', 'confirmationId', 'dispatchId', 'operation', 'target', 'digest', 'messageId', 'seq', 'at', 'updatedAt', 'state', 'code'])
    && value.version === 1 && id(value.epoch) && uuid(value.requestId) && uuid(value.confirmationId) && uuid(value.dispatchId) && ops.includes(value.operation)
    && bindingValid(value.target) && digestValid(value.digest) && value.messageId === `go:${value.dispatchId}`
    && typeof value.state === 'string' && value.state in dispatchSequence && dispatchSequence[value.state as DeliveryDispatchState].includes(value.seq)
    && integer(value.at) && integer(value.updatedAt) && value.updatedAt >= value.at
    && (value.code === undefined || codeValid(value.code))
}
const dispatchEvidenceValid = (value: unknown): value is DeliveryDispatchEvidence => plain(value) && only(value, ['dispatchId', 'confirmationId', 'sessionId', 'digest', 'messageId', 'durable', 'accepted'])
  && uuid(value.dispatchId) && uuid(value.confirmationId) && id(value.sessionId) && digestValid(value.digest)
  && typeof value.messageId === 'string' && value.messageId === `go:${value.dispatchId}`
  && value.durable === true && value.accepted === true
function receipt(record: DeliveryConfirmationRecord): DeliveryConfirmationReceipt {
  return freeze({ version: 1 as const, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId,
    operation: record.operation, target: copyBinding(record.target), digest: record.digest, bodyBytes: record.bodyBytes,
    images: copyImages(record.images), seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state,
    durable: true as const, humanConfirmed: record.state === 'confirmed', delivered: false as const, accepted: false as const,
    executed: false as const, completed: false as const,
    disposition: record.state === 'confirmed' ? 'confirmed-pending-delivery' as const : record.state === 'canceled' ? 'canceled' as const : 'not-confirmed' as const,
    ...(record.code ? { code: record.code } : {}) })
}
function dispatchReceipt(record: DeliveryDispatchRecord, confirmation: DeliveryConfirmationRecord): DeliveryDispatchReceipt {
  // `dispatching` is an internal fence; a reader must reconcile it to an honest unknown first.
  if (record.state === 'dispatching') return fail('delivery_dispatch_record_invalid', 503)
  const accepted = record.state === 'accepted', blocked = record.state === 'blocked'
  return freeze({ version: 1 as const, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId,
    dispatchId: record.dispatchId, messageId: record.messageId, operation: record.operation,
    target: copyBinding(record.target), digest: record.digest, bodyBytes: confirmation.bodyBytes, images: copyImages(confirmation.images),
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state,
    durable: true as const, humanConfirmed: true as const, delivered: accepted, accepted,
    executed: blocked ? false : null, completed: blocked ? false : null,
    disposition: accepted ? 'target-durable-receipt' as const : blocked ? 'not-dispatched' as const : 'reconcile-only' as const,
    ...(record.code ? { code: record.code } : {}) })
}
function metadata(record: DeliveryConfirmationRecord): DeliveryConfirmationRecord {
  // Strict allowlist contains no body text and no raw caller payload.
  return { version: 1, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId, operation: record.operation,
    target: copyBinding(record.target), digest: record.digest, bodyBytes: record.bodyBytes, images: copyImages(record.images),
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state, ...(record.code ? { code: record.code } : {}) }
}
function dispatchMetadata(record: DeliveryDispatchRecord): DeliveryDispatchRecord {
  // Strict allowlist contains no body text and no raw caller payload.
  return { version: 1, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId, dispatchId: record.dispatchId,
    operation: record.operation, target: copyBinding(record.target), digest: record.digest, messageId: record.messageId,
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state, ...(record.code ? { code: record.code } : {}) }
}

/**
 * Human pre-delivery confirmation, then one durable, non-replaying dispatch to the exact confirmed
 * live target. A `confirmed` record has no external effect; `dispatch` performs the single Host
 * control call after persisting a fence and returns only accepted / unknown / blocked evidence.
 * No Agent, Worker, message or Session API is reachable from the confirmation service itself.
 */
export function createDeliveries(store: Store, ports: DeliveryPorts) {
  let tail = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>) => { const next = tail.then(fn); tail = next.then(() => {}, () => {}); return next }
  function read(confirmationId: string): DeliveryConfirmationRecord | undefined {
    const row = store.repos.side_effect.get(key(confirmationId))
    if (!row) return undefined
    const value = row.detail
    if (row.kind !== KIND || !recordValid(value) || value.confirmationId !== confirmationId || row.state !== `v1:${value.seq}`) fail('delivery_confirmation_record_invalid', 503)
    const pointer = store.repos.kv.get(requestKey(value.epoch, value.requestId))?.v
    if (!plain(pointer) || !only(pointer, ['version', 'confirmationId']) || pointer.version !== 1 || pointer.confirmationId !== confirmationId) fail('delivery_confirmation_record_invalid', 503)
    return value
  }
  function pointerFor(epoch: string, requestId: string) {
    const value = store.repos.kv.get(requestKey(epoch, requestId))?.v
    if (value === undefined) return undefined
    if (!plain(value) || !only(value, ['version', 'confirmationId']) || value.version !== 1 || !uuid(value.confirmationId)) fail('delivery_confirmation_record_invalid', 503)
    return value as { version: 1; confirmationId: string }
  }
  /** Classify idempotent replay, request conflict and corrupted pointer before any side effect. */
  function existing(input: DeliveryInput): DeliveryConfirmationRecord | undefined {
    const pointer = pointerFor(input.epoch, input.requestId)
    const current = read(input.confirmationId)
    if (pointer && pointer.confirmationId !== input.confirmationId) fail('delivery_request_conflict')
    if (current && (current.epoch !== input.epoch || current.requestId !== input.requestId)) fail('delivery_request_conflict')
    if (current && current.digest !== deliveryDigest(input)) fail('delivery_request_conflict')
    if (Boolean(pointer) !== Boolean(current)) fail('delivery_confirmation_record_invalid', 503)
    return current
  }
  function update(record: DeliveryConfirmationRecord, state: 'confirmed' | 'canceled'): DeliveryConfirmationRecord {
    const next: DeliveryConfirmationRecord = { ...metadata(record), state, seq: record.seq + 1, updatedAt: Math.max(Date.now(), record.updatedAt) }
    if (!recordValid(next)) fail('delivery_confirmation_record_invalid', 503)
    const changed = store.db.prepare('UPDATE side_effect SET state=?, detail=? WHERE key=? AND state=?')
      .run(`v1:${next.seq}`, encodeJson(next, false), key(record.confirmationId), `v1:${record.seq}`)
    if (Number(changed.changes) !== 1) fail('delivery_confirmation_conflict')
    return next
  }
  function readDispatch(confirmationId: string): DeliveryDispatchRecord | undefined {
    if (!uuid(confirmationId)) return undefined
    const row = store.repos.side_effect.get(dispatchKey(confirmationId))
    if (!row) return undefined
    const value = row.detail
    if (row.kind !== DISPATCH_KIND || !dispatchRecordValid(value) || value.confirmationId !== confirmationId || row.state !== `v1:${value.seq}`) fail('delivery_dispatch_record_invalid', 503)
    return value
  }
  function updateDispatch(record: DeliveryDispatchRecord, state: DeliveryDispatchTerminalState, code?: string): DeliveryDispatchRecord {
    const transitions: Record<DeliveryDispatchState, readonly DeliveryDispatchState[]> = {
      dispatching: ['accepted', 'dispatch_unknown', 'blocked'], dispatch_unknown: ['accepted'], accepted: [], blocked: [],
    }
    if (!transitions[record.state].includes(state)) fail('delivery_dispatch_conflict')
    const next: DeliveryDispatchRecord = { ...dispatchMetadata(record), state, seq: record.seq + 1, updatedAt: Math.max(Date.now(), record.updatedAt), ...(code === undefined ? {} : { code }) }
    if (code === undefined) delete next.code
    if (!dispatchRecordValid(next)) fail('delivery_dispatch_record_invalid', 503)
    // Strict schema contains only bounded metadata. Raw text is never persisted or redacted into a record.
    const changed = store.db.prepare('UPDATE side_effect SET state=?, detail=? WHERE key=? AND state=?')
      .run(`v1:${next.seq}`, encodeJson(next, false), dispatchKey(record.confirmationId), `v1:${record.seq}`)
    if (Number(changed.changes) !== 1) fail('delivery_dispatch_conflict')
    return next
  }
  async function targetCut(requested: DeliveryTargetInput): Promise<{ binding: SessionTargetBinding; fence(): void }> {
    let resolved: Awaited<ReturnType<DeliveryPorts['target']>>
    try { resolved = await ports.target({ ...requested }) } catch { return fail('delivery_target_changed') }
    if (!plain(resolved) || !bindingValid(resolved.binding) || typeof resolved.fence !== 'function') return fail('delivery_target_changed')
    const binding = freeze(copyBinding(resolved.binding)), fence = resolved.fence.bind(resolved)
    if (!sameTarget(binding, requested)) return fail('delivery_target_changed')
    try { fence() } catch { return fail('delivery_target_changed') }
    return { binding, fence }
  }
  async function imageCut(epoch: string, references: readonly DeliveryImageReference[], target: DeliveryTargetInput): Promise<{ references: DeliveryImageReference[]; fence(): void }> {
    const snapshot = copyImages(references)
    if (!snapshot.length) return { references: [], fence() {} }
    if (!ports.images) return fail('delivery_images_unavailable', 503)
    let resolved: Awaited<ReturnType<NonNullable<DeliveryPorts['images']>>>
    try { resolved = await ports.images({ epoch, references: snapshot.map(item => ({ ...item })), target: copyTarget(target) }) }
    catch (error) {
      if (error instanceof WorkspaceError && error.status === 503) throw error
      return fail('delivery_image_changed')
    }
    if (!plain(resolved) || !Array.isArray(resolved.references) || resolved.references.length !== snapshot.length || typeof resolved.fence !== 'function') return fail('delivery_image_changed')
    const canonical = freeze(resolved.references.map(item => ({ imageId: item?.imageId, digest: item?.digest, seq: item?.seq })))
    for (let index = 0; index < snapshot.length; index++) {
      const expected = snapshot[index]!, actual = canonical[index]
      if (!imageValid(actual) || actual.imageId !== expected.imageId || actual.digest !== expected.digest || actual.seq !== expected.seq) return fail('delivery_image_changed')
    }
    const fence = resolved.fence.bind(resolved)
    try { fence() } catch { return fail('delivery_image_changed') }
    return { references: canonical, fence }
  }
  function insert(input: DeliveryInput, binding: SessionTargetBinding, images: readonly DeliveryImageReference[]): DeliveryConfirmationRecord {
    const at = Date.now()
    const value: DeliveryConfirmationRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId,
      operation: input.operation, target: copyBinding(binding), digest: deliveryDigest(input), bodyBytes: Buffer.byteLength(input.text, 'utf8'),
      images: copyImages(images), seq: 1, at, updatedAt: at, state: 'prepared' }
    if (!recordValid(value)) return fail('delivery_confirmation_record_invalid', 503)
    store.repos.kv.insert({ k: requestKey(input.epoch, input.requestId), v: { version: 1, confirmationId: input.confirmationId } })
    store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(key(input.confirmationId), KIND, at, 'v1:1', encodeJson(value, false))
    return value
  }
  function confirmedForDispatch(input: DeliveryInput): DeliveryConfirmationRecord {
    const current = read(input.confirmationId)
    if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
    if (current.requestId !== input.requestId) return fail('delivery_request_conflict')
    if (current.operation !== input.operation || !sameTarget(current.target, input.target) || current.digest !== deliveryDigest(input)) return fail('delivery_confirmation_changed')
    if (current.state === 'canceled') return fail('delivery_confirmation_canceled')
    if (current.state !== 'confirmed') return fail('delivery_confirmation_not_confirmed')
    return current
  }
  /** Reconcile one fence: dispatching means the previous process died before a result was known. */
  async function reconcile(record: DeliveryDispatchRecord): Promise<DeliveryDispatchRecord> {
    if (record.state === 'dispatching') {
      try {
        record = store.transaction(() => {
          const current = readDispatch(record.confirmationId)
          if (!current) return fail('delivery_dispatch_record_invalid', 503)
          return current.state === 'dispatching' ? updateDispatch(current, 'dispatch_unknown', 'delivery_dispatch_unknown') : current
        })
      } catch (error) {
        if (error instanceof WorkspaceError) throw error
        return record
      }
    }
    if (record.state !== 'dispatch_unknown' || !ports.evidence) return record
    let evidence: DeliveryDispatchEvidence | undefined
    try { evidence = await ports.evidence(freeze(record)) } catch { return record }
    try { ports.requireEpoch(record.epoch) } catch { return record }
    if (!dispatchEvidenceValid(evidence) || evidence.dispatchId !== record.dispatchId || evidence.confirmationId !== record.confirmationId
      || evidence.sessionId !== record.target.sessionId || evidence.digest !== record.digest || evidence.messageId !== record.messageId) return record
    return store.transaction(() => {
      const current = readDispatch(record.confirmationId)!
      return current.state === 'dispatch_unknown' ? updateDispatch(current, 'accepted') : current
    })
  }
  return {
    async prepare(raw: DeliveryInput) {
      if (!validDeliveryInput(raw)) return fail('delivery_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const prior = existing(input)
        if (prior) return receipt(prior)
        const cut = await targetCut(input.target)
        ports.requireEpoch(input.epoch)
        const images = await imageCut(input.epoch, input.images, cut.binding)
        ports.requireEpoch(input.epoch)
        cut.fence(); images.fence()
        const record = store.transaction(() => {
          ports.requireEpoch(input.epoch)
          const replay = existing(input)
          if (replay) return replay
          return insert(input, cut.binding, images.references)
        })
        return receipt(record)
      })
    },
    async confirm(raw: DeliveryInput) {
      if (!validDeliveryInput(raw)) return fail('delivery_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const current = read(input.confirmationId)
        if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
        if (current.requestId !== input.requestId) return fail('delivery_request_conflict')
        if (current.digest !== deliveryDigest(input)) return fail('delivery_confirmation_changed')
        if (current.state === 'confirmed') return receipt(current)
        if (current.state === 'canceled') return fail('delivery_confirmation_canceled')
        const cut = await targetCut(input.target)
        ports.requireEpoch(input.epoch)
        const images = await imageCut(input.epoch, input.images, cut.binding)
        ports.requireEpoch(input.epoch)
        const record = store.transaction(() => {
          ports.requireEpoch(input.epoch)
          const latest = read(input.confirmationId)
          if (!latest) return fail('delivery_confirmation_not_found', 404)
          if (latest.state === 'confirmed') return latest
          if (latest.state === 'canceled') return fail('delivery_confirmation_canceled')
          if (latest.digest !== deliveryDigest(input) || latest.requestId !== input.requestId) return fail('delivery_request_conflict')
          try { cut.fence() } catch { return fail('delivery_target_changed') }
          try { images.fence() } catch { return fail('delivery_image_changed') }
          return update(latest, 'confirmed')
        })
        return receipt(record)
      })
    },
    /**
     * Dispatch the exact confirmed payload once. The caller must resend the full confirmed content;
     * the server never persists or rehydrates body text for replay.
     */
    async dispatch(raw: DeliveryInput) {
      if (!validDeliveryInput(raw)) return fail('delivery_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const confirmation = confirmedForDispatch(input)
        const prior = readDispatch(input.confirmationId)
        // A durable fence exists: report its honest state and never invoke the Host again.
        if (prior) {
          if (prior.epoch !== input.epoch || prior.requestId !== confirmation.requestId || prior.digest !== confirmation.digest
            || prior.operation !== confirmation.operation || !sameTarget(prior.target, confirmation.target)) return fail('delivery_dispatch_record_invalid', 503)
          return dispatchReceipt(await reconcile(prior), confirmation)
        }
        const cut = await targetCut(input.target)
        ports.requireEpoch(input.epoch)
        const images = await imageCut(input.epoch, input.images, cut.binding)
        ports.requireEpoch(input.epoch)
        let record: DeliveryDispatchRecord
        try {
          record = store.transaction(() => {
            ports.requireEpoch(input.epoch)
            const current = read(input.confirmationId)
            if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
            if (current.state !== 'confirmed' || current.requestId !== input.requestId || current.digest !== confirmation.digest) return fail('delivery_confirmation_changed')
            const replay = readDispatch(input.confirmationId)
            if (replay) return replay
            try { cut.fence() } catch { return fail('delivery_target_changed') }
            try { images.fence() } catch { return fail('delivery_image_changed') }
            const at = Date.now(), dispatchId = randomUUID()
            const value: DeliveryDispatchRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId,
              dispatchId, operation: input.operation, target: copyBinding(current.target), digest: current.digest, messageId: `go:${dispatchId}`,
              seq: 1, at, updatedAt: at, state: 'dispatching' }
            if (!dispatchRecordValid(value)) return fail('delivery_dispatch_record_invalid', 503)
            store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(dispatchKey(input.confirmationId), DISPATCH_KIND, at, 'v1:1', encodeJson(value, false))
            return value
          })
        } catch (error) {
          if (error instanceof WorkspaceError) throw error
          return fail('delivery_target_changed')
        }
        if (record.state !== 'dispatching') return dispatchReceipt(await reconcile(record), confirmation)
        if (!ports.dispatch) return dispatchReceipt(updateDispatch(record, 'blocked', 'delivery_adapter_unavailable'), confirmation)
        // No await between the persisted fence and the one Host control call.
        let decision: DeliveryDispatchDecision | undefined
        try { decision = await ports.dispatch(freeze(record), input.text) } catch { /* possibly accepted: reconcile only */ }
        const state: DeliveryDispatchTerminalState = decision?.state === 'accepted' ? 'accepted' : decision?.state === 'blocked' ? 'blocked' : 'dispatch_unknown'
        const code = state === 'blocked' ? (codeValid(decision?.code) ? decision!.code : 'delivery_dispatch_blocked')
          : state === 'dispatch_unknown' ? 'delivery_dispatch_unknown' : undefined
        const updated = store.transaction(() => {
          const current = readDispatch(input.confirmationId)
          if (!current) return fail('delivery_dispatch_record_invalid', 503)
          if (current.state !== 'dispatching') return current
          return updateDispatch(current, state, code)
        })
        return dispatchReceipt(updated, confirmation)
      })
    },
    /** Startup-only reconciliation: reads exact target evidence; never resends and never wakes a cold target. */
    async reconcile() {
      return serialize(async () => {
        const rows = store.db.prepare('SELECT key FROM side_effect WHERE kind=?').all(DISPATCH_KIND) as { key: string }[]
        let accepted = 0, unknown = 0, blocked = 0
        for (const row of rows) {
          const confirmationId = typeof row.key === 'string' && row.key.startsWith('delivery-dispatch:v1:') ? row.key.slice('delivery-dispatch:v1:'.length) : ''
          if (!uuid(confirmationId)) continue
          let record = readDispatch(confirmationId)
          if (!record || !['dispatching', 'dispatch_unknown'].includes(record.state)) { if (record?.state === 'accepted') accepted++; else if (record?.state === 'blocked') blocked++; continue }
          try { record = await reconcile(record) } catch { /* keep the durable unknown fence */ }
          if (record.state === 'accepted') accepted++; else if (record.state === 'dispatch_unknown') unknown++; else if (record.state === 'blocked') blocked++
        }
        return { accepted, unknown, blocked }
      })
    },
    async cancel(raw: { epoch: string; confirmationId: string }) {
      if (!plain(raw) || !only(raw, ['epoch', 'confirmationId']) || !id(raw.epoch) || !uuid(raw.confirmationId)) return fail('delivery_invalid', 400)
      const input = { epoch: raw.epoch, confirmationId: raw.confirmationId }
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const current = read(input.confirmationId)
        if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
        if (current.state === 'canceled') return receipt(current)
        if (current.state === 'confirmed') return fail('delivery_confirmation_confirmed')
        const record = store.transaction(() => {
          const latest = read(input.confirmationId)
          if (!latest) return fail('delivery_confirmation_not_found', 404)
          if (latest.state === 'canceled') return latest
          if (latest.state === 'confirmed') return fail('delivery_confirmation_confirmed')
          return update(latest, 'canceled')
        })
        return receipt(record)
      })
    },
    async status(raw: { epoch: string; confirmationId: string }) {
      if (!plain(raw) || !only(raw, ['epoch', 'confirmationId']) || !id(raw.epoch) || !uuid(raw.confirmationId)) return fail('delivery_invalid', 400)
      const input = { epoch: raw.epoch, confirmationId: raw.confirmationId }
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const record = read(input.confirmationId)
        if (!record || record.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
        return receipt(record)
      })
    },
  }
}
