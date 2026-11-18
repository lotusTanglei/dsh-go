import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, type Store } from '../../src/store/index.js'
import { installPanelRoutes, type PanelPorts } from '../../src/panel/routes.js'
import { defaults, resolveConfig, type Config } from '../../src/config.js'
import { effectiveSettings } from '../../src/panel/settings.js'

const cleanups: Array<() => void> = []
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean() })
function harness(ports: PanelPorts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-closeout-panel-'))
  const config = resolveConfig({ ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [], roleTools: defaults.roleTools } as Config)
  const store: Store = openStore({ dbPath: config.dbPath })
  cleanups.push(() => { store.close(); if (!dir.startsWith(join(tmpdir(), 'superagent-closeout-panel-'))) throw new Error('unexpected fixture path'); rmSync(dir, { recursive: true, force: true }) })
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  installPanelRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => {} } } } }, store, config, ports)
  return { store, config, async post(route: string, input: unknown = {}) { const result = await routes.get(`/api/superagent/${route}`)!(new Request(`http://localhost/api/superagent/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })); return { status: result.status, body: await result.json() as any } } }
}

describe('closeout four-page server projections', () => {
  it('uses persisted message/subscription counts, real Eval state and stable source grouping with paging', async () => {
    const h = harness()
    for (const [key, source, last, evaluation] of [['thread-b', 'source-z', 400, null], ['thread-a', 'source-a', 200, 'eval-a']] as const) h.store.repos.thread.insert({ key, source, ref_json: {}, created_at: 1, last_at: last, seq: 99, paused: false, evaluating: evaluation })
    h.store.repos.eval.insert({ id: 'eval-a', thread_key: 'thread-a', policy_version: 'v1', trigger_ids: [], started_at: 100, deadline: 500, state: 'running' })
    for (let index = 0; index < 2; index++) h.store.repos.trigger.insert({ id: `trigger-${index}`, source: 'source-a', external_id: `message-${index}`, thread_key: 'thread-a', actor_id: 'fixture', actor_bot: false, text: 'fixture', trust: 'human', addressed: 'direct', at: index })
    h.store.repos.thread_subscription.insert({ thread_key: 'thread-a', ticket_id: 'ticket-a' })
    const first = await h.post('threads', { limit: 1 })
    expect(first.body.data).toMatchObject({ next: '1', items: [{ key: 'thread-a', source: 'source-a', lastAt: 200, messageCount: 2, seq: 99, subscriptionCount: 1, hasSubscription: true, eval: { id: 'eval-a', state: 'running' } }] })
    const second = await h.post('threads', { limit: 1, cursor: first.body.data.next })
    expect(second.body.data).toEqual({ items: [expect.objectContaining({ key: 'thread-b', messageCount: 0, hasSubscription: false, eval: null })] })
    expect((await h.post('threads', { cursor: '-1' })).status).toBe(400)
  })

  it('returns actual DB bytes/version, last 20 snapshots, backlog and safe error codes', async () => {
    const h = harness({ health: () => ({ ok: true, runtime: { state: 'ready' }, watchdog: { lastAt: 42 } }), sources: () => [{ id: 'session:fixture', kind: 'session', attended: true, ok: true, lastAt: 123, paused: false }] })
    for (let index = 0; index < 25; index++) for (const outcome of ['requested', 'completed']) h.store.repos.audit.insert({ at: index + 10, actor: 'watchdog', action: 'watchdog', detail: { assignmentId: 'assignment-fixture', action: 'nudge', rule: 'stall', outcome, metrics: { at: 1000 + index, lastProgressAt: 500, steps: 1, tokens: 99, durationMs: 900, repeatedCalls: 2, waitingMs: 0 } } })
    h.store.repos.audit.insert({ at: 100, actor: 'fixture', action: 'runtime_error', detail: { code: 'SA_RUNTIME_FAILURE', secret: 'fixture-secret', text: '/Users/fixture/private.log' } })
    h.store.repos.outbound.insert({ id: 'outbound-fixture', thread_key: 'thread-fixture', channel: 'session', kind: 'notice', body: 'fixture notice', idempotency_key: 'idem-fixture', state: 'pending', attempts: 0, next_at: 0 })
    const health = (await h.post('health')).body.data
    expect(health).toMatchObject({ db: { version: 1 }, watchdog: { lastAt: 42 }, outbox: { pending: 1, dropped: 0 }, recentErrors: [{ at: 100, action: 'runtime_error', code: 'SA_RUNTIME_FAILURE' }], sources: [{ id: 'session:fixture', attended: true, paused: false, lastAt: 123 }] })
    expect(health.db.sizeBytes).toBeGreaterThan(0)
    expect(health.watchdog.decisions).toHaveLength(20)
    expect(health.watchdog.decisions[0]).toMatchObject({ at: 34, metrics: { at: 1024, lastProgressAt: 500, stallMs: 524, usage: 99, durationMs: 900, repeatedCalls: 2 } })
    expect(JSON.stringify(health)).not.toMatch(/fixture-secret|\/Users\/|private\.log|superagent\.sqlite/)
    expect((await h.post('health', { secret: 'forbidden' })).status).toBe(400)
  })

  it('keeps missing metrics unknown rather than coercing null timestamps to zero', async () => {
    const h = harness()
    h.store.repos.audit.insert({ at: 100, actor: 'watchdog', action: 'watchdog', detail: { action: 'nudge', outcome: 'completed', metrics: { at: 1000, lastProgressAt: null } } })
    expect((await h.post('health')).body.data.watchdog.decisions[0].metrics.stallMs).toBeNull()
  })

  it('does not advertise healthy runtime or guessed config origins when adapters are absent', async () => {
    const h = harness()
    expect((await h.post('health')).body.data).toMatchObject({ ok: false, runtime: { state: 'unavailable' } })
    const settings = (await h.post('settings')).body.data.effective
    expect(settings.every((row: any) => row.origin === 'unavailable')).toBe(true)
    expect(settings.find((row: any) => row.key === 'maxTokensPerTicket').value).toBe(defaults.maxTokensPerTicket)
    expect(JSON.stringify(settings)).not.toContain(h.config.stateDir)
  })

  it('preserves provenance and all public effective values through response sanitization', async () => {
    let settings: ReturnType<typeof effectiveSettings> = []
    const h = harness({ settings: () => settings })
    settings = effectiveSettings(h.config, { stateDir: h.config.stateDir, maxWorkers: 3, panelPollMs: { __jsExpr: 'Number(env.FIXTURE_POLL || 5000)' } })
    const response = (await h.post('settings')).body.data.effective
    expect(response).toHaveLength(settings.length)
    expect(response.find((row: any) => row.key === 'maxWorkers')).toMatchObject({ origin: 'patch', value: 3 })
    expect(response.find((row: any) => row.key === 'panelPollMs')).toMatchObject({ origin: 'environment', value: 5000 })
    expect(response.find((row: any) => row.key === 'maxTokensPerTicket')).toMatchObject({ origin: 'default', value: 2_000_000 })
    expect(response.find((row: any) => row.key === 'dbPath')).toMatchObject({ origin: 'derived', value: '[REDACTED_PATH]', redacted: true })
  })
})
