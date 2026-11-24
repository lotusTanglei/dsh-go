import { afterEach, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { encodeJson, openStore, type Store } from '../../src/store/index.js'
import { WorkspaceError } from '../../src/workspace/commands.js'
import { createDeliveries, deliveryDigest, validDeliveryInput, type DeliveryDispatchEvidence, type DeliveryDispatchRecord, type DeliveryImageReference, type DeliveryInput, type DeliveryPorts } from '../../src/workspace/deliveries.js'
import type { SessionTargetBinding } from '../../src/workspace/session-actions.js'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const EPOCH = 'delivery-synthetic-epoch'
const SESSION = 'session-delivery-target'
const PROJECT = { kind: 'project' as const, key: 'project-delivery' }
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function database() {
  const root = realpathSync(tmpdir())
  const dir = resolve(mkdtempSync(join(root, 'delivery-service-test-')))
  const identity = lstatSync(dir), dbPath = join(dir, 'state.sqlite')
  let store: Store = openStore({ dbPath })
  cleanups.push(() => {
    try { store.close() } finally {
      const target = resolve(dir), current = lstatSync(target)
      if (!isAbsolute(target) || target !== dir || dirname(target) !== root || realpathSync(target) !== dir
        || !basename(target).startsWith('delivery-service-test-')
        || !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe delivery fixture cleanup')
      rmSync(target, { recursive: true, force: true })
    }
  })
  return { dbPath, get store() { return store }, reopen() { store.close(); store = openStore({ dbPath }); return store } }
}

interface ImageRow extends DeliveryImageReference { epoch: string; state: 'staged' | 'bound' | 'released'; target?: SessionTargetBinding }

function fixture(options: { images?: boolean; dispatch?: boolean } = {}) {
  const db = database()
  const state = {
    epoch: EPOCH,
    generation: 0,
    binding: { sessionId: SESSION, scopeRevision: digest(['scope', 0]), factRevision: digest(['fact', 0]), project: { ...PROJECT } } as SessionTargetBinding,
    denied: false,
    failFenceOnce: false,
    images: new Map<string, ImageRow>(),
    counts: { target: 0, image: 0, fence: 0, dispatch: 0 },
    calls: [] as Array<{ record: DeliveryDispatchRecord; text: string; fencePersisted: boolean }>,
    decision: { state: 'accepted', code: undefined } as { state: 'accepted' | 'interrupted' | 'dispatch_unknown' | 'blocked'; code?: string; stopEvidence?: 'turn-aborted' | 'cancel-accepted' },
    throwDispatch: false,
    evidence: undefined as undefined | ((record: DeliveryDispatchRecord) => DeliveryDispatchEvidence | undefined),
  }
  const ports: DeliveryPorts = {
    requireEpoch(epoch) { if (epoch !== state.epoch) throw new WorkspaceError('workspace_epoch_stale', 409) },
    async target(requested) {
      state.counts.target++
      if (state.denied) throw new WorkspaceError('session_action_target_changed', 409)
      const binding = state.binding, generation = state.generation
      return {
        binding: { ...binding, project: { ...binding.project } },
        fence() { state.counts.fence++; if (state.failFenceOnce) { state.failFenceOnce = false; throw new WorkspaceError('session_action_target_changed', 409) } if (generation !== state.generation) throw new WorkspaceError('session_action_target_changed', 409) },
      }
    },
    ...(options.images === false ? {} : {
      async images(input: { epoch: string; references: readonly DeliveryImageReference[]; target: DeliveryInput['target'] }) {
        state.counts.image++
        const references = input.references.map(reference => {
          const row = state.images.get(reference.imageId)
          if (!row || row.epoch !== input.epoch || row.digest !== reference.digest || row.seq !== reference.seq || row.state !== 'bound' || !row.target
            || row.target.sessionId !== input.target.sessionId || row.target.scopeRevision !== input.target.scopeRevision || row.target.factRevision !== input.target.factRevision) throw new WorkspaceError('image_reference_changed', 409)
          return { imageId: row.imageId, digest: row.digest, seq: row.seq }
        })
        return { references, fence() { for (const reference of references) { const row = state.images.get(reference.imageId); if (!row || row.state !== 'bound' || row.digest !== reference.digest || row.seq !== reference.seq) throw new WorkspaceError('image_reference_changed', 409) } } }
      },
    }),
    ...(options.dispatch === false ? {} : {
      async dispatch(record: Readonly<DeliveryDispatchRecord>, text: string) {
        state.counts.dispatch++
        const persisted: any = db.store.repos.side_effect.get(`delivery-dispatch:v1:${record.confirmationId}`)
        state.calls.push({ record: { ...record, target: { ...record.target, project: { ...record.target.project } } } as DeliveryDispatchRecord, text, fencePersisted: persisted?.state === `v1:${record.seq}` })
        if (state.throwDispatch) throw new Error('Host call outcome lost')
        return { state: state.decision.state, ...(state.decision.code === undefined ? {} : { code: state.decision.code }), ...(state.decision.stopEvidence === undefined ? {} : { stopEvidence: state.decision.stopEvidence }) }
      },
      async evidence(record: Readonly<DeliveryDispatchRecord>) { return state.evidence?.(record as DeliveryDispatchRecord) as DeliveryDispatchEvidence | undefined },
    }),
  }
  let service = createDeliveries(db.store, ports)
  return {
    db, state, ports,
    get service() { return service },
    reopen() { db.reopen(); service = createDeliveries(db.store, ports); return service },
    bindImage(overrides: Partial<ImageRow> = {}) {
      const image: ImageRow = { imageId: overrides.imageId ?? randomUUID(), digest: overrides.digest ?? digest(['image', randomUUID()]), seq: overrides.seq ?? 1, epoch: overrides.epoch ?? state.epoch,
        state: overrides.state ?? 'bound', target: overrides.target ?? { ...state.binding, project: { ...state.binding.project } } }
      state.images.set(image.imageId, image)
      return image
    },
    input(patch: Partial<DeliveryInput> = {}): DeliveryInput {
      return { epoch: state.epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'continue', text: 'Continue this exact work\n保留原字节 🧭',
        target: { sessionId: state.binding.sessionId, scopeRevision: state.binding.scopeRevision, factRevision: state.binding.factRevision }, images: [], ...patch }
    },
    /** Simulate a process that persisted its dispatch fence and died before a result was stored. */
    staleDispatch(input: DeliveryInput, mode: 'dispatching' | 'dispatch_unknown') {
      const dispatchId = randomUUID(), at = Date.now(), seq = mode === 'dispatching' ? 1 : 2
      const record: DeliveryDispatchRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId, dispatchId,
        operation: input.operation, target: { sessionId: input.target.sessionId, scopeRevision: input.target.scopeRevision, factRevision: input.target.factRevision, project: { ...PROJECT } },
        digest: deliveryDigest(input), messageId: `go:${dispatchId}`, seq, at, updatedAt: at, state: mode, ...(mode === 'dispatch_unknown' ? { code: 'delivery_dispatch_unknown' } : {}) }
      db.store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(`delivery-dispatch:v1:${input.confirmationId}`, 'delivery-dispatch-v1', at, `v1:${seq}`, encodeJson(record, false))
      return record
    },
    dispatchRows() { return db.store.repos.side_effect.all().filter(row => row.kind === 'delivery-dispatch-v1') },
  }
}
const imageRef = (image: ImageRow): DeliveryImageReference => ({ imageId: image.imageId, digest: image.digest, seq: image.seq })
async function rejectsWith(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toMatchObject({ code, status })
}

describe('pre-delivery confirmation: prepared is not delivered', () => {
  it('prepares exact content metadata with no body persistence', async () => {
    const f = fixture(), input = f.input({ text: 'PRIVATE EXACT BODY — 保留换行\nsecond line' })
    const receipt = await f.service.prepare(input)
    expect(receipt).toEqual({
      version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId, operation: 'continue',
      target: { ...f.state.binding, project: { ...PROJECT } }, digest: deliveryDigest(input), bodyBytes: Buffer.byteLength(input.text, 'utf8'), images: [],
      seq: 1, at: expect.any(Number), updatedAt: expect.any(Number), state: 'prepared',
      durable: true, humanConfirmed: false, delivered: false, accepted: false, executed: false, completed: false, disposition: 'not-confirmed',
    })
    expect(Object.keys(f.service).sort()).toEqual(['cancel', 'confirm', 'dispatch', 'prepare', 'reconcile', 'status'])
    const rows = f.db.store.repos.side_effect.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'delivery-confirmation-v1', state: 'v1:1' })
    expect(JSON.stringify(rows[0])).not.toContain('PRIVATE EXACT BODY')
    expect(await f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId })).toEqual(receipt)
    expect(f.state.counts.target).toBe(1)
    expect(f.state.counts.fence).toBeGreaterThan(0)
  })

  it('confirms the exact payload once and returns the identical durable receipt without delivery claims', async () => {
    const f = fixture(), image = f.bindImage(), input = f.input({ operation: 'supplement', images: [imageRef(image)] })
    const prepared = await f.service.prepare(input)
    expect(prepared.state).toBe('prepared')
    const confirmed = await f.service.confirm(input)
    expect(confirmed).toEqual({ ...prepared, state: 'confirmed', seq: 2, updatedAt: expect.any(Number), humanConfirmed: true, disposition: 'confirmed-pending-delivery' })
    expect(confirmed.delivered).toBe(false); expect(confirmed.accepted).toBe(false); expect(confirmed.executed).toBe(false); expect(confirmed.completed).toBe(false)
    expect(await f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId })).toEqual(confirmed)
    expect(await f.service.confirm(input)).toEqual(confirmed)
    expect(f.db.store.repos.side_effect.get(`delivery-confirmation:v1:${input.confirmationId}`)!.state).toBe('v1:2')
    expect(f.state.counts.target).toBe(2); expect(f.state.counts.image).toBe(2)
  })

  it('treats cancellation as terminal for an unconfirmed object', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input)
    const canceled = await f.service.cancel({ epoch: input.epoch, confirmationId: input.confirmationId })
    expect(canceled).toMatchObject({ state: 'canceled', seq: 2, humanConfirmed: false, delivered: false, accepted: false, disposition: 'canceled' })
    expect(await f.service.cancel({ epoch: input.epoch, confirmationId: input.confirmationId })).toEqual(canceled)
    await rejectsWith(f.service.confirm(input), 'delivery_confirmation_canceled', 409)
  })

  it('refuses to cancel a human-confirmed object and reports unknown ids honestly', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input); await f.service.confirm(input)
    await rejectsWith(f.service.cancel({ epoch: input.epoch, confirmationId: input.confirmationId }), 'delivery_confirmation_confirmed', 409)
    await rejectsWith(f.service.status({ epoch: input.epoch, confirmationId: randomUUID() }), 'delivery_confirmation_not_found', 404)
    await rejectsWith(f.service.cancel({ epoch: input.epoch, confirmationId: randomUUID() }), 'delivery_confirmation_not_found', 404)
  })
})

describe('binding invalidation: any target/content/image change requires a fresh confirmation', () => {
  it('rejects confirm after the exact target facts changed and stays inert', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input)
    f.state.binding = { ...f.state.binding, factRevision: digest(['fact', 1]) }
    await rejectsWith(f.service.confirm(input), 'delivery_target_changed', 409)
    expect((await f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId })).state).toBe('prepared')
    const next = f.input()
    await f.service.prepare(next)
    expect((await f.service.confirm(next)).state).toBe('confirmed')
    expect(f.db.store.repos.side_effect.all().filter(row => row.state === 'v1:2')).toHaveLength(1)
  })

  it('rejects confirm when the body, operation or target binding changed', async () => {
    const f = fixture(), input = f.input({ text: 'original exact body' })
    const prepared = await f.service.prepare(input)
    await rejectsWith(f.service.confirm({ ...input, text: 'edited body' }), 'delivery_confirmation_changed', 409)
    await rejectsWith(f.service.confirm({ ...input, operation: 'steer' }), 'delivery_confirmation_changed', 409)
    await rejectsWith(f.service.confirm({ ...input, target: { ...input.target, sessionId: 'other-session' } }), 'delivery_confirmation_changed', 409)
    expect(await f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId })).toEqual(prepared)
  })

  it('binds bound images and rejects a released or changed image', async () => {
    const f = fixture(), image = f.bindImage(), input = f.input({ images: [imageRef(image)] })
    const prepared = await f.service.prepare(input)
    expect(prepared.images).toEqual([imageRef(image)])
    image.state = 'released'
    await rejectsWith(f.service.confirm(input), 'delivery_image_changed', 409)
    expect((await f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId })).state).toBe('prepared')
    image.state = 'bound'
    const extra = f.bindImage()
    await rejectsWith(f.service.confirm({ ...input, images: [imageRef(image), imageRef(extra)] }), 'delivery_confirmation_changed', 409)
    const changed = f.input({ images: [imageRef(image), imageRef(extra)] })
    await f.service.prepare(changed)
    expect((await f.service.confirm(changed)).state).toBe('confirmed')
  })

  it('fails closed when target resolution is denied or a resolved target fence is superseded', async () => {
    const f = fixture()
    f.state.denied = true
    await rejectsWith(f.service.prepare(f.input()), 'delivery_target_changed', 409)
    expect(f.db.store.repos.side_effect.all()).toEqual([])
    f.state.denied = false; f.state.failFenceOnce = true
    await rejectsWith(f.service.prepare(f.input()), 'delivery_target_changed', 409)
    expect(f.db.store.repos.side_effect.all()).toEqual([])
    expect((await f.service.prepare(f.input())).state).toBe('prepared')
    expect(f.db.store.repos.ticket.all()).toEqual([]); expect(f.db.store.repos.trigger.all()).toEqual([]); expect(f.db.store.repos.assignment.all()).toEqual([])
  })

  it('reports unavailable when image references exist but the Host has no exact image check', async () => {
    const f = fixture({ images: false }), image = f.bindImage(), input = f.input({ images: [imageRef(image)] })
    await rejectsWith(f.service.prepare(input), 'delivery_images_unavailable', 503)
    expect(f.db.store.repos.side_effect.all()).toEqual([])
  })
})

describe('idempotency, epoch and persistence', () => {
  it('keeps same request/confirmation content idempotent and rejects changed content or reused ids', async () => {
    const f = fixture(), input = f.input()
    const first = await f.service.prepare(input)
    expect(await f.service.prepare(input)).toEqual(first)
    expect(f.db.store.repos.side_effect.all()).toHaveLength(1)
    await rejectsWith(f.service.prepare({ ...input, text: 'different body' }), 'delivery_request_conflict', 409)
    await rejectsWith(f.service.prepare({ ...input, confirmationId: randomUUID() }), 'delivery_request_conflict', 409)
    await rejectsWith(f.service.prepare({ ...f.input(), confirmationId: input.confirmationId }), 'delivery_request_conflict', 409)
    expect(f.db.store.repos.side_effect.all()).toHaveLength(1)
  })

  it('rejects a stale epoch for prepare, confirm, cancel and status', async () => {
    const f = fixture(), input = f.input()
    const prepared = await f.service.prepare(input)
    f.state.epoch = 'delivery-next-epoch'
    await rejectsWith(f.service.prepare({ ...f.input(), epoch: input.epoch }), 'workspace_epoch_stale', 409)
    await rejectsWith(f.service.confirm(input), 'workspace_epoch_stale', 409)
    await rejectsWith(f.service.cancel({ epoch: input.epoch, confirmationId: input.confirmationId }), 'workspace_epoch_stale', 409)
    await rejectsWith(f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId }), 'workspace_epoch_stale', 409)
    expect(prepared.state).toBe('prepared')
  })

  it('retains confirmed evidence and exact idempotency across a real SQLite reopen', async () => {
    const f = fixture(), input = f.input({ text: 'durable exact body' })
    await f.service.prepare(input)
    const confirmed = await f.service.confirm(input)
    f.reopen()
    expect(await f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId })).toEqual(confirmed)
    expect(await f.service.confirm(input)).toEqual(confirmed)
    expect(await f.service.prepare(input)).toEqual(confirmed)
    expect(JSON.stringify(f.db.store.repos.side_effect.all())).not.toContain('durable exact body')
  })

  it('fails closed on corrupted records or orphaned request pointers instead of replaying', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input)
    f.db.store.db.prepare('UPDATE kv SET v = ? WHERE k = ?').run(JSON.stringify({ schemaVersion: 1, value: { version: 1, confirmationId: randomUUID() } }), `delivery-request:v1:${digest([input.epoch, input.requestId])}`)
    await rejectsWith(f.service.status({ epoch: input.epoch, confirmationId: input.confirmationId }), 'delivery_confirmation_record_invalid', 503)
    const second = f.input()
    await f.service.prepare(second)
    const row = f.db.store.repos.side_effect.get(`delivery-confirmation:v1:${second.confirmationId}`)!
    f.db.store.db.prepare('UPDATE side_effect SET detail = ? WHERE key = ?').run(JSON.stringify({ schemaVersion: 1, value: { ...(row.detail as Record<string, unknown>), state: 'confirmed' } }), `delivery-confirmation:v1:${second.confirmationId}`)
    await rejectsWith(f.service.status({ epoch: second.epoch, confirmationId: second.confirmationId }), 'delivery_confirmation_record_invalid', 503)
  })
})

describe('input shape gates', () => {
  it('rejects malformed bodies before any persistence or port call', async () => {
    const f = fixture(), base = f.input(), imageId = randomUUID()
    const invalid: unknown[] = [null, {}, [], 'delivery', { ...base, extra: true }, { ...base, requestId: 'not-a-uuid' }, { ...base, confirmationId: 'not-a-uuid' },
      { ...base, operation: 'resume' }, { ...base, text: '' }, { ...base, text: 'x\0y' }, { ...base, text: 'x'.repeat(16_385) },
      { ...base, target: { ...base.target, sessionId: 'https://evil' } }, { ...base, target: { ...base.target, scopeRevision: 'bad' } },
      { ...base, images: [{ imageId: 'bad', digest: digest(['x']), seq: 1 }] },
      { ...base, images: Array.from({ length: 6 }, () => ({ imageId: randomUUID(), digest: digest(['x']), seq: 1 })) },
      { ...base, images: [{ imageId, digest: digest(['x']), seq: 1 }, { imageId, digest: digest(['x']), seq: 2 }] }]
    for (const value of invalid) {
      expect(validDeliveryInput(value), JSON.stringify(value)).toBe(false)
      await rejectsWith(f.service.prepare(value as DeliveryInput), 'delivery_invalid', 400)
    }
    expect(f.db.store.repos.side_effect.all()).toEqual([])
    expect(f.state.counts).toEqual({ target: 0, image: 0, fence: 0, dispatch: 0 })
  })

  it('exposes only the exact confirmation/dispatch service surface, with no Agent or body export', async () => {
    const f = fixture()
    expect(Object.keys(f.ports).sort()).toEqual(['dispatch', 'evidence', 'images', 'requireEpoch', 'target'])
    expect(Object.keys(f.service).sort()).toEqual(['cancel', 'confirm', 'dispatch', 'prepare', 'reconcile', 'status'])
  })
})


describe('dispatch: one durable control call for the exact confirmed payload', () => {
  it.each(['continue', 'supplement', 'steer'] as const)('calls the Host adapter once for %s and reports accepted without completion', async operation => {
    const f = fixture(), input = f.input({ operation, text: `  exact ${operation} body\r\n保留原字节 🧭  ` })
    await f.service.prepare(input); await f.service.confirm(input)
    const receipt = await f.service.dispatch(input)
    expect(f.state.calls).toHaveLength(1)
    expect(f.state.calls[0]).toMatchObject({ text: input.text, fencePersisted: true, record: { operation, digest: deliveryDigest(input), state: 'dispatching', seq: 1,
      target: { sessionId: SESSION, scopeRevision: input.target.scopeRevision, factRevision: input.target.factRevision, project: { ...PROJECT } } } })
    expect(receipt).toMatchObject({ version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId, operation,
      digest: deliveryDigest(input), bodyBytes: Buffer.byteLength(input.text, 'utf8'), images: [], state: 'accepted', durable: true, humanConfirmed: true,
      delivered: true, accepted: true, executed: null, completed: null, disposition: 'target-durable-receipt', seq: 2 })
    expect(receipt.messageId).toBe(`go:${receipt.dispatchId}`)
    // Same request/content replays the stored receipt; the Host is never called twice.
    expect(await f.service.dispatch(input)).toEqual(receipt)
    expect(f.state.calls).toHaveLength(1)
    expect(f.dispatchRows()).toHaveLength(1)
    // Neither the confirmation nor the dispatch fence may contain the raw body.
    expect(JSON.stringify(f.db.store.repos.side_effect.all())).not.toContain('exact continue body')
    expect(JSON.stringify(f.db.store.repos.side_effect.all())).not.toContain('保留原字节')
  })

  it('rejects unconfirmed, changed, canceled, forged, replayed and cross-epoch dispatches without any Host call', async () => {
    const f = fixture(), input = f.input({ text: 'Original exact body' })
    await rejectsWith(f.service.dispatch(input), 'delivery_confirmation_not_found', 404)
    await f.service.prepare(input)
    await rejectsWith(f.service.dispatch(input), 'delivery_confirmation_not_confirmed', 409)
    await f.service.confirm(input)
    await rejectsWith(f.service.dispatch({ ...input, text: 'Edited body' }), 'delivery_confirmation_changed', 409)
    await rejectsWith(f.service.dispatch({ ...input, operation: 'steer' }), 'delivery_confirmation_changed', 409)
    await rejectsWith(f.service.dispatch({ ...input, target: { ...input.target, sessionId: 'other-session' } }), 'delivery_confirmation_changed', 409)
    await rejectsWith(f.service.dispatch({ ...input, requestId: randomUUID() }), 'delivery_request_conflict', 409)
    await rejectsWith(f.service.dispatch({ ...input, confirmationId: randomUUID() }), 'delivery_confirmation_not_found', 404)
    await rejectsWith(f.service.dispatch({ ...input, extra: true } as any), 'delivery_invalid', 400)
    expect(f.state.calls).toEqual([])
    expect(f.dispatchRows()).toEqual([])
    f.state.epoch = 'delivery-next-epoch'
    await rejectsWith(f.service.dispatch({ ...input, epoch: EPOCH }), 'workspace_epoch_stale', 409)
    expect(f.state.calls).toEqual([])
  })

  it('rejects a canceled confirmation and never turns a cancel into a dispatch', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input); await f.service.cancel({ epoch: input.epoch, confirmationId: input.confirmationId })
    await rejectsWith(f.service.dispatch(input), 'delivery_confirmation_canceled', 409)
    expect(f.state.calls).toEqual([]); expect(f.dispatchRows()).toEqual([])
  })

  it('rejects target facts, target fences and bound images that changed after confirmation, before any fence or Host call', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.binding = { ...f.state.binding, factRevision: digest(['fact', 1]) }
    await rejectsWith(f.service.dispatch(input), 'delivery_target_changed', 409)
    expect(f.dispatchRows()).toEqual([]); expect(f.state.calls).toEqual([])
    f.state.binding = { ...f.state.binding, factRevision: input.target.factRevision }
    f.state.denied = true
    await rejectsWith(f.service.dispatch(input), 'delivery_target_changed', 409)
    f.state.denied = false
    const image = f.bindImage(), withImage = f.input({ images: [imageRef(image)] })
    await f.service.prepare(withImage); await f.service.confirm(withImage)
    image.state = 'released'
    await rejectsWith(f.service.dispatch(withImage), 'delivery_image_changed', 409)
    expect(f.dispatchRows()).toEqual([]); expect(f.state.calls).toEqual([])
  })

  it('keeps an unresolved Host call as dispatch_unknown, never resends and stays unknown across a real SQLite reopen', async () => {
    const f = fixture(), input = f.input({ text: 'Unknown outcome body' })
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.throwDispatch = true
    const first = await f.service.dispatch(input)
    expect(first).toMatchObject({ state: 'dispatch_unknown', accepted: false, delivered: false, executed: null, completed: null, disposition: 'reconcile-only', code: 'delivery_dispatch_unknown' })
    expect(f.state.calls).toHaveLength(1)
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'dispatch_unknown', seq: 2 })
    expect(f.state.calls).toHaveLength(1)
    f.reopen()
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'dispatch_unknown' })
    expect(f.state.calls).toHaveLength(1)
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 0, unknown: 1, blocked: 0 })
    expect(f.state.calls).toHaveLength(1)
    expect(JSON.stringify(f.db.store.repos.side_effect.all())).not.toContain('Unknown outcome body')
    // Exact target evidence may reconcile the unknown later; it never becomes a resend.
    f.state.evidence = record => ({ dispatchId: record.dispatchId, confirmationId: record.confirmationId, sessionId: record.target.sessionId, digest: record.digest, messageId: record.messageId!, durable: true, accepted: true })
    const reconciled = await f.service.dispatch(input)
    expect(reconciled).toMatchObject({ state: 'accepted', accepted: true, executed: null, completed: null, disposition: 'target-durable-receipt', seq: 3 })
    expect(f.state.calls).toHaveLength(1)
  })

  it('reports a cold target as blocked without an adapter call and never retries it', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.decision = { state: 'blocked', code: 'delivery_target_cold' }
    const blocked = await f.service.dispatch(input)
    expect(blocked).toMatchObject({ state: 'blocked', accepted: false, delivered: false, executed: false, completed: false, disposition: 'not-dispatched', code: 'delivery_target_cold' })
    expect(f.state.calls).toHaveLength(1)
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'blocked', seq: 2 })
    expect(f.state.calls).toHaveLength(1)
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 0, unknown: 0, blocked: 1 })
  })

  it('blocks visibly when no Host dispatch adapter is wired', async () => {
    const f = fixture({ dispatch: false }), input = f.input()
    await f.service.prepare(input); await f.service.confirm(input)
    const blocked = await f.service.dispatch(input)
    expect(blocked).toMatchObject({ state: 'blocked', code: 'delivery_adapter_unavailable', accepted: false, executed: false, completed: false, disposition: 'not-dispatched' })
    expect(f.dispatchRows()).toHaveLength(1)
  })

  it('reconciles a crash-left dispatching fence to unknown, then only to accepted with exact evidence, never by resending', async () => {
    const f = fixture(), input = f.input({ text: 'Crash fence body' })
    await f.service.prepare(input); await f.service.confirm(input)
    f.staleDispatch(input, 'dispatching')
    const unknown = await f.service.dispatch(input)
    expect(unknown).toMatchObject({ state: 'dispatch_unknown', seq: 2 })
    expect(f.state.calls).toEqual([])
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 0, unknown: 1, blocked: 0 })
    expect(f.state.calls).toEqual([])
    f.state.evidence = record => ({ dispatchId: record.dispatchId, confirmationId: record.confirmationId, sessionId: record.target.sessionId, digest: record.digest, messageId: record.messageId!, durable: true, accepted: true })
    expect(await f.service.reconcile()).toEqual({ accepted: 1, interrupted: 0, unknown: 0, blocked: 0 })
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'accepted', seq: 3 })
    expect(f.state.calls).toEqual([])
  })

  it('rejects contradictory or mismatched target evidence instead of claiming acceptance', async () => {
    const f = fixture(), input = f.input()
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.throwDispatch = true
    await f.service.dispatch(input)
    f.state.evidence = record => ({ dispatchId: randomUUID(), confirmationId: record.confirmationId, sessionId: record.target.sessionId, digest: record.digest, messageId: record.messageId!, durable: true, accepted: true })
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 0, unknown: 1, blocked: 0 })
    f.state.evidence = record => ({ dispatchId: record.dispatchId, confirmationId: record.confirmationId, sessionId: 'other-session', digest: record.digest, messageId: record.messageId!, durable: true, accepted: true })
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 0, unknown: 1, blocked: 0 })
  })
describe('stop: one Host cancellation with honest interruption evidence', () => {
  const stop = (f: ReturnType<typeof fixture>, patch: Partial<DeliveryInput> = {}) => f.input({ operation: 'stop', text: '', images: [], ...patch })

  it('prepares and confirms an optional reason as metadata only, with no body or image semantics', async () => {
    const f = fixture(), withReason = stop(f, { text: 'Owner stops this exact work' }), withoutReason = stop(f)
    const prepared = await f.service.prepare(withReason)
    expect(prepared).toMatchObject({ operation: 'stop', bodyBytes: Buffer.byteLength('Owner stops this exact work', 'utf8'), images: [], state: 'prepared', humanConfirmed: false,
      delivered: false, accepted: false, executed: false, completed: false, disposition: 'not-confirmed', digest: deliveryDigest(withReason) })
    const confirmed = await f.service.confirm(withReason)
    expect(confirmed).toMatchObject({ state: 'confirmed', humanConfirmed: true, delivered: false, accepted: false, disposition: 'confirmed-pending-delivery' })
    expect(await f.service.confirm(withReason)).toEqual(confirmed)
    expect(f.state.counts.dispatch).toBe(0)
    const bare = await f.service.prepare(withoutReason)
    expect(bare.bodyBytes).toBe(0)
    expect(JSON.stringify(f.db.store.repos.side_effect.all())).not.toContain('Owner stops this exact work')
    // A stop carries no message and no images; malformed or over-long reasons never reach persistence.
    for (const bad of [
      stop(f, { images: [{ imageId: randomUUID(), digest: digest(['image']), seq: 1 }] }),
      stop(f, { text: 'x'.repeat(2001) }),
      { ...stop(f), operation: 'resume' } as any,
    ]) await rejectsWith(f.service.prepare(bad as DeliveryInput), 'delivery_invalid', 400)
  })

  it('dispatches one Host cancel, reports interrupted with evidence and never fakes a message delivery', async () => {
    const f = fixture(), input = stop(f, { text: 'Owner stops this exact work' })
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.decision = { state: 'interrupted', stopEvidence: 'turn-aborted' }
    const receipt = await f.service.dispatch(input)
    expect(receipt).toMatchObject({ version: 1, operation: 'stop', state: 'interrupted', durable: true, humanConfirmed: true,
      delivered: false, accepted: false, interrupted: true, executed: null, completed: null, disposition: 'stop-interrupted', stopEvidence: 'turn-aborted', seq: 2 })
    expect(receipt.messageId).toBeUndefined()
    expect(f.state.calls).toHaveLength(1)
    expect(f.state.calls[0]).toMatchObject({ text: 'Owner stops this exact work', fencePersisted: true, record: { operation: 'stop', state: 'dispatching', seq: 1 } })
    expect(f.state.calls[0]!.record.messageId).toBeUndefined()
    // Same confirmed stop replays the stored receipt; the Host is never cancelled twice.
    expect(await f.service.dispatch(input)).toEqual(receipt)
    expect(f.state.calls).toHaveLength(1)
    expect(f.dispatchRows()).toHaveLength(1)
    expect(JSON.stringify(f.db.store.repos.side_effect.all())).not.toContain('turn-aborted' in {} ? '' : 'Owner stops this exact work')
    for (const cancelAccepted of ['cancel-accepted', 'turn-aborted'] as const) {
      const g = fixture(), other = stop(g)
      await g.service.prepare(other); await g.service.confirm(other)
      g.state.decision = { state: 'interrupted', stopEvidence: cancelAccepted }
      expect(await g.service.dispatch(other)).toMatchObject({ state: 'interrupted', stopEvidence: cancelAccepted })
    }
  })

  it('keeps a lost cancel unknown, never resends, and promotes only with stop interruption evidence', async () => {
    const f = fixture(), input = stop(f, { text: 'Unknown cancel' })
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.throwDispatch = true
    const unknown = await f.service.dispatch(input)
    expect(unknown).toMatchObject({ state: 'dispatch_unknown', accepted: false, interrupted: false, delivered: false, executed: null, completed: null, disposition: 'reconcile-only', code: 'delivery_dispatch_unknown' })
    expect(unknown.messageId).toBeUndefined()
    expect(f.state.calls).toHaveLength(1)
    f.reopen()
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'dispatch_unknown', seq: 2 })
    expect(f.state.calls).toHaveLength(1)
    // A message-shaped evidence object can never prove an interruption.
    f.state.evidence = record => ({ dispatchId: record.dispatchId, confirmationId: record.confirmationId, sessionId: record.target.sessionId, digest: record.digest, messageId: record.messageId!, durable: true, accepted: true })
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 0, unknown: 1, blocked: 0 })
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'dispatch_unknown', seq: 2 })
    f.state.evidence = record => ({ dispatchId: record.dispatchId, confirmationId: record.confirmationId, sessionId: record.target.sessionId, digest: record.digest, durable: true, interrupted: true, stopEvidence: 'turn-aborted' })
    expect(await f.service.reconcile()).toEqual({ accepted: 0, interrupted: 1, unknown: 0, blocked: 0 })
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'interrupted', seq: 3, interrupted: true, stopEvidence: 'turn-aborted' })
    expect(f.state.calls).toHaveLength(1)
  })

  it('enforces per-operation adapter contracts and never upgrades a stop to acceptance', async () => {
    const f = fixture(), input = stop(f)
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.decision = { state: 'accepted' as any }
    expect(await f.service.dispatch(input)).toMatchObject({ state: 'dispatch_unknown', accepted: false, interrupted: false, disposition: 'reconcile-only' })
    const g = fixture(), uncorroborated = stop(g)
    await g.service.prepare(uncorroborated); await g.service.confirm(uncorroborated)
    g.state.decision = { state: 'interrupted' }
    expect(await g.service.dispatch(uncorroborated)).toMatchObject({ state: 'dispatch_unknown', interrupted: false })
    const h = fixture(), text = h.input()
    await h.service.prepare(text); await h.service.confirm(text)
    h.state.decision = { state: 'interrupted', stopEvidence: 'turn-aborted' }
    expect(await h.service.dispatch(text)).toMatchObject({ state: 'dispatch_unknown', accepted: false, delivered: false })
    const cold = fixture(), coldText = cold.input()
    await cold.service.prepare(coldText); await cold.service.confirm(coldText)
    cold.state.decision = { state: 'blocked', code: 'delivery_target_cold' }
    expect(await cold.service.dispatch(coldText)).toMatchObject({ state: 'blocked', code: 'delivery_target_cold' })
  })

  it('rejects target facts that changed after stop confirmation before any Host cancel', async () => {
    const f = fixture(), input = stop(f)
    await f.service.prepare(input); await f.service.confirm(input)
    f.state.binding = { ...f.state.binding, factRevision: digest(['fact', 9]) }
    await rejectsWith(f.service.dispatch(input), 'delivery_target_changed', 409)
    f.state.binding = { ...f.state.binding, factRevision: input.target.factRevision }
    f.state.denied = true
    await rejectsWith(f.service.dispatch(input), 'delivery_target_changed', 409)
    expect(f.state.calls).toEqual([]); expect(f.dispatchRows()).toEqual([])
  })
})

})
