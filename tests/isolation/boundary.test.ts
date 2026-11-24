import { describe, expect, it } from 'vitest'
import {
  BUNDLED_PROBE_PATH, PROBE_CHECKS, PROBE_RECEIPT_SCHEMA, resolveExecutionBoundary, validateProbeReceipt,
  type ProbeReceipt,
} from '../../src/isolation/boundary.js'
import { ISOLATION_PROBE_VERSION, NETWORK_POLICY, SANDBOX_EXEC, profileTemplateDigest } from '../../src/isolation/seatbelt.js'

const runnerDigest = 'a'.repeat(64)

function receipt(overrides: { readonly [key: string]: unknown } = {}): ProbeReceipt & Record<string, unknown> {
  return {
    schemaVersion: PROBE_RECEIPT_SCHEMA,
    probeVersion: ISOLATION_PROBE_VERSION,
    createdAt: new Date().toISOString(),
    ok: true,
    platform: 'darwin',
    host: { macOS: '27.0.1', node: 'v22.23.1', sandboxExec: { path: SANDBOX_EXEC, sha256: runnerDigest } },
    profile: { templateDigest: profileTemplateDigest(), networkPolicy: NETWORK_POLICY },
    checks: PROBE_CHECKS.map(check => ({
      id: check.id, kind: check.kind, passed: true, exitCode: check.kind === 'denied' ? 1 : 0,
      ...(check.kind === 'allowed' ? { succeeded: true } : {}),
      ...(check.kind === 'denied' ? { outsideCreated: false } : {}),
      ...(check.kind === 'cleanup' ? { cleanupOk: true } : {}),
    })),
    ...overrides,
  }
}

const expectation = { templateDigest: profileTemplateDigest(), runnerPath: SANDBOX_EXEC, runnerDigest, platform: 'darwin', probeVersion: ISOLATION_PROBE_VERSION }
const probePath = '/var/lib/go-probe/result.json'
const deps = (text: string, platform = 'darwin') => ({
  platform, exists: () => true, readFile: () => text, runnerDigest: () => runnerDigest,
})
const receiptJSON = (overrides: { readonly [key: string]: unknown } = {}): string => JSON.stringify(receipt(overrides))

describe('execution boundary gate', () => {
  it('is fail-closed by default and without a probe path', () => {
    expect(resolveExecutionBoundary({ executionBoundary: 'unverified', executionProbePath: '' })).toEqual({ requested: 'unverified', allowed: false, reason: 'unverified' })
    // Empty probe path means the package-bundled receipt; a simulated absent receipt stays closed.
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: '' }, { platform: 'darwin', exists: path => path === SANDBOX_EXEC, readFile: () => '', runnerDigest: () => runnerDigest })).toMatchObject({ allowed: false, reason: 'probe-missing' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: 'relative/result.json' })).toMatchObject({ allowed: false, reason: 'probe-path-missing' })
    expect(BUNDLED_PROBE_PATH.endsWith('/probes/worker-isolation/result.json')).toBe(true)
  })

  it('opens only for a complete receipt bound to this profile and runner', () => {
    const decision = resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, deps(receiptJSON()))
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: '' }, deps(receiptJSON()))).toMatchObject({ allowed: true, reason: 'verified' })
    expect(decision).toMatchObject({ requested: 'verified-dir', allowed: true, reason: 'verified' })
    expect(decision.receiptDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails closed on missing, unreadable, malformed, failed or stale evidence', () => {
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, { platform: 'darwin', exists: (path: string) => path === SANDBOX_EXEC, readFile: () => '', runnerDigest: () => runnerDigest })).toMatchObject({ allowed: false, reason: 'probe-missing' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, { platform: 'darwin', exists: () => true, readFile: () => { throw new Error('denied') }, runnerDigest: () => runnerDigest })).toMatchObject({ allowed: false, reason: 'probe-unreadable' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, deps('not json'))).toMatchObject({ allowed: false, reason: 'probe-invalid' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, deps(receiptJSON({ ok: false })))).toMatchObject({ allowed: false, reason: 'probe-failed' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, deps(receiptJSON({ profile: { templateDigest: 'f'.repeat(64), networkPolicy: NETWORK_POLICY } })))).toMatchObject({ allowed: false, reason: 'probe-invalid' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, deps(receiptJSON({ host: { macOS: '27.0.1', node: 'v22.23.1', sandboxExec: { path: SANDBOX_EXEC, sha256: 'b'.repeat(64) } } })))).toMatchObject({ allowed: false, reason: 'runner-changed' })
    expect(resolveExecutionBoundary({ executionBoundary: 'verified-dir', executionProbePath: probePath }, deps(receiptJSON(), 'linux'))).toMatchObject({ allowed: false, reason: 'unsupported-platform' })
  })

  it('rejects receipts missing any required counterexample or carrying a failed check', () => {
    const incomplete = receipt() as ProbeReceipt & Record<string, unknown>
    ;(incomplete as unknown as { checks: unknown[] }).checks = (incomplete.checks as unknown[]).slice(1)
    expect(validateProbeReceipt(incomplete, expectation)).toEqual({ ok: false, reason: 'probe-invalid' })

    const failedCheck = receipt()
    ;(failedCheck as unknown as { checks: any[] }).checks = (failedCheck.checks as any[]).map(check => check.id === 'deny-home-write' ? { ...check, passed: false } : check)
    expect(validateProbeReceipt(failedCheck, expectation)).toEqual({ ok: false, reason: 'probe-failed' })

    const lied = receipt()
    ;(lied as unknown as { checks: any[] }).checks = (lied.checks as any[]).map(check => check.id === 'deny-cross-ticket-write' ? { ...check, outsideCreated: true } : check)
    expect(validateProbeReceipt(lied, expectation)).toEqual({ ok: false, reason: 'probe-failed' })

    const duplicate = receipt()
    ;(duplicate as unknown as { checks: any[] }).checks = [...(duplicate.checks as any[]), (duplicate.checks as any[])[0]]
    expect(validateProbeReceipt(duplicate, expectation)).toEqual({ ok: false, reason: 'probe-invalid' })
  })
})
