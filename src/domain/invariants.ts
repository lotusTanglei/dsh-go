import type { Assignment } from './assignment.js'
import { canInvokeAssignmentTool } from './assignment.js'
import type { Decision, Eval } from './eval.js'
import type { Mandate } from './mandate.js'
import type { Outbound } from './outbound.js'
import type { Policy } from './policy.js'
import type { Thread } from './thread.js'
import type { Ticket } from './ticket.js'
import type { Trigger } from './trigger.js'
import type { AssignmentId, DecisionId, TicketId, TriggerId } from './ids.js'

/** I1: one trigger per (source, externalId) deduplication key. */
export function invariantI1UniqueTriggers(triggers: readonly Pick<Trigger, 'source' | 'externalId'>[]): boolean {
  const keys = triggers.map((t) => JSON.stringify([String(t.source), t.externalId]))
  return new Set(keys).size === keys.length
}

/** I2: accepted decisions sharing any trigger must map to one Ticket. */
export function invariantI2OneTicketPerTrigger(decisions: readonly Pick<Decision, 'id' | 'ticketId' | 'triggerIds'>[], tickets: readonly Pick<Ticket, 'id' | 'decisionId'>[]): boolean {
  const decisionToTicket = new Map<DecisionId, TicketId>()
  for (const ticket of tickets) {
    const prior = decisionToTicket.get(ticket.decisionId)
    if (prior && prior !== ticket.id) return false
    decisionToTicket.set(ticket.decisionId, ticket.id)
  }
  const triggerToTicket = new Map<TriggerId, TicketId>()
  for (const decision of decisions) {
    const ticket = decision.ticketId ?? decisionToTicket.get(decision.id)
    if (!ticket) continue
    const mapped = decisionToTicket.get(decision.id)
    if (mapped && mapped !== ticket) return false
    decisionToTicket.set(decision.id, ticket)
    for (const triggerId of decision.triggerIds) {
      const prior = triggerToTicket.get(triggerId)
      if (prior && prior !== ticket) return false
      triggerToTicket.set(triggerId, ticket)
    }
  }
  return true
}

/** I3: a thread may have at most one running evaluation, and evaluating points to that Eval. */
export function invariantI3SingleRunningEval(evals: readonly Pick<Eval, 'id' | 'threadKey' | 'state'>[], threads?: readonly Pick<Thread, 'key' | 'evaluating'>[]): boolean {
  const runningByThread = new Map<string, string>()
  for (const evaluation of evals) {
    if (evaluation.state !== 'running') continue
    const key = String(evaluation.threadKey)
    if (runningByThread.has(key)) return false
    runningByThread.set(key, String(evaluation.id))
  }
  return !threads || threads.every((thread) => {
    const expected = runningByThread.get(String(thread.key))
    return expected === undefined ? thread.evaluating === undefined : String(thread.evaluating) === expected
  })
}

/** I4: decisions may only use the current Policy version. */
export function invariantI4CurrentPolicy(evalOrDecision: Pick<Eval | Decision, 'policyVersion'>, policy: Pick<Policy, 'version'>): boolean {
  return evalOrDecision.policyVersion === policy.version
}

/** I5: only grant/withdraw/revalidate operations may change a mandate. */
export type MandateMutation = 'grant' | 'withdraw' | 'revalidate'
export function invariantI5MandatePolicy(operation: MandateMutation, input: { readonly accepted?: boolean; readonly humanStop?: boolean; readonly revalidated?: boolean; readonly valid?: boolean; readonly policyVersion?: string; readonly currentPolicyVersion?: string }): boolean {
  if (operation === 'grant') return input.accepted === true && input.policyVersion === input.currentPolicyVersion
  if (operation === 'withdraw') return input.humanStop === true
  return input.revalidated === true && input.valid === false
}

/** I6: ended Ticket resume is human-only and never human-stopped. */
export function invariantI6HumanOnlyResume(ticket: Pick<Ticket, 'state' | 'stoppedByHuman'>, trust: string): boolean {
  return ticket.state !== 'ended' || (!ticket.stoppedByHuman && trust === 'human')
}

/** I7: reports are accepted only for the current running assignment. */
export function invariantI7CurrentAssignment(ticket: Pick<Ticket, 'state' | 'currentAssignment'>, assignment: Pick<Assignment, 'id' | 'state'>, reportedAssignmentId: AssignmentId): boolean {
  return ticket.state !== 'ended' && ticket.currentAssignment === reportedAssignmentId && assignment.id === reportedAssignmentId && assignment.state === 'running'
}

/** I8: idempotency keys uniquely identify outbound sends. */
export function invariantI8OutboundIdempotent(outbounds: readonly Pick<Outbound, 'idempotencyKey'>[]): boolean {
  const keys = outbounds.map((outbound) => outbound.idempotencyKey)
  return new Set(keys).size === keys.length
}

/** I9: policy changes do not alter an existing mandate's recorded value. */
export function invariantI9MandatePersists(mandateBefore: Pick<Mandate, 'policyVersion'>, mandateAfter: Pick<Mandate, 'policyVersion'>): boolean {
  return mandateBefore.policyVersion === mandateAfter.policyVersion
}

/** I10: an ended Ticket cannot execute tools through its Assignment. */
export function invariantI10EndedAssignmentDenied(ticket: Pick<Ticket, 'state' | 'currentAssignment'>, assignment: Pick<Assignment, 'id' | 'state'>, boundAssignmentId?: AssignmentId): boolean {
  const binding = boundAssignmentId ?? ticket.currentAssignment ?? assignment.id
  return !canInvokeAssignmentTool(ticket, assignment, binding)
}

/** I11: a running Assignment whose session is absent from the live set is orphaned. */
export function isOrphan(assignment: Assignment, liveSessionIds: ReadonlySet<string>): boolean {
  return assignment.state === 'running' && !liveSessionIds.has(assignment.sessionId)
}

export const I1 = invariantI1UniqueTriggers
export const I2 = invariantI2OneTicketPerTrigger
export const I3 = invariantI3SingleRunningEval
export const I4 = invariantI4CurrentPolicy
export const I5 = invariantI5MandatePolicy
export const I6 = invariantI6HumanOnlyResume
export const I7 = invariantI7CurrentAssignment
export const I8 = invariantI8OutboundIdempotent
export const I9 = invariantI9MandatePersists
export const I10 = invariantI10EndedAssignmentDenied
export const I11 = isOrphan
