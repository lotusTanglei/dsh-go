import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { encodeJson, openStore, type Store } from '../../src/store/index.js'
import { WorkspaceError } from '../../src/workspace/commands.js'
import { configMutationDigest, createConfigMutations,
  type ConfigMutationHandler, type ConfigMutationInput, type ConfigMutationJSON } from '../../src/workspace/config-mutations.js'

const EPOCH = 'synthetic-config-mutation-epoch'
const key = (id: string) => `config-mutation:v1:${id}`
const cleanups: Array<() => void> = []
afterEach(() => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup() } catch (error) { errors.push(error) } }
  if (errors.length) throw new AggregateError(errors, 'config mutation cleanup failed')
})
function fixture() {
  const root = realpathSync(tmpdir()), dir = resolve(mkdtempSync(join(root, 'config-mutations-test-')))
  const identity = lstatSync(dir), dbPath = join(dir, 'state.sqlite')
  let store: Store = openStore({ dbPath })
  store.db.exec('CREATE TABLE synthetic_core (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  const state = { epoch: EPOCH }
  const requireEpoch = vi.fn((epoch: string) => { if (epoch !== state.epoch) throw new WorkspaceError('workspace_epoch_stale', 409) })
  let mutations = createConfigMutations(store, { requireEpoch })
  cleanups.push(() => {
    try { store.close() } finally {
      const target = resolve(dir), current = lstatSync(target)
      if (!isAbsolute(target) || target !== dir || realpathSync(target) !== dir || dirname(target) !== root
        || !basename(target).startsWith('config-mutations-test-') || !current.isDirectory() || current.isSymbolicLink()
        || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe config mutation cleanup')
      rmSync(target, { recursive: true, force: true })
    }
  })
  return {
    state, requireEpoch, get store() { return store }, get mutations() { return mutations },
    reopen() { store.close(); store = openStore({ dbPath }); mutations = createConfigMutations(store, { requireEpoch }) },
    core() { return store.db.prepare('SELECT * FROM synthetic_core ORDER BY k').all() },
    write(value = 'configured') { store.db.prepare('INSERT INTO synthetic_core(k,v) VALUES (?,?)').run('settings', value) },
  }
}
function input(payload: ConfigMutationJSON = { sourceId: 'synthetic-local', scope: ['safe-config'] }): ConfigMutationInput {
  return { epoch: EPOCH, requestId: randomUUID(), kind: 'local-configure', payload }
}
const status = (action: ConfigMutationInput) => ({ epoch: action.epoch, requestId: action.requestId })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
const unused = vi.fn<ConfigMutationHandler>(() => { throw new Error('duplicate handler must not execute') })

async function rejects(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toMatchObject({ code, status })
}

describe('config mutation journal: caller-owned core transaction and no automatic replay', () => {
  it('persists recorded before core handler, atomically settles safe result in its existing transaction, not handler return', async () => {
    const f = fixture(), action = input(), value = { sources: [{ id: 'synthetic-local', revision: 1 }] }
    const result = await f.mutations.run(action, (commit, checkpoint) => {
      expect(f.store.repos.kv.get(key(action.requestId))?.v).toMatchObject({ mutation: { state: 'recorded' } })
      checkpoint()
      f.store.transaction(() => { f.write(); expect(f.store.db.isTransaction).toBe(true); commit(value) })
      return { forged: 'handler return is not evidence' }
    })
    expect(result).toEqual({ mutation: { version: 1, epoch: EPOCH, requestId: action.requestId, kind: action.kind,
      digest: configMutationDigest(action), state: 'settled', at: expect.any(Number), updatedAt: expect.any(Number) }, value })
    expect(result.mutation).not.toHaveProperty('value')
    expect(result.mutation).not.toHaveProperty('payload')
    expect(f.core()).toEqual([{ k: 'settings', v: 'configured' }])
    expect(await f.mutations.status(status(action))).toEqual(result)
  })

  it('lost reply and reopen status/duplicate run preserve settled without invoking another handler', async () => {
    const f = fixture(), action = input(), handler = vi.fn<ConfigMutationHandler>(commit => {
      f.store.transaction(() => { f.write(); commit({ revision: 1 }) }); return null
    })
    await f.mutations.run(action, handler) // deliberately discard return
    f.reopen()
    const recovered = await f.mutations.status(status(action))
    expect(recovered).toMatchObject({ mutation: { state: 'settled' }, value: { revision: 1 } })
    expect(await f.mutations.run(action, handler)).toEqual(recovered)
    expect(await f.mutations.close(action)).toEqual(recovered)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(f.core()).toHaveLength(1)
  })

  it('core write without commit leaves recorded across restart, resolve value never self-certifies completion or replay', async () => {
    const f = fixture(), action = input()
    const result = await f.mutations.run(action, () => { f.store.transaction(() => f.write()); return { ok: true } })
    expect(result.mutation.state).toBe('recorded')
    expect(result).not.toHaveProperty('value')
    f.reopen()
    expect(await f.mutations.status(status(action))).toEqual(result)
    expect(await f.mutations.run(action, unused)).toEqual(result)
    expect(await f.mutations.close(action)).toEqual(result)
    expect(f.core()).toHaveLength(1)
  })

  it.each([415, 409])('persists fixed WorkspaceError code for %s rejection so UI can recover it, not raw message', async httpStatus => {
    const f = fixture(), action = input(), code = httpStatus === 415 ? 'local_source_unsupported_type' : 'stage_models_catalog_changed'
    const handler = vi.fn<ConfigMutationHandler>(() => {
      const error = new WorkspaceError(code, httpStatus); error.message = 'raw-private-error-body /Users/synthetic/secret'; throw error
    })
    const receipt = await f.mutations.run(action, handler)
    expect(receipt).toMatchObject({ mutation: { state: 'rejected', code } })
    expect(receipt).not.toHaveProperty('value')
    expect(JSON.stringify(f.store.repos.kv.all())).not.toContain('raw-private-error-body')
    f.reopen()
    expect(await f.mutations.status(status(action))).toEqual(receipt)
    expect(await f.mutations.close(action)).toEqual(receipt)
    expect(await f.mutations.run(action, handler)).toEqual(receipt)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('unknown exception uses one fixed failure code and never persists arbitrary error code/message', async () => {
    const f = fixture(), action = input()
    const result = await f.mutations.run(action, () => { throw { code: 'private_token_value', message: 'private raw error' } })
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'config_mutation_failed' } })
    expect(JSON.stringify(f.store.repos.kv.all())).not.toContain('private')
  })

  it('successful core transaction then handler throw returns original settled rather than erroneous rejected', async () => {
    const f = fixture(), action = input()
    const result = await f.mutations.run(action, commit => {
      f.store.transaction(() => { f.write(); commit({ revision: 1 }) })
      throw new WorkspaceError('local_source_lost_return', 409)
    })
    expect(result).toMatchObject({ mutation: { state: 'settled' }, value: { revision: 1 } })
    expect(result.mutation).not.toHaveProperty('code')
    expect(f.core()).toHaveLength(1)
  })

  it('core transaction throw after commit rolls back core and settled, then persists rejected', async () => {
    const f = fixture(), action = input()
    const result = await f.mutations.run(action, commit => f.store.transaction(() => {
      f.write(); commit({ revision: 1 }); throw new WorkspaceError('local_source_conflict', 409)
    }))
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'local_source_conflict' } })
    expect(result).not.toHaveProperty('value')
    expect(f.core()).toEqual([])
    f.reopen()
    expect(await f.mutations.status(status(action))).toEqual(result)
  })

  it('commit outside a core transaction is rejected, never silently creates a settled record', async () => {
    const f = fixture(), action = input()
    expect(f.store.db.isTransaction).toBe(false)
    const result = await f.mutations.run(action, commit => { commit({ revision: 1 }); return null })
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'config_mutation_commit_outside_transaction' } })
    expect(f.core()).toEqual([])
  })

  it('escaped commit after handler rejection is inactive even inside a later valid SQLite transaction', async () => {
    const f = fixture(), action = input(); let late!: Parameters<ConfigMutationHandler>[0]
    const rejected = await f.mutations.run(action, commit => { late = commit; throw new WorkspaceError('local_source_denied', 409) })
    expect(() => f.store.transaction(() => late({ revision: 2 }))).toThrow('config_mutation_commit_inactive')
    expect(await f.mutations.status(status(action))).toEqual(rejected)
  })

  it('escaped commit after resolve without commit cannot later settle a recorded request', async () => {
    const f = fixture(), action = input(); let late!: Parameters<ConfigMutationHandler>[0]
    const recorded = await f.mutations.run(action, commit => { late = commit; return null })
    expect(() => f.store.transaction(() => late({ revision: 2 }))).toThrow('config_mutation_commit_inactive')
    expect(await f.mutations.status(status(action))).toEqual(recorded)
  })

  it('second commit cannot overwrite settled and rolls back owning core transaction', async () => {
    const f = fixture(), action = input()
    const result = await f.mutations.run(action, commit => f.store.transaction(() => {
      f.write(); commit({ revision: 1 }); commit({ revision: 2 }); return null
    }))
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'config_mutation_conflict' } })
    expect(f.core()).toEqual([])
  })

  it('CAS detects valid-looking changed recorded version and rolls back core write rather than settling it', async () => {
    const f = fixture(), action = input()
    const result = await f.mutations.run(action, commit => f.store.transaction(() => {
      f.write()
      const row = f.store.repos.kv.get(key(action.requestId))!.v as any
      row.mutation.at++; row.mutation.updatedAt++
      f.store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(row, false), key(action.requestId))
      commit({ revision: 1 }); return null
    }))
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'config_mutation_conflict' } })
    expect(f.core()).toEqual([])
  })

  it('missing status404 leaves no record; explicit close survives lost reply and blocks all late identical runs', async () => {
    const f = fixture(), action = input(), handler = vi.fn<ConfigMutationHandler>(() => null)
    await rejects(f.mutations.status(status(action)), 'config_mutation_not_found', 404)
    expect(f.store.repos.kv.all()).toEqual([])
    await f.mutations.close(action)
    f.reopen()
    const receipt = await f.mutations.status(status(action))
    expect(receipt).toMatchObject({ mutation: { state: 'closed', code: 'config_mutation_id_closed' } })
    expect(receipt).not.toHaveProperty('value')
    expect(await f.mutations.run(action, handler)).toEqual(receipt)
    expect(await f.mutations.close(action)).toEqual(receipt)
    expect(handler).not.toHaveBeenCalled()
    expect(f.core()).toEqual([])
  })

  it('close ordered before queued concurrent runs is a permanent fence without handler execution', async () => {
    const f = fixture(), action = input(), handler = vi.fn<ConfigMutationHandler>(() => null)
    const results = await Promise.all([f.mutations.close(action), ...Array.from({ length: 5 }, () => f.mutations.run(action, handler))])
    for (const result of results) expect(result).toEqual(results[0])
    expect(results[0]?.mutation.state).toBe('closed')
    expect(handler).not.toHaveBeenCalled()
    expect(f.store.repos.kv.all()).toHaveLength(1)
  })

  it('one active handler serializes run/close; duplicate recorded never replays after the first returns unknown', async () => {
    const f = fixture(), action = input(), entered = deferred(), release = deferred()
    const handler = vi.fn<ConfigMutationHandler>(async () => { entered.resolve(); await release.promise; return null })
    const running = f.mutations.run(action, handler)
    await entered.promise
    const closing = f.mutations.close(action), duplicate = f.mutations.run(action, handler)
    expect(f.store.repos.kv.get(key(action.requestId))?.v).toMatchObject({ mutation: { state: 'recorded' } })
    release.resolve()
    const results = await Promise.all([running, closing, duplicate])
    for (const result of results) expect(result.mutation.state).toBe('recorded')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('stale epoch is rejected before journaling and queue recovery allows next current-epoch request', async () => {
    const f = fixture(), action = input(), handler = vi.fn<ConfigMutationHandler>(() => null)
    f.state.epoch = 'synthetic-new-config-epoch'
    await rejects(f.mutations.run(action, handler), 'workspace_epoch_stale', 409)
    await rejects(f.mutations.close(action), 'workspace_epoch_stale', 409)
    expect(f.store.repos.kv.all()).toEqual([])
    expect(handler).not.toHaveBeenCalled()
    expect((await f.mutations.close({ ...action, epoch: f.state.epoch })).mutation.state).toBe('closed')
  })

  it('cross-epoch same global request cannot be recreated or disclose an old settled result', async () => {
    const f = fixture(), action = input()
    await f.mutations.close(action)
    f.reopen(); f.state.epoch = 'synthetic-next-config-epoch'
    const changed = { ...action, epoch: f.state.epoch }
    await rejects(f.mutations.status(status(changed)), 'config_mutation_not_found', 404)
    await rejects(f.mutations.run(changed, unused), 'config_mutation_request_conflict', 409)
    await rejects(f.mutations.close(changed), 'config_mutation_request_conflict', 409)
    expect(f.store.repos.kv.all()).toHaveLength(1)
  })

  it('closed/rejected/recorded request IDs cannot change payload or kind; genuinely new ID is explicit', async () => {
    const f = fixture()
    for (const state of ['closed', 'rejected', 'recorded']) {
      const action = input()
      if (state === 'closed') await f.mutations.close(action)
      else await f.mutations.run(action, () => { if (state === 'rejected') throw new WorkspaceError('local_source_conflict', 409); return null })
      for (const changed of [{ ...action, payload: { changed: true } }, { ...action, kind: 'stage-save' as const }]) {
        await rejects(f.mutations.run(changed, unused), 'config_mutation_request_conflict', 409)
        await rejects(f.mutations.close(changed), 'config_mutation_request_conflict', 409)
      }
    }
    expect((await f.mutations.run(input(), () => null)).mutation.state).toBe('recorded')
  })

  it('checkpoint and commit recheck epoch at async boundary before core write and produce durable rejection', async () => {
    const f = fixture(), action = input(), entered = deferred(), release = deferred()
    const running = f.mutations.run(action, async (commit, checkpoint) => {
      entered.resolve(); await release.promise
      f.store.transaction(() => { checkpoint(); f.write(); commit({ revision: 1 }) }); return null
    })
    await entered.promise; f.state.epoch = 'synthetic-replaced-while-awaiting'; release.resolve()
    const result = await running
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'workspace_epoch_stale' } })
    expect(f.core()).toEqual([])
  })

  it('canonical digest deep-sorts object keys, preserves arrays and exact Unicode/newlines, and snapshots before queue', async () => {
    const f = fixture(), action = input({ z: ['e\u0301\r\n', { y: 2, x: 1 }], a: true })
    const expected = createHash('sha256').update(JSON.stringify([action.epoch, action.requestId, action.kind,
      { a: true, z: ['e\u0301\r\n', { x: 1, y: 2 }] }])).digest('hex')
    expect(configMutationDigest(action)).toBe(expected)
    expect(configMutationDigest({ ...action, payload: { a: true, z: ['e\u0301\r\n', { x: 1, y: 2 }] } })).toBe(expected)
    expect(configMutationDigest({ ...action, payload: { a: true, z: ['é\n', { x: 1, y: 2 }] } })).not.toBe(expected)
    const closing = f.mutations.close(action)
    action.payload = { modified: true }
    expect((await closing).mutation.digest).toBe(expected)
  })

  it('does not persist input payload and returns detached safe result without heuristic field redaction', async () => {
    const f = fixture(), action = input({ transient: 'synthetic-input-only-private-marker' })
    const value = { settings: { model: 'synthetic-safe-model', revision: 1 } }
    const result = await f.mutations.run(action, commit => { f.store.transaction(() => commit(value)); return null })
    value.settings.revision = 8
    ;(result.value as any).settings.revision = 9
    expect((await f.mutations.status(status(action))).value).toEqual({ settings: { model: 'synthetic-safe-model', revision: 1 } })
    expect(JSON.stringify(f.store.repos.kv.all())).not.toContain('synthetic-input-only-private-marker')
  })

  it('strict JSON rejects accessors/symbols/prototypes/unsafe keys/nonfinite/sparse/cyclic/oversize input without invoking getters', async () => {
    const getter = vi.fn(() => 'must not execute'), cycle: any = {}; cycle.self = cycle
    const accessor = Object.defineProperty({}, 'field', { enumerable: true, get: getter })
    const invalid: unknown[] = [accessor, { [Symbol('authority')]: true }, new Date(), Object.create({ inherited: true }),
      JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: {} }, { 'unsafe\0key': true }, NaN, Infinity, undefined,
      new Array(1), Object.assign([], { extra: true }), cycle, '中'.repeat(700_000)]
    for (const payload of invalid) {
      const f = fixture()
      await rejects(f.mutations.close({ ...input(), payload } as ConfigMutationInput), 'config_mutation_invalid', 400)
      expect(f.store.repos.kv.all()).toEqual([])
    }
    expect(getter).not.toHaveBeenCalled()
  })

  it('strict envelope validation rejects missing/extra/status fields and inherited/getter inputs before accessing authority', async () => {
    const f = fixture(), action = input(), getter = vi.fn(() => EPOCH)
    const accessor = { ...action }; Object.defineProperty(accessor, 'epoch', { enumerable: true, get: getter })
    for (const raw of [{ ...action, payload: undefined }, { ...action, approved: true }, status(action), Object.create(action), accessor]) {
      await rejects(f.mutations.close(raw as ConfigMutationInput), 'config_mutation_invalid', 400)
    }
    await rejects(f.mutations.status({ ...status(action), payload: {} } as any), 'config_mutation_invalid', 400)
    expect(getter).not.toHaveBeenCalled()
    expect(f.store.repos.kv.all()).toEqual([])
  })

  it('corrupt wrappers/versions/state/digest/value combinations fail closed for all three entry points without repair', async () => {
    const corruptions = [
      () => 'not JSON',
      (row: any) => JSON.stringify({ schemaVersion: 2, value: row }),
      (row: any) => encodeJson({ ...row, unexpected: true }, false),
      (row: any) => encodeJson({ mutation: { ...row.mutation, version: 2 } }, false),
      (row: any) => encodeJson({ mutation: { ...row.mutation, state: 'settled' } }, false),
      (row: any) => encodeJson({ mutation: { ...row.mutation, digest: 'not-a-digest' } }, false),
      (row: any) => encodeJson({ ...row, value: null }, false),
      (row: any) => encodeJson({ mutation: { ...row.mutation, requestId: randomUUID() } }, false),
    ]
    for (const corrupt of corruptions) {
      const f = fixture(), action = input(); await f.mutations.close(action)
      const row = f.store.repos.kv.get(key(action.requestId))!.v
      const bad = corrupt(row)
      f.store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(bad, key(action.requestId))
      f.reopen()
      await rejects(f.mutations.status(status(action)), 'config_mutation_record_invalid', 503)
      await rejects(f.mutations.run(action, unused), 'config_mutation_record_invalid', 503)
      await rejects(f.mutations.close(action), 'config_mutation_record_invalid', 503)
      expect(f.store.db.prepare('SELECT v FROM kv WHERE k=?').get(key(action.requestId))?.v).toBe(bad)
    }
  })

  it('invalid settled result causes core rollback and fixed rejection rather than silently lossy JSON', async () => {
    const f = fixture(), action = input(), getter = vi.fn(() => 'private')
    const value = Object.defineProperty({}, 'accessor', { enumerable: true, get: getter })
    const result = await f.mutations.run(action, commit => f.store.transaction(() => { f.write(); commit(value); return null }))
    expect(result).toMatchObject({ mutation: { state: 'rejected', code: 'config_mutation_invalid' } })
    expect(f.core()).toEqual([])
    expect(getter).not.toHaveBeenCalled()
    // A result alone may fit 2 MiB while its full persisted envelope does not: reject inside the core transaction.
    const next = input()
    const oversizedReceipt = await f.mutations.run(next, commit => f.store.transaction(() => {
      f.write(); commit('x'.repeat(2 * 1024 * 1024 - 2)); return null
    }))
    expect(oversizedReceipt).toMatchObject({ mutation: { state: 'rejected', code: 'config_mutation_invalid' } })
    expect(f.core()).toEqual([])
    expect(await f.mutations.status(status(next))).toEqual(oversizedReceipt)
  })

  it('close write SQLite failure leaves missing rather than a phantom permanent tombstone', async () => {
    const f = fixture(), action = input()
    f.store.db.exec("CREATE TEMP TRIGGER reject_mutation BEFORE INSERT ON kv WHEN NEW.k LIKE 'config-mutation:v1:%' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    await expect(f.mutations.close(action)).rejects.toThrow('synthetic failure')
    await rejects(f.mutations.status(status(action)), 'config_mutation_not_found', 404)
    f.reopen()
    expect((await f.mutations.close(action)).mutation.state).toBe('closed')
  })

  it('accepts the three Tencent configuration kinds while rejecting unknown kinds before journaling', async () => {
    const f = fixture()
    for (const kind of ['tencent-configure', 'tencent-remove', 'tencent-scan'] as const) {
      const action = { ...input(), kind }
      const receipt = await f.mutations.run(action, commit => { f.store.transaction(() => commit({ configured: true })); return null })
      expect(receipt).toMatchObject({ mutation: { kind, state: 'settled' }, value: { configured: true } })
      expect(await f.mutations.status(status(action))).toEqual(receipt)
    }
    await rejects(f.mutations.close({ ...input(), kind: 'tencent-dispatch' } as any), 'config_mutation_invalid', 400)
    expect(f.store.repos.kv.all()).toHaveLength(3)
  })

  it('handler that leaves a transaction open cannot expose uncommitted settled as durable', async () => {
    const f = fixture(), action = input()
    await rejects(f.mutations.run(action, commit => { f.store.db.exec('BEGIN IMMEDIATE'); f.write(); commit({ revision: 1 }); return null }), 'config_mutation_transaction_open', 503)
    f.store.db.exec('ROLLBACK')
    expect((await f.mutations.status(status(action))).mutation.state).toBe('recorded')
    expect(f.core()).toEqual([])
  })
})
