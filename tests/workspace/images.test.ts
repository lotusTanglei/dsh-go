import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { encodeJson, openStore, type Store } from '../../src/store/index.js'
import { WorkspaceError } from '../../src/workspace/commands.js'
import { createWorkspaceImages, type ImagePorts, type ImageReference } from '../../src/workspace/images.js'
import type { SessionTargetBinding } from '../../src/workspace/session-actions.js'

const EPOCH = 'synthetic-image-epoch', SESSION = 'synthetic-image-target', OTHER = 'synthetic-other-target'
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const revision = (kind: string, generation: number) => sha(JSON.stringify([kind, generation]))
const imageKey = (imageId: string) => `go-image:v1:${imageId}`
const leaseKey = (leaseId: string) => `go-image-lease:v1:${leaseId}`
const cleanups: Array<() => void> = []
afterEach(() => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { cleanup() } catch (error) { errors.push(error) }
  }
  vi.restoreAllMocks()
  if (errors.length) throw new AggregateError(errors, 'image fixture cleanup failed')
})

// A real raster, not a screenshot/description/invalid historical 1px fixture.
// The ancillary text deliberately survives exact-byte reads and is never SQLite data.
function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4), crc = Buffer.alloc(4), payload = Buffer.concat([Buffer.from(type), data])
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(payload))
  return Buffer.concat([length, payload, crc])
}
function png(options: { color?: number; note?: string; filter?: number; interlace?: number; animated?: boolean; width?: number } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(options.width ?? 2, 0); ihdr.writeUInt32BE(2, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = options.interlace ?? 0
  const color = options.color ?? 29, filter = options.filter ?? 0
  const raster = Buffer.from([filter, color, 5, 211, 255, 88, 122, 7, 255, filter, 63, 244, 2, 255, 1, 3, 5, 255])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`Comment\0${options.note ?? 'IMAGE_PRIVATE_ORIGINAL_请勿变换_0123456789'.repeat(4)}`)),
    ...(options.animated ? [chunk('acTL', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]))] : []),
    chunk('IDAT', deflateSync(raster)), chunk('IEND', Buffer.alloc(0)),
  ])
}
function uploadInput(original = png(), patch: Partial<{ epoch: string; draftId: string; uploadId: string; digest: string; mediaType: string; encoded: string }> = {}) {
  return { epoch: EPOCH, draftId: randomUUID(), uploadId: randomUUID(), digest: sha(original), mediaType: 'image/png', encoded: original.toString('base64'), ...patch }
}
const ref = (row: ImageReference): ImageReference => ({ imageId: row.imageId, digest: row.digest, seq: row.seq })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function rejectsWorkspace(promise: Promise<unknown>, code: string, status = 409) {
  await expect(promise).rejects.toMatchObject({ code, status })
}

// No Host, profile, adapter, network or model. SQLite is genuinely on disk, never mocked.
function fixture(options: { authorize?: boolean } = {}) {
  const parent = realpathSync(tmpdir()), root = resolve(mkdtempSync(join(parent, 'workspace-images-test-')))
  const identity = lstatSync(root), dbPath = join(root, 'images.sqlite')
  let store: Store = openStore({ dbPath })
  cleanups.push(() => {
    try { store.close() } finally {
      const target = resolve(root), current = lstatSync(target)
      if (!isAbsolute(target) || target !== root || dirname(target) !== parent || realpathSync(target) !== root
        || !basename(target).startsWith('workspace-images-test-') || !current.isDirectory() || current.isSymbolicLink()
        || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe image fixture cleanup')
      // Exact absolute path plus original inode/device identity checked before deletion.
      rmSync(target, { recursive: true, force: true })
    }
  })
  const state = { epoch: EPOCH, scopeVersion: 0, excluded: false, targetVersion: 0, grantVersion: 0, denied: false }
  const counts = { epoch: 0, scope: 0, scopeFence: 0, target: 0, targetFence: 0, authorize: 0, authorizeFence: 0 }
  const scopeRevision = () => revision('scope', state.scopeVersion)
  const factRevision = () => revision('target-fact', state.targetVersion)
  const request = (sessionId = SESSION) => ({ sessionId, scopeRevision: scopeRevision(), factRevision: factRevision() })
  const binding = (sessionId = SESSION): SessionTargetBinding => ({ ...request(sessionId), project: { kind: 'project', key: 'synthetic-image-project' } })
  const ports: ImagePorts = {
    requireEpoch(epoch) { counts.epoch++; if (epoch !== state.epoch) throw new WorkspaceError('workspace_epoch_stale', 409) },
    async scope() {
      counts.scope++
      if (state.excluded) throw new WorkspaceError('image_scope_denied', 403)
      const version = state.scopeVersion, captured = scopeRevision()
      return { revision: captured, fence() {
        counts.scopeFence++
        if (state.excluded || state.scopeVersion !== version) throw new WorkspaceError('image_scope_denied', 403)
      } }
    },
    async target(input) {
      counts.target++
      const expected = request(input.sessionId), scopeVersion = state.scopeVersion, targetVersion = state.targetVersion
      if (![SESSION, OTHER].includes(input.sessionId) || state.excluded || input.scopeRevision !== expected.scopeRevision || input.factRevision !== expected.factRevision) throw new WorkspaceError('image_target_denied', 403)
      return { binding: binding(input.sessionId), fence() {
        counts.targetFence++
        if (state.excluded || state.scopeVersion !== scopeVersion || state.targetVersion !== targetVersion) throw new WorkspaceError('image_target_denied', 403)
      } }
    },
    ...(options.authorize === false ? {} : { async authorize(input: Parameters<NonNullable<ImagePorts['authorize']>>[0]) {
      counts.authorize++
      if (state.denied) return { allowed: false as const, code: 'synthetic_authorization_denied' }
      const version = state.grantVersion, expected = binding(input.target.sessionId)
      if (input.epoch !== EPOCH || !['understand', 'target'].includes(input.purpose) || JSON.stringify(input.target) !== JSON.stringify(expected)) throw new WorkspaceError('image_authorization_denied', 403)
      return { allowed: true as const, originalImage: true as const, provider: 'synthetic-provider', model: 'synthetic-original-vision', fence() {
        counts.authorizeFence++
        if (state.denied || state.grantVersion !== version) throw new WorkspaceError('image_authorization_denied', 403)
      } }
    } }),
  }
  let images = createWorkspaceImages(store, root, ports)
  return {
    root, dbPath, ports, state, counts, request, binding, scopeRevision,
    get store() { return store }, get images() { return images },
    reopen() { store.close(); store = openStore({ dbPath }); images = createWorkspaceImages(store, root, ports) },
    record(imageId: string) { return store.repos.kv.get(imageKey(imageId))?.v as Record<string, any> },
    lease(leaseId: string) { return store.repos.kv.get(leaseKey(leaseId))?.v as Record<string, any> },
    write(key: string, value: unknown) { store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(value, false), key) },
    leaseRows() { return store.db.prepare('SELECT k,v FROM kv WHERE substr(k,1,?)=?').all('go-image-lease:v1:'.length, 'go-image-lease:v1:') },
    async bound(original = png()) {
      const input = uploadInput(original), staged = await images.upload(input)
      const bound = await images.bind({ epoch: EPOCH, reference: ref(staged), target: request() })
      return { input, staged, bound, original }
    },
  }
}

describe('workspace images: real SQLite, exact PNG originals and revocable lifecycle', () => {
  it('uploads/list/previews without a target, preserves raw bytes outside SQLite and snapshots returned DTOs', async () => {
    const f = fixture(), original = png(), input = uploadInput(original), uploaded = await f.images.upload(input)
    expect(existsSync(f.dbPath)).toBe(true)
    expect(uploaded).toMatchObject({ imageId: input.uploadId, uploadId: input.uploadId, draftId: input.draftId, digest: sha(original), size: original.length,
      mediaType: 'image/png', width: 2, height: 2, state: 'staged', seq: 1, original: true, uploadedNotSent: true })
    expect(uploaded.target).toBeUndefined()
    expect((await f.images.upload(input)).seq).toBe(1)
    const listed = await f.images.list({ epoch: EPOCH, draftId: input.draftId })
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({ imageId: uploaded.imageId, stale: false, uploadedNotSent: true })
    expect(listed.capability).toMatchObject({ originalUnderstanding: false, targetDelivery: true, code: 'SA_IMAGE_UNDERSTANDING_UNVERIFIED' })
    const preview = await f.images.original({ epoch: EPOCH, reference: ref(uploaded) })
    expect(Buffer.isBuffer(preview.bytes)).toBe(true)
    expect(preview.bytes.equals(original)).toBe(true)
    expect(preview.digest).toBe(sha(preview.bytes))
    expect(f.counts.target).toBe(0); expect(f.counts.authorize).toBe(0)
    const blob = join(f.root, 'image-originals', `${uploaded.digest}.png`)
    expect(readFileSync(blob).equals(original)).toBe(true)
    expect(lstatSync(blob).mode & 0o077).toBe(0)
    expect(lstatSync(dirname(blob)).mode & 0o077).toBe(0)
    const metadata = JSON.stringify(f.store.db.prepare('SELECT * FROM kv').all())
    expect(metadata).not.toContain(input.encoded)
    expect(metadata).not.toContain('IMAGE_PRIVATE_ORIGINAL_')
    expect(f.record(uploaded.imageId)).not.toHaveProperty('encoded')
    expect(f.record(uploaded.imageId)).not.toHaveProperty('bytes')
    // Check physical SQLite/WAL/backups, not only the JSON view.
    f.store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
    for (const name of readdirSync(f.root).filter(name => name.startsWith('images.sqlite'))) {
      const file = join(f.root, name)
      if (!lstatSync(file).isFile()) continue
      const bytes = readFileSync(file)
      expect(bytes.includes(original)).toBe(false)
      expect(bytes.includes(Buffer.from(input.encoded))).toBe(false)
      expect(bytes.includes(Buffer.from('IMAGE_PRIVATE_ORIGINAL_'))).toBe(false)
    }
    uploaded.seq = 999; uploaded.digest = '0'.repeat(64)
    expect(f.record(input.uploadId)).toMatchObject({ seq: 1, digest: input.digest })
  })

  it('checks upload digest/media/real PNG and conflicts on same ID with different bytes or context', async () => {
    const f = fixture(), input = uploadInput(), uploaded = await f.images.upload(input)
    await rejectsWorkspace(f.images.upload({ ...input, digest: '0'.repeat(64) }), 'image_digest_mismatch', 400)
    await rejectsWorkspace(f.images.upload({ ...input, mediaType: 'image/jpeg' }), 'image_upload_invalid', 400)
    await rejectsWorkspace(f.images.upload({ ...input, encoded: `${input.encoded}\n` }), 'image_upload_invalid', 400)
    await rejectsWorkspace(f.images.upload(uploadInput(png({ color: 190 }), { draftId: input.draftId, uploadId: input.uploadId })), 'image_upload_conflict')
    await rejectsWorkspace(f.images.upload({ ...input, draftId: randomUUID() }), 'image_upload_conflict')
    const corrupt = png(); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1
    await rejectsWorkspace(f.images.upload(uploadInput(corrupt)), 'image_png_invalid', 400)
    const unsupported = Buffer.alloc(80, 0x42)
    await rejectsWorkspace(f.images.upload(uploadInput(unsupported)), 'image_format_unsupported', 400)
    expect(f.record(uploaded.imageId)).toMatchObject({ digest: input.digest, seq: 1 })
    expect((await f.images.original({ epoch: EPOCH, reference: ref(uploaded) })).bytes.equals(png())).toBe(true)
  })

  it.each([
    ['animation', { animated: true }, 'image_format_unsupported'],
    ['interlace', { interlace: 1 }, 'image_dimensions_unsupported'],
    ['oversized dimensions', { width: 8193 }, 'image_dimensions_unsupported'],
    ['invalid raster filter', { filter: 5 }, 'image_png_invalid'],
  ] as const)('rejects %s with valid CRC rather than relabeling/converting the source', async (_name, options, code) => {
    const f = fixture()
    await rejectsWorkspace(f.images.upload(uploadInput(png(options))), code, 400)
    expect(f.store.db.prepare('SELECT k FROM kv').all()).toHaveLength(0)
  })

  it('enforces five active images per draft and keeps quota/replay semantics after release', async () => {
    const f = fixture(), draftId = randomUUID(), inputs = Array.from({ length: 6 }, (_, color) => uploadInput(png({ color }), { draftId }))
    const rows = []
    for (const input of inputs.slice(0, 5)) rows.push(await f.images.upload(input))
    expect((await f.images.upload(inputs[0]!)).imageId).toBe(rows[0]!.imageId)
    await rejectsWorkspace(f.images.upload(inputs[5]!), 'image_quota_exceeded', 429)
    expect((await f.images.list({ epoch: EPOCH, draftId })).items).toHaveLength(5)
    await f.images.release({ epoch: EPOCH, reference: ref(rows[0]!) })
    await rejectsWorkspace(f.images.upload(inputs[0]!), 'image_upload_conflict')
    expect(await f.images.upload(inputs[5]!)).toMatchObject({ state: 'staged', seq: 1 })
    expect((await f.images.list({ epoch: EPOCH, draftId })).items).toHaveLength(5)
    expect(await f.images.upload(uploadInput())).toMatchObject({ state: 'staged' })
  })

  it('binds only fresh target facts, copies target metadata, and uses attachment seq CAS', async () => {
    const f = fixture(), input = uploadInput(), staged = await f.images.upload(input), oldTarget = f.request()
    f.state.targetVersion++
    await rejectsWorkspace(f.images.bind({ epoch: EPOCH, reference: ref(staged), target: oldTarget }), 'image_target_denied', 403)
    const bound = await f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() })
    expect(bound).toMatchObject({ state: 'bound', seq: 2, target: f.binding() })
    bound.target!.project.key = 'caller-poison'
    expect(f.record(bound.imageId).target.project.key).toBe('synthetic-image-project')
    await rejectsWorkspace(f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() }), 'image_reference_changed')
    await rejectsWorkspace(f.images.original({ epoch: EPOCH, reference: ref(staged) }), 'image_reference_changed')
    const rebound = await f.images.bind({ epoch: EPOCH, reference: ref(bound), target: f.request(OTHER) })
    expect(rebound).toMatchObject({ state: 'bound', seq: 3, target: { sessionId: OTHER } })
    await rejectsWorkspace(f.images.release({ epoch: EPOCH, reference: ref(bound) }), 'image_reference_changed')
  })

  it('seq-CAS lets only one of two concurrently resolved binds commit', async () => {
    const f = fixture(), staged = await f.images.upload(uploadInput()), originalTarget = f.ports.target
    const both = deferred(), finish = deferred(); let entered = 0
    f.ports.target = async input => {
      const result = await originalTarget(input)
      if (++entered === 2) both.resolve()
      await finish.promise
      return result
    }
    const results = Promise.allSettled([
      f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() }),
      f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request(OTHER) }),
    ])
    await both.promise; finish.resolve()
    const outcomes = await results
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'image_reference_changed', status: 409 })
    expect(f.record(staged.imageId).seq).toBe(2)
  })

  it.each(['staged', 'bound'] as const)('scope exclusion blocks %s read/bind/acquire and restore version++ never revives it', async kind => {
    const f = fixture(), input = uploadInput(), staged = await f.images.upload(input)
    const row = kind === 'bound' ? await f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() }) : staged
    f.state.excluded = true; f.state.scopeVersion++
    await rejectsWorkspace(f.images.original({ epoch: EPOCH, reference: ref(row) }), 'image_scope_denied', 403)
    await rejectsWorkspace(f.images.bind({ epoch: EPOCH, reference: ref(row), target: f.request() }), 'image_scope_denied', 403)
    await rejectsWorkspace(f.images.acquire({ epoch: EPOCH, reference: ref(row), purpose: 'target' }), 'image_scope_denied', 403)
    expect(f.counts.authorize).toBe(0)
    f.state.excluded = false; f.state.scopeVersion++
    const list = await f.images.list({ epoch: EPOCH, draftId: input.draftId })
    expect(list.items[0]).toMatchObject({ imageId: row.imageId, stale: true })
    await rejectsWorkspace(f.images.original({ epoch: EPOCH, reference: ref(row) }), 'image_scope_changed')
    await rejectsWorkspace(f.images.bind({ epoch: EPOCH, reference: ref(row), target: f.request() }), 'image_scope_changed')
    await rejectsWorkspace(f.images.acquire({ epoch: EPOCH, reference: ref(row), purpose: 'understand' }), 'image_scope_changed')
    expect(await f.images.release({ epoch: EPOCH, reference: ref(row) })).toMatchObject({ state: 'released', bytesRetained: true, thirdPartyErasureGuaranteed: false })
    const fresh = await f.images.upload(uploadInput(png({ color: 200 }), { draftId: input.draftId }))
    expect((await f.images.original({ epoch: EPOCH, reference: ref(fresh) })).bytes.equals(png({ color: 200 }))).toBe(true)
  })

  it.each(['upload', 'list', 'original'] as const)('an async scope revocation rejects late %s results', async method => {
    const f = fixture(), input = uploadInput(), staged = await f.images.upload(input), capturedScope = f.ports.scope
    const entered = deferred(), finish = deferred()
    f.ports.scope = async () => { const result = await capturedScope(); entered.resolve(); await finish.promise; return result }
    const operation = method === 'upload' ? f.images.upload(uploadInput()) : method === 'list' ? f.images.list({ epoch: EPOCH, draftId: input.draftId }) : f.images.original({ epoch: EPOCH, reference: ref(staged) })
    const assertion = rejectsWorkspace(operation, 'image_scope_denied', 403)
    await entered.promise; f.state.excluded = true; f.state.scopeVersion++; finish.resolve(); await assertion
    expect(f.leaseRows()).toHaveLength(0)
  })

  it.each(['original', 'bind', 'acquire'] as const)('a late target result cannot authorize %s after target revocation', async method => {
    const f = fixture(), { bound } = await f.bound(), capturedTarget = f.ports.target
    const entered = deferred(), finish = deferred()
    f.ports.target = async input => { const result = await capturedTarget(input); entered.resolve(); await finish.promise; return result }
    const operation = method === 'original' ? f.images.original({ epoch: EPOCH, reference: ref(bound) }) : method === 'bind' ? f.images.bind({ epoch: EPOCH, reference: ref(bound), target: f.request(OTHER) }) : f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })
    const assertion = rejectsWorkspace(operation, 'image_target_denied', 403)
    await entered.promise; f.state.targetVersion++; finish.resolve(); await assertion
    expect(f.record(bound.imageId).seq).toBe(2); expect(f.leaseRows()).toHaveLength(0)
  })

  it.each(['epoch', 'scope', 'target', 'release'] as const)('a newly resolved bind cannot commit after %s changed', async changed => {
    const f = fixture(), staged = await f.images.upload(uploadInput()), target = f.ports.target
    const entered = deferred(), finish = deferred()
    f.ports.target = async input => { const result = await target(input); entered.resolve(); await finish.promise; return result }
    const operation = f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() })
    const expected = changed === 'epoch' ? ['workspace_epoch_stale', 409] : changed === 'scope' ? ['image_scope_denied', 403] : changed === 'target' ? ['image_target_denied', 403] : ['image_reference_changed', 409]
    const assertion = rejectsWorkspace(operation, expected[0] as string, expected[1] as number)
    await entered.promise
    if (changed === 'epoch') f.state.epoch = 'replacement-epoch'
    if (changed === 'scope') f.state.scopeVersion++
    if (changed === 'target') f.state.targetVersion++
    if (changed === 'release') await f.images.release({ epoch: EPOCH, reference: ref(staged) })
    finish.resolve(); await assertion
    expect(f.record(staged.imageId).state).toBe(changed === 'release' ? 'released' : 'staged')
  })

  it.each(['epoch', 'scope', 'target', 'grant', 'release'] as const)('a late authorize decision cannot lease after %s changed', async changed => {
    const f = fixture(), { bound } = await f.bound(), authorize = f.ports.authorize!
    const entered = deferred(), finish = deferred()
    f.ports.authorize = async input => { const result = await authorize(input); entered.resolve(); await finish.promise; return result }
    const operation = f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'understand' })
    const expected = changed === 'epoch' ? ['workspace_epoch_stale', 409] : changed === 'scope' ? ['image_scope_denied', 403] : changed === 'target' ? ['image_target_denied', 403] : changed === 'grant' ? ['image_authorization_denied', 403] : ['image_reference_changed', 409]
    const assertion = rejectsWorkspace(operation, expected[0] as string, expected[1] as number)
    await entered.promise
    if (changed === 'epoch') f.state.epoch = 'replacement-epoch'
    if (changed === 'scope') f.state.scopeVersion++
    if (changed === 'target') f.state.targetVersion++
    if (changed === 'grant') f.state.grantVersion++
    if (changed === 'release') await f.images.release({ epoch: EPOCH, reference: ref(bound) })
    finish.resolve(); await assertion
    expect(f.leaseRows()).toHaveLength(0)
  })

  it('a release while original read awaits target validation blocks the late byte result', async () => {
    const f = fixture(), { bound } = await f.bound(), target = f.ports.target
    const entered = deferred(), finish = deferred()
    f.ports.target = async input => { const result = await target(input); entered.resolve(); await finish.promise; return result }
    const operation = f.images.original({ epoch: EPOCH, reference: ref(bound) })
    const assertion = rejectsWorkspace(operation, 'image_reference_changed')
    await entered.promise; await f.images.release({ epoch: EPOCH, reference: ref(bound) }); finish.resolve(); await assertion
  })

  it('no target/no capability is visibly blocked, not a lease or text-only success', async () => {
    const f = fixture({ authorize: false }), input = uploadInput(), staged = await f.images.upload(input)
    expect(await f.images.acquire({ epoch: EPOCH, reference: ref(staged), purpose: 'understand' })).toEqual({ state: 'blocked', code: 'image_target_required' })
    const bound = await f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() })
    for (const purpose of ['understand', 'target'] as const) {
      expect(await f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose })).toEqual({ state: 'blocked', code: 'image_original_capability_unverified' })
    }
    expect(f.leaseRows()).toHaveLength(0); expect(f.counts.authorize).toBe(0)
    expect((await f.images.original({ epoch: EPOCH, reference: ref(bound) })).bytes.equals(png())).toBe(true)
  })

  it.each(['understand', 'target'] as const)('synthetic %s receives the exact source bytes; unknown outcome retains in-flight ownership', async purpose => {
    const f = fixture(), { bound, original } = await f.bound(), authorize = f.ports.authorize!
    const authorizeCalls: unknown[] = []
    f.ports.authorize = async input => { authorizeCalls.push(structuredClone(input)); return authorize(input) }
    const leased = await f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose })
    expect(leased.state).toBe('leased')
    if (leased.state !== 'leased') throw new Error('exact original capability did not lease')
    // The sole synthetic consumer receives the lease bytes, never preview/OCR text.
    const received = Buffer.from(leased.bytes)
    expect(received.equals(original)).toBe(true); expect(sha(received)).toBe(bound.digest)
    expect(leased).toMatchObject({ digest: bound.digest, mediaType: 'image/png', provider: 'synthetic-provider', model: 'synthetic-original-vision' })
    expect(authorizeCalls).toEqual([{ epoch: EPOCH, reference: ref(bound), target: f.binding(), purpose }])
    expect(f.lease(leased.leaseId)).toMatchObject({ imageId: bound.imageId, digest: bound.digest, seq: bound.seq, scopeRevision: bound.scopeRevision, target: f.binding(), purpose, state: 'in-flight' })
    expect(f.lease(leased.leaseId)).not.toHaveProperty('bytes')
    await rejectsWorkspace(f.images.release({ epoch: EPOCH, reference: ref(bound) }), 'image_in_flight')
    await rejectsWorkspace(f.images.bind({ epoch: EPOCH, reference: ref(bound), target: f.request(OTHER) }), 'image_in_flight')
    expect(f.images.settle(leased.leaseId, 'unknown')).toEqual({ leaseId: leased.leaseId, state: 'in-flight' })
    await rejectsWorkspace(f.images.release({ epoch: EPOCH, reference: ref(bound) }), 'image_in_flight')
    expect(f.images.settle(leased.leaseId, 'released')).toEqual({ leaseId: leased.leaseId, state: 'released' })
    const released = await f.images.release({ epoch: EPOCH, reference: ref(bound) })
    expect(released).toMatchObject({ state: 'released', seq: 3, bytesRetained: true, thirdPartyErasureGuaranteed: false })
    await rejectsWorkspace(f.images.original({ epoch: EPOCH, reference: ref(bound) }), 'image_reference_changed')
    await rejectsWorkspace(f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose }), 'image_reference_changed')
    await rejectsWorkspace(f.images.original({ epoch: EPOCH, reference: { ...ref(bound), seq: released.seq } }), 'image_reference_changed')
    expect(readFileSync(join(f.root, 'image-originals', `${bound.digest}.png`)).equals(original)).toBe(true)
    expect(() => f.images.settle(leased.leaseId, 'released')).toThrow('image_lease_invalid')
  })

  it('a durable lease survives store/service restart, unknown settlement and blocks release until explicit settlement', async () => {
    const f = fixture(), { bound, original } = await f.bound(), leased = await f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })
    if (leased.state !== 'leased') throw new Error('expected synthetic lease')
    f.reopen()
    expect(f.lease(leased.leaseId)).toMatchObject({ state: 'in-flight', digest: sha(original) })
    await rejectsWorkspace(f.images.release({ epoch: EPOCH, reference: ref(bound) }), 'image_in_flight')
    f.images.settle(leased.leaseId, 'unknown'); f.reopen()
    await rejectsWorkspace(f.images.release({ epoch: EPOCH, reference: ref(bound) }), 'image_in_flight')
    f.images.settle(leased.leaseId, 'released'); f.reopen()
    expect(await f.images.release({ epoch: EPOCH, reference: ref(bound) })).toMatchObject({ state: 'released' })
    await rejectsWorkspace(f.images.original({ epoch: EPOCH, reference: ref(bound) }), 'image_reference_changed')
  })
})

describe('workspace images: adversarial callback and persisted-evidence boundaries', () => {
  it.each(['original', 'acquire'] as const)('does not let target callback mutate the stored target to authorize %s for a different session', async method => {
    const f = fixture(), { bound } = await f.bound()
    f.ports.target = async input => {
      // authorized() must not compare a mutable adapter-owned object to itself.
      // A frozen input is valid defense; still return the forged binding to test comparison.
      try { input.sessionId = OTHER } catch { /* strict-mode mutation of a frozen snapshot */ }
      return { binding: { ...f.binding(OTHER) }, fence() {} }
    }
    const operation = method === 'original' ? f.images.original({ epoch: EPOCH, reference: ref(bound) }) : f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })
    await rejectsWorkspace(operation, 'image_target_changed')
    expect(f.record(bound.imageId).target.sessionId).toBe(SESSION)
    expect(f.leaseRows()).toHaveLength(0)
  })

  it('does not let target callback mutate the caller bind target while it is pending', async () => {
    const f = fixture(), staged = await f.images.upload(uploadInput()), request = { epoch: EPOCH, reference: ref(staged), target: f.request() }
    f.ports.target = async () => {
      request.target.sessionId = OTHER
      return { binding: f.binding(OTHER), fence() {} }
    }
    await rejectsWorkspace(f.images.bind(request), 'image_target_changed')
    expect(f.record(staged.imageId)).toMatchObject({ state: 'staged', seq: 1 })
  })

  it('does not turn an understand request into a target-delivery lease via authorize callback mutation', async () => {
    const f = fixture(), { bound } = await f.bound(), authorize = f.ports.authorize!
    const request = { epoch: EPOCH, reference: ref(bound), purpose: 'understand' as 'understand' | 'target' }
    f.ports.authorize = async input => { const decision = await authorize(input); request.purpose = 'target'; return decision }
    const leased = await f.images.acquire(request)
    expect(leased.state).toBe('leased')
    if (leased.state !== 'leased') throw new Error('expected original authorized purpose lease')
    expect(f.lease(leased.leaseId).purpose).toBe('understand')
  })

  it.each([
    ['wrong session', (f: ReturnType<typeof fixture>) => f.binding(OTHER)],
    ['wrong scope', (f: ReturnType<typeof fixture>) => ({ ...f.binding(), scopeRevision: '0'.repeat(64) })],
    ['wrong fact', (f: ReturnType<typeof fixture>) => ({ ...f.binding(), factRevision: '0'.repeat(64) })],
    ['project traversal', (f: ReturnType<typeof fixture>) => ({ ...f.binding(), project: { kind: 'project', key: 'https://malicious.invalid' } })],
    ['extra authority', (f: ReturnType<typeof fixture>) => ({ ...f.binding(), trusted: true })],
  ] as const)('rejects target evidence with %s', async (_name, change) => {
    const f = fixture(), staged = await f.images.upload(uploadInput())
    f.ports.target = async () => ({ binding: change(f) as SessionTargetBinding, fence() {} })
    await rejectsWorkspace(f.images.bind({ epoch: EPOCH, reference: ref(staged), target: f.request() }), 'image_target_changed')
    expect(f.record(staged.imageId)).toMatchObject({ state: 'staged', seq: 1 })
  })

  it.each([
    ['non-original', { allowed: true, originalImage: false, provider: 'provider', model: 'model', fence() {} }],
    ['missing fence', { allowed: true, originalImage: true, provider: 'provider', model: 'model' }],
    ['provider URL', { allowed: true, originalImage: true, provider: 'https://malicious.invalid', model: 'model', fence() {} }],
    ['empty model', { allowed: true, originalImage: true, provider: 'provider', model: '', fence() {} }],
    ['truthy allowed', { allowed: 'yes', code: 'synthetic_denied', originalImage: true, provider: 'provider', model: 'model', fence() {} }],
    ['untrusted denial code', { allowed: false, code: 'data:image/png;base64,DO_NOT_LOG' }],
  ])('invalid authorize %s is a visible block with no lease', async (_name, decision) => {
    const f = fixture(), { bound } = await f.bound()
    f.ports.authorize = async () => decision as Awaited<ReturnType<NonNullable<ImagePorts['authorize']>>>
    const result = await f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })
    expect(result).toMatchObject({ state: 'blocked' })
    expect(result).not.toHaveProperty('bytes'); expect(result).not.toHaveProperty('leaseId')
    if (result.state === 'blocked') expect(result.code).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,95}$/)
    expect(f.leaseRows()).toHaveLength(0)
  })

  it('snapshots a denied grant before scope or target fences can mutate its decision', async () => {
    const f = fixture(), { bound } = await f.bound()
    const decision: any = { allowed: false, code: 'synthetic_denied' }, originalScope = f.ports.scope
    let mayMutate = false
    f.ports.scope = async () => {
      const cut = await originalScope()
      return { revision: cut.revision, fence() { cut.fence(); if (mayMutate) Object.assign(decision, { allowed: true, originalImage: true, provider: 'forged-provider', model: 'forged-model', fence() {} }) } }
    }
    f.ports.authorize = async () => { mayMutate = true; return decision }
    expect(await f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'understand' })).toEqual({ state: 'blocked', code: 'synthetic_denied' })
    expect(f.leaseRows()).toHaveLength(0)
  })
  it.each(['missing', 'throws'] as const)('invalid authorization %s fails closed and never persists lease/bytes', async mode => {
    const f = fixture(), { bound } = await f.bound()
    f.ports.authorize = async () => { if (mode === 'throws') throw new WorkspaceError('synthetic_authorization_unavailable', 503); return undefined as never }
    await expect(f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })).rejects.toBeDefined()
    expect(f.leaseRows()).toHaveLength(0)
  })

  it.each(['unknown field', 'missing target', 'digest mismatch'] as const)('corrupt image evidence (%s) is fail closed', async corruption => {
    const f = fixture(), { bound } = await f.bound(), record = structuredClone(f.record(bound.imageId))
    if (corruption === 'unknown field') record.originalBytes = 'forged'
    if (corruption === 'missing target') delete record.target
    if (corruption === 'digest mismatch') record.digest = '0'.repeat(64)
    f.write(imageKey(bound.imageId), record)
    await expect(f.images.original({ epoch: EPOCH, reference: ref(bound) })).rejects.toBeDefined()
    await expect(f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })).rejects.toBeDefined()
    expect(f.counts.authorize).toBe(0); expect(f.leaseRows()).toHaveLength(0)
  })

  it('a malformed durable lease cannot be settled as released to erase uncertainty', async () => {
    const f = fixture(), { bound } = await f.bound(), leased = await f.images.acquire({ epoch: EPOCH, reference: ref(bound), purpose: 'target' })
    if (leased.state !== 'leased') throw new Error('expected synthetic lease')
    const evidence = structuredClone(f.lease(leased.leaseId)); evidence.purpose = 'description-only'
    f.write(leaseKey(leased.leaseId), evidence)
    expect(() => f.images.settle(leased.leaseId, 'released')).toThrow('image_lease_invalid')
    expect(f.lease(leased.leaseId).state).toBe('in-flight')
    await rejectsWorkspace(f.images.release({ epoch: EPOCH, reference: ref(bound) }), 'image_lease_invalid', 503)
  })
})
