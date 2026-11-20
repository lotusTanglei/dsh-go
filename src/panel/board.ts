import { createHash } from 'node:crypto'
import type { Store, Row } from '../store/index.js'
import { WorkspaceError } from '../workspace/commands.js'
export const BOARD_COLUMNS = ['pending', 'running', 'waiting', 'ended'] as const
export type BoardColumn = typeof BOARD_COLUMNS[number]
const knownStates = ['open', 'running', 'waiting_human', 'ended']
export function boardColumn(state: unknown): BoardColumn { return state === 'running' ? 'running' : state === 'waiting_human' ? 'waiting' : state === 'ended' ? 'ended' : 'pending' }
export function approvalFingerprint(row: Row): string {
  return createHash('sha256').update(JSON.stringify([row.id, row.ticket_id, row.kind, row.summary, row.payload_json, row.requested_by, row.created_at])).digest('hex')
}
export function boardTicket(store: Store, row: Row) {
  const assignment = row.current_assignment ? store.repos.assignment.get(row.current_assignment) : store.repos.assignment.all().filter(item => item.ticket_id === row.id).at(-1)
  const approvals = store.repos.approval.all().filter(item => item.ticket_id === row.id)
  const report = assignment?.report_json as any
  const pending = approvals.filter(item => item.state === 'pending').length
  const admission = store.repos.side_effect.all().find(item => item.kind === 'workspace-admission-v1' && item.ticket_id === row.id)
  const requestId = (admission?.detail as any)?.requestId
  const origin = requestId ? (store.repos.side_effect.get(`workspace-command:v1:${requestId}`)?.detail as any)?.originTicket : undefined
  const anomaly = !knownStates.includes(String(row.state)) ? 'unknown_state' : row.state === 'running' && (!assignment || assignment.state !== 'running' || pending || row.attention_json) ? 'state_conflict' : undefined
  return { id: row.id, title: row.title, state: row.state, column: boardColumn(row.state), outcome: row.state === 'ended' ? ['completed', 'failed', 'stopped', 'dropped'].includes(String(row.outcome)) ? row.outcome : 'unknown' : undefined,
    ...(typeof origin === 'string' ? { originTicket: origin } : {}), stoppedByHuman: Boolean(row.stopped_by_human), createdAt: row.created_at, updatedAt: row.updated_at, pendingApprovals: pending, attention: row.attention_json,
    progress: Array.isArray(report?.done) ? report.done.at(-1) : undefined, lastProgressAt: assignment?.last_progress_at,
    budget: { steps: assignment?.steps ?? null, usage: assignment?.tokens ?? null },
    acceptance: { passed: Array.isArray(report?.acceptance) ? report.acceptance.filter((item: any) => item.result === 'passed').length : null, total: Array.isArray((row.brief_json as any)?.acceptance) ? (row.brief_json as any).acceptance.length : null },
    ...(anomaly ? { anomaly } : {}), allowed: { input: !anomaly && ['open', 'running', 'waiting_human'].includes(String(row.state)), stop: !anomaly && row.state !== 'ended', resume: false },
    disabledReason: row.state === 'open' ? 'SA_EXECUTION_BOUNDARY_UNVERIFIED' : undefined }
}
export function readBoard(store: Store, input: { column?: BoardColumn; cursor?: string; limit?: number; query?: string; outcome?: string }) {
  const limit = input.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || input.column !== undefined && !BOARD_COLUMNS.includes(input.column) || input.cursor && !input.column || typeof input.query !== 'undefined' && (typeof input.query !== 'string' || input.query.length > 200)) throw new WorkspaceError('invalid_input', 400)
  const all = store.repos.ticket.all().sort((a, b) => Number(b.created_at) - Number(a.created_at) || String(a.id).localeCompare(String(b.id)))
  const filter = JSON.stringify([input.query ?? '', input.outcome ?? ''])
  // A stale page is explicitly rejected on any domain change; never silently skip/multiply cards.
  const revision = createHash('sha256').update(JSON.stringify({ tickets: all, approvals: store.repos.approval.all(), assignments: store.repos.assignment.all() }) + filter).digest('hex')
  let after: string | undefined
  if (input.cursor) {
    if (input.cursor.length > 1024) throw new WorkspaceError('invalid_cursor', 400)
    try {
      const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      if (parsed.v !== 1 || parsed.column !== input.column || parsed.filter !== filter || typeof parsed.after !== 'string') throw new Error()
      if (parsed.revision !== revision) throw new WorkspaceError('board_resync_required', 409)
      after = parsed.after
    } catch (error) { if (error instanceof WorkspaceError) throw error; throw new WorkspaceError('invalid_cursor', 400) }
  }
  const query = input.query?.toLocaleLowerCase()
  const rows = all.filter(row => (!query || String(row.title).toLocaleLowerCase().includes(query) || String(row.id).toLocaleLowerCase().includes(query)) && (!input.outcome || row.outcome === input.outcome))
  const columns = Object.fromEntries(BOARD_COLUMNS.map(column => {
    const entries = rows.filter(row => boardColumn(row.state) === column)
    const start = column === input.column && after ? entries.findIndex(row => row.id === after) + 1 : 0
    if (column === input.column && after && start === 0) throw new WorkspaceError('board_resync_required', 409)
    const page = entries.slice(start, start + limit)
    return [column, { total: entries.length, items: input.column && input.column !== column ? [] : page.map(row => boardTicket(store, row)), hasMore: start + page.length < entries.length,
      ...(start + page.length < entries.length && page.length ? { cursor: Buffer.from(JSON.stringify({ v: 1, column, filter, revision, after: page.at(-1)!.id })).toString('base64url') } : {}) }]
  }))
  // This is the plugin's durable ledger, not a projection of every DSH conversation.
  // No current-session filter is applied; unregistered sessions are not observed here.
  return { scope: { kind: 'superagent-ledger' as const, otherSessions: 'not-included' as const }, columns, snapshotAt: Date.now(), revision, filtered: Boolean(query || input.outcome), pendingApprovals: store.repos.approval.all().filter(row => row.state === 'pending').length }
}
