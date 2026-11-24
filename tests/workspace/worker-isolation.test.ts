import { afterEach, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defaults, resolveConfig, type Config } from '../../src/config.js'
import { createRuntime, readWorkerSnapshot } from '../../src/runtime.js'
import { openStore, type Store } from '../../src/store/index.js'
import { installRoleGuard } from '../../src/tools/runtime.js'
import { PROBE_CHECKS, PROBE_RECEIPT_SCHEMA } from '../../src/isolation/boundary.js'
import { ISOLATION_PROBE_VERSION, NETWORK_POLICY, SANDBOX_EXEC, profileTemplateDigest } from '../../src/isolation/seatbelt.js'
import { sourceDigest } from '../../src/isolation/workcopy.js'
import type { TicketBrief } from '../../src/domain/ticket.js'
import type { Report } from '../../src/engine/report.js'

const darwin = process.platform === 'darwin'
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function workroot(): string {
  const base = resolve(process.cwd(), '.probe')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'worker-isolation-it-'))
  cleanups.push(() => {
    const absolute = resolve(dir)
    if (!absolute.startsWith(join(resolve(process.cwd(), '.probe')) + '/') || !absolute.includes('worker-isolation-it-')) throw new Error('unexpected fixture cleanup path')
    rmSync(absolute, { recursive: true, force: true })
  })
  return dir
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' } })
}
function repository(dir: string): string {
  const repo = join(dir, 'source')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'app.ts'), 'export const app = true\n')
  writeFileSync(join(repo, 'README.md'), '# worker isolation fixture\n')
  writeFileSync(join(repo, '.env'), 'SECRET=tracked-secret-value\n')
  git(repo, ['init', '-q'])
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'fixture'])
  return repo
}
function briefFor(repo: string): TicketBrief {
  return { goal: 'Worker isolation fixture', scope: { repo, subdirs: [] }, base: { ref: 'main', requireCleanTree: false }, allowWrite: [], denyWrite: [], runtime: 'node', acceptance: [{ id: 'A1', kind: 'assertion', check: 'fixture' }], outOfScope: [], blockers: [], firstAction: 'run fixture', approvalsRequired: [] }
}
function validReport(): Report {
  return { state: 'ready', done: ['fixture complete'], todo: [], changedPaths: ['src/app.ts'], acceptance: [{ id: 'A1', result: 'passed', evidence: 'fixture' }], risks: [], needHuman: [] }
}
/** A structurally valid probe receipt bound to this machine; the production probe writes the real one. */
function probeReceipt(): Record<string, unknown> {
  const runnerDigest = createHash('sha256').update(readFileSync(SANDBOX_EXEC)).digest('hex')
  return {
    schemaVersion: PROBE_RECEIPT_SCHEMA, probeVersion: ISOLATION_PROBE_VERSION, createdAt: new Date().toISOString(), ok: true, platform: 'darwin',
    host: { macOS: 'fixture', node: process.version, sandboxExec: { path: SANDBOX_EXEC, sha256: runnerDigest } },
    profile: { templateDigest: profileTemplateDigest(), networkPolicy: NETWORK_POLICY },
    checks: PROBE_CHECKS.map(check => ({ id: check.id, kind: check.kind, passed: true, exitCode: check.kind === 'denied' ? 1 : 0, ...(check.kind === 'allowed' ? { succeeded: true } : {}), ...(check.kind === 'denied' ? { outsideCreated: false } : {}), ...(check.kind === 'cleanup' ? { cleanupOk: true } : {}) })),
  }
}

interface FakeHost {
  readonly ctx: any
  readonly created: Array<{ input: any; agent: any; session: any; events: any[] }>
  readonly resumed: any[]
  readonly mounted: string[]
  readonly restrictions: any[]
  readonly followups: Array<{ id: string; message: any }>
  readonly disposed: string[]
  readonly router: () => any
  readonly snapshots: Map<string, any>
  readonly agents: Map<string, any>
}
function fakeHost(workRoot: string): FakeHost {
  const agents = new Map<string, any>()
  const created: FakeHost['created'] = [], resumed: any[] = [], mounted: string[] = [], restrictions: any[] = [], followups: FakeHost['followups'] = [], disposed: string[] = []
  const snapshots = new Map<string, any>()
  const createAgent = (input: any, persisted?: any) => {
    const events: any[] = []
    const header = persisted?.session ?? { id: input.sessionId, cwd: input.meta?.cwd, agentPreset: input.meta?.agentPreset, origin: input.meta?.origin }
    const session = { header: { ...header, id: input.sessionId }, append(type: string, data: unknown) { const event = { type, data, seq: events.length, time: Date.now() }; events.push(event); return event } }
    const injections: any[] = []
    const agent: any = {
      id: input.sessionId, session, ctx: {}, injections,
      model: { current() { return { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'medium' } } },
      async followup(message: any) { followups.push({ id: input.sessionId, message }) },
      async inject(message: any) { injections.push(message) },
      async steer(message: any) { injections.push(message) },
      cancel() {},
    }
    const scope: any = { __agentPreset: undefined, tools: { restrict(filter: any) { restrictions.push(filter); return () => undefined }, register() { return () => undefined } }, get() { return undefined } }
    const applySetup = async () => { await input.setup?.(scope, agent); agent.ctx = scope }
    return { agent, scope, session, events, applySetup, handle: () => ({ agent, async dispose() { agents.delete(agent.id); disposed.push(agent.id) } }) }
  }
  const ctx: any = {
    effect() { return () => undefined },
    on() { return () => undefined },
    sessions: { async flush() { return true } },
    agentDefaultModel: { currentSelection() { return { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'medium' } } },
    agentPresets: {
      async mount(scope: any, id: string) { mounted.push(id); if (scope && typeof scope === 'object') scope.__agentPreset = id; return { id } },
      composedPreset(scope: any) { return scope && typeof scope === 'object' ? scope.__agentPreset : undefined },
    },
    agents: {
      get(id: string) { return agents.get(id) },
      async create(input: any) {
        const record = createAgent(input)
        await record.applySetup()
        agents.set(record.agent.id, record.agent)
        created.push({ input, agent: record.agent, session: record.session, events: record.events })
        return record.handle()
      },
      async resume(input: any) {
        resumed.push(input)
        const persisted = snapshots.get(input.resumeSessionId)
        const record = createAgent({ ...input, sessionId: input.resumeSessionId }, persisted)
        await record.applySetup()
        agents.set(record.agent.id, record.agent)
        return record.handle()
      },
    },
    subagents: { async startActivation() { throw new Error('production never spawns from the L1 path') } },
    sessionQuery: { async readSession(id: string) { return snapshots.get(id) ?? { session: { id, cwd: workRoot, agentPreset: 'dsh-superagent-router' }, events: [] } } },
  }
  return { ctx, created, resumed, mounted, restrictions, followups, disposed, router: () => agents.get(created.find(row => row.input.meta?.agentPreset === 'dsh-superagent-router')?.agent.id ?? ''), snapshots, agents }
}

function harness(options: { verified: boolean; preload?: (store: Store, facts: { dir: string; workRoot: string; source: string; routerKey: string }) => void }) {
  const dir = workroot()
  const source = repository(dir)
  const workRoot = join(dir, 'work')
  const stateDir = join(dir, 'state')
  mkdirSync(workRoot); mkdirSync(stateDir)
  const config = resolveConfig({ ...defaults, stateDir, dbPath: '', lockPath: '', workRoot, sources: [], confirm: 'never', watchdogIntervalMs: 60_000, executionBoundary: options.verified ? 'verified-dir' : 'unverified', executionProbePath: options.verified ? join(dir, 'probe.json') : '', roleTools: defaults.roleTools } as Config)
  if (options.verified) writeFileSync(config.executionProbePath, JSON.stringify(probeReceipt()))
  const store = openStore({ dbPath: config.dbPath })
  const fake = fakeHost(workRoot)
  options.preload?.(store, { dir, workRoot, source, routerKey: 'session:preloaded-router' })
  const runtime = createRuntime(fake.ctx, store, config)
  cleanups.push(async () => { await runtime.dispose(); store.close() })
  return { dir, source, workRoot, config, store, fake, runtime }
}

/** Compact row seeding for a Ticket/Assignment; the state machine is exercised through the real runtime. */
function seedTicket(store: Store, input: { routerId: string; source: string; workRoot: string; ticketId?: string; state?: 'open' | 'running'; withAssignment?: boolean; mandate?: Record<string, unknown> }) {
  const id = input.ticketId ?? `ticket-${randomUUID()}`
  const threadKey = `session:${input.routerId}`
  const workdir = join(input.workRoot, id)
  const brief = briefFor(input.source)
  store.repos.thread.insertOrIgnore({ key: threadKey, source: threadKey, ref_json: { source: threadKey, kind: 'session', id: input.routerId, address: {} }, created_at: Date.now(), last_at: Date.now(), seq: 0, paused: false, evaluating: null })
  store.repos.ticket.insert({ id, thread_key: threadKey, decision_id: `decision-${id}`, title: brief.goal, state: input.state ?? 'open', mandate_json: input.mandate ?? { strength: 'explicit', policyVersion: 'fixture-policy', grantedBy: { id: 'human', source: threadKey, bot: false }, at: Date.now(), scope: input.source, via: 'addressed', rules: [] }, brief_json: brief, workdir, stopped_by_human: false, created_at: Date.now(), updated_at: Date.now(), current_assignment: null })
  store.repos.thread_subscription.insertOrIgnore({ thread_key: threadKey, ticket_id: id })
  let assignment: Record<string, unknown> | undefined
  if (input.withAssignment) {
    assignment = { id: `assignment-${id}`, ticket_id: id, session_id: `worker-session-${id}`, state: 'running', created_at: Date.now(), started_at: Date.now(), last_progress_at: Date.now(), steps: 0, tokens: 0, retries: 0, repeated_calls: 0 }
    store.repos.assignment.insert(assignment)
    store.repos.ticket.updateByState(id, 'open', 'running', { current_assignment: assignment.id })
  }
  return { id, workdir, assignment }
}

async function drain(): Promise<void> { for (let i = 0; i < 12; i++) await new Promise(done => setImmediate(done)) }

describe('L1/L2 production Worker boundary', () => {
  it.skipIf(!darwin)('creates an independent Agent on the Ticket copy, mounts the Worker preset and pins host permissions', async () => {
    const h = harness({ verified: true })
    await h.runtime.ready
    const routerId = h.runtime.diagnostics().mainSessionId!
    const seeded = seedTicket(h.store, { routerId, source: h.source, workRoot: h.workRoot })
    const started: any = await h.runtime.startAssignment(seeded.id)
    expect(started).toMatchObject({ ok: true, code: 'SA_STARTED' })
    const assignment = h.store.repos.assignment.all()[0]!
    expect(h.store.repos.ticket.get(seeded.id)?.state).toBe('running')

    const workerCreate = h.fake.created.find(row => row.input.sessionId === assignment.session_id)!
    expect(workerCreate).toBeTruthy()
    expect(workerCreate.input.meta).toMatchObject({ cwd: resolve(seeded.workdir), agentPreset: 'dsh-superagent-worker', origin: 'subagent' })
    expect(h.fake.mounted).toContain('dsh-superagent-worker')
    const permissionEvents = workerCreate.events.filter(event => event.type === 'sandbox/mode' || event.type === 'approval/policy')
    expect(permissionEvents).toEqual([
      expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'workspace-write' } }),
      expect.objectContaining({ type: 'approval/policy', data: { policy: 'never' } }),
    ])
    expect(h.fake.restrictions.some((filter: any) => filter?.deny?.includes('bash'))).toBe(true)
    expect(h.fake.followups.some(row => row.id === assignment.session_id && JSON.stringify(row.message).includes(String(seeded.id)))).toBe(true)

    // L2 copy: committed source files present, tracked secret excluded, provenance recorded.
    expect(existsSync(join(seeded.workdir, 'src', 'app.ts'))).toBe(true)
    expect(existsSync(join(seeded.workdir, '.env'))).toBe(false)
    const receipt = h.store.repos.kv.get(`worker-copy:v1:${seeded.id}`)?.v as any
    expect(receipt).toMatchObject({ schemaVersion: 1, ticketId: seeded.id })
    expect(receipt.baselineDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it.skipIf(!darwin)('runs go_bash inside the Ticket, denies escapes, rejects tools after the Assignment ends and completes through report_result', async () => {
    const h = harness({ verified: true })
    await h.runtime.ready
    const routerId = h.runtime.diagnostics().mainSessionId!
    const seeded = seedTicket(h.store, { routerId, source: h.source, workRoot: h.workRoot })
    expect(await h.runtime.startAssignment(seeded.id)).toMatchObject({ ok: true, code: 'SA_STARTED' })
    const assignment = h.store.repos.assignment.all()[0]!
    const worker = h.fake.agents.get(String(assignment.session_id))
    expect(worker).toBeTruthy()

    let guard!: (execution: any) => any
    const roleGuard = installRoleGuard(
      { tools: { guard(callback: any) { guard = callback; return () => undefined } }, agentPresets: { composedPreset: (scope: any) => scope?.__agentPreset } },
      { roleTools: { router: [], worker: [...defaults.roleTools.worker], watchdog: [] }, executionGate: () => true, resolveWorker: agent => readWorkerSnapshot(h.store, String((agent as { id?: string }).id ?? '')) },
    )!

    // go_bash executes through the real Seatbelt boundary.
    const inside: any = await h.runtime.invoke('go_bash', { command: "printf 'worker-out\\n' > go-bash.txt && cat go-bash.txt" }, { agent: worker })
    expect(inside).toMatchObject({ ok: true, code: 'SA_GO_BASH_OK' })
    expect(readFileSync(join(seeded.workdir, 'go-bash.txt'), 'utf8')).toBe('worker-out\n')
    const escape: any = await h.runtime.invoke('go_bash', { command: 'printf x > ../go-bash-escape.txt' }, { agent: worker })
    expect(escape.ok).toBe(false)
    expect(escape.code).toBe('SA_GO_BASH_DENIED')
    expect(existsSync(join(seeded.workdir, '..', 'go-bash-escape.txt'))).toBe(false)

    // Parameter whitelist and tool guard: no Overrides, no host bash, no write outside the Ticket.
    expect(await h.runtime.invoke('go_bash', { command: 'true', cwd: '/tmp' }, { agent: worker })).toMatchObject({ ok: false, code: 'SA_GO_BASH_INVALID' })
    expect(guard({ agent: worker, name: 'go_bash', arguments: { command: 'true' } })).toBeUndefined()
    expect(guard({ agent: worker, name: 'bash', arguments: { command: 'true' } })).toMatchObject({ info: { code: 'SA_ROLE_TOOL_DENIED' } })
    expect(guard({ agent: worker, name: 'write', arguments: { file_path: '/tmp/outside.txt', content: 'x' } })).toMatchObject({ info: { code: 'SA_WORKER_PATH_DENIED' } })
    expect(guard({ agent: worker, name: 'write', arguments: { file_path: 'src/app.ts', content: 'x' } })).toBeUndefined()

    // Final structured report settles the same Ticket/Assignment state machine.
    expect(await h.runtime.invoke('report_result', validReport(), { agent: worker })).toMatchObject({ ok: true, code: 'SA_REPORT_RECORDED' })
    await drain()
    expect(h.store.repos.ticket.get(seeded.id)).toMatchObject({ state: 'ended', outcome: 'completed' })
    expect(h.store.repos.assignment.get(assignment.id)?.state).toBe('ended')
    expect(h.fake.disposed).toContain(String(assignment.session_id))

    // After the Assignment ended every path refuses: runtime invoke and the tool guard.
    expect(await h.runtime.invoke('go_bash', { command: 'true' }, { agent: worker })).toMatchObject({ ok: false, code: 'SA_ASSIGNMENT_ENDED' })
    expect(guard({ agent: worker, name: 'go_bash', arguments: { command: 'true' } })).toMatchObject({ info: { code: 'SA_ASSIGNMENT_ENDED' } })
    roleGuard.dispose()
  })

  it.skipIf(!darwin)('a failed L1 start leaves the Ticket open instead of consuming it', async () => {
    const h = harness({ verified: true })
    await h.runtime.ready
    const routerId = h.runtime.diagnostics().mainSessionId!
    const seeded = seedTicket(h.store, { routerId, source: h.source, workRoot: h.workRoot })
    // A pre-existing unmanaged non-empty Ticket directory must fail closed before any state change.
    mkdirSync(seeded.workdir, { recursive: true })
    writeFileSync(join(seeded.workdir, 'unmanaged.txt'), 'x')
    await expect(h.runtime.startAssignment(seeded.id)).resolves.toMatchObject({ ok: false, code: 'SA_WORKDIR_PREPARE_FAILED', reason: 'SA_WORKDIR_UNMANAGED' })
    expect(h.store.repos.ticket.get(seeded.id)?.state).toBe('open')
    expect(h.store.repos.assignment.all()).toEqual([])
    expect(h.fake.created.filter(row => row.input.meta?.agentPreset === 'dsh-superagent-worker')).toEqual([])
  })

  it('the tool guard denies every Worker tool when the same boundary decision is closed', async () => {
    const h = harness({ verified: false })
    await h.runtime.ready
    const routerId = h.runtime.diagnostics().mainSessionId!
    const seeded = seedTicket(h.store, { routerId, source: h.source, workRoot: h.workRoot, state: 'open', withAssignment: true })
    const assignment = h.store.repos.assignment.all()[0]!
    const agent = { id: String(assignment.session_id), ctx: {}, session: { header: { cwd: seeded.workdir } } }
    let guard!: (execution: any) => any
    const roleGuard = installRoleGuard(
      { tools: { guard(callback: any) { guard = callback; return () => undefined } }, agentPresets: { composedPreset: () => 'dsh-superagent-worker' } },
      { roleTools: { router: [], worker: [...defaults.roleTools.worker], watchdog: [] }, executionGate: () => false, resolveWorker: () => readWorkerSnapshot(h.store, agent.id) },
    )!
    expect(guard({ agent, name: 'go_bash', arguments: { command: 'true' } })).toMatchObject({ info: { code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } })
    expect(guard({ agent, name: 'write', arguments: { file_path: 'src/app.ts', content: 'x' } })).toMatchObject({ info: { code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } })
    roleGuard.dispose()

    // With the gate open, a Session cwd that is not the bound Ticket copy is still denied.
    let openGuard!: (execution: any) => any
    const opened = installRoleGuard(
      { tools: { guard(callback: any) { openGuard = callback; return () => undefined } }, agentPresets: { composedPreset: () => 'dsh-superagent-worker' } },
      { roleTools: { router: [], worker: [...defaults.roleTools.worker], watchdog: [] }, executionGate: () => true, resolveWorker: () => readWorkerSnapshot(h.store, assignment.session_id as string) },
    )!
    const foreign = { id: String(assignment.session_id), ctx: {}, session: { header: { cwd: h.workRoot } } }
    expect(openGuard({ agent: foreign, name: 'go_bash', arguments: { command: 'true' } })).toMatchObject({ info: { code: 'SA_WORKER_WORKDIR_UNBOUND' } })
    opened.dispose()
    expect(h.store.repos.ticket.get(seeded.id)?.state).toBe('running')
    expect(assignment.state).toBe('running')
  })

  it('keeps production start and recovery fail-closed when the boundary is unverified', async () => {
    const h = harness({ verified: false, preload: (store, facts) => {
      const seeded = seedTicket(store, { routerId: 'preloaded-router', source: facts.source, workRoot: facts.workRoot, state: 'open', withAssignment: true })
      store.repos.kv.insertOrIgnore({ k: `worker-mark-${seeded.id}`, v: true })
    } })
    await h.runtime.ready
    const assignment = h.store.repos.assignment.all()[0]!
    expect(h.store.repos.ticket.get(String(assignment.ticket_id))).toMatchObject({ state: 'ended', outcome: 'stopped' })
    expect(h.store.repos.assignment.get(assignment.id)).toMatchObject({ state: 'ended' })
    expect(h.fake.resumed).toEqual([])
    expect(h.fake.created.filter(row => row.input.meta?.agentPreset === 'dsh-superagent-worker')).toEqual([])

    // A fresh start attempt also refuses before touching the Ticket.
    const routerId = h.runtime.diagnostics().mainSessionId!
    const seeded = seedTicket(h.store, { routerId, source: h.source, workRoot: h.workRoot })
    expect(await h.runtime.startAssignment(seeded.id)).toMatchObject({ ok: false, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', reason: 'unverified' })
    expect(h.store.repos.ticket.get(seeded.id)?.state).toBe('open')
    expect(h.store.repos.assignment.all().filter(row => row.ticket_id === seeded.id)).toEqual([])
    const health: any = await h.runtime.panelPorts.health()
    expect(health.executionBoundary).toMatchObject({ requested: 'unverified', state: 'unverified', reason: 'unverified' })
  })

  it.skipIf(!darwin)('recovery refuses a legacy spawn Session whose persisted cwd is not the Ticket copy', async () => {
    let seededId = ''
    let sessionId = ''
    const h = harness({ verified: true, preload: (store, facts) => {
      const seeded = seedTicket(store, { routerId: 'preloaded-router', source: facts.source, workRoot: facts.workRoot, state: 'open', withAssignment: true })
      seededId = seeded.id
      sessionId = String(store.repos.assignment.all()[0]!.session_id)
      mkdirSync(join(facts.workRoot, seeded.id), { recursive: true })
      store.repos.kv.insertOrIgnore({ k: `worker-copy:v1:${seeded.id}`, v: { schemaVersion: 1, ticketId: seeded.id, sourceDigest: sourceDigest(facts.source), baselineDigest: 'a'.repeat(64), excludedPaths: 0, droppedSymlinks: 0, createdAt: Date.now() } })
    } })
    // The counter-evidence: a spawn child header inherits the Router/parent cwd, not the Ticket.
    h.fake.snapshots.set(sessionId, { session: { id: sessionId, cwd: h.workRoot, agentPreset: 'dsh-superagent-worker' }, events: [] })
    await h.runtime.ready
    const assignment = h.store.repos.assignment.all()[0]!
    expect(String(assignment.ticket_id)).toBe(seededId)
    expect(h.fake.resumed).toEqual([])
    expect(h.store.repos.ticket.get(seededId)?.state).toBe('ended')
    expect(h.store.repos.assignment.get(assignment.id)).toMatchObject({ state: 'ended', ended_reason: 'execution-recovery-failed' })
    expect(h.store.repos.audit.all().some(row => row.action === 'worker_recovery_failed')).toBe(true)
  })

  it.skipIf(!darwin)('recovery refuses a running Worker when its Ticket copy is gone even with a receipt', async () => {
    let seededId = ''
    let sessionId = ''
    const h = harness({ verified: true, preload: (store, facts) => {
      const seeded = seedTicket(store, { routerId: 'preloaded-router', source: facts.source, workRoot: facts.workRoot, state: 'open', withAssignment: true })
      seededId = seeded.id
      sessionId = String(store.repos.assignment.all()[0]!.session_id)
      store.repos.kv.insertOrIgnore({ k: `worker-copy:v1:${seeded.id}`, v: { schemaVersion: 1, ticketId: seeded.id, sourceDigest: sourceDigest(facts.source), baselineDigest: 'c'.repeat(64), excludedPaths: 0, droppedSymlinks: 0, createdAt: Date.now() } })
    } })
    h.fake.snapshots.set(sessionId, { session: { id: sessionId, cwd: join(h.workRoot, seededId), agentPreset: 'dsh-superagent-worker' }, events: [] })
    await h.runtime.ready
    expect(h.fake.resumed).toEqual([])
    expect(h.store.repos.ticket.get(seededId)?.state).toBe('ended')
    expect(h.store.repos.assignment.get(String(h.store.repos.assignment.all()[0]!.id))).toMatchObject({ state: 'ended', ended_reason: 'execution-recovery-failed' })
  })

  it.skipIf(!darwin)('recovery resumes a persisted Worker Session only with matching copy provenance and cwd', async () => {
    let seededId = ''
    let sessionId = ''
    let ticketDir = ''
    const h = harness({ verified: true, preload: (store, facts) => {
      const seeded = seedTicket(store, { routerId: 'preloaded-router', source: facts.source, workRoot: facts.workRoot, state: 'open', withAssignment: true })
      seededId = seeded.id
      sessionId = String(store.repos.assignment.all()[0]!.session_id)
      ticketDir = join(facts.workRoot, seeded.id)
      mkdirSync(ticketDir, { recursive: true })
      store.repos.kv.insertOrIgnore({ k: `worker-copy:v1:${seeded.id}`, v: { schemaVersion: 1, ticketId: seeded.id, sourceDigest: sourceDigest(facts.source), baselineDigest: 'b'.repeat(64), excludedPaths: 0, droppedSymlinks: 0, createdAt: Date.now() } })
    } })
    h.fake.snapshots.set(sessionId, { session: { id: sessionId, cwd: ticketDir, agentPreset: 'dsh-superagent-worker' }, events: [] })
    await h.runtime.ready
    const assignment = h.store.repos.assignment.all()[0]!
    expect(h.fake.resumed).toHaveLength(1)
    expect(h.fake.resumed[0].resumeSessionId).toBe(String(assignment.session_id))
    expect(h.fake.mounted).toContain('dsh-superagent-worker')
    const ticket = h.store.repos.ticket.get(seededId)!
    expect(ticket.state).toBe('running')
    expect(h.store.repos.assignment.get(assignment.id)?.state).toBe('running')
    expect(h.fake.agents.has(String(assignment.session_id))).toBe(true)
    // Every resumed Worker also gets the continuation instruction through its own Session.
    expect(h.fake.followups.some(row => row.id === String(assignment.session_id) && JSON.stringify(row.message).includes('report_result'))).toBe(true)
    expect(h.store.repos.audit.all().some(row => row.action === 'worker_recovered')).toBe(true)
  })
})
