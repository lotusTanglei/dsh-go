import type { ApprovalId, TicketId } from './ids.js'
import { snapshot } from './immutable.js'

export type ApprovalKind = 'merge-pr' | 'send-external' | 'delete-branch' | 'close-pr' | 'payment' | 'permission'
export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired'

export interface Approval {
  readonly id: ApprovalId
  readonly ticketId?: TicketId
  readonly kind: ApprovalKind
  readonly summary: string
  readonly payload: unknown
  readonly requestedBy: string
  readonly createdAt: number
  readonly state: ApprovalState
  readonly decidedBy?: string
  readonly decidedAt?: number
  readonly reason?: string
}

export type ApprovalEvent =
  | { readonly type: 'approve'; readonly by: string; readonly at: number; readonly reason?: string }
  | { readonly type: 'deny'; readonly by: string; readonly at: number; readonly reason?: string }
  | { readonly type: 'expire'; readonly at: number }

export function createApproval(input: Omit<Approval, 'state'>): Approval {
  if (!input.summary.trim() || !input.requestedBy.trim()) throw new Error('approval: summary and requestedBy are required')
  return snapshot({ ...input, state: 'pending' as const })
}

export function transitionApproval(approval: Approval, event: ApprovalEvent): Approval {
  if (approval.state !== 'pending') throw new Error(`approval: ${approval.state} is terminal`)
  if (event.type === 'expire') return Object.freeze({ ...approval, state: 'expired' as const, decidedAt: event.at })
  return Object.freeze({ ...approval, state: event.type === 'approve' ? 'approved' as const : 'denied' as const, decidedBy: event.by, decidedAt: event.at, ...(event.reason ? { reason: event.reason } : {}) })
}
