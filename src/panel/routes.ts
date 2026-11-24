import { statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { relative, resolve, isAbsolute } from 'node:path'
import { readBoard, boardTicket, approvalFingerprint } from './board.js'
import type { BoardColumn } from './board.js'
import { WorkspaceError } from '../workspace/commands.js'
import { ConversationError } from '../workspace/conversation.js'
import { validSessionAction } from '../workspace/session-actions.js'
import { validSessionDecision } from '../workspace/session-decisions.js'
import { approvalImpact } from '../engine/approval-impact.js'
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
  readonly workspace?: (input?: { cursor?: string; limit?: number; planId?: string }) => Promise<unknown>
  readonly conversation?: (input: any) => Promise<unknown>
  readonly command?: (input: any) => Promise<unknown>
  readonly commandStatus?: (input: any) => Promise<unknown>
  readonly cancelCommand?: (input: any) => Promise<unknown>
  readonly admission?: (input: any) => Promise<unknown>
  readonly reviseAdmission?: (input: any) => Promise<unknown>
  readonly ownsTicketTransitions?: boolean
  readonly health?: () => unknown | Promise<unknown>
  readonly sources?: () => unknown | Promise<unknown>
  /** Passive current-Host observations and persistent membership only; runtime checks epoch/revision. */
  readonly sessionWork?: (input: any) => Promise<unknown>
  /** Side-effect-free target proposal only; never dispatches to the returned Session. */
  readonly sessionLocate?: (input: any) => Promise<unknown>
  /** Exact prepared control metadata only; production is blocked before any Agent activation. */
  readonly sessionAction?: (input: any) => Promise<unknown>
  /** Pre-delivery human confirmation summary only; never dispatches or activates an Agent. */
  readonly delivery?: (input: any) => Promise<unknown>
  /** Bounded original-byte upload/preview and target binding; no model or delivery call. */
  readonly images?: (input: any) => Promise<unknown>
  readonly stageModels?: (input: any) => Promise<unknown>
  readonly sessionDecision?: (input: any) => Promise<unknown>
  readonly configMutation?: (input: any) => Promise<unknown>
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
const ROUTES = ['/workspace', '/conversation', '/command', '/command-status', '/command-cancel', '/admission', '/admission-revise', '/board', '/overview', '/tickets', '/ticket', '/threads', '/approvals', '/approval', '/ticket-action', '/health', '/settings', '/session-work', '/session-locate', '/session-action', '/delivery', '/images', '/stage-models', '/session-decision', '/config-mutation'] as const
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
/** Lossless owner-relative project identity, not an opaque alias standing in for unseen scope. */
function reviewPlan(plan: any) {
  const repo = plan?.brief?.scope?.repo
  let brief = plan?.brief
  if (typeof repo === 'string' && isAbsolute(repo) && resolve(repo) === repo) {
    const suffix = relative(homedir(), repo)
    if (suffix && !suffix.startsWith('..') && !isAbsolute(suffix) && String(redact(suffix)) === suffix) brief = { ...brief, scope: { ...brief.scope, repo: `~/${suffix}` } }
  }
  const reviewable = JSON.stringify(sanitize(brief)) === JSON.stringify(brief)
  return { ...plan, brief, scope: brief?.scope, reviewable, ...(brief !== plan?.brief ? { scopeIdentity: 'host-owner-home-relative' } : {}), ...(!reviewable ? { blockedReason: 'admission_scope_redacted' } : {}) }
}
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[REDACTED]'
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1))
  if (isObject(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (/token|secret|password|credential|authorization|cookie|raw|payload|workdir|path|url/i.test(key)) continue
      // Host-generated cursors and SHA fingerprints are opaque metadata, not arbitrary text.
      result[key] = ['cursor', 'nextBefore', 'nextAfter', 'fingerprint', 'revision'].includes(key) && typeof item === 'string' && /^[A-Za-z0-9_-]{1,1024}$/.test(item) ? item : sanitize(item, depth + 1)
    }
    return result
  }
  return value
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function validId(value: unknown): value is string { return typeof value === 'string' && SAFE_ID.test(value) }
function validHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
/** Preserve only validated provenance hashes in this exact DTO; global sanitizer stays unchanged. */
function validWorkId(value: unknown): value is string { return validId(value) && !value.includes('://') }
function validWorkCursor(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,1024}$/.test(value) }
/** Exact observation DTO only: keep opaque identities/cursors, never arbitrary projections or headers. */
function sessionWorkData(value: unknown): unknown {
  if (!isObject(value)) return { state: 'unavailable', scope: 'current-host', items: [], total: null, hasMore: false }
  const result: Record<string, unknown> = {}
  for (const key of ['state', 'scope', 'defaultIncluded', 'sampledAt', 'total', 'excludedTotal', 'internalTotal', 'hasMore', 'error', 'included', 'stopped']) {
    const item = value[key]
    if (typeof item === 'string' || typeof item === 'boolean' || item === null || typeof item === 'number' && Number.isFinite(item)) result[key] = sanitize(item)
  }
  for (const key of ['sessionId', 'projectId', 'revision']) if (validWorkId(value[key])) result[key] = value[key]
  if (validWorkCursor(value.next)) result.next = value.next
  if (Array.isArray(value.items)) result.items = value.items.slice(0, 20).filter(item => isObject(item) && (validWorkId(item.sessionId) || validWorkId(item.key) && ['project', 'unassigned', 'unknown'].includes(String(item.kind)))).map(item => {
    if (!validWorkId(item.sessionId)) return { key: item.key, kind: item.kind, ...(typeof item.name === 'string' ? { name: sanitize(item.name) } : {}), excluded: item.excluded === true,
      sessionTotal: Number.isSafeInteger(item.sessionTotal) && item.sessionTotal >= 0 ? item.sessionTotal : null, includedTotal: Number.isSafeInteger(item.includedTotal) && item.includedTotal >= 0 ? item.includedTotal : null }
    const row: Record<string, unknown> = { sessionId: item.sessionId }
    const project = item.project
    if (isObject(project) && project.kind === 'project' && validWorkId(project.key) && typeof project.name === 'string') row.project = { kind: 'project', key: project.key, name: sanitize(project.name) }
    else row.project = { kind: project?.kind === 'unassigned' ? 'unassigned' : 'unknown', key: project?.kind === 'unassigned' ? 'unassigned' : 'unknown' }
    // Excluded rows retain only the safe source label and membership metadata.
    const keys = item.excluded === true ? ['title', 'excluded', 'observedAt'] : ['title', 'objective', 'runtime', 'goalPhase', 'progress', 'nextAction', 'blocker', 'decision', 'observedAt', 'evidence', 'excluded']
    for (const key of keys) if (typeof item[key] === 'string' || typeof item[key] === 'boolean' || typeof item[key] === 'number' && Number.isFinite(item[key])) row[key] = sanitize(item[key])
    if (item.excluded !== true && typeof item.factRevision === 'string' && /^[a-f0-9]{64}$/.test(item.factRevision)) row.factRevision = item.factRevision
    if (item.approvalCoverage === 'unavailable') row.approvalCoverage = 'unavailable'
    if (item.excluded !== true && Array.isArray(item.done)) row.done = item.done.slice(0, 3).filter((value: unknown) => typeof value === 'string').map((value: string) => sanitize(value))
    if (item.excluded !== true && isObject(item.result) && ['goal-complete', 'unverified'].includes(String(item.result.state)) && item.result.acceptanceVerified === false) row.result = { state: item.result.state, acceptanceVerified: false, ...(typeof item.result.summary === 'string' ? { summary: sanitize(item.result.summary) } : {}) }
    if (['session', 'project', 'membership-unknown'].includes(String(item.exclusionReason))) row.exclusionReason = item.exclusionReason
    return row
  })
  return result
}
function validRaster(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
  if (mime === 'image/gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
  return mime === 'image/webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}
function only(input: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(input).every(key => keys.includes(key))
}
function limitOf(value: unknown, configured: number | undefined): number {
  if (value === undefined) return Math.min(SAFE_LIMIT, Math.max(1, Math.trunc(configured ?? 20)))
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= SAFE_LIMIT ? value : 0
}
async function body(request: Request, keys: readonly string[], maxBytes = 24_576): Promise<{ value?: Record<string, unknown>; error?: Response }> {
  let value: unknown
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { error: fail('body_too_large', 'Request body is too large', 400) }
    value = JSON.parse(raw)
  } catch { return { error: fail('invalid_json', 'Request body must be JSON', 400) } }
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
  const review = approvalImpact(row.kind, row.payload_json)
  return {
    id: typeof row.id === 'string' ? row.id : '',
    ticketId: typeof row.ticket_id === 'string' ? row.ticket_id : undefined,
    kind: typeof row.kind === 'string' ? row.kind : '',
    summary: typeof row.summary === 'string' ? row.summary : '',
    requestedBy: typeof row.requested_by === 'string' ? row.requested_by : '',
    state: typeof row.state === 'string' ? row.state : 'unknown',
    fingerprint: approvalFingerprint(row),
    createdAt: typeof row.created_at === 'number' ? row.created_at : undefined,
    decidedBy: typeof row.decided_by === 'string' ? row.decided_by : undefined,
    decidedAt: typeof row.decided_at === 'number' ? row.decided_at : undefined,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    impact: { ticketId: row.ticket_id ?? null, kind: row.kind, description: row.summary, reviewable: review.reviewable, details: review.details, reason: review.reason, targets: ['repository', 'branch', 'ref', 'recipient', 'amount', 'currency'].flatMap(key => typeof fields[key] === 'string' || typeof fields[key] === 'number' ? [`${key}: ${String(fields[key]).slice(0, 240)}`] : []) },
    allowed: row.state === 'pending' ? { approve: actions.approve && review.reviewable, deny: actions.deny } : { approve: false, deny: false },
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
      try { return await handler(request) } catch (error) {
        const code = (error as any)?.code, status = (error as any)?.status
        const fixed = ['invalid_input', 'invalid_cursor', 'epoch_mismatch', 'epoch_not_found', 'board_resync_required', 'invalid_command', 'request_conflict', 'command_record_invalid', 'command_conflict', 'command_not_found', 'workspace_paused', 'queue_full', 'ticket_input_denied', 'model_unavailable', 'workspace_unavailable', 'history_unavailable', 'admission_conflict', 'plan_expired', 'plan_not_found', 'admission_invalid', 'admission_unavailable']
        if (typeof code === 'string' && (fixed.includes(code) || error instanceof WorkspaceError || error instanceof ConversationError)) return fail(code, 'Workspace request could not be completed', [400, 403, 404, 409, 413, 415, 429, 503].includes(status) ? status : code === 'epoch_mismatch' ? 409 : 400)
        return fail('internal_error', 'Panel request could not be completed', 500)
      }
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
  route('/workspace', async request => {
    const parsed = await body(request, ['cursor', 'limit']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (input.cursor !== undefined && !validId(input.cursor) || !limitOf(input.limit, 100)) return fail('invalid_input', 'Invalid plan cursor or limit', 400)
    if (!ports.workspace) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    const data = await ports.workspace(input) as any
    const { sessionWork, ...rest } = data || {}
    const safe = sanitize({ ...rest, admissions: Array.isArray(data?.admissions) ? data.admissions.map(reviewPlan) : [] }) as Record<string, unknown>
    return json({ ok: true, data: { ...safe, ...(sessionWork !== undefined ? { sessionWork: sessionWorkData(sessionWork) } : {}) } })
  })
  route('/conversation', async request => {
    const parsed = await body(request, ['epoch', 'after', 'before', 'limit']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (!validId(input.epoch) || input.after !== undefined && typeof input.after !== 'string' || input.before !== undefined && typeof input.before !== 'string' || input.after !== undefined && input.before !== undefined || !limitOf(input.limit, 30)) return fail('invalid_input', 'Invalid conversation cursor', 400)
    if (!ports.conversation) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    return ok(await ports.conversation(input))
  })
  route('/command', async request => {
    const parsed = await body(request, ['epoch', 'requestId', 'intent', 'text', 'ticketId', 'recreateFrom', 'documentOrigin']); if (parsed.error) return parsed.error
    if (!ports.command) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    return ok(await ports.command(parsed.value!))
  })
  route('/command-status', async request => {
    const parsed = await body(request, ['epoch', 'requestId']); if (parsed.error) return parsed.error
    if (!validId(parsed.value!.epoch) || !validId(parsed.value!.requestId)) return fail('invalid_input', 'Request identity required', 400)
    if (!ports.commandStatus) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    return ok(await ports.commandStatus(parsed.value!))
  })
  route('/command-cancel', async request => {
    const parsed = await body(request, ['epoch', 'requestId', 'seq']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (!validId(input.epoch) || !validId(input.requestId) || !Number.isSafeInteger(input.seq) || Number(input.seq) < 1) return fail('invalid_input', 'Exact request version required', 400)
    if (!ports.cancelCommand) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    return ok(await ports.cancelCommand(input))
  })
  route('/admission', async request => {
    const parsed = await body(request, ['epoch', 'requestId', 'planId', 'fingerprint', 'decision']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (!['epoch', 'requestId', 'planId'].every(key => validId(input[key])) || typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !['approve', 'reject'].includes(String(input.decision))) return fail('invalid_input', 'Plan identity and decision required', 400)
    if (!ports.admission) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    if (input.decision === 'approve') {
      const workspace = await ports.workspace?.({ planId: String(input.planId) }) as any
      const plan = workspace?.admissions?.find((row: any) => row.planId === input.planId && row.requestId === input.requestId && row.epoch === input.epoch && row.fingerprint === input.fingerprint)
      if (!plan || !reviewPlan(plan).reviewable) return fail('admission_unreviewable', 'Exact plan scope is not fully visible; approval is blocked', 409)
    }
    return ok(reviewPlan(await ports.admission(input)))
  })
  route('/admission-revise', async request => {
    const parsed = await body(request, ['epoch', 'requestId', 'planId', 'fingerprint', 'patch']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (!['epoch', 'requestId', 'planId'].every(key => validId(input[key])) || typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !isObject(input.patch)) return fail('invalid_input', 'Exact plan identity and revision patch required', 400)
    if (!ports.reviseAdmission) return fail('workspace_unavailable', 'Workspace is unavailable', 503)
    return ok(reviewPlan(await ports.reviseAdmission(input)))
  })
  route('/board', async request => {
    const parsed = await body(request, ['column', 'cursor', 'limit', 'query', 'outcome']); if (parsed.error) return parsed.error
    return ok(readBoard(store, parsed.value as { column?: BoardColumn }))
  })
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
    const parsed = await body(request, ['id', 'timelineCursor', 'limit']); if (parsed.error) return parsed.error
    if (!validId(parsed.value!.id)) return fail('invalid_input', 'Invalid ticket id', 400)
    const row = store.repos.ticket.get(parsed.value!.id)
    if (!row) return fail('not_found', 'Ticket not found', 404)
    const input = parsed.value!, limit = limitOf(input.limit, 30)
    if (!limit || input.timelineCursor !== undefined && (typeof input.timelineCursor !== 'string' || !/^\d{1,16}$/.test(input.timelineCursor))) return fail('invalid_input', 'Invalid timeline cursor', 400)
    const timeline = store.db.prepare('SELECT id, at, actor, action FROM audit WHERE ticket_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(String(row.id), Number(input.timelineCursor ?? Number.MAX_SAFE_INTEGER), limit + 1)
    const approvals = repoRows(store.repos.approval).filter(item => item.ticket_id === row.id).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    return ok({ ticket: { ...publicTicket(row, { stop: Boolean(ports.stopTicket || ports.ticketAction), resume: Boolean(ports.resumeTicket || ports.ticketAction) }), ...boardTicket(store, row) }, brief: row.brief_json,
      assignments: repoRows(store.repos.assignment).filter(item => item.ticket_id === row.id).map(item => ({ id: item.id, state: item.state, startedAt: item.started_at, endedAt: item.ended_at, endedReason: item.ended_reason, steps: item.steps, usage: item.tokens, lastProgressAt: item.last_progress_at, report: isObject(item.report_json) ? { ...item.report_json, changedFiles: item.report_json.changedPaths } : item.report_json })),
      approvals: approvals.slice(0, 30).map(item => ({ ...publicApproval(item, { approve: true, deny: true }), expiresAt: Number(item.created_at) + Number(config.approvalTimeoutMs ?? 86_400_000) })), approvalsTotal: approvals.length, ...(approvals.length > 30 ? { approvalsNext: String(approvals[29]!.id) } : {}),
      timeline: timeline.slice(0, limit), ...(timeline.length > limit ? { timelineCursor: String(timeline[limit - 1]!.id) } : {}),
      delivery: store.repos.outbound.all().filter(item => item.ticket_id === row.id).map(item => ({ state: item.state, attempts: item.attempts, nextAt: item.next_at, error: item.last_error })) })
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
    const parsed = await body(request, ['state', 'ticketId', 'limit', 'cursor']); if (parsed.error) return parsed.error
    const input = parsed.value!; if (input.state !== undefined && typeof input.state !== 'string' || input.cursor !== undefined && !validId(input.cursor) || input.ticketId !== undefined && !validId(input.ticketId)) return fail('invalid_input', 'Invalid state, ticket or cursor', 400)
    const limit = limitOf(input.limit, config.panelPageSize); if (!limit) return fail('invalid_input', 'Invalid limit', 400)
    const all = repoRows(store.repos.approval).filter(row => (input.state === undefined || row.state === input.state) && (input.ticketId === undefined || row.ticket_id === input.ticketId)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    const start = input.cursor === undefined ? 0 : all.findIndex(row => row.id === input.cursor) + 1
    if (input.cursor !== undefined && start === 0) return fail('conflict', 'Approvals changed; reload this list', 409)
    const page = all.slice(start, start + limit)
    return ok({ items: page.map(row => ({ ...publicApproval(row, { approve: true, deny: true }), expiresAt: Number(row.created_at) + Number(config.approvalTimeoutMs ?? 86_400_000) })), total: all.length, ...(start + page.length < all.length ? { next: String(page.at(-1)!.id) } : {}) })
  })
  route('/approval', async request => {
    const parsed = await body(request, ['id', 'decision', 'action', 'reason', 'actor', 'fingerprint']); if (parsed.error) return parsed.error
    const input = parsed.value!
    // `decision` is the published contract; `action` remains a narrow compatibility alias.
    if (input.decision !== undefined && input.action !== undefined) return fail('invalid_input', 'Use decision, not action', 400)
    const decision = input.decision ?? input.action
    if (!validId(input.id) || (decision !== 'approve' && decision !== 'deny') || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) return fail('invalid_input', 'Approval id, decision and reason are required', 400)
    const existing = store.repos.approval.get(input.id); if (!existing) return fail('not_found', 'Approval not found', 404)
    if (typeof input.fingerprint !== 'string' || input.fingerprint !== approvalFingerprint(existing)) return fail('conflict', 'Approval content changed; review it again', 409)
    const decidedAt = now(); const created = Number(existing.created_at); const timeout = Number(config.approvalTimeoutMs ?? 86_400_000)
    if (!Number.isFinite(created) || decidedAt - created >= timeout) {
      const expired = store.transaction(() => {
        const cas = store.repos.approval.updateByState(input.id, 'pending', 'expired', { decided_at: decidedAt })
        if (cas) store.repos.audit.insert({ at: decidedAt, actor: actorFrom(input.actor), action: 'approval.expire', ticket_id: existing.ticket_id ?? null, thread_key: null, detail: { approvalId: input.id } })
        return cas
      })
      return fail(expired ? 'expired' : 'conflict', expired ? 'Approval has expired' : 'Approval is no longer pending', 409)
    }
    if (decision === 'approve' && !approvalImpact(existing.kind, existing.payload_json).reviewable) return fail('approval_unreviewable', 'Approval action cannot be reviewed safely; request a new exact plan', 409)
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
    if (ports.ownsTicketTransitions) {
      const persisted = store.repos.ticket.get(input.id)
      if (!persisted || persisted.state !== transitioned.state || action === 'stop' && !persisted.stopped_by_human) return fail('conflict', 'Ticket changed concurrently', 409)
      return ok({ ...publicTicket(persisted), ...boardTicket(store, persisted) })
    }
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
  route('/session-work', async request => {
    const parsed = await body(request, ['action', 'epoch', 'view', 'cursor', 'limit', 'sessionId', 'projectId', 'projectKey', 'included', 'revision']); if (parsed.error) return parsed.error
    const input = parsed.value!
    const page = (input.cursor === undefined || validWorkCursor(input.cursor)) && (input.limit === undefined || Number.isInteger(input.limit) && Number(input.limit) >= 1 && Number(input.limit) <= 20)
    const shape = input.action === 'list'
      ? only(input, ['action', 'epoch', 'view', 'cursor', 'limit', 'projectKey']) && (input.view === undefined || ['included', 'excluded'].includes(String(input.view))) && (input.projectKey === undefined || input.projectKey === 'unknown' || input.projectKey === 'unassigned' || typeof input.projectKey === 'string' && input.projectKey.startsWith('project:') && validWorkId(input.projectKey.slice(8))) && page
      : input.action === 'projects' ? only(input, ['action', 'epoch', 'cursor', 'limit']) && page
      : input.action === 'set-project-included' ? only(input, ['action', 'epoch', 'projectId', 'included', 'revision']) && validWorkId(input.projectId) && typeof input.included === 'boolean' && validWorkId(input.revision)
      : input.action === 'set-included' && only(input, ['action', 'epoch', 'sessionId', 'included', 'revision']) && validWorkId(input.sessionId) && typeof input.included === 'boolean' && validWorkId(input.revision)
    if (!shape || !validId(input.epoch)) return fail('invalid_input', 'Session work request fields are invalid', 400)
    if (!ports.sessionWork) return fail('session_work_unavailable', 'Session work is unavailable', 503)
    // This port can only observe or change membership; it cannot control/open a Session or create a Ticket.
    return json({ ok: true, data: sessionWorkData(await ports.sessionWork(input)) })
  })
  route('/session-locate', async request => {
    const parsed = await body(request, ['epoch', 'text', 'sessionId', 'revision']); if (parsed.error) return parsed.error
    const input = parsed.value!
    if (!validId(input.epoch) || typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text, 'utf8') > 16_384 || input.text.includes('\0') || input.sessionId !== undefined && !validWorkId(input.sessionId) || input.revision !== undefined && !validHash(input.revision)) return fail('invalid_input', 'Target lookup fields are invalid', 400)
    if (!ports.sessionLocate) return fail('session_work_unavailable', 'Target lookup is unavailable', 503)
    const data = await ports.sessionLocate(input) as any
    const candidate = (item: any) => {
      if (!isObject(item) || !validWorkId(item.sessionId)) return undefined
      const safe = sessionWorkData({ items: [item] }) as any
      return { ...safe.items?.[0], ...(validHash(item.factRevision) ? { factRevision: item.factRevision } : {}),
        ...(['objective', 'progress', 'nextAction', 'title'].includes(String(item.matchField)) && typeof item.matchText === 'string' ? { matchField: item.matchField, matchText: sanitize(item.matchText.slice(0, 600)) } : {}) }
    }
    // Nothing supplied by a model/caller is an authority or control acknowledgement.
    const candidates = Array.isArray(data?.candidates) ? data.candidates.slice(0, 20).map(candidate).filter(Boolean) : []
    return json({ ok: true, data: { status: ['located', 'clarify', 'no_match', 'blocked'].includes(data?.status) ? data.status : 'blocked',
      ...(validHash(data?.revision) ? { revision: data.revision } : {}), controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED',
      ...(typeof data?.code === 'string' && /^[a-z_]{1,80}$/.test(data.code) ? { code: data.code } : {}), ...(data?.coverage === 'partial' || data?.coverage === 'complete' ? { coverage: data.coverage } : {}),
      ...(Number.isSafeInteger(data?.searched) ? { searched: data.searched } : {}), ...(Number.isSafeInteger(data?.candidateTotal) ? { candidateTotal: data.candidateTotal } : {}),
      candidates, ...(data?.status === 'located' && candidate(data.target) ? { target: candidate(data.target) } : {}) } })
  })
  route('/config-mutation', async request => {
    const parsed = await body(request, ['action', 'epoch', 'requestId', 'kind', 'payload']); if (parsed.error) return parsed.error
    const { action, ...input } = parsed.value!
    const shape = action === 'status' ? only(input, ['epoch', 'requestId']) : action === 'close' && only(input, ['epoch', 'requestId', 'kind', 'payload']) && String(input.kind) === 'stage-save' && isObject(input.payload)
    if (!shape || !validWorkId(input.epoch) || !validWorkId(input.requestId)) return fail('invalid_input', 'Configuration receipt fields are invalid', 400)
    if (!ports.configMutation) return fail('config_mutation_unavailable', 'Configuration receipt service is unavailable', 503)
    const result = await ports.configMutation({ action, ...input }) as any
    // The service owns this metadata/result contract; no request payload or raw errors are echoed.
    const m = result?.mutation
    if (!isObject(m) || m.version !== 1 || !validHash(m.digest) || !['recorded', 'settled', 'rejected', 'closed'].includes(String(m.state)) || m.epoch !== input.epoch || m.requestId !== input.requestId) return fail('config_mutation_record_invalid', 'Configuration receipt is invalid', 503)
    const mutation = Object.fromEntries(['version', 'epoch', 'requestId', 'kind', 'digest', 'state', 'at', 'updatedAt', 'code'].filter(key => m[key] !== undefined).map(key => [key, m[key]]))
    const allowed = new Set(['config', 'configVersion', 'revision', 'default', 'stages', 'locate', 'understand', 'plan', 'execute', 'summarize', 'verify', 'mode', 'selection', 'provider', 'model', 'reasoningEffort', 'existingSessionModelPolicy', 'existingSessionOverride', 'state', 'code', 'snapshot', 'stage', 'configured', 'requirements', 'capabilityProof', 'vision', 'tools', 'structured', 'contextWindow', 'minContextTokens', 'modelInfoEvidence', 'hostEvidence', 'reasoningEfforts', 'defaultEffort', 'inputModalities', 'defaultMaxTokens', 'id', 'name', 'rootId', 'relativePath', 'kind', 'csv', 'idColumn', 'sourceId', 'configRevision', 'snapshotId', 'reason', 'freshness', 'epoch', 'removed', 'changes', 'added', 'changed', 'imagesChanged', 'items', 'itemId', 'location', 'row', 'rowId', 'draftId', 'images', 'reference', 'digest', 'mediaType', 'size', 'imageSeen', 'fileId', 'sheetId', 'range', 'titleColumn', 'textColumns', 'remoteRevision', 'authorization', 'strike', 'eligible', 'title', 'text'])
    const safeValue = (value: any, depth = 0): any => {
      if (depth > 10) return null
      if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value.slice(0, 1000).map(item => safeValue(item, depth + 1))
      return isObject(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)).map(([key, item]) => [key, safeValue(item, depth + 1)])) : null
    }
    return json({ ok: true, data: { mutation, ...(m.state === 'settled' ? { value: safeValue(result.value) } : {}) } })
  })
  route('/session-decision', async request => {
    const parsed = await body(request, ['action', 'epoch', 'target', 'requestId', 'actionId', 'callId', 'snapshot', 'answers'], 80 * 1024); if (parsed.error) return parsed.error
    const { action, ...input } = parsed.value!
    const shape = action === 'prepare' || action === 'close' ? validSessionDecision(input)
      : action === 'list' ? only(input, ['epoch', 'target']) && isObject(input.target) && only(input.target, ['sessionId', 'scopeRevision', 'factRevision']) && validWorkId(input.target.sessionId) && validHash(input.target.scopeRevision) && validHash(input.target.factRevision)
      : action === 'status' && only(input, ['epoch', 'actionId']) && validWorkId(input.actionId)
    if (!shape || !validWorkId(input.epoch)) return fail('invalid_input', 'Decision fields are invalid', 400)
    if (!ports.sessionDecision) return fail('session_decision_unavailable', 'Decision service is unavailable', 503)
    const result = await ports.sessionDecision({ action, ...input })
    const keys = new Set(['version', 'epoch', 'requestId', 'actionId', 'target', 'sessionId', 'scopeRevision', 'factRevision', 'project', 'kind', 'key', 'callId', 'snapshot', 'asOfSeq', 'revision', 'digest', 'answerSummary', 'questions', 'selections', 'customBytes', 'skipped', 'seq', 'at', 'updatedAt', 'state', 'code', 'controlRevision', 'grantRevision', 'durable', 'accepted', 'executed', 'completed', 'approval', 'disposition', 'availability', 'complete', 'snapshotRevision', 'calls', 'canAnswer', 'id', 'question', 'detail', 'header', 'options', 'label', 'description', 'multiSelect', 'bindingVerified'])
    const minimal = (value: any, depth = 0): any => {
      if (depth > 10) return null
      if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value.slice(0, 64).map(item => minimal(item, depth + 1))
      return isObject(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)).map(([key, item]) => [key, minimal(item, depth + 1)])) : null
    }
    return json({ ok: true, data: minimal(result) })
  })
  route('/stage-models', async request => {
    const parsed = await body(request, ['action', 'epoch', 'requestId', 'config', 'provider', 'model']); if (parsed.error) return parsed.error
    const input = parsed.value!
    const selectionId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)
    const shape = input.action === 'settings' ? only(input, ['action', 'epoch']) : input.action === 'save' ? only(input, ['action', 'epoch', 'requestId', 'config']) && validWorkId(input.requestId) && isObject(input.config) : input.action === 'inspect' && only(input, ['action', 'epoch', 'provider', 'model']) && selectionId(input.provider) && selectionId(input.model)
    if (!validWorkId(input.epoch) || !shape) return fail('invalid_input', 'Stage model fields are invalid', 400)
    if (!ports.stageModels) return fail('stage_models_unavailable', 'Stage model service is unavailable', 503)
    const result = await ports.stageModels(input)
    // Only model configuration/capability metadata; the runtime exposes no call operation.
    const keys = new Set(['mutation', 'value', 'version', 'epoch', 'requestId', 'kind', 'digest', 'at', 'updatedAt', 'config', 'configVersion', 'revision', 'default', 'stages', 'locate', 'understand', 'plan', 'execute', 'summarize', 'verify', 'mode', 'selection', 'provider', 'model', 'reasoningEffort', 'existingSessionModelPolicy', 'existingSessionOverride', 'catalog', 'id', 'name', 'models', 'reasoningEfforts', 'defaultEffort', 'inputModalities', 'defaultMaxTokens', 'state', 'code', 'snapshot', 'stage', 'configured', 'requirements', 'capabilityProof', 'vision', 'tools', 'structured', 'contextWindow', 'minContextTokens', 'modelInfoEvidence', 'hostEvidence'])
    const metadata = (value: any, depth = 0): any => {
      if (depth > 10) return null
      if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
      if (typeof value === 'string') return value.slice(0, 512)
      if (Array.isArray(value)) return value.slice(0, 200).map(item => metadata(item, depth + 1))
      return isObject(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)).map(([key, item]) => [key, metadata(item, depth + 1)])) : null
    }
    return json({ ok: true, data: metadata(result) })
  })
  route('/images', async request => {
    const parsed = await body(request, ['action', 'epoch', 'draftId', 'uploadId', 'digest', 'mediaType', 'encoded', 'reference', 'target'], 12 * 1024 * 1024); if (parsed.error) return parsed.error
    const input = parsed.value!, ref = input.reference
    const validRef = isObject(ref) && only(ref, ['imageId', 'digest', 'seq']) && validWorkId(ref.imageId) && validHash(ref.digest) && Number.isSafeInteger(ref.seq) && Number(ref.seq) > 0
    const shape = input.action === 'upload' ? only(input, ['action', 'epoch', 'draftId', 'uploadId', 'digest', 'mediaType', 'encoded']) && validWorkId(input.draftId) && validWorkId(input.uploadId) && validHash(input.digest) && input.mediaType === 'image/png' && typeof input.encoded === 'string'
      : input.action === 'list' ? only(input, ['action', 'epoch', 'draftId']) && validWorkId(input.draftId)
      : input.action === 'bind' ? only(input, ['action', 'epoch', 'reference', 'target']) && validRef && isObject(input.target) && only(input.target, ['sessionId', 'scopeRevision', 'factRevision']) && validWorkId(input.target.sessionId) && validHash(input.target.scopeRevision) && validHash(input.target.factRevision)
      : ['original', 'release'].includes(String(input.action)) && only(input, ['action', 'epoch', 'reference']) && validRef
    if (!shape || !validWorkId(input.epoch)) return fail('invalid_input', 'Image request fields are invalid', 400)
    if (!ports.images) return fail('image_unavailable', 'Image service is unavailable', 503)
    const result = await ports.images(input) as any
    if (input.action === 'original') {
      if (!result || !Buffer.isBuffer(result.bytes) || result.bytes.length > 8 * 1024 * 1024 || result.mediaType !== 'image/png' || !validRaster(result.bytes, result.mediaType) || createHash('sha256').update(result.bytes).digest('hex') !== (isObject(ref) ? ref.digest : undefined)) return fail('image_original_invalid', 'Original image is unavailable', 503)
      return json({ ok: true, data: { mediaType: result.mediaType, digest: isObject(ref) ? ref.digest : null, encoded: result.bytes.toString('base64') } })
    }
    const image = (value: any) => {
      const output: Record<string, unknown> = {}
      for (const key of ['imageId', 'uploadId', 'draftId', 'epoch']) if (validWorkId(value?.[key])) output[key] = value[key]
      for (const key of ['digest', 'scopeRevision']) if (validHash(value?.[key])) output[key] = value[key]
      for (const key of ['seq', 'at', 'width', 'height', 'size']) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) output[key] = value[key]
      if (value?.mediaType === 'image/png') output.mediaType = value.mediaType
      if (['staged', 'bound', 'released'].includes(value?.state)) output.state = value.state
      for (const key of ['original', 'uploadedNotSent', 'stale', 'bytesRetained', 'thirdPartyErasureGuaranteed']) if (typeof value?.[key] === 'boolean') output[key] = value[key]
      const target = value?.target
      if (isObject(target) && validWorkId(target.sessionId) && validHash(target.scopeRevision) && validHash(target.factRevision) && isObject(target.project) && ['project', 'unassigned'].includes(String(target.project.kind)) && validWorkId(target.project.key)) output.target = { sessionId: target.sessionId, scopeRevision: target.scopeRevision, factRevision: target.factRevision, project: { kind: target.project.kind, key: target.project.key } }
      return output
    }
    return json({ ok: true, data: input.action === 'list' ? { ...(validHash(result?.scopeRevision) ? { scopeRevision: result.scopeRevision } : {}), items: Array.isArray(result?.items) ? result.items.slice(0, 5).map(image) : [], capability: { upload: 'png-8bit-noninterlaced', originalUnderstanding: false, targetDelivery: false, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } } : image(result) })
  })
  route('/session-action', async request => {
    const parsed = await body(request, ['action', 'epoch', 'requestId', 'actionId', 'operation', 'text', 'target']); if (parsed.error) return parsed.error
    const { action, ...input } = parsed.value!
    if (action === 'prepare' || action === 'close' ? !validSessionAction(input) : action !== 'status' || !only(input, ['epoch', 'actionId']) || !validWorkId(input.epoch) || typeof input.actionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actionId)) return fail('invalid_input', 'Session action fields are invalid', 400)
    if (!ports.sessionAction) return fail('session_action_unavailable', 'Session action service is unavailable', 503)
    const data = await ports.sessionAction(action === 'prepare' || action === 'close' ? { action, input } : { action, ...input }) as any
    // Metadata-only receipt. No raw text, arbitrary target object, authority, or model output.
    const output: Record<string, unknown> = { accepted: data?.state === 'accepted' && data?.accepted === true, executed: ['recorded', 'blocked'].includes(data?.state) ? false : null, completed: ['recorded', 'blocked'].includes(data?.state) ? false : null }
    if (data?.version === 1) output.version = 1
    for (const field of ['epoch', 'requestId', 'actionId', 'messageId']) if (validWorkId(data?.[field])) output[field] = data[field]
    for (const field of ['digest', 'controlRevision', 'grantRevision']) if (validHash(data?.[field])) output[field] = data[field]
    for (const field of ['seq', 'at', 'updatedAt']) if (Number.isSafeInteger(data?.[field]) && data[field] >= 0) output[field] = data[field]
    if (['recorded', 'blocked', 'dispatch_unknown', 'accepted', 'closed'].includes(data?.state)) output.state = data.state
    if (['continue', 'supplement', 'steer'].includes(data?.operation)) output.operation = data.operation
    if (typeof data?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(data.code)) output.code = data.code
    output.durable = data?.durable === true
    if (['not-dispatched', 'reconcile-only', 'target-durable-receipt', 'closed-before-dispatch'].includes(data?.disposition)) output.disposition = data.disposition
    const target = data?.target
    if (data?.state === 'closed' && data?.bindingVerified === false && isObject(target) && only(target, ['sessionId', 'scopeRevision', 'factRevision']) && validWorkId(target.sessionId) && validHash(target.scopeRevision) && validHash(target.factRevision)) {
      output.target = { sessionId: target.sessionId, scopeRevision: target.scopeRevision, factRevision: target.factRevision }; output.bindingVerified = false
    }
    if (data?.state !== 'closed' && isObject(target) && validWorkId(target.sessionId) && validHash(target.scopeRevision) && validHash(target.factRevision) && isObject(target.project) && ['project', 'unassigned'].includes(String(target.project.kind)) && validWorkId(target.project.key)) output.target = { sessionId: target.sessionId, scopeRevision: target.scopeRevision, factRevision: target.factRevision, project: { kind: target.project.kind, key: target.project.key } }
    return json({ ok: true, data: output })
  })
  route('/delivery', async request => {
    const parsed = await body(request, ['action', 'epoch', 'requestId', 'confirmationId', 'operation', 'text', 'target', 'images']); if (parsed.error) return parsed.error
    const input = parsed.value!
    const targetShape = isObject(input.target) && only(input.target, ['sessionId', 'scopeRevision', 'factRevision']) && validWorkId(input.target.sessionId) && validHash(input.target.scopeRevision) && validHash(input.target.factRevision)
    const imagesShape = input.images === undefined || Array.isArray(input.images) && input.images.length <= 5
      && input.images.every(item => isObject(item) && only(item, ['imageId', 'digest', 'seq']) && validWorkId(item.imageId) && validHash(item.digest) && Number.isSafeInteger(item.seq) && Number(item.seq) > 0)
      && new Set(input.images.map(item => item.imageId)).size === input.images.length
    const shape = input.action === 'prepare' || input.action === 'confirm'
      ? only(input, ['action', 'epoch', 'requestId', 'confirmationId', 'operation', 'text', 'target', 'images']) && validWorkId(input.requestId) && validWorkId(input.confirmationId)
        && ['continue', 'supplement', 'steer'].includes(String(input.operation)) && typeof input.text === 'string' && Boolean(input.text.trim()) && !input.text.includes('\0') && Buffer.byteLength(input.text, 'utf8') <= 16_384
        && targetShape && imagesShape
      : input.action === 'status' || input.action === 'cancel' ? only(input, ['action', 'epoch', 'confirmationId']) && validWorkId(input.confirmationId) : false
    if (!shape || !validWorkId(input.epoch)) return fail('invalid_input', 'Delivery request fields are invalid', 400)
    if (!ports.delivery) return fail('delivery_unavailable', 'Delivery service is unavailable', 503)
    const payload = input.action === 'prepare' || input.action === 'confirm'
      ? { requestId: input.requestId, confirmationId: input.confirmationId, operation: input.operation, text: input.text, target: input.target, images: input.images ?? [] }
      : { confirmationId: input.confirmationId }
    const data = await ports.delivery({ action: input.action, epoch: input.epoch, ...payload }) as any
    // Confirmation summary only. Raw body, caller payload, authority and dispatch claims never pass through.
    const output: Record<string, unknown> = {}
    if (data?.version === 1) output.version = 1
    for (const field of ['epoch', 'requestId', 'confirmationId']) if (validWorkId(data?.[field])) output[field] = data[field]
    if (['continue', 'supplement', 'steer'].includes(data?.operation)) output.operation = data.operation
    if (validHash(data?.digest)) output.digest = data.digest
    for (const field of ['seq', 'at', 'updatedAt', 'bodyBytes']) if (Number.isSafeInteger(data?.[field]) && data[field] >= 0) output[field] = data[field]
    if (['prepared', 'confirmed', 'canceled'].includes(data?.state)) output.state = data.state
    // A confirmed record is a human acceptance only; it is not target acceptance, execution or completion.
    output.humanConfirmed = data?.state === 'confirmed'
    output.delivered = false
    output.accepted = false
    output.executed = false
    output.completed = false
    if (['not-confirmed', 'confirmed-pending-delivery', 'canceled'].includes(data?.disposition)) output.disposition = data.disposition
    if (typeof data?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(data.code)) output.code = data.code
    output.durable = data?.durable === true
    const target = data?.target
    if (isObject(target) && validWorkId(target.sessionId) && validHash(target.scopeRevision) && validHash(target.factRevision) && isObject(target.project) && ['project', 'unassigned'].includes(String(target.project.kind)) && validWorkId(target.project.key)) {
      output.target = { sessionId: target.sessionId, scopeRevision: target.scopeRevision, factRevision: target.factRevision, project: { kind: target.project.kind, key: target.project.key } }
    }
    if (Array.isArray(data?.images)) output.images = data.images.slice(0, 5).filter((item: any) => isObject(item) && validWorkId(item.imageId) && validHash(item.digest) && typeof item.seq === 'number' && Number.isSafeInteger(item.seq) && item.seq > 0).map((item: any) => ({ imageId: item.imageId, digest: item.digest, seq: item.seq }))
    return json({ ok: true, data: output })
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
