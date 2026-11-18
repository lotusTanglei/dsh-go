import { statSync } from 'node:fs'
import type { Config } from '../config.js'
import { effectiveSettings, type EffectiveSetting } from './settings.js'
import { transitionApproval, type Approval } from '../domain/approval.js'
import { approvalId } from '../domain/ids.js'
import { transition as transitionTicket, type Ticket, type TicketBrief } from '../domain/ticket.js'
import type { Store, TableRepo, Row } from '../store/index.js'
import { redact } from '../store/index.js'

/** Structural subset of the installed Connection service. No DSH package dependency is needed. */
export interface PanelConnection {
  fetch: {
    register(route: {
      path: string
      methods: readonly ['POST']
      requestBody: 'buffered'
      fetch(request: Request): Promise<Response>
    }): (() => void | Promise<void>)
  }
}
export interface PanelContext {
  readonly connection: PanelConnection
  readonly effect?: (factory: () => (() => void | Promise<void>)) => unknown
}
export interface PanelConfig {
  readonly approvalTimeoutMs?: number
  readonly panelPollMs?: number
  readonly panelPageSize?: number
  readonly panelOrigins?: readonly string[]
  readonly paused?: boolean
  readonly maxWorkers?: number
  readonly routerReadScope?: string
  readonly confirm?: string
  readonly acceptMode?: string
  readonly bots?: string
}

/** Side effects that must be supplied by the owning runtime; routes never fake a successful action. */
export interface PanelPorts {
  readonly health?: () => unknown | Promise<unknown>
  readonly sources?: () => unknown | Promise<unknown>
  readonly settings?: () => readonly EffectiveSetting[] | Promise<readonly EffectiveSetting[]>
  readonly stopTicket?: (ticketId: string, reason: string) => boolean | void | Promise<boolean | void>
  readonly resumeTicket?: (ticketId: string) => boolean | void | Promise<boolean | void>
  /** Revalidation is deliberately a port: a route cannot manufacture a valid mandate. */
  readonly mandateValid?: (ticket: Row) => boolean | Promise<boolean>
  readonly approvalDecided?: (ticketId: string, approvalId: string, approved: boolean) => void | Promise<void>
  /** Optional aliases accepted by adapters that name actions explicitly. */
  readonly ticketAction?: (action: 'stop' | 'resume', ticketId: string, reason?: string) => boolean | void | Promise<boolean | void>
}

export interface PanelInstallation {
  readonly dispose: () => Promise<void>
}

type Envelope = { ok: true; data: unknown } | { ok: false; code: string; error: { code: string; message: string }; message: string }
const ROUTES = ['/overview', '/tickets', '/ticket', '/threads', '/approvals', '/approval', '/ticket-action', '/health', '/settings'] as const
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/
const SAFE_LIMIT = 100

function json(body: Envelope, status = body.ok ? 200 : 400): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
function fail(code: string, message: string, status: number): Response {
  // Messages are fixed and contain no SQL, paths, raw payloads or caught exception text.
  return json({ ok: false, code, error: { code, message }, message }, status)
}
function ok(data: unknown): Response { return json({ ok: true, data: sanitize(data) }) }
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[REDACTED]'
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1))
  if (isObject(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (/token|secret|password|credential|authorization|cookie|raw|payload|workdir|path|url/i.test(key)) continue
      result[key] = sanitize(item, depth + 1)
    }
    return result
  }
  return value
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function validId(value: unknown): value is string { return typeof value === 'string' && SAFE_ID.test(value) }
function only(input: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(input).every(key => keys.includes(key))
}
function limitOf(value: unknown, configured: number | undefined): number {
  if (value === undefined) return Math.min(SAFE_LIMIT, Math.max(1, Math.trunc(configured ?? 20)))
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= SAFE_LIMIT ? value : 0
}
async function body(request: Request, keys: readonly string[]): Promise<{ value?: Record<string, unknown>; error?: Response }> {
  let value: unknown
  try { value = await request.json() } catch { return { error: fail('invalid_json', 'Request body must be JSON', 400) } }
  if (!isObject(value) || !only(value, keys)) return { error: fail('invalid_input', 'Request fields are not permitted', 400) }
  return { value }
}
function originAllowed(request: Request, config: PanelConfig): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const configured = config.panelOrigins ?? []
  if (configured.length) return configured.includes(origin)
  try { return new URL(request.url).origin === origin } catch { return false }
}
function publicTicket(row: Row, actions: { readonly stop: boolean; readonly resume: boolean } = { stop: false, resume: false }): Record<string, unknown> {
  const state = typeof row.state === 'string' ? row.state : 'unknown'
  const allowed = { stop: state !== 'ended' && actions.stop, resume: state === 'ended' && row.stopped_by_human !== true && row.stopped_by_human !== 1 && actions.resume }
  return {
    id: typeof row.id === 'string' ? row.id : '',
    threadKey: typeof row.thread_key === 'string' ? row.thread_key : undefined,
    title: typeof row.title === 'string' ? row.title : '',
    state,
    createdAt: typeof row.created_at === 'number' ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === 'number' ? row.updated_at : undefined,
    currentAssignment: typeof row.current_assignment === 'string' ? row.current_assignment : undefined,
    stoppedByHuman: row.stopped_by_human === true || row.stopped_by_human === 1,
    allowed,
  }
}
function publicApproval(row: Row, actions: { readonly approve: boolean; readonly deny: boolean } = { approve: false, deny: false }): Record<string, unknown> {
  const fields = isObject(row.payload_json) ? row.payload_json : {}
  return {
    id: typeof row.id === 'string' ? row.id : '',
    ticketId: typeof row.ticket_id === 'string' ? row.ticket_id : undefined,
    kind: typeof row.kind === 'string' ? row.kind : '',
    summary: typeof row.summary === 'string' ? row.summary : '',
    requestedBy: typeof row.requested_by === 'string' ? row.requested_by : '',
    state: typeof row.state === 'string' ? row.state : 'unknown',
    createdAt: typeof row.created_at === 'number' ? row.created_at : undefined,
    decidedBy: typeof row.decided_by === 'string' ? row.decided_by : undefined,
    decidedAt: typeof row.decided_at === 'number' ? row.decided_at : undefined,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    impact: { ticketId: row.ticket_id ?? null, kind: row.kind, description: row.summary, targets: ['repository', 'branch', 'ref', 'recipient', 'amount', 'currency'].flatMap(key => typeof fields[key] === 'string' || typeof fields[key] === 'number' ? [`${key}: ${String(fields[key]).slice(0, 240)}`] : []) },
    allowed: row.state === 'pending' ? { approve: actions.approve, deny: actions.deny } : { approve: false, deny: false },
  }
}
function publicThread(row: Row, store: Store): Record<string, unknown> {
  return {
    key: typeof row.key === 'string' ? row.key : '',
    source: typeof row.source === 'string' ? row.source : '',
    createdAt: typeof row.created_at === 'number' ? row.created_at : undefined,
    lastAt: typeof row.last_at === 'number' ? row.last_at : undefined,
    seq: typeof row.seq === 'number' ? row.seq : undefined,
    paused: row.paused === true || row.paused === 1,
    evaluating: typeof row.evaluating === 'string' ? row.evaluating : undefined,
    messageCount: Number(store.db.prepare('SELECT COUNT(*) AS n FROM trigger WHERE thread_key = ?').get(String(row.key))?.n ?? 0),
    subscriptionCount: Number(store.db.prepare('SELECT COUNT(*) AS n FROM thread_subscription WHERE thread_key = ?').get(String(row.key))?.n ?? 0),
    hasSubscription: Boolean(store.db.prepare('SELECT 1 FROM thread_subscription WHERE thread_key = ? LIMIT 1').get(String(row.key))),
    eval: typeof row.evaluating === 'string' ? (() => { const evaluation = store.repos.eval.get(row.evaluating); return evaluation ? { id: evaluation.id, state: evaluation.state } : null })() : null,
  }
}
function actorFrom(_value: unknown): string { return 'panel-owner' }
function asApproval(row: Row): Approval {
  return {
    id: approvalId(String(row.id)), ticketId: typeof row.ticket_id === 'string' ? row.ticket_id as Approval['ticketId'] : undefined,
    kind: String(row.kind) as Approval['kind'], summary: String(row.summary), payload: row.payload_json,
    requestedBy: String(row.requested_by), createdAt: Number(row.created_at), state: String(row.state) as Approval['state'],
    ...(typeof row.decided_by === 'string' ? { decidedBy: row.decided_by } : {}),
    ...(typeof row.decided_at === 'number' ? { decidedAt: row.decided_at } : {}),
    ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
  }
}
const fallbackBrief: TicketBrief = {
  goal: 'panel action', scope: { repo: 'unknown', subdirs: [] }, base: { ref: 'unknown', requireCleanTree: false },
  allowWrite: [], denyWrite: [], runtime: 'unknown', acceptance: [], outOfScope: [], blockers: [], firstAction: 'none', approvalsRequired: [],
}
function asTicket(row: Row): Ticket {
  const ended = row.state === 'ended' ? {
    at: typeof row.ended_at === 'number' ? row.ended_at : Number(row.updated_at ?? Date.now()),
    by: row.ended_by === 'watchdog' ? 'watchdog' as const : row.ended_by === 'executor' ? 'executor' as const : 'human' as const,
    outcome: row.outcome === 'completed' ? 'completed' as const : row.outcome === 'failed' ? 'failed' as const : row.outcome === 'dropped' ? 'dropped' as const : 'stopped' as const,
  } : undefined
  return {
    id: String(row.id) as Ticket['id'], threadKey: String(row.thread_key) as Ticket['threadKey'], decisionId: String(row.decision_id ?? 'panel') as Ticket['decisionId'],
    mandate: (row.mandate_json && typeof row.mandate_json === 'object' ? row.mandate_json : {}) as Ticket['mandate'],
    brief: (row.brief_json && typeof row.brief_json === 'object' ? row.brief_json : fallbackBrief) as Ticket['brief'], title: String(row.title ?? ''),
    state: String(row.state) as Ticket['state'], workdir: String(row.workdir ?? ''), createdAt: Number(row.created_at ?? 0), updatedAt: Number(row.updated_at ?? 0),
    assignments: [], currentAssignment: typeof row.current_assignment === 'string' ? row.current_assignment as Ticket['currentAssignment'] : undefined,
    stoppedByHuman: row.stopped_by_human === true || row.stopped_by_human === 1, ...(ended ? { ended } : {}),
  }
}
function repoRows(repo: TableRepo | undefined): Row[] { return repo ? repo.all() : [] }
function statusForError(error: unknown): number { return error instanceof Error && error.message.includes('already') ? 409 : 500 }

export function installPanelRoutes(context: PanelContext, store: Store, config: PanelConfig, ports: PanelPorts = {}): PanelInstallation {
  const now = () => Date.now()
  const routes: Array<() => void | Promise<void>> = []
  const route = (path: typeof ROUTES[number], handler: (request: Request) => Promise<Response>) => {
    routes.push(context.connection.fetch.register({ path: `/api/superagent${path}`, methods: ['POST'], requestBody: 'buffered', fetch: async request => {
      if (!originAllowed(request, config)) return fail('origin_denied', 'Origin is not permitted', 403)
      try { return await handler(request) } catch { return fail('internal_error', 'Panel request could not be completed', 500) }
    } }))
  }

  const healthData = async () => {
    const health = ports.health ? await ports.health() : { ok: false, runtime: { state: 'unavailable' } }
    const sources = ports.sources ? await ports.sources() : isObject(health) && Array.isArray(health.sources) ? health.sources : []
    const file = store.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file
    let sizeBytes: number | null = null
    if (typeof file === 'string' && file) {
      try { sizeBytes = [file, `${file}-wal`].reduce((sum, path, index) => { try { return sum + statSync(path).size } catch (error) { if (index === 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return sum; throw error } }, 0) } catch { /* unknown, never report a fabricated zero */ }
    }
    const recent = store.repos.audit.all().sort((a, b) => Number(b.at) - Number(a.at) || Number(b.id) - Number(a.id))
    const decisions = recent.filter(row => row.action === 'watchdog' || String(row.action).startsWith('watchdog.')).filter(row => isObject(row.detail) && isObject(row.detail.metrics) && row.detail.outcome !== 'requested').slice(0, 20).map(row => {
      const detail = row.detail as Record<string, unknown>, metrics = detail.metrics as Record<string, unknown>
      const at = metrics.at, last = metrics.lastProgressAt
      return { at: row.at, action: detail.action, rule: detail.rule, outcome: detail.outcome, assignmentId: detail.assignmentId, metrics: { at, lastProgressAt: last, stallMs: typeof at === 'number' && Number.isFinite(at) && typeof last === 'number' && Number.isFinite(last) ? Math.max(0, at - last) : null, steps: metrics.steps, usage: metrics.tokens, durationMs: metrics.durationMs, repeatedCalls: metrics.repeatedCalls, waitingMs: metrics.waitingMs } }
    })
    const outbounds = store.repos.outbound.all()
    const base = isObject(health) ? health : { status: health }
    return { ...base, db: { version: store.version, sizeBytes }, watchdog: { ...(isObject(base.watchdog) ? base.watchdog : {}), decisions }, outbox: { pending: outbounds.filter(row => row.state === 'pending').length, dropped: outbounds.filter(row => row.state === 'dropped').length }, recentErrors: recent.filter(row => /(?:error|failed|dropped)/i.test(String(row.action)) || isObject(row.detail) && row.detail.outcome === 'failed').slice(0, 20).map(row => ({ at: row.at, action: row.action, ...(isObject(row.detail) && typeof row.detail.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(row.detail.code) ? { code: row.detail.code } : {}) })), sources }
  }
  const activityRows = () => repoRows(store.repos.audit).slice(-20).reverse().map(row => ({
    id: typeof row.id === 'number' ? row.id : undefined,
    at: typeof row.at === 'number' ? row.at : undefined,
    actor: typeof row.actor === 'string' ? row.actor : undefined,
    action: typeof row.action === 'string' ? row.action : undefined,
    ticketId: typeof row.ticket_id === 'string' ? row.ticket_id : undefined,
    threadKey: typeof row.thread_key === 'string' ? row.thread_key : undefined,
  }))
  route('/overview', async request => {
    const parsed = await body(request, [])
    if (parsed.error) return parsed.error
    const tickets = repoRows(store.repos.ticket)
    const approvals = repoRows(store.repos.approval)
    return ok({
      counts: { tickets: { total: tickets.length, open: tickets.filter(row => row.state !== 'ended').length }, approvals: { total: approvals.length, pending: approvals.filter(row => row.state === 'pending').length } },
      activities: activityRows(),
      health: await healthData(),
    })
  })
  route('/tickets', async request => {
    const parsed = await body(request, ['state', 'source', 'cursor', 'limit']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (input.state !== undefined && typeof input.state !== 'string' || input.source !== undefined && !validId(input.source) || input.cursor !== undefined && (typeof input.cursor !== 'string' || !/^\d{1,9}$/.test(input.cursor))) return fail('invalid_input', 'Invalid ticket filter', 400)
    const limit = limitOf(input.limit, config.panelPageSize); if (!limit) return fail('invalid_input', 'Invalid limit', 400)
    const cursor = Number(input.cursor ?? 0)
    const rows = repoRows(store.repos.ticket).filter(row => (input.state === undefined || row.state === input.state) && (input.source === undefined || store.repos.thread.get(row.thread_key)?.source === input.source)).sort((a, b) => Number(b.created_at) - Number(a.created_at) || String(a.id).localeCompare(String(b.id)))
    const items = rows.slice(cursor, cursor + limit).map(row => ({ ...publicTicket(row, { stop: Boolean(ports.stopTicket || ports.ticketAction), resume: Boolean(ports.resumeTicket || ports.ticketAction) }), source: store.repos.thread.get(row.thread_key)?.source }))
    return ok({ items, ...(cursor + limit < rows.length ? { next: String(cursor + limit) } : {}) })
  })
  route('/ticket', async request => {
    const parsed = await body(request, ['id']); if (parsed.error) return parsed.error
    if (!validId(parsed.value!.id)) return fail('invalid_input', 'Invalid ticket id', 400)
    const row = store.repos.ticket.get(parsed.value!.id)
    if (!row) return fail('not_found', 'Ticket not found', 404)
    return ok({ ticket: publicTicket(row, { stop: Boolean(ports.stopTicket || ports.ticketAction), resume: Boolean(ports.resumeTicket || ports.ticketAction) }), assignments: repoRows(store.repos.assignment).filter(item => item.ticket_id === row.id).map(item => ({ id: item.id, state: item.state, startedAt: item.started_at, endedAt: item.ended_at, endedReason: item.ended_reason, steps: item.steps, usage: item.tokens, lastProgressAt: item.last_progress_at })), approvals: repoRows(store.repos.approval).filter(item => item.ticket_id === row.id).map(item => publicApproval(item, { approve: false, deny: false })), timeline: activityRows().filter(item => item.ticketId === row.id) })
  })
  route('/threads', async request => {
    const parsed = await body(request, ['key', 'cursor', 'limit']); if (parsed.error) return parsed.error
    const input = parsed.value!; if (input.key !== undefined && !validId(input.key) || input.cursor !== undefined && (typeof input.cursor !== 'string' || !/^\d{1,9}$/.test(input.cursor))) return fail('invalid_input', 'Invalid thread key or cursor', 400)
    const limit = limitOf(input.limit, config.panelPageSize); if (!limit) return fail('invalid_input', 'Invalid limit', 400)
    const cursor = Number(input.cursor ?? 0)
    const rows = repoRows(store.repos.thread).filter(row => input.key === undefined || row.key === input.key).sort((a, b) => String(a.source).localeCompare(String(b.source)) || Number(b.last_at) - Number(a.last_at) || String(a.key).localeCompare(String(b.key)))
    return ok({ items: rows.slice(cursor, cursor + limit).map(row => publicThread(row, store)), ...(cursor + limit < rows.length ? { next: String(cursor + limit) } : {}) })
  })
  route('/approvals', async request => {
    const parsed = await body(request, ['state', 'limit']); if (parsed.error) return parsed.error
    const input = parsed.value!; if (input.state !== undefined && typeof input.state !== 'string') return fail('invalid_input', 'Invalid state', 400)
    const limit = limitOf(input.limit, config.panelPageSize); if (!limit) return fail('invalid_input', 'Invalid limit', 400)
    const rows = repoRows(store.repos.approval).filter(row => input.state === undefined || row.state === input.state).slice(0, limit).map(row => publicApproval(row, { approve: true, deny: true }))
    return ok({ items: rows })
  })
  route('/approval', async request => {
    const parsed = await body(request, ['id', 'decision', 'action', 'reason', 'actor']); if (parsed.error) return parsed.error
    const input = parsed.value!
    // `decision` is the published contract; `action` remains a narrow compatibility alias.
    if (input.decision !== undefined && input.action !== undefined) return fail('invalid_input', 'Use decision, not action', 400)
    const decision = input.decision ?? input.action
    if (!validId(input.id) || (decision !== 'approve' && decision !== 'deny') || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) return fail('invalid_input', 'Approval id, decision and reason are required', 400)
    const existing = store.repos.approval.get(input.id); if (!existing) return fail('not_found', 'Approval not found', 404)
    const decidedAt = now(); const created = Number(existing.created_at); const timeout = Number(config.approvalTimeoutMs ?? 86_400_000)
    if (!Number.isFinite(created) || decidedAt - created >= timeout) {
      const expired = store.transaction(() => {
        const cas = store.repos.approval.updateByState(input.id, 'pending', 'expired', { decided_at: decidedAt })
        if (cas) store.repos.audit.insert({ at: decidedAt, actor: actorFrom(input.actor), action: 'approval.expire', ticket_id: existing.ticket_id ?? null, thread_key: null, detail: { approvalId: input.id } })
        return cas
      })
      return fail(expired ? 'expired' : 'conflict', expired ? 'Approval has expired' : 'Approval is no longer pending', 409)
    }
    try {
      const event = decision === 'approve' ? { type: 'approve' as const, by: actorFrom(input.actor), at: decidedAt, reason: input.reason.trim() } : { type: 'deny' as const, by: actorFrom(input.actor), at: decidedAt, reason: input.reason.trim() }
      const next = transitionApproval(asApproval(existing), event)
      const changed = store.transaction(() => {
        const cas = store.repos.approval.updateByState(input.id, 'pending', next.state, { decided_by: next.decidedBy, decided_at: next.decidedAt, reason: next.reason })
        if (!cas) return false
        // A linked waiting-human ticket receives the same domain approval transition and CAS in this transaction.
        if (typeof existing.ticket_id === 'string') {
          const linked = store.repos.ticket.get(existing.ticket_id)
          if (linked?.state === 'waiting_human') {
            const linkedTicket = transitionTicket(asTicket(linked), { type: 'approval_decision', at: decidedAt, trust: 'human', approved: decision === 'approve' })
            const approvals = repoRows(store.repos.approval).filter(item => item.ticket_id === existing.ticket_id)
            const blocked = decision === 'deny' || approvals.some(item => item.state === 'pending' || item.state === 'denied' || item.state === 'expired')
            const assignment = linked.current_assignment ? store.repos.assignment.get(linked.current_assignment) : undefined
            const state = blocked ? 'waiting_human' : assignment?.state === 'running' ? linkedTicket.state : 'open'
            if (!store.repos.ticket.updateByState(existing.ticket_id, 'waiting_human', state, { ...(blocked ? {} : { attention_json: null }), updated_at: linkedTicket.updatedAt })) throw new Error('ticket changed concurrently')
            store.repos.audit.insert({ at: decidedAt, actor: actorFrom(input.actor), action: `ticket.approval_${decision}`, ticket_id: existing.ticket_id, thread_key: linked.thread_key ?? null, detail: { approvalId: input.id } })
          }
        }
        store.repos.audit.insert({ at: decidedAt, actor: actorFrom(input.actor), action: `approval.${decision}`, ticket_id: existing.ticket_id ?? null, thread_key: null, detail: { approvalId: input.id, reason: String(input.reason).trim() } })
        return true
      })
      if (!changed) return fail('conflict', 'Approval is no longer pending', 409)
      if (typeof existing.ticket_id === 'string' && ports.approvalDecided) {
        try { await ports.approvalDecided(existing.ticket_id, String(input.id), decision === 'approve') }
        catch { store.repos.audit.insert({ at: now(), actor: 'panel-owner', action: 'approval.delivery_pending', ticket_id: existing.ticket_id, thread_key: null, detail: { approvalId: input.id } }) }
      }
      return ok(publicApproval({ ...existing, state: next.state, decided_by: next.decidedBy, decided_at: next.decidedAt, reason: next.reason }, { approve: false, deny: false }))
    } catch { return fail('conflict', 'Approval is no longer pending', 409) }
  })
  route('/ticket-action', async request => {
    const parsed = await body(request, ['id', 'action', 'reason', 'actor']); if (parsed.error) return parsed.error
    const input = parsed.value!; if (!validId(input.id) || (input.action !== 'stop' && input.action !== 'resume')) return fail('invalid_input', 'Ticket id and action are required', 400)
    const row = store.repos.ticket.get(input.id); if (!row) return fail('not_found', 'Ticket not found', 404)
    const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
    if (input.action === 'stop' && (!reason || reason.length > 2000)) return fail('invalid_input', 'Stop reason is required', 400)
    const action = input.action as 'stop' | 'resume'
    const effect = action === 'stop' ? ports.stopTicket : ports.resumeTicket
    if (!effect && !ports.ticketAction) return fail('unavailable', 'Ticket action is unavailable', 503)
    if (action === 'resume') {
      if (row.state !== 'ended' || row.stopped_by_human === true || row.stopped_by_human === 1) return fail('invalid_transition', 'Ticket cannot resume', 409)
      if (!ports.mandateValid) return fail('unavailable', 'Ticket mandate cannot be revalidated', 503)
      if (!await ports.mandateValid(row)) return fail('invalid_transition', 'Ticket mandate is no longer valid', 409)
      const pending = repoRows(store.repos.thread_trigger).some(trigger => trigger.thread_key === row.thread_key && (trigger.state === 'pending' || trigger.state === 'queued'))
      if (!pending) return fail('invalid_transition', 'Ticket has no pending input', 409)
    }
    let current = store.repos.ticket.get(input.id); if (!current) return fail('not_found', 'Ticket not found', 404)
    let ticket: Ticket
    let transitioned: Ticket
    try {
      ticket = asTicket(current)
      transitioned = action === 'stop'
        ? transitionTicket(ticket, { type: 'stop', at: now(), by: 'human', reason })
        : transitionTicket(ticket, { type: 'ticket_resume', at: now(), trust: 'human', mandateValid: true, hasPendingInput: true })
    } catch { return fail('invalid_transition', 'Ticket transition is not allowed', 409) }
    let invoked: boolean | void
    try {
      invoked = ports.ticketAction ? await ports.ticketAction(action, input.id, reason || undefined) : await effect!(input.id, reason)
    } catch { return fail('unavailable', 'Ticket action is unavailable', 503) }
    if (invoked === false) return fail('unavailable', 'Ticket action was not performed', 503)
    const changed = store.transaction(() => {
      const cas = store.repos.ticket.updateByState(input.id, ticket.state, transitioned.state, action === 'stop'
        ? { stopped_by_human: true, ended_at: transitioned.ended?.at, ended_by: transitioned.ended?.by, outcome: transitioned.ended?.outcome, current_assignment: null, updated_at: transitioned.updatedAt }
        : { stopped_by_human: false, ended_at: null, ended_by: null, outcome: null, current_assignment: null, updated_at: transitioned.updatedAt })
      if (cas) store.repos.audit.insert({ at: transitioned.updatedAt, actor: actorFrom(input.actor), action: `ticket.${action}`, ticket_id: input.id, thread_key: current.thread_key ?? null, detail: reason ? { reason } : null })
      return cas
    })
    if (!changed) return fail('conflict', 'Ticket changed concurrently', 409)
    return ok(publicTicket({ ...current, state: transitioned.state, stopped_by_human: action === 'stop', ended_at: transitioned.ended?.at, ended_by: transitioned.ended?.by, outcome: transitioned.ended?.outcome, current_assignment: null, updated_at: transitioned.updatedAt }))
  })
  route('/health', async request => { const parsed = await body(request, []); if (parsed.error) return parsed.error; return ok(await healthData()) })
  route('/settings', async request => {
    const parsed = await body(request, []); if (parsed.error) return parsed.error
    return ok({ effective: ports.settings ? await ports.settings() : effectiveSettings(config as Partial<Config>) })
  })

  const dispose = async () => { for (const disposer of routes.reverse()) await disposer() }
  if (context.effect) context.effect(() => dispose)
  return { dispose }
}

export { ROUTES as PANEL_ROUTE_PATHS }
