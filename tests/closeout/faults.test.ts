import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { openStore } from '../../src/store/index.js'
import { apply } from '../../src/index.js'
import { defaults, type Config } from '../../src/config.js'
import { createWatchdog, measureWorker, type WatchdogAssignment, type WatchdogAudit } from '../../src/engine/watchdog.js'
import { reconcile } from '../../src/engine/recovery.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks() })
function temporary() {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'superagent-closeout-faults-')))
  cleanup.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('superagent-closeout-faults-')) throw new Error('unexpected cleanup target'); rmSync(dir, { recursive: true, force: true }) })
  return dir
}
function evidence(name: string, value: Record<string, unknown>) {
  mkdirSync('probes/closeout', { recursive: true })
  writeFileSync(`probes/closeout/c-faults-${name}.json`, JSON.stringify({ case: name, recordedAt: new Date().toISOString(), mode: 'offline-real-sqlite-fake-host', ...value }, null, 2) + '\n')
}
function exit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  return new Promise((done, fail) => {
    const timer = setTimeout(() => { clear(); fail(new Error('child exit timeout')) }, 8000)
    const clear = () => { clearTimeout(timer); child.off('exit', ended); child.off('error', failed) }
    const ended = (code: number | null, signal: NodeJS.Signals | null) => { clear(); done({ code, signal }) }
    const failed = (error: Error) => { clear(); fail(error) }
    child.once('exit', ended); child.once('error', failed)
  })
}
function ready(child: ChildProcess): Promise<void> {
  return new Promise((done, fail) => {
    let text = ''
    const timer = setTimeout(() => { clear(); fail(new Error('child readiness timeout')) }, 8000)
    const clear = () => { clearTimeout(timer); child.stdout?.off('data', data); child.off('exit', ended); child.off('error', failed) }
    const data = (chunk: Buffer) => { text += chunk.toString(); if (text.includes('HOLDING_STORE_LOCK\n')) { clear(); done() } }
    const ended = () => { clear(); fail(new Error('lock child exited before readiness')) }
    const failed = (error: Error) => { clear(); fail(error) }
    child.stdout?.on('data', data); child.once('exit', ended); child.once('error', failed)
  })
}
// Resolve only this checkout's TS source imports. Node strips types in memory; no lib/build output.
const sourceRoot = pathToFileURL(resolve('src') + '/').href
const loader = `import {existsSync} from 'node:fs'; import {fileURLToPath} from 'node:url'; export async function resolve(specifier,context,next){if(specifier.startsWith('.')&&specifier.endsWith('.js')&&context.parentURL?.startsWith(${JSON.stringify(sourceRoot)})){const ts=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);if(existsSync(fileURLToPath(ts)))return next(ts.href,context)}return next(specifier,context)}`
const childArgs = ['--no-warnings', '--experimental-strip-types', '--experimental-loader', `data:text/javascript,${encodeURIComponent(loader)}`, '--input-type=module', '-e']
const dbImport = `import {openStore} from ${JSON.stringify(pathToFileURL(resolve('src/store/db.ts')).href)};`

describe('CLOSE-OUT C3 real offline fault injection', () => {
  it('fails activation on a genuinely read-only database, hides OS diagnostics and releases its lock', () => {
    const dir = temporary(), path = join(dir, 'readonly.sqlite')
    const original = openStore({ dbPath: path }); original.close()
    const setup = new DatabaseSync(path); setup.exec('PRAGMA journal_mode=DELETE'); setup.close()
    chmodSync(path, 0o444)
    cleanup.push(() => { if (existsSync(path)) chmodSync(path, 0o600) })
    const readonly = new DatabaseSync(path)
    let sqlFailure: { message: string; code?: string } | undefined
    try { readonly.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run('readonly-probe', '{}') } catch (error) { const e = error as NodeJS.ErrnoException; sqlFailure = { message: e.message, code: e.code } } finally { readonly.close() }
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...values) => { logs.push(values.map(String).join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...values) => { logs.push(values.map(String).join(' ')) })
    const config = { ...defaults, stateDir: dir, dbPath: path, lockPath: '', workRoot: '', sources: [], roleTools: defaults.roleTools } as Config
    let activationError = ''
    try { apply({ effect() { throw new Error('read-only activation must not install effects') } }, config) } catch (error) { activationError = (error as Error).message }
    const lockExists = existsSync(`${path}.lock`)
    const raw = { fileMode: statSync(path).mode & 0o777, directWriteFailure: sqlFailure, activationError, logs, lockExists }
    evidence('readonly', raw)
    expect(sqlFailure?.message).toMatch(/readonly/i)
    expect(activationError).toBe('Superagent store could not open; check configured paths, lock ownership and migration compatibility')
    expect(JSON.stringify({ activationError, logs })).not.toContain(dir)
    expect(logs).not.toContain('[superagent] loaded')
    expect(lockExists).toBe(false)
    chmodSync(path, 0o600)
    const retry = openStore({ dbPath: path }); retry.close()
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('rejects a second real process while the first process remains alive with the store lock', async () => {
    const dir = temporary(), path = join(dir, 'held.sqlite')
    const first = spawn(process.execPath, [...childArgs, `${dbImport} const store=openStore({dbPath:process.argv[1]}); console.log('HOLDING_STORE_LOCK'); process.stdin.resume(); process.stdin.once('data',()=>{store.close();process.exit(0)});`, path], { stdio: ['pipe', 'pipe', 'pipe'] })
    cleanup.push(async () => { if (first.exitCode === null && first.signalCode === null) { first.kill('SIGKILL'); await exit(first) } })
    await ready(first)
    const lockBefore = JSON.parse(readFileSync(`${path}.lock`, 'utf8')) as { pid: number; nonce: string }
    const second = spawnSync(process.execPath, [...childArgs, `${dbImport} try { const s=openStore({dbPath:process.argv[1]}); s.close(); console.log(JSON.stringify({opened:true})); } catch(error) { console.log(JSON.stringify({opened:false,message:error.message})); process.exitCode=2; }`, path], { encoding: 'utf8', timeout: 8000 })
    const response = JSON.parse(second.stdout.trim()) as { opened: boolean; message: string }
    const ownerUnchanged = JSON.parse(readFileSync(`${path}.lock`, 'utf8')).nonce === lockBefore.nonce
    const firstAlive = first.exitCode === null && first.signalCode === null
    first.stdin!.end('release')
    const stopped = await exit(first)
    const lockCleaned = !existsSync(`${path}.lock`)
    evidence('live-lock', { firstAliveDuringSecondOpen: firstAlive, lockOwnerMatched: lockBefore.pid === first.pid, secondExitCode: second.status, response, ownerUnchanged, firstExit: stopped, lockCleaned })
    expect(second.error).toBeUndefined(); expect(second.status).toBe(2)
    expect(response.opened).toBe(false); expect(response.message).toMatch(/locked by pid/)
    expect(firstAlive).toBe(true); expect(ownerUnchanged).toBe(true)
    expect(stopped.code).toBe(0); expect(lockCleaned).toBe(true)
    const reopened = openStore({ dbPath: path }); reopened.close()
  }, 20000)

  it('clamps clock rollback metrics and does not nudge, cancel or escalate a future-start Worker', async () => {
    const assignment: WatchdogAssignment = { assignmentId: 'clock-assignment', ticketId: 'clock-ticket', sessionId: 'fake-worker', state: 'running', startedAt: 10_000, lastProgressAt: 10_000, steps: 0, tokens: 0, briefGoal: 'clock fixture' }
    const calls: string[] = [], audit: WatchdogAudit[] = []
    const watchdog = createWatchdog({ sessionQuery: { async readSession(sessionId) { return { sessionId, events: [] } } }, assignments: async () => [assignment], async nudge() { calls.push('nudge') }, async steer() { calls.push('steer') }, async cancel() { calls.push('cancel') }, async escalate() { calls.push('escalate') }, audit(record) { audit.push(record) } }, { stallMs: defaults.stallMs, repeatCallThreshold: defaults.repeatCallThreshold, waitingHumanMs: defaults.waitingHumanMs, maxSteps: defaults.maxStepsPerTicket, maxTokens: defaults.maxTokensPerTicket, maxDurationMs: defaults.maxDurationMsPerTicket, deviationIntervalMs: 60_000 })
    const times = [9000, 1000, 0, 9999, 10000, 10001]
    const samples = times.map(now => ({ now, metrics: measureWorker({ ...assignment, waitingSince: 10_000 }, [], now) }))
    for (const now of times) await watchdog.tick(now)
    evidence('clock', { times, samples, actualCalls: calls, audit })
    expect(samples.every(({ metrics }) => metrics.stallMs >= 0 && metrics.durationMs >= 0 && metrics.waitingMs >= 0)).toBe(true)
    expect(samples[0]!.metrics).toMatchObject({ stallMs: 0, durationMs: 0, waitingMs: 0 })
    expect(calls).toEqual([]); expect(audit).toEqual([])
  })

  it('reconciles an actually absent Worker session to orphaned and leaves a live fake Worker untouched', async () => {
    const store = openStore({ dbPath: join(temporary(), 'orphan.sqlite') })
    cleanup.push(() => store.close())
    for (const [id, session] of [['missing', 'gone-session'], ['alive', 'live-session']]) {
      store.repos.ticket.insert({ id: `ticket-${id}`, thread_key: `thread-${id}`, decision_id: `decision-${id}`, title: 'fixture', state: 'running', mandate_json: {}, brief_json: {}, workdir: '/tmp/fixture', current_assignment: `assignment-${id}`, created_at: 1, updated_at: 1 })
      store.repos.assignment.insert({ id: `assignment-${id}`, ticket_id: `ticket-${id}`, session_id: session, state: 'running', created_at: 1, started_at: 1, last_progress_at: 1 })
    }
    const report = await reconcile(store, { liveSessionIds: () => new Set(['live-session']) }, { now: () => 20 })
    const assignments = store.repos.assignment.all().map(row => ({ id: row.id, state: row.state, endedAt: row.ended_at, endedReason: row.ended_reason }))
    const tickets = store.repos.ticket.all().map(row => ({ id: row.id, state: row.state, currentAssignment: row.current_assignment }))
    evidence('orphan', { report, assignments, tickets, audit: store.repos.audit.all() })
    expect(report.assignments).toEqual({ scanned: 2, orphaned: 1 })
    expect(store.repos.assignment.get('assignment-missing')).toMatchObject({ state: 'ended', ended_reason: 'orphaned', ended_at: 20 })
    expect(store.repos.ticket.get('ticket-missing')).toMatchObject({ state: 'open', current_assignment: null })
    expect(store.repos.assignment.get('assignment-alive')?.state).toBe('running')
  })
})
