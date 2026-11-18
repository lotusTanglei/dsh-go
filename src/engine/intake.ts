import type { Store } from '../store/index.js'
import type { Policy } from '../domain/policy.js'
import type { Trigger, TriggerDisposition } from '../domain/trigger.js'
import { validateTrigger } from '../domain/trigger.js'
import type { AssignmentId, TicketId, TriggerId } from '../domain/ids.js'
import { isPaused as globalPaused } from './pause.js'

export type IntakeStatus = 'accepted' | 'duplicate' | 'filtered' | 'subscription' | 'delivered' | 'rejected'
export interface IntakeResult {
  readonly status: IntakeStatus
  readonly triggerId: TriggerId
  readonly threadKey: string
  readonly seq?: number
  readonly reason?: string
  readonly ticketId?: TicketId
  readonly assignmentId?: AssignmentId
  readonly position?: number
}
export interface IntakeOptions {
  readonly policy?: Pick<Policy, 'acceptedSources' | 'bots' | 'paused' | 'budgets'>
  readonly queueLimit?: number
  readonly paused?: boolean
  readonly now?: () => number
}
function finiteNow(now?: () => number): number {
  const value = now ? now() : Date.now()
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new Error('intake: now must be a non-negative integer')
  return value
}
function findDuplicate(store: Store, trigger: Trigger): boolean {
  return Boolean(store.db.prepare('SELECT 1 FROM trigger WHERE source = ? AND external_id = ?').get(String(trigger.source), trigger.externalId))
}
function activeSubscription(store: Store, threadKey: string): { ticketId: TicketId; assignmentId?: AssignmentId } | undefined {
  const row = store.db.prepare(`SELECT s.ticket_id AS ticketId, t.current_assignment AS assignmentId FROM thread_subscription s JOIN ticket t ON t.id = s.ticket_id WHERE s.thread_key = ? AND t.state IN ('open','running','waiting_human') ORDER BY t.created_at ASC LIMIT 1`).get(threadKey) as { ticketId?: string; assignmentId?: string | null } | undefined
  if (!row?.ticketId) return undefined
  return { ticketId: row.ticketId as TicketId, ...(row.assignmentId ? { assignmentId: row.assignmentId as AssignmentId } : {}) }
}
function queueLength(store: Store): number {
  const row = store.db.prepare("SELECT COUNT(*) AS n FROM thread_trigger WHERE state = 'pending'").get() as { n?: number } | undefined
  return Number(row?.n ?? 0)
}
function disposition(store: Store, trigger: Trigger, at: number, patch: Record<string, unknown> = {}): void {
  store.repos.trigger_disposition.insert({ trigger_id: trigger.id, at, ...patch })
}
export function ingestTrigger(store: Store, trigger: Trigger, options: IntakeOptions = {}): IntakeResult {
  if (!validateTrigger(trigger)) throw new Error('intake: invalid trigger')
  const at = finiteNow(options.now)
  const policy = options.policy
  const sourceAllowed = !policy?.acceptedSources?.length || policy.acceptedSources.includes(trigger.source)
  const filteredReason = !sourceAllowed ? 'untrusted-source' : policy?.bots === 'deny' && trigger.actor.bot ? 'untrusted' : trigger.addressed === 'none' ? 'not-addressed' : undefined
  if (filteredReason) {
    if (findDuplicate(store, trigger)) return { status: 'duplicate', triggerId: trigger.id, threadKey: String(trigger.threadKey) }
    store.transaction(() => {
      store.repos.trigger.insert({ id: trigger.id, source: trigger.source, external_id: trigger.externalId, thread_key: trigger.threadKey, actor_id: trigger.actor.id, actor_bot: trigger.actor.bot, text: trigger.text, trust: trigger.trust, addressed: trigger.addressed, at: trigger.at, raw: trigger.raw })
      disposition(store, trigger, at, { filtered: filteredReason })
    })
    return { status: 'filtered', triggerId: trigger.id, threadKey: String(trigger.threadKey), reason: filteredReason }
  }
  if (findDuplicate(store, trigger)) return { status: 'duplicate', triggerId: trigger.id, threadKey: String(trigger.threadKey) }
  const queueLimit = options.queueLimit ?? policy?.budgets.queueLimit ?? Number.POSITIVE_INFINITY
  if (Number.isNaN(queueLimit) || queueLimit < 0) throw new Error('intake: queueLimit must be non-negative')
  return store.transaction(() => {
    try {
      store.repos.trigger.insert({ id: trigger.id, source: trigger.source, external_id: trigger.externalId, thread_key: trigger.threadKey, actor_id: trigger.actor.id, actor_bot: trigger.actor.bot, text: trigger.text, trust: trigger.trust, addressed: trigger.addressed, at: trigger.at, raw: trigger.raw })
    } catch (error) {
      if (findDuplicate(store, trigger)) return { status: 'duplicate' as const, triggerId: trigger.id, threadKey: String(trigger.threadKey) }
      throw error
    }
    const existing = store.repos.thread.get(trigger.threadKey) as Record<string, unknown> | undefined
    const seq = Number(existing?.seq ?? 0) + 1
    const paused = Boolean(existing?.paused) || Boolean(policy?.paused) || Boolean(options.paused) || globalPaused(store)
    const thread = { key: trigger.threadKey, source: trigger.source, ref_json: existing?.ref_json ?? { source: trigger.source, kind: 'session', id: String(trigger.threadKey), address: {} }, created_at: Number(existing?.created_at ?? trigger.at), last_at: Math.max(Number(existing?.last_at ?? 0), trigger.at), seq, paused, evaluating: existing?.evaluating ?? null }
    if (existing) store.db.prepare('UPDATE thread SET last_at = ?, seq = ?, paused = ? WHERE key = ?').run(thread.last_at, seq, paused ? 1 : 0, trigger.threadKey)
    else store.repos.thread.insert(thread)
    const subscription = activeSubscription(store, String(trigger.threadKey))
    if (!paused && subscription?.assignmentId) {
      store.repos.thread_trigger.insert({ thread_key: trigger.threadKey, trigger_id: trigger.id, seq, state: 'pending' })
      disposition(store, trigger, at, { ticket_id: subscription.ticketId })
      return { status: 'subscription' as const, triggerId: trigger.id, threadKey: String(trigger.threadKey), seq, ticketId: subscription.ticketId, assignmentId: subscription.assignmentId }
    }
    if (!paused && !subscription && queueLength(store) >= queueLimit) {
      disposition(store, trigger, at, { filtered: 'queue-full' })
      return { status: 'rejected' as const, triggerId: trigger.id, threadKey: String(trigger.threadKey), seq, reason: 'queue-full', position: queueLength(store) }
    }
    store.repos.thread_trigger.insert({ thread_key: trigger.threadKey, trigger_id: trigger.id, seq, state: 'pending' })
    disposition(store, trigger, at, { ...(paused ? { filtered: 'paused' } : {}) })
    return { status: 'accepted' as const, triggerId: trigger.id, threadKey: String(trigger.threadKey), seq }
  })
}
export const intakeTrigger = ingestTrigger
export const ingest = ingestTrigger
export function readDisposition(store: Store, triggerId: TriggerId): TriggerDisposition | undefined {
  const row = store.repos.trigger_disposition.get(triggerId) as Record<string, unknown> | undefined
  if (!row) return undefined
  return { triggerId, at: Number(row.at), ...(row.filtered ? { filtered: String(row.filtered) } : {}), ...(row.eval_id ? { evalId: row.eval_id as never } : {}), ...(row.decision_id ? { decisionId: row.decision_id as never } : {}), ...(row.ticket_id ? { ticketId: row.ticket_id as never } : {}), ...(row.delivered_to ? { deliveredTo: row.delivered_to as never } : {}), ...(row.requeued ? { requeued: Boolean(row.requeued) } : {}), ...(row.acked_by ? { ackedBy: String(row.acked_by) } : {}) }
}
export function ackDelivery(store: Store, triggerId: TriggerId, assignmentId: AssignmentId, at = Date.now()): boolean {
  if (!Number.isInteger(at) || at < 0) throw new Error('intake: ack time must be a non-negative integer')
  return store.transaction(() => {
    const row = store.repos.trigger_disposition.get(triggerId) as Record<string, unknown> | undefined
    if (!row || row.delivered_to || !row.ticket_id) return false
    const assignment = store.db.prepare("SELECT a.id FROM assignment a JOIN ticket t ON t.id = a.ticket_id WHERE a.id = ? AND a.ticket_id = ? AND a.state = 'running' AND t.current_assignment = a.id").get(String(assignmentId), String(row.ticket_id))
    if (!assignment) return false
    const result = store.db.prepare("UPDATE trigger_disposition SET delivered_to = ?, acked_by = ? WHERE trigger_id = ? AND delivered_to IS NULL").run(String(assignmentId), String(assignmentId), String(triggerId)) as { changes?: number }
    if (Number(result?.changes ?? 0) !== 1) return false
    store.db.prepare("UPDATE thread_trigger SET state = 'consumed' WHERE trigger_id = ? AND state = 'pending'").run(String(triggerId))
    return true
  })
}
