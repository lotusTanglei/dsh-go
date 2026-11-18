import { canInvokeAssignmentTool } from '../domain/assignment.js'
import type { Assignment } from '../domain/assignment.js'
import type { AssignmentId, TicketId } from '../domain/ids.js'
import type { Ticket } from '../domain/ticket.js'

export type ToolRole = 'router' | 'worker' | 'watchdog'
export type RoleToolAllowlist = Readonly<Record<ToolRole, readonly string[]>>

export interface WorkerBinding {
  readonly assignmentId: AssignmentId
  readonly ticketId: TicketId
}

/** All identity and state fields must come from trusted caller snapshots, never tool arguments. */
export interface ToolGuardInput {
  readonly composedPreset?: string
  readonly sessionId?: string
  readonly toolName: string
  readonly roleTools: RoleToolAllowlist
  readonly binding?: WorkerBinding
  readonly ticket?: Pick<Ticket, 'id' | 'state' | 'currentAssignment'>
  readonly assignment?: Pick<Assignment, 'id' | 'ticketId' | 'sessionId' | 'state'>
}

export type GuardDenialCode = 'SA_ROLE_TOOL_DENIED' | 'SA_ASSIGNMENT_UNBOUND' | 'SA_ASSIGNMENT_ENDED' | 'SA_ASSIGNMENT_STALE' | 'SA_ASSIGNMENT_WAITING'
export interface GuardDenial {
  readonly reason: string
  readonly info: { readonly name: 'SuperagentToolGuardError'; readonly code: GuardDenialCode }
}

/** Exact actual preset match only; parent roles and metadata are intentionally not accepted. */
export function roleForPreset(composedPreset: string | undefined): ToolRole | undefined {
  switch (composedPreset) {
    case 'dsh-superagent-router': return 'router'
    case 'dsh-superagent-worker': return 'worker'
    case 'dsh-superagent-watchdog': return 'watchdog'
    default: return undefined
  }
}

function deny(code: GuardDenialCode, reason: string): GuardDenial {
  return Object.freeze({ reason, info: Object.freeze({ name: 'SuperagentToolGuardError' as const, code }) })
}

/**
 * Pure, deny-only decision. Undefined adds no denial: it does NOT grant execution or
 * override any other approval/sandbox guard. Does not hide schemas or read state.
 * The caller must supply a fresh snapshot on every invocation.
 */
export function guardToolCall(input: ToolGuardInput): GuardDenial | undefined {
  const role = roleForPreset(input.composedPreset)
  if (!role) return undefined

  if (role === 'worker') {
    const { binding, ticket, assignment, sessionId } = input
    if (!binding?.assignmentId || !binding.ticketId || !ticket || !assignment || !sessionId) {
      return deny('SA_ASSIGNMENT_UNBOUND', 'Worker tools require a bound Ticket, Assignment and calling session.')
    }
    // Lifecycle refusal precedes the allowlist, so even native/global tools are denied.
    if (ticket.state === 'ended' || assignment.state === 'ended') {
      return deny('SA_ASSIGNMENT_ENDED', 'The Worker Ticket or Assignment has ended.')
    }
    if (ticket.state === 'waiting_human' && !['report_progress', 'report_result', 'structured_output', 'ask_router'].includes(input.toolName)) {
      return deny('SA_ASSIGNMENT_WAITING', 'Worker execution is suspended while human input or approval is pending.')
    }
    if (ticket.id !== binding.ticketId || assignment.ticketId !== ticket.id || assignment.sessionId !== sessionId ||
        !canInvokeAssignmentTool(ticket, assignment, binding.assignmentId)) {
      return deny('SA_ASSIGNMENT_STALE', 'The Worker binding is not the current running Assignment for this Ticket and session.')
    }
  }

  if (input.roleTools[role]?.includes(input.toolName) !== true) {
    return deny('SA_ROLE_TOOL_DENIED', 'The tool is not in the calling role\'s exact allowlist.')
  }
  return undefined
}
