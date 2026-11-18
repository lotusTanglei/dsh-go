import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStore } from '../src/store/index.js'
import { defaults, resolveConfig, type Config } from '../src/config.js'
import { createRuntime } from '../src/runtime.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function harness(code: string, explicit = false) {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'superagent-main-recovery-')))
  cleanups.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('superagent-main-recovery-')) throw new Error('unexpected fixture'); rmSync(dir, { recursive: true, force: true }) })
  const config = resolveConfig({ ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [], roleTools: defaults.roleTools, ...(explicit ? { mainSessionId: 'gone-router' } : {}) } as Config)
  const store = openStore({ dbPath: config.dbPath }); cleanups.push(() => store.close())
  store.repos.kv.insert({ k: 'mainSessionId', v: 'gone-router' })
  const agents = new Map<string, any>(), resumed: string[] = [], created: string[] = []
  const runtime = createRuntime({ effect() {}, on() { return () => {} }, agentPresets: { async mount() {}, composedPreset() { return 'dsh-superagent-router' } }, agents: { get(id) { return agents.get(id) }, async resume(input) { resumed.push(input.resumeSessionId); throw new Error('unexpected resume') }, async create(input) { created.push(input.sessionId); const agent = { id: input.sessionId, ctx: {}, async inject() {}, async steer() {}, async followup() {} }; await input.setup({}); agents.set(agent.id, agent); return { agent, async dispose() { agents.delete(agent.id) } } } }, subagents: { async startActivation() { throw new Error('no model fixture') } }, sessionQuery: { async readSession() { throw Object.assign(new Error('synthetic storage problem'), { code }) } } }, store, config)
  cleanups.push(() => runtime.dispose())
  return { runtime, store, agents, created, resumed }
}

describe('closeout deleted-main-session recovery', () => {
  it('recreates an absent persisted Router and replaces the binding without any model request', async () => {
    const h = harness('SESSION_QUERY_SESSION_NOT_FOUND')
    await h.runtime.ready
    const binding = h.store.repos.kv.get('mainSessionId')?.v
    expect(typeof binding).toBe('string'); expect(binding).not.toBe('gone-router')
    expect(h.created).toEqual([binding]); expect(h.resumed).toEqual([])
    expect(h.runtime.sources.all()).toHaveLength(1)
    expect(h.runtime.sources.all()[0]!.id).toBe(`session:${binding}`)
    expect(h.store.repos.audit.all()).toEqual([expect.objectContaining({ action: 'main_session_recreated' })])
    await h.runtime.dispose()
    mkdirSync('probes/closeout', { recursive: true })
    writeFileSync('probes/closeout/c-faults-main-session.json', JSON.stringify({ case: 'deleted-persisted-main', recordedAt: new Date().toISOString(), boundary: 'Runtime startup with real SQLite and explicit fake Host SESSION_QUERY_SESSION_NOT_FOUND; no real session deletion or running-main failover claimed', priorBinding: 'gone-router', newBinding: binding, created: h.created, resumed: h.resumed, liveAgents: h.agents.size, realModelCalls: 0 }, null, 2) + '\n')
    expect(h.agents.size).toBe(0)
  })
  it.each(['SESSION_QUERY_CORRUPT_SESSION', 'SESSION_QUERY_PERSISTENCE_FAILED'])('does not replace history on %s', async code => {
    const h = harness(code)
    await expect(h.runtime.ready).rejects.toMatchObject({ code })
    expect(h.created).toEqual([]); expect(h.store.repos.kv.get('mainSessionId')?.v).toBe('gone-router')
    expect(await h.runtime.panelPorts.health()).toMatchObject({ ok: false, runtime: { state: 'failed' } })
  })
  it('does not silently replace an explicitly configured missing Router', async () => {
    const h = harness('SESSION_QUERY_SESSION_NOT_FOUND', true)
    await expect(h.runtime.ready).rejects.toMatchObject({ code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    expect(h.created).toEqual([])
  })
})
