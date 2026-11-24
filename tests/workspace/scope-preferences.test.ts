import { afterEach, describe, expect, it } from 'vitest'
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { encodeJson, openStore, type Store } from '../../src/store/index.js'
import { createScopePreferences } from '../../src/workspace/scope-preferences.js'

const SESSION = 'session-work-excluded:v1'
const PROJECT = 'session-work-project-excluded:v1'
const VERSION = 'session-work-scope-version:v1'
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

// Only an isolated, real on-disk SQLite store is opened. No Host, profile or model is constructed.
function database() {
  const root = realpathSync(tmpdir())
  const dir = resolve(mkdtempSync(join(root, 'scope-preferences-test-')))
  const identity = lstatSync(dir)
  const dbPath = join(dir, 'state.sqlite')
  let store: Store = openStore({ dbPath })
  cleanups.push(() => {
    try { store.close() } finally {
      // Verify the exact absolute directory, its parent and its original identity before removal.
      const target = resolve(dir), current = lstatSync(target)
      if (!isAbsolute(target) || target !== dir || dirname(target) !== root || !basename(target).startsWith('scope-preferences-test-')
        || !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new Error('unsafe scope preference fixture cleanup')
      }
      rmSync(target, { recursive: true, force: true })
    }
  })
  const raw = (key: string) => store.db.prepare('SELECT v FROM kv WHERE k=?').get(key)?.v
  const seed = (key: string, value: unknown) => {
    store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, encodeJson(value, false))
  }
  return {
    get store() { return store }, raw, seed,
    reopen() { store.close(); store = openStore({ dbPath }); return createScopePreferences(store) },
    preferences() { return createScopePreferences(store) },
  }
}

const exclusionKeys = [
  { key: SESSION, kind: 'session', read: (prefs: ReturnType<typeof createScopePreferences>) => prefs.getExcluded() },
  { key: PROJECT, kind: 'project', read: (prefs: ReturnType<typeof createScopePreferences>) => prefs.getExcludedProjects() },
]

describe('persistent project/session scope preferences', () => {
  it('keeps the legacy session key in place, performs no read-time migration and leaves unrelated data/schema untouched', () => {
    const f = database()
    f.seed(SESSION, ['legacy-session'])
    f.seed('unrelated-preference', { keep: 'untouched' })
    const before = f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()
    const schema = f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()
    const prefs = f.preferences()
    expect(prefs.getExcluded()).toEqual(['legacy-session'])
    expect(prefs.getExcludedProjects()).toEqual([])
    expect(prefs.getScopeVersion()).toBe(0)
    expect(f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()).toEqual(before)
    expect(f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema)

    const legacyRaw = f.raw(SESSION)
    prefs.setExcludedProjects(['project-b', 'project-a'])
    expect(f.raw(SESSION)).toBe(legacyRaw)
    expect(prefs.getExcluded()).toEqual(['legacy-session'])
    expect(prefs.getExcludedProjects()).toEqual(['project-a', 'project-b'])
    expect(prefs.getScopeVersion()).toBe(1)
    prefs.setExcluded(['session-b', 'session-a'])
    expect(f.store.repos.kv.get(SESSION)?.v).toEqual(['session-a', 'session-b'])
    expect(f.store.repos.kv.get(PROJECT)?.v).toEqual(['project-a', 'project-b'])
    expect(f.store.repos.kv.get(VERSION)?.v).toBe(2)
    expect(f.store.repos.kv.all().map(row => row.k).sort()).toEqual([SESSION, PROJECT, VERSION, 'unrelated-preference'].sort())
    expect(f.store.repos.kv.get('unrelated-preference')?.v).toEqual({ keep: 'untouched' })
    expect(f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema)
  })

  it('increments the durable version for every write, including no-op writes and ABA, across SQLite reopen', () => {
    const f = database()
    let prefs = f.preferences()
    expect(prefs.getScopeVersion()).toBe(0)
    const writes = [
      () => prefs.setExcluded([]),
      () => prefs.setExcluded([]),
      () => prefs.setExcluded(['one']),
      () => prefs.setExcluded([]),
      () => prefs.setExcludedProjects(['p-a']),
      () => prefs.setExcludedProjects([]),
      () => prefs.setExcludedProjects([]),
    ]
    writes.forEach((write, index) => {
      write()
      expect(prefs.getScopeVersion()).toBe(index + 1)
      expect(f.store.repos.kv.get(VERSION)?.v).toBe(index + 1)
    })
    prefs = f.reopen()
    expect(prefs.getExcluded()).toEqual([])
    expect(prefs.getExcludedProjects()).toEqual([])
    expect(prefs.getScopeVersion()).toBe(7)
    prefs.setExcludedProjects(['p-after-reopen'])
    prefs.setExcluded(['after-reopen'])
    prefs = f.reopen()
    expect(prefs.getScopeVersion()).toBe(9)
    expect(prefs.getExcluded()).toEqual(['after-reopen'])
    expect(prefs.getExcludedProjects()).toEqual(['p-after-reopen'])
  })

  it('copies arrays at both boundaries so caller mutation cannot silently change durable exclusions or version', () => {
    const f = database(), prefs = f.preferences()
    const sessions = ['session-b', 'session-a'], projects = ['project-b', 'project-a']
    prefs.setExcluded(sessions); prefs.setExcludedProjects(projects)
    expect(sessions).toEqual(['session-b', 'session-a'])
    expect(projects).toEqual(['project-b', 'project-a'])
    sessions.push('unpersisted-session'); projects.length = 0
    const readSessions = prefs.getExcluded(), readProjects = prefs.getExcludedProjects()
    readSessions.length = 0; readProjects.push('unpersisted-project')
    expect(prefs.getExcluded()).toEqual(['session-a', 'session-b'])
    expect(prefs.getExcludedProjects()).toEqual(['project-a', 'project-b'])
    expect(prefs.getScopeVersion()).toBe(2)
  })

  for (const { key, kind, read } of exclusionKeys) {
    it.each([
      { name: 'null', value: null },
      { name: 'scalar', value: 'session-one' },
      { name: 'object', value: { id: 'one' } },
      { name: 'duplicate IDs', value: ['one', 'one'] },
      { name: 'mixed-type array', value: ['one', 42] },
      { name: 'empty ID', value: [''] },
      { name: 'URL ID', value: ['https://private.invalid/session'] },
      { name: 'overlong ID', value: ['x'.repeat(201)] },
    ])('fails closed on persisted ' + kind + ' exclusion $name instead of treating it as no exclusions', ({ value }) => {
      const f = database()
      f.seed(key, value)
      const persisted = f.raw(key)
      const prefs = f.preferences()
      expect(() => read(prefs)).toThrow('session_work_exclusions_invalid')
      expect(f.raw(key)).toBe(persisted)
      expect(f.store.repos.kv.get(VERSION)).toBeUndefined()
      const reopened = f.reopen()
      expect(() => read(reopened)).toThrow('session_work_exclusions_invalid')
      expect(f.raw(key)).toBe(persisted)
    })

    it('does not swallow malformed SQLite JSON for ' + kind + ' exclusions', () => {
      const f = database()
      f.store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run(key, '{not valid JSON')
      expect(() => read(f.preferences())).toThrow()
      expect(f.raw(key)).toBe('{not valid JSON')
      expect(() => read(f.reopen())).toThrow()
    })

    it.each([
      { name: 'duplicate', ids: ['one', 'one'] },
      { name: 'empty', ids: [''] },
      { name: 'URL', ids: ['https://private.invalid/x'] },
      { name: 'non-string', ids: ['one', 1] },
      { name: 'overlong', ids: ['x'.repeat(201)] },
    ])('rejects invalid ' + kind + ' writes ($name) atomically without advancing version', ({ ids }) => {
      const f = database(), prefs = f.preferences()
      prefs.setExcluded(['original-session']); prefs.setExcludedProjects(['original-project'])
      const before = f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()
      const write = key === SESSION ? prefs.setExcluded : prefs.setExcludedProjects
      expect(() => write(ids as string[])).toThrow('session_work_exclusions_invalid')
      expect(f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()).toEqual(before)
      expect(prefs.getScopeVersion()).toBe(2)
    })
  }

  it.each([
    { name: 'negative', value: -1 },
    { name: 'fractional', value: 0.5 },
    { name: 'numeric string', value: '2' },
    { name: 'unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
    { name: 'object', value: {} },
    { name: 'JSON null', value: null },
  ])('fails closed on a persisted $name scope version and never replaces exclusions or repairs the fence', ({ value }) => {
    const f = database()
    f.seed(SESSION, ['original-session']); f.seed(PROJECT, ['original-project']); f.seed(VERSION, value)
    const prefs = f.preferences()
    const before = f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()
    expect(() => prefs.getScopeVersion()).toThrow('session_work_scope_version_invalid')
    expect(() => prefs.setExcluded(['replacement'])).toThrow('session_work_scope_version_invalid')
    expect(() => prefs.setExcludedProjects(['replacement-project'])).toThrow('session_work_scope_version_invalid')
    expect(f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()).toEqual(before)
    expect(() => f.reopen().getScopeVersion()).toThrow('session_work_scope_version_invalid')
  })

  it('rejects raw SQLite NULL at the schema boundary without losing the existing durable fence', () => {
    const f = database(), prefs = f.preferences()
    prefs.setExcluded(['one'])
    const before = f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()
    expect(() => f.store.db.prepare('UPDATE kv SET v=NULL WHERE k=?').run(VERSION)).toThrow(/NOT NULL/)
    expect(f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()).toEqual(before)
    expect(prefs.getExcluded()).toEqual(['one'])
    expect(prefs.getScopeVersion()).toBe(1)
    expect(f.reopen().getScopeVersion()).toBe(1)
  })

  it('does not wrap or partly persist a write when the durable version reaches the maximum safe integer', () => {
    const f = database()
    f.seed(SESSION, ['original-session']); f.seed(PROJECT, ['original-project']); f.seed(VERSION, Number.MAX_SAFE_INTEGER)
    const prefs = f.preferences(), before = f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()
    expect(prefs.getScopeVersion()).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => prefs.setExcluded([])).toThrow('session_work_scope_version_invalid')
    expect(() => prefs.setExcludedProjects([])).toThrow('session_work_scope_version_invalid')
    expect(f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()).toEqual(before)
  })

  it('rolls back the exclusion row if SQLite rejects the version write in the same transaction', () => {
    const f = database(), prefs = f.preferences()
    prefs.setExcluded(['original-session']); prefs.setExcludedProjects(['original-project'])
    const before = f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()
    f.store.db.exec(`CREATE TRIGGER reject_scope_version BEFORE UPDATE OF v ON kv
      WHEN OLD.k = '${VERSION}' BEGIN SELECT RAISE(ABORT, 'synthetic version write failure'); END`)
    expect(() => prefs.setExcluded(['replacement'])).toThrow('synthetic version write failure')
    expect(() => prefs.setExcludedProjects(['replacement-project'])).toThrow('synthetic version write failure')
    expect(f.store.db.prepare('SELECT k,v FROM kv ORDER BY k').all()).toEqual(before)
    expect(prefs.getScopeVersion()).toBe(2)
  })
})
