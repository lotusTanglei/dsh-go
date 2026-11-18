import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { openStore } from '../../src/store/index.js'
import { reconcile } from '../../src/engine/recovery.js'
import { drainOutbox } from '../../src/engine/outbox.js'

const dirs: string[] = []
const fixture = join(process.cwd(), 'tests/fixtures/crash-writer.mjs')
const timeoutMs = 10_000

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    if (!dir.startsWith(join(tmpdir(), 'crash-recovery-'))) throw new Error(`refusing to remove unexpected path: ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onError)
      child.off('error', onChildError)
      child.off('exit', onExit)
    }
    const done = (error?: Error) => { cleanup(); error ? reject(error) : resolve() }
    const onData = (chunk: Buffer | string) => {
      output += String(chunk)
      if (output.includes('CRASH_WRITER_READY\n')) done()
    }
    const onError = (chunk: Buffer | string) => { output += String(chunk) }
    const onChildError = (error: Error) => done(error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => done(new Error(`crash writer exited before ready (code=${code}, signal=${signal}): ${output}`))
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onError)
    child.once('error', onChildError)
    child.once('exit', onExit)
    timer = setTimeout(() => done(new Error(`timed out waiting for crash writer readiness: ${output}`)), timeoutMs)
  })
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => { if (timer) clearTimeout(timer); child.off('error', onError); child.off('exit', onExit) }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => { cleanup(); resolve({ code, signal }) }
    child.once('error', onError)
    child.once('exit', onExit)
    timer = setTimeout(() => { cleanup(); reject(new Error('timed out waiting for killed crash writer to exit')) }, timeoutMs)
  })
}

describe('crash recovery with a real SIGKILL', () => {
  it('kills a child holding the store lock, restarts with staleLockMs=0, reconciles durable work, and sends once by idempotency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crash-recovery-'))
    dirs.push(dir)
    const dbPath = join(dir, 'state.sqlite')
    const child = spawn(process.execPath, [fixture, dbPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await waitForReady(child)
      expect(child.kill('SIGKILL')).toBe(true)
      const exited = await waitForExit(child)
      expect(exited.signal).toBe('SIGKILL')

      const lockPath = `${dbPath}.lock`
      expect(existsSync(lockPath)).toBe(true)
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number; startedAt?: number; nonce?: string }
      expect(lock.pid).toBe(child.pid)
      expect(typeof lock.nonce).toBe('string')

      const store = openStore({ dbPath, staleLockMs: 0 })
      try {
        const queued: string[] = []
        const report = await reconcile(store, {
          liveSessionIds: () => new Set(),
          enqueue: async (_thread, triggerId) => { queued.push(String(triggerId)) },
        }, { now: () => 20 })
        expect(report.assignments).toEqual({ scanned: 1, orphaned: 1 })
        expect(report.outbox.requeued).toBe(1)
        expect(report.queue).toEqual({ scanned: 1, requeued: 1 })
        expect(queued).toEqual(['session:crash:crash-trigger-1'])
        expect(store.db.prepare('SELECT state, ended_reason FROM assignment').get()).toEqual({ state: 'ended', ended_reason: 'orphaned' })
        expect(store.db.prepare('SELECT state, current_assignment FROM ticket').get()).toEqual({ state: 'open', current_assignment: null })
        expect(store.db.prepare('SELECT state FROM thread_trigger').get()).toEqual({ state: 'pending' })
        expect(store.db.prepare('SELECT delivered_to FROM trigger_disposition').get()).toEqual({ delivered_to: null })

        let sendAttempts = 0
        const delivered: string[] = []
        const sender = { async send(message: { idempotencyKey: string }) {
          sendAttempts++
          const ledgerKey = `send:${message.idempotencyKey}`
          const prior = store.repos.side_effect.get(ledgerKey)
          if (prior) return
          store.repos.side_effect.insert({ key: ledgerKey, kind: 'outbound-send', ticket_id: 'ticket-crash', at: 20, state: 'done', detail: { idempotencyKey: message.idempotencyKey } })
          delivered.push(message.idempotencyKey)
        } }
        const first = await drainOutbox(store, sender, { now: () => 20 })
        expect(first.sent).toBe(1)
        const second = await drainOutbox(store, sender, { now: () => 20 })
        expect(second.sent).toBe(0)
        expect(sendAttempts).toBe(1)
        expect(delivered).toEqual([])
        expect(store.db.prepare('SELECT state, attempts FROM outbound').get()).toEqual({ state: 'sent', attempts: 1 })
        expect(store.repos.side_effect.get('send:crash-idempotency-1')).toMatchObject({ state: 'done' })
      } finally {
        store.close()
      }
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      // Timeout/error cleanup must not depend on ChildProcess#killed: that flag only
      // records that a signal was sent, not that the process has exited.
      if (child.exitCode === null && child.signalCode === null) {
        if (!child.killed) child.kill('SIGKILL')
        try { await waitForExit(child) } catch { /* preserve test failure */ }
      }
    }
  }, timeoutMs * 2)
})
