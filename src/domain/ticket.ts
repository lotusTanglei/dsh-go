import type { AssignmentId, DecisionId, ThreadKey, TicketId } from './ids.js'
import type { Mandate } from './mandate.js'
import type { Trust } from './trigger.js'
import { snapshot } from './immutable.js'

export type TicketState = 'open' | 'running' | 'waiting_human' | 'ended'
export type EndedBy = 'executor' | 'human' | 'watchdog'
export type Outcome = 'completed' | 'stopped' | 'failed' | 'dropped'

export interface AcceptanceCriterion {
  readonly id: string
  readonly check: string
  readonly kind: 'command' | 'assertion'
}

export interface TicketBrief {
  readonly goal: string
  readonly scope: { readonly repo: string; readonly subdirs: readonly string[] }
  readonly base: { readonly ref: string; readonly requireCleanTree: boolean }
  readonly allowWrite: readonly string[]
  readonly denyWrite: readonly string[]
  readonly runtime: string
  readonly acceptance: readonly AcceptanceCriterion[]
  readonly outOfScope: readonly string[]
  readonly blockers: readonly string[]
  readonly firstAction: string
  readonly approvalsRequired: readonly string[]
}

export interface Ticket {
  readonly id: TicketId
  readonly threadKey: ThreadKey
  readonly decisionId: DecisionId
  readonly mandate: Mandate
  readonly brief: TicketBrief
  readonly title: string
  readonly state: TicketState
  readonly workdir: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly assignments: readonly AssignmentId[]
  readonly currentAssignment?: AssignmentId
  readonly attention?: { readonly id: string; readonly question: string; readonly at: number }
  readonly stoppedByHuman: boolean
  readonly ended?: { readonly at: number; readonly by: EndedBy; readonly outcome: Outcome; readonly reason?: string }
}

export interface TicketInput extends Omit<Ticket, 'state' | 'updatedAt' | 'assignments' | 'stoppedByHuman'> {
  readonly state?: TicketState
  readonly updatedAt?: number
  readonly assignments?: readonly AssignmentId[]
  readonly stoppedByHuman?: boolean
}

export type TicketEvent =
  | { readonly type: 'assignment_start'; readonly assignmentId: AssignmentId; readonly at: number; readonly hasCapacity: boolean }
  | { readonly type: 'waiting'; readonly at: number; readonly attention?: { readonly id: string; readonly question: string } }
  | { readonly type: 'request_approval'; readonly at: number; readonly attention?: { readonly id: string; readonly question: string } }
  | { readonly type: 'ask_router'; readonly at: number; readonly attention?: { readonly id: string; readonly question: string } }
  | { readonly type: 'human_answer'; readonly at: number; readonly trust: Trust; readonly answer?: string }
  | { readonly type: 'approval_decision'; readonly at: number; readonly trust: Trust; readonly approved?: boolean }
  | { readonly type: 'end'; readonly at: number; readonly by: EndedBy; readonly outcome: Outcome; readonly reason?: string }
  | { readonly type: 'stop'; readonly at: number; readonly by: 'human' | 'watchdog' | 'executor'; readonly reason?: string }
  | { readonly type: 'resume'; readonly at: number; readonly trust: Trust; readonly mandateValid: boolean; readonly hasPendingInput: boolean }
  | { readonly type: 'ticket_resume'; readonly at: number; readonly trust: Trust; readonly mandateValid: boolean; readonly hasPendingInput: boolean }

export function validateAcceptanceCriterion(criterion: AcceptanceCriterion): boolean {
  return Boolean(criterion && typeof criterion.id === 'string' && criterion.id.trim() && typeof criterion.check === 'string' && criterion.check.trim() && (criterion.kind === 'command' || criterion.kind === 'assertion'))
}

export function validateTicketBrief(brief: TicketBrief): boolean {
  if (!brief || typeof brief !== 'object') return false
  if (typeof brief.goal !== 'string' || !brief.goal.trim() || typeof brief.runtime !== 'string' || !brief.runtime.trim() || typeof brief.firstAction !== 'string' || !brief.firstAction.trim()) return false
  if (!brief.scope || typeof brief.scope.repo !== 'string' || !brief.scope.repo.trim() || !Array.isArray(brief.scope.subdirs) || !brief.scope.subdirs.every((v) => typeof v === 'string')) return false
  if (!brief.base || typeof brief.base.ref !== 'string' || !brief.base.ref.trim() || typeof brief.base.requireCleanTree !== 'boolean') return false
  const arrays = [brief.allowWrite, brief.denyWrite, brief.outOfScope, brief.blockers, brief.approvalsRequired]
  if (!arrays.every((v) => Array.isArray(v) && v.every((x) => typeof x === 'string'))) return false
  return Array.isArray(brief.acceptance) && brief.acceptance.every(validateAcceptanceCriterion)
}

export function createTicket(input: TicketInput): Ticket {
  if (!validateTicketBrief(input.brief)) throw new Error('ticket: invalid brief')
  const state = input.state ?? 'open'
  const updatedAt = input.updatedAt ?? input.createdAt
  if (state === 'ended' && !input.ended) throw new Error('ticket: ended snapshots require ended metadata')
  if (state !== 'ended' && input.ended) throw new Error('ticket: ended metadata requires ended state')
  if (state === 'running' && !input.currentAssignment) throw new Error('ticket: running snapshots require currentAssignment')
  return snapshot({ ...input, state, updatedAt, assignments: [...(input.assignments ?? [])], stoppedByHuman: input.stoppedByHuman ?? false, brief: input.brief })
}

function next(ticket: Ticket, event: TicketEvent, patch: Partial<Ticket>): Ticket {
  return Object.freeze({ ...ticket, ...patch, updatedAt: event.at })
}

function end(ticket: Ticket, event: Extract<TicketEvent, { type: 'end' | 'stop' }>): Ticket {
  const by = event.by
  const outcome = event.type === 'stop' ? 'stopped' : event.outcome
  const humanStop = event.type === 'stop' && by === 'human' || event.type === 'end' && by === 'human' && outcome === 'stopped'
  return next(ticket, event, { state: 'ended', ended: Object.freeze({ at: event.at, by, outcome, ...(event.reason ? { reason: event.reason } : {}) }), stoppedByHuman: humanStop ? true : ticket.stoppedByHuman, currentAssignment: undefined })
}

/** Pure state transition for the Ticket state machine in 001 §7. */
export function transition(ticket: Ticket, event: TicketEvent): Ticket {
  switch (event.type) {
    case 'assignment_start': {
      if (ticket.state !== 'open') throw new Error(`ticket: ${ticket.state} → running is invalid`)
      if (!event.hasCapacity) throw new Error('ticket: assignment_start requires available capacity')
      const id = event.assignmentId
      return next(ticket, event, { state: 'running', currentAssignment: id, assignments: Object.freeze(ticket.assignments.includes(id) ? [...ticket.assignments] : [...ticket.assignments, id]) })
    }
    case 'waiting':
    case 'request_approval':
    case 'ask_router': {
      if (ticket.state !== 'running') throw new Error(`ticket: ${ticket.state} cannot wait for human`)
      return next(ticket, event, { state: 'waiting_human', ...(event.attention ? { attention: Object.freeze({ ...event.attention, at: event.at }) } : {}) })
    }
    case 'human_answer':
    case 'approval_decision': {
      if (ticket.state !== 'waiting_human') throw new Error(`ticket: ${ticket.state} cannot receive human answer`)
      if (event.trust !== 'human') throw new Error('ticket: only human answers may resume work')
      return next(ticket, event, { state: 'running', attention: undefined })
    }
    case 'end':
    case 'stop': {
      if (ticket.state === 'ended') throw new Error('ticket: already ended')
      return end(ticket, event)
    }
    case 'resume':
    case 'ticket_resume': {
      if (ticket.state !== 'ended') throw new Error('ticket: only ended tickets may resume')
      if (ticket.stoppedByHuman) throw new Error('ticket: human-stopped tickets never resume')
      if (event.trust !== 'human') throw new Error('ticket: only human messages may resume')
      if (!event.mandateValid) throw new Error('ticket: mandate no longer valid')
      if (!event.hasPendingInput) throw new Error('ticket: resume requires pending input')
      return next(ticket, event, { state: 'open', ended: undefined, currentAssignment: undefined })
    }
  }
}

export function canResume(ticket: Ticket, input: { readonly trust: Trust; readonly mandateValid: boolean; readonly hasPendingInput: boolean }): boolean {
  return ticket.state === 'ended' && !ticket.stoppedByHuman && input.trust === 'human' && input.mandateValid && input.hasPendingInput
}
