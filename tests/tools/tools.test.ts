import { describe, expect, it } from 'vitest'
import { assignmentId, ticketId } from '../../src/domain/ids.js'
import { guardToolCall, roleForPreset } from '../../src/tools/guard.js'
import { routerToolNames, validateRouterToolParams } from '../../src/tools/router.js'
import { validateWorkerToolParams, workerToolNames } from '../../src/tools/worker.js'

const roleTools = {
  router: [...routerToolNames],
  worker: [...workerToolNames, 'read', 'glob', 'grep', 'write', 'edit', 'bash', 'job_list', 'job_output', 'job_kill'],
  watchdog: ['read', 'watchdog_nudge', 'watchdog_steer', 'watchdog_cancel', 'watchdog_escalate'],
} as const
const ticket = { id: ticketId('t1'), state: 'running' as const, currentAssignment: assignmentId('a1') }
const assignment = { id: assignmentId('a1'), ticketId: ticketId('t1'), sessionId: 's1', state: 'running' as const }

describe('P2 role guard', () => {
  it('leaves ordinary sessions unchanged and denies exact role violations', () => {
    expect(roleForPreset(undefined)).toBeUndefined()
    expect(guardToolCall({ composedPreset: undefined, toolName: 'bash', roleTools })).toBeUndefined()
    expect(guardToolCall({ composedPreset: 'dsh-superagent-router', toolName: 'bash', roleTools })?.info.code).toBe('SA_ROLE_TOOL_DENIED')
    expect(guardToolCall({ composedPreset: 'dsh-superagent-worker', toolName: 'channel_reply', roleTools, sessionId: 's1', ticket, assignment, binding: { assignmentId: assignment.id, ticketId: ticket.id } })?.info.code).toBe('SA_ROLE_TOOL_DENIED')
  })
  it('denies Worker unbound, stale and ended states, allows current live binding', () => {
    expect(guardToolCall({ composedPreset: 'dsh-superagent-worker', toolName: 'report_progress', roleTools })?.info.code).toBe('SA_ASSIGNMENT_UNBOUND')
    expect(guardToolCall({ composedPreset: 'dsh-superagent-worker', toolName: 'report_progress', roleTools, sessionId: 's1', ticket, assignment, binding: { assignmentId: assignmentId('old'), ticketId: ticket.id } })?.info.code).toBe('SA_ASSIGNMENT_STALE')
    expect(guardToolCall({ composedPreset: 'dsh-superagent-worker', toolName: 'report_progress', roleTools, sessionId: 's1', ticket: { ...ticket, state: 'ended' }, assignment, binding: { assignmentId: assignment.id, ticketId: ticket.id } })?.info.code).toBe('SA_ASSIGNMENT_ENDED')
    expect(guardToolCall({ composedPreset: 'dsh-superagent-worker', toolName: 'report_progress', roleTools, sessionId: 's1', ticket, assignment, binding: { assignmentId: assignment.id, ticketId: ticket.id } })).toBeUndefined()
  })
})

describe('P2 tool descriptors', () => {
  it('exposes exactly nine Router tools and rejects malformed briefs', () => {
    expect(routerToolNames).toHaveLength(9)
    expect(validateRouterToolParams('ticket_status', { ticketId: 't1' }).ok).toBe(true)
    expect(validateRouterToolParams('ticket_status', { ticketId: '', extra: true }).ok).toBe(false)
    expect(validateRouterToolParams('ticket_create', { brief: {} }).ok).toBe(false)
  })
  it('exposes four Worker tools and rejects unknown parameters', () => {
    expect(workerToolNames).toEqual(['report_progress', 'report_result', 'request_approval', 'ask_router'])
    expect(validateWorkerToolParams('ask_router', { question: 'help' }).ok).toBe(true)
    expect(validateWorkerToolParams('ask_router', { question: 'help', channel_reply: true }).ok).toBe(false)
  })
})
