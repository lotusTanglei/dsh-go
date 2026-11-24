import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GO_BASH_CODES, IsolatedShell } from '../../src/isolation/shell.js'
import { executeGoBash, goBashDescriptor, goBashFailureMessage, validateGoBashParams } from '../../src/tools/go-bash.js'

const darwin = process.platform === 'darwin'
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) if (dir.startsWith(tmpdir()) && dir.includes('go-bash-')) rmSync(dir, { recursive: true, force: true }) })
function ticket(): string {
  const dir = mkdtempSync(join(tmpdir(), 'go-bash-'))
  dirs.push(dir)
  return dir
}

describe('go_bash tool descriptor', () => {
  it('accepts exactly one bounded command string and rejects every other parameter', () => {
    expect(goBashDescriptor.name).toBe('go_bash')
    expect(validateGoBashParams({ command: 'printf ok' })).toMatchObject({ ok: true })
    expect(validateGoBashParams({ command: 'printf ok', timeoutMs: 1 })).toMatchObject({ ok: false, code: 'SA_TOOL_PARAMETERS_INVALID' })
    expect(validateGoBashParams({ command: 'printf ok', cwd: '/tmp' })).toMatchObject({ ok: false })
    expect(validateGoBashParams({ command: '' })).toMatchObject({ ok: false })
    expect(validateGoBashParams({ command: '   ' })).toMatchObject({ ok: false })
    expect(validateGoBashParams({ command: 'a\0b' })).toMatchObject({ ok: false })
    expect(validateGoBashParams({ command: 'x'.repeat(100_001) })).toMatchObject({ ok: false })
    expect(validateGoBashParams({})).toMatchObject({ ok: false })
    expect(validateGoBashParams({ command: ['printf'] })).toMatchObject({ ok: false })
  })

  it('documents the confinement and the network disclosure in the model-facing description', () => {
    expect(goBashDescriptor.description).toContain('Ticket working copy')
    expect(goBashDescriptor.description).toContain('NOT restricted')
    expect(goBashFailureMessage(GO_BASH_CODES.denied)).toMatch(/denied a write outside/i)
    expect(goBashFailureMessage(GO_BASH_CODES.timeout)).toMatch(/time budget/i)
  })
})

describe('go_bash execution adapter', () => {
  it.skipIf(!darwin)('runs inside the Ticket and reports the exact failure code for escapes', async () => {
    const root = ticket()
    const shell = new IsolatedShell()
    const inside = await executeGoBash({ command: "printf 'go-bash-ok\\n' > result.txt", ticketDir: root, ticketKey: 't1', shell })
    expect(inside).toMatchObject({ ok: true, code: GO_BASH_CODES.ok, networkPolicy: 'unrestricted' })
    expect(readFileSync(join(root, 'result.txt'), 'utf8')).toBe('go-bash-ok\n')

    const escape = await executeGoBash({ command: 'printf x > ../escape.txt', ticketDir: root, ticketKey: 't1', shell })
    expect(escape.ok).toBe(false)
    expect(escape.code).toBe(GO_BASH_CODES.denied)
    expect(escape.denied).toBe(true)
    expect(existsSync(join(root, '..', 'escape.txt'))).toBe(false)
    expect(escape.message).toMatch(/denied a write outside/i)
  })

  it('returns coded failures without spawning for invalid input or workdirs', async () => {
    const shell = new IsolatedShell()
    const invalid = await executeGoBash({ command: 'a\0b', ticketDir: ticket(), ticketKey: 't1', shell })
    expect(invalid).toMatchObject({ ok: false, code: GO_BASH_CODES.invalid })
    const badWorkdir = await executeGoBash({ command: 'true', ticketDir: 'relative', ticketKey: 't1', shell })
    expect(badWorkdir).toMatchObject({ ok: false, code: GO_BASH_CODES.workdir })
  })
})
