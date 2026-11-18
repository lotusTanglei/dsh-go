import type { Store } from '../store/index.js'
import type { Eval } from '../domain/eval.js'
import { expireAndRequeue } from './eval.js'
import { reconcileOutbox } from './outbox.js'
import { pendingTriggers } from './pause.js'
import type { ThreadKey, EvalId } from '../domain/ids.js'

export interface RecoveryPorts {
  /** Return session ids which are alive in the host. */
  readonly liveSessionIds?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>
  /** Requeue a pending trigger to the host queue; persistence remains source of truth. */
  readonly enqueue?: (threadKey: ThreadKey, triggerId: import('../domain/ids.js').TriggerId, seq: number) => void | Promise<void>
  /** Notify an operator when an outbox row reaches dead-letter. */
  readonly warn?: (message: string) => void
}

export interface RecoveryOptions {
  readonly now?: () => number
  readonly evalTimeoutMs?: number
  readonly maxEvalRequeues?: number
}

export interface RecoveryReport {
  readonly assignments: { readonly scanned: number; readonly orphaned: number }
  readonly outbox: { readonly requeued: number }
  readonly evals: { readonly scanned: number; readonly expired: number; readonly requeued: number; readonly unavailable: number }
  readonly queue: { readonly scanned: number; readonly requeued: number }
}

function atOf(now?: () => number): number {
  const value = now ? now() : Date.now()
  if (!Number.isInteger(value) || value < 0) throw new Error('recovery: now must be a non-negative integer')
  return value
}

/** Startup reconciliation in the fixed order required by 003-F8/DEV-ALL §3.9. */
export async function reconcile(store: Store, ports: RecoveryPorts = {}, options: RecoveryOptions = {}): Promise<RecoveryReport> {
  const at = atOf(options.now)
  // 1. Assignment running -> ended/orphaned when its session no longer exists.
  const running = store.db.prepare("SELECT * FROM assignment WHERE state = 'running'").all() as Record<string, unknown>[]
  const live = ports.liveSessionIds ? await ports.liveSessionIds() : new Set<string>()
  let orphaned = 0
  for (const row of running) {
    if (live.has(String(row.session_id))) continue
    const id = String(row.id)
    const changed = store.transaction(() => {
      const done = store.repos.assignment.updateByState(id, 'running', 'ended', { ended_at: at, ended_reason: 'orphaned' })
      if (done && row.ticket_id) {
        store.db.prepare("UPDATE ticket SET current_assignment = NULL, state = CASE WHEN state = 'running' THEN 'open' ELSE state END, updated_at = ? WHERE id = ? AND current_assignment = ?").run(at, String(row.ticket_id), id)
      }
      if (done) store.repos.audit.insert({ at, actor: 'recovery', action: 'assignment_orphaned', ticket_id: row.ticket_id ?? null, thread_key: null, detail: { assignmentId: id, sessionId: String(row.session_id) } })
      return done
    })
    if (changed) orphaned++
  }
  // 2. Pending Outbox rows become due immediately; no send happens in recovery itself.
  const requeuedOutbox = reconcileOutbox(store, at)

  // 3. Running Eval deadline checks.
  const evalRows = store.db.prepare("SELECT * FROM eval WHERE state = 'running'").all() as Record<string, unknown>[]
  let expired = 0, requeued = 0, unavailable = 0
  for (const row of evalRows) {
    if (Number(row.deadline) > at) continue
    const before = Number(row.requeues ?? 0)
    const result = expireAndRequeue(store, row.id as EvalId, { evalTimeoutMs: options.evalTimeoutMs ?? Math.max(0, Number(row.deadline) - Number(row.started_at)), maxRequeues: options.maxEvalRequeues ?? 2 }, { now: () => at })
    if (!result) continue
    expired++
    if (result.state === 'running') requeued++
    else if (result.state === 'expired' && before >= (options.maxEvalRequeues ?? 2)) unavailable++
  }

  // 4. Requeue pending Thread triggers in sequence order.
  const pending = pendingTriggers(store)
  if (ports.enqueue) for (const item of pending) await ports.enqueue(item.threadKey, item.triggerId, item.seq)
  return {
    assignments: { scanned: running.length, orphaned },
    outbox: { requeued: requeuedOutbox },
    evals: { scanned: evalRows.length, expired, requeued, unavailable },
    queue: { scanned: pending.length, requeued: ports.enqueue ? pending.length : 0 },
  }
}

export const recover = reconcile
export const startupRecovery = reconcile
