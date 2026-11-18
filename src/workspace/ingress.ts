import type { Store } from '../store/index.js'
import { foldConversation } from './conversation.js'
import { queueCapacityUsed } from '../engine/capacity.js'
import { createCommandJournal, commandError, commandDigest, validateCommand, type WorkspaceCommand, type CommandRecord, type WorkspaceBinding } from './commands.js'

export interface IngressPorts {
  binding(): WorkspaceBinding
  agent(): { session: unknown; followup(message: unknown): void; inject?(message: unknown): void } | undefined
  readSession(): Promise<{ events: any[] }>
  flush(session: unknown): Promise<boolean>
  modelAvailable(): Promise<boolean>
  paused(): boolean
  queueLimit: number
  target(id: string): { threadKey: string } | undefined
  ingest(record: CommandRecord, event: any): Promise<void>
}
/** One authority for UI receipt, event catch-up and restart reconciliation. No message-body copy. */
export function createWorkspaceIngress(store: Store, ports: IngressPorts) {
  const journal = createCommandJournal(store)
  const locks = new Map<string, Promise<CommandRecord>>()
  function receipt(record: CommandRecord) {
    return { requestId: record.requestId, messageId: record.messageId, epoch: record.epoch, stage: record.stage,
      accepted: record.durable, seq: record.seq, at: record.at, updatedAt: record.updatedAt, ...(record.targetTicket ? { ticketId: record.targetTicket } : {}), ...(record.error ? { code: record.error } : {}) }
  }
  const reconciliation = new Map<string, Promise<CommandRecord>>()
  function capacityUsed(): number {
    return queueCapacityUsed(store)
  }
  async function reconcileUnlocked(stale: CommandRecord, events?: any[]): Promise<CommandRecord> {
    let record = journal.read(stale.requestId) ?? stale
    if (['published', 'rejected', 'canceled'].includes(record.stage)) return record
    const beforeFlush = events ?? (await ports.readSession()).events
    const watermark = beforeFlush.reduce((last, event) => Math.max(last, Number(event.seq) || 0), -1)
    // Only the observed prefix is certified durable. A later cancellation still denies delivery.
    let durable = false
    try { const agent = ports.agent(); durable = Boolean(agent && await ports.flush(agent.session) === true) } catch { /* retain evidence, report unknown durability */ }
    const log = (await ports.readSession()).events
    let admitted: any, insertion: any
    let seen = false, canceled = false
    const queues: Record<string, string[]> = { 'next-turn': [], 'next-step': [] }
    let claimed = false
    for (const event of log) {
      if (event.type === 'agent/inbox/spliced') {
        const data = event.data, queue = queues[data?.target]
        if (!queue || !Number.isSafeInteger(data.start) || !Array.isArray(data.inserted)) continue
        const removed = queue.splice(data.start, data.removedCount ?? 0, ...data.inserted.map((value: any) => value.id))
        if (removed.includes(record.messageId)) { claimed = true; canceled ||= data.outcome === 'canceled' }
        if (data.inserted.some((value: any) => value.id === record.messageId && value.source?.kind === 'user')) { seen = true; insertion = event }
      }
      if (event.type === 'user/message' && event.data?.id === record.messageId && event.data?.source?.kind === 'user') { admitted = event; seen = true }
    }
    if (!seen) return record
    // Human decisions can commit while the Host durability participant is awaited.
    record = journal.read(record.requestId) ?? record
    if (['published', 'rejected', 'canceled'].includes(record.stage)) return record
    let next = record
    const projected = foldConversation(log).find(item => item.id === record.messageId)
    const stage = admitted ? 'admitted' : projected?.stage === 'rejected' ? 'rejected' : canceled ? 'canceled' : claimed ? 'claimed' : 'queued'
    if (!['processing', 'published'].includes(record.stage) && (record.stage !== stage || record.durable !== durable)) next = journal.update(record.requestId, { stage, durable, ...(durable ? { error: undefined } : { error: 'durability_unavailable' }) })
    const admissionEvent = admitted ?? (record.targetTicket ? insertion : undefined)
    if (admissionEvent && Number(admissionEvent.seq) <= watermark && durable && !['processing', 'published', 'rejected', 'canceled'].includes(next.stage)) {
      await ports.ingest(next, admissionEvent)
      // Ingest may publish/reject while awaited. Never replace that terminal receipt.
      next = journal.read(next.requestId) ?? next
      if (!['processing', 'published', 'rejected', 'canceled'].includes(next.stage)) next = journal.update(next.requestId, { stage: 'processing', durable: true })
    }
    return next
  }
  async function withReconciliation(record: CommandRecord, run: () => Promise<CommandRecord>): Promise<CommandRecord> {
    const previous = reconciliation.get(record.requestId) ?? Promise.resolve(record)
    const task = previous.catch(() => record).then(run)
    reconciliation.set(record.requestId, task)
    try { return await task } finally { if (reconciliation.get(record.requestId) === task) reconciliation.delete(record.requestId) }
  }
  async function reconcile(record: CommandRecord, events?: any[]): Promise<CommandRecord> {
    return withReconciliation(record, () => reconcileUnlocked(record, events))
  }
  async function send(input: WorkspaceCommand): Promise<CommandRecord> {
    validateCommand(input)
    const binding = ports.binding()
    if (input.epoch !== binding.epoch) return commandError('epoch_mismatch')
    const prior = journal.read(input.requestId)
    if (prior && prior.digest !== commandDigest(input)) return commandError('request_conflict')
    if (prior) {
      const checked = await reconcile(prior)
      // Never re-followup a historical splice, claimed input, rejected/canceled message,
      // or an ambiguous crash after dispatch began. Only received-before-fence may retry.
      if (checked.stage !== 'received' || checked.error === 'dispatch_uncertain') return checked
    }
    if (ports.paused()) return commandError('workspace_paused', 429)
    if (!prior && capacityUsed() >= ports.queueLimit) return commandError('queue_full', 429)
    const target = input.intent === 'ticket-input' ? ports.target(input.ticketId!) : undefined
    if (input.intent === 'ticket-input' && !target) return commandError('ticket_input_denied', 409)
    if (!await ports.modelAvailable()) return commandError('model_unavailable', 503)
    const agent = ports.agent(); if (!agent) return commandError('workspace_unavailable', 503)
    if (ports.paused()) return commandError('workspace_paused', 429)
    // No await between the union-count reservation check and durable receive.
    if (!prior && capacityUsed() >= ports.queueLimit) return commandError('queue_full', 429)
    const record = prior ?? journal.receive(input, target?.threadKey ?? `workspace:${input.requestId}`)
    // Fence commits before the void call. A crash here needs explicit unknown resolution,
    // never a new id or blind repeat. Exact input remains only in client draft/Session.
    journal.update(record.requestId, { stage: 'unknown', error: 'dispatch_uncertain', durable: false })
    try {
      const message = { id: record.messageId, role: 'user', content: [{ type: 'text', text: input.text }], source: { kind: 'user' } }
      // Targeted supplements are durable in the one conversation without waking Router.
      // They enter only the Host-verified Ticket delivery path after flush.
      if (record.targetTicket) { if (!agent.inject) return commandError('workspace_unavailable', 503); agent.inject(message) }
      else agent.followup(message)
    } catch { return journal.read(record.requestId)! }
    return reconcile(journal.read(record.requestId)!)
  }
  return {
    journal, receipt, reconcile,
    async submit(input: WorkspaceCommand) {
      validateCommand(input)
      const running = locks.get(input.requestId)
      if (running) {
        const record = await running
        if (record.digest !== commandDigest(input)) return commandError('request_conflict')
        return receipt(record)
      }
      const task = send(input); locks.set(input.requestId, task)
      try { return receipt(await task) } finally { if (locks.get(input.requestId) === task) locks.delete(input.requestId) }
    },
    async status(epoch: string, requestId: string) {
      const record = journal.read(requestId)
      if (!record || record.epoch !== epoch) return commandError('command_not_found', 404)
      return receipt(epoch === ports.binding().epoch ? await reconcile(record) : record)
    },
    async cancelUnknown(epoch: string, requestId: string, seq: number) {
      if (!Number.isSafeInteger(seq) || seq < 1) return commandError('invalid_input', 400)
      if (epoch !== ports.binding().epoch) return commandError('epoch_mismatch')
      const record = journal.read(requestId)
      if (!record) return commandError('command_not_found', 404)
      if (record.epoch !== epoch) return commandError('epoch_mismatch')
      return receipt(await withReconciliation(record, async () => {
        if (epoch !== ports.binding().epoch) return commandError('epoch_mismatch')
        // Refresh real Session evidence and durability before applying the human fence.
        await reconcileUnlocked(record)
        if (epoch !== ports.binding().epoch) return commandError('epoch_mismatch')
        const current = journal.read(requestId)!
        if (current.stage === 'canceled' && current.error === 'human_canceled_unknown') return current
        if (current.stage !== 'unknown' || current.durable) return commandError('command_cancel_denied')
        if (current.seq !== seq) return commandError('command_conflict')
        // No await between the exact seq check and commit; Session/model are untouched.
        return journal.update(requestId, { stage: 'canceled', error: 'human_canceled_unknown', durable: false })
      }))
    },
    async catchUp(messageIds: readonly string[]) {
      const records = messageIds.map(id => journal.byMessage(id)).filter((row): row is CommandRecord => Boolean(row))
      if (!records.length) return []
      const snapshot = await ports.readSession()
      return Promise.all(records.map(row => reconcile(row, snapshot.events)))
    },
    async recover() {
      const current = journal.all().filter(row => row.epoch === ports.binding().epoch && !['published', 'rejected', 'canceled'].includes(row.stage))
      if (!current.length) return
      const snapshot = await ports.readSession()
      for (const row of current) await reconcile(row, snapshot.events)
    },
  }
}
