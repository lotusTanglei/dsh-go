import { createHash, randomUUID } from 'node:crypto'
import { encodeJson, type Store } from '../store/index.js'
import { WorkspaceError } from './commands.js'
import { createImageBytes, IMAGE_MAX_BYTES } from './image-bytes.js'
import type { SessionTargetBinding } from './session-actions.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/
const plain = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)))
const only = (v: Record<string, any>, keys: string[]) => Object.keys(v).every(k => keys.includes(k)) && Object.getOwnPropertySymbols(v).length === 0
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const hashValid = (v: unknown): v is string => typeof v === 'string' && HASH.test(v)
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v) && !v.includes('://')
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const fail = (code: string, status = 409): never => { throw new WorkspaceError(code, status) }
export interface ImageReference { imageId: string; digest: string; seq: number }
interface ImageRecord {
  version: 1; epoch: string; imageId: string; uploadId: string; draftId: string; digest: string; mediaType: 'image/png'; width: number; height: number; size: number
  scopeRevision: string; state: 'staged' | 'bound' | 'released'; seq: number; at: number; target?: SessionTargetBinding
}
interface Lease { version: 1; leaseId: string; imageId: string; seq: number; digest: string; scopeRevision: string; target: SessionTargetBinding; purpose: 'understand' | 'target'; state: 'in-flight' | 'released' }
export interface ImagePorts {
  requireEpoch(epoch: string): void
  scope(): Promise<{ revision: string; fence(): void }>
  target(input: { sessionId: string; scopeRevision: string; factRevision: string }): Promise<{ binding: SessionTargetBinding; fence(): void }>
  /** Host capability plus exact disclosure/permission; missing is a visible block, never fallback. */
  authorize?(input: { epoch: string; reference: ImageReference; target: SessionTargetBinding; purpose: 'understand' | 'target' }): Promise<{ allowed: false; code: string } | { allowed: true; originalImage: true; provider: string; model: string; fence(): void }>
}
const prefix = 'go-image:v1:', leasePrefix = 'go-image-lease:v1:'
export function createWorkspaceImages(store: Store, root: string, ports: ImagePorts) {
  const bytes = createImageBytes(root)
  const put = (key: string, value: unknown) => { store.repos.kv.insertOrIgnore({ k: key, v: value }); store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(value, false), key) }
  const read = (imageId: string): ImageRecord => {
    if (!uuid(imageId)) return fail('image_reference_invalid', 400)
    const row = store.repos.kv.get(prefix + imageId)?.v
    if (!plain(row) || !only(row, ['version', 'epoch', 'imageId', 'uploadId', 'draftId', 'digest', 'mediaType', 'width', 'height', 'size', 'scopeRevision', 'state', 'seq', 'at', 'target']) || row.version !== 1 || row.imageId !== imageId || !uuid(row.uploadId) || !uuid(row.draftId) || !id(row.epoch) || !hashValid(row.digest) || !hashValid(row.scopeRevision) || row.mediaType !== 'image/png' || !['staged', 'bound', 'released'].includes(row.state) || !Number.isSafeInteger(row.seq) || row.seq < 1 || !Number.isSafeInteger(row.width) || !Number.isSafeInteger(row.height) || row.width < 1 || row.height < 1 || row.width * row.height > 8_000_000 || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > IMAGE_MAX_BYTES || !Number.isSafeInteger(row.at) || row.at < 0) return fail('image_record_invalid', 503)
    if (row.state === 'bound' && !targetValid(row.target) || row.target !== undefined && !targetValid(row.target)) return fail('image_record_invalid', 503)
    return row as ImageRecord
  }
  const dto = (row: ImageRecord) => ({ ...row, ...(row.target ? { target: { ...row.target, project: { ...row.target.project } } } : {}), original: true, uploadedNotSent: true })
  const reference = (input: unknown): input is ImageReference => plain(input) && only(input, ['imageId', 'digest', 'seq']) && uuid(input.imageId) && hashValid(input.digest) && Number.isSafeInteger(input.seq) && input.seq > 0
  const matching = (ref: ImageReference, epoch: string) => {
    const row = read(ref.imageId)
    if (row.epoch !== epoch || row.digest !== ref.digest || row.seq !== ref.seq || row.state === 'released') return fail('image_reference_changed')
    return row
  }
  const liveLeases = (imageId: string) => (store.db.prepare('SELECT k FROM kv WHERE substr(k,1,?)=?').all(leasePrefix.length, leasePrefix) as { k: string }[]).map(row => {
    const lease = store.repos.kv.get(row.k)?.v
    if (!plain(lease) || lease.version !== 1 || !uuid(lease.leaseId) || !uuid(lease.imageId) || !['in-flight', 'released'].includes(lease.state) || row.k !== leasePrefix + lease.leaseId || !hashValid(lease.digest) || !Number.isSafeInteger(lease.seq) || lease.seq < 1 || !hashValid(lease.scopeRevision) || !targetValid(lease.target) || !['understand', 'target'].includes(lease.purpose)) return fail('image_lease_invalid', 503)
    return lease as Lease
  }).filter(lease => lease.imageId === imageId && lease.state === 'in-flight')
  async function scopeCut() {
    const resolved = await ports.scope()
    if (!hashValid(resolved.revision) || typeof resolved.fence !== 'function') return fail('image_scope_changed')
    return Object.freeze({ revision: resolved.revision, fence: resolved.fence.bind(resolved) })
  }
  const snapshotTarget = (value: SessionTargetBinding) => Object.freeze({ sessionId: value.sessionId, scopeRevision: value.scopeRevision, factRevision: value.factRevision, project: Object.freeze({ kind: value.project.kind, key: value.project.key }) })
  const sameTarget = (a: SessionTargetBinding, b: SessionTargetBinding) => a.sessionId === b.sessionId && a.scopeRevision === b.scopeRevision && a.factRevision === b.factRevision && a.project.kind === b.project.kind && a.project.key === b.project.key
  async function targetCut(input: { sessionId: string; scopeRevision: string; factRevision: string }) {
    const requested = Object.freeze({ sessionId: input.sessionId, scopeRevision: input.scopeRevision, factRevision: input.factRevision })
    const resolved = await ports.target(requested)
    if (!targetValid(resolved.binding) || typeof resolved.fence !== 'function') return fail('image_target_changed')
    const binding = snapshotTarget(resolved.binding), fence = resolved.fence.bind(resolved)
    if (binding.sessionId !== requested.sessionId || binding.scopeRevision !== requested.scopeRevision || binding.factRevision !== requested.factRevision) return fail('image_target_changed')
    return Object.freeze({ binding, fence })
  }
  async function authorized(row: ImageRecord) {
    ports.requireEpoch(row.epoch)
    const scope = await scopeCut(); ports.requireEpoch(row.epoch); scope.fence()
    if (scope.revision !== row.scopeRevision) return fail('image_scope_changed')
    if (!row.target) return { fence() { ports.requireEpoch(row.epoch); scope.fence() } }
    const original = snapshotTarget(row.target), target = await targetCut(original)
    ports.requireEpoch(row.epoch); scope.fence(); target.fence()
    if (!sameTarget(target.binding, original)) return fail('image_target_changed')
    return { fence() { ports.requireEpoch(row.epoch); scope.fence(); target.fence() } }
  }
  return {
    async upload(input: { epoch: string; draftId: string; uploadId: string; digest: string; mediaType: string; encoded: string }) {
      if (!plain(input) || !only(input, ['epoch', 'draftId', 'uploadId', 'digest', 'mediaType', 'encoded']) || !id(input.epoch) || !uuid(input.draftId) || !uuid(input.uploadId) || !hashValid(input.digest) || input.mediaType !== 'image/png' || typeof input.encoded !== 'string' || input.encoded.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.encoded)) return fail('image_upload_invalid', 400)
      const snapshot = { ...input }, original = Buffer.from(snapshot.encoded, 'base64')
      if (createHash('sha256').update(original).digest('hex') !== snapshot.digest || original.toString('base64') !== snapshot.encoded) return fail('image_digest_mismatch', 400)
      ports.requireEpoch(snapshot.epoch)
      const scope = await scopeCut(); ports.requireEpoch(snapshot.epoch); scope.fence()
      const prior = store.repos.kv.get(prefix + snapshot.uploadId)
      if (prior) {
        const row = read(snapshot.uploadId)
        if (row.epoch !== snapshot.epoch || row.draftId !== snapshot.draftId || row.digest !== snapshot.digest || row.mediaType !== snapshot.mediaType || row.scopeRevision !== scope.revision || row.state === 'released') return fail('image_upload_conflict')
        return dto(row)
      }
      const existing = store.db.prepare('SELECT k FROM kv WHERE substr(k,1,?)=?').all(prefix.length, prefix) as { k: string }[]
      if (existing.length >= 2000 || existing.map(item => read(item.k.slice(prefix.length))).filter(row => row.epoch === snapshot.epoch && row.draftId === snapshot.draftId && row.state !== 'released').length >= 5) return fail('image_quota_exceeded', 429)
      const info = bytes.put(original, snapshot.mediaType); scope.fence(); ports.requireEpoch(snapshot.epoch)
      const row: ImageRecord = { version: 1, epoch: snapshot.epoch, imageId: snapshot.uploadId, uploadId: snapshot.uploadId, draftId: snapshot.draftId, ...info, scopeRevision: scope.revision, state: 'staged', seq: 1, at: Date.now() }
      store.transaction(() => { if (store.repos.kv.get(prefix + row.imageId)) return fail('image_upload_conflict'); put(prefix + row.imageId, row) })
      return dto(row)
    },
    async list(input: { epoch: string; draftId: string }) {
      if (!plain(input) || !only(input, ['epoch', 'draftId']) || !id(input.epoch) || !uuid(input.draftId)) return fail('image_reference_invalid', 400)
      ports.requireEpoch(input.epoch)
      const scope = await scopeCut(); scope.fence(); ports.requireEpoch(input.epoch)
      const rows = (store.db.prepare('SELECT k FROM kv WHERE substr(k,1,?)=?').all(prefix.length, prefix) as { k: string }[]).map(item => read(item.k.slice(prefix.length))).filter(row => row.epoch === input.epoch && row.draftId === input.draftId && row.state !== 'released')
      return { scopeRevision: scope.revision, items: rows.map(row => ({ ...dto(row), stale: row.scopeRevision !== scope.revision })), capability: { upload: 'png-8bit-noninterlaced', originalUnderstanding: false, targetDelivery: true, code: 'SA_IMAGE_UNDERSTANDING_UNVERIFIED' } }
    },
    async original(input: { epoch: string; reference: ImageReference }) {
      if (!plain(input) || !only(input, ['epoch', 'reference']) || !id(input.epoch) || !reference(input.reference)) return fail('image_reference_invalid', 400)
      input = structuredClone(input)
      const row = matching(input.reference, input.epoch), auth = await authorized(row)
      if (read(row.imageId).seq !== row.seq) return fail('image_reference_changed')
      const original = bytes.read(row.digest); auth.fence()
      return { bytes: original, mediaType: row.mediaType, digest: row.digest }
    },
    async bind(input: { epoch: string; reference: ImageReference; target: { sessionId: string; scopeRevision: string; factRevision: string } }) {
      if (!plain(input) || !only(input, ['epoch', 'reference', 'target']) || !id(input.epoch) || !reference(input.reference) || !requestedTarget(input.target)) return fail('image_reference_invalid', 400)
      input = structuredClone(input)
      const row = matching(input.reference, input.epoch), auth = await authorized(row)
      const resolved = await targetCut(input.target); ports.requireEpoch(input.epoch); auth.fence(); resolved.fence()
      if (!targetValid(resolved.binding) || resolved.binding.sessionId !== input.target.sessionId || resolved.binding.scopeRevision !== input.target.scopeRevision || resolved.binding.factRevision !== input.target.factRevision || resolved.binding.scopeRevision !== row.scopeRevision) return fail('image_target_changed')
      const target = { ...resolved.binding, project: { ...resolved.binding.project } }
      return store.transaction(() => {
        auth.fence(); resolved.fence(); const current = matching(input.reference, input.epoch)
        if (liveLeases(row.imageId).length) return fail('image_in_flight')
        const next: ImageRecord = { ...current, target, state: 'bound', seq: current.seq + 1 }; put(prefix + row.imageId, next); return dto(next)
      })
    },
    async release(input: { epoch: string; reference: ImageReference }) {
      if (!plain(input) || !only(input, ['epoch', 'reference']) || !id(input.epoch) || !reference(input.reference)) return fail('image_reference_invalid', 400)
      ports.requireEpoch(input.epoch)
      // Release may revoke a stale binding without granting any old content access.
      return store.transaction(() => {
        const row = matching(input.reference, input.epoch)
        if (liveLeases(row.imageId).length) return fail('image_in_flight')
        const next: ImageRecord = { ...row, state: 'released', seq: row.seq + 1 }; put(prefix + row.imageId, next)
        return { imageId: row.imageId, seq: next.seq, state: next.state, bytesRetained: true, thirdPartyErasureGuaranteed: false }
      })
    },
    /** Host-only exact reference check for a pre-delivery confirmation; no bytes and no binding change. */
    async verify(input: { epoch: string; references: readonly ImageReference[]; target: { sessionId: string; scopeRevision: string; factRevision: string } }) {
      if (!plain(input) || !only(input, ['epoch', 'references', 'target']) || !id(input.epoch) || !requestedTarget(input.target)
        || !Array.isArray(input.references) || input.references.length < 1 || input.references.length > 5
        || !input.references.every(reference) || new Set(input.references.map(value => value.imageId)).size !== input.references.length) return fail('image_reference_invalid', 400)
      const snapshot = structuredClone({ epoch: input.epoch, references: input.references as ImageReference[], target: { ...input.target } })
      ports.requireEpoch(snapshot.epoch)
      const scope = await scopeCut(); ports.requireEpoch(snapshot.epoch); scope.fence()
      const check = () => {
        ports.requireEpoch(snapshot.epoch)
        scope.fence()
        for (const reference of snapshot.references) {
          const row = read(reference.imageId)
          if (row.epoch !== snapshot.epoch || row.digest !== reference.digest || row.seq !== reference.seq || row.state !== 'bound' || !row.target
            || row.scopeRevision !== snapshot.target.scopeRevision || row.target.sessionId !== snapshot.target.sessionId
            || row.target.scopeRevision !== snapshot.target.scopeRevision || row.target.factRevision !== snapshot.target.factRevision) throw new WorkspaceError('image_reference_changed', 409)
        }
      }
      check()
      // The retained original must still hash to the confirmed digest before any delivery gate.
      for (const reference of snapshot.references) { const row = read(reference.imageId); ports.requireEpoch(snapshot.epoch); scope.fence(); bytes.read(row.digest) }
      return { references: snapshot.references.map(reference => ({ imageId: reference.imageId, digest: reference.digest, seq: reference.seq })), fence: check }
    },
    /** Host-internal delivery bytes for already bound references: exact digest-checked originals.
     * Never exposed as an HTTP action; the delivery adapter is the only caller and still rechecks.
     */
    async materialize(input: { epoch: string; references: readonly ImageReference[]; target: { sessionId: string; scopeRevision: string; factRevision: string } }) {
      if (!plain(input) || !only(input, ['epoch', 'references', 'target']) || !id(input.epoch) || !requestedTarget(input.target)
        || !Array.isArray(input.references) || input.references.length < 1 || input.references.length > 5
        || !input.references.every(reference) || new Set(input.references.map(value => value.imageId)).size !== input.references.length) return fail('image_reference_invalid', 400)
      const snapshot = structuredClone({ epoch: input.epoch, references: input.references as ImageReference[], target: { ...input.target } })
      ports.requireEpoch(snapshot.epoch)
      const scope = await scopeCut(); ports.requireEpoch(snapshot.epoch); scope.fence()
      const check = () => {
        ports.requireEpoch(snapshot.epoch)
        scope.fence()
        for (const reference of snapshot.references) {
          const row = read(reference.imageId)
          if (row.epoch !== snapshot.epoch || row.digest !== reference.digest || row.seq !== reference.seq || row.state !== 'bound' || !row.target
            || row.scopeRevision !== snapshot.target.scopeRevision || row.target.sessionId !== snapshot.target.sessionId
            || row.target.scopeRevision !== snapshot.target.scopeRevision || row.target.factRevision !== snapshot.target.factRevision) throw new WorkspaceError('image_reference_changed', 409)
        }
      }
      check()
      const originals = snapshot.references.map(reference => {
        ports.requireEpoch(snapshot.epoch); scope.fence()
        const row = read(reference.imageId), original = bytes.read(row.digest)
        if (createHash('sha256').update(original).digest('hex') !== reference.digest) throw new WorkspaceError('image_original_corrupt', 503)
        return { imageId: reference.imageId, digest: reference.digest, seq: reference.seq, mediaType: row.mediaType as 'image/png', bytes: original }
      })
      check()
      return { references: snapshot.references.map(reference => ({ imageId: reference.imageId, digest: reference.digest, seq: reference.seq })), originals, fence: check }
    },
    /** Host-internal byte lease; no HTTP caller may manufacture vision/authorization. */
    async acquire(input: { epoch: string; reference: ImageReference; purpose: 'understand' | 'target' }) {
      if (!plain(input) || !only(input, ['epoch', 'reference', 'purpose']) || !id(input.epoch) || !reference(input.reference) || !['understand', 'target'].includes(input.purpose)) return fail('image_reference_invalid', 400)
      input = structuredClone(input)
      const row = matching(input.reference, input.epoch), auth = await authorized(row)
      if (!row.target) return { state: 'blocked' as const, code: 'image_target_required' }
      if (!ports.authorize) return { state: 'blocked' as const, code: 'image_original_capability_unverified' }
      const target = snapshotTarget(row.target), raw = await ports.authorize(Object.freeze({ epoch: row.epoch, reference: Object.freeze({ imageId: row.imageId, digest: row.digest, seq: row.seq }), target, purpose: input.purpose }))
      if (!plain(raw)) return fail('image_authorization_invalid', 503)
      const decision = raw.allowed === true ? Object.freeze({ allowed: true as const, originalImage: raw.originalImage, provider: raw.provider, model: raw.model, fence: typeof raw.fence === 'function' ? raw.fence.bind(raw) : undefined })
        : Object.freeze({ allowed: false as const, code: raw?.allowed === false && typeof raw.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(raw.code) ? raw.code : 'image_original_capability_unverified' })
      ports.requireEpoch(input.epoch); auth.fence()
      if (!decision.allowed) return { state: 'blocked' as const, code: decision.code }
      if (decision.originalImage !== true || !id(decision.provider) || !id(decision.model) || typeof decision.fence !== 'function') return { state: 'blocked' as const, code: 'image_original_capability_unverified' }
      const permit = { provider: decision.provider, model: decision.model, fence: decision.fence }
      permit.fence()
      const original = bytes.read(row.digest)
      return store.transaction(() => {
        auth.fence(); permit.fence(); matching(input.reference, input.epoch)
        const lease: Lease = { version: 1, leaseId: randomUUID(), imageId: row.imageId, seq: row.seq, digest: row.digest, scopeRevision: row.scopeRevision, target: structuredClone(row.target!), purpose: input.purpose, state: 'in-flight' }
        put(leasePrefix + lease.leaseId, lease)
        return { state: 'leased' as const, leaseId: lease.leaseId, bytes: original, digest: row.digest, mediaType: row.mediaType, provider: permit.provider, model: permit.model }
      })
    },
    /** Host acknowledgment only. Unknown external outcomes retain their lease. */
    settle(leaseId: string, outcome: 'released' | 'unknown') {
      if (!uuid(leaseId) || !['released', 'unknown'].includes(outcome)) return fail('image_lease_invalid', 400)
      const raw = store.repos.kv.get(leasePrefix + leaseId)?.v
      if (!plain(raw) || !only(raw, ['version', 'leaseId', 'imageId', 'seq', 'digest', 'scopeRevision', 'target', 'purpose', 'state']) || raw.version !== 1 || raw.leaseId !== leaseId || !uuid(raw.imageId) || !hashValid(raw.digest) || !hashValid(raw.scopeRevision) || !Number.isSafeInteger(raw.seq) || raw.seq < 1 || !targetValid(raw.target) || !['understand', 'target'].includes(raw.purpose) || raw.state !== 'in-flight') return fail('image_lease_invalid')
      const value = raw as Lease
      if (outcome === 'released') put(leasePrefix + leaseId, { ...value, state: 'released' })
      return { leaseId, state: outcome === 'unknown' ? 'in-flight' : 'released' }
    },
  }
}
function requestedTarget(v: unknown): v is { sessionId: string; scopeRevision: string; factRevision: string } {
  return plain(v) && only(v, ['sessionId', 'scopeRevision', 'factRevision']) && id(v.sessionId) && hashValid(v.scopeRevision) && hashValid(v.factRevision)
}
function targetValid(v: unknown): v is SessionTargetBinding {
  return plain(v) && only(v, ['sessionId', 'scopeRevision', 'factRevision', 'project']) && id(v.sessionId) && hashValid(v.scopeRevision) && hashValid(v.factRevision)
    && plain(v.project) && only(v.project, ['kind', 'key']) && (v.project.kind === 'project' && id(v.project.key) || v.project.kind === 'unassigned' && v.project.key === 'unassigned')
}
