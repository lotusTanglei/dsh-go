import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/store/index.js'
import { resolveConfig, defaults } from '../src/config.js'
import { createRuntime, readWorkerSnapshot } from '../src/runtime.js'

const dirs: string[] = []
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }) })
describe('Host runtime wiring', () => {
  it('reports initialization failure without leaking the underlying error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'superagent-runtime-')); dirs.push(dir)
    const config = resolveConfig({ ...defaults, stateDir: dir, sources: [], roleTools: defaults.roleTools } as any)
    const store = openStore({ dbPath: config.dbPath })
    const runtime = createRuntime({ agents: { get() {}, async create() { throw new Error('/private/failure secret') } }, agentPresets: { async mount() {}, composedPreset() { return undefined } }, subagents: { async startActivation() {} }, sessionQuery: { async readSession() { return { events: [] } } }, effect() {}, on() { return () => {} } }, store, config)
    try {
      await expect(runtime.ready).rejects.toThrow('/private/failure secret')
      const health = await runtime.panelPorts.health()
      expect(health).toMatchObject({ ok: false, runtime: { state: 'failed', code: 'SA_RUNTIME_INITIALIZATION_FAILED' } })
      expect(JSON.stringify(health)).not.toContain('/private/failure')
    } finally { await runtime.dispose(); store.close() }
  })
  it('starts a cold Router without a model request, ingests only human input, creates a ticket and returns a Worker report to Router', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'superagent-runtime-')); dirs.push(dir)
    const config = resolveConfig({ ...defaults, stateDir: dir, confirm: 'never', sources: [], roleTools: defaults.roleTools } as any)
    const store = openStore({ dbPath: config.dbPath })
    const agents = new Map<string, any>(), listeners = new Map<string, any>(), injected: any[] = []
    const effects: any[] = []
    let modelRequests = 0
    const ctx: any = {
      effect(factory: any) { effects.push(factory()) }, on(event: string, listener: any) { listeners.set(event, listener); return () => listeners.delete(event) },
      agentPresets: { async mount() { return { id: 'dsh-superagent-router' } }, composedPreset() { return 'dsh-superagent-router' } },
      agents: { get(id: string) { return agents.get(id) }, async create(input: any) { const agent = { id: input.sessionId, ctx: {}, inject(m: any) { injected.push(m) }, steer() {}, followup() { modelRequests++ } }; agents.set(agent.id, agent); const commit = await input.setup({}); commit?.commit(); return { agent, async dispose() { agents.delete(agent.id) } } } },
      subagents: { async startActivation(input: any) { modelRequests++; const child = { id: input.childId, ctx: {} }; agents.set(child.id, child); return { childId: child.id, result: Promise.resolve({ structured: { state: 'ready', done: ['ok'], todo: [], changedPaths: [], acceptance: [{ id: 'A1', result: 'passed', evidence: 'fixture' }], risks: [], needHuman: [] } }), async dispose() { agents.delete(child.id) } } } },
      sessionQuery: { async readSession() { return { events: [] } } },
    }
    const runtime = createRuntime(ctx, store, config)
    await runtime.ready
    expect(modelRequests).toBe(0)
    expect(await runtime.panelPorts.health()).toMatchObject({ ok: true, runtime: { state: 'ready' } })
    const main = [...agents.values()][0]
    listeners.get('session/event')({ id: main.id }, { type: 'user/message', time: Date.now(), data: { id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: 'do fixture' }] } })
    await new Promise(resolve => setImmediate(resolve))
    expect(store.repos.trigger.all()).toHaveLength(1)
    const brief = { goal: 'Fixture', scope: { repo: dir, subdirs: [] }, base: { ref: 'main', requireCleanTree: false }, allowWrite: [], denyWrite: ['**'], runtime: 'test', acceptance: [{ id: 'A1', kind: 'assertion', check: 'ready' }], outOfScope: [], blockers: [], firstAction: 'report', approvalsRequired: [] }
    const accepted = await runtime.invoke('ticket_create', { brief }, { agent: main }) as any
    expect(accepted.code).toBe('SA_CREATED')
    await runtime.invoke('assignment_start', { ticketId: accepted.ticketId }, { agent: main })
    await new Promise(resolve => setImmediate(resolve))
    expect(store.repos.ticket.get(accepted.ticketId)?.outcome).toBe('completed')
    expect(injected).toHaveLength(1)
    expect(injected[0].source.kind).not.toBe('user')
    expect(modelRequests).toBe(1)
    const assignment = store.repos.assignment.all()[0]!
    expect(readWorkerSnapshot(store, String(assignment.session_id))?.assignment.state).toBe('ended')
    await runtime.dispose()
    for (const effect of effects.reverse()) await effect()
    expect(agents.size).toBe(0)
    store.close()
  })
})
