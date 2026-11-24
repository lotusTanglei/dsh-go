import type { Store } from '../store/index.js'
import { encodeJson } from '../store/codec.js'

const SESSION = 'session-work-excluded:v1', PROJECT = 'session-work-project-excluded:v1', VERSION = 'session-work-scope-version:v1'
const valid = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(id) && !id.includes('://')

/** Host-owned preferences in existing kv, no DDL, activation, or user-data migration.
 * Keep the legacy session exclusion key intact. Every mutation advances an ABA fence.
 */
export function createScopePreferences(store: Store) {
  function read(key: string): string[] {
    const value = store.repos.kv.get(key)?.v
    if (value === undefined) return []
    if (!Array.isArray(value) || !value.every(valid) || new Set(value).size !== value.length) throw new Error('session_work_exclusions_invalid')
    return [...value]
  }
  function version(): number {
    const row = store.repos.kv.get(VERSION)
    const value = row === undefined ? 0 : row.v
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('session_work_scope_version_invalid')
    return Number(value)
  }
  function put(key: string, value: unknown) {
    store.repos.kv.insertOrIgnore({ k: key, v: value })
    store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(value, false), key)
  }
  function save(key: string, ids: readonly string[]) {
    if (!Array.isArray(ids) || !ids.every(valid) || new Set(ids).size !== ids.length) throw new Error('session_work_exclusions_invalid')
    store.transaction(() => {
      const next = version() + 1
      if (!Number.isSafeInteger(next)) throw new Error('session_work_scope_version_invalid')
      put(key, [...ids].sort()); put(VERSION, next)
    })
  }
  return { getExcluded: () => read(SESSION), setExcluded: (ids: readonly string[]) => save(SESSION, ids),
    getExcludedProjects: () => read(PROJECT), setExcludedProjects: (ids: readonly string[]) => save(PROJECT, ids), getScopeVersion: version }
}
