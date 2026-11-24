import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaults, resolveConfig, type Config } from '../../src/config.js'
import { createRuntime, type RuntimeContext } from '../../src/runtime.js'
import { openStore, type Store } from '../../src/store/index.js'
import type { TicketBrief } from '../../src/domain/ticket.js'
import type { Report } from '../../src/engine/report.js'
import type { AdmissionPlanDTO } from '../../src/workspace/admission.js'
import { commandDigest, type CommandRecord, type WorkspaceCommand } from '../../src/workspace/commands.js'
import type { ActivationResult, Spawner, SpawnActivationInput } from '../../src/sessions/worker.js'
import { installPanelRoutes } from '../../src/panel/routes.js'

type Message = { id: string; role: string; content: Array<{ type: string; text: string }>; source: { kind: string; form?: string } }
type Event = { type: string; seq: number; time: number; data: any }
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(ok => { resolve = ok })
  return { promise, resolve }
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const brief = (goal = 'Scoped workspace fixture'): TicketBrief => ({
  goal, scope: { repo: '/tmp/superagent-workspace-fixture', subdirs: ['src'] },
  base: { ref: 'main', requireCleanTree: true }, allowWrite: ['src/**'], denyWrite: ['secrets/**'], runtime: 'node',
  acceptance: [{ id: 'A1', kind: 'assertion', check: 'Return structured fixture evidence' }],
  outOfScope: ['deploy'], blockers: [], firstAction: 'Inspect scoped fixture', approvalsRequired: [],
})
const report = (extra: Partial<Report> = {}): Report => ({
  state: 'ready', done: ['Scoped change complete'], todo: [], changedPaths: ['src/fixture.ts'],
  acceptance: [{ id: 'A1', result: 'passed', evidence: 'Focused synthetic assertion passed' }],
  risks: ['Synthetic Host only; not a live-provider proof'], needHuman: [], ...extra,
})
const approve = (plan: AdmissionPlanDTO) => ({ epoch: plan.epoch, requestId: plan.requestId, planId: plan.planId, fingerprint: plan.fingerprint, decision: 'approve' as const })
// Drain only the already scheduled fake-Host/runtime tasks. No clock sleeps or providers.
async function drainTasks() { for (let i = 0; i < 4; i++) await new Promise<void>(done => setImmediate(done)) }

/** Real on-disk SQLite + explicit fake Host. No provider/service is reachable. */
function fixture(options: { production?: boolean; config?: Partial<Config>; sessionWork?: { records: any[]; values: Map<string, Record<string, unknown>>; reads: string[]; denied?: Set<string>; projects?: Array<{id:string;title:string;sessionIds:string[]}> } } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'workspace-runtime-')))
  const config = resolveConfig({ ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [],
    confirm: 'always', watchdogIntervalMs: 60_000, ...options.config } as Config)
  let store: Store = openStore({ dbPath: config.dbPath })
  const agents = new Map<string, any>(), logs = new Map<string, Event[]>()
  const inbox: Record<'next-turn' | 'next-step', Message[]> = { 'next-turn': [], 'next-step': [] }
  const listeners = new Map<string, Set<(...args: any[]) => unknown>>()
  const missingSessions = new Set<string>()
  const interruptions: Array<{ id: string; ticketState?: unknown; currentAssignment?: unknown; assignmentState?: unknown; endedReason?: unknown }> = []
  const calls = { followup: [] as Message[], inject: [] as Message[], realActivation: vi.fn(), model: vi.fn(), modelCall: vi.fn(), listProviders: vi.fn(), listModels: vi.fn(), resume: vi.fn(), cancel: vi.fn(), history: vi.fn(), snapshots: [] as Array<{ id: string; keys: string[] }> }
  let durable = true, modelVerified = true, turns = 0, modelWait: (() => Promise<void>) | undefined
  const append = (id: string, type: string, data: unknown) => {
    const events = logs.get(id)!
    const event = { type, data, seq: events.length, time: Date.now() }
    events.push(event)
    for (const listener of listeners.get('session/event') ?? []) listener({ id }, event)
    return event
  }
  const workerHandles: Array<{ id: string; input: SpawnActivationInput; result: Deferred<ActivationResult>; messages: Message[]; disposed: boolean }> = []
  const fakeSpawner: Spawner = {
    async startActivation(input) {
      const id = input.childId!, result = deferred<ActivationResult>()
      const worker = { id, input, result, messages: [] as Message[], disposed: false }
      const agent = { id, session: { id }, ctx: {}, steer(value: Message) { worker.messages.push(value); append(id, 'user/message', value) } }
      logs.set(id, []); agents.set(id, agent); workerHandles.push(worker)
      return { childId: id, sessionId: id, agent, result: result.promise, async dispose() {
        worker.disposed = true; agents.delete(id); result.resolve({ stopReason: 'aborted' })
      } }
    },
  }
  let router: any
  const ctx: RuntimeContext = {
    workspaceRegistry: { list: () => options.sessionWork?.projects ?? [] },
    remoteAccess: { allows({id}) { return !options.sessionWork?.denied?.has(id) } },
    sessionProjections: { snapshot(session, keys) {
      expect([['title','goal','todos','agentTeam','userQuestions'], ['userQuestions']]).toContainEqual([...keys])
      calls.snapshots.push({ id: session.id, keys: [...keys] })
      const values = options.sessionWork?.values.get(session.id) ?? {}
      // Honor the selected projection keys; no full transcript or settled answers are read.
      return { asOfSeq: 3, values: Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])) }
    } },
    effect(factory) { return factory() },
    on(name, callback) {
      const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(callback)
      return () => { set.delete(callback) }
    },
    agentPresets: { async mount() {}, composedPreset() { return 'dsh-superagent-router' } },
    agentDefaultModel: { currentSelection() { return { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'medium' } } },
    llm: { listProviders() { calls.listProviders(); return [{ id: 'fake-provider', name: 'Fake provider' }] },
      async listModels(provider) { calls.listModels(provider); return ['fake-model', 'stage-model'].map(id => ({ provider, id, name: id })) },
      async resolveModelInfo(provider, model) {
      calls.model(provider, model)
      if (modelWait) await modelWait()
      if (!modelVerified) throw new Error('fake model is unavailable')
      return { provider, id: model, name: 'Verified fake model', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } }
    } },
    sessions: { async flush() { return durable } },
    agents: {
      get(id) { return agents.get(id) },
      async resume(input) { calls.resume(input); throw new Error('unexpected fake Router resume') },
      async create(input) {
        logs.set(input.sessionId, [])
        inbox['next-turn'] = []; inbox['next-step'] = []; turns = 0
        const id = input.sessionId
        router = { id, ctx: {}, session: { id },
          model: { current() { return { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'medium' } } },
          // Host followup/inject are void; the committed splice is visible synchronously.
          followup(value: Message) {
            calls.followup.push(value)
            const start = inbox['next-turn'].length; inbox['next-turn'].push(value)
            append(router.id, 'agent/inbox/spliced', { target: 'next-turn', start, removedCount: 0, inserted: [value] })
          },
          inject(value: Message) {
            calls.inject.push(value)
            const start = inbox['next-step'].length; inbox['next-step'].push(value)
            append(router.id, 'agent/inbox/spliced', { target: 'next-step', start, removedCount: 0, inserted: [value] })
          },
        }
        agents.set(router.id, router); await input.setup?.({})
        return { agent: router, async dispose() { agents.delete(id) } }
      },
    },
    subagents: {
      async startActivation(input) { calls.realActivation(input); throw new Error('real Host activation forbidden in workspace tests') },
      interrupt(id) {
        const assignment = store.repos.assignment.all().find(row => row.session_id === id)
        const ticket = assignment ? store.repos.ticket.get(assignment.ticket_id) : undefined
        interruptions.push({ id, ticketState: ticket?.state, currentAssignment: ticket?.current_assignment, assignmentState: assignment?.state, endedReason: assignment?.ended_reason })
      },
    },
    sessionQuery: {
      async listSessions() { return options.sessionWork?.records ?? [] },
      async inspectSession(id, read) { options.sessionWork?.reads.push(id); return read({id}) },
      async readSession(id) {
      calls.history(id)
      const events = logs.get(id)
      if (!events || missingSessions.has(id)) throw Object.assign(new Error('missing fake session'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
      return { session: { id, agentPreset: 'dsh-superagent-router' }, events: [...events] }
    } },
  }
  // legacyInput is deliberately omitted: this exercises the new workspace path.
  let runtime = options.production ? createRuntime(ctx, store, config) : createRuntime(ctx, store, config, undefined, { spawner: fakeSpawner })
  cleanups.push(async () => {
    for (const worker of workerHandles) worker.result.resolve({ structured: report() })
    try { await runtime.dispose() } finally {
      store.close()
      const target = resolve(dir)
      if (target !== dir || !target.startsWith(realpathSync(tmpdir()) + '/') || !target.split('/').at(-1)!.startsWith('workspace-runtime-')) throw new Error('unsafe workspace fixture cleanup')
      rmSync(target, { recursive: true, force: true })
    }
  })
  return {
    get store() { return store }, get runtime() { return runtime }, calls, workers: workerHandles, interruptions,
    seedExternal(id: string) { const agent = { id, status: 'idle', model: { current: vi.fn(() => ({ provider: 'original-provider', model: 'original-model' })), set: vi.fn() }, answer: vi.fn(), steer: vi.fn(), followup: vi.fn() }; agents.set(id, agent); return agent },
    router: () => router, events: () => logs.get(router.id)!,
    restoreHistory(id: string) { missingSessions.delete(id) },
    seedLiveWorker(ticketId: string) {
      const assignmentId = `persisted:${randomUUID()}`, sessionId = `live:${randomUUID()}`
      store.repos.assignment.insert({ id: assignmentId, ticket_id: ticketId, session_id: sessionId, state: 'running', created_at: Date.now(), started_at: Date.now(), last_progress_at: Date.now(), steps: 0, tokens: 0, retries: 0, repeated_calls: 0 })
      expect(store.repos.ticket.updateByState(ticketId, 'open', 'running', { current_assignment: assignmentId, updated_at: Date.now() })).toBe(true)
      logs.set(sessionId, [])
      const agent = { id: sessionId, session: { id: sessionId }, ctx: {}, steer: vi.fn(), cancel: calls.cancel }
      agents.set(sessionId, agent)
      return { assignmentId, sessionId, agent }
    },
    setDurable(value: boolean) { durable = value }, setModelVerified(value: boolean) { modelVerified = value }, setModelWait(value: (() => Promise<void>) | undefined) { modelWait = value },
    async input(text = 'same task body', patch: Partial<WorkspaceCommand> = {}): Promise<WorkspaceCommand> {
      const workspace = await runtime.panelPorts.workspace()
      return { epoch: workspace.epoch, requestId: randomUUID(), intent: 'new-task', text, ...patch }
    },
    admit(receipt: { messageId: string }) {
      const value = inbox['next-turn'][0]
      if (value?.id !== receipt.messageId) throw new Error('fake next-turn admission must claim its actual queue head')
      const turn = ++turns
      append(router.id, 'turn/start', { turn })
      const pendingStep = inbox['next-step'].splice(0)
      if (pendingStep.length) append(router.id, 'agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: pendingStep.length, inserted: [] })
      inbox['next-turn'].shift()
      append(router.id, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
      append(router.id, 'step/start', { turn, step: 0 })
      for (const item of pendingStep) append(router.id, 'user/message', item)
      append(router.id, 'user/message', value)
    },
    endTurn() { append(router.id, 'turn/end', { turn: turns, reason: { kind: 'completed' } }) },
    async propose(taskBrief = brief()) {
      const result = await runtime.invoke('ticket_create', { brief: taskBrief }, { agent: router }) as { ok: boolean; code: string; plan: AdmissionPlanDTO }
      expect(result).toMatchObject({ ok: true, code: 'SA_CONFIRMATION_REQUIRED' })
      return result.plan
    },
    async task(goal = 'Scoped workspace fixture') {
      const input = await this.input(goal), receipt = await runtime.panelPorts.command(input)
      this.admit(receipt)
      const plan = await this.propose(brief(goal))
      const result = await runtime.panelPorts.admission(approve(plan))
      expect(result).toMatchObject({ state: 'consumed', ticketId: `ticket:admission:${plan.planId}` })
      this.endTurn()
      return { input, receipt, plan, ticketId: result.ticketId! }
    },
    async start(ticketId: string) {
      const result = await runtime.invoke('assignment_start', { ticketId }, { agent: router }) as { code: string; assignmentId: string }
      expect(result.code).toBe('SA_STARTED')
      return result.assignmentId
    },
    async restart(next: { production?: boolean; missingRouter?: boolean } = {}) {
      for (const worker of workerHandles) worker.result.resolve({ structured: report() })
      await runtime.dispose(); store.close()
      store = openStore({ dbPath: config.dbPath })
      if (next.missingRouter) {
        agents.delete(router.id); missingSessions.add(router.id)
      } else {
        // Restore exactly the same fake persisted Router; no model turn is started.
        agents.set(router.id, router)
      }
      runtime = next.production ? createRuntime(ctx, store, config) : createRuntime(ctx, store, config, undefined, { spawner: fakeSpawner })
      await runtime.ready
    },
  }
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function rasterPNG() {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff
    for (const byte of payload) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, payload, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('tEXt', Buffer.from('Comment\0exact original')), chunk('IDAT', deflateSync(Buffer.from([0, 23, 45, 67, 255]))), chunk('IEND', Buffer.alloc(0))])
}
async function targetInput(f: ReturnType<typeof fixture>, epoch: string) {
  const located = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Repair callback' })
  if (located.status !== 'located' || !located.target?.factRevision) throw new Error('Expected exact source target')
  return { sessionId: located.target.sessionId, scopeRevision: located.revision, factRevision: located.target.factRevision }
}
function observation(questions?: Record<string, unknown>) {
  const id = randomUUID()
  return { id, records: [{ header: { id, createdAt: 1 } }], reads: [] as string[], values: new Map<string, Record<string, unknown>>([[id, { title: 'Ordinary target', goal: { goal: { phase: 'active', objective: 'Repair callback' } }, ...(questions ? { userQuestions: questions } : {}) }]]), projects: [{ id: 'p', title: 'Project', sessionIds: [id] }] }
}
function settled(result: any, kind: string, requestId: string) {
  expect(result.mutation).toMatchObject({ version: 1, kind, requestId, state: 'settled', digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(result.value).toBeDefined()
  return result.value as any
}

describe('workspace runtime: real SQLite and explicitly fake Host contract', () => {
  it('G3 wires exact PNG originals and target binding without delivery, revoking even after scope restoration', async () => {
    const observations = observation(), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, target = await targetInput(f, epoch), original = rasterPNG()
    const uploaded: any = await f.runtime.panelPorts.images({ action: 'upload', epoch, draftId: randomUUID(), uploadId: randomUUID(), digest: sha(original), mediaType: 'image/png', encoded: original.toString('base64') })
    expect(uploaded).toMatchObject({ state: 'staged', original: true, uploadedNotSent: true }); expect(uploaded.target).toBeUndefined()
    const ref = (value: any) => ({ imageId: value.imageId, seq: value.seq, digest: value.digest })
    expect((await f.runtime.panelPorts.images({ action: 'original', epoch, reference: ref(uploaded) }) as any).bytes).toEqual(original)
    const bound: any = await f.runtime.panelPorts.images({ action: 'bind', epoch, reference: ref(uploaded), target })
    expect(bound).toMatchObject({ state: 'bound', target: { ...target, project: { kind: 'project', key: 'p' } }, uploadedNotSent: true })
    const removed = await f.runtime.panelPorts.sessionWork({ action: 'set-included', epoch, sessionId: observations.id, included: false, revision: target.scopeRevision })
    await expect(f.runtime.panelPorts.images({ action: 'original', epoch, reference: ref(bound) })).rejects.toMatchObject({ status: 409 })
    await f.runtime.panelPorts.sessionWork({ action: 'set-included', epoch, sessionId: observations.id, included: true, revision: removed.revision! })
    await expect(f.runtime.panelPorts.images({ action: 'original', epoch, reference: ref(bound) })).rejects.toMatchObject({ code: 'image_scope_changed', status: 409 })
    expect(await f.runtime.panelPorts.images({ action: 'release', epoch, reference: ref(bound) })).toMatchObject({ state: 'released', bytesRetained: true, thirdPartyErasureGuaranteed: false })
    expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled(); expect(f.calls.followup).toEqual([])
  })

  it('G5 saves journaled per-stage metadata using catalog APIs without changing an existing Agent model or running one', async () => {
    const observations = observation(), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const agent = f.seedExternal(observations.id), epoch = (await f.runtime.panelPorts.workspace()).epoch, originalModel = agent.model.current()
    const settings: any = await f.runtime.panelPorts.stageModels({ action: 'settings', epoch })
    expect(settings).toMatchObject({ config: null, catalog: [{ id: 'fake-provider', models: [{ id: 'fake-model' }, { id: 'stage-model' }] }], existingSessionModelPolicy: 'preserve', existingSessionOverride: 'unsupported' })
    expect(await f.runtime.panelPorts.stageModels({ action: 'inspect', epoch, provider: 'fake-provider', model: 'stage-model' })).toMatchObject({ provider: 'fake-provider', model: 'stage-model', reasoningEfforts: [{ id: 'medium' }] })
    const stages = Object.fromEntries(['locate', 'understand', 'plan', 'execute', 'summarize', 'verify'].map(stage => [stage, { mode: 'inherit' }]))
    stages.plan = { mode: 'override', selection: { provider: 'fake-provider', model: 'stage-model', reasoningEffort: 'medium' } } as any
    const requestId = randomUUID(), saved = await f.runtime.panelPorts.stageModels({ action: 'save', epoch, requestId, config: { revision: 0, default: { provider: 'fake-provider', model: 'fake-model' }, stages } })
    const value = settled(saved, 'stage-save', requestId)
    expect(value.config.stages.plan).toMatchObject({ mode: 'override', selection: { model: 'stage-model' } }); expect(value.catalog).toBeUndefined()
    expect(await f.runtime.panelPorts.configMutation({ action: 'status', epoch, requestId })).toEqual(saved)
    expect(agent.model.current()).toEqual(originalModel); expect(agent.model.set).not.toHaveBeenCalled()
    expect(f.calls.listProviders).toHaveBeenCalled(); expect(f.calls.listModels).toHaveBeenCalledWith('fake-provider'); expect(f.calls.model).toHaveBeenCalledWith('fake-provider', 'stage-model')
    expect(f.calls.modelCall).not.toHaveBeenCalled(); expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled()
  })

  it('snapshots a queued stage save before caller mutation so persisted config still matches the journal digest', async () => {
    const f = fixture({ production: true }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, entered = deferred<void>(), release = deferred<void>()
    const config = (revision: number) => ({ revision, default: { provider: 'fake-provider', model: 'fake-model' }, stages: Object.fromEntries(['locate', 'understand', 'plan', 'execute', 'summarize', 'verify'].map(stage => [stage, { mode: 'inherit' }])) })
    let first = true
    f.setModelWait(async () => { if (first) { first = false; entered.resolve(); await release.promise } })
    const earlier = f.runtime.panelPorts.stageModels({ action: 'save', epoch, requestId: randomUUID(), config: config(0) })
    await entered.promise
    const input = { action: 'save', epoch, requestId: randomUUID(), config: config(1) }, expected = structuredClone(input)
    const queued = f.runtime.panelPorts.stageModels(input); await drainTasks()
    input.config.default.model = 'stage-model'; release.resolve()
    expect((await earlier as any).mutation.state).toBe('settled')
    const receipt: any = await queued
    expect(receipt.mutation.state).toBe('settled'); expect(receipt.value.config.default.model).toBe('fake-model')
    const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(key => [key, sorted(v[key])])) : v
    expect(receipt.mutation.digest).toBe(sha(Buffer.from(JSON.stringify(sorted([epoch, expected.requestId, 'stage-save', { config: expected.config }])))))
    expect(await f.runtime.panelPorts.configMutation({ action: 'status', epoch, requestId: input.requestId })).toEqual(receipt)
  })
  it.each(['approval', 'plan-review'])('G6 never strips %s intent into an answerable business decision', async intent => {
    const observations = observation({ active: [{ callId: 'call-one', state: 'continued', questions: [{ id: 'q', question: 'Approve this?', intent }] }] }), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    f.seedExternal(observations.id)
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, target = await targetInput(f, epoch)
    expect(await f.runtime.panelPorts.sessionDecision({ action: 'list', epoch, target })).toMatchObject({ complete: false, calls: [], canAnswer: false, approval: false })
    expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled()
  })

  it.each(['live-continued', 'cold-continued', 'live-open'])('G6 exact bounded projection keeps %s non-dispatching and stores no answer text', async mode => {
    const observations = observation({ active: [{ callId: 'call-one', state: mode === 'live-open' ? 'open' : 'continued', questions: [{ id: 'q', question: 'Choose scope', options: [{ label: 'A' }] }] }], settled: [{ answers: ['PRIVATE HISTORY ANSWER'] }] }), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const agent = mode.startsWith('live') ? f.seedExternal(observations.id) : undefined
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, target = await targetInput(f, epoch)
    f.calls.history.mockClear(); f.calls.snapshots.length = 0
    const listed: any = await f.runtime.panelPorts.sessionDecision({ action: 'list', epoch, target })
    expect(listed).toMatchObject({ complete: true, availability: agent ? 'live' : 'cold', canAnswer: false, calls: [{ callId: 'call-one', canAnswer: false }] })
    expect(f.calls.snapshots.some(cut => cut.keys.length === 1 && cut.keys[0] === 'userQuestions')).toBe(true)
    expect(f.calls.snapshots.every(cut => cut.keys.join(',') === 'userQuestions' || cut.keys.join(',') === 'title,goal,todos,agentTeam,userQuestions')).toBe(true)
    expect(f.calls.history).not.toHaveBeenCalled(); expect(JSON.stringify(listed)).not.toContain('PRIVATE HISTORY ANSWER')
    const actionId = randomUUID(), input = { action: 'prepare', epoch, target, actionId, requestId: randomUUID(), callId: 'call-one', snapshot: { asOfSeq: listed.asOfSeq, revision: listed.snapshotRevision }, answers: [{ id: 'q', selected: ['A'], custom: 'PRIVATE EXACT ANSWER' }] }
    if (mode === 'live-continued') {
      const receipt = await f.runtime.panelPorts.sessionDecision(input)
      expect(receipt).toMatchObject({ state: 'blocked', code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', executed: false, completed: false, approval: false })
      const persisted = JSON.stringify(f.store.repos.side_effect.get(`session-decision:v1:${actionId}`))
      expect(persisted).not.toContain('PRIVATE EXACT ANSWER'); expect(persisted).not.toContain('Choose scope')
      expect(await f.runtime.panelPorts.sessionDecision({ action: 'status', epoch, actionId })).toEqual(receipt)
    } else await expect(f.runtime.panelPorts.sessionDecision(input)).rejects.toMatchObject({ code: mode === 'live-open' ? 'session_decision_not_continued' : 'session_decision_target_not_live' })
    await f.runtime.panelPorts.sessionWork({ action: 'set-included', epoch, sessionId: observations.id, included: false, revision: target.scopeRevision })
    observations.reads.length = 0; f.calls.snapshots.length = 0
    await expect(f.runtime.panelPorts.sessionDecision({ action: 'list', epoch, target })).rejects.toMatchObject({ status: 409 })
    expect(observations.reads).toEqual([]); expect(f.calls.snapshots).toEqual([])
    if (agent) { expect(agent.answer).not.toHaveBeenCalled(); expect(agent.steer).not.toHaveBeenCalled() }
    expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled(); expect(f.calls.modelCall).not.toHaveBeenCalled()
  })
  it('G6 closes an absent original answer ID through the production panel port without target activation or dispatch', async () => {
    const f = fixture({ production: true }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, input = { epoch, requestId: randomUUID(), actionId: randomUUID(), target: { sessionId: 'missing-ordinary-session', scopeRevision: 'a'.repeat(64), factRevision: 'b'.repeat(64) }, callId: 'missing-call', snapshot: { asOfSeq: 4, revision: 'c'.repeat(64) }, answers: [{ id: 'q', selected: [], custom: 'PRIVATE EXACT ANSWER' }] }
    const closed = await f.runtime.panelPorts.sessionDecision({ action: 'close', ...input })
    expect(closed).toMatchObject({ state: 'closed', bindingVerified: false, durable: true, accepted: false, executed: null, completed: null, approval: false, target: input.target })
    expect(await f.runtime.panelPorts.sessionDecision({ action: 'status', epoch, actionId: input.actionId })).toEqual(closed)
    expect(await f.runtime.panelPorts.sessionDecision({ action: 'prepare', ...input })).toEqual(closed)
    expect(JSON.stringify(closed)).not.toContain('PRIVATE EXACT ANSWER')
    expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled(); expect(f.calls.modelCall).not.toHaveBeenCalled()
  })
  it('isolates a failed or resyncing work preview from the normal workspace and human command path', async () => {
    const f=fixture({production:true}); await f.runtime.ready
    const source=f.runtime.sources.all().find(source=>source.kind==='session-work') as import('../../src/sources/session-work.js').SessionWorkSource
    vi.spyOn(source,'summary').mockRejectedValue(new Error('PRIVATE WORK PREVIEW FAILURE'))
    const workspace=await f.runtime.panelPorts.workspace()
    expect(workspace).toMatchObject({state:'ready',sessionWork:{state:'unavailable',total:null,items:[]}})
    expect(JSON.stringify(workspace)).not.toContain('PRIVATE WORK PREVIEW FAILURE')
    const receipt=await f.runtime.panelPorts.command(await f.input('Ordinary user request still works'))
    expect(receipt.accepted).toBe(true)
    expect(f.calls.realActivation).not.toHaveBeenCalled()
  })

  it('defaults to read-only ordinary session work and persists manual exclusion without a Ticket or Agent wake', async () => {
    const external=randomUUID(), fork=randomUUID(), child=randomUUID(), denied=randomUUID()
    const observations={records:[{header:{id:external,createdAt:3}},{header:{id:fork,parentSession:external,createdAt:2}},{header:{id:child,parentSession:external,origin:'subagent',createdAt:4}},{header:{id:denied,createdAt:1}}],
      values:new Map([[external,{title:'Ordinary work',goal:{goal:{objective:'Implement existing project request',phase:'active'},updatedAt:5},todos:[{content:'Check acceptance',status:'in_progress'}]}],[fork,{title:'Ordinary fork',userQuestions:{active:[{state:'continued',questions:[{question:'Choose the target project'}]}],settled:[{answers:['PRIVATE ANSWER']} ]}}]]), reads:[] as string[],denied:new Set([denied]),projects:[{id:'authoritative-project',title:'Existing project',sessionIds:[external,fork]}]}
    const f=fixture({production:true,sessionWork:observations}); await f.runtime.ready
    expect(observations.reads).toEqual([])
    const first=await f.runtime.panelPorts.workspace(), work=first.sessionWork!
    expect(work).toMatchObject({state:'ready',total:2,excludedTotal:0,scope:'current-host',defaultIncluded:true})
    expect(work.items.map(item=>item.sessionId)).toEqual([external,fork])
    expect(work.items[0]).toMatchObject({objective:'Implement existing project request',goalPhase:'active',runtime:'unavailable',progress:'Check acceptance'})
    expect(work.items[1]?.decision).toContain('Choose the target project')
    expect(work.items.every(row=>row.project.kind==='project'&&row.project.key==='authoritative-project')).toBe(true)
    expect(work.items[0]?.project).toEqual({kind:'project',key:'authoritative-project',name:'Existing project'})
    expect(JSON.stringify(work)).not.toContain('PRIVATE ANSWER')
    expect(observations.reads).not.toContain(child); expect(observations.reads).not.toContain(denied)
    await f.runtime.panelPorts.sessionWork({action:'set-included',epoch:first.epoch,sessionId:external,included:false,revision:work.revision!})
    await f.restart({production:true})
    observations.reads.length=0
    const after=await f.runtime.panelPorts.workspace()
    expect(after.sessionWork).toMatchObject({total:1,excludedTotal:1})
    expect(observations.reads).not.toContain(external)
    const excluded=await f.runtime.panelPorts.sessionWork({action:'list',epoch:after.epoch,view:'excluded'})
    if (!('items' in excluded) || !('scope' in excluded)) throw new Error('Expected excluded session page')
    expect(excluded.items[0]?.sessionId).toBe(external)
    expect(excluded.items[0]?.project).toEqual({kind:'project',key:'authoritative-project',name:'Existing project'})
    await f.runtime.panelPorts.sessionWork({action:'set-included',epoch:after.epoch,sessionId:external,included:true,revision:excluded.revision!})
    expect((await f.runtime.panelPorts.workspace()).sessionWork).toMatchObject({total:2,excludedTotal:0})
    expect(f.store.repos.ticket.all()).toHaveLength(0); expect(f.store.repos.trigger.all()).toHaveLength(0)
    expect(f.calls.followup).toEqual([]);expect(f.calls.inject).toEqual([]);expect(f.calls.realActivation).not.toHaveBeenCalled()
    await expect(f.runtime.panelPorts.sessionWork({action:'list',epoch:'old-epoch'})).rejects.toThrow('epoch_mismatch')
  })

  it('persists project scope and ABA fences through real SQLite restart, and lookup never dispatches', async () => {
    const one = randomUUID(), two = randomUUID()
    const observations = { records: [{ header: { id: one, createdAt: 2 } }, { header: { id: two, createdAt: 1 } }],
      values: new Map([[one, { title: 'First', goal: { goal: { phase: 'active', objective: 'Fix callback' } } }], [two, { title: 'Other', goal: { goal: { phase: 'active', objective: 'Check contract' } } }]]), reads: [] as string[],
      projects: [{ id: 'p-a', title: 'Project', sessionIds: [one, two] }, { id: 'empty', title: 'Empty', sessionIds: [] }] }
    const f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch
    const initial = await f.runtime.panelPorts.sessionWork({ action: 'projects', epoch })
    expect(initial).toMatchObject({ total: 2 })
    const child = await f.runtime.panelPorts.sessionWork({ action: 'set-included', epoch, sessionId: two, included: false, revision: initial.revision! })
    const excluded = await f.runtime.panelPorts.sessionWork({ action: 'set-project-included', epoch, projectId: 'p-a', included: false, revision: child.revision! })
    await f.restart({ production: true }); observations.reads.length = 0
    const after = await f.runtime.panelPorts.sessionWork({ action: 'projects', epoch })
    expect(after.revision).toBe(excluded.revision)
    expect(await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Fix callback', sessionId: one })).toMatchObject({ status: 'blocked', controlAvailable: false })
    expect(observations.reads).toEqual([])
    const restored = await f.runtime.panelPorts.sessionWork({ action: 'set-project-included', epoch, projectId: 'p-a', included: true, revision: after.revision! })
    expect(restored.revision).not.toBe(initial.revision)
    await expect(f.runtime.panelPorts.sessionWork({ action: 'set-included', epoch, sessionId: one, included: true, revision: initial.revision! })).rejects.toThrow('session_work_resync')
    const current = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Fix callback' })
    expect(current).toMatchObject({ status: 'located', target: { sessionId: one }, controlAvailable: false })
    expect(observations.reads).toEqual([one]); expect(observations.reads).not.toContain(two)
    expect(f.store.repos.ticket.all()).toEqual([]); expect(f.store.repos.trigger.all()).toEqual([]); expect(f.store.repos.assignment.all()).toEqual([])
    expect(f.calls.followup).toEqual([]); expect(f.calls.inject).toEqual([]); expect(f.calls.realActivation).not.toHaveBeenCalled()
    await expect(f.runtime.panelPorts.sessionLocate({ epoch: 'old', text: 'Fix callback' })).rejects.toThrow('epoch_mismatch')
  })

  it('prepares exact ordinary-session control metadata but keeps production blocked before cold activation or dispatch', async () => {
    const id = randomUUID(), observations = { records: [{ header: { id, createdAt: 1 } }], reads: [] as string[],
      values: new Map([[id, { title: 'Ordinary target', goal: { goal: { phase: 'active', objective: 'Repair callback' } } }]]), projects: [{ id: 'p', title: 'Project', sessionIds: [id] }] }
    const f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, located = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Repair callback' })
    if (located.status !== 'located' || !located.target?.factRevision) throw new Error('Expected verified target')
    const input = { epoch, requestId: randomUUID(), actionId: randomUUID(), operation: 'supplement' as const, text: 'Direct human request\nKeep exact Unicode：修复', target: { sessionId: id, scopeRevision: located.revision, factRevision: located.target.factRevision } }
    const result = await f.runtime.panelPorts.sessionAction({ action: 'prepare', input })
    expect(result).toMatchObject({ actionId: input.actionId, target: input.target, state: 'blocked', code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', accepted: false, executed: false, completed: false, durable: true })
    expect(JSON.stringify(result)).not.toContain(input.text)
    await f.restart({ production: true }); observations.reads.length = 0
    const status = await f.runtime.panelPorts.sessionAction({ action: 'status', epoch, actionId: input.actionId })
    expect(status).toEqual(result); expect(observations.reads).toEqual([])
    expect(await f.runtime.panelPorts.sessionAction({ action: 'prepare', input })).toEqual(result)
    await expect(f.runtime.panelPorts.sessionAction({ action: 'prepare', input: { ...input, text: input.text + '!' } })).rejects.toThrow('session_action_request_conflict')
    expect(observations.reads).toEqual([])
    expect(f.calls.followup).toEqual([]); expect(f.calls.inject).toEqual([]); expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled()
    expect(f.store.repos.ticket.all()).toEqual([]); expect(f.store.repos.trigger.all()).toEqual([]); expect(f.store.repos.assignment.all()).toEqual([])
    const stale = { ...input, requestId: randomUUID(), actionId: randomUUID() }
    observations.values.set(id, { title: 'Ordinary target', goal: { goal: { phase: 'active', objective: 'Changed facts after locate' } } })
    await expect(f.runtime.panelPorts.sessionAction({ action: 'prepare', input: stale })).rejects.toThrow('session_action_target_changed')
    await expect(f.runtime.panelPorts.sessionAction({ action: 'status', epoch, actionId: stale.actionId })).rejects.toThrow('session_action_not_found')
    observations.reads.length = 0
    const closed = await f.runtime.panelPorts.sessionAction({ action: 'close', input: stale })
    expect(closed).toMatchObject({ state: 'closed', actionId: stale.actionId, bindingVerified: false, target: stale.target, durable: true, executed: null, completed: null })
    expect(await f.runtime.panelPorts.sessionAction({ action: 'status', epoch, actionId: stale.actionId })).toEqual(closed)
    expect(await f.runtime.panelPorts.sessionAction({ action: 'prepare', input: stale })).toEqual(closed)
    expect(observations.reads).toEqual([]); expect(f.calls.resume).not.toHaveBeenCalled(); expect(f.calls.realActivation).not.toHaveBeenCalled()
  })

  it('is cold at ready and exposes workspace/conversation without waking a model or starting a Worker', async () => {
    const h = fixture(); await h.runtime.ready
    const workspace = await h.runtime.panelPorts.workspace()
    expect(workspace).toMatchObject({ state: 'ready', model: { available: true }, capabilities: { send: true, workerExecution: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } })
    expect(await h.runtime.panelPorts.conversation({ epoch: workspace.epoch })).toMatchObject({ items: [], hasMore: false })
    expect(h.calls.followup).toEqual([]); expect(h.calls.inject).toEqual([]); expect(h.workers).toEqual([])
    expect(h.calls.realActivation).not.toHaveBeenCalled()
    expect(h.calls.model).toHaveBeenCalledWith('fake-provider', 'fake-model')
    h.setModelVerified(false)
    expect(await h.runtime.panelPorts.workspace()).toMatchObject({ model: { available: false }, capabilities: { send: false } })
    await expect(h.runtime.panelPorts.command(await h.input())).rejects.toMatchObject({ code: 'model_unavailable', status: 503 })
    expect(h.calls.followup).toEqual([])
  })

  it('deduplicates same-ID tab retries, rejects changed body, and keeps same-body different IDs independent', async () => {
    const h = fixture(), a = await h.input(), b = await h.input()
    const [first, retry] = await Promise.all([h.runtime.panelPorts.command(a), h.runtime.panelPorts.command(a)])
    expect(first).toEqual(retry); expect(first).toMatchObject({ accepted: true, stage: 'queued' })
    await expect(h.runtime.panelPorts.command({ ...a, text: 'changed by another tab' })).rejects.toMatchObject({ code: 'request_conflict', status: 409 })
    const second = await h.runtime.panelPorts.command(b)
    expect(second.messageId).not.toBe(first.messageId); expect(h.calls.followup).toHaveLength(2)
    let conversation = await h.runtime.panelPorts.conversation({ epoch: a.epoch })
    expect(conversation.items.map(item => [item.id, item.stage])).toEqual([[first.messageId, 'queued'], [second.messageId, 'queued']])
    h.admit(first)
    const planA = await h.propose(brief('Task A'))
    const ticketA = await h.runtime.panelPorts.admission(approve(planA)); h.endTurn()
    h.admit(second)
    const planB = await h.propose(brief('Task B'))
    const ticketB = await h.runtime.panelPorts.admission(approve(planB)); h.endTurn()
    expect(ticketA.ticketId).not.toBe(ticketB.ticketId)
    const rows = h.store.repos.ticket.all()
    expect(rows).toHaveLength(2); expect(new Set(rows.map(row => row.thread_key)).size).toBe(2)
    expect(h.store.repos.decision.all().map(row => row.trigger_ids)).toEqual(expect.arrayContaining([
      [h.store.repos.trigger.all().find(row => row.external_id === first.messageId)!.id],
      [h.store.repos.trigger.all().find(row => row.external_id === second.messageId)!.id],
    ]))
    conversation = await h.runtime.panelPorts.conversation({ epoch: a.epoch, after: conversation.nextAfter })
    expect(conversation.items.map(item => [item.id, item.stage])).toEqual([[first.messageId, 'admitted'], [second.messageId, 'admitted']])
    expect(h.workers).toHaveLength(0); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('requires a trusted current new-task turn and approval of the exact immutable plan before one ticket exists', async () => {
    const h = fixture(), input = await h.input(), receipt = await h.runtime.panelPorts.command(input)
    expect(await h.runtime.invoke('ticket_create', { brief: brief() }, { agent: h.router() })).toMatchObject({ ok: false, code: 'no_active_command' })
    h.admit(receipt)
    expect(await h.runtime.invoke('ticket_create', { brief: brief() }, { agent: { id: h.router().id } })).toMatchObject({ code: 'SA_ROUTER_IDENTITY_REQUIRED' })
    const plan = await h.propose()
    expect(h.store.repos.ticket.all()).toEqual([]); expect(h.store.repos.eval.all()).toEqual([])
    expect((await h.runtime.panelPorts.workspace()).admissions).toContainEqual(expect.objectContaining({ planId: plan.planId, state: 'pending' }))
    for (const patch of [{ fingerprint: '0'.repeat(64) }, { requestId: randomUUID() }, { epoch: randomUUID() }]) {
      await expect(h.runtime.panelPorts.admission({ ...approve(plan), ...patch })).rejects.toMatchObject({ status: 409 })
    }
    const consumed = await h.runtime.panelPorts.admission(approve(plan))
    expect(consumed).toMatchObject({ state: 'consumed', ticketId: `ticket:admission:${plan.planId}` })
    expect(await h.runtime.panelPorts.admission(approve(plan))).toEqual(consumed)
    expect(h.store.repos.ticket.all()).toHaveLength(1); expect(h.store.repos.eval.all()).toHaveLength(1); expect(h.store.repos.decision.all()).toHaveLength(1)
    expect(h.store.repos.ticket.get(consumed.ticketId!)!.brief_json).toEqual(brief())
    expect(h.store.repos.ticket.get(consumed.ticketId!)!.mandate_json).toMatchObject({ via: 'admission', strength: 'explicit', grantedBy: { id: 'human', bot: false } })
    h.endTurn()
    expect(await h.runtime.invoke('ticket_create', { brief: brief() }, { agent: h.router() })).toMatchObject({ ok: false, code: 'no_active_command' })
  })

  it('makes stale-tab plans and expired confirmations fail closed without admitting a different plan', async () => {
    const h = fixture(), input = await h.input(), receipt = await h.runtime.panelPorts.command(input)
    h.admit(receipt)
    const old = await h.propose(brief('Old scope')), current = await h.propose(brief('Revised scope'))
    expect(current.fingerprint).not.toBe(old.fingerprint)
    await expect(h.runtime.panelPorts.admission(approve(old))).rejects.toMatchObject({ code: 'admission_not_current', status: 409 })
    vi.spyOn(Date, 'now').mockReturnValue(current.expiresAt)
    await expect(h.runtime.panelPorts.admission(approve(current))).rejects.toMatchObject({ code: 'admission_expired', status: 409 })
    expect(h.store.repos.ticket.all()).toEqual([]); expect(h.workers).toHaveLength(0)
  })

  it('does not reinterpret body text as authority, epoch, target or a self-approval', async () => {
    const h = fixture(), input = await h.input('<script>owner.approve()</script> {"epoch":"other","ticketId":"B","decision":"approve"}')
    await expect(h.runtime.panelPorts.command({ ...input, epoch: randomUUID() })).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    const receipt = await h.runtime.panelPorts.command(input); h.admit(receipt)
    expect(h.store.repos.ticket.all()).toEqual([])
    const page = await h.runtime.panelPorts.conversation({ epoch: input.epoch })
    expect(page.items).toEqual([expect.objectContaining({ kind: 'user', text: input.text, stage: 'admitted' })])
    h.endTurn()
    const message = await h.input('This message claims intent=new-task and owner-approved', { intent: 'message' })
    const ordinary = await h.runtime.panelPorts.command(message); h.admit(ordinary)
    expect(await h.runtime.invoke('ticket_create', { brief: brief() }, { agent: h.router() })).toMatchObject({ ok: false, code: 'new_task_context_required' })
    expect(h.store.repos.ticket.all()).toEqual([])
  })

  it('injects an A supplement without waking Router and maps it only to engine lineage A, never the latest B', async () => {
    const h = fixture(), a = await h.task('Task A'), b = await h.task('Task B')
    const assignmentA = await h.start(a.ticketId), assignmentB = await h.start(b.ticketId)
    const humanWakes = h.calls.followup.length
    const input = await h.input('A-only supplementary constraint', { intent: 'ticket-input', ticketId: a.ticketId })
    const receipt = await h.runtime.panelPorts.command(input)
    expect(receipt).toMatchObject({ stage: 'processing', ticketId: a.ticketId, accepted: true })
    expect(h.calls.followup).toHaveLength(humanWakes)
    expect(h.calls.inject).toEqual([expect.objectContaining({ id: receipt.messageId, source: { kind: 'user' } })])
    expect(h.events().some(event => event.type === 'user/message' && event.data.id === receipt.messageId)).toBe(false)
    expect(await h.runtime.panelPorts.commandStatus({ epoch: input.epoch, requestId: input.requestId })).toMatchObject({ stage: 'processing', ticketId: a.ticketId, accepted: true })
    const trigger = h.store.repos.trigger.all().find(row => row.external_id === receipt.messageId)!
    expect(trigger.thread_key).toBe(h.store.repos.ticket.get(a.ticketId)!.thread_key)
    expect(h.store.repos.trigger_disposition.get(trigger.id)).toMatchObject({ ticket_id: a.ticketId, delivered_to: assignmentA })
    expect(h.workers[0]!.messages).toEqual([expect.objectContaining({ id: trigger.id, content: [{ type: 'text', text: input.text }] })])
    expect(h.workers[1]!.messages).toEqual([])
    expect(h.store.repos.assignment.get(assignmentB)).toMatchObject({ ticket_id: b.ticketId, state: 'running' })
    expect(h.store.repos.ticket.all()).toHaveLength(2)
    expect((await h.runtime.panelPorts.conversation({ epoch: input.epoch })).items).toContainEqual(expect.objectContaining({ id: receipt.messageId, kind: 'user', text: input.text }))
    await h.runtime.panelPorts.command(input)
    expect(h.calls.inject).toHaveLength(1); expect(h.workers[0]!.messages).toHaveLength(1)

    // The next genuine new task may claim the already-directed next-step input too.
    // That historical supplement must not make its trusted next-turn context ambiguous.
    const next = await h.input('Independent Task C'), nextReceipt = await h.runtime.panelPorts.command(next)
    h.admit(nextReceipt)
    const plan = await h.propose(brief('Independent Task C'))
    expect(plan.requestId).toBe(next.requestId)
    expect(h.store.repos.ticket.all()).toHaveLength(2)
    expect(h.workers[0]!.messages).toHaveLength(1); expect(h.workers[1]!.messages).toEqual([])
  })

  it('keeps false-flush input pending then recovers its unique splice after SQLite reopen without re-followup', async () => {
    const h = fixture(), input = await h.input(); h.setDurable(false)
    const receipt = await h.runtime.panelPorts.command(input)
    expect(receipt).toMatchObject({ stage: 'queued', accepted: false, code: 'durability_unavailable' })
    h.admit(receipt)
    expect(await h.runtime.panelPorts.commandStatus({ epoch: input.epoch, requestId: input.requestId })).toMatchObject({ accepted: false })
    expect(h.store.repos.trigger.all()).toEqual([])
    h.setDurable(true); await h.restart()
    expect(await h.runtime.panelPorts.command(input)).toMatchObject({ messageId: receipt.messageId, stage: 'processing', accepted: true })
    expect(h.calls.followup).toHaveLength(1)
    expect(h.store.repos.trigger.all()).toEqual([expect.objectContaining({ external_id: receipt.messageId })])
    const page = await h.runtime.panelPorts.conversation({ epoch: input.epoch })
    expect(page.items.filter(item => item.id === receipt.messageId)).toEqual([expect.objectContaining({ stage: 'admitted' })])
  })

  it('publishes a structured acceptance summary through Outbox without another human message or model wake', async () => {
    const h = fixture(), task = await h.task(), assignmentId = await h.start(task.ticketId)
    const humanCalls = h.calls.followup.length
    h.workers[0]!.result.resolve({ structured: report() }); await drainTasks()
    expect(h.store.repos.ticket.get(task.ticketId)).toMatchObject({ state: 'ended', outcome: 'completed' })
    expect(h.store.repos.assignment.get(assignmentId)).toMatchObject({ state: 'ended', ended_reason: 'ready', report_json: report() })
    expect(h.store.repos.outbound.all()).toEqual([expect.objectContaining({ state: 'sent', ticket_id: task.ticketId, idempotency_key: `superagent-result:v1:${assignmentId}` })])
    const page = await h.runtime.panelPorts.conversation({ epoch: task.input.epoch })
    expect(page.items.filter(item => item.kind === 'notice')).toEqual([expect.objectContaining({ text: expect.stringContaining('A1: passed — Focused synthetic assertion passed') })])
    expect(page.items.find(item => item.kind === 'notice')!.text).toContain('Result: completed')
    expect(h.calls.followup).toHaveLength(humanCalls); expect(h.calls.inject).toHaveLength(1); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('retains unknown result delivery with false flush, then recovers exactly one notice and one Outbox row', async () => {
    const h = fixture(), task = await h.task(), assignmentId = await h.start(task.ticketId)
    h.setDurable(false)
    h.workers[0]!.result.resolve({ structured: report() }); await drainTasks()
    expect(h.store.repos.outbound.all()).toEqual([expect.objectContaining({ state: 'pending', idempotency_key: `superagent-result:v1:${assignmentId}` })])
    expect(h.calls.inject).toHaveLength(1)
    expect(h.store.repos.audit.all().filter(row => row.action === 'report_delivery_completed')).toEqual([])
    const originalMessageCount = h.calls.followup.length
    h.setDurable(true); await h.restart(); await h.runtime.tick()
    expect(h.store.repos.outbound.all()).toEqual([expect.objectContaining({ state: 'sent', idempotency_key: `superagent-result:v1:${assignmentId}` })])
    expect(h.calls.inject).toHaveLength(1); expect(h.calls.followup).toHaveLength(originalMessageCount)
    const page = await h.runtime.panelPorts.conversation({ epoch: task.input.epoch })
    expect(page.items.filter(item => item.kind === 'notice')).toHaveLength(1)
    expect(h.store.repos.audit.all().filter(row => row.action === 'report_delivery_completed')).toHaveLength(1)
  })

  it('rejects incomplete structured acceptance instead of announcing completed work', async () => {
    const h = fixture({ config: { maxRetries: 0 } }), task = await h.task(), assignmentId = await h.start(task.ticketId)
    h.workers[0]!.result.resolve({ structured: report({ acceptance: [] }) }); await drainTasks()
    expect(h.store.repos.assignment.get(assignmentId)).toMatchObject({ state: 'ended', ended_reason: 'invalid-report' })
    expect(h.store.repos.ticket.get(task.ticketId)).toMatchObject({ state: 'ended', outcome: 'failed' })
    expect(h.store.repos.audit.all()).toContainEqual(expect.objectContaining({ action: 'report_rejected', ticket_id: task.ticketId }))
    expect(h.store.repos.outbound.all()).toEqual([]); expect(h.calls.inject).toEqual([])
  })

  it('keeps a rejected admission terminal across status, exact resubmit and SQLite recovery while releasing its pending slot', async () => {
    const h = fixture({ production: true, config: { queueLimit: 1 } })
    const input = await h.input('Owner may reject this exact plan'), receipt = await h.runtime.panelPorts.command(input)
    h.admit(receipt)
    const plan = await h.propose(), reject = { ...approve(plan), decision: 'reject' as const }
    expect(h.store.repos.thread_trigger.all()).toEqual([expect.objectContaining({ state: 'pending' })])
    const rejected = await h.runtime.panelPorts.admission(reject)
    expect(rejected).toMatchObject({ planId: plan.planId, state: 'rejected' })
    h.endTurn()
    const assertTerminal = async () => {
      expect(await h.runtime.panelPorts.commandStatus({ epoch: input.epoch, requestId: input.requestId })).toMatchObject({ stage: 'rejected', accepted: true })
      expect(await h.runtime.panelPorts.command(input)).toMatchObject({ stage: 'rejected', messageId: receipt.messageId })
      expect(await h.runtime.panelPorts.admission(reject)).toEqual(rejected)
      expect(h.store.repos.thread_trigger.all()).toEqual([expect.objectContaining({ state: 'consumed' })])
      expect(h.store.repos.trigger_disposition.all()).toEqual([expect.objectContaining({ filtered: 'human-rejected-plan', decision_id: null, ticket_id: null })])
      expect(h.store.repos.ticket.all()).toEqual([]); expect(h.store.repos.eval.all()).toEqual([]); expect(h.store.repos.decision.all()).toEqual([])
    }
    await assertTerminal(); await h.runtime.tick(); await assertTerminal()
    await h.restart({ production: true }); await h.runtime.tick(); await assertTerminal()
    expect(h.calls.followup).toHaveLength(1); expect(h.calls.inject).toEqual([])
    const next = await h.input('Fresh request must fit the released one-slot queue')
    expect(await h.runtime.panelPorts.command(next)).toMatchObject({ accepted: true, stage: 'queued' })
    expect(h.calls.followup).toHaveLength(2)
  })

  it('persists an inherited live Worker ended before production ready interrupts it and keeps every start path closed', async () => {
    const h = fixture({ production: true }), task = await h.task('Persisted live work must be stopped safely')
    const inherited = h.seedLiveWorker(task.ticketId)
    expect(h.store.repos.assignment.get(inherited.assignmentId)).toMatchObject({ state: 'running' })
    await h.restart({ production: true })
    const observed = h.interruptions.filter(row => row.id === inherited.sessionId)
    expect(observed.length).toBeGreaterThan(0)
    expect(observed.every(row => row.ticketState === 'ended' && row.currentAssignment === null && row.assignmentState === 'ended')).toBe(true)
    expect(h.store.repos.assignment.get(inherited.assignmentId)).toMatchObject({ state: 'ended', ended_reason: 'execution-boundary-unverified' })
    expect(h.store.repos.ticket.get(task.ticketId)).toMatchObject({ state: 'ended', current_assignment: null, outcome: 'stopped' })
    expect(h.calls.cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(await h.runtime.startAssignment(task.ticketId)).toMatchObject({ ok: false, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
    expect(await h.runtime.invoke('assignment_start', { ticketId: task.ticketId }, { agent: h.router() })).toMatchObject({ ok: false, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
    const fresh = await h.task('Fresh approved work is still execution gated')
    expect(await h.runtime.startAssignment(fresh.ticketId)).toMatchObject({ ok: false, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
    await h.runtime.tick()
    expect(h.store.repos.assignment.all()).toHaveLength(1)
    expect(h.store.repos.ticket.get(fresh.ticketId)?.state).toBe('open')
    expect(h.calls.realActivation).not.toHaveBeenCalled(); expect(h.workers).toEqual([])
  })

  it('rotates a missing canonical Router epoch, keeps old history read-only and routes current-epoch input by archived ticket lineage', async () => {
    const h = fixture({ production: true }), a = await h.task('Archived task A'), b = await h.task('Archived task B')
    const previousId = h.router().id, oldEpoch = a.input.epoch
    const oldHistory = await h.runtime.panelPorts.conversation({ epoch: oldEpoch })
    await h.restart({ production: true, missingRouter: true })
    const workspace = await h.runtime.panelPorts.workspace()
    expect(h.router().id).not.toBe(previousId); expect(workspace.epoch).not.toBe(oldEpoch)
    expect(workspace.archiveEpochs).toContainEqual(expect.objectContaining({ epoch: oldEpoch }))
    expect(h.calls.resume).not.toHaveBeenCalled()
    expect(h.store.repos.audit.all()).toContainEqual(expect.objectContaining({ action: 'main_session_recreated' }))
    await expect(h.runtime.panelPorts.conversation({ epoch: oldEpoch })).rejects.toMatchObject({ code: 'history_unavailable', status: 503 })
    h.restoreHistory(previousId)
    expect((await h.runtime.panelPorts.conversation({ epoch: oldEpoch })).items).toEqual(oldHistory.items)
    expect(await h.runtime.panelPorts.commandStatus({ epoch: oldEpoch, requestId: a.input.requestId })).toMatchObject({ requestId: a.input.requestId, accepted: true })
    const wakes = h.calls.followup.length, injections = h.calls.inject.length
    await expect(h.runtime.panelPorts.command({ ...a.input, requestId: randomUUID() })).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    await expect(h.runtime.panelPorts.admission(approve(a.plan))).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    expect(h.calls.followup).toHaveLength(wakes); expect(h.calls.inject).toHaveLength(injections)

    const input = await h.input('Current epoch supplement belongs only to archived A', { intent: 'ticket-input', ticketId: a.ticketId })
    const receipt = await h.runtime.panelPorts.command(input)
    expect(receipt).toMatchObject({ accepted: true, stage: 'processing', ticketId: a.ticketId, epoch: workspace.epoch })
    const trigger = h.store.repos.trigger.all().find(row => row.external_id === receipt.messageId)!
    expect(trigger).toMatchObject({ source: `session:${previousId}`, thread_key: h.store.repos.ticket.get(a.ticketId)!.thread_key })
    expect(h.store.repos.trigger_disposition.get(trigger.id)).toMatchObject({ ticket_id: a.ticketId, delivered_to: null })
    expect(h.store.repos.thread_trigger.all().filter(row => row.trigger_id === trigger.id)).toEqual([expect.objectContaining({ thread_key: h.store.repos.ticket.get(a.ticketId)!.thread_key, state: 'pending' })])
    expect(h.store.repos.trigger_disposition.all().filter(row => row.ticket_id === b.ticketId)).toHaveLength(1)
    expect(h.calls.followup).toHaveLength(wakes); expect(h.calls.inject).toHaveLength(injections + 1)
    expect((await h.runtime.panelPorts.conversation({ epoch: oldEpoch })).items).toEqual(oldHistory.items)
    expect((await h.runtime.panelPorts.conversation({ epoch: workspace.epoch })).items).toEqual([expect.objectContaining({ id: receipt.messageId, text: input.text })])

    // A matching archived Source alone is insufficient: the exact Decision must
    // point to this ticket and thread, never another ticket selected by the client.
    h.store.db.prepare('UPDATE decision SET ticket_id=? WHERE id=?').run(b.ticketId, h.store.repos.ticket.get(a.ticketId)!.decision_id as string)
    const forged = await h.input('Must reject mismatched archived decision lineage', { intent: 'ticket-input', ticketId: a.ticketId })
    await expect(h.runtime.panelPorts.command(forged)).rejects.toMatchObject({ code: 'ticket_input_denied', status: 409 })
    expect(h.calls.inject).toHaveLength(injections + 1); expect(h.store.repos.ticket.all()).toHaveLength(2)
  })

  it('completes ordinary messages without task Triggers or leaked capacity across repeated one-slot turns', async () => {
    const h = fixture({ production: true, config: { queueLimit: 1 } })
    const messages: Array<{ requestId: string; messageId: string; epoch: string }> = []
    for (let i = 0; i < 7; i++) {
      const input = await h.input(`Ordinary coordinator chat ${i}`, { intent: 'message' })
      const receipt = await h.runtime.panelPorts.command(input)
      expect(receipt).toMatchObject({ accepted: true, stage: 'queued' })
      h.admit(receipt)
      expect(await h.runtime.panelPorts.commandStatus({ epoch: input.epoch, requestId: input.requestId })).toMatchObject({ stage: 'processing' })
      expect(h.store.repos.trigger.all()).toEqual([]); expect(h.store.repos.thread_trigger.all()).toEqual([])
      h.endTurn(); await h.runtime.tick()
      expect(await h.runtime.panelPorts.commandStatus({ epoch: input.epoch, requestId: input.requestId })).toMatchObject({ stage: 'published', accepted: true })
      expect(await h.runtime.panelPorts.command(input)).toMatchObject({ stage: 'published', messageId: receipt.messageId })
      messages.push({ requestId: input.requestId, messageId: receipt.messageId, epoch: input.epoch })
      if (i === 2) await h.restart({ production: true })
    }
    expect(h.store.repos.trigger.all()).toEqual([]); expect(h.store.repos.thread_trigger.all()).toEqual([])
    expect(h.store.repos.trigger_disposition.all()).toEqual([]); expect(h.store.repos.ticket.all()).toEqual([])
    expect(h.store.repos.eval.all()).toEqual([]); expect(h.store.repos.decision.all()).toEqual([])
    expect(h.calls.followup).toHaveLength(7); expect(h.calls.inject).toEqual([])
    expect((await h.runtime.panelPorts.conversation({ epoch: messages[0]!.epoch })).items.map(item => item.id)).toEqual(messages.map(item => item.messageId))
    expect(h.workers).toEqual([]); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('revises only the current exact owner plan without a new command or Trigger and approves only its replacement brief', async () => {
    const h = fixture({ production: true }), input = await h.input('One task whose pending plan may be refined')
    const receipt = await h.runtime.panelPorts.command(input); h.admit(receipt)
    const original = await h.propose(), identity = { epoch: original.epoch, requestId: original.requestId, planId: original.planId, fingerprint: original.fingerprint }
    h.endTurn()
    const patch = { goal: 'Owner revised goal', firstAction: 'Inspect the revised allowed file', allowWrite: ['src/revised.ts'], denyWrite: ['secrets/**', 'dist/**'],
      acceptance: [{ id: 'A2', kind: 'assertion' as const, check: 'Revised owner criterion passes' }], blockers: ['Require local fixture'], outOfScope: ['deploy', 'dependency upgrades'] }
    const before = { calls: h.calls.followup.length, triggers: h.store.repos.trigger.all(), commands: h.store.repos.side_effect.all().filter(row => row.kind === 'workspace-command-v1') }
    for (const forbidden of [{ scope: { repo: '/tmp/other', subdirs: [] } }, { actor: 'owner' }, { runtime: 'other' }, { base: { ref: 'other' } }]) {
      await expect(h.runtime.panelPorts.reviseAdmission({ ...identity, patch: forbidden })).rejects.toMatchObject({ code: 'invalid_input', status: 400 })
    }
    const revised = await h.runtime.panelPorts.reviseAdmission({ ...identity, patch })
    expect(revised).toMatchObject({ requestId: original.requestId, epoch: original.epoch, state: 'pending', brief: { ...original.brief, ...patch } })
    expect(revised.planId).not.toBe(original.planId); expect(revised.fingerprint).not.toBe(original.fingerprint)
    expect(revised.brief.scope).toEqual(original.brief.scope); expect(revised.brief.base).toEqual(original.brief.base); expect(revised.brief.runtime).toBe(original.brief.runtime)
    expect(h.store.repos.side_effect.get(`admission:${original.planId}`)?.state).toBe('superseded')
    expect(h.store.repos.trigger.all()).toEqual(before.triggers)
    expect(h.store.repos.side_effect.all().filter(row => row.kind === 'workspace-command-v1')).toEqual(before.commands)
    expect(h.calls.followup).toHaveLength(before.calls); expect(h.calls.inject).toEqual([])
    expect(h.store.repos.ticket.all()).toEqual([]); expect(h.store.repos.eval.all()).toEqual([])
    await expect(h.runtime.panelPorts.reviseAdmission({ ...identity, patch: { goal: 'Stale second tab' } })).rejects.toMatchObject({ code: 'admission_not_current', status: 409 })
    await expect(h.runtime.panelPorts.admission(approve(original))).rejects.toMatchObject({ code: 'admission_not_current', status: 409 })
    await expect(h.runtime.panelPorts.admission({ ...approve(revised), fingerprint: original.fingerprint })).rejects.toMatchObject({ code: 'admission_binding_mismatch', status: 409 })
    const consumed = await h.runtime.panelPorts.admission(approve(revised))
    expect(consumed).toMatchObject({ state: 'consumed', ticketId: `ticket:admission:${revised.planId}` })
    expect(h.store.repos.ticket.all()).toEqual([expect.objectContaining({ id: consumed.ticketId, brief_json: { ...original.brief, ...patch } })])
    expect(h.store.repos.trigger.all()).toHaveLength(1); expect(h.store.repos.decision.all()).toHaveLength(1)
    expect(h.calls.followup).toHaveLength(1); expect(h.workers).toEqual([]); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('expires a one-slot pending plan at its exact deadline and keeps the terminal release across tick and SQLite reopen', async () => {
    const h = fixture({ production: true, config: { queueLimit: 1, approvalTimeoutMs: 1000 } })
    const input = await h.input('Expire this one-slot confirmation'), receipt = await h.runtime.panelPorts.command(input)
    h.admit(receipt); const plan = await h.propose(); h.endTurn()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(plan.expiresAt - 1)
    await h.runtime.tick()
    expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('pending')
    clock.mockReturnValue(plan.expiresAt)
    await h.runtime.tick()
    const assertExpired = async () => {
      expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('expired')
      expect(await h.runtime.panelPorts.commandStatus({ epoch: input.epoch, requestId: input.requestId })).toMatchObject({ stage: 'rejected', accepted: true, code: 'admission_expired' })
      expect(await h.runtime.panelPorts.command(input)).toMatchObject({ stage: 'rejected', messageId: receipt.messageId, code: 'admission_expired' })
      expect(h.store.repos.thread_trigger.all()).toEqual([expect.objectContaining({ state: 'consumed' })])
      expect(h.store.repos.trigger_disposition.all()).toEqual([expect.objectContaining({ filtered: 'expired-plan', ticket_id: null })])
      await expect(h.runtime.panelPorts.admission(approve(plan))).rejects.toMatchObject({ code: 'admission_expired', status: 409 })
      expect(h.store.repos.ticket.all()).toEqual([]); expect(h.store.repos.eval.all()).toEqual([]); expect(h.store.repos.decision.all()).toEqual([])
    }
    await assertExpired(); await h.runtime.tick(); await assertExpired()
    await h.restart({ production: true }); await assertExpired()
    expect((await h.runtime.panelPorts.workspace()).pendingPlans).toBe(0)
    expect(h.calls.followup).toHaveLength(1)
    const nextInput = await h.input('Fresh work fits the expired slot'), nextReceipt = await h.runtime.panelPorts.command(nextInput)
    expect(nextReceipt).toMatchObject({ accepted: true, stage: 'queued' })
    h.admit(nextReceipt); const archivedPending = await h.propose(); h.endTurn()
    await h.restart({ production: true, missingRouter: true })
    expect((await h.runtime.panelPorts.workspace()).epoch).not.toBe(nextInput.epoch)
    expect(h.store.repos.side_effect.get(`admission:${archivedPending.planId}`)?.state).toBe('pending')
    clock.mockReturnValue(archivedPending.expiresAt)
    await h.runtime.tick()
    expect(h.store.repos.side_effect.get(`admission:${archivedPending.planId}`)?.state).toBe('expired')
    expect(await h.runtime.panelPorts.commandStatus({ epoch: nextInput.epoch, requestId: nextInput.requestId })).toMatchObject({ stage: 'rejected', code: 'admission_expired' })
    expect(h.store.repos.thread_trigger.all().every(row => row.state === 'consumed')).toBe(true)
    expect(h.store.repos.ticket.all()).toEqual([])
    expect(await h.runtime.panelPorts.command(await h.input('Current epoch reuses slot released by archived expiry'))).toMatchObject({ accepted: true, stage: 'queued' })
    expect(h.calls.followup).toHaveLength(3); expect(h.workers).toEqual([])
  })

  it('recreates a human-stopped archived task only as a fresh confirmed plan with durable origin and independent thread', async () => {
    const h = fixture({ production: true }), original = await h.task('Original requirement')
    h.store.repos.approval.insert({ id: 'old-task-approval', ticket_id: original.ticketId, kind: 'permission', summary: 'Old exact approval', payload_json: { branch: 'original' }, requested_by: 'fixture', created_at: Date.now(), state: 'approved' })
    expect(await h.runtime.panelPorts.stopTicket(original.ticketId, 'Owner stopped the original task')).toBe(true)
    const stopped = h.store.repos.ticket.get(original.ticketId)!
    expect(stopped).toMatchObject({ state: 'ended', stopped_by_human: 1, outcome: 'stopped', current_assignment: null })
    await h.restart({ production: true, missingRouter: true })
    expect((await h.runtime.panelPorts.workspace()).epoch).not.toBe(original.input.epoch)
    const input = await h.input('Re-evaluate the same requirement with a new brief', { recreateFrom: original.ticketId })
    const receipt = await h.runtime.panelPorts.command(input)
    const command = h.store.repos.side_effect.get(`workspace-command:v1:${input.requestId}`)!.detail as CommandRecord
    expect(command).toMatchObject({ originTicket: original.ticketId, threadKey: `workspace:${input.requestId}` })
    expect(command.threadKey).not.toBe(stopped.thread_key); expect(receipt.requestId).not.toBe(original.input.requestId)
    h.admit(receipt)
    const newBrief = { ...brief('Fresh interpretation of the same requirement'), scope: original.plan.brief.scope, firstAction: 'Inspect the stopped task scope afresh' }
    const plan = await h.propose(newBrief); h.endTurn()
    expect(plan).toMatchObject({ originTicket: original.ticketId, state: 'pending', brief: newBrief })
    expect(plan.planId).not.toBe(original.plan.planId); expect(plan.fingerprint).not.toBe(original.plan.fingerprint)
    expect(h.store.repos.ticket.all()).toHaveLength(1)
    expect(h.store.repos.ticket.get(original.ticketId)).toEqual(stopped)
    expect(h.store.repos.approval.all()).toEqual([expect.objectContaining({ id: 'old-task-approval', ticket_id: original.ticketId })])
    await h.restart({ production: true })
    expect((h.store.repos.side_effect.get(`workspace-command:v1:${input.requestId}`)!.detail as CommandRecord).originTicket).toBe(original.ticketId)
    expect((await h.runtime.panelPorts.workspace({ planId: plan.planId })).admissions).toEqual([expect.objectContaining({ originTicket: original.ticketId, state: 'pending' })])
    await expect(h.runtime.panelPorts.admission({ ...approve(plan), fingerprint: original.plan.fingerprint })).rejects.toMatchObject({ code: 'admission_binding_mismatch', status: 409 })
    expect(h.store.repos.ticket.all()).toHaveLength(1)
    const created = await h.runtime.panelPorts.admission(approve(plan))
    expect(created).toMatchObject({ state: 'consumed', originTicket: original.ticketId, ticketId: `ticket:admission:${plan.planId}` })
    const fresh = h.store.repos.ticket.get(created.ticketId!)!
    expect(fresh).toMatchObject({ state: 'open', stopped_by_human: 0, brief_json: newBrief })
    expect(fresh.thread_key).toBe(command.threadKey); expect(fresh.thread_key).not.toBe(stopped.thread_key)
    expect(h.store.repos.approval.all().filter(row => row.ticket_id === fresh.id)).toEqual([])
    expect(h.store.repos.ticket.get(original.ticketId)).toEqual(stopped)
    expect(h.store.repos.ticket.all()).toHaveLength(2)
    expect(h.calls.followup).toHaveLength(2); expect(h.workers).toEqual([]); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('rejects recreation from running, foreign or mismatched-lineage tickets and binds recreateFrom into request identity', async () => {
    const h = fixture({ production: true }), active = await h.task('Running is not a recreation source')
    h.seedLiveWorker(active.ticketId)
    const stopped = await h.task('Human-stopped owned source')
    await h.runtime.panelPorts.stopTicket(stopped.ticketId, 'Owner stopped this source')
    const originalThread = h.store.repos.ticket.get(stopped.ticketId)!.thread_key as string
    const decisionId = h.store.repos.ticket.get(stopped.ticketId)!.decision_id as string
    const baseline = { calls: h.calls.followup.length, triggers: h.store.repos.trigger.all().length, commands: h.store.repos.side_effect.all().filter(row => row.kind === 'workspace-command-v1').length }
    for (const recreateFrom of [active.ticketId, 'foreign-ticket-not-owned']) {
      await expect(h.runtime.panelPorts.command(await h.input('Must reject an ineligible source', { recreateFrom }))).rejects.toMatchObject({ code: 'ticket_recreate_denied', status: 409 })
    }
    h.store.db.prepare('UPDATE thread SET source=? WHERE key=?').run('session:foreign-canonical', originalThread)
    await expect(h.runtime.panelPorts.command(await h.input('Foreign source cannot authorize recreation', { recreateFrom: stopped.ticketId }))).rejects.toMatchObject({ code: 'ticket_recreate_denied', status: 409 })
    h.store.db.prepare('UPDATE thread SET source=? WHERE key=?').run(`session:${h.router().id}`, originalThread)
    h.store.db.prepare('UPDATE decision SET ticket_id=? WHERE id=?').run(active.ticketId, decisionId)
    await expect(h.runtime.panelPorts.command(await h.input('Tampered decision cannot authorize recreation', { recreateFrom: stopped.ticketId }))).rejects.toMatchObject({ code: 'ticket_recreate_denied', status: 409 })
    h.store.db.prepare('UPDATE decision SET ticket_id=? WHERE id=?').run(stopped.ticketId, decisionId)
    await expect(h.runtime.panelPorts.command(await h.input('A supplement is not a new-task recreation', { intent: 'ticket-input', ticketId: stopped.ticketId, recreateFrom: stopped.ticketId }))).rejects.toMatchObject({ code: 'invalid_command', status: 400 })
    expect(h.calls.followup).toHaveLength(baseline.calls); expect(h.store.repos.trigger.all()).toHaveLength(baseline.triggers)
    expect(h.store.repos.side_effect.all().filter(row => row.kind === 'workspace-command-v1')).toHaveLength(baseline.commands)

    const plain = await h.input('Identity binds the explicit origin')
    const legacyDigest = createHash('sha256').update(JSON.stringify([plain.epoch, plain.intent, plain.text, null])).digest('hex')
    expect(commandDigest(plain)).toBe(legacyDigest)
    const recreation = { ...plain, recreateFrom: stopped.ticketId }
    expect(commandDigest(recreation)).not.toBe(legacyDigest)
    await h.runtime.panelPorts.command(recreation)
    await expect(h.runtime.panelPorts.command(plain)).rejects.toMatchObject({ code: 'request_conflict', status: 409 })
    expect(h.calls.followup).toHaveLength(baseline.calls + 1)
    expect(h.store.repos.ticket.get(stopped.ticketId)).toMatchObject({ state: 'ended', stopped_by_human: 1 })
    expect(h.store.repos.ticket.get(active.ticketId)?.state).toBe('running')
    expect(h.store.repos.ticket.all()).toHaveLength(2); expect(h.workers).toEqual([]); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('never promotes synthetic fake-Spawner execution permission into the production runtime', async () => {
    const h = fixture({ production: true }), task = await h.task()
    expect(await h.runtime.invoke('assignment_start', { ticketId: task.ticketId }, { agent: h.router() })).toMatchObject({ ok: false, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
    await h.runtime.tick()
    expect(h.store.repos.ticket.get(task.ticketId)?.state).toBe('open')
    expect(h.store.repos.assignment.all()).toEqual([]); expect(h.workers).toEqual([]); expect(h.calls.realActivation).not.toHaveBeenCalled()
  })

  it('confirms exact pre-delivery content through the panel seam with zero Fake Host effects before and after', async () => {
    const observations = observation(), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const agent = f.seedExternal(observations.id)
    const epoch = (await f.runtime.panelPorts.workspace()).epoch
    const located: any = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Repair callback' })
    expect(located.status).toBe('located')
    const target = { sessionId: located.target.sessionId, scopeRevision: located.revision, factRevision: located.target.factRevision }
    const input = { epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'continue' as const, text: 'Continue the exact human request\n保留原字节 🧭', target, images: [] }
    const prepared: any = await f.runtime.panelPorts.delivery({ action: 'prepare', ...input })
    expect(prepared).toMatchObject({ epoch, requestId: input.requestId, confirmationId: input.confirmationId, operation: 'continue',
      target: { ...target, project: { kind: 'project', key: 'p' } }, state: 'prepared', humanConfirmed: false, delivered: false, accepted: false, executed: false, completed: false, disposition: 'not-confirmed', durable: true })
    expect(prepared.bodyBytes).toBe(Buffer.byteLength(input.text, 'utf8')); expect(prepared.digest).toMatch(/^[a-f0-9]{64}$/)
    const zeroEffects = () => {
      expect(f.calls.followup).toEqual([]); expect(f.calls.inject).toEqual([])
      expect(f.calls.realActivation).not.toHaveBeenCalled(); expect(f.calls.resume).not.toHaveBeenCalled()
      expect(f.store.repos.ticket.all()).toEqual([]); expect(f.store.repos.trigger.all()).toEqual([]); expect(f.store.repos.assignment.all()).toEqual([])
      expect(agent.followup).not.toHaveBeenCalled(); expect(agent.steer).not.toHaveBeenCalled(); expect(agent.answer).not.toHaveBeenCalled()
    }
    zeroEffects()
    expect(JSON.stringify(f.store.repos.side_effect.all())).not.toContain('Continue the exact human request')
    const confirmed: any = await f.runtime.panelPorts.delivery({ action: 'confirm', ...input })
    expect(confirmed).toMatchObject({ state: 'confirmed', humanConfirmed: true, delivered: false, accepted: false, executed: false, completed: false, disposition: 'confirmed-pending-delivery', seq: 2 })
    zeroEffects()
    expect(await f.runtime.panelPorts.delivery({ action: 'status', epoch, confirmationId: input.confirmationId })).toEqual(confirmed)
    expect(await f.runtime.panelPorts.delivery({ action: 'confirm', ...input })).toEqual(confirmed)
    zeroEffects()
    await expect(f.runtime.panelPorts.delivery({ action: 'cancel', epoch, confirmationId: input.confirmationId })).rejects.toMatchObject({ code: 'delivery_confirmation_confirmed', status: 409 })
    await f.restart({ production: true, missingRouter: true })
    await expect(f.runtime.panelPorts.delivery({ action: 'status', epoch, confirmationId: input.confirmationId })).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    zeroEffects()
  })

  it('invalidates a prepared confirmation when target facts, body or bound images change', async () => {
    const observations = observation(), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, target = await targetInput(f, epoch)
    const base = { epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'supplement' as const, text: 'Exact supplement body', target, images: [] as any[] }
    await f.runtime.panelPorts.delivery({ action: 'prepare', ...base })
    await expect(f.runtime.panelPorts.delivery({ action: 'confirm', ...base, text: 'Edited supplement body' })).rejects.toMatchObject({ code: 'delivery_confirmation_changed', status: 409 })
    observations.values.set(observations.id, { title: 'Ordinary target', goal: { goal: { phase: 'active', objective: 'Changed facts after prepare' } } })
    await expect(f.runtime.panelPorts.delivery({ action: 'confirm', ...base })).rejects.toMatchObject({ code: 'delivery_target_changed', status: 409 })
    expect((await f.runtime.panelPorts.delivery({ action: 'status', epoch, confirmationId: base.confirmationId }) as any).state).toBe('prepared')
    observations.values.set(observations.id, { title: 'Ordinary target', goal: { goal: { phase: 'active', objective: 'Repair callback' } } })
    const original = rasterPNG(), uploadId = randomUUID()
    const uploaded: any = await f.runtime.panelPorts.images({ action: 'upload', epoch, draftId: randomUUID(), uploadId, digest: sha(original), mediaType: 'image/png', encoded: original.toString('base64') })
    const reference = { imageId: uploaded.imageId, seq: uploaded.seq, digest: uploaded.digest }
    const bound: any = await f.runtime.panelPorts.images({ action: 'bind', epoch, reference, target })
    const withImage = { ...base, requestId: randomUUID(), confirmationId: randomUUID(), images: [{ imageId: bound.imageId, digest: bound.digest, seq: bound.seq }] }
    await f.runtime.panelPorts.delivery({ action: 'prepare', ...withImage })
    await expect(f.runtime.panelPorts.delivery({ action: 'confirm', ...withImage, images: [] })).rejects.toMatchObject({ code: 'delivery_confirmation_changed', status: 409 })
    expect(await f.runtime.panelPorts.delivery({ action: 'confirm', ...withImage })).toMatchObject({ state: 'confirmed', delivered: false })
    const second = { ...base, requestId: randomUUID(), confirmationId: randomUUID(), images: [{ imageId: bound.imageId, digest: bound.digest, seq: bound.seq }] }
    await f.runtime.panelPorts.delivery({ action: 'prepare', ...second })
    expect(await f.runtime.panelPorts.images({ action: 'release', epoch, reference: { imageId: bound.imageId, seq: bound.seq, digest: bound.digest } })).toMatchObject({ state: 'released' })
    await expect(f.runtime.panelPorts.delivery({ action: 'confirm', ...second })).rejects.toMatchObject({ code: 'delivery_image_changed', status: 409 })
    expect((await f.runtime.panelPorts.delivery({ action: 'status', epoch, confirmationId: second.confirmationId }) as any).state).toBe('prepared')
    expect(f.calls.followup).toEqual([]); expect(f.calls.inject).toEqual([]); expect(f.store.repos.ticket.all()).toEqual([])
  })

  it('keeps clarify and no_match non-selecting and creates no Worker, Ticket or delivery record', async () => {
    const one = randomUUID(), two = randomUUID()
    const observations = { records: [{ header: { id: one, createdAt: 2 } }, { header: { id: two, createdAt: 1 } }],
      values: new Map([[one, { title: 'Same work title' }], [two, { title: 'Same work title' }]]), reads: [] as string[],
      projects: [{ id: 'p', title: 'Project', sessionIds: [one, two] }] }
    const f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch
    const clarify: any = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Same work title' })
    expect(clarify).toMatchObject({ status: 'clarify', candidates: [{ sessionId: one }, { sessionId: two }], controlAvailable: false })
    expect(f.store.repos.side_effect.all().filter(row => String(row.kind).startsWith('delivery-'))).toEqual([])
    expect(f.store.repos.ticket.all()).toEqual([]); expect(f.store.repos.trigger.all()).toEqual([]); expect(f.store.repos.assignment.all()).toEqual([])
    const picked = clarify.candidates[0]
    const target = { sessionId: picked.sessionId, scopeRevision: clarify.revision, factRevision: picked.factRevision }
    const prepared: any = await f.runtime.panelPorts.delivery({ action: 'prepare', epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'continue', text: 'Human explicitly chose this candidate', target, images: [] })
    expect(prepared).toMatchObject({ state: 'prepared', target: { sessionId: one, scopeRevision: clarify.revision, factRevision: picked.factRevision } })
    const noMatch: any = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'No recorded work matches this sentence' })
    expect(noMatch.status).toBe('no_match'); expect(noMatch.candidates).toEqual([])
    expect(f.store.repos.side_effect.all().filter(row => String(row.kind).startsWith('delivery-'))).toHaveLength(1)
    expect(f.calls.followup).toEqual([]); expect(f.calls.inject).toEqual([]); expect(f.store.repos.ticket.all()).toEqual([]); expect(f.store.repos.assignment.all()).toEqual([])
    const excluded = await f.runtime.panelPorts.sessionWork({ action: 'set-included', epoch, sessionId: one, included: false, revision: target.scopeRevision })
    const blocked: any = await f.runtime.panelPorts.sessionLocate({ epoch, text: 'Same work title', sessionId: one })
    expect(blocked).toMatchObject({ status: 'blocked', code: 'target_not_available', controlAvailable: false })
    await expect(f.runtime.panelPorts.delivery({ action: 'prepare', epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'continue', text: 'Blocked target', target, images: [] })).rejects.toMatchObject({ code: 'delivery_target_changed', status: 409 })
    expect(f.store.repos.side_effect.all().filter(row => String(row.kind).startsWith('delivery-'))).toHaveLength(1)
    expect(excluded.revision).not.toBe(target.scopeRevision)
  })

  it('keeps same delivery request idempotent and rejects conflicting content without dispatch', async () => {
    const observations = observation(), f = fixture({ production: true, sessionWork: observations }); await f.runtime.ready
    const epoch = (await f.runtime.panelPorts.workspace()).epoch, target = await targetInput(f, epoch)
    const input = { epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'steer' as const, text: 'Exact corrective request', target, images: [] }
    const first: any = await f.runtime.panelPorts.delivery({ action: 'prepare', ...input })
    expect(await f.runtime.panelPorts.delivery({ action: 'prepare', ...input })).toEqual(first)
    await expect(f.runtime.panelPorts.delivery({ action: 'prepare', ...input, text: 'Different request content' })).rejects.toMatchObject({ code: 'delivery_request_conflict', status: 409 })
    await expect(f.runtime.panelPorts.delivery({ action: 'prepare', ...input, requestId: randomUUID(), confirmationId: input.confirmationId })).rejects.toMatchObject({ code: 'delivery_request_conflict', status: 409 })
    expect(f.store.repos.side_effect.all().filter(row => row.kind === 'delivery-confirmation-v1')).toHaveLength(1)
    expect(f.calls.followup).toEqual([]); expect(f.calls.inject).toEqual([]); expect(f.calls.realActivation).not.toHaveBeenCalled()
  })

})
