/**
 * L2 process-tree confinement: one Worker command runs as a new process group
 * under the platform runner, is killed as a whole group, and reports bounded,
 * coded results. The runner never falls back to an unconfined shell: a missing
 * or unusable runner is a hard failure.
 *
 * @module dsh-go/isolation/shell
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import {
  NETWORK_POLICY, SANDBOX_EXEC, SUPPORTED_PLATFORM, buildIsolatedEnv, buildSeatbeltProfile,
  canonicalTicketDir, isolatedEnvDirectories, profileDigest,
} from './seatbelt.js'

/** Stable failure codes returned to the Worker model and covered by tests. */
export const GO_BASH_CODES = Object.freeze({
  ok: 'SA_GO_BASH_OK',
  invalid: 'SA_GO_BASH_INVALID',
  workdir: 'SA_GO_BASH_WORKDIR_INVALID',
  unavailable: 'SA_GO_BASH_UNAVAILABLE',
  denied: 'SA_GO_BASH_DENIED',
  timeout: 'SA_GO_BASH_TIMEOUT',
  aborted: 'SA_GO_BASH_ABORTED',
  outputLimit: 'SA_GO_BASH_OUTPUT_LIMIT',
  exit: 'SA_GO_BASH_EXIT',
})

const DEFAULT_TIMEOUT_MS = 120_000
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 600_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const MIN_MAX_OUTPUT_BYTES = 4_096
const MAX_MAX_OUTPUT_BYTES = 8_388_608
/** A single worker command is one model-authored shell line, not a script upload. */
const MAX_COMMAND_BYTES = 100_000

/** One command request; `ticketKey` groups tracked process groups for stop/cleanup. */
export interface IsolatedCommandOptions {
  readonly ticketKey?: string
  readonly ticketDir: string
  readonly command: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

/** Coded result. `ok` means the confined command exited 0; every other field is evidence. */
export interface IsolatedCommandResult {
  readonly ok: boolean
  readonly code: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly outputTruncated: boolean
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly denied: boolean
  readonly durationMs: number
  readonly profileDigest: string
  readonly networkPolicy: typeof NETWORK_POLICY
}

function failure(code: string, ticketDir: string, extra: Partial<IsolatedCommandResult> = {}): IsolatedCommandResult {
  let digest = ''
  try { digest = profileDigest(ticketDir) } catch { digest = '' }
  return { ok: false, code, exitCode: null, signal: null, stdout: '', stderr: '', outputTruncated: false, timedOut: false, aborted: false, denied: false, durationMs: 0, profileDigest: digest, networkPolicy: NETWORK_POLICY, ...extra }
}

/** Kill one process group; ESRCH means it is already gone. Never throws. */
function killGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  try { process.kill(-pid, signal) } catch { /* already reaped or re-parented */ }
}

/** Denial detection is a report fact, never the enforcement itself. */
const DENIAL_SIGNATURE = /Operation not permitted|sandbox_apply:.*permitted|sandbox-exec:.*deny/i

/**
 * Supervisor for confined Worker commands. Tracks process groups per Ticket so
 * a stop/cleanup can kill the whole tree even when the foreground shell already
 * returned.
 */
export class IsolatedShell {
  private readonly active = new Map<string, Set<number>>()

  /** Availability of the OS runner; no PATH fallback and no silent unconfined mode. */
  availability(): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly reason: string } {
    if (process.platform !== SUPPORTED_PLATFORM) return { ok: false, code: GO_BASH_CODES.unavailable, reason: 'unsupported-platform' }
    if (!existsSync(SANDBOX_EXEC)) return { ok: false, code: GO_BASH_CODES.unavailable, reason: 'runner-missing' }
    return { ok: true }
  }

  /** Run one command confined to the Ticket directory. Never rejects for command outcomes. */
  async run(options: IsolatedCommandOptions): Promise<IsolatedCommandResult> {
    let directory: string
    try { directory = canonicalTicketDir(options.ticketDir) } catch { return failure(GO_BASH_CODES.workdir, options.ticketDir) }
    const availability = this.availability()
    if (!availability.ok) return failure(availability.code, directory)
    if (typeof options.command !== 'string' || !options.command.trim() || options.command.includes('\0') || Buffer.byteLength(options.command, 'utf8') > MAX_COMMAND_BYTES) {
      return failure(GO_BASH_CODES.invalid, directory)
    }
    const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const maxOutputBytes = clampInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, MIN_MAX_OUTPUT_BYTES, MAX_MAX_OUTPUT_BYTES)
    let profile: string
    let env: Record<string, string>
    try {
      profile = buildSeatbeltProfile(directory)
      env = buildIsolatedEnv(directory)
      for (const cacheDir of isolatedEnvDirectories(directory)) mkdirSync(cacheDir, { recursive: true })
    } catch { return failure(GO_BASH_CODES.workdir, directory) }
    const startedAt = Date.now()
    const ticketKey = typeof options.ticketKey === 'string' && options.ticketKey ? options.ticketKey : directory
    let child
    try {
      // A new session/process group: `detached` makes the child its own group leader,
      // so `kill(-pid)` reaches descendants the shell did not wait for.
      child = spawn(SANDBOX_EXEC, ['-p', profile, '--', '/bin/bash', '--noprofile', '--norc', '-c', options.command], {
        cwd: directory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
    } catch { return failure(GO_BASH_CODES.unavailable, directory) }
    const pid = child.pid
    if (typeof pid !== 'number' || pid <= 0) return failure(GO_BASH_CODES.unavailable, directory)
    this.track(ticketKey, pid)
    return await new Promise<IsolatedCommandResult>(resolve => {
      let settled = false
      let timedOut = false
      let aborted = false
      let outputTruncated = false
      let stdout = ''
      let stderr = ''
      const finish = (code: string, exitCode: number | null, signal: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        killGroup(pid)
        this.untrack(ticketKey, pid)
        const denied = exitCode !== 0 && DENIAL_SIGNATURE.test(stderr)
        resolve({
          ok: code === GO_BASH_CODES.ok,
          code: code === GO_BASH_CODES.exit && denied ? GO_BASH_CODES.denied : code,
          exitCode, signal, stdout, stderr, outputTruncated, timedOut, aborted,
          denied: denied || code === GO_BASH_CODES.denied,
          durationMs: Date.now() - startedAt, profileDigest: profileDigest(directory), networkPolicy: NETWORK_POLICY,
        })
      }
      const onAbort = (): void => { aborted = true; killGroup(pid); finish(GO_BASH_CODES.aborted, null, null) }
      const timer = setTimeout(() => { timedOut = true; killGroup(pid); finish(GO_BASH_CODES.timeout, null, null) }, timeoutMs)
      timer.unref?.()
      if (options.signal?.aborted) { onAbort(); return }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const capture = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
        const current = stream === 'stdout' ? stdout : stderr
        const remaining = maxOutputBytes - Buffer.byteLength(current, 'utf8')
        if (remaining <= 0) { outputTruncated = true; killGroup(pid); return }
        const text = chunk.toString('utf8')
        const accepted = Buffer.byteLength(text, 'utf8') <= remaining ? text : Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8')
        if (Buffer.byteLength(text, 'utf8') > remaining) { outputTruncated = true; killGroup(pid) }
        if (stream === 'stdout') stdout = current + accepted
        else stderr = current + accepted
      }
      child.stdout?.on('data', (chunk: Buffer) => capture(chunk, 'stdout'))
      child.stderr?.on('data', (chunk: Buffer) => capture(chunk, 'stderr'))
      child.once('error', () => finish(GO_BASH_CODES.unavailable, null, null))
      // `close` waits for every process holding the stdio pipes, so a background
      // child would otherwise delay the result until it exits. Exit of the shell
      // ends the command: kill the whole group, then give the pipes a short grace.
      let exitObserved: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined
      let graceTimer: NodeJS.Timeout | undefined
      child.once('exit', (exitCode, signal) => {
        exitObserved = { code: exitCode, signal }
        killGroup(pid)
        graceTimer = setTimeout(() => {
          if (exitObserved === undefined || settled) return
          finish(outputTruncated ? GO_BASH_CODES.outputLimit : exitObserved.code === 0 ? GO_BASH_CODES.ok : GO_BASH_CODES.exit, exitObserved.code, exitObserved.signal === null ? null : String(exitObserved.signal))
        }, 50)
        graceTimer.unref?.()
      })
      child.once('close', (exitCode, signal) => {
        if (graceTimer) clearTimeout(graceTimer)
        if (outputTruncated) { finish(GO_BASH_CODES.outputLimit, exitCode, signal); return }
        finish(exitCode === 0 ? GO_BASH_CODES.ok : GO_BASH_CODES.exit, exitCode, signal)
      })
    })
  }

  /** Kill every tracked process group for one Ticket (stop/end/dispose paths). */
  killTicket(ticketKey: string): void {
    for (const pid of this.active.get(ticketKey) ?? []) killGroup(pid)
    this.active.delete(ticketKey)
  }

  /** Kill every tracked process group; runtime disposal uses this. */
  killAll(): void {
    for (const pids of this.active.values()) for (const pid of pids) killGroup(pid)
    this.active.clear()
  }

  /** Read-only tracked group count (diagnostics only, no paths). */
  activeGroups(): number {
    let count = 0
    for (const pids of this.active.values()) count += pids.size
    return count
  }

  private track(ticketKey: string, pid: number): void {
    const pids = this.active.get(ticketKey) ?? new Set<number>()
    pids.add(pid)
    this.active.set(ticketKey, pids)
  }

  private untrack(ticketKey: string, pid: number): void {
    const pids = this.active.get(ticketKey)
    if (!pids) return
    pids.delete(pid)
    if (pids.size === 0) this.active.delete(ticketKey)
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}
