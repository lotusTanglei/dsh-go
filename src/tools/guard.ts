import { isAbsolute, relative, resolve, sep } from 'node:path'
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

/** Tools that mutate one path and therefore need the exact Ticket-directory fence. */
export const WORKER_WRITE_TOOLS: readonly string[] = Object.freeze(['write', 'edit', 'apply_patch'])

/** All identity and state fields must come from trusted caller snapshots, never tool arguments. */
export interface ToolGuardInput {
  readonly composedPreset?: string
  readonly sessionId?: string
  readonly toolName: string
  readonly roleTools: RoleToolAllowlist
  readonly binding?: WorkerBinding
  readonly ticket?: Pick<Ticket, 'id' | 'state' | 'currentAssignment'>
  readonly assignment?: Pick<Assignment, 'id' | 'ticketId' | 'sessionId' | 'state'>
  /** Live Worker Session header cwd, read from the exact calling Agent. */
  readonly sessionCwd?: string
  /** DB-bound Ticket working copy the L1 boundary claims. */
  readonly workdir?: string
  /** First path argument of a write-shaped tool, when the call carries one. */
  readonly writeTarget?: string
}

export type GuardDenialCode = 'SA_ROLE_TOOL_DENIED' | 'SA_ASSIGNMENT_UNBOUND' | 'SA_ASSIGNMENT_ENDED' | 'SA_ASSIGNMENT_STALE' | 'SA_ASSIGNMENT_WAITING' | 'SA_WORKER_WORKDIR_UNBOUND' | 'SA_WORKER_PATH_DENIED'
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

/** First path argument of a write/edit call, used only for the Ticket-directory fence. */
export function writeTargetOf(toolName: string, args: unknown): string | undefined {
  if (!WORKER_WRITE_TOOLS.includes(toolName) || !args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>).file_path
  return typeof value === 'string' && value ? value : undefined
}

/** Whether `candidate` (resolved from the session cwd) is the Ticket directory or inside it. */
function pathInside(root: string, candidate: string): boolean {
  const base = resolve(root)
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate)
  if (absolute === base) return true
  const rel = relative(base, absolute)
  return Boolean(rel) && !rel.startsWith('..') && !rel.includes(`..${sep}`) && !isAbsolute(rel)
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
    // L1 proof: the live Session header cwd must be exactly the DB-bound Ticket copy.
    // A recovered pre-boundary (spawn) Session therefore cannot reach Worker tools.
    if (input.sessionCwd !== undefined && input.workdir !== undefined) {
      if (resolve(input.sessionCwd) !== resolve(input.workdir)) {
        return deny('SA_WORKER_WORKDIR_UNBOUND', 'The Worker Session working directory is not the bound Ticket working copy.')
      }
    }
    if (WORKER_WRITE_TOOLS.includes(input.toolName)) {
      if (input.workdir === undefined || input.writeTarget === undefined) {
        return deny('SA_WORKER_PATH_DENIED', 'Worker write target is not bound to the Ticket working copy.')
      }
      const base = input.sessionCwd ?? input.workdir
      if (!pathInside(input.workdir, isAbsolute(input.writeTarget) ? input.writeTarget : resolve(base, input.writeTarget))) {
        return deny('SA_WORKER_PATH_DENIED', 'The Worker write target is outside the Ticket working copy.')
      }
    }
  }

  if (input.roleTools[role]?.includes(input.toolName) !== true) {
    return deny('SA_ROLE_TOOL_DENIED', 'The tool is not in the calling role\'s exact allowlist.')
  }
  return undefined
}
