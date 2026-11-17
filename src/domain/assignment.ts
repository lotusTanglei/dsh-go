import type { AssignmentId, TicketId } from './ids.js'
import type { Ticket } from './ticket.js'

export type AssignmentState = 'pending' | 'running' | 'ended'

export interface Assignment {
  readonly id: AssignmentId
  readonly ticketId: TicketId
  readonly sessionId: string
  readonly state: AssignmentState
  readonly createdAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly endedReason?: string
  readonly lastProgressAt: number
  readonly steps: number
  readonly tokens: number
  readonly retries: number
  readonly repeatedCalls: number
}

export type AssignmentEvent =
  | { readonly type: 'start'; readonly at: number }
  | { readonly type: 'progress'; readonly at: number; readonly steps?: number; readonly tokens?: number; readonly repeatedCalls?: number }
  | { readonly type: 'end'; readonly at: number; readonly reason?: string }

export function createAssignment(input: Omit<Assignment, 'state' | 'lastProgressAt' | 'steps' | 'tokens' | 'retries' | 'repeatedCalls'> & Partial<Pick<Assignment, 'lastProgressAt' | 'steps' | 'tokens' | 'retries' | 'repeatedCalls'>>): Assignment {
  return Object.freeze({ ...input, state: 'pending' as const, lastProgressAt: input.lastProgressAt ?? input.createdAt, steps: input.steps ?? 0, tokens: input.tokens ?? 0, retries: input.retries ?? 0, repeatedCalls: input.repeatedCalls ?? 0 })
}

export function transitionAssignment(assignment: Assignment, event: AssignmentEvent): Assignment {
  if (event.type === 'start') {
    if (assignment.state !== 'pending') throw new Error(`assignment: ${assignment.state} cannot start`)
    return Object.freeze({ ...assignment, state: 'running' as const, startedAt: event.at, lastProgressAt: event.at })
  }
  if (event.type === 'progress') {
    if (assignment.state !== 'running') throw new Error(`assignment: ${assignment.state} cannot report progress`)
    return Object.freeze({ ...assignment, lastProgressAt: event.at, steps: event.steps ?? assignment.steps, tokens: event.tokens ?? assignment.tokens, repeatedCalls: event.repeatedCalls ?? assignment.repeatedCalls })
  }
  if (assignment.state === 'ended') throw new Error('assignment: already ended')
  if (!event.reason || !event.reason.trim()) throw new Error('assignment: ending requires non-empty endedReason')
  return Object.freeze({ ...assignment, state: 'ended' as const, endedAt: event.at, endedReason: event.reason })
}

export function acceptsAssignmentReport(assignment: Assignment, assignmentId: AssignmentId, ticketState: 'open' | 'running' | 'waiting_human' | 'ended'): boolean {
  return assignment.id === assignmentId && assignment.state === 'running' && ticketState !== 'ended'
}

/** Tool gate used by P2 adapters: only the current live assignment may invoke a tool. */
export function canInvokeAssignmentTool(ticket: Pick<Ticket, 'state' | 'currentAssignment'>, assignment: Pick<Assignment, 'id' | 'state'>, boundAssignmentId: AssignmentId): boolean {
  return ticket.state !== 'ended' && ticket.currentAssignment === boundAssignmentId && assignment.id === boundAssignmentId && assignment.state === 'running'
}
