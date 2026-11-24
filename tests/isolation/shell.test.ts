import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GO_BASH_CODES, IsolatedShell } from '../../src/isolation/shell.js'

const darwin = process.platform === 'darwin'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    const absolute = mkdtempRoot(dir)
    if (absolute) rmSync(dir, { recursive: true, force: true })
  }
})
function mkdtempRoot(dir: string): string | undefined {
  return dir.startsWith(tmpdir()) && dir.includes('go-shell-') ? dir : undefined
}
function fixture(): { root: string; ticket: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'go-shell-'))
  dirs.push(root)
  const ticket = join(root, 'ticket-a')
  const outside = join(root, 'outside')
  mkdirSync(ticket, { recursive: true })
  mkdirSync(outside, { recursive: true })
  return { root, ticket, outside }
}

describe('L2 isolated shell', () => {
  it('reports the runner honestly instead of falling back to an unconfined shell', () => {
    const shell = new IsolatedShell()
    const availability = shell.availability()
    if (darwin) expect(availability).toEqual({ ok: true })
    else expect(availability).toMatchObject({ ok: false, reason: 'unsupported-platform' })
  })

  it.skipIf(!darwin)('runs ordinary commands inside the Ticket and returns their output', async () => {
    const { ticket } = fixture()
    const shell = new IsolatedShell()
    const result = await shell.run({ ticketDir: ticket, command: "printf 'inside-ok\\n' > inside.txt && cat inside.txt" })
    expect(result).toMatchObject({ ok: true, code: GO_BASH_CODES.ok, exitCode: 0, denied: false, timedOut: false })
    expect(result.stdout).toBe('inside-ok\n')
    expect(readFileSync(join(ticket, 'inside.txt'), 'utf8')).toBe('inside-ok\n')
    expect(result.networkPolicy).toBe('unrestricted')
    expect(result.profileDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it.skipIf(!darwin)('denies writes outside the Ticket directory and reports a denial code', async () => {
    const { root, ticket, outside } = fixture()
    const shell = new IsolatedShell()
    const parentWrite = await shell.run({ ticketDir: ticket, command: 'printf x > ../parent.txt' })
    expect(parentWrite.ok).toBe(false)
    expect(parentWrite.code).toBe(GO_BASH_CODES.denied)
    expect(parentWrite.denied).toBe(true)
    expect(existsSync(join(root, 'parent.txt'))).toBe(false)
    const outsideWrite = await shell.run({ ticketDir: ticket, command: `printf x > "${join(outside, 'escaped.txt')}"` })
    expect(outsideWrite.ok).toBe(false)
    expect(existsSync(join(outside, 'escaped.txt'))).toBe(false)
    const heredoc = await shell.run({ ticketDir: ticket, command: "cat > ../heredoc.txt <<'EOF'\nx\nEOF" })
    expect(existsSync(join(root, 'heredoc.txt'))).toBe(false)
    expect(heredoc.ok).toBe(false)
    const python = await shell.run({ ticketDir: ticket, command: "python3 -c \"open('../python.txt','w').write('x')\"" })
    if (python.code !== GO_BASH_CODES.unavailable) expect(existsSync(join(root, 'python.txt'))).toBe(false)
  })

  it.skipIf(!darwin)('rejects invalid commands and Ticket directories without spawning', async () => {
    const { ticket } = fixture()
    const shell = new IsolatedShell()
    expect(await shell.run({ ticketDir: ticket, command: '' })).toMatchObject({ ok: false, code: GO_BASH_CODES.invalid })
    expect(await shell.run({ ticketDir: ticket, command: 'a\0b' })).toMatchObject({ ok: false, code: GO_BASH_CODES.invalid })
    expect(await shell.run({ ticketDir: 'relative/path', command: 'true' })).toMatchObject({ ok: false, code: GO_BASH_CODES.workdir })
    expect(await shell.run({ ticketDir: join(ticket, 'missing'), command: 'true' })).toMatchObject({ ok: false, code: GO_BASH_CODES.workdir })
  })

  it.skipIf(!darwin)('kills the whole process group after the foreground command exits', async () => {
    const { ticket } = fixture()
    const shell = new IsolatedShell()
    const result = await shell.run({ ticketDir: ticket, command: 'sleep 30 & echo "PID:$!"', timeoutMs: 20_000 })
    expect(result.ok).toBe(true)
    const pid = Number((result.stdout.match(/PID:(\d+)/) ?? [])[1])
    expect(pid).toBeGreaterThan(0)
    await new Promise(done => setTimeout(done, 250))
    let alive = true
    try { process.kill(pid, 0) } catch { alive = false }
    if (alive) {
      // A zombie is dead for our purposes; the kernel reaps it asynchronously.
      try {
        const stat = (await import('node:child_process')).execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()
        alive = stat !== '' && !stat.startsWith('Z')
      } catch { alive = false }
    }
    expect(alive).toBe(false)
    expect(shell.activeGroups()).toBe(0)
  })

  it.skipIf(!darwin)('kills a running command group on timeout and on abort', async () => {
    const { ticket } = fixture()
    const shell = new IsolatedShell()
    const timedOut = await shell.run({ ticketDir: ticket, command: 'sleep 30', timeoutMs: 250 })
    expect(timedOut).toMatchObject({ ok: false, code: GO_BASH_CODES.timeout, timedOut: true })
    expect(timedOut.durationMs).toBeLessThan(10_000)
    expect(shell.activeGroups()).toBe(0)

    const controller = new AbortController()
    const pending = shell.run({ ticketDir: ticket, command: 'sleep 30', signal: controller.signal, timeoutMs: 20_000 })
    setTimeout(() => controller.abort(), 100)
    const aborted = await pending
    expect(aborted).toMatchObject({ ok: false, code: GO_BASH_CODES.aborted, aborted: true })
  })

  it.skipIf(!darwin)('bounds output and kills the producer', async () => {
    const { ticket } = fixture()
    const shell = new IsolatedShell()
    const result = await shell.run({ ticketDir: ticket, command: 'yes go-isolation-probe', maxOutputBytes: 4_096, timeoutMs: 20_000 })
    expect(result.outputTruncated).toBe(true)
    expect(['SA_GO_BASH_OUTPUT_LIMIT', 'SA_GO_BASH_EXIT']).toContain(result.code)
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(4_096)
  })

  it.skipIf(!darwin)('killTicket ends the tracked process group for one Ticket', async () => {
    const { ticket } = fixture()
    const shell = new IsolatedShell()
    const running = shell.run({ ticketDir: ticket, command: 'sleep 30', ticketKey: 'ticket-a', timeoutMs: 20_000 })
    await new Promise(done => setTimeout(done, 150))
    expect(shell.activeGroups()).toBe(1)
    shell.killTicket('ticket-a')
    const result = await running
    expect(result.ok).toBe(false)
    expect(result.code).not.toBe(GO_BASH_CODES.ok)
    expect(shell.activeGroups()).toBe(0)
  })
})
