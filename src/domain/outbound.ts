import type { ThreadKey, TicketId } from './ids.js'

export type ChannelKind = 'session' | 'github-comment' | 'github-review' | 'feishu-thread'
export type OutboundKind = 'acknowledgement' | 'reply' | 'notice'
export type OutboundState = 'pending' | 'sent' | 'dropped'

export interface Outbound {
  readonly id: string
  readonly ticketId?: TicketId
  readonly channel: ChannelKind
  readonly threadKey: ThreadKey
  readonly kind: OutboundKind
  readonly body: string
  readonly idempotencyKey: string
  readonly state: OutboundState
  readonly attempts: number
  readonly nextAt: number
  readonly lastError?: string
}

export function createOutbound(input: Omit<Outbound, 'state' | 'attempts'>): Outbound {
  if (!input.idempotencyKey.trim()) throw new Error('outbound: idempotencyKey is required')
  return Object.freeze({ ...input, state: 'pending' as const, attempts: 0 })
}

export function markOutboundSent(outbound: Outbound): Outbound {
  if (outbound.state !== 'pending') throw new Error(`outbound: cannot send ${outbound.state}`)
  return Object.freeze({ ...outbound, state: 'sent' as const, attempts: outbound.attempts + 1, lastError: undefined })
}

export function retryOutbound(outbound: Outbound, nextAt: number, error: string): Outbound {
  if (outbound.state !== 'pending') throw new Error(`outbound: cannot retry ${outbound.state}`)
  return Object.freeze({ ...outbound, attempts: outbound.attempts + 1, nextAt, lastError: error })
}

export function dropOutbound(outbound: Outbound, error?: string): Outbound {
  if (outbound.state === 'sent') throw new Error('outbound: sent records cannot be dropped')
  return Object.freeze({ ...outbound, state: 'dropped' as const, ...(error ? { lastError: error } : {}) })
}

export function isSameOutbound(a: Pick<Outbound, 'idempotencyKey'>, b: Pick<Outbound, 'idempotencyKey'>): boolean {
  return a.idempotencyKey === b.idempotencyKey
}
