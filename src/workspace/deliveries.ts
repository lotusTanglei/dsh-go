import { createHash } from 'node:crypto'
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
export interface DeliveryPorts {
  requireEpoch(epoch: string): void
  /** Must read current authorized facts. A returned binding is not an execution grant. */
  target(input: DeliveryTargetInput): Promise<{ binding: SessionTargetBinding; fence(): void }>
  /** Host-only exact reference check for already bound images; no bytes, no new binding. */
  images?(input: { epoch: string; references: readonly DeliveryImageReference[]; target: DeliveryTargetInput }): Promise<{ references: readonly DeliveryImageReference[]; fence(): void }>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/, CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/
const ops: readonly DeliveryOperation[] = ['continue', 'supplement', 'steer']
const KIND = 'delivery-confirmation-v1'
const key = (id: string) => `delivery-confirmation:v1:${id}`
const requestKey = (epoch: string, requestId: string) => `delivery-request:v1:${hash([epoch, requestId])}`
const MAX_TEXT = 16_384, MAX_IMAGES = 5
const plain = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value: Record<string, any>, keys: string[]) => Object.keys(value).every(name => keys.includes(name)) && Object.getOwnPropertySymbols(value).length === 0
const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !value.includes('://')
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const digestValid = (value: unknown): value is string => typeof value === 'string' && HASH.test(value)
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
  return (value.code === undefined || typeof value.code === 'string' && CODE.test(value.code))
}
function receipt(record: DeliveryConfirmationRecord): DeliveryConfirmationReceipt {
  return freeze({ version: 1 as const, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId,
    operation: record.operation, target: copyBinding(record.target), digest: record.digest, bodyBytes: record.bodyBytes,
    images: copyImages(record.images), seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state,
    durable: true as const, humanConfirmed: record.state === 'confirmed', delivered: false as const, accepted: false as const,
    executed: false as const, completed: false as const,
    disposition: record.state === 'confirmed' ? 'confirmed-pending-delivery' as const : record.state === 'canceled' ? 'canceled' as const : 'not-confirmed' as const,
    ...(record.code ? { code: record.code } : {}) })
}
function metadata(record: DeliveryConfirmationRecord): DeliveryConfirmationRecord {
  // Strict allowlist contains no body text and no raw caller payload.
  return { version: 1, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId, operation: record.operation,
    target: copyBinding(record.target), digest: record.digest, bodyBytes: record.bodyBytes, images: copyImages(record.images),
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state, ...(record.code ? { code: record.code } : {}) }
}

/**
 * Human pre-delivery confirmation. A `prepared` record has no external effect; `confirmed` only
 * means the human accepted this exact target/content/images. Dispatch belongs to a later slice.
 * No Agent, Worker, message or Session API is reachable from this service.
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
  async function targetCut(requested: DeliveryTargetInput): Promise<{ binding: SessionTargetBinding; fence(): void }> {
    let resolved: Awaited<ReturnType<DeliveryPorts['target']>>
    try { resolved = await ports.target({ ...requested }) } catch { return fail('delivery_target_changed') }
    if (!plain(resolved) || !bindingValid(resolved.binding) || typeof resolved.fence !== 'function') return fail('delivery_target_changed')
    const binding = freeze(copyBinding(resolved.binding)), fence = resolved.fence.bind(resolved)
    if (binding.sessionId !== requested.sessionId || binding.scopeRevision !== requested.scopeRevision || binding.factRevision !== requested.factRevision) return fail('delivery_target_changed')
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
