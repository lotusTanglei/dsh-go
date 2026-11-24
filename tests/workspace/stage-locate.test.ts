import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaults, resolveConfig, type Config } from '../../src/config.js'
import { createRuntime, type RuntimeContext } from '../../src/runtime.js'
import { openStore, type Store } from '../../src/store/index.js'
import { installPanelRoutes } from '../../src/panel/routes.js'
import { STAGES, type StageModelConfig } from '../../src/workspace/stage-models.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const pause = () => { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve }); return { promise, done } }
const sessionId = () => randomUUID()

interface SessionWorkFixture {
  readonly records: readonly any[]
  readonly values: Map<string, Record<string, unknown>>
  readonly projects: readonly { id: string; title: string; sessionIds: string[] }[]
  readonly reads: string[]
}
function observations(): { fixture: SessionWorkFixture; ids: { target: string; sibling: string; other: string } } {
  const target = sessionId(), sibling = sessionId(), other = sessionId()
  return {
    ids: { target, sibling, other },
    fixture: {
      records: [{ header: { id: target, createdAt: 3 } }, { header: { id: sibling, createdAt: 2 } }, { header: { id: other, createdAt: 1 } }],
      values: new Map<string, Record<string, unknown>>([
        [target, { title: '支付回调改造', goal: { goal: { phase: 'active', objective: '支付回调改造' } } }],
        [sibling, { title: '结算对账', goal: { goal: { phase: 'active', objective: '结算对账' } } }],
        [other, { title: '日志清理', goal: { goal: { phase: 'active', objective: '日志清理' } } }],
      ]),
      projects: [{ id: 'project-xinghe', title: '星河项目', sessionIds: [target, sibling] }],
      reads: [],
    },
  }
}
function stageConfig(revision = 0, provider = 'fake-provider', model = 'locate-model'): StageModelConfig {
  return { revision, default: { provider, model }, stages: Object.fromEntries(STAGES.map(stage => [stage, { mode: 'inherit' }])) as StageModelConfig['stages'] }
}

/** Real on-disk SQLite + explicitly fake Host and LLM; no provider or user session is reachable. */
function harness(options: { callable?: boolean; sessionWork?: SessionWorkFixture } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'stage-locate-runtime-')))
  const config = resolveConfig({ ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [], confirm: 'always', watchdogIntervalMs: 60_000 } as Config)
  const store: Store = openStore({ dbPath: config.dbPath })
  const agents = new Map<string, any>()
  const llmState = { prepareCalls: 0, streamCalls: 0, outputs: [] as string[], dispatched: [] as { provider: string; model: string }[], prepareGate: undefined as { readonly entered: ReturnType<typeof pause>; readonly release: ReturnType<typeof pause> } | undefined }
  const modelSet = vi.fn()
  const llm = {
    listProviders: () => [{ id: 'fake-provider', name: 'Fake provider' }, { id: 'strong-provider', name: 'Strong provider' }],
    async listModels(provider: string) { return [{ provider, id: provider === 'strong-provider' ? 'strong-model' : 'locate-model', name: 'Fake model' }] },
    async resolveModelInfo(provider: string, model: string) {
      if (provider === 'missing-provider') throw new Error('fake provider unavailable')
      return { provider, id: model, name: 'Fake model', inputModalities: ['text'], context: { contextWindow: 8192 } }
    },
    async prepareCall(proposed: any, signal: AbortSignal | undefined, configure: (controls: any, info: any) => any) {
      llmState.prepareCalls++
      if (llmState.prepareGate) { llmState.prepareGate.entered.done(); await llmState.prepareGate.release.promise }
      signal?.throwIfAborted()
      const output = llmState.outputs.shift() ?? JSON.stringify({ action: 'continue', confidence: 0.9, hints: { objective: '支付回调' } })
      const { provider, model, ...controls } = proposed
      const configured = configure(Object.freeze(controls), Object.freeze({ provider, id: model, name: 'Fake model', inputModalities: ['text'], context: { contextWindow: 8192 } }))
      const resolved = Object.freeze({ provider, model, ...configured })
      llmState.dispatched.push(resolved)
      let used = false
      return {
        config: resolved,
        stream(options: any) {
          if (used) throw new Error('prepared stream reused')
          used = true; llmState.streamCalls++
          expect(options.provider).toBe(resolved.provider); expect(options.model).toBe(resolved.model)
          return (async function* () { yield { type: 'text-delta', index: 0, text: output }; yield { type: 'finish', reason: { kind: 'stop' } } })()
        },
      }
    },
    stream() { return (async function* () {})() },
  }
  let router: any
  const work = options.sessionWork
  const ctx: RuntimeContext = {
    workspaceRegistry: { list: () => work?.projects ?? [] },
    remoteAccess: { allows: () => true },
    sessionProjections: {
      snapshot(session: any, keys) {
        const values = work?.values.get(String(session?.id ?? '')) ?? {}
        return { asOfSeq: 3, values: Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])) }
      },
    },
    effect(factory) { return factory() },
    on() { return () => {} },
    agentPresets: { async mount() {}, composedPreset() { return 'dsh-superagent-router' } },
    agentDefaultModel: { currentSelection() { return { provider: 'fake-provider', model: 'locate-model' } } },
    llm: (options.callable === false ? { ...llm, prepareCall: undefined, stream: undefined } : llm) as RuntimeContext['llm'],
    sessions: { async flush() { return true } },
    agents: {
      get(id) { return agents.get(id) },
      async create(input) {
        const id = input.sessionId
        router = { id, ctx: {}, session: { id }, model: { current: () => ({ provider: 'previous-provider', model: 'previous-model' }), set: modelSet } }
        agents.set(id, router); await input.setup?.({})
        return { agent: router, async dispose() { agents.delete(id) } }
      },
    },
    subagents: { async startActivation() { throw new Error('real activation forbidden in stage-locate tests') }, interrupt() {} },
    sessionQuery: {
      async listSessions() { return work?.records ?? [] },
      async inspectSession(id, read, signal) {
        if (!work?.values.has(id)) throw Object.assign(new Error('missing fake session'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
        work.reads.push(id)
        return read({ id })
      },
      async readSession() { return { session: { agentPreset: 'dsh-superagent-router' }, events: [] } },
    },
  }
  const runtime = createRuntime(ctx, store, config, undefined, { spawner: { async startActivation() { throw new Error('no worker') } } })
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const panel = installPanelRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => { routes.delete(route.path) } } } } }, store, {}, { ...runtime.panelPorts, settings: () => [] })
  cleanups.push(async () => {
    await panel.dispose()
    try { await runtime.dispose() } finally {
      store.close()
      if (!dir.startsWith(realpathSync(tmpdir()) + '/') || !dir.split('/').at(-1)!.startsWith('stage-locate-runtime-')) throw new Error('unexpected fixture cleanup directory')
      rmSync(dir, { recursive: true, force: true })
    }
  })
  const post = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
    const handler = routes.get(`/api/superagent/${path}`)
    if (!handler) throw new Error(`missing route ${path}`)
    const response = await handler(new Request(`http://owner.test/api/superagent/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }
  return {
    store, runtime, post, llmState, ids: work,
    agent: () => router,
    async epoch() { await runtime.ready; const value = (await runtime.panelPorts.workspace()).epoch; if (work) work.reads.length = 0; return value },
    async configure(epoch: string, model = 'locate-model', provider = 'fake-provider') {
      const requestId = randomUUID()
      const saved: any = await runtime.panelPorts.stageModels({ action: 'save', epoch, requestId, config: stageConfig(0, provider, model) })
      expect(saved.mutation.state).toBe('settled')
      return saved
    },
    async locate(epoch: string, text: string) { return post('stage-locate', { epoch, text }) },
  }
}

describe('stage locate through runtime + HTTP: real SQLite, fake LLM, existing evidence chain', () => {
  it('parses "继续某项目的工作" into a continue intent and locates the project session without leaking prompt or body', async () => {
    const observed = observations(), f = harness({ sessionWork: observed.fixture }), epoch = await f.epoch()
    const agent = f.agent()
    f.llmState.outputs.push(JSON.stringify({ action: 'continue', confidence: 0.92, hints: { project: '星河项目', objective: '支付回调' } }))
    await f.configure(epoch)
    const result = await f.locate(epoch, '继续星河项目的工作')
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, data: {
      version: 1, status: 'located',
      stage: { stage: 'locate', configVersion: 1, mode: 'inherit', provider: 'fake-provider', model: 'locate-model' },
      intent: { action: 'continue', confidence: 0.92 },
      receipt: { stage: 'locate', mode: 'inherit', configVersion: 1, config: { provider: 'fake-provider', model: 'locate-model' }, disclosure: { atomicProviderDispatch: false, window: 'authorization-to-provider-io', providerDispatchPermit: 'unavailable' } },
      locate: { status: 'located', target: { sessionId: observed.ids.target }, coverage: 'complete' },
    } })
    expect(result.body.data.receipt.callId).toMatch(/^stage-call:[0-9a-f-]{36}$/)
    expect(result.body.data.receipt.authorizationRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(f.llmState.streamCalls).toBe(1)
    // Candidate evidence stays metadata-only on this route; no raw session text, prompt or request echo.
    expect(JSON.stringify(result.body)).not.toContain('matchText')
    expect(JSON.stringify(result.body)).not.toContain('继续星河项目的工作')
    expect(JSON.stringify(result.body)).not.toContain('You convert one colloquial work request')
    expect(observed.fixture.reads).toContain(observed.ids.target)
    expect(observed.fixture.reads).not.toContain(observed.ids.other)
    // Existing session/Agent model is untouched.
    expect(agent.model.set).not.toHaveBeenCalled()
    expect(agent.model.current()).toEqual({ provider: 'previous-provider', model: 'previous-model' })
  })

  it('parses "问某事进展" into a progress intent and falls back to the existing factRevision evidence', async () => {
    const observed = observations(), f = harness({ sessionWork: observed.fixture }), epoch = await f.epoch()
    f.llmState.outputs.push(JSON.stringify({ action: 'progress', confidence: 0.81, hints: { objective: '支付回调' } }))
    await f.configure(epoch)
    const result = await f.locate(epoch, '支付回调的进展怎么样了')
    expect(result.body.data).toMatchObject({ status: 'located', intent: { action: 'progress' }, locate: { status: 'located', target: { sessionId: observed.ids.target } } })
    expect(result.body.data.locate.target.factRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(result.body.data.locate.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(f.llmState.streamCalls).toBe(1)
  })

  it('asks explicitly when the intent cannot be parsed or is low confidence and never auto-selects a target', async () => {
    const observed = observations(), f = harness({ sessionWork: observed.fixture }), epoch = await f.epoch()
    await f.configure(epoch)
    f.llmState.outputs.push('this is not json')
    const unreadable = await f.locate(epoch, '继续星河项目的工作')
    expect(unreadable.body.data).toMatchObject({ status: 'clarify', code: 'stage_locate_intent_invalid', intent: null, locate: null })
    expect(unreadable.body.data.target).toBeUndefined()
    expect(observed.fixture.reads).toEqual([])
    f.llmState.outputs.push(JSON.stringify({ action: 'continue', confidence: 0.2, hints: { objective: '支付回调' } }))
    const uncertain = await f.locate(epoch, '大概是那个吧')
    expect(uncertain.body.data).toMatchObject({ status: 'clarify', code: 'stage_locate_intent_low_confidence', locate: null })
    expect(uncertain.body.data.target).toBeUndefined()
    f.llmState.outputs.push(JSON.stringify({ action: 'continue', confidence: 0.9, hints: { project: '不存在的项目', objective: '支付回调' } }))
    const unmatched = await f.locate(epoch, '继续不存在的项目的工作')
    expect(unmatched.body.data).toMatchObject({ status: 'clarify', code: 'stage_locate_project_unmatched', locate: null })
    expect(unmatched.body.data.target).toBeUndefined()
    expect(observed.fixture.reads).toEqual([])
  })

  it('stays blocked and says to configure the stage model when locate is not configured', async () => {
    const observed = observations(), f = harness({ sessionWork: observed.fixture }), epoch = await f.epoch()
    const result = await f.locate(epoch, '继续星河项目的工作')
    expect(result.status).toBe(200)
    expect(result.body.data).toMatchObject({ status: 'blocked', code: 'stage_models_not_configured', stage: null, receipt: null, locate: null })
    expect(result.body.data.message).toContain('configure')
    expect(f.llmState.prepareCalls).toBe(0); expect(f.llmState.streamCalls).toBe(0)
    expect(observed.fixture.reads).toEqual([])
  })

  it('keeps the service blocked when the Host has no call surface instead of degrading to keyword matching', async () => {
    const observed = observations(), f = harness({ callable: false, sessionWork: observed.fixture }), epoch = await f.epoch()
    const result = await f.locate(epoch, '继续星河项目的工作')
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, code: 'stage_models_call_unavailable' })
    expect(observed.fixture.reads).toEqual([])
  })

  it('pins the in-flight configuration version while a later save routes only subsequent calls', async () => {
    const observed = observations(), f = harness({ sessionWork: observed.fixture }), epoch = await f.epoch()
    await f.configure(epoch)
    f.llmState.outputs.push(JSON.stringify({ action: 'continue', confidence: 0.9, hints: { objective: '支付回调' } }), JSON.stringify({ action: 'continue', confidence: 0.9, hints: { objective: '支付回调' } }))
    const gate = { entered: pause(), release: pause() }
    f.llmState.prepareGate = gate
    const inFlight = f.locate(epoch, '继续星河项目的工作')
    await gate.entered.promise
    const second: any = await f.runtime.panelPorts.stageModels({ action: 'save', epoch, requestId: randomUUID(), config: stageConfig(1, 'strong-provider', 'strong-model') })
    expect(second.mutation.state).toBe('settled')
    gate.release.done(); f.llmState.prepareGate = undefined
    const oldResult = await inFlight
    expect(oldResult.body.data).toMatchObject({ status: 'located', stage: { configVersion: 1, provider: 'fake-provider', model: 'locate-model' }, receipt: { configVersion: 1, config: { provider: 'fake-provider' } } })
    const next = await f.locate(epoch, '继续星河项目的工作')
    expect(next.body.data).toMatchObject({ status: 'located', stage: { configVersion: 2, provider: 'strong-provider', model: 'strong-model' }, receipt: { configVersion: 2, config: { provider: 'strong-provider' } } })
    expect(f.llmState.dispatched.map(entry => entry.provider)).toEqual(['fake-provider', 'strong-provider'])
  })

  it('rejects extra fields, missing text and stale epochs before any model call', async () => {
    const observed = observations(), f = harness({ sessionWork: observed.fixture }), epoch = await f.epoch()
    await f.configure(epoch)
    expect((await f.post('stage-locate', { epoch, text: '继续星河项目的工作', extra: true })).status).toBe(400)
    expect((await f.post('stage-locate', { epoch, text: '   ' })).status).toBe(400)
    expect((await f.post('stage-locate', { epoch, text: 'x', sessionId: observed.ids.target })).status).toBe(400)
    expect((await f.post('stage-locate', { epoch: 'stale-epoch', text: '继续星河项目的工作' })).status).toBe(409)
    expect(f.llmState.prepareCalls).toBe(0); expect(observed.fixture.reads).toEqual([])
  })
})
