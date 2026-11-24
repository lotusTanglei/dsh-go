#!/usr/bin/env node
/**
 * L2 / L1 isolation probe (macOS, real kernel enforcement).
 *
 * Runs the SAME built production boundary modules the plugin uses
 * (`lib/isolation/*` and `lib/tools/go-bash.js`) against throwaway Ticket
 * directories under the repository — never a platform temporary root, because
 * shared temp grants are exactly what the boundary must not rely on.
 *
 * It proves: writes inside the Ticket directory work (including compile/test),
 * while parent / sibling-Ticket / home / temp writes, heredoc, python, delayed
 * background processes, symlink escapes, hardlinks and nested sandbox attempts
 * are all denied; the whole process group is killed.
 *
 * Writes the receipt consumed by `executionBoundary: verified-dir` to
 * `probes/worker-isolation/result.json`. Exit code 0 only when every required
 * check passed; on failure the receipt records `ok:false` and no release should
 * be derived from it.
 *
 * Prerequisite: `pnpm -s build`.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const resultPath = join(here, 'result.json')

async function load(relative) {
  const path = join(repoRoot, 'lib', relative)
  if (!existsSync(path)) {
    console.error(`isolation probe: missing ${path}. Run \`pnpm -s build\` first.`)
    process.exit(2)
  }
  return import(pathToFileURL(path).href)
}

const { IsolatedShell } = await load('isolation/shell.js')
const { PROBE_CHECKS, PROBE_RECEIPT_SCHEMA, validateProbeReceipt } = await load('isolation/boundary.js')
const { ISOLATION_PROBE_VERSION, NETWORK_POLICY, SANDBOX_EXEC, profileTemplateDigest } = await load('isolation/seatbelt.js')

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const probeRoot = join(repoRoot, '.probe', 'worker-isolation', runId)
const workRoot = join(probeRoot, 'work')
const ticketA = join(workRoot, 'ticket-a')
const ticketB = join(workRoot, 'ticket-b')
const homeCanary = join(homedir(), `.go-isolation-probe-${runId}`)
const tempCanary = join('/tmp', `go-isolation-probe-${runId}`)
const redact = (value) => String(value ?? '')
  .split(repoRoot).join('<repo>')
  .split(homedir()).join('$HOME')
  .split(runId).join('<run>')

const shell = new IsolatedShell()
const details = []
let failed = 0

function resetProbeDirs() {
  rmSync(probeRoot, { recursive: true, force: true })
  mkdirSync(ticketA, { recursive: true })
  mkdirSync(ticketB, { recursive: true })
}

function cleanupCanaries() {
  for (const path of [homeCanary, tempCanary]) {
    try { rmSync(path, { recursive: true, force: true }) } catch { /* canary never written */ }
  }
}

function alive(pid) {
  try { process.kill(pid, 0) } catch { return false }
  try {
    const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return stat !== '' && !stat.startsWith('Z')
  } catch { return false }
}

function writeInside(relativePath, text, base = ticketA) {
  const absolute = join(base, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, text)
}

async function runCheck(definition) {
  const { id, kind } = definition
  const record = { id, kind, passed: false, exitCode: null, detail: '' }
  try {
    const result = await shell.run({ ticketKey: 'probe', ticketDir: ticketA, command: definition.command, timeoutMs: definition.timeoutMs ?? 60_000 })
    record.exitCode = result.exitCode
    const verdict = definition.verify(result)
    record.passed = Boolean(verdict.passed)
    if (kind === 'allowed') record.succeeded = Boolean(verdict.passed)
    if (kind === 'denied') record.outsideCreated = !verdict.passed
    if (kind === 'cleanup') record.cleanupOk = Boolean(verdict.passed)
    record.detail = redact(verdict.detail ?? '')
    if (!record.passed) failed++
    if (result.stderr && !record.passed) record.detail = `${record.detail} | ${redact(result.stderr).slice(0, 300)}`.trim()
  } catch (error) {
    failed++
    record.detail = `probe-error: ${redact(error?.message ?? error)}`
    if (kind === 'allowed') record.succeeded = false
    if (kind === 'denied') record.outsideCreated = false
    if (kind === 'cleanup') record.cleanupOk = false
  }
  details.push(record)
  if (!record.passed) console.error(`✗ ${id}${record.detail ? ` — ${record.detail}` : ''}`)
  return record
}

const exists = (path) => existsSync(path)
const read = (path) => { try { return readFileSync(path, 'utf8') } catch { return undefined } }

resetProbeDirs()
cleanupCanaries()
try {
  const node = process.execPath
  const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  writeInside('compile-ok.ts', 'export const probeValue: number = 42\n')
  writeInside('normal.test.mjs', "import { test } from 'node:test'\nimport assert from 'node:assert'\ntest('probe test', () => { assert.equal(1 + 1, 2) })\n")

  // ---- positive checks: the boundary must not break ordinary work ----
  await runCheck({ id: 'normal-write', kind: 'allowed', command: "printf 'hello probe\\n' > normal-write.txt", verify: () => ({ passed: read(join(ticketA, 'normal-write.txt')) === 'hello probe\n', detail: 'ticket write' }) })
  await runCheck({ id: 'normal-read', kind: 'allowed', command: 'cat normal-write.txt', verify: result => ({ passed: String(result.stdout).includes('hello probe'), detail: 'ticket read' }) })
  await runCheck({ id: 'normal-heredoc-inside', kind: 'allowed', command: "cat > heredoc.txt <<'GO_PROBE_EOF'\nheredoc inside\nGO_PROBE_EOF", verify: () => ({ passed: read(join(ticketA, 'heredoc.txt')) === 'heredoc inside\n', detail: 'heredoc inside ticket' }) })
  await runCheck({ id: 'normal-python-inside', kind: 'allowed', command: "python3 -c \"open('python-inside.txt','w').write('python-inside')\"", verify: () => ({ passed: read(join(ticketA, 'python-inside.txt')) === 'python-inside', detail: 'python write inside ticket' }) })
  await runCheck({ id: 'normal-compile', kind: 'allowed', command: `"${node}" "${tsc}" --target es2022 --module es2022 --skipLibCheck --outDir build compile-ok.ts && "${node}" build/compile-ok.js`, verify: result => ({ passed: result.exitCode === 0 && exists(join(ticketA, 'build', 'compile-ok.js')), detail: 'TypeScript compile inside ticket' }) })
  await runCheck({ id: 'normal-test', kind: 'allowed', command: `"${node}" --test normal.test.mjs`, verify: result => ({ passed: result.exitCode === 0, detail: 'node:test run inside ticket' }) })

  // ---- negative checks: every escape must fail ----
  await runCheck({ id: 'deny-parent-write', kind: 'denied', command: "printf x > ../parent-write.txt", verify: () => ({ passed: !exists(join(workRoot, 'parent-write.txt')), detail: 'parent directory write' }) })
  await runCheck({ id: 'deny-cross-ticket-write', kind: 'denied', command: "printf x > ../ticket-b/cross-ticket.txt", verify: () => ({ passed: !exists(join(ticketB, 'cross-ticket.txt')), detail: 'sibling Ticket write' }) })
  await runCheck({ id: 'deny-home-write', kind: 'denied', command: `printf x > "${homeCanary}"`, verify: () => ({ passed: !exists(homeCanary), detail: 'user home write' }) })
  await runCheck({ id: 'deny-temp-write', kind: 'denied', command: `printf x > "${tempCanary}"`, verify: () => ({ passed: !exists(tempCanary), detail: 'platform temp write' }) })
  await runCheck({ id: 'deny-heredoc-outside', kind: 'denied', command: "cat > ../heredoc-outside.txt <<'GO_PROBE_EOF'\nx\nGO_PROBE_EOF", verify: () => ({ passed: !exists(join(workRoot, 'heredoc-outside.txt')), detail: 'heredoc outside ticket' }) })
  await runCheck({ id: 'deny-python-outside', kind: 'denied', command: "python3 -c \"open('../python-outside.txt','w').write('x')\"", verify: () => ({ passed: !exists(join(workRoot, 'python-outside.txt')), detail: 'python write outside ticket' }) })
  await runCheck({ id: 'deny-background-outside', kind: 'denied', command: "(sleep 0.2; printf x > ../background-outside.txt) & sleep 1", timeoutMs: 30_000, verify: () => ({ passed: !exists(join(workRoot, 'background-outside.txt')), detail: 'delayed background write outside ticket' }) })

  const symlinkDir = join(ticketA, 'symlink-dir')
  try { unlinkSync(symlinkDir) } catch { /* absent */ }
  symlinkSync(ticketB, symlinkDir)
  await runCheck({ id: 'deny-symlink-dir-escape', kind: 'denied', command: 'printf x > symlink-dir/symlink-dir-escape.txt', verify: () => ({ passed: !exists(join(ticketB, 'symlink-dir-escape.txt')), detail: 'symlink directory escape' }) })

  const victim = join(ticketB, 'symlink-victim.txt')
  writeFileSync(victim, 'original')
  const symlinkFile = join(ticketA, 'symlink-file')
  try { unlinkSync(symlinkFile) } catch { /* absent */ }
  symlinkSync(victim, symlinkFile)
  await runCheck({ id: 'deny-symlink-file-escape', kind: 'denied', command: 'printf replaced > symlink-file', verify: () => ({ passed: read(victim) === 'original', detail: 'symlink file escape' }) })

  const hardlinkVictim = join(ticketB, 'hardlink-victim.txt')
  writeFileSync(hardlinkVictim, 'original')
  await runCheck({ id: 'deny-hardlink-escape', kind: 'denied', command: 'ln ../ticket-b/hardlink-victim.txt hardlink-escape 2>/dev/null && printf replaced > hardlink-escape; exit 0', verify: () => ({ passed: read(hardlinkVictim) === 'original', detail: 'hardlink escape write' }) })

  await runCheck({ id: 'deny-nested-sandbox', kind: 'denied', command: `${SANDBOX_EXEC} -p '(version 1)(allow default)' /bin/bash -c 'printf x > ../nested-sandbox.txt'`, verify: () => ({ passed: !exists(join(workRoot, 'nested-sandbox.txt')), detail: 'nested sandbox widening' }) })

  // ---- process tree cleanup ----
  const backgroundRun = await shell.run({ ticketKey: 'probe', ticketDir: ticketA, command: 'sleep 30 & echo "PID:$!"', timeoutMs: 30_000 })
  const pid = Number((backgroundRun.stdout.match(/PID:(\d+)/) ?? [])[1])
  await new Promise(done => setTimeout(done, 250))
  const killed = Number.isSafeInteger(pid) && pid > 0 && !alive(pid)
  details.push({ id: 'kill-process-group', kind: 'cleanup', passed: killed, exitCode: backgroundRun.exitCode, cleanupOk: killed, detail: killed ? 'background group killed' : 'background process survived' })
  if (!killed) failed++

  // ---- receipt ----
  const sandboxExecDigest = createHash('sha256').update(readFileSync(SANDBOX_EXEC)).digest('hex')
  const receipt = {
    schemaVersion: PROBE_RECEIPT_SCHEMA,
    probeVersion: ISOLATION_PROBE_VERSION,
    createdAt: new Date().toISOString(),
    ok: failed === 0,
    platform: process.platform,
    host: {
      macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
      node: process.version,
      sandboxExec: { path: SANDBOX_EXEC, sha256: sandboxExecDigest },
    },
    profile: { templateDigest: profileTemplateDigest(), networkPolicy: NETWORK_POLICY },
    checks: details,
    disclosure: [
      'Reads are not confined: the boundary promise is write confinement of the process tree.',
      'Network is NOT restricted by this profile; the receipt records networkPolicy=unrestricted.',
      'A process that calls setsid() can leave the killed process group; its writes are still denied by the inherited sandbox.',
      'The promise is confined writes for THIS process tree only. Actions delegated to launchd/system services outside the tree, process signals/IPC to other processes, and network egress are outside the write boundary.',
      'The receipt is local operational evidence bound to the profile template digest and sandbox-exec bytes; it is not a cryptographic attestation.',
    ],
  }
  const validation = validateProbeReceipt(receipt, { templateDigest: profileTemplateDigest(), runnerPath: SANDBOX_EXEC, runnerDigest: sandboxExecDigest, platform: process.platform, probeVersion: ISOLATION_PROBE_VERSION })
  if (!validation.ok) {
    receipt.ok = false
    receipt.selfValidation = validation.reason
    failed++
  }
  writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`isolation probe: ${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`)
  console.log(`receipt: ${resultPath}`)
  if (failed !== 0) {
    for (const detail of details.filter(row => !row.passed)) console.error(`  ✗ ${detail.id}: ${detail.detail}`)
    process.exitCode = 1
  }
} catch (error) {
  console.error(`isolation probe crashed: ${redact(error?.stack ?? error)}`)
  process.exitCode = 1
} finally {
  cleanupCanaries()
  try { rmSync(probeRoot, { recursive: true, force: true }) } catch { /* best effort */ }
}
