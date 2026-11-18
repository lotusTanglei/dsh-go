import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, type Store } from '../src/store/index.js'
import { encodeJson } from '../src/store/codec.js'
import { defaults, resolveConfig, type Config } from '../src/config.js'
import { createRuntime } from '../src/runtime.js'

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const brief = {
  goal: 'Integration fixture', scope: { repo: '/tmp/integration-repository', subdirs: [] },
  base: { ref: 'main', requireCleanTree: false }, allowWrite: [], denyWrite: ['**'], runtime: 'test',
  acceptance: [{ id: 'A1', kind: 'assertion' as const, check: 'Return the fixture report' }],
  outOfScope: [], blockers: [], firstAction: 'Return structured fixture evidence', approvalsRequired: [],
}
const readyReport = { state: 'ready', done: ['fixture'], todo: [], changedPaths: [], acceptance: [{ id: 'A1', result: 'passed', evidence: 'fixture assertion' }], risks: [], needHuman: [] }
const readyFailedReport = { ...readyReport, acceptance: [{ id: 'A1', result: 'failed', evidence: 'fixture assertion failed' }] }
const invalidReport = { state: 'ready', done: ['incomplete fixture'] }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function flush(turns = 4) { for (let index = 0; index < turns; index++) await new Promise<void>(resolve => setImmediate(resolve)) }

function harness(extra: Partial<Config> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-runtime-integration-'))
  const config = resolveConfig({ ...defaults, stateDir: dir, dbPath: '', lockPath: '', workRoot: '', sources: [], confirm: 'never', watchdogIntervalMs: 60_000, ...extra, roleTools: { router: [...defaults.roleTools.router], worker: [...defaults.roleTools.worker], watchdog: [...defaults.roleTools.watchdog] } } as Config)
  const store = openStore({ dbPath: config.dbPath })
  const agents = new Map<string, any>()
  const listeners = new Map<string, (...args: any[]) => unknown>()
  const workers: Array<{ id: string; input: any; result: Deferred<any>; steerMessages: any[]; disposed: boolean }> = []
  const steerGates: Deferred<void>[] = []
  let steer: ((message: any) => Promise<void>) | undefined
  let router: any
  let eventIndex = 0
  const ctx: any = {
    effect(factory: () => (() => void | Promise<void>)) { return factory() },
    on(name: string, callback: (...args: any[]) => unknown) { listeners.set(name, callback); return () => listeners.delete(name) },
    agentPresets: { async mount() {}, composedPreset() { return 'dsh-superagent-router' } },
    agents: {
      get(id: string) { return agents.get(id) },
      async create(input: any) {
        router = { id: input.sessionId, ctx: {}, injected: [] as any[], followedUp: [] as any[], async inject(message: any) { this.injected.push(message) }, async followup(message: any) { this.followedUp.push(message) }, async steer() {} }
        agents.set(router.id, router)
        await input.setup?.({})
        return { agent: router, async dispose() { agents.delete(router.id) } }
      },
    },
    subagents: {
      async startActivation(input: any) {
        const worker = { id: input.childId, input, result: deferred<any>(), steerMessages: [] as any[], disposed: false }
        const agent = { id: worker.id, ctx: {}, async steer(message: any) { worker.steerMessages.push(message); if (steer) await steer(message) } }
        workers.push(worker); agents.set(agent.id, agent)
        return { childId: worker.id, sessionId: worker.id, agent, result: worker.result.promise, async dispose() { worker.disposed = true; agents.delete(worker.id) } }
      },
      interrupt() {},
    },
    sessionQuery: { async readSession() { return { events: [], session: { agentPreset: 'dsh-superagent-router' } } } },
  }
  const runtime = createRuntime(ctx, store, config)
  const emit = (id: string, text = id, at = Date.now()) => listeners.get('session/event')!({ id: router.id }, { type: 'user/message', time: at, data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  cleanups.push(async () => {
    // Settle every fake activation and steer before the real runtime drains its work.
    for (const gate of steerGates) gate.resolve(undefined)
    for (const worker of workers) worker.result.resolve({ structured: readyReport })
    try { await runtime.dispose() } finally {
      store.close()
      if (!dir.startsWith(join(tmpdir(), 'superagent-runtime-integration-'))) throw new Error('unexpected fixture cleanup directory')
      rmSync(dir, { recursive: true, force: true })
    }
  })
  return {
    store, runtime, workers, agents, steerGates, emit, router: () => router,
    setSteer(callback: (message: any) => Promise<void>) { steer = callback },
    async ticket() {
      await runtime.ready
      emit(`initial-${++eventIndex}`, 'authorized integration task')
      await flush()
      const created = await runtime.invoke('ticket_create', { brief }, { agent: router }) as { code: string; ticketId: string }
      expect(created.code).toBe('SA_CREATED')
      return created.ticketId
    },
    async start(ticketId: string) {
      const result = await runtime.invoke('assignment_start', { ticketId }, { agent: router }) as { code: string; assignmentId: string }
      expect(result.code).toBe('SA_STARTED')
      return result.assignmentId
    },
  }
}
function addApproval(store: Store, ticketId: string, id: string, state: string) {
  store.repos.approval.insert({ id, ticket_id: ticketId, kind: 'permission', summary: 'Fixture permission', payload_json: {}, requested_by: 'fixture-worker', created_at: Date.now(), state })
}
function waitTicket(store: Store, ticketId: string) {
  const ticket = store.repos.ticket.get(ticketId)!
  expect(store.repos.ticket.updateByState(ticketId, String(ticket.state), 'waiting_human', { attention_json: { question: 'Fixture approval', at: Date.now() } })).toBe(true)
}

// These are integration contracts, not model/e2e claims: real SQLite + product runtime,
// with explicit fake DSH activation handles and independently controlled promises.
describe('Host runtime integration contracts', () => {
  it.each(['pending', 'denied', 'expired'])('does not resume an active Worker while another approval is %s', async blockedState => {
    const h = harness(); const id = await h.ticket(); await h.start(id)
    waitTicket(h.store, id)
    addApproval(h.store, id, 'approved-one', 'approved'); addApproval(h.store, id, 'blocking-two', blockedState)
    await h.runtime.panelPorts.approvalDecided(id, 'approved-one', true)
    await flush()
    expect(h.store.repos.ticket.get(id)?.state).toBe('waiting_human')
    expect(h.workers).toHaveLength(1)
    expect(h.workers[0]!.steerMessages).toHaveLength(0)
    await h.runtime.panelPorts.approvalDecided(id, 'blocking-two', false)
    expect(h.store.repos.ticket.get(id)?.state).toBe('waiting_human')
    expect(h.workers[0]!.steerMessages).toHaveLength(0)
  })

  it('steers the existing Assignment after the route has committed all approvals', async () => {
    const h = harness(); const id = await h.ticket(); const assignmentId = await h.start(id)
    waitTicket(h.store, id); addApproval(h.store, id, 'only-approval', 'approved')
    // Route transaction transitions a live Assignment back to running before delivery.
    h.store.repos.ticket.updateByState(id, 'waiting_human', 'running', { attention_json: null })
    await h.runtime.panelPorts.approvalDecided(id, 'only-approval', true)
    expect(h.workers).toHaveLength(1)
    expect(h.store.repos.ticket.get(id)).toMatchObject({ state: 'running', current_assignment: assignmentId })
    expect(h.workers[0]!.steerMessages).toHaveLength(1)
    expect(JSON.stringify(h.workers[0]!.steerMessages[0])).toContain('only-approval')
  })

  it('starts a new Assignment only after all approvals of an ended Worker are approved', async () => {
    const h = harness(); const id = await h.ticket(); const firstAssignment = await h.start(id)
    waitTicket(h.store, id); addApproval(h.store, id, 'first-approved', 'approved'); addApproval(h.store, id, 'second-pending', 'pending')
    h.workers[0]!.result.resolve({ structured: { ...readyReport, state: 'blocked', needHuman: ['Fixture approval'] } })
    await flush()
    expect(h.store.repos.assignment.get(firstAssignment)?.state).toBe('ended')
    expect(h.store.repos.ticket.get(id)).toMatchObject({ state: 'waiting_human', current_assignment: null })
    await h.runtime.panelPorts.approvalDecided(id, 'first-approved', true)
    expect(h.workers).toHaveLength(1)
    h.store.repos.approval.updateByState('second-pending', 'pending', 'approved')
    h.store.repos.ticket.updateByState(id, 'waiting_human', 'open', { attention_json: null })
    await h.runtime.panelPorts.approvalDecided(id, 'second-pending', true)
    expect(h.workers).toHaveLength(2)
    expect(h.store.repos.ticket.get(id)).toMatchObject({ state: 'running', current_assignment: h.store.repos.assignment.all()[1]!.id })
    expect(h.store.repos.assignment.all()[1]!.id).not.toBe(firstAssignment)
  })

  it.each([['invalid structured report', invalidReport], ['ready report with failed acceptance', readyFailedReport]])('allows exactly one correction for %s and gives the next Worker a correction hint', async (_label, rejectedReport) => {
    const h = harness({ maxRetries: 5 }); const id = await h.ticket(); const firstAssignment = await h.start(id)
    h.workers[0]!.result.resolve({ structured: rejectedReport }); await flush()
    expect(h.store.repos.assignment.get(firstAssignment)?.state).toBe('ended')
    expect(h.workers[0]!.disposed).toBe(true)
    expect(h.store.repos.ticket.get(id)).toMatchObject({ state: 'open', current_assignment: null })
    expect(h.store.repos.audit.all().filter(row => row.ticket_id === id && row.action === 'report_correction_requested')).toHaveLength(1)
    const secondAssignment = await h.start(id)
    expect(secondAssignment).not.toBe(firstAssignment)
    const correctionPrompt = JSON.parse(h.workers[1]!.input.prompt[0].text) as { correction?: string; brief: typeof brief }
    expect(correctionPrompt.correction).toMatch(/correct|retry|补报|修正/i)
    expect(correctionPrompt.brief).toEqual(brief)
    h.workers[1]!.result.resolve({ structured: rejectedReport }); await flush()
    expect(h.store.repos.assignment.get(secondAssignment)?.state).toBe('ended')
    expect(h.store.repos.ticket.get(id)).toMatchObject({ state: 'ended', outcome: 'failed', current_assignment: null })
    const third = await h.runtime.invoke('assignment_start', { ticketId: id }, { agent: h.router() }) as { ok: boolean }
    expect(third.ok).toBe(false)
    expect(h.workers).toHaveLength(2)
    expect(h.store.repos.audit.all().filter(row => row.ticket_id === id && row.action === 'report_correction_requested')).toHaveLength(1)
  })

  it('does not spend a correction attempt beyond maxRetries=0', async () => {
    const h = harness({ maxRetries: 0 }); const id = await h.ticket(); await h.start(id)
    h.workers[0]!.result.resolve({ structured: invalidReport }); await flush()
    expect(h.store.repos.ticket.get(id)).toMatchObject({ state: 'ended', outcome: 'failed', current_assignment: null })
    const restarted = await h.runtime.invoke('assignment_start', { ticketId: id }, { agent: h.router() }) as { ok: boolean }
    expect(restarted.ok).toBe(false)
    expect(h.workers).toHaveLength(1)
    expect(h.store.repos.audit.all().filter(row => row.ticket_id === id && row.action === 'report_correction_requested')).toHaveLength(0)
  })

  it('returns detached read-only diagnostics with ids and no private bodies, paths or raw payloads', async () => {
    const h = harness(); const id = await h.ticket(); await h.start(id)
    const trigger = h.store.repos.trigger.all()[0]!
    h.store.db.prepare('UPDATE trigger SET text=?, raw=? WHERE id=?').run('private-trigger-body', encodeJson({ password: 'diagnostic-password', raw: 'diagnostic-raw' }, false), trigger.id as string)
    h.store.repos.audit.insert({ at: Date.now(), actor: 'fixture', action: 'diagnostics-fixture', ticket_id: id, thread_key: null, detail: {} })
    const auditId = h.store.repos.audit.all().at(-1)!.id
    h.store.db.prepare('UPDATE audit SET detail=? WHERE id=?').run(encodeJson({ safe: 'fixture-safe', password: 'diagnostic-password', raw: 'diagnostic-raw', path: '/tmp/private-worker-location', payload: { nested: 'diagnostic-payload' } }, false), auditId as number)
    const before = JSON.stringify({ triggers: h.store.repos.trigger.all(), tickets: h.store.repos.ticket.all(), assignments: h.store.repos.assignment.all(), audit: h.store.repos.audit.all() })
    const snapshot = h.runtime.diagnostics()
    expect(snapshot.mainSessionId).toBe(h.router().id)
    expect(snapshot.triggers).toHaveLength(1); expect(snapshot.tickets).toHaveLength(1); expect(snapshot.assignments).toHaveLength(1)
    expect(snapshot.audit.some(row => row.action === 'diagnostics-fixture')).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/private-trigger-body|diagnostic-password|diagnostic-raw|diagnostic-payload|private-worker-location|integration-repository/)
    expect(JSON.stringify({ triggers: h.store.repos.trigger.all(), tickets: h.store.repos.ticket.all(), assignments: h.store.repos.assignment.all(), audit: h.store.repos.audit.all() })).toBe(before)
    // A consumer may mutate its copy, but not persistent state or the next snapshot.
    try { (snapshot.tickets as Array<{ state?: string }>)[0]!.state = 'tampered' } catch {}
    expect(h.runtime.diagnostics().tickets[0]!.state).toBe('running')
    expect(h.store.repos.ticket.get(id)?.state).toBe('running')
  })

  it('serializes simultaneous subscription events by seq and acknowledges only after each steer resolves', async () => {
    const h = harness(); const id = await h.ticket(); const assignmentId = await h.start(id)
    const gates = [deferred<void>(), deferred<void>()]; h.steerGates.push(...gates)
    let steerIndex = 0
    h.setSteer(async () => { await gates[steerIndex++]!.promise })
    h.emit('ordered-first', 'first-arrival', Date.now() + 100)
    h.emit('ordered-second', 'second-arrival', Date.now())
    await flush()
    const first = h.store.repos.trigger.all().find(row => row.external_id === 'ordered-first')!
    const second = h.store.repos.trigger.all().find(row => row.external_id === 'ordered-second')!
    const dispositions = () => [first, second].map(row => h.store.repos.trigger_disposition.get(row.id)?.delivered_to)
    expect(h.workers[0]!.steerMessages.map(message => message.id)).toEqual([first.id])
    expect(dispositions()).toEqual([null, null])
    gates[0]!.resolve(undefined); await flush()
    expect(h.workers[0]!.steerMessages.map(message => message.id)).toEqual([first.id, second.id])
    expect(dispositions()).toEqual([assignmentId, null])
    gates[1]!.resolve(undefined); await flush()
    expect(dispositions()).toEqual([assignmentId, assignmentId])
    const ordered = h.store.repos.thread_trigger.all().filter(row => [first.id, second.id].includes(row.trigger_id)).sort((a, b) => Number(a.seq) - Number(b.seq))
    expect(ordered.map(row => row.trigger_id)).toEqual([first.id, second.id])
    expect(ordered.every(row => row.state === 'consumed')).toBe(true)
  })

  it('retains the exact subscription Trigger pending after an awaited steer failure', async () => {
    const h = harness(); const id = await h.ticket(); await h.start(id)
    const gate = deferred<void>(); h.steerGates.push(gate)
    h.setSteer(async () => { await gate.promise })
    h.emit('rejected-steer'); await flush()
    const trigger = h.store.repos.trigger.all().find(row => row.external_id === 'rejected-steer')!
    expect(h.store.repos.trigger_disposition.get(trigger.id)?.delivered_to).toBeNull()
    gate.reject(new Error('fixture delivery rejected')); await flush()
    expect(h.store.repos.trigger_disposition.get(trigger.id)?.delivered_to).toBeNull()
    expect(h.store.repos.thread_trigger.all().find(row => row.trigger_id === trigger.id)?.state).toBe('pending')
    expect(h.workers[0]!.steerMessages).toHaveLength(1)
  })
})
