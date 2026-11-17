import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { defaults, type Config } from '../src/config.js'
import { vi } from 'vitest'

function input(stateDir: string): Config {
  return { ...defaults, stateDir, dbPath: '', lockPath: '', workRoot: '', sources: [], roleTools: { router: [...defaults.roleTools.router], worker: [...defaults.roleTools.worker], watchdog: [...defaults.roleTools.watchdog] } } as Config
}

describe('P1 load lifecycle', () => {
  it('opens and migrates actual SQLite, emits safe marker, closes exact store on unload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'superagent-plugin-'))
    let close: (() => void | Promise<void>) | undefined
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      apply({ effect: factory => { close = factory() } }, input(dir))
      expect(log.mock.calls).toEqual([['[superagent] loaded']])
      expect(existsSync(join(dir, 'superagent.sqlite'))).toBe(true)
      expect(existsSync(join(dir, 'superagent.sqlite.lock'))).toBe(true)
      expect(() => apply({ effect: () => {} }, input(dir))).toThrow(/store could not open/)
      close?.()
      expect(existsSync(join(dir, 'superagent.sqlite.lock'))).toBe(false)
      apply({ effect: factory => { close = factory() } }, input(dir))
      close?.()
    } finally {
      close?.()
      log.mockRestore()
      // Test-created exact directory, not user state.
      if (!dir.startsWith(join(tmpdir(), 'superagent-plugin-'))) throw new Error('unexpected test directory')
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('releases DB and lock when lifecycle registration fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'superagent-plugin-'))
    try {
      expect(() => apply({ effect: () => { throw new Error('test lifecycle failure') } }, input(dir))).toThrow('test lifecycle failure')
      expect(existsSync(join(dir, 'superagent.sqlite.lock'))).toBe(false)
    } finally {
      if (!dir.startsWith(join(tmpdir(), 'superagent-plugin-'))) throw new Error('unexpected test directory')
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
