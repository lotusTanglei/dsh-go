import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, type Store } from '../src/store/index.js'
import { defaults, resolveConfig, type Config } from '../src/config.js'
import { createRuntime } from '../src/runtime.js'

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

const dirs: string[] = []
const stores: Store[] = []
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close() } catch {} }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const brief = {
  goal: 'fixture', scope: { repo: '/tmp/fixture', subdirs: [] }, base: { ref: 'main', requireCleanTree: false },
  allowWrite: [], denyWrite: ['**'], runtime: 'test', acceptance: [{ id: 'A1', kind: 'assertion' as const, check: 'ready' }],
  outOfScope: [], blockers: [], firstAction: 'report', approvalsRequired: [],
}
const report = { state: 'ready', done: ['fixture'], todo: [], changedPaths: [], acceptance: [{ id: 'A1', result: 'passed', evidence: 'fixture' }], risks: [], needHuman: [] }

interface HarnessOptions {
  workerResult?: () => Promise<any>
  workerSteer?: (message: unknown) => void | Promise<void>
  createGate?: Deferred<void>
}
function makeHarness(options: HarnessOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-runtime-safety-')); dirs.push(dir)
  const config = resolveConfig({
    ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [], watchdogIntervalMs: 60_000,
    roleTools: { router: [...defaults.roleTools.router], worker: [...defaults.roleTools.worker], watchdog: [...defaults.roleTools.watchdog] },
  } as Config)
  const store = openStore({ dbPath: config.dbPath }); stores.push(store)
  const agents = new Map<string, any>()
  const listeners = new Map<string, (...args: any[]) => unknown>()
  const effects: Array<() => void | Promise<void>> = []
  let workerDisposeCount = 0
  let workerIndex = 0
  const main = (id: string) => ({
    id, ctx: {},
    inject: async (_message: unknown) => undefined,
    steer: async (_message: unknown) => undefined,
    followup: async (_message: unknown) => undefined,
  })
  const ctx: any = {
    effect(factory: () => () => void | Promise<void>) { effects.push(factory()) },
    on(name: string, listener: (...args: any[]) => unknown) { listeners.set(name, listener); return () => listeners.delete(name) },
    agentPresets: { async mount() {}, composedPreset() { return 'dsh-superagent-router' } },
    agents: {
      get(id: string) { return agents.get(id) },
      async create(input: any) {
        if (options.createGate) await options.createGate.promise
        const agent = main(input.sessionId)
        agents.set(agent.id, agent)
        await input.setup?.({})
        return { agent, async dispose() { agents.delete(agent.id) } }
      },
    },
    subagents: {
      async startActivation(input: any) {
        const id = input.childId ?? `worker-${++workerIndex}`
        const child = { id, ctx: {}, steer: options.workerSteer ?? (async () => undefined) }
        agents.set(id, child)
        return {
          id: `activation-${id}`, childId: id, sessionId: id, agent: child,
          result: options.workerResult ? options.workerResult() : Promise.resolve({ structured: report }),
          async dispose() { workerDisposeCount++; agents.delete(id) },
        }
      },
      interrupt() {},
    },
    sessionQuery: { async readSession() { return { events: [], session: { agentPreset: 'dsh-superagent-router' } } } },
  }
  const runtime = createRuntime(ctx, store, config)
  return { ctx, config, store, runtime, agents, listeners, effects, main: () => [...agents.values()].find(agent => !String(agent.id).startsWith('worker-')), get workerDisposeCount() { return workerDisposeCount } }
}

async function flush(turns = 3) { for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setImmediate(resolve)) }
async function setupTicket(h: ReturnType<typeof makeHarness>) {
  await h.runtime.ready
  const router = h.main()!
  h.listeners.get('session/event')!({ id: router.id }, { type: 'user/message', time: Date.now(), data: { id: `m-${Math.random()}`, source: { kind: 'user' }, content: [{ type: 'text', text: 'start' }] } })
  await flush()
  const created = await h.runtime.invoke('ticket_create', { brief }, { agent: router }) as { code: string; ticketId: string }
  expect(created.code).toBe('SA_CREATED')
  return { router, ticketId: created.ticketId }
}

describe('runtime safety boundaries', () => {
  it('rejects Router commands from a non-main execution Agent even when the worker allowlist contains them', async () => {
    const h = makeHarness()
    await h.runtime.ready
    const foreign = { id: 'foreign-agent', ctx: {} }
    const result = await h.runtime.invoke('ticket_list', {}, { agent: foreign }) as { code: string }
    expect(result.code).toBe('SA_ROUTER_IDENTITY_REQUIRED')
    await h.runtime.dispose()
  })

  it('ends the Assignment and Ticket and clears the pointer when worker.result rejects', async () => {
    const h = makeHarness({ workerResult: async () => { throw new Error('activation failed') } })
    const { router, ticketId } = await setupTicket(h)
    const started = await h.runtime.invoke('assignment_start', { ticketId }, { agent: router }) as { code: string }
    expect(started.code).toBe('SA_STARTED')
    await flush(5)
    expect(h.store.repos.assignment.all()[0]).toMatchObject({ state: 'ended', ended_reason: 'result-failed' })
    expect(h.store.repos.ticket.get(ticketId)).toMatchObject({ state: 'ended', current_assignment: null, outcome: 'failed' })
    expect(h.workerDisposeCount).toBe(1)
    await h.runtime.dispose()
  })

  it('keeps a subscription trigger pending when Worker steer rejects, without acknowledging delivery', async () => {
    const workerResult = deferred<any>()
    const steer = deferred<void>()
    const h = makeHarness({ workerResult: () => workerResult.promise, workerSteer: () => steer.promise })
    const { router, ticketId } = await setupTicket(h)
    const started = await h.runtime.invoke('assignment_start', { ticketId }, { agent: router }) as { code: string }
    expect(started.code).toBe('SA_STARTED')
    const event = { id: 'subscription-message', source: { kind: 'user' }, content: [{ type: 'text', text: 'follow-up' }] }
    h.listeners.get('session/event')!({ id: router.id }, { type: 'user/message', time: Date.now(), data: event })
    await flush()
    steer.reject(new Error('worker unavailable'))
    await flush()
    const trigger = h.store.repos.trigger.all().find(row => row.external_id === event.id)!
    expect(h.store.repos.trigger_disposition.get(trigger.id)).toMatchObject({ delivered_to: null })
    expect(h.store.repos.thread_trigger.all().find(row => row.trigger_id === trigger.id)).toMatchObject({ state: 'pending' })
    workerResult.resolve({ structured: report })
    await flush(5)
    await h.runtime.dispose()
  })

  it('publishes an idle Channel notice once with no model wake and idempotent durable replay', async () => {
    const h = makeHarness(); await h.runtime.ready
    const router = h.main()!
    const events: any[] = []
    let injected = 0, woke = 0
    h.ctx.sessionQuery.readSession = async () => ({ events })
    router.inject = async (message: any) => { injected++; events.push({ type: 'agent/inbox/spliced', data: { inserted: [message] } }) }
    router.followup = () => { woke++ }; router.steer = () => { woke++ }
    h.listeners.get('session/event')!({ id: router.id }, { type: 'user/message', time: Date.now(), data: { id: 'human-channel', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } })
    await flush()
    const request = () => h.runtime.invoke('channel_reply', { threadKey: `session:${router.id}`, body: 'Safe notice Bearer confidential123' }, { agent: router, callId: 'channel-idempotency' })
    await request(); await request()
    expect(injected).toBe(1); expect(woke).toBe(0)
    expect(events[0].data.inserted[0]).toMatchObject({ id: 'channel-idempotency', source: { kind: 'superagent-channel' } })
    expect(JSON.stringify(events)).not.toContain('confidential123')
    expect(h.store.repos.outbound.all()).toHaveLength(1)
    expect(h.store.repos.outbound.all()[0]?.state).toBe('sent')
    await h.runtime.dispose()
  })

  it('keeps an outbound pending when Router inject rejects instead of recording sent', async () => {
    const h = makeHarness()
    await h.runtime.ready
    const router = h.main()!
    h.listeners.get('session/event')!({ id: router.id }, { type: 'user/message', time: Date.now(), data: { id: 'thread-message', source: { kind: 'user' }, content: [{ type: 'text', text: 'thread' }] } })
    await flush()
    router.inject = async () => { throw new Error('inject failed') }
    h.runtime.engine.enqueue({ channel: 'session', threadKey: `session:${router.id}` as any, body: 'reply', kind: 'reply', idempotencyKey: 'outbound-test' })
    const result = await h.runtime.engine.drainOutbox()
    expect(result.sent).toBe(0)
    expect(h.store.repos.outbound.all()[0]).toMatchObject({ state: 'pending', attempts: 1 })
    await h.runtime.dispose()
  })

  it('disposes before ready and waits for in-flight source processing before store shutdown', async () => {
    const createGate = deferred<void>()
    const steer = deferred<void>()
    const workerResult = deferred<any>()
    const h = makeHarness({ createGate, workerResult: () => workerResult.promise, workerSteer: () => steer.promise })
    const disposing = h.runtime.dispose()
    let finished = false
    void disposing.then(() => { finished = true })
    await flush()
    expect(finished).toBe(false)
    createGate.resolve(undefined)
    // No source callback is active in this first runtime; readiness may now settle.
    await disposing
    expect(h.agents.size).toBe(0)

    // A second runtime demonstrates that an already-running source callback cannot
    // touch a store after disposal has completed.
    const h2 = makeHarness({ workerResult: () => workerResult.promise, workerSteer: () => steer.promise })
    const { router, ticketId } = await setupTicket(h2)
    await h2.runtime.invoke('assignment_start', { ticketId }, { agent: router })
    h2.listeners.get('session/event')!({ id: router.id }, { type: 'user/message', time: Date.now(), data: { id: 'late-source', source: { kind: 'user' }, content: [{ type: 'text', text: 'late' }] } })
    await flush()
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on('unhandledRejection', onUnhandled)
    const disposing2 = h2.runtime.dispose()
    let finished2 = false
    void disposing2.then(() => { finished2 = true })
    await flush()
    expect(finished2).toBe(false)
    // Release the in-flight source callback while disposal is quiescing it.
    steer.resolve(undefined)
    workerResult.resolve({ structured: report })
    await disposing2
    h2.store.close()
    await flush(5)
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })
})
