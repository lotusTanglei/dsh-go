import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  SANDBOX_EXEC, SEATBELT_PROFILE_TEMPLATE, buildIsolatedEnv, buildSeatbeltProfile, canonicalTicketDir,
  isolatedEnvDirectories, profileDigest, profileTemplateDigest,
} from '../../src/isolation/seatbelt.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function ticket(): string {
  const dir = mkdtempSync(join(tmpdir(), 'go-seatbelt-'))
  dirs.push(dir)
  return dir
}

describe('L2 Seatbelt profile', () => {
  it('grants writes only to the exact Ticket directory and names no temp root', () => {
    const dir = ticket()
    const profile = buildSeatbeltProfile(dir)
    const canonical = canonicalTicketDir(dir)
    expect(profile).toContain('(deny file-write*)')
    expect(profile).toContain(`(subpath "${canonical}")`)
    expect(profile).toContain('(literal "/dev/null")')
    // The shared temporary roots are the cross-Ticket meeting point the L2 promise must not grant.
    expect(profile).not.toContain('/private/tmp')
    expect(profile).not.toContain('/var/tmp')
    expect(profile.startsWith('(version 1) (allow default)')).toBe(true)
  })

  it('binds a receipt to the template implementation, not to a Ticket path', () => {
    const first = ticket(), second = ticket()
    expect(profileTemplateDigest()).toMatch(/^[a-f0-9]{64}$/)
    expect(profileDigest(first)).not.toBe(profileDigest(second))
    expect(SEATBELT_PROFILE_TEMPLATE).toContain('{{WORKDIR}}')
    expect(profileTemplateDigest()).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects relative and nonexistent Ticket directories before building anything', () => {
    expect(() => buildSeatbeltProfile('relative/path')).toThrow(/absolute/i)
    expect(() => canonicalTicketDir('/definitely/not/a/go/ticket')).toThrow(/does not exist/i)
  })

  it('filters the child environment and redirects caches inside the Ticket', () => {
    const dir = ticket()
    const env = buildIsolatedEnv(dir, {
      PATH: '/usr/bin:/bin', HOME: '/Users/example', LANG: 'en_US.UTF-8',
      DEEPSEEK_API_KEY: 'sk-should-never-reach-worker', GITHUB_TOKEN: 'ghp-should-never-reach-worker',
      HTTPS_PROXY: 'http://proxy.invalid:8080', TMPDIR: '/tmp/host-temp',
    })
    const canonical = canonicalTicketDir(dir)
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.TMPDIR).toBe(join(canonical, '.go-runtime', 'tmp'))
    expect(env.GOCACHE).toBe(join(canonical, '.go-runtime', 'gocache'))
    expect(env.BASH_ENV).toBe('/dev/null')
    expect(env.PATH).toBe('/usr/bin:/bin')
    for (const directory of isolatedEnvDirectories(dir)) expect(resolve(directory).startsWith(canonical)).toBe(true)
  })

  it('keeps the runner path absolute so a PATH shadow cannot replace it', () => {
    expect(SANDBOX_EXEC).toBe('/usr/bin/sandbox-exec')
    mkdirSync(join(ticket(), 'ignored'), { recursive: true })
  })
})
