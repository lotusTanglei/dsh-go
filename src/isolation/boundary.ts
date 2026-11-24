/**
 * The single execution-boundary decision shared by Worker start, recovery and
 * the tool guard.
 *
 * Fail-closed is the default. `verified-dir` is honored only when a locally
 * generated probe receipt exists, passes every required isolation check, was
 * produced by this exact profile template, and matches the currently installed
 * `sandbox-exec`. The receipt is local operational evidence, not cryptographic
 * attestation: it binds this machine's runner bytes and this implementation's
 * template digest, which is why editing either one invalidates it.
 *
 * @module dsh-go/isolation/boundary
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ISOLATION_PROBE_VERSION, NETWORK_POLICY, SANDBOX_EXEC, SUPPORTED_PLATFORM,
  fileDigest, profileTemplateDigest,
} from './seatbelt.js'

/** Required probe checks and the exact outcome kind each must report. */
export const PROBE_CHECKS = Object.freeze([
  { id: 'normal-write', kind: 'allowed' },
  { id: 'normal-read', kind: 'allowed' },
  { id: 'normal-heredoc-inside', kind: 'allowed' },
  { id: 'normal-python-inside', kind: 'allowed' },
  { id: 'normal-compile', kind: 'allowed' },
  { id: 'normal-test', kind: 'allowed' },
  { id: 'deny-parent-write', kind: 'denied' },
  { id: 'deny-cross-ticket-write', kind: 'denied' },
  { id: 'deny-home-write', kind: 'denied' },
  { id: 'deny-temp-write', kind: 'denied' },
  { id: 'deny-heredoc-outside', kind: 'denied' },
  { id: 'deny-python-outside', kind: 'denied' },
  { id: 'deny-background-outside', kind: 'denied' },
  { id: 'deny-symlink-dir-escape', kind: 'denied' },
  { id: 'deny-symlink-file-escape', kind: 'denied' },
  { id: 'deny-hardlink-escape', kind: 'denied' },
  { id: 'deny-nested-sandbox', kind: 'denied' },
  { id: 'kill-process-group', kind: 'cleanup' },
] as const)

/** Probe receipt schema version (the JSON file contract). */
export const PROBE_RECEIPT_SCHEMA = 1

/** Maximum bytes read from a receipt file; a larger file is not valid local evidence. */
export const MAX_PROBE_RECEIPT_BYTES = 512 * 1024

/**
 * Receipt bundled with this package (`<package root>/probes/worker-isolation/result.json`).
 * An empty `executionProbePath` means this portable default, so a packaged install
 * never depends on the build machine's absolute paths; a runner/profile mismatch
 * on another machine still fails closed.
 */
export const BUNDLED_PROBE_PATH = resolve(fileURLToPath(new URL('../../probes/worker-isolation/result.json', import.meta.url)))

/** Why the production Worker boundary is (not) open. Fixed tokens only; no paths. */
export type BoundaryReason =
  | 'unverified'
  | 'probe-path-missing'
  | 'probe-missing'
  | 'probe-unreadable'
  | 'probe-invalid'
  | 'probe-failed'
  | 'runner-missing'
  | 'runner-changed'
  | 'unsupported-platform'
  | 'verified'

/** One decision consumed by start, recovery and guard. `allowed` is the only permission fact. */
export interface BoundaryDecision {
  readonly requested: 'unverified' | 'verified-dir'
  readonly allowed: boolean
  readonly reason: BoundaryReason | string
  readonly receiptDigest?: string
}

/** Minimal config slice read by the boundary. */
export interface ExecutionBoundaryConfig {
  readonly executionBoundary: 'unverified' | 'verified-dir'
  readonly executionProbePath: string
}

export type ProbeCheck = {
  readonly id: string
  readonly kind: 'allowed' | 'denied' | 'cleanup'
  readonly passed: boolean
  readonly exitCode: number | null
  readonly succeeded?: boolean
  readonly outsideCreated?: boolean
  readonly cleanupOk?: boolean
  readonly detail?: string
}

/** Receipt shape written by `probes/worker-isolation/run.mjs`. */
export interface ProbeReceipt {
  readonly schemaVersion: number
  readonly probeVersion: number
  readonly createdAt: string
  readonly ok: boolean
  readonly platform: string
  readonly host: {
    readonly macOS: string
    readonly node: string
    readonly sandboxExec: { readonly path: string; readonly sha256: string }
  }
  readonly profile: { readonly templateDigest: string; readonly networkPolicy: string }
  readonly checks: readonly ProbeCheck[]
}

export interface ProbeExpectation {
  readonly templateDigest: string
  readonly runnerPath: string
  readonly runnerDigest: string
  readonly platform: string
  readonly probeVersion: number
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function checkIsValid(check: ProbeCheck): boolean {
  if (!check || typeof check !== 'object') return false
  if (typeof check.id !== 'string' || !check.id) return false
  if (!['allowed', 'denied', 'cleanup'].includes(check.kind)) return false
  if (check.passed !== true) return false
  if (check.exitCode !== null && !Number.isSafeInteger(check.exitCode)) return false
  if (check.kind === 'allowed' && check.succeeded !== true) return false
  if (check.kind === 'denied' && check.outsideCreated !== false) return false
  if (check.kind === 'cleanup' && check.cleanupOk !== true) return false
  return true
}

/**
 * Pure receipt validation against the current implementation and runner.
 * @param raw - parsed JSON value of the receipt file.
 * @param expected - current template/runner expectations.
 * @returns `{ok:true}` with the requirement table satisfied, or the fixed reason.
 */
export function validateProbeReceipt(raw: unknown, expected: ProbeExpectation): { readonly ok: true } | { readonly ok: false; readonly reason: BoundaryReason } {
  if (expected.platform !== SUPPORTED_PLATFORM) return { ok: false, reason: 'unsupported-platform' }
  if (!isPlainObject(raw)) return { ok: false, reason: 'probe-invalid' }
  if (raw.schemaVersion !== PROBE_RECEIPT_SCHEMA || raw.probeVersion !== expected.probeVersion) return { ok: false, reason: 'probe-invalid' }
  if (raw.platform !== SUPPORTED_PLATFORM) return { ok: false, reason: 'probe-invalid' }
  if (raw.ok !== true) return { ok: false, reason: 'probe-failed' }
  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) return { ok: false, reason: 'probe-invalid' }
  if (!isPlainObject(raw.host) || !isPlainObject(raw.host.sandboxExec)) return { ok: false, reason: 'probe-invalid' }
  if (raw.host.sandboxExec.path !== expected.runnerPath) return { ok: false, reason: 'runner-changed' }
  if (raw.host.sandboxExec.sha256 !== expected.runnerDigest) return { ok: false, reason: 'runner-changed' }
  if (!isPlainObject(raw.profile) || raw.profile.templateDigest !== expected.templateDigest) return { ok: false, reason: 'probe-invalid' }
  if (raw.profile.networkPolicy !== NETWORK_POLICY) return { ok: false, reason: 'probe-invalid' }
  if (typeof raw.host.macOS !== 'string' || typeof raw.host.node !== 'string') return { ok: false, reason: 'probe-invalid' }
  if (!Array.isArray(raw.checks) || raw.checks.length < PROBE_CHECKS.length || raw.checks.length > 128) return { ok: false, reason: 'probe-invalid' }
  const checks = raw.checks as readonly ProbeCheck[]
  const byId = new Map<string, ProbeCheck>()
  for (const check of checks) {
    if (!isPlainObject(check) || typeof check.id !== 'string' || !check.id || byId.has(check.id)) return { ok: false, reason: 'probe-invalid' }
    byId.set(check.id, check)
  }
  for (const required of PROBE_CHECKS) {
    const check = byId.get(required.id)
    if (!check) return { ok: false, reason: 'probe-failed' }
    if (check.kind !== required.kind || !checkIsValid(check)) return { ok: false, reason: 'probe-failed' }
  }
  return { ok: true }
}

/**
 * Resolve the one production decision from config and local evidence.
 * @param config - execution boundary configuration.
 * @param deps - injection seam for tests; production reads the real machine.
 * @returns the decision consumed by every production execution path.
 */
export function resolveExecutionBoundary(
  config: ExecutionBoundaryConfig,
  deps: {
    readonly platform?: string
    readonly exists?: (path: string) => boolean
    readonly readFile?: (path: string) => string
    readonly runnerDigest?: (path: string) => string
  } = {},
): BoundaryDecision {
  const requested = config.executionBoundary
  if (requested !== 'verified-dir') return { requested: 'unverified', allowed: false, reason: 'unverified' }
  if (typeof config.executionProbePath !== 'string' || (config.executionProbePath !== '' && !isAbsolute(config.executionProbePath))) {
    return { requested, allowed: false, reason: 'probe-path-missing' }
  }
  const probePath = config.executionProbePath === '' ? BUNDLED_PROBE_PATH : config.executionProbePath
  const platform = deps.platform ?? process.platform
  if (platform !== SUPPORTED_PLATFORM) return { requested, allowed: false, reason: 'unsupported-platform' }
  const exists = deps.exists ?? existsSync
  const read = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const runner = deps.runnerDigest ?? fileDigest
  if (!exists(SANDBOX_EXEC)) return { requested, allowed: false, reason: 'runner-missing' }
  if (!exists(probePath)) return { requested, allowed: false, reason: 'probe-missing' }
  let text: string
  try { text = read(probePath) } catch { return { requested, allowed: false, reason: 'probe-unreadable' } }
  if (Buffer.byteLength(text, 'utf8') > MAX_PROBE_RECEIPT_BYTES) return { requested, allowed: false, reason: 'probe-invalid' }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { requested, allowed: false, reason: 'probe-invalid' } }
  let runnerDigest: string
  try { runnerDigest = runner(SANDBOX_EXEC) } catch { return { requested, allowed: false, reason: 'runner-missing' } }
  const validation = validateProbeReceipt(raw, { templateDigest: profileTemplateDigest(), runnerPath: SANDBOX_EXEC, runnerDigest, platform, probeVersion: ISOLATION_PROBE_VERSION })
  if (!validation.ok) return { requested, allowed: false, reason: validation.reason }
  return { requested, allowed: true, reason: 'verified', receiptDigest: digest(text) }
}
