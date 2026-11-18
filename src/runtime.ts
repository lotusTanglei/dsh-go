import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from './config.js'
import type { Store, Row } from './store/index.js'
import { encodeJson, redact } from './store/codec.js'
import { createPolicy } from './domain/policy.js'
import { revalidate, grantMandate } from './domain/mandate.js'
import { assignmentId, ticketId, threadKey } from './domain/ids.js'
import { validateTicketBrief, type TicketBrief } from './domain/ticket.js'
import { SessionSource } from './sources/session.js'
import { SourceRegistry } from './sources/registry.js'
import { createEngine } from './engine/index.js'
import { startEval, settleEval } from './engine/eval.js'
import { startWorker, spawnerFromContext, type WorkerHandle } from './sessions/worker.js'
import { inspectReport, shouldRetryReport } from './engine/report.js'
import type { WorkerGuardSnapshot, RoleGuardRuntime } from './tools/runtime.js'
import { createWatchdog, type WatchdogAssignment } from './engine/watchdog.js'
import { sampleDeviation } from './sessions/watchdog.js'

/** Narrow Host adapter; DSH's live APIs remain at this boundary. */
export interface RuntimeContext {
  readonly agents: { get(id: string): any; create(input: any): Promise<any>; resume?(input: any): Promise<any> }
  readonly agentPresets: { mount(ctx: any, id: string): Promise<unknown>; composedPreset(ctx: any): string | undefined }
  readonly subagents: { startActivation(input: any): Promise<any>; interrupt?(id: string, cause: any): unknown }
  readonly sessionQuery: { readSession(id: string): Promise<any> }
  readonly effect: (factory: () => (() => void | Promise<void>)) => unknown
  readonly on: (event: string, callback: (...args: any[]) => any) => (() => void)
}
const message = (text: string) => ({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'superagent', form: 'notice', summary: 'Superagent runtime context' } })

/** Every tool execution obtains a fresh trusted DB snapshot, not model-supplied ids. */
export function readWorkerSnapshot(store: Store, sessionId: string): WorkerGuardSnapshot | undefined {
  const row = store.repos.assignment.all().find(row => row.session_id === sessionId)
  if (!row) return undefined
  const ticket = store.repos.ticket.get(row.ticket_id)
  if (!ticket) return undefined
  return { sessionId, binding: { assignmentId: row.id as any, ticketId: row.ticket_id as any }, ticket: { id: ticket.id as any, state: ticket.state as any, currentAssignment: ticket.current_assignment as any }, assignment: { id: row.id as any, ticketId: row.ticket_id as any, sessionId, state: row.state as any } }
}

export function createRuntime(ctx: RuntimeContext, store: Store, config: Config, roleGuard?: RoleGuardRuntime) {
  const policy = createPolicy({ acceptedSources: config.sources.map(row => row.id as any), acceptMode: config.acceptMode, confirm: config.confirm, bots: config.bots, paused: config.paused, evalTimeoutMs: config.evalTimeoutMs, budgets: { maxWorkers: config.maxWorkers, maxStepsPerTicket: config.maxStepsPerTicket, maxTokensPerTicket: config.maxTokensPerTicket, maxDurationMsPerTicket: config.maxDurationMsPerTicket, maxRetries: config.maxRetries, queueLimit: config.queueLimit, watchdog: { intervalMs: config.watchdogIntervalMs, stallMs: config.stallMs, repeatCallThreshold: config.repeatCallThreshold } } })
  const sources = new SourceRegistry()
  const workers = new Map<string, WorkerHandle>()
  const ownedHandles: any[] = []
  const tasks = new Set<Promise<unknown>>()
  const controller = new AbortController()
  let mainId: string | undefined
  let disposed = false
  let initialization: 'starting' | 'ready' | 'failed' = 'starting'
  let heartbeat: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const audit = (action: string, detail: unknown, ticket?: string) => store.repos.audit.insert({ at: Date.now(), actor: 'superagent', action, ticket_id: ticket ?? null, thread_key: null, detail })
  const track = (task: Promise<unknown>) => { tasks.add(task); void task.catch(() => { if (!disposed) audit('runtime_error', { code: 'SA_RUNTIME_FAILURE' }) }).finally(() => tasks.delete(task)) }
  const sendRouter = async (text: string, wake = false, id?: string) => { if (!mainId) throw new Error('runtime: Router not ready'); const agent = ctx.agents.get(mainId); if (!agent) throw new Error('runtime: Router missing'); const value = { ...message(text), ...(id ? { id } : {}) }; await (wake ? agent.followup(value) : agent.inject(value)) }
  const engine = createEngine(store, { policy, queueLimit: config.queueLimit, maxEvalRequeues: config.maxEvalRequeues, outbox: { maxRetries: config.outboxMaxAttempts, backoffMs: config.outboxBackoffMs, backoffMaxMs: config.outboxBackoffMaxMs, onDropped: row => audit('outbox_dropped', { id: row.id }) } }, {
    liveSessionIds: () => new Set(store.repos.assignment.all().map(row => String(row.session_id)).filter(id => ctx.agents.get(id))),
    sender: { async send(row) { const thread = store.repos.thread.get(row.threadKey); const source = thread ? sources.get(thread.source as any) : undefined; if (!source) throw new Error('source unavailable'); await source.reply(row.channel, row.threadKey, row.body, row.idempotencyKey) } },
  })
  const spawner = spawnerFromContext({ subagents: ctx.subagents, agents: ctx.agents, superagentRoleGuard: roleGuard })
  const assignmentFor = (sessionId: string) => store.repos.assignment.all().find(row => row.session_id === sessionId)
  const ticketFor = (id: string) => { const row = store.repos.ticket.get(id); if (!row) throw new Error('ticket not found'); return row }
  const mandateValid = (ticket: Row) => {
    try { return revalidate(ticket.mandate_json as any, policy).valid } catch { return false }
  }
  const idOf = (row: Row) => String(row.id)
  const approvalsReady = (id: string) => store.repos.approval.all().filter(row => String(row.ticket_id) === id).every(row => row.state === 'approved')
  const hasSubscription = (ticket: Row) => Boolean(store.db.prepare('SELECT 1 FROM thread_subscription WHERE thread_key = ? AND ticket_id = ?').get(String(ticket.thread_key), idOf(ticket)))
  const safeDetail = (value: unknown, depth = 0): unknown => {
    if (depth > 4) return '[REDACTED]'
    if (Array.isArray(value)) return value.slice(0, 50).map(item => safeDetail(item, depth + 1))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
        if (/raw|secret|token|password|credential|authorization|payload|path|url/i.test(key)) continue
        out[key] = safeDetail(item, depth + 1)
      }
      return out
    }
    return typeof value === 'string' ? String(redact(value)).slice(0, 500) : value
  }
  async function deliverReport(id: string, assignmentId: string, report: unknown) {
    const key = `superagent-report:${assignmentId}`
    const snapshot = await ctx.sessionQuery.readSession(mainId!)
    if (!snapshot.events?.some((event: any) => event.data?.id === key || event.data?.inserted?.some((item: any) => item.id === key))) await sendRouter(JSON.stringify({ ticketId: id, assignmentId, report }), false, key)
    audit('report_delivery_completed', { assignmentId }, id)
  }
  async function stopTicket(id: string, reason: string, by: 'human' | 'watchdog' = 'human') {
    const ticket = ticketFor(id)
    if (ticket.state === 'ended') return false
    store.transaction(() => {
      store.repos.ticket.updateByState(id, String(ticket.state), 'ended', { stopped_by_human: by === 'human', ended_at: Date.now(), ended_by: by, outcome: 'stopped', current_assignment: null, updated_at: Date.now() })
      if (ticket.current_assignment) store.repos.assignment.updateByState(ticket.current_assignment, 'running', 'ended', { ended_at: Date.now(), ended_reason: reason })
      audit('ticket_stop', { reason, by }, id)
    })
    if (ticket.current_assignment) {
      const assignment = store.repos.assignment.get(ticket.current_assignment)
      if (assignment) ctx.subagents.interrupt?.(String(assignment.session_id), { kind: 'user' })
      await workers.get(String(ticket.current_assignment))?.dispose()
      workers.delete(String(ticket.current_assignment))
    }
    return true
  }
  async function startAssignment(id: string) {
    if (disposed || engine.paused()) return { ok: false, code: 'SA_PAUSED' }
    const ticket = ticketFor(id)
    if (ticket.state !== 'open') return { ok: false, code: 'SA_TICKET_NOT_OPEN' }
    if (!mandateValid(ticket) || !hasSubscription(ticket) || !approvalsReady(id)) return { ok: false, code: 'SA_TICKET_NOT_ELIGIBLE' }
    if (store.repos.assignment.all().filter(row => row.state === 'running').length >= config.maxWorkers) {
      if (!store.repos.audit.all().some(row => row.action === 'assignment_queued' && row.ticket_id === id)) audit('assignment_queued', { reason: 'capacity' }, id)
      return { ok: true, code: 'SA_QUEUED' }
    }
    const attempts = store.repos.assignment.all().filter(row => row.ticket_id === id).length
    if (attempts > config.maxRetries) {
      store.repos.ticket.updateByState(id, 'open', 'ended', { ended_at: Date.now(), ended_by: 'executor', outcome: 'failed', updated_at: Date.now() })
      audit('retry_budget_exhausted', { attempts }, id)
      return { ok: false, code: 'SA_RETRY_BUDGET_EXHAUSTED' }
    }
    const assignment = { id: assignmentId(randomUUID()), ticketId: ticketId(id), sessionId: randomUUID() }
    store.transaction(() => {
      store.repos.assignment.insert({ id: assignment.id, ticket_id: id, session_id: assignment.sessionId, state: 'running', created_at: Date.now(), started_at: Date.now(), last_progress_at: Date.now(), steps: 0, tokens: 0, retries: attempts, repeated_calls: 0 })
      if (!store.repos.ticket.updateByState(id, 'open', 'running', { current_assignment: assignment.id, updated_at: Date.now() })) throw new Error('ticket start conflict')
    })
    try {
      mkdirSync(String(ticket.workdir), { recursive: true })
      const correction = store.repos.audit.all().filter(row => row.ticket_id === id && row.action === 'report_correction_requested').at(-1)?.detail as { errors?: string[] } | undefined
      // A cold Router may have a pending selection but no request/header yet.
      // Spawn's historical-header fallback cannot inherit that selection by itself.
      const parent = ctx.agents.get(mainId!)
      const selection = parent?.model?.current?.()
      const worker = await startWorker({ ...(selection ? { agentOptions: { ...selection, reasoningEffort: selection.reasoningEffort } } : {}), ticket: { id: ticketId(id), title: String(ticket.title), brief: ticket.brief_json as TicketBrief, workdir: String(ticket.workdir) }, assignment, brief: ticket.brief_json as TicketBrief, workdir: String(ticket.workdir), preset: 'dsh-superagent-worker', parent: ctx.agents.get(mainId!), signal: controller.signal, ...(correction ? { correction: `One correction attempt: submit a complete structured_output report for every acceptance criterion. Fix: ${(correction.errors ?? []).join('; ')}` } : {}) }, spawner)
      workers.set(assignment.id, worker)
      await deliverPending(id)
      track((async () => {
        try {
          const result = await worker.result
          const current = ticketFor(id)
          if (current.current_assignment !== assignment.id || current.state === 'ended' || store.repos.assignment.get(assignment.id)?.state !== 'running') return
          if (disposed) return
          const checked = inspectReport(result.structured, ticket.brief_json as TicketBrief)
          const correctionCount = store.repos.audit.all().filter(row => row.ticket_id === id && row.action === 'report_correction_requested').length
          if (current.state === 'running' && attempts < config.maxRetries && shouldRetryReport(result.structured, ticket.brief_json as TicketBrief, correctionCount)) {
            store.transaction(() => {
              store.repos.assignment.updateByState(assignment.id, 'running', 'ended', { ended_at: Date.now(), ended_reason: 'report-correction', report_json: result.structured ?? null })
              store.repos.ticket.updateByState(id, 'running', 'open', { current_assignment: null, updated_at: Date.now() })
              audit('report_correction_requested', { assignmentId: assignment.id, errors: checked.valid ? ['ready report contains failed acceptance criteria'] : checked.errors }, id)
            })
            return
          }
          if (!checked.valid || (result.structured as any)?.state === 'progress') {
            store.transaction(() => {
              audit('report_rejected', { assignmentId: assignment.id, errors: checked.errors }, id)
              store.repos.assignment.updateByState(assignment.id, 'running', 'ended', { ended_at: Date.now(), ended_reason: 'invalid-report' })
              store.repos.ticket.updateByState(id, String(current.state), current.state === 'waiting_human' ? 'waiting_human' : 'ended', { ...(current.state === 'waiting_human' ? {} : { ended_at: Date.now(), ended_by: 'executor', outcome: 'failed' }), current_assignment: null, updated_at: Date.now() })
            })
            return
          }
          const report = result.structured as any
          store.transaction(() => {
            store.repos.assignment.updateByState(assignment.id, 'running', 'ended', { ended_at: Date.now(), ended_reason: report.state, report_json: report })
            const waiting = current.state === 'waiting_human' || report.needHuman.length > 0 || report.state === 'blocked'
            store.repos.ticket.updateByState(id, String(current.state), waiting ? 'waiting_human' : 'ended', { current_assignment: null, updated_at: Date.now(), ...(waiting ? { attention_json: { question: report.needHuman.join('\n'), at: Date.now() } } : { ended_at: Date.now(), ended_by: 'executor', outcome: report.state === 'ready' && report.acceptance.every((row: any) => row.result === 'passed') ? 'completed' : 'failed' }) })
          })
          await deliverReport(id, assignment.id, report)
        } catch {
          store.transaction(() => {
            const current = ticketFor(id)
            store.repos.assignment.updateByState(assignment.id, 'running', 'ended', { ended_at: Date.now(), ended_reason: 'result-failed' })
            if (current.current_assignment === assignment.id) store.repos.ticket.updateByState(id, String(current.state), 'ended', { ended_at: Date.now(), ended_by: 'executor', outcome: 'failed', current_assignment: null, updated_at: Date.now() })
            audit('worker_result_failed', { assignmentId: assignment.id }, id)
          })
        } finally { await worker.dispose(); workers.delete(assignment.id) }
      })())
      return { ok: true, code: 'SA_STARTED', assignmentId: assignment.id }
    } catch (error) {
      store.transaction(() => {
        store.repos.assignment.updateByState(assignment.id, 'running', 'ended', { ended_at: Date.now(), ended_reason: 'spawn-failed' })
        store.repos.ticket.updateByState(id, 'running', 'ended', { ended_at: Date.now(), ended_by: 'executor', outcome: 'failed', current_assignment: null, updated_at: Date.now() })
      })
      throw error
    }
  }
  const deliveries = new Map<string, Promise<void>>()
  async function deliverPending(id: string): Promise<void> {
    const previous = deliveries.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(() => deliverOrdered(id))
    deliveries.set(id, task)
    try { await task } finally { if (deliveries.get(id) === task) deliveries.delete(id) }
  }
  async function deliverOrdered(id: string) {
    const ticket = ticketFor(id)
    if (!ticket.current_assignment || ticket.state === 'waiting_human') return
    const assignment = store.repos.assignment.get(ticket.current_assignment)
    const agent = assignment?.state === 'running' ? ctx.agents.get(String(assignment.session_id)) : undefined
    if (!agent) return
    const pending = store.repos.thread_trigger.all().filter(row => row.thread_key === ticket.thread_key && row.state === 'pending').sort((a, b) => Number(a.seq) - Number(b.seq))
    for (const item of pending) {
      const current = ticketFor(id)
      if (current.state !== 'running' || current.current_assignment !== assignment!.id) return
      const trigger = store.repos.trigger.get(item.trigger_id)
      if (!trigger) continue
      store.db.prepare('UPDATE trigger_disposition SET ticket_id = ? WHERE trigger_id = ? AND ticket_id IS NULL').run(id, String(trigger.id))
      const disposition = store.repos.trigger_disposition.get(trigger.id)
      if (disposition?.ticket_id !== id || disposition.delivered_to) continue
      const snapshot = await ctx.sessionQuery.readSession(String(assignment!.session_id))
      const seen = snapshot.events?.some((event: any) => event.data?.id === trigger.id || event.data?.inserted?.some((entry: any) => entry.id === trigger.id))
      if (!seen) await agent.steer({ ...message(String(trigger.text)), id: String(trigger.id) })
      engine.ackDelivery(trigger.id as any, assignment!.id as any)
    }
  }
  async function releaseApproval(id: string, approvalId: string, approved: boolean) {
    if (disposed || !approved) return
    const ticket = ticketFor(id)
    if (!mandateValid(ticket) || !hasSubscription(ticket) || !approvalsReady(id) || ticket.state === 'ended') return
    const approvals = store.repos.approval.all().filter(row => row.ticket_id === id)
    if (!approvals.length || !approvals.some(row => row.id === approvalId && row.state === 'approved')) return
    const assignment = ticket.current_assignment ? store.repos.assignment.get(ticket.current_assignment) : undefined
    const active = assignment?.state === 'running' && ctx.agents.get(String(assignment.session_id))
    if (ticket.state === 'waiting_human') store.repos.ticket.updateByState(id, 'waiting_human', active ? 'running' : 'open', { attention_json: null, current_assignment: active ? assignment!.id : null, updated_at: Date.now() })
    if (active) {
      const key = `superagent-approval:${approvalId}`
      const snapshot = await ctx.sessionQuery.readSession(String(assignment!.session_id))
      if (!snapshot.events?.some((event: any) => event.data?.id === key || event.data?.inserted?.some((item: any) => item.id === key))) await active.steer({ ...message('All linked approvals were approved by the human owner. Continue within the existing Ticket scope.'), id: key })
      await deliverPending(id)
    }
    audit('approval_delivery_completed', { approvalId }, id)
  }
  let pumping = false
  async function pump() {
    if (disposed || engine.paused() || pumping) return
    pumping = true
    try {
      for (const approval of store.repos.approval.all().filter(row => row.state === 'approved' && row.ticket_id && !store.repos.audit.all().some(audit => audit.action === 'approval_delivery_completed' && (audit.detail as any)?.approvalId === row.id))) await releaseApproval(String(approval.ticket_id), String(approval.id), true)
      for (const ticket of store.repos.ticket.all().filter(row => row.state === 'open').sort((a, b) => Number(a.created_at) - Number(b.created_at))) {
        if (store.repos.assignment.all().filter(row => row.state === 'running').length >= config.maxWorkers) break
        await startAssignment(String(ticket.id))
      }
      for (const ticket of store.repos.ticket.all().filter(row => row.state === 'running')) await deliverPending(String(ticket.id))
      for (const assignment of store.repos.assignment.all().filter(row => row.state === 'ended' && ['ready', 'blocked', 'failed'].includes(String(row.ended_reason)) && row.report_json && !store.repos.audit.all().some(audit => audit.action === 'report_delivery_completed' && (audit.detail as any)?.assignmentId === row.id))) await deliverReport(String(assignment.ticket_id), String(assignment.id), assignment.report_json)
      await engine.drainOutbox()
      await watchdog.tick()
      heartbeat = Date.now()
    } finally { pumping = false }
  }
  const watchdog = createWatchdog({
    sessionQuery: ctx.sessionQuery,
    async assignments() {
      return store.repos.assignment.all().filter(row => {
        const ticket = store.repos.ticket.get(row.ticket_id)
        const latest = (store.repos.audit.all().filter(audit => audit.action === 'watchdog' && (audit.detail as any)?.assignmentId === row.id && (audit.detail as any)?.outcome === 'completed').at(-1)?.detail as any)?.state
        return row.state === 'running' || latest?.budgetStage === 2 || latest?.stallStage === 2 || ticket?.state === 'waiting_human' && store.repos.assignment.all().filter(item => item.ticket_id === row.ticket_id).at(-1)?.id === row.id
      }).map(row => {
        const ticket = store.repos.ticket.get(row.ticket_id)
        return { assignmentId: String(row.id), ticketId: String(row.ticket_id), sessionId: String(row.session_id), state: row.state, startedAt: Number(row.started_at ?? row.created_at), lastProgressAt: Number(row.last_progress_at), steps: Number(row.steps), tokens: Number(row.tokens), briefGoal: (ticket?.brief_json as any)?.goal ?? '', ...(ticket?.state === 'waiting_human' ? { waitingSince: Number((ticket.attention_json as any)?.at ?? ticket.updated_at) } : {}) } as WatchdogAssignment
      })
    },
    state(id) { return (store.repos.audit.all().filter(row => row.action === 'watchdog' && (row.detail as any)?.assignmentId === id && (row.detail as any)?.outcome === 'completed').at(-1)?.detail as any)?.state },
    async deviation(assignment, metrics) {
      if (disposed) return
      const ticket = ticketFor(assignment.ticketId)
      audit('watchdog.sample_requested', { assignmentId: assignment.assignmentId, metrics }, assignment.ticketId)
      try {
        const correction = await sampleDeviation({ goal: String(redact(assignment.briefGoal)), summary: safeDetail({ report: store.repos.assignment.get(assignment.assignmentId)?.report_json, metrics }), cwd: String(ticket.workdir), parent: ctx.agents.get(mainId!), signal: controller.signal, timeoutMs: Math.min(config.evalTimeoutMs, 60000) }, ctx.subagents)
        audit('watchdog.sample_completed', { assignmentId: assignment.assignmentId, metrics, deviated: Boolean(correction) }, assignment.ticketId)
        return correction ? String(redact(correction)) : undefined
      } catch { audit('watchdog.sample_failed', { assignmentId: assignment.assignmentId, metrics }, assignment.ticketId); return undefined }
    },
    async nudge(id, text) { const agent = ctx.agents.get(id); if (!agent) throw new Error('Worker not live'); await agent.steer(message(text)) }, async steer(id, text) { const agent = ctx.agents.get(id); if (!agent) throw new Error('Worker not live'); await agent.steer(message(text)) },
    async cancel(assignment, reason) { await stopTicket(assignment.ticketId, reason, 'watchdog') },
    async escalate(assignment, text) {
      engine.enqueue({ channel: 'session', threadKey: threadKey(`session:${mainId}`), ticketId: ticketId(assignment.ticketId), kind: 'notice', body: `${assignment.ticketId}: ${text}`, idempotencyKey: `watchdog:${assignment.assignmentId}:${text}` })
      await engine.drainOutbox()
    },
    audit(record) { audit('watchdog', record, record.ticketId); heartbeat = record.metrics.at },
  }, { stallMs: config.stallMs, repeatCallThreshold: config.repeatCallThreshold, waitingHumanMs: config.waitingHumanMs, maxSteps: config.maxStepsPerTicket, maxTokens: config.maxTokensPerTicket, maxDurationMs: config.maxDurationMsPerTicket, deviationIntervalMs: config.watchdogIntervalMs * 10 })

  const ready = Promise.resolve().then(async () => {
    mkdirSync(config.workRoot, { recursive: true })
    const saved = store.repos.kv.get('mainSessionId')?.v
    const candidate = config.mainSessionId ?? (typeof saved === 'string' ? saved : undefined)
    const existing = candidate ? ctx.agents.get(candidate) : undefined
    if (existing) {
      if (ctx.agentPresets.composedPreset(existing.ctx) !== 'dsh-superagent-router') throw new Error('Configured Router has a different preset')
      mainId = candidate
    }
    else {
      const setup = async (scope: any): Promise<void> => { await ctx.agentPresets.mount(scope, 'dsh-superagent-router') }
      let handle: any
      if (candidate && ctx.agents.resume) {
        let persisted: any
        let missing = false
        try {
          persisted = await ctx.sessionQuery.readSession(candidate)
        } catch (error) {
          const code = (error as { code?: unknown })?.code
          if (config.mainSessionId || code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
          // A stale persisted binding is recoverable only when the query proves exact absence.
          missing = true
        }
        if (!missing) {
          if (!persisted || typeof persisted !== 'object' || !persisted.session || !Array.isArray(persisted.events)) throw new Error('Persisted Router snapshot is invalid')
          if (persisted.session?.agentPreset !== 'dsh-superagent-router') throw new Error('Persisted Router has a different preset')
          handle = await ctx.agents.resume({ resumeSessionId: candidate, setup })
        } else {
          handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: config.workRoot, agentPreset: 'dsh-superagent-router' }, setup })
          audit('main_session_recreated', { previousSessionId: candidate, newSessionId: handle.agent.id })
        }
      } else handle = await ctx.agents.create({ sessionId: candidate ?? randomUUID(), meta: { cwd: config.workRoot, agentPreset: 'dsh-superagent-router' }, setup })
      ownedHandles.push(handle); mainId = handle.agent.id
    }
    store.repos.kv.insertOrIgnore({ k: 'mainSessionId', v: mainId })
    store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(mainId, false), 'mainSessionId')
    if (disposed) return
    const source = new SessionSource(mainId!, {
      on: (name, callback) => ctx.on(name, callback),
      async reply(body, idemKey) {
        const agent = ctx.agents.get(mainId!)
        if (!agent) throw new Error('Router unavailable')
        const snapshot = await ctx.sessionQuery.readSession(mainId!)
        // The plugin-owned Chat Definition renders this durable splice immediately,
        // without waking a model. Sent means published to Chat, never human-read.
        if (snapshot.events.some((event: any) => event.type === 'user/message' && event.data?.id === idemKey || event.type === 'agent/inbox/spliced' && event.data?.inserted?.some((item: any) => item.id === idemKey && item.source?.kind === 'superagent-channel'))) return
        await agent.inject({ ...message(String(redact(body))), id: idemKey, source: { kind: 'superagent-channel', form: 'notice', summary: 'Superagent notification' } })
      },
      onError() { audit('source_error', { code: 'SA_SOURCE_FAILURE' }) },
    }, async trigger => {
      const result = engine.ingest(trigger)
      if (result.ticketId) {
        const ticket = ticketFor(String(result.ticketId))
        // Only this verified human event may release a question, never unresolved approvals.
        if (ticket.state === 'waiting_human' && approvalsReady(String(ticket.id)) && mandateValid(ticket)) {
          const assignment = ticket.current_assignment ? store.repos.assignment.get(ticket.current_assignment) : undefined
          store.repos.ticket.updateByState(ticket.id, 'waiting_human', assignment?.state === 'running' ? 'running' : 'open', { attention_json: null, updated_at: Date.now() })
          audit('human_reply_received', { triggerId: trigger.id }, String(ticket.id))
        }
        await deliverPending(String(result.ticketId))
      }
    })
    sources.register(source); await source.start()
    await engine.recover()
    if (!disposed) await pump()
    if (disposed) return
    timer = setInterval(() => {
      if (disposed) return
      track(pump())
    }, config.watchdogIntervalMs)
    timer.unref?.()
    // Runtime owns the timer; Host disposal awaits this runtime before closing SQLite.
    initialization = 'ready'
  }).catch(error => { initialization = 'failed'; throw error })

  return {
    ready, engine, sources, startAssignment, stopTicket,
    /** Same maintenance path as the timer, with no model wake or synthetic metrics. */
    async tick() { await ready; await pump() },
    diagnostics() {
      return {
        mainSessionId: mainId,
        triggers: store.repos.trigger.all().map(row => ({ id: String(row.id), externalId: String(row.external_id), threadKey: String(row.thread_key) })),
        tickets: store.repos.ticket.all().map(row => ({ id: String(row.id), state: String(row.state), outcome: row.outcome })),
        assignments: store.repos.assignment.all().map(row => ({ id: String(row.id), ticketId: String(row.ticket_id), sessionId: String(row.session_id), state: String(row.state), report: safeDetail(row.report_json) })),
        audit: store.repos.audit.all().map(row => ({ at: row.at, action: row.action, detail: safeDetail(row.detail) })),
        liveAgents: [mainId, ...store.repos.assignment.all().map(row => String(row.session_id))].filter(id => id && ctx.agents.get(id)).length,
      }
    },
    async invoke(name: string, args: any, exec: any) {
      await ready
      if (disposed) return { ok: false, code: 'SA_RUNTIME_STOPPED' }
      const sessionId = exec?.agent?.id
      const worker = sessionId ? assignmentFor(sessionId) : undefined
      const routerCommands = ['ticket_list', 'ticket_status', 'ticket_cancel', 'assignment_start', 'assignment_stop', 'ticket_resume', 'ticket_create', 'channel_reply', 'human_ask']
      if (routerCommands.includes(name) && (sessionId !== mainId || ctx.agents.get(mainId!) !== exec.agent)) return { ok: false, code: 'SA_ROUTER_IDENTITY_REQUIRED' }
      if (name === 'ticket_list') return { ok: true, code: 'SA_OK', items: store.repos.ticket.all().map(row => ({ id: row.id, state: row.state, title: row.title })) }
      if (name === 'ticket_status') { const row = ticketFor(args.ticketId); return { ok: true, code: 'SA_OK', ticket: { id: row.id, title: row.title, state: row.state } } }
      if (name === 'ticket_cancel') return { ok: await stopTicket(args.ticketId, args.reason), code: 'SA_STOPPED' }
      if (name === 'assignment_start') return startAssignment(args.ticketId)
      if (name === 'assignment_stop') { const row = store.repos.assignment.get(args.assignmentId); if (!row) return { ok: false, code: 'SA_NOT_FOUND' }; return { ok: await stopTicket(String(row.ticket_id), args.reason), code: 'SA_STOPPED' } }
      if (name === 'ticket_resume') return { ok: false, code: 'SA_RESUME_REQUIRES_HUMAN_INPUT' }
      if (name === 'ticket_create') {
        if (config.acceptMode !== 'auto' || config.confirm === 'always') return { ok: false, code: 'SA_CONFIRMATION_REQUIRED' }
        if (!validateTicketBrief(args.brief)) return { ok: false, code: 'SA_BRIEF_INVALID' }
        const evaluation = startEval(store, threadKey(`session:${sessionId}`), policy)
        if (!evaluation) return { ok: false, code: 'SA_NO_PENDING_INPUT' }
        const id = ticketId(randomUUID())
        const mandate = grantMandate({ decision: { kind: 'accept', strength: 'explicit', policyVersion: policy.version }, grantedBy: { id: 'human', source: `session:${sessionId}` as any, bot: false }, at: Date.now(), scope: args.brief.scope.repo, via: 'addressed', rules: [] }, policy)
        settleEval(store, evaluation.id, { kind: 'accept', reason: 'Router ticket_create', strength: 'explicit', ticket: { id, title: args.brief.goal, brief: args.brief, mandate, workdir: join(config.workRoot, id) } }, policy)
        return { ok: true, code: 'SA_CREATED', ticketId: id }
      }
      if (name === 'channel_reply') {
        if (args.threadKey !== `session:${mainId}` || !store.repos.thread.get(args.threadKey)) return { ok: false, code: 'SA_CHANNEL_SCOPE_DENIED' }
        engine.enqueue({ channel: 'session', threadKey: args.threadKey, body: args.body, kind: 'reply', idempotencyKey: exec.callId ?? randomUUID() })
        await engine.drainOutbox()
        return { ok: true, code: 'SA_ENQUEUED' }
      }
      if (name === 'human_ask') {
        if (!store.repos.thread.get(`session:${mainId}`)) return { ok: false, code: 'SA_NO_HUMAN_THREAD' }
        engine.enqueue({ channel: 'session', threadKey: threadKey(`session:${mainId}`), body: args.question, kind: 'reply', idempotencyKey: exec.callId ?? randomUUID() })
        await engine.drainOutbox()
        return { ok: true, code: 'SA_QUESTION_ENQUEUED' }
      }
      if (!worker) return { ok: false, code: 'SA_ASSIGNMENT_UNBOUND' }
      const ticket = ticketFor(String(worker.ticket_id))
      if (ticket.current_assignment !== worker.id || worker.state !== 'running' || ticket.state === 'ended') return { ok: false, code: 'SA_ASSIGNMENT_STALE' }
      if (ticket.state === 'waiting_human' && !['report_progress', 'report_result', 'ask_router'].includes(name)) return { ok: false, code: 'SA_ASSIGNMENT_WAITING' }
      if (name === 'report_progress') {
        const previous = worker.report_json as any
        const progressed = Array.isArray(args.done) && args.done.some((entry: string) => typeof entry === 'string' && entry.trim() && !(previous?.done ?? []).includes(entry))
        store.repos.assignment.updateByState(worker.id, 'running', 'running', { report_json: args, ...(progressed ? { last_progress_at: Date.now() } : {}) })
        return { ok: true, code: 'SA_PROGRESS_RECORDED' }
      }
      if (name === 'report_result') {
        const checked = inspectReport(args, ticket.brief_json as TicketBrief)
        if (!checked.valid) return { ok: false, code: 'SA_REPORT_INVALID', errors: checked.errors }
        if ((worker.report_json as any)?.state === 'ready') return { ok: false, code: 'SA_REPORT_DUPLICATE' }
        store.repos.assignment.updateByState(worker.id, 'running', 'running', { report_json: args, last_progress_at: Date.now() })
        return { ok: true, code: 'SA_REPORT_RECORDED' }
      }
      if (name === 'request_approval') {
        const id = randomUUID()
        store.transaction(() => {
          store.repos.approval.insert({ id, ticket_id: worker.ticket_id, kind: args.kind, summary: args.summary, payload_json: args.payload, requested_by: `worker:${worker.id}`, created_at: Date.now(), state: 'pending' })
          store.repos.ticket.updateByState(ticket.id, 'running', 'waiting_human', { attention_json: { question: args.summary, at: Date.now() }, updated_at: Date.now() })
        })
        await sendRouter(`Approval requested: ${id}: ${args.summary}`, true)
        return { ok: true, code: 'SA_APPROVAL_PENDING', approvalId: id }
      }
      if (name === 'ask_router') { await sendRouter(args.question, true); return { ok: true, code: 'SA_ROUTER_NOTIFIED' } }
      return { ok: false, code: 'SA_TOOL_UNWIRED' }
    },
    panelPorts: {
      async health() { return { ok: initialization === 'ready' && !disposed, runtime: { state: disposed ? 'stopped' : initialization, ...(initialization === 'failed' ? { code: 'SA_RUNTIME_INITIALIZATION_FAILED' } : {}) }, db: { version: store.version }, watchdog: { lastAt: heartbeat }, sessionChannel: { delivery: 'durable-chat-notice', modelWakeup: false, visualVerification: 'pending-human' }, outbox: { pending: store.repos.outbound.all().filter(row => row.state === 'pending').length }, sources: await Promise.all(sources.all().map(async source => ({ id: source.id, kind: source.kind, attended: source.attended, ...await source.health() }))) } },
      async sources() { return Promise.all(sources.all().map(async source => ({ id: source.id, kind: source.kind, attended: source.attended, paused: config.paused || engine.paused(), ...await source.health() }))) },
      // Panel owns the domain transition; this port only quiesces the active Worker.
      async stopTicket(id: string) { const row = ticketFor(id); const assignment = row.current_assignment ? store.repos.assignment.get(row.current_assignment) : undefined; if (assignment) { ctx.subagents.interrupt?.(String(assignment.session_id), { kind: 'user' }); store.repos.assignment.updateByState(assignment.id, 'running', 'ended', { ended_at: Date.now(), ended_reason: 'human-stop' }); await workers.get(String(assignment.id))?.dispose() } },
      async resumeTicket(id: string) { const row = ticketFor(id); return !disposed && mandateValid(row) && hasSubscription(row) && approvalsReady(id) },
      async approvalDecided(id: string, approvalId: string, approved: boolean) { await releaseApproval(id, approvalId, approved); if (approved) await pump() },
      mandateValid(row: Row) { return revalidate(row.mandate_json as any, policy).valid },
    },
    async dispose() {
      disposed = true; clearInterval(timer); controller.abort()
      await ready.catch(() => {})
      await sources.stopAll()
      await Promise.allSettled([...workers.values()].map(worker => worker.dispose()))
      await Promise.allSettled([...tasks])
      for (const handle of ownedHandles.reverse()) await handle.dispose()
    },
  }
}
