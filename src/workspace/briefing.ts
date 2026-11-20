import { redact, type Row, type Store } from '../store/index.js'
import { boardColumn, boardTicket } from '../panel/board.js'

export interface WorkspaceBriefingDecisionDTO {
  id: string
  kind: 'approval' | 'question' | 'anomaly'
  ticketId?: string
  title: string
  summary: string
  at: number
}

export interface WorkspaceBriefingTicketDTO {
  id: string
  title: string
  state: string
  outcome?: string
  progress?: string
  nextAction?: string
  question?: string
  disabledReason?: string
  anomaly?: string
  at: number
}

export interface WorkspaceBriefingResultDTO extends WorkspaceBriefingTicketDTO {
  risks: string[]
}

export interface WorkspaceBriefingDTO {
  snapshotAt: number
  decisions: { total: number; items: WorkspaceBriefingDecisionDTO[] }
  active: { total: number; items: WorkspaceBriefingTicketDTO[] }
  results: { total: number; items: WorkspaceBriefingResultDTO[] }
  counts: { pending: number; running: number; waiting: number; ended: number }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function timestamp(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function group<T extends { id: string; at: number }>(items: T[]): { total: number; items: T[] } {
  return { total: items.length, items: items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 6) }
}

/** Read-only, unfiltered task projection. Report text is display data, never authority. */
export function readWorkspaceBriefing(store: Store): WorkspaceBriefingDTO {
  const tickets = store.repos.ticket.all(), assignments = store.repos.assignment.all(), approvals = store.repos.approval.all()
  const sideEffects = store.repos.side_effect.all()
  const byTicket = new Map(tickets.map(row => [row.id, row]))
  const byAssignment = new Map(assignments.map(row => [row.id, row]))
  const latestAssignment = new Map(assignments.map(row => [row.ticket_id, row]))
  const pending = approvals.filter(row => row.state === 'pending')
  const pendingTickets = new Set(pending.map(row => row.ticket_id))

  // Reuse boardTicket's persisted safety semantics without asking its unrelated
  // report/acceptance presentation to interpret malformed report entries.
  const safetyAssignments: Row[] = assignments.map(row => ({ ...row, report_json: null }))
  const safetyByAssignment = new Map(safetyAssignments.map(row => [row.id, row]))
  const safetyStore: Store = { ...store, repos: { ...store.repos,
    assignment: { ...store.repos.assignment, all: () => safetyAssignments, get: id => safetyByAssignment.get(id) },
    approval: { ...store.repos.approval, all: () => approvals },
    side_effect: { ...store.repos.side_effect, all: () => sideEffects },
  } }
  const decisions: WorkspaceBriefingDecisionDTO[] = pending.map(row => {
    const ticket = byTicket.get(row.ticket_id), summary = text(row.summary) ?? ''
    return { id: `approval:${String(row.id)}`, kind: 'approval', ...(ticket ? { ticketId: String(ticket.id) } : {}),
      title: text(ticket?.title) ?? summary, summary, at: timestamp(row.created_at) }
  })
  const active: WorkspaceBriefingTicketDTO[] = [], results: WorkspaceBriefingResultDTO[] = []
  const counts: WorkspaceBriefingDTO['counts'] = { pending: 0, running: 0, waiting: 0, ended: 0 }
  for (const row of tickets) {
    counts[boardColumn(row.state)]++
    const safety = boardTicket(safetyStore, row)
    const assignment = row.current_assignment ? byAssignment.get(row.current_assignment) : latestAssignment.get(row.id)
    const report = object(assignment?.report_json)
    const attention = object(row.attention_json)
    const question = text(attention?.question)
    const progress = strings(report?.done).at(-1)
    // Only the first todo entry is the proposed next action; do not promote a
    // later entry, report.state, or an unstarted plan into evidence of execution.
    const todo = Array.isArray(report?.todo) ? text(report.todo[0]) : undefined
    const nextAction = todo ?? (row.state === 'open' && safety.disabledReason ? text(object(row.brief_json)?.firstAction) : undefined)
    const at = timestamp(row.updated_at)
    const item: WorkspaceBriefingTicketDTO = { id: String(row.id), title: text(row.title) ?? '', state: String(row.state), at,
      ...(row.state === 'ended' ? { outcome: String(safety.outcome) } : {}),
      ...(progress !== undefined ? { progress } : {}), ...(nextAction !== undefined ? { nextAction } : {}),
      ...(question !== undefined ? { question } : {}),
      ...(safety.disabledReason ? { disabledReason: safety.disabledReason } : {}), ...(safety.anomaly ? { anomaly: safety.anomaly } : {}) }
    if (row.state === 'ended') results.push({ ...item, at: timestamp(row.ended_at, at), risks: strings(report?.risks) })
    else active.push(item)
    if (row.state === 'waiting_human' && (question || !pendingTickets.has(row.id))) {
      decisions.push({ id: `question:${item.id}`, kind: 'question', ticketId: item.id, title: item.title,
        summary: question ?? '', at: timestamp(attention?.at, at) })
    }
    if (safety.anomaly) decisions.push({ id: `anomaly:${item.id}`, kind: 'anomaly', ticketId: item.id, title: item.title, summary: safety.anomaly, at })
  }
  // Redact every outward field here, even for callers bypassing the route sink.
  return redact({ snapshotAt: Date.now(), decisions: group(decisions), active: group(active), results: group(results), counts }) as WorkspaceBriefingDTO
}
