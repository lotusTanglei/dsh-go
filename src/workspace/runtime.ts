import type { Store } from '../store/index.js'
import type { Config } from '../config.js'
import { threadKey } from '../domain/ids.js'
import type { Policy } from '../domain/policy.js'
import type { SessionSource } from '../sources/session.js'
import { createTrigger } from '../domain/trigger.js'
import { bindWorkspace, commandError, type CommandRecord, type WorkspaceCommand } from './commands.js'
import { createWorkspaceIngress } from './ingress.js'
import { conversationPage } from './conversation.js'
import { createAdmissionService } from './admission.js'

/** Host-only facade. Browser clients never select an Agent, role, actor or Session. */
export function createWorkspaceRuntime(store: Store, config: Config, policy: Policy, ports: {
  ctx: any; mainId: string; source: SessionSource; engine: any
  deliverTicket(id: string): Promise<void>; approvalsReady(id: string): boolean; mandateValid(row: any): boolean
}) {
  const { ctx, mainId, source, engine } = ports
  const bindings = bindWorkspace(store, mainId)
  const current = bindings.current
  const modelAvailable = async () => {
    const selection = ctx.agents.get(mainId)?.model?.current?.()
    if (!selection?.provider || !selection?.model || !ctx.llm?.resolveModelInfo) return false
    try {
      const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
      return selection.reasoningEffort === undefined || info.reasoning?.efforts?.some((row: any) => row.id === selection.reasoningEffort) === true
    } catch { return false }
  }
  const active = () => ctx.agents.get(mainId)
  const ingest = async (record: CommandRecord, event: any) => {
    const input = { session: { id: mainId }, event }
    const original = event.type === 'agent/inbox/spliced' ? await source.normalizeInbox(input, record.messageId) : await source.normalize(input)
    const thread = store.repos.thread.get(record.threadKey)
    const targetSource = record.targetTicket ? thread?.source as any : original.source
    const trigger = createTrigger({ ...original, source: targetSource, actor: { ...original.actor, source: targetSource }, threadKey: threadKey(record.threadKey) })
    // Ordinary coordinator chat is not a task Trigger or implicit admission scope.
    if (record.intent === 'message') return
    const result = engine.ingest(trigger, record.targetTicket ? { targetTicketId: record.targetTicket } : undefined)
    if (result.status === 'rejected') return commandError('queue_full', 429)
    if (record.targetTicket) {
      const ticket = store.repos.ticket.get(record.targetTicket)
      if (!ticket || ticket.thread_key !== record.threadKey || ticket.stopped_by_human || ticket.state === 'ended') return commandError('ticket_input_denied')
      if (result.ticketId && result.ticketId !== record.targetTicket) return commandError('ticket_target_conflict')
      if (ticket.state === 'waiting_human' && ports.approvalsReady(record.targetTicket) && ports.mandateValid(ticket)) {
        const assignment = ticket.current_assignment ? store.repos.assignment.get(ticket.current_assignment) : undefined
        store.repos.ticket.updateByState(ticket.id, 'waiting_human', assignment?.state === 'running' ? 'running' : 'open', { attention_json: null, updated_at: Date.now() })
      }
      await ports.deliverTicket(record.targetTicket)
    }
  }
  const ingress = createWorkspaceIngress(store, {
    binding: () => current, agent: active, readSession: () => ctx.sessionQuery.readSession(mainId),
    flush: async session => ctx.sessions ? ctx.sessions.flush(session) : false,
    modelAvailable, paused: () => config.paused || engine.paused(), queueLimit: config.queueLimit,
    target(id) {
      const ticket = store.repos.ticket.get(id)
      if (!ticket || !['open', 'running', 'waiting_human'].includes(String(ticket.state)) || ticket.stopped_by_human) return undefined
      // Target ownership is a durable command lineage or legacy canonical Source, never a browser-supplied thread.
      const thread = store.repos.thread.get(ticket.thread_key)
      const validSources = new Set([current, ...bindings.archives].map(row => `session:${row.sessionId}`))
      const lineage = store.repos.decision.get(ticket.decision_id)
      if (!validSources.has(String(thread?.source)) || lineage?.ticket_id !== ticket.id || lineage?.thread_key !== ticket.thread_key) return undefined
      return { threadKey: String(ticket.thread_key) }
    }, ingest,
  })
  const admission = createAdmissionService(store, { policy, workRoot: config.workRoot, timeoutMs: config.approvalTimeoutMs, paused: () => config.paused || engine.paused() })
  const requireEpoch = (epoch: unknown) => { if (epoch !== current.epoch) return commandError('epoch_mismatch') }
  async function currentCommand() {
    // Use committed turn boundaries, not a global last request or model-authored requestId.
    const snapshot = await ctx.sessionQuery.readSession(mainId)
    const events = snapshot.events as any[]
    const start = events.findLastIndex(event => event.type === 'turn/start')
    if (start < 0 || events.slice(start + 1).some(event => event.type === 'turn/end')) return commandError('no_active_command')
    const ids = events.slice(start + 1).filter(event => event.type === 'user/message' && event.data?.source?.kind === 'user').map(event => event.data.id as string)
    const scoped = ids.map(id => ingress.journal.byMessage(id)).filter((row): row is CommandRecord => Boolean(row))
    const actionable = scoped.filter(row => row.intent !== 'ticket-input')
    if (actionable.length !== 1 || ids.some(id => !ingress.journal.byMessage(id))) return commandError('command_context_ambiguous')
    const record = actionable[0]!
    await ingress.catchUp([record.messageId])
    const admitted = ingress.journal.read(record.requestId)!
    if (!admitted.durable || admitted.intent !== 'new-task' || admitted.epoch !== current.epoch || !['processing', 'published'].includes(admitted.stage)) return commandError('new_task_context_required')
    return admitted
  }
  return {
    current, ingress, admission, modelAvailable, requireEpoch,
    async workspace() {
      const available = await modelAvailable()
      return { epoch: current.epoch, archiveEpochs: bindings.archives.map(row => ({ epoch: row.epoch, createdAt: row.createdAt })),
        state: active() ? 'ready' : 'unavailable', model: { available, ...(available ? {} : { code: 'model_unavailable' }) }, serverTime: Date.now(),
        capabilities: { conversation: true, send: available && !config.paused && !engine.paused(), workerExecution: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' },
        admissions: admission.list(current.epoch), pendingApprovals: Number(store.db.prepare("SELECT COUNT(*) n FROM approval WHERE state='pending'").get()?.n ?? 0) }
    },
    async conversation(input: { epoch: string; after?: string; before?: string; limit?: number }) {
      const binding = [current, ...bindings.archives].find(row => row.epoch === input.epoch)
      if (!binding) return commandError('epoch_not_found', 404)
      let snapshot
      try { snapshot = await ctx.sessionQuery.readSession(binding.sessionId) } catch { return commandError('history_unavailable', 503) }
      return conversationPage(snapshot.events, input)
    },
    async command(input: WorkspaceCommand) { return ingress.submit(input) },
    async commandStatus(input: { epoch: string; requestId: string }) {
      if (![current, ...bindings.archives].some(row => row.epoch === input.epoch)) return commandError('epoch_not_found', 404)
      return ingress.status(input.epoch, input.requestId)
    },
    async decideAdmission(input: { epoch: string; requestId: string; planId: string; fingerprint: string; decision: 'approve' | 'reject' }) {
      requireEpoch(input.epoch)
      const result = admission.decide(input)
      if (result.state === 'rejected') {
        const record = ingress.journal.read(input.requestId)!
        store.transaction(() => {
          store.db.prepare("UPDATE thread_trigger SET state='consumed' WHERE thread_key=? AND state='pending'").run(record.threadKey)
          store.db.prepare("UPDATE trigger_disposition SET filtered=? WHERE trigger_id IN (SELECT id FROM trigger WHERE thread_key=?) AND decision_id IS NULL").run('human-rejected-plan', record.threadKey)
        })
        ingress.journal.update(input.requestId, { stage: 'rejected' })
      }
      return result
    },
    async propose(brief: any) {
      const record = await currentCommand()
      return admission.propose(record, brief)
    },
    async onHuman(trigger: any) {
      const record = ingress.journal.byMessage(trigger.externalId)
      if (record) { await ingress.catchUp([record.messageId]); return }
      // Canonical ordinary chat stays conversational: no implicit Worker routing.
      // Existing typed legacy Source inputs use their own thread; no global chat takeover.
    },
    async recover() {
      await ingress.recover(); admission.recover()
      for (const plan of admission.list(current.epoch).filter(row => row.state === 'rejected')) {
        const record = ingress.journal.read(plan.requestId)
        if (!record || record.stage === 'rejected') continue
        store.transaction(() => {
          store.db.prepare("UPDATE thread_trigger SET state='consumed' WHERE thread_key=? AND state='pending'").run(record.threadKey)
          store.db.prepare("UPDATE trigger_disposition SET filtered=? WHERE trigger_id IN (SELECT id FROM trigger WHERE thread_key=?) AND decision_id IS NULL").run('human-rejected-plan', record.threadKey)
        })
        ingress.journal.update(record.requestId, { stage: 'rejected' })
      }
      const snapshot = await ctx.sessionQuery.readSession(mainId)
      let batch: string[] = []
      for (const event of snapshot.events) {
        if (event.type === 'turn/start') batch = []
        if (event.type === 'user/message' && event.data?.source?.kind === 'user') batch.push(event.data.id)
        if (event.type === 'turn/end') {
          for (const id of batch) {
            const record = ingress.journal.byMessage(id)
            if (!record || record.stage !== 'processing' || record.intent === 'new-task') continue
            // Conversational completion frees queue capacity, not proof of task completion/read ACK.
            if (event.data?.reason?.kind === 'completed') ingress.journal.update(record.requestId, { stage: 'published' })
          }
          batch = []
        }
      }
      for (const record of ingress.journal.all().filter(row => row.stage === 'processing')) {
        const disposition = store.db.prepare('SELECT d.ticket_id, d.delivered_to FROM trigger t JOIN trigger_disposition d ON d.trigger_id=t.id WHERE t.external_id=? AND t.thread_key=?').get(record.messageId, record.threadKey)
        if (record.intent === 'new-task' && disposition?.ticket_id || record.intent === 'ticket-input' && disposition?.delivered_to) ingress.journal.update(record.requestId, { stage: 'published' })
      }
    },
  }
}
