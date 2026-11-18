import { afterEach, describe, expect, it } from 'vitest'
import { writeEvidence } from '../evidence.js'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openStore, type Store } from '../../src/store/index.js'
import { defaults, resolveConfig, type Config } from '../../src/config.js'
import { createPolicy, sourceId, threadKey, ticketId } from '../../src/domain/index.js'
import { createTrigger } from '../../src/domain/trigger.js'
import { FakeSource } from '../../src/sources/fake.js'
import { ingestTrigger, type IntakeResult } from '../../src/engine/intake.js'
import { startEval, settleEval } from '../../src/engine/eval.js'
import { createRuntime } from '../../src/runtime.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function temporary() {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'superagent-closeout-concurrency-')))
  cleanup.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('superagent-closeout-concurrency-')) throw new Error('unexpected cleanup target'); rmSync(dir, { recursive: true, force: true }) })
  return dir
}
function store(): Store { const value = openStore({ dbPath: join(temporary(), 'state.sqlite') }); cleanup.push(() => value.close()); return value }
function evidence(name: string, value: Record<string, unknown>) {
  writeEvidence(`c-concurrency-${name}`, { case: name, recordedAt: new Date().toISOString(), mode: 'offline-real-product-sqlite-explicit-test-doubles', ...value })
}
function policy() {
  return createPolicy({ acceptedSources: [sourceId('inbox:closeout')], acceptMode: defaults.acceptMode, confirm: 'never', bots: defaults.bots, paused: defaults.paused, evalTimeoutMs: defaults.evalTimeoutMs, budgets: { maxWorkers: defaults.maxWorkers, maxStepsPerTicket: defaults.maxStepsPerTicket, maxTokensPerTicket: defaults.maxTokensPerTicket, maxDurationMsPerTicket: defaults.maxDurationMsPerTicket, maxRetries: defaults.maxRetries, queueLimit: defaults.queueLimit, watchdog: { intervalMs: defaults.watchdogIntervalMs, stallMs: defaults.stallMs, repeatCallThreshold: defaults.repeatCallThreshold } } })
}
const brief = { goal: 'Closeout concurrency fixture', scope: { repo: '/tmp/closeout-fixture-repo', subdirs: [] }, base: { ref: 'main', requireCleanTree: false }, allowWrite: [], denyWrite: ['**'], runtime: 'fixture', acceptance: [{ id: 'A1', kind: 'assertion' as const, check: 'Return fixture evidence' }], outOfScope: [], blockers: [], firstAction: 'Return fixture report', approvalsRequired: [] }
const readyReport = { state: 'ready', done: ['fixture'], todo: [], changedPaths: [], acceptance: [{ id: 'A1', result: 'passed', evidence: 'offline assertion' }], risks: [], needHuman: [] }
function input(index: number) {
  const source = sourceId('inbox:closeout')
  return createTrigger({ source, externalId: `message-${index}`, threadKey: threadKey(`thread-${index}`), actor: { id: 'fixture-human', source, bot: false }, text: `authorized fixture ${index}`, at: index + 1, trust: 'human', addressed: 'direct', raw: { fixture: index } })
}
function pending(value: Store) { return Number(value.db.prepare("SELECT COUNT(*) AS n FROM thread_trigger WHERE state = 'pending'").get()?.n) }

describe('CLOSE-OUT C2 offline concurrency and bounded capacity', () => {
  it('admits Promise.all 50 FakeSource arrivals once, then creates one real persisted Ticket per unique input', async () => {
    const s = store(), p = policy(), results: IntakeResult[] = []
    const start = performance.now(), rssStart = process.memoryUsage().rss
    let rssPeak = rssStart, maxPending = 0
    const source = new FakeSource(sourceId('inbox:closeout'), item => { results.push(ingestTrigger(s, item, { policy: p, queueLimit: defaults.queueLimit, now: () => 1000 })); maxPending = Math.max(maxPending, pending(s)); rssPeak = Math.max(rssPeak, process.memoryUsage().rss) })
    await source.start(); cleanup.push(() => source.stop())
    await Promise.all(Array.from({ length: 50 }, (_, index) => source.emit(input(index))))
    const firstResults = results.splice(0)
    await Promise.all(Array.from({ length: 50 }, (_, index) => source.emit(input(index))))
    const duplicates = results.splice(0)
    await Promise.all(Array.from({ length: 50 }, async (_, index) => {
      const evaluation = startEval(s, threadKey(`thread-${index}`), p, { now: () => 1000 })!
      settleEval(s, evaluation.id, { kind: 'accept', reason: 'fixture authorized', strength: 'explicit', ticket: { id: ticketId(`ticket-${index}`), title: `fixture ${index}`, brief, mandate: { strength: 'explicit', policyVersion: p.version, grantedBy: { id: 'fixture-human', source: sourceId('inbox:closeout'), bot: false }, at: 1001, scope: 'fixture', via: 'addressed', rules: [] }, workdir: `/tmp/closeout-fixture-ticket-${index}` } }, p, { now: () => 1001 })
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss)
    }))
    const summary = { submittedUnique: 50, replayed: 50, queueLimit: defaults.queueLimit, accepted: firstResults.filter(item => item.status === 'accepted').length, duplicates: duplicates.filter(item => item.status === 'duplicate').length, triggerCount: s.repos.trigger.all().length, dispositionCount: s.repos.trigger_disposition.all().length, ticketCount: s.repos.ticket.all().length, uniqueTicketCount: new Set(s.repos.ticket.all().map(row => row.id)).size, consumedCount: s.repos.thread_trigger.all().filter(row => row.state === 'consumed').length, maxPending, durationMs: performance.now() - start, rssStart, rssPeak, rssDeltaBytes: rssPeak - rssStart, peakScope: 'sampled after each ingest and settlement, not continuous OS peak', intake: firstResults, replay: duplicates }
    evidence('50', summary)
    expect(summary.accepted).toBe(50); expect(summary.duplicates).toBe(50)
    expect(summary.triggerCount).toBe(50); expect(summary.dispositionCount).toBe(50)
    expect(summary.ticketCount).toBe(50); expect(summary.uniqueTicketCount).toBe(50); expect(summary.consumedCount).toBe(50)
    expect(maxPending).toBeLessThanOrEqual(defaults.queueLimit)
  })

  it('retains every over-limit input durably and rejects only excess admission without increasing queueLimit', async () => {
    const s = store(), p = policy(), results: IntakeResult[] = []
    const count = defaults.queueLimit + 25, start = performance.now(), rssStart = process.memoryUsage().rss
    let maxPending = 0, rssPeak = rssStart
    const source = new FakeSource(sourceId('inbox:closeout'), item => { results.push(ingestTrigger(s, item, { policy: p, queueLimit: defaults.queueLimit, now: () => 1000 })); maxPending = Math.max(maxPending, pending(s)); rssPeak = Math.max(rssPeak, process.memoryUsage().rss) })
    await source.start(); cleanup.push(() => source.stop())
    await Promise.all(Array.from({ length: count }, (_, index) => source.emit(input(index))))
    const summary = { submitted: count, queueLimit: defaults.queueLimit, accepted: results.filter(item => item.status === 'accepted').length, rejected: results.filter(item => item.status === 'rejected').length, queueFullReasons: s.repos.trigger_disposition.all().filter(row => row.filtered === 'queue-full').length, triggerCount: s.repos.trigger.all().length, uniqueTriggerCount: new Set(s.repos.trigger.all().map(row => row.id)).size, dispositionCount: s.repos.trigger_disposition.all().length, pendingCount: pending(s), maxPending, ticketCount: s.repos.ticket.all().length, durationMs: performance.now() - start, rssStart, rssPeak, rssDeltaBytes: rssPeak - rssStart, peakScope: 'sampled after every ingest, not continuous OS peak', intake: results }
    evidence('overflow', summary)
    expect(summary.triggerCount).toBe(count); expect(summary.uniqueTriggerCount).toBe(count); expect(summary.dispositionCount).toBe(count)
    expect(summary.accepted).toBe(defaults.queueLimit); expect(summary.rejected).toBe(25); expect(summary.queueFullReasons).toBe(25)
    expect(summary.pendingCount).toBe(defaults.queueLimit); expect(maxPending).toBeLessThanOrEqual(defaults.queueLimit); expect(summary.ticketCount).toBe(0)
  })

  it('enforces default maxWorkers under simultaneous start requests and drains capacity with fake Workers only', async () => {
    const dir = temporary()
    const config = resolveConfig({ ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [], confirm: 'never', roleTools: defaults.roleTools } as Config)
    const s = openStore({ dbPath: config.dbPath }); cleanup.push(() => s.close())
    const agents = new Map<string, any>(), listeners = new Map<string, (...args: any[]) => any>()
    const workers: Array<{ id: string; settle(value: unknown): void; disposed: boolean }> = []
    let router: any, peakWorkers = 0, runtime: ReturnType<typeof createRuntime>
    const ctx: any = {
      sessions: { async flush() { return true } },
      on(name: string, callback: (...args: any[]) => any) { listeners.set(name, callback); return () => listeners.delete(name) },
      agentPresets: { async mount() {}, composedPreset() { return 'dsh-superagent-router' } },
      agents: { get(id: string) { return agents.get(id) }, async create(input: any) { router = { id: input.sessionId, ctx: {}, async inject() {}, async followup() {}, async steer() {} }; agents.set(router.id, router); await input.setup?.({}); return { agent: router, async dispose() { agents.delete(router.id) } } } },
      subagents: { async startActivation(input: any) { let settle!: (value: unknown) => void; const result = new Promise(resolve => { settle = resolve }); const worker = { id: input.childId, settle, disposed: false }; workers.push(worker); const agent = { id: worker.id, ctx: {}, async steer() {} }; agents.set(worker.id, agent); peakWorkers = Math.max(peakWorkers, workers.filter(item => !item.disposed).length); return { childId: worker.id, sessionId: worker.id, agent, result, async dispose() { worker.disposed = true; agents.delete(worker.id); settle({ stopReason: 'aborted' }) } } }, interrupt() {} },
      sessionQuery: { async readSession(sessionId: string) { return { sessionId, events: [], session: { agentPreset: 'dsh-superagent-router' } } } },
    }
    runtime = createRuntime(ctx, s, config, undefined, { spawner: ctx.subagents, legacyInput: true })
    let disposed = false
    cleanup.push(async () => { if (!disposed) await runtime.dispose() })
    await runtime.ready
    // Feed real engine acceptance per synthetic thread; no Router/model is asked to plan.
    // Recreate only the runtime's public config-derived policy (no DB pointer mutation).
    const runtimePolicy = createPolicy({ acceptedSources: config.sources.map(row => sourceId(row.id)), acceptMode: config.acceptMode, confirm: config.confirm, bots: config.bots, paused: config.paused, evalTimeoutMs: config.evalTimeoutMs, budgets: { maxWorkers: config.maxWorkers, maxStepsPerTicket: config.maxStepsPerTicket, maxTokensPerTicket: config.maxTokensPerTicket, maxDurationMsPerTicket: config.maxDurationMsPerTicket, maxRetries: config.maxRetries, queueLimit: config.queueLimit, watchdog: { intervalMs: config.watchdogIntervalMs, stallMs: config.stallMs, repeatCallThreshold: config.repeatCallThreshold } } })
    const accepted: Array<{ id: ReturnType<typeof ticketId> }> = []
    for (let index = 0; index < defaults.maxWorkers + 2; index++) {
      runtime.engine.ingest(input(index))
      const evaluation = startEval(s, threadKey(`thread-${index}`), runtimePolicy, { now: () => 1000 })!
      const id = ticketId(`capacity-${index}`)
      settleEval(s, evaluation.id, { kind: 'accept', reason: 'capacity fixture', strength: 'explicit', ticket: { id, title: `capacity ${index}`, brief, mandate: { strength: 'explicit', policyVersion: runtimePolicy.version, grantedBy: { id: 'fixture-human', source: sourceId('inbox:closeout'), bot: false }, at: 1001, scope: brief.scope.repo, via: 'addressed', rules: [] }, workdir: join(config.workRoot, id) } }, runtimePolicy, { now: () => 1001 })
      accepted.push({ id })
    }
    const start = performance.now()
    const starts = await Promise.all(accepted.map(({ id }) => runtime.startAssignment(id)))
    const activeAfterStart = s.repos.assignment.all().filter(row => row.state === 'running').length
    for (let round = 0; round < 5 && s.repos.ticket.all().some(row => row.state !== 'ended'); round++) {
      for (const worker of workers.filter(item => !item.disposed)) worker.settle({ structured: readyReport })
      for (let turn = 0; turn < 8; turn++) await new Promise<void>(done => setImmediate(done))
      await runtime.tick()
    }
    const finished = s.repos.ticket.all().filter(row => row.state === 'ended').length
    await runtime.dispose(); disposed = true
    evidence('capacity', { maxWorkers: defaults.maxWorkers, requested: accepted.length, starts, activeAfterStart, peakFakeWorkers: peakWorkers, totalFakeWorkers: workers.length, finishedTickets: finished, liveAgentsAfterDispose: agents.size, durationMs: performance.now() - start, realModelCalls: 0, explicitBoundary: 'real product runtime + SQLite, fake DSH Router/Worker activation handles only' })
    expect(activeAfterStart).toBe(defaults.maxWorkers); expect(peakWorkers).toBeLessThanOrEqual(defaults.maxWorkers)
    expect(starts.filter(row => row.code === 'SA_QUEUED')).toHaveLength(2)
    expect(workers).toHaveLength(accepted.length); expect(finished).toBe(accepted.length); expect(agents.size).toBe(0)
  })
})
