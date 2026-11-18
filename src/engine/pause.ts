import type { Store } from '../store/index.js'
import { encodeJson } from '../store/codec.js'
import type { ThreadKey } from '../domain/ids.js'

export interface PauseOptions {
  readonly now?: () => number
  readonly actor?: string
}

export interface PauseResult {
  readonly paused: boolean
  readonly threads: number
  readonly pending: number
}

function atOf(now?: () => number): number {
  const value = now ? now() : Date.now()
  if (!Number.isInteger(value) || value < 0) throw new Error('pause: now must be a non-negative integer')
  return value
}

/** Set the global pause flag and mirror it onto existing Threads. Triggers remain durable. */
export function setPaused(store: Store, paused: boolean, options: PauseOptions = {}): PauseResult {
  const at = atOf(options.now)
  const actor = options.actor ?? 'system'
  return store.transaction(() => {
    store.repos.kv.insertOrIgnore({ k: 'paused', v: encodeJson(paused, false) })
    store.db.prepare('UPDATE kv SET v = ? WHERE k = ?').run(encodeJson(paused, false), 'paused')
    const result = store.db.prepare('UPDATE thread SET paused = ?').run(paused ? 1 : 0) as { changes?: number }
    store.repos.audit.insert({ at, actor, action: paused ? 'pause' : 'resume', ticket_id: null, thread_key: null, detail: { paused } })
    const pending = store.db.prepare("SELECT COUNT(*) AS n FROM thread_trigger WHERE state = 'pending'").get() as { n?: number } | undefined
    return { paused, threads: Number(result?.changes ?? 0), pending: Number(pending?.n ?? 0) }
  })
}

export function isPaused(store: Store): boolean {
  const row = store.repos.kv.get('paused') as Record<string, unknown> | undefined
  if (!row) return false
  const value = row.v
  return value === true || value === 'true' || value === 1 || (typeof value === 'object' && value !== null && (value as { value?: unknown }).value === true)
}

/** Pause a single Thread, preserving pending Trigger order. */
export function setThreadPaused(store: Store, threadKey: ThreadKey, paused: boolean, options: PauseOptions = {}): boolean {
  const at = atOf(options.now)
  const result = store.db.prepare('UPDATE thread SET paused = ? WHERE key = ?').run(paused ? 1 : 0, String(threadKey)) as { changes?: number }
  if (Number(result?.changes ?? 0) > 0) store.repos.audit.insert({ at, actor: options.actor ?? 'system', action: paused ? 'thread_pause' : 'thread_resume', ticket_id: null, thread_key: threadKey, detail: { paused } })
  return Number(result?.changes ?? 0) === 1
}

/** Return pending Trigger ids in their durable sequence order. */
export function pendingTriggers(store: Store, threadKey?: ThreadKey): TriggerKey[] {
  const rows = threadKey
    ? store.db.prepare("SELECT thread_key, trigger_id, seq FROM thread_trigger WHERE state = 'pending' AND thread_key = ? ORDER BY seq ASC").all(String(threadKey))
    : store.db.prepare("SELECT thread_key, trigger_id, seq FROM thread_trigger WHERE state = 'pending' ORDER BY thread_key ASC, seq ASC").all()
  return (rows as { thread_key: string; trigger_id: string; seq: number }[]).map((row) => ({ threadKey: row.thread_key as ThreadKey, triggerId: row.trigger_id as never, seq: Number(row.seq) }))
}

export interface TriggerKey { readonly threadKey: ThreadKey; readonly triggerId: import('../domain/ids.js').TriggerId; readonly seq: number }
export const pause = setPaused
export const resume = (store: Store, options: PauseOptions = {}) => setPaused(store, false, options)
