import { randomUUID } from 'node:crypto'
import type { Store } from '../store/index.js'
import type { ChannelKind, OutboundKind, Outbound } from '../domain/outbound.js'
import { createOutbound, markOutboundSent, retryOutbound, dropOutbound } from '../domain/outbound.js'
import type { ThreadKey, TicketId } from '../domain/ids.js'

export interface OutboxMessage {
  readonly id?: string
  readonly ticketId?: TicketId
  readonly threadKey: ThreadKey
  readonly channel: ChannelKind
  readonly kind: OutboundKind
  readonly body: string
  readonly idempotencyKey: string
  readonly nextAt?: number
}

export interface OutboxSender {
  send(message: Pick<Outbound, 'channel' | 'threadKey' | 'body' | 'idempotencyKey'>): Promise<void>
}

export interface OutboxOptions {
  readonly now?: () => number
  readonly maxRetries?: number
  readonly backoffMs?: number
  readonly backoffMaxMs?: number
  readonly onDropped?: (outbound: Outbound, error?: string) => void
}

export interface OutboxRunResult {
  readonly attempted: number
  readonly sent: number
  readonly retried: number
  readonly dropped: number
  readonly pending: number
}

function nowOf(now?: () => number): number {
  const value = now ? now() : Date.now()
  if (!Number.isInteger(value) || value < 0) throw new Error('outbox: now must be a non-negative integer')
  return value
}

function mapOutbound(row: Record<string, unknown>): Outbound {
  return {
    id: String(row.id), ticketId: row.ticket_id ? row.ticket_id as TicketId : undefined, threadKey: row.thread_key as ThreadKey,
    channel: row.channel as ChannelKind, kind: row.kind as OutboundKind, body: String(row.body), idempotencyKey: String(row.idempotency_key),
    state: row.state as Outbound['state'], attempts: Number(row.attempts ?? 0), nextAt: Number(row.next_at),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  }
}

/** Enqueue an Outbox row. Duplicate idempotency keys are a successful no-op. */
export function enqueueOutbox(store: Store, message: OutboxMessage, options: Pick<OutboxOptions, 'now'> = {}): Outbound {
  const at = message.nextAt ?? nowOf(options.now)
  const id = message.id ?? `outbound:${randomUUID()}`
  const existing = store.db.prepare('SELECT * FROM outbound WHERE idempotency_key = ?').get(message.idempotencyKey) as Record<string, unknown> | undefined
  if (existing) return mapOutbound(existing)
  const outbound = createOutbound({ id, ticketId: message.ticketId, threadKey: message.threadKey, channel: message.channel, kind: message.kind, body: message.body, idempotencyKey: message.idempotencyKey, nextAt: at })
  store.repos.outbound.insert({ id: outbound.id, ticket_id: outbound.ticketId ?? null, thread_key: outbound.threadKey, channel: outbound.channel, kind: outbound.kind, body: outbound.body, idempotency_key: outbound.idempotencyKey, state: outbound.state, attempts: outbound.attempts, next_at: outbound.nextAt, last_error: null })
  return outbound
}

function unknownDelivery(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = String((error as { code?: unknown }).code ?? '')
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT' || code === 'UNKNOWN_DELIVERY') return true
    if ((error as { deliveryUnknown?: unknown }).deliveryUnknown === true) return true
  }
  return /timeout|timed out|unknown delivery/i.test(String(error instanceof Error ? error.message : error))
}

/** Send due pending rows. Sender success is the only path that records `sent`. */
async function drainOutboxUnlocked(store: Store, sender: OutboxSender, options: OutboxOptions = {}): Promise<OutboxRunResult> {
  const now = nowOf(options.now)
  const maxRetries = options.maxRetries ?? 5
  const base = options.backoffMs ?? 1_000
  const cap = options.backoffMaxMs ?? 60_000
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || !Number.isFinite(base) || base < 0 || !Number.isFinite(cap) || cap < base) throw new Error('outbox: invalid retry options')
  const rows = store.db.prepare("SELECT * FROM outbound WHERE state = 'pending' AND next_at <= ? ORDER BY next_at ASC, id ASC").all(now) as Record<string, unknown>[]
  let sent = 0, retried = 0, dropped = 0, pending = 0
  for (const row of rows) {
    const outbound = mapOutbound(row)
    try {
      await sender.send(outbound)
      const next = markOutboundSent(outbound)
      store.transaction(() => { store.repos.outbound.updateByState(outbound.id, 'pending', 'sent', { attempts: next.attempts, last_error: null }) })
      sent++
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      const unknown = unknownDelivery(error)
      const attempts = outbound.attempts + 1
      // An unknown result is deliberately kept pending, even after maxRetries: downstream
      // idempotency is the only safe way to determine whether the remote accepted it.
      if (!unknown && attempts >= maxRetries) {
        const droppedOutbound = dropOutbound(outbound, message)
        store.transaction(() => { store.repos.outbound.updateByState(outbound.id, 'pending', 'dropped', { attempts, last_error: droppedOutbound.lastError }) })
        options.onDropped?.(droppedOutbound, message)
        dropped++
      } else {
        const nextAt = now + Math.min(cap, base * (2 ** Math.max(0, attempts - 1)))
        const retriedOutbound = retryOutbound(outbound, nextAt, message)
        store.transaction(() => { store.repos.outbound.updateByState(outbound.id, 'pending', 'pending', { attempts: retriedOutbound.attempts, next_at: retriedOutbound.nextAt, last_error: retriedOutbound.lastError }) })
        retried++
      }
    }
  }
  const left = store.db.prepare("SELECT COUNT(*) AS n FROM outbound WHERE state = 'pending'").get() as { n?: number } | undefined
  pending = Number(left?.n ?? 0)
  return { attempted: rows.length, sent, retried, dropped, pending }
}

const drainLocks = new WeakMap<object, Promise<OutboxRunResult>>()
/** Serialize drains against one Store so concurrent host ticks cannot double-send a row. */
export function drainOutbox(store: Store, sender: OutboxSender, options: OutboxOptions = {}): Promise<OutboxRunResult> {
  const previous = drainLocks.get(store) ?? Promise.resolve({ attempted: 0, sent: 0, retried: 0, dropped: 0, pending: 0 })
  const current = previous.catch(() => undefined).then(() => drainOutboxUnlocked(store, sender, options))
  drainLocks.set(store, current)
  return current.finally(() => { if (drainLocks.get(store) === current) drainLocks.delete(store) })
}

/** Requeue pending messages after a restart without touching their attempt count. */
export function reconcileOutbox(store: Store, now = Date.now()): number {
  if (!Number.isInteger(now) || now < 0) throw new Error('outbox: now must be a non-negative integer')
  const result = store.db.prepare("UPDATE outbound SET next_at = ? WHERE state = 'pending' AND next_at > ?").run(now, now) as { changes?: number }
  return Number(result?.changes ?? 0)
}

export const processOutbox = drainOutbox
export const sendOutbox = drainOutbox
