import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { encodeJson, openStore, type Store } from '../../src/store/index.js'
import { WorkspaceError } from '../../src/workspace/commands.js'
import {
  createSessionActions, sessionActionDigest,
  type SessionActionClosure, type SessionActionInput, type SessionActionPorts, type SessionActionRecord,
} from '../../src/workspace/session-actions.js'

const EPOCH = 'synthetic-session-action-close-epoch'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const SCOPE = digest(['synthetic scope']), FACT = digest(['synthetic fact'])
const CONTROL = digest(['synthetic control']), GRANT = digest(['synthetic grant'])
const PROJECT = { kind: 'project' as const, key: 'synthetic-verified-project' }
const journalKey = (id: string) => `session-action:v1:${id}`
const closureKey = (id: string) => `session-action-closed:v1:${id}`
const pointerKey = (input: SessionActionInput) => `session-action-request:v1:${digest([input.epoch, input.requestId])}`
const statusInput = (input: SessionActionInput) => ({ epoch: input.epoch, actionId: input.actionId })
const cleanups: Array<() => void> = []

afterEach(() => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { cleanup() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'session-action-close fixture cleanup failed')
})

// Only a private on-disk SQLite store and synthetic ports; no Host, profile, model or build.
function database() {
  const root = realpathSync(tmpdir())
  const dir = resolve(mkdtempSync(join(root, 'session-action-close-test-')))
  const identity = lstatSync(dir), dbPath = join(dir, 'state.sqlite')
  let store: Store = openStore({ dbPath })
  const verifyDirectory = () => {
    const target = resolve(dir), current = lstatSync(target)
    if (!isAbsolute(target) || target !== dir || dirname(target) !== root || realpathSync(target) !== dir
      || !basename(target).startsWith('session-action-close-test-') || !current.isDirectory() || current.isSymbolicLink()
      || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe session-action-close fixture path')
    return target
  }
  cleanups.push(() => {
    try { store.close() } finally {
      // Re-check exact absolute path, realpath, directory type and original dev/inode immediately before deletion.
      const target = verifyDirectory()
      rmSync(target, { recursive: true, force: true })
    }
  })
  return {
    get store() { return store },
    reopen() { store.close(); store = openStore({ dbPath }); return store },
    bytes() {
      const directory = verifyDirectory()
      return readdirSync(directory).map(name => {
        const path = resolve(directory, name), identity = lstatSync(path)
        if (dirname(path) !== directory || !identity.isFile() || identity.isSymbolicLink()) throw new Error('unexpected fixture file')
        return readFileSync(path)
      })
    },
  }
}

function input(text = '本次真人明确输入\r\n继续核对。'): SessionActionInput {
  return { epoch: EPOCH, requestId: randomUUID(), actionId: randomUUID(), operation: 'supplement', text,
    target: { sessionId: 'synthetic-requested-session', scopeRevision: SCOPE, factRevision: FACT } }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const service = database(), state = { epoch: EPOCH }
  const requireEpoch = vi.fn((epoch: string) => {
    if (epoch !== state.epoch) throw new WorkspaceError('workspace_epoch_stale', 409)
  })
  const target = vi.fn<SessionActionPorts['target']>(async requested => ({ binding: { ...requested, project: { ...PROJECT } }, fence() {} }))
  const gate = vi.fn<SessionActionPorts['gate']>(async () => ({ allowed: true, controlRevision: CONTROL, grantRevision: GRANT, fence() {} }))
  const dispatch = vi.fn<NonNullable<SessionActionPorts['dispatch']>>(async () => {})
  const evidence = vi.fn<NonNullable<SessionActionPorts['evidence']>>(async () => undefined)
  const cancel = vi.fn(() => { throw new Error('close is not target cancellation') })
  // Extra synthetic trap: no service operation may reach a cancel-like target control port.
  const ports = { requireEpoch, target, gate, dispatch, evidence, cancel }
  let actions = createSessionActions(service.store, ports)
  return {
    service, state, ports, target, gate, dispatch, evidence, cancel, requireEpoch,
    get actions() { return actions },
    reopen() { service.reopen(); actions = createSessionActions(service.store, ports) },
    seed(action: SessionActionInput, recordState: SessionActionRecord['state']) {
      const record: SessionActionRecord = { version: 1, epoch: action.epoch, requestId: action.requestId, actionId: action.actionId,
        operation: action.operation, target: { ...action.target, project: { ...PROJECT } }, digest: sessionActionDigest(action),
        messageId: `go:${action.actionId}`, seq: { recorded: 1, blocked: 2, dispatch_unknown: 2, accepted: 3 }[recordState],
        at: 100, updatedAt: recordState === 'recorded' ? 100 : 101, state: recordState,
        ...(recordState === 'blocked' ? { code: 'session_action_isolation_unproved' } : {}),
        ...(['dispatch_unknown', 'accepted'].includes(recordState) ? { controlRevision: CONTROL, grantRevision: GRANT } : {}),
        ...(recordState === 'dispatch_unknown' ? { code: 'session_action_reconcile_required' } : {}) }
      service.store.transaction(() => {
        service.store.repos.kv.insert({ k: pointerKey(action), v: { version: 1, actionId: action.actionId } })
        service.store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)')
          .run(journalKey(action.actionId), 'session-action-v1', record.at, `v1:${record.seq}`, encodeJson(record, false))
      })
      return record
    },
  }
}

type Fixture = ReturnType<typeof fixture>
function noControlCalls(f: Fixture) {
  expect(f.target).not.toHaveBeenCalled()
  expect(f.gate).not.toHaveBeenCalled()
  expect(f.dispatch).not.toHaveBeenCalled()
  expect(f.evidence).not.toHaveBeenCalled()
  expect(f.cancel).not.toHaveBeenCalled()
}
function persisted(f: Fixture) {
  return { kv: f.service.store.repos.kv.all(), journal: f.service.store.repos.side_effect.all(), audit: f.service.store.repos.audit.all() }
}
function expectClosure(result: unknown, action: SessionActionInput) {
  expect(result).toEqual({ version: 1, epoch: action.epoch, requestId: action.requestId, actionId: action.actionId,
    operation: action.operation, target: action.target, digest: sessionActionDigest(action), seq: 1,
    at: expect.any(Number), updatedAt: expect.any(Number), state: 'closed', bindingVerified: false,
    durable: true, accepted: false, executed: null, completed: null,
    disposition: 'closed-before-dispatch', code: 'session_action_id_closed' })
  const receipt = result as SessionActionClosure
  expect(Number.isSafeInteger(receipt.at)).toBe(true)
  expect(receipt.at).toBeGreaterThanOrEqual(0)
  expect(receipt.updatedAt).toBe(receipt.at)
  for (const forbidden of ['messageId', 'controlRevision', 'grantRevision', 'text']) expect(result).not.toHaveProperty(forbidden)
  expect(receipt.target).not.toHaveProperty('project')
}
function writeKv(f: Fixture, key: string, value: unknown) {
  f.service.store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(value, false), key)
}
async function rejectsWorkspace(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toMatchObject({ code, status })
}

const JOURNAL_STATES = ['recorded', 'blocked', 'dispatch_unknown', 'accepted'] as const
const METHODS = ['close', 'prepare'] as const

describe('session action explicit close: durable pre-dispatch fence, not inferred absence or cancellation', () => {
  it('preserves both receipt schemas: closure has requested facts only and atomic request pointer, never a verified project', async () => {
    const f = fixture(), action = input()
    const closed = await f.actions.close(action)
    expectClosure(closed, action)
    expect(f.service.store.repos.kv.get(closureKey(action.actionId))?.v).toEqual({ version: 1,
      epoch: action.epoch, requestId: action.requestId, actionId: action.actionId, operation: action.operation,
      target: action.target, digest: sessionActionDigest(action), seq: 1, at: closed.at, updatedAt: closed.at,
      state: 'closed', bindingVerified: false })
    expect(f.service.store.repos.kv.get(pointerKey(action))?.v).toEqual({ version: 1, actionId: action.actionId })
    expect(f.service.store.repos.kv.all()).toHaveLength(2)
    expect(f.service.store.repos.side_effect.all()).toEqual([])
    expect(f.service.store.repos.audit.all()).toEqual([])
    expect(await f.actions.close(action)).toEqual(closed)
    expect(await f.actions.status(statusInput(action))).toEqual(closed)
    noControlCalls(f)
  })

  it('target409 -> status404 does not auto-close; explicit close survives lost return/reopen and blocks every late prepare', async () => {
    const f = fixture(), action = input()
    f.target.mockRejectedValueOnce(new WorkspaceError('session_action_target_changed', 409))
    await rejectsWorkspace(f.actions.prepare(action), 'session_action_target_changed', 409)
    for (let n = 0; n < 2; n++) await rejectsWorkspace(f.actions.status(statusInput(action)), 'session_action_not_found', 404)
    expect(persisted(f)).toEqual({ kv: [], journal: [], audit: [] })
    expect(f.gate).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
    await f.actions.close(action) // Simulate a lost HTTP return: do not retain or use this receipt.
    f.reopen()
    const recovered = await f.actions.status(statusInput(action))
    expectClosure(recovered, action)
    const before = persisted(f)
    for (let n = 0; n < 3; n++) expect(await f.actions.prepare(action)).toEqual(recovered)
    expect(await f.actions.close(action)).toEqual(recovered)
    expect(persisted(f)).toEqual(before)
    expect(f.target).toHaveBeenCalledTimes(1)
    expect(f.gate).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.evidence).not.toHaveBeenCalled()
    expect(f.cancel).not.toHaveBeenCalled()
  })

  it('close ordered before concurrently queued prepares never resolves a target, gate, evidence or dispatch', async () => {
    const f = fixture(), action = input()
    const closing = f.actions.close(action)
    const prepares = Array.from({ length: 8 }, () => f.actions.prepare(action))
    const closingAgain = f.actions.close(action)
    const results = await Promise.all([closing, ...prepares, closingAgain])
    expectClosure(results[0], action)
    for (const result of results) expect(result).toEqual(results[0])
    expect(f.requireEpoch).toHaveBeenCalledTimes(results.length)
    noControlCalls(f)
    expect(f.service.store.repos.kv.all()).toHaveLength(2)
    expect(f.service.store.repos.side_effect.all()).toEqual([])
  })

  it('prepare that already owns the serial queue cannot be closed while its target lookup is in flight', async () => {
    const f = fixture(), action = input(), entered = deferred(), release = deferred()
    f.target.mockImplementationOnce(async requested => {
      entered.resolve()
      await release.promise
      return { binding: { ...requested, project: { ...PROJECT } }, fence() {} }
    })
    const preparing = f.actions.prepare(action)
    await entered.promise
    const closing = f.actions.close(action)
    let closeSettled = false
    void closing.then(() => { closeSettled = true })
    await Promise.resolve()
    expect(closeSettled).toBe(false)
    expect(f.service.store.repos.kv.get(closureKey(action.actionId))).toBeUndefined()
    release.resolve()
    const unknown = await preparing
    expect(unknown).toMatchObject({ state: 'dispatch_unknown', seq: 2, target: { project: PROJECT } })
    expect(await closing).toEqual(unknown)
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.evidence).toHaveBeenCalledTimes(1)
    expect(f.cancel).not.toHaveBeenCalled()
    expect(f.service.store.repos.kv.get(closureKey(action.actionId))).toBeUndefined()
  })

  it.each(JOURNAL_STATES)('existing %s journal returns the original verified receipt unchanged, not a closure', async recordState => {
    const f = fixture(), action = input(), record = f.seed(action, recordState), before = persisted(f)
    f.reopen()
    const result = await f.actions.close(action)
    expect(result).toEqual({ ...record, durable: true, accepted: recordState === 'accepted',
      executed: ['recorded', 'blocked'].includes(recordState) ? false : null,
      completed: ['recorded', 'blocked'].includes(recordState) ? false : null,
      disposition: recordState === 'accepted' ? 'target-durable-receipt' : recordState === 'dispatch_unknown' ? 'reconcile-only' : 'not-dispatched' })
    expect(result.target).toEqual({ ...action.target, project: PROJECT })
    expect(result).not.toHaveProperty('bindingVerified')
    expect(result).not.toHaveProperty('text')
    expect(await f.actions.close(action)).toEqual(result)
    expect(persisted(f)).toEqual(before)
    expect(f.service.store.repos.kv.get(closureKey(action.actionId))).toBeUndefined()
    noControlCalls(f)
  })

  it('prepare unknown then close stays unknown without evidence reconciliation, cancellation, new dispatch or global-fence release', async () => {
    const f = fixture(), action = input()
    const unknown = await f.actions.prepare(action)
    expect(unknown).toMatchObject({ state: 'dispatch_unknown', seq: 2, accepted: false, executed: null, completed: null })
    f.reopen()
    f.evidence.mockResolvedValue({ actionId: action.actionId, sessionId: action.target.sessionId,
      digest: sessionActionDigest(action), messageId: `go:${action.actionId}`, durable: true, accepted: true })
    const before = persisted(f), targetCalls = f.target.mock.calls.length
    expect(await f.actions.close(action)).toEqual(unknown)
    expect(await f.actions.prepare(action)).toEqual(unknown)
    expect(f.target).toHaveBeenCalledTimes(targetCalls)
    expect(f.evidence).toHaveBeenCalledTimes(1) // Only the original prepare looked for evidence.
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.cancel).not.toHaveBeenCalled()
    expect(persisted(f)).toEqual(before)
    const different = { ...input(), target: { ...action.target, sessionId: 'synthetic-other-session' } }
    expect(await f.actions.prepare(different)).toMatchObject({ state: 'blocked', code: 'session_action_target_unknown' })
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(f.cancel).not.toHaveBeenCalled()
    expect(f.service.store.repos.kv.get(closureKey(action.actionId))).toBeUndefined()
  })

  it.each(JOURNAL_STATES)('another epoch %s global journal is not missing and its receipt/project never leaks through close or status', async recordState => {
    const f = fixture(), original = input(), record = f.seed(original, recordState)
    f.reopen(); f.state.epoch = 'synthetic-new-close-epoch'
    const current = { ...original, epoch: f.state.epoch }, before = persisted(f)
    await rejectsWorkspace(f.actions.status(statusInput(current)), 'session_action_not_found', 404)
    for (const method of METHODS) await rejectsWorkspace(f.actions[method](current), 'session_action_request_conflict', 409)
    await rejectsWorkspace(f.actions.close(original), 'workspace_epoch_stale', 409)
    expect(persisted(f)).toEqual(before)
    expect(f.service.store.repos.side_effect.get(journalKey(original.actionId))?.detail).toEqual(record)
    expect(f.service.store.repos.kv.get(closureKey(original.actionId))).toBeUndefined()
    noControlCalls(f)
  })

  it('current epoch cannot reuse an older closure or retrieve its requested target through status', async () => {
    const f = fixture(), original = input()
    await f.actions.close(original)
    f.reopen(); f.state.epoch = 'synthetic-new-closure-epoch'
    const current = { ...original, epoch: f.state.epoch }, before = persisted(f)
    await rejectsWorkspace(f.actions.status(statusInput(current)), 'session_action_not_found', 404)
    for (const method of METHODS) await rejectsWorkspace(f.actions[method](current), 'session_action_request_conflict', 409)
    expect(persisted(f)).toEqual(before)
    noControlCalls(f)
  })

  it.each([
    ['text byte', (action: SessionActionInput) => ({ ...action, text: action.text + ' ' })],
    ['request ID', (action: SessionActionInput) => ({ ...action, requestId: randomUUID() })],
    ['operation', (action: SessionActionInput) => ({ ...action, operation: 'steer' as const })],
    ['session', (action: SessionActionInput) => ({ ...action, target: { ...action.target, sessionId: 'synthetic-different-session' } })],
    ['scope', (action: SessionActionInput) => ({ ...action, target: { ...action.target, scopeRevision: digest(['different scope']) } })],
    ['fact', (action: SessionActionInput) => ({ ...action, target: { ...action.target, factRevision: digest(['different fact']) } })],
    ['new action with same request', (action: SessionActionInput) => ({ ...action, actionId: randomUUID() })],
  ] as const)('rejects changed %s after closure for both close and prepare, including SQLite reopen', async (_name, change) => {
    const f = fixture(), action = input(), closed = await f.actions.close(action)
    f.reopen()
    const before = persisted(f), changed = change(action)
    for (const method of METHODS) await rejectsWorkspace(f.actions[method](changed), 'session_action_request_conflict', 409)
    expect(await f.actions.status(statusInput(action))).toEqual(closed)
    expect(persisted(f)).toEqual(before)
    noControlCalls(f)
  })

  it('a genuinely new request/action is explicit and does not inherit the old closure', async () => {
    const f = fixture(), old = input(), closed = await f.actions.close(old), fresh = input()
    f.gate.mockResolvedValue({ allowed: false, code: 'session_action_isolation_unproved' })
    expect(await f.actions.prepare(fresh)).toMatchObject({ actionId: fresh.actionId, state: 'blocked', target: { project: PROJECT } })
    expect(await f.actions.status(statusInput(old))).toEqual(closed)
    expect(f.target).toHaveBeenCalledTimes(1)
    expect(f.gate).toHaveBeenCalledTimes(1)
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.cancel).not.toHaveBeenCalled()
  })

  it('snapshots the exact original input before joining the serial queue and returns detached closure targets', async () => {
    const f = fixture(), blocker = input(), action = input(), original = structuredClone(action)
    const entered = deferred(), release = deferred()
    f.target.mockImplementationOnce(async () => { entered.resolve(); await release.promise; throw new WorkspaceError('session_action_target_changed', 409) })
    const blocking = f.actions.prepare(blocker)
    const blockingRejected = expect(blocking).rejects.toMatchObject({ code: 'session_action_target_changed', status: 409 })
    await entered.promise
    const closing = f.actions.close(action)
    action.text = 'changed after close call'
    action.requestId = randomUUID()
    action.target.sessionId = 'changed-after-close-call'
    release.resolve()
    await blockingRejected
    const closed = await closing
    expectClosure(closed, original)
    closed.target.sessionId = 'mutated-receipt-copy'
    expectClosure(await f.actions.status(statusInput(original)), original)
    expect(await f.actions.prepare(original)).toMatchObject({ state: 'closed', digest: sessionActionDigest(original) })
    expect(f.target).toHaveBeenCalledTimes(1)
    expect(f.gate).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['status-only payload', (action: SessionActionInput) => statusInput(action)],
    ['missing text', (action: SessionActionInput) => { const { text: _text, ...rest } = action; return rest }],
    ['blank text', (action: SessionActionInput) => ({ ...action, text: ' \r\n ' })],
    ['null text byte', (action: SessionActionInput) => ({ ...action, text: 'body\0byte' })],
    ['oversized UTF-8 text', (action: SessionActionInput) => ({ ...action, text: '中'.repeat(5_462) })],
    ['caller digest', (action: SessionActionInput) => ({ ...action, digest: sessionActionDigest(action) })],
    ['caller approval', (action: SessionActionInput) => ({ ...action, approved: true })],
    ['project assertion', (action: SessionActionInput) => ({ ...action, target: { ...action.target, project: PROJECT } })],
    ['inherited fields', (action: SessionActionInput) => Object.create(action)],
    ['array fields', (action: SessionActionInput) => Object.assign([], action)],
    ['symbol authority', (action: SessionActionInput) => ({ ...action, [Symbol('grant')]: true })],
  ] as const)('close requires the original strict SessionActionInput, rejects %s without persistence or control calls', async (_name, malformed) => {
    const f = fixture()
    await rejectsWorkspace(f.actions.close(malformed(input()) as SessionActionInput), 'session_action_invalid', 400)
    expect(persisted(f)).toEqual({ kv: [], journal: [], audit: [] })
    expect(f.requireEpoch).not.toHaveBeenCalled()
    noControlCalls(f)
  })

  it('rejects stale close before persistence, target access or dispatch', async () => {
    const f = fixture(), action = input()
    f.state.epoch = 'synthetic-replacement-epoch'
    await rejectsWorkspace(f.actions.close(action), 'workspace_epoch_stale', 409)
    expect(persisted(f)).toEqual({ kv: [], journal: [], audit: [] })
    noControlCalls(f)
  })

  it.each([
    ['sequence', (closure: SessionActionClosure) => ({ ...closure, seq: 2 })],
    ['binding verified claim', (closure: SessionActionClosure) => ({ ...closure, bindingVerified: true })],
    ['extra project', (closure: SessionActionClosure) => ({ ...closure, target: { ...closure.target, project: PROJECT } })],
    ['message reference', (closure: SessionActionClosure) => ({ ...closure, messageId: `go:${closure.actionId}` })],
    ['control grant', (closure: SessionActionClosure) => ({ ...closure, controlRevision: CONTROL, grantRevision: GRANT })],
    ['raw text', (closure: SessionActionClosure) => ({ ...closure, text: 'unexpected persisted body' })],
    ['digest shape', (closure: SessionActionClosure) => ({ ...closure, digest: 'not-a-digest' })],
    ['wrong action ID', (closure: SessionActionClosure) => ({ ...closure, actionId: randomUUID() })],
    ['updated time', (closure: SessionActionClosure) => ({ ...closure, updatedAt: closure.at + 1 })],
    ['array object', (closure: SessionActionClosure) => [closure]],
    ['null', () => null],
  ] as const)('corrupt closure %s fails closed for status, close and prepare without repairing or dispatching', async (_name, corrupt) => {
    const f = fixture(), action = input()
    await f.actions.close(action)
    const saved = f.service.store.repos.kv.get(closureKey(action.actionId))!.v as SessionActionClosure
    writeKv(f, closureKey(action.actionId), corrupt(saved))
    f.reopen()
    const before = persisted(f)
    await rejectsWorkspace(f.actions.status(statusInput(action)), 'session_action_record_invalid', 503)
    for (const method of METHODS) await rejectsWorkspace(f.actions[method](action), 'session_action_record_invalid', 503)
    expect(persisted(f)).toEqual(before)
    noControlCalls(f)
  })

  it.each(['missing', 'wrong action', 'wrong version', 'extra field', 'array', 'null'] as const)(
    'corrupt closure request pointer (%s) fails closed across reopen for every entry point', async corruption => {
      const f = fixture(), action = input()
      await f.actions.close(action)
      if (corruption === 'missing') f.service.store.db.prepare('DELETE FROM kv WHERE k=?').run(pointerKey(action))
      else writeKv(f, pointerKey(action), corruption === 'wrong action' ? { version: 1, actionId: randomUUID() }
        : corruption === 'wrong version' ? { version: 2, actionId: action.actionId }
          : corruption === 'extra field' ? { version: 1, actionId: action.actionId, approved: true }
            : corruption === 'array' ? [] : null)
      f.reopen()
      const before = persisted(f)
      await rejectsWorkspace(f.actions.status(statusInput(action)), 'session_action_record_invalid', 503)
      for (const method of METHODS) await rejectsWorkspace(f.actions[method](action), 'session_action_record_invalid', 503)
      expect(persisted(f)).toEqual(before)
      noControlCalls(f)
    })

  it.each(['missing closure', 'malformed pointer'] as const)('orphan %s cannot be mistaken for a missing request and closed again', async corruption => {
    const f = fixture(), action = input()
    await f.actions.close(action)
    if (corruption === 'missing closure') f.service.store.db.prepare('DELETE FROM kv WHERE k=?').run(closureKey(action.actionId))
    else {
      f.service.store.db.prepare('DELETE FROM kv WHERE k=?').run(closureKey(action.actionId))
      writeKv(f, pointerKey(action), { version: 1, actionId: 'not-a-uuid' })
    }
    f.reopen()
    const before = persisted(f)
    for (const method of METHODS) await rejectsWorkspace(f.actions[method](action), 'session_action_record_invalid', 503)
    expect(persisted(f)).toEqual(before)
    noControlCalls(f)
  })

  it('a simultaneous closure and journal is invalid rather than a choice of the more convenient receipt', async () => {
    const f = fixture(), action = input()
    await f.actions.close(action)
    const journal: SessionActionRecord = { version: 1, epoch: action.epoch, requestId: action.requestId, actionId: action.actionId,
      operation: action.operation, target: { ...action.target, project: PROJECT }, digest: sessionActionDigest(action),
      messageId: `go:${action.actionId}`, seq: 1, at: 0, updatedAt: 0, state: 'recorded' }
    f.service.store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)')
      .run(journalKey(action.actionId), 'session-action-v1', 0, 'v1:1', encodeJson(journal, false))
    f.reopen()
    const before = persisted(f)
    await rejectsWorkspace(f.actions.status(statusInput(action)), 'session_action_record_invalid', 503)
    for (const method of METHODS) await rejectsWorkspace(f.actions[method](action), 'session_action_record_invalid', 503)
    expect(persisted(f)).toEqual(before)
    noControlCalls(f)
  })

  it.each(['closure write', 'request pointer write'] as const)('SQLite failure during %s rolls back both writes, so a later explicit close remains possible', async failureAt => {
    const f = fixture(), action = input()
    const prefix = failureAt === 'closure write' ? 'session-action-closed:v1:' : 'session-action-request:v1:'
    f.service.store.db.exec(`CREATE TEMP TRIGGER close_write_failure BEFORE INSERT ON kv
      WHEN substr(NEW.k,1,${prefix.length})='${prefix}' BEGIN SELECT RAISE(ABORT,'synthetic close write failure'); END`)
    await expect(f.actions.close(action)).rejects.toThrow('synthetic close write failure')
    expect(persisted(f)).toEqual({ kv: [], journal: [], audit: [] })
    await rejectsWorkspace(f.actions.status(statusInput(action)), 'session_action_not_found', 404)
    noControlCalls(f)
    f.reopen() // TEMP trigger disappears; there is still no automatic close.
    expect(persisted(f)).toEqual({ kv: [], journal: [], audit: [] })
    expectClosure(await f.actions.close(action), action)
    expect(f.service.store.repos.kv.all()).toHaveLength(2)
    noControlCalls(f)
  })

  it('digest preserves exact Unicode/CRLF/whitespace and no original or redacted text reaches any SQLite file', async () => {
    const text = '  e\u0301 ≠ é 😀 中\r\nclose-private-plaintext-marker\n/Users/synthetic/close-private.txt https://close-secret.invalid Bearer close-private-token  \n'
    const f = fixture(), action = input(text), expected = digest([action.epoch, action.requestId, action.actionId,
      action.operation, text, action.target.sessionId, action.target.scopeRevision, action.target.factRevision])
    const closed = await f.actions.close(action)
    expect(closed.digest).toBe(expected)
    for (const changed of [text.normalize('NFC'), text.replace(/\r\n/g, '\n'), text.trim(), text + '\n']) {
      const modified = { ...action, text: changed }
      expect(sessionActionDigest(modified)).not.toBe(expected)
      for (const method of METHODS) await rejectsWorkspace(f.actions[method](modified), 'session_action_request_conflict', 409)
    }
    const forbidden = ['close-private-plaintext-marker', '/Users/synthetic/close-private.txt', 'close-secret.invalid', 'close-private-token', '[REDACTED']
    const assertNoText = () => {
      const metadata = JSON.stringify(persisted(f))
      for (const marker of forbidden) {
        expect(metadata).not.toContain(marker)
        for (const bytes of f.service.bytes()) expect(bytes.includes(Buffer.from(marker, 'utf8'))).toBe(false)
      }
    }
    assertNoText()
    f.reopen()
    expect(await f.actions.status(statusInput(action))).toEqual(closed)
    expect(await f.actions.prepare(action)).toEqual(closed)
    assertNoText()
    noControlCalls(f)
  })
})
