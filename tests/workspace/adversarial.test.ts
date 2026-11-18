import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { openStore, type Store } from '../../src/store/index.js'
import { assignmentId, sourceId, threadKey, ticketId } from '../../src/domain/ids.js'
import { createTrigger, type Addressed } from '../../src/domain/trigger.js'
import { ingestTrigger, readDisposition } from '../../src/engine/intake.js'
import { approvalImpact } from '../../src/engine/approval-impact.js'
import { bindWorkspace, type CommandRecord, type WorkspaceCommand } from '../../src/workspace/commands.js'
import { createWorkspaceIngress, type IngressPorts } from '../../src/workspace/ingress.js'
import { installPanelRoutes, type PanelConnection } from '../../src/panel/routes.js'
import { installRoleGuard, type ToolExecutionContext, type WorkerGuardSnapshot } from '../../src/tools/runtime.js'

// Real on-disk SQLite; only explicit inbox, durability, model-availability and HTTP ports are fake.
// No runtime harness, provider, native tool execution, server, timers or test-only production bypass.
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function database(): Store {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'workspace-adversarial-')))
  const store = openStore({ dbPath: join(dir, 'state.sqlite') })
  cleanups.push(() => {
    try { store.close() } finally {
      const target = resolve(dir)
      if (target !== dir || !target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('workspace-adversarial-')) throw new Error('unsafe adversarial fixture cleanup')
      rmSync(target, { recursive: true, force: true })
    }
  })
  return store
}
const source = sourceId('session:adversarial')
function trigger(externalId: string, thread = 'legacy:shared', addressed: Addressed = 'direct') {
  return createTrigger({ source, externalId, threadKey: threadKey(thread), actor: { id: 'human', source, bot: false },
    text: 'Synthetic human instruction', at: 100, trust: 'human', addressed, raw: null })
}
function legacyTickets(store: Store) {
  const shared = 'legacy:shared'
  store.repos.thread.insert({ key: shared, source, ref_json: { source, kind: 'session', id: shared }, created_at: 1, last_at: 1, seq: 0, paused: false })
  // A is deliberately older and therefore wins the untargeted legacy subscription lookup.
  for (const [index, id] of ['A', 'B'].entries()) {
    store.repos.ticket.insert({ id, thread_key: shared, decision_id: `decision:${id}`, title: `Ticket ${id}`, state: 'running', mandate_json: {}, brief_json: {},
      workdir: '/tmp/adversarial-fixture', current_assignment: `assignment:${id}`, stopped_by_human: false, created_at: index + 1, updated_at: index + 1 })
    store.repos.assignment.insert({ id: `assignment:${id}`, ticket_id: id, session_id: `worker:${id}`, state: 'running', created_at: index + 1, last_progress_at: index + 1 })
    store.repos.thread_subscription.insert({ thread_key: shared, ticket_id: id })
  }
  return shared
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

type InboxTarget = 'next-turn' | 'next-step'
type Message = { id: string; role: string; source: { kind: string }; content: Array<{ type: string; text: string }> }
type Event = { type: string; seq: number; time: number; data: any }
function inboxFixture() {
  const store = database(), binding = bindWorkspace(store, 'adversarial').current
  const events: Event[] = [], calls: Array<{ target: InboxTarget; message: Message }> = []
  const queues: Record<InboxTarget, Message[]> = { 'next-turn': [], 'next-step': [] }
  let durable = true, turns = 0
  const append = (type: string, data: any) => { const event = { type, seq: events.length, time: 1000 + events.length, data }; events.push(event); return event }
  // This is a real mutable FIFO backing store, not a pre-canned log. Every removal
  // (including canceled replacement/non-head removal) uses Array.splice at its actual position.
  const splice = (target: InboxTarget, start: number, removedCount: number, inserted: Message[] = [], outcome?: 'canceled') => {
    const removed = queues[target].splice(start, removedCount, ...inserted)
    append('agent/inbox/spliced', { target, start, removedCount: removed.length, inserted, ...(outcome ? { outcome } : {}) })
    return removed
  }
  const enqueue = (target: InboxTarget, value: unknown) => {
    const message = value as Message
    calls.push({ target, message }); splice(target, queues[target].length, 0, [message])
  }
  const agent = { session: { id: binding.sessionId }, followup(value: unknown) { enqueue('next-turn', value) }, inject(value: unknown) { enqueue('next-step', value) } }
  const ingested: Array<{ record: CommandRecord; event: Event }> = []
  const ports: IngressPorts = {
    binding: () => binding, agent: () => agent, async readSession() { return { events: [...events] } },
    flush: vi.fn(async () => durable), modelAvailable: vi.fn(async () => true), paused: () => false, queueLimit: 2,
    target: id => id === 'B' ? { threadKey: 'legacy:shared' } : undefined,
    async ingest(record, event: Event) {
      ingested.push({ record, event })
      // Normalize only the explicit fake Host message at this narrow port; route with the real intake.
      const value = event.type === 'user/message' ? event.data : event.data.inserted.find((item: Message) => item.id === record.messageId)
      const input = createTrigger({ ...trigger(record.messageId, record.threadKey), text: value.content.map((part: { text: string }) => part.text).join('\n') })
      const result = ingestTrigger(store, input, record.targetTicket ? { targetTicketId: ticketId(record.targetTicket) } : {})
      if (result.status === 'rejected') throw new Error(`unexpected fake-port intake rejection: ${result.reason}`)
    },
  }
  const ingress = createWorkspaceIngress(store, ports)
  const input = (patch: Partial<WorkspaceCommand> = {}): WorkspaceCommand => ({ epoch: binding.epoch, requestId: randomUUID(), intent: 'new-task', text: 'same synthetic body', ...patch })
  return {
    store, binding, events, calls, queues, ports, ingress, ingested, input, append, splice,
    setDurable(value: boolean) { durable = value },
    admitHead() {
      if (!queues['next-turn'].length) throw new Error('empty fake FIFO')
      const turn = ++turns
      append('turn/start', { turn })
      const pendingStep = splice('next-step', 0, queues['next-step'].length)
      const [head] = splice('next-turn', 0, 1)
      append('step/start', { turn, step: 0 })
      for (const item of [...pendingStep, head!]) append('user/message', item)
      return head!
    },
  }
}
function panel(store: Store) {
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const fetch: PanelConnection['fetch'] = { register(route) { routes.set(route.path, route.fetch); return () => { routes.delete(route.path) } } }
  const installation = installPanelRoutes({ connection: { fetch } }, store, { approvalTimeoutMs: 86_400_000 })
  cleanups.push(() => installation.dispose())
  return async (path: string, body: unknown = {}) => {
    const route = routes.get(`/api/superagent${path}`)
    if (!route) throw new Error('fake route not registered')
    const response = await route(new Request(`http://adversarial.invalid/api/superagent${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() as any }
  }
}
function insertApproval(store: Store, id: string, kind: string, payload: unknown, summary = 'Only a harmless approved summary') {
  store.repos.approval.insert({ id, kind, summary, payload_json: payload, requested_by: 'worker:fixture', created_at: Date.now(), state: 'pending' })
}

describe('S1 adversarial legacy target routing', () => {
  it('routes a B supplement and its durable disposition to B, never the older shared-thread subscription A', () => {
    const store = database(), shared = legacyTickets(store), input = trigger('only-for-B', shared)
    const result = ingestTrigger(store, input, { targetTicketId: ticketId('B') })
    expect(result).toMatchObject({ status: 'subscription', ticketId: 'B', assignmentId: 'assignment:B' })
    expect(readDisposition(store, input.id)).toMatchObject({ ticketId: 'B' })
    expect(store.repos.trigger_disposition.get(input.id)?.ticket_id).not.toBe('A')
    expect(store.repos.thread_trigger.get({ thread_key: shared, trigger_id: input.id })).toMatchObject({ state: 'pending', seq: 1 })
  })

  it.each(['missing', 'ended', 'stopped', 'unsubscribed', 'foreign-thread'] as const)('rejects %s target without committing any trigger, disposition, queue item or thread mutation', variant => {
    const store = database(), shared = legacyTickets(store)
    let target = 'B'
    if (variant === 'missing') target = 'missing'
    if (variant === 'ended') store.repos.ticket.updateByState('B', 'running', 'ended', { current_assignment: null, ended_at: 3, ended_by: 'human', outcome: 'stopped' })
    if (variant === 'stopped') store.repos.ticket.updateByState('B', 'running', 'running', { stopped_by_human: true })
    if (variant === 'unsubscribed') store.db.prepare('DELETE FROM thread_subscription WHERE ticket_id=?').run('B')
    if (variant === 'foreign-thread') store.repos.ticket.updateByState('B', 'running', 'running', { thread_key: 'foreign:thread' })
    const before = store.repos.thread.get(shared)
    // Source/address filtering cannot turn an invalid trusted target into a committed Trigger.
    for (const addressed of ['direct', 'none'] as const) {
      const input = trigger(`invalid-${variant}-${addressed}`, shared, addressed)
      expect(ingestTrigger(store, input, { targetTicketId: ticketId(target) })).toMatchObject({ status: 'rejected' })
      expect(store.repos.trigger.get(input.id)).toBeUndefined()
      expect(store.repos.trigger_disposition.get(input.id)).toBeUndefined()
      expect(store.repos.thread_trigger.get({ thread_key: shared, trigger_id: input.id })).toBeUndefined()
      expect(store.repos.thread.get(shared)).toEqual(before)
    }
  })
})

describe('S1 adversarial ingress reservations and FIFO reconciliation', () => {
  it('admits only one of two concurrent IDs with a non-journal pending item at queueLimit 2 after the model await', async () => {
    const h = inboxFixture()
    expect(ingestTrigger(h.store, trigger('non-journal-pending', 'external:pending')).status).toBe('accepted')
    const model = deferred<boolean>()
    h.ports.modelAvailable = vi.fn(() => model.promise)
    const inputs = [h.input(), h.input()]
    const pending = inputs.map(input => h.ingress.submit(input))
    const settled = Promise.allSettled(pending)
    // Both passed the pre-await check; neither may reserve speculatively before model availability.
    expect(h.ports.modelAvailable).toHaveBeenCalledTimes(2)
    expect(h.ingress.journal.all()).toEqual([])
    model.resolve(true)
    const results = await settled
    const accepted = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof h.ingress.submit>>> => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.value).toMatchObject({ accepted: true, stage: 'queued' })
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ code: 'queue_full', status: 429 })
    expect(h.calls).toHaveLength(1); expect(h.queues['next-turn']).toHaveLength(1)
    expect(h.ingress.journal.all()).toHaveLength(1)
    const winner = inputs.find(input => input.requestId === accepted[0]!.value.requestId)!
    await expect(h.ingress.submit(winner)).resolves.toMatchObject({ accepted: true })
    expect(h.admitHead().id).toBe(accepted[0]!.value.messageId)
    await h.ingress.catchUp([accepted[0]!.value.messageId])
    expect(h.ingested).toHaveLength(1)
    expect(h.store.db.prepare("SELECT COUNT(*) n FROM thread_trigger WHERE state='pending'").get()?.n).toBe(2)
    // A journal entry and its now-ingested Trigger count once, not twice, but the external item still counts.
    h.ports.queueLimit = 3
    await expect(h.ingress.submit(h.input())).resolves.toMatchObject({ accepted: true })
    await expect(h.ingress.submit(h.input())).rejects.toMatchObject({ code: 'queue_full', status: 429 })
    expect(h.calls).toHaveLength(2)
  })

  it('rechecks capacity populated by a non-journal input while awaiting model availability', async () => {
    const h = inboxFixture(), model = deferred<boolean>()
    h.ports.queueLimit = 1; h.ports.modelAvailable = vi.fn(() => model.promise)
    const pending = h.ingress.submit(h.input()), rejected = expect(pending).rejects.toMatchObject({ code: 'queue_full', status: 429 })
    expect(h.ports.modelAvailable).toHaveBeenCalledOnce()
    expect(ingestTrigger(h.store, trigger('arrived-during-model-check', 'external:late')).status).toBe('accepted')
    model.resolve(true)
    await rejected
    expect(h.calls).toEqual([]); expect(h.ingress.journal.all()).toEqual([])
  })

  it('uses actual FIFO positions, preserves a canceled middle item, and never resurrects it on status/retry', async () => {
    const h = inboxFixture(); h.ports.queueLimit = 3
    const inputs = [h.input(), h.input(), h.input()]
    const receipts: Awaited<ReturnType<typeof h.ingress.submit>>[] = []
    for (const input of inputs) receipts.push(await h.ingress.submit(input))
    expect(h.queues['next-turn'].map(value => value.id)).toEqual(receipts.map(value => value.messageId))
    expect(h.splice('next-turn', 1, 1, [], 'canceled').map(value => value.id)).toEqual([receipts[1]!.messageId])
    expect(h.admitHead().id).toBe(receipts[0]!.messageId)
    await h.ingress.catchUp(receipts.map(value => value.messageId))
    expect(h.ingested.map(value => value.record.requestId)).toEqual([inputs[0]!.requestId])
    expect(await h.ingress.status(inputs[1]!.epoch, inputs[1]!.requestId)).toMatchObject({ stage: 'canceled' })
    expect(await h.ingress.submit(inputs[1]!)).toMatchObject({ stage: 'canceled' })
    const restarted = createWorkspaceIngress(h.store, h.ports)
    await restarted.recover()
    expect(await restarted.status(inputs[2]!.epoch, inputs[2]!.requestId)).toMatchObject({ stage: 'queued' })
    expect(h.admitHead().id).toBe(receipts[2]!.messageId)
    await restarted.catchUp([receipts[2]!.messageId])
    expect(h.ingested.map(value => value.record.requestId)).toEqual([inputs[0]!.requestId, inputs[2]!.requestId])
    expect(h.queues['next-turn']).toEqual([]); expect(h.calls).toHaveLength(3)
    expect(h.store.repos.trigger.all().map(value => value.external_id)).not.toContain(receipts[1]!.messageId)
  })

  it('never delivers a targeted supplement whose queued splice was canceled before durability became available', async () => {
    const h = inboxFixture(), shared = legacyTickets(h.store)
    h.setDurable(false)
    const input = h.input({ intent: 'ticket-input', ticketId: 'B' }), receipt = await h.ingress.submit(input)
    expect(receipt).toMatchObject({ accepted: false, code: 'durability_unavailable' })
    expect(h.calls.map(value => value.target)).toEqual(['next-step']); expect(h.ingested).toEqual([])
    expect(h.splice('next-step', 0, 1, [], 'canceled').map(value => value.id)).toEqual([receipt.messageId])
    h.setDurable(true)
    const restarted = createWorkspaceIngress(h.store, h.ports)
    await restarted.recover()
    expect(await restarted.status(input.epoch, input.requestId)).toMatchObject({ stage: 'canceled' })
    expect(await restarted.submit(input)).toMatchObject({ stage: 'canceled' })
    await restarted.catchUp([receipt.messageId])
    expect(h.calls).toHaveLength(1); expect(h.ingested).toEqual([])
    expect(h.store.repos.trigger.all()).toEqual([]); expect(h.store.repos.trigger_disposition.all()).toEqual([])
    expect(h.store.repos.thread.get(shared)?.seq).toBe(0)
  })

  it('projects cancellation committed during an awaited successful flush before targeted delivery and keeps it terminal', async () => {
    const h = inboxFixture(), shared = legacyTickets(h.store)
    const flushing = deferred<void>(), flush = deferred<boolean>(), snapshots: Event[][] = []
    h.ports.readSession = vi.fn(async () => {
      const events = [...h.events]
      snapshots.push(events)
      return { events }
    })
    h.ports.flush = vi.fn(() => { flushing.resolve(undefined); return flush.promise })
    const input = h.input({ intent: 'ticket-input', ticketId: 'B' }), pending = h.ingress.submit(input)
    await flushing.promise
    const messageId = h.calls[0]!.message.id
    expect(h.calls.map(value => value.target)).toEqual(['next-step'])
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual([expect.objectContaining({ type: 'agent/inbox/spliced', data: expect.objectContaining({ target: 'next-step', removedCount: 0, inserted: [expect.objectContaining({ id: messageId })] }) })])
    expect(h.ingested).toEqual([])
    // The first snapshot is already copied. Only a post-flush projection can see this cancellation.
    expect(h.splice('next-step', 0, 1, [], 'canceled').map(value => value.id)).toEqual([messageId])
    expect(snapshots[0]).toHaveLength(1); expect(h.events).toHaveLength(2)
    flush.resolve(true)
    expect(await pending).toMatchObject({ accepted: true, stage: 'canceled', ticketId: 'B' })
    expect(h.ingested).toEqual([])
    expect(await h.ingress.status(input.epoch, input.requestId)).toMatchObject({ accepted: true, stage: 'canceled' })
    expect(await h.ingress.submit(input)).toMatchObject({ accepted: true, stage: 'canceled' })
    const restarted = createWorkspaceIngress(h.store, h.ports)
    await restarted.recover(); await restarted.catchUp([messageId])
    expect(await restarted.status(input.epoch, input.requestId)).toMatchObject({ accepted: true, stage: 'canceled' })
    expect(await restarted.submit(input)).toMatchObject({ accepted: true, stage: 'canceled' })
    expect(h.calls).toHaveLength(1); expect(h.ingested).toEqual([]); expect(h.queues['next-step']).toEqual([])
    expect(h.store.repos.trigger.all()).toEqual([]); expect(h.store.repos.trigger_disposition.all()).toEqual([])
    expect(h.store.repos.thread.get(shared)?.seq).toBe(0)
  })

  it('false flush withholds targeted delivery; a later true flush reconciles once without another inject', async () => {
    const h = inboxFixture(); legacyTickets(h.store); h.setDurable(false)
    const input = h.input({ intent: 'ticket-input', ticketId: 'B' })
    const first = await h.ingress.submit(input)
    expect(first).toMatchObject({ accepted: false, stage: 'queued', code: 'durability_unavailable' })
    expect(h.store.repos.trigger.all()).toEqual([]); expect(h.ingested).toEqual([])
    h.setDurable(true)
    expect(await h.ingress.submit(input)).toMatchObject({ accepted: true, stage: 'processing', ticketId: 'B' })
    await h.ingress.status(input.epoch, input.requestId); await h.ingress.recover(); await h.ingress.submit(input)
    expect(h.calls).toHaveLength(1); expect(h.ingested).toHaveLength(1)
    const row = h.store.repos.trigger.all()[0]!
    expect(h.store.repos.trigger_disposition.get(row.id)).toMatchObject({ ticket_id: 'B' })
  })

  it('keeps a proven blocked-turn rejection terminal across status, retry, recovery and contradictory later admission evidence', async () => {
    const h = inboxFixture(), input = h.input(), receipt = await h.ingress.submit(input)
    h.append('turn/start', { turn: 1 })
    const [removed] = h.splice('next-turn', 0, 1)
    h.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    expect(await h.ingress.status(input.epoch, input.requestId)).toMatchObject({ stage: 'rejected' })
    expect(await h.ingress.submit(input)).toMatchObject({ stage: 'rejected' })
    h.append('user/message', removed)
    const restarted = createWorkspaceIngress(h.store, h.ports)
    await restarted.recover(); await restarted.catchUp([receipt.messageId])
    expect(await restarted.status(input.epoch, input.requestId)).toMatchObject({ stage: 'rejected' })
    expect(await restarted.submit(input)).toMatchObject({ stage: 'rejected' })
    expect(h.calls).toHaveLength(1); expect(h.ingested).toEqual([]); expect(h.store.repos.trigger.all()).toEqual([])
  })
})

describe('S1 adversarial exact approval impact and deny-only redaction', () => {
  it.each(['unknown', 'constructor', 'toString', '__proto__'])('treats unknown action kind %s as unreviewable without throwing', kind => {
    expect(approvalImpact(kind, { recipient: 'owner@example.test', body: 'Visible exact body' })).toMatchObject({ reviewable: false, details: {} })
  })

  it.each(['action', 'actions', 'command', 'script', 'toolCall', 'payload', 'raw', 'url', 'secret'])('rejects hidden field %s even when summary and visible fields look harmless', async hidden => {
    const store = database(), request = panel(store)
    const payload = { recipient: 'owner@example.test', body: 'Visible harmless sentence', [hidden]: 'Delete the remote release branch' }
    expect(approvalImpact('send-external', payload).reviewable).toBe(false)
    insertApproval(store, 'hidden-action', 'send-external', payload)
    const list = await request('/approvals'), item = list.body.data.items[0]
    expect(item).toMatchObject({ impact: { reviewable: false }, allowed: { approve: false, deny: true } })
    const result = await request('/approval', { id: item.id, fingerprint: item.fingerprint, decision: 'approve', reason: 'The summary sounds safe' })
    expect(result).toMatchObject({ status: 409, body: { ok: false, code: 'approval_unreviewable' } })
    expect(store.repos.approval.get(item.id)?.state).toBe('pending')
  })

  it('presents complete recipient/body rather than a summary or truncated target, and fingerprints changes to either', async () => {
    const store = database(), request = panel(store)
    const recipient = Array.from({ length: 18 }, (_, index) => `reviewer${index}@example.test`).join(', ')
    const body = Array.from({ length: 180 }, (_, index) => `Line ${index}: exact outbound sentence.\n`).join('') + 'FINAL CONTENT MUST REMAIN VISIBLE'
    const payload = { recipient, body, subject: 'Full business action' }
    expect(recipient.length).toBeGreaterThan(240); expect(body.length).toBeGreaterThan(4000); expect(body.length).toBeLessThan(8000)
    expect(approvalImpact('send-external', payload)).toEqual({ reviewable: true, details: payload })
    insertApproval(store, 'exact-external', 'send-external', payload, 'Summary omits both actual recipient and actual body')
    const first = (await request('/approvals')).body.data.items[0]
    expect(first).toMatchObject({ allowed: { approve: true, deny: true }, impact: { reviewable: true, details: payload } })
    expect(first.impact.details.recipient).toBe(recipient); expect(first.impact.details.body).toBe(body)
    // The payload can change without changing the benign summary; stale consent cannot follow it.
    expect(store.repos.approval.updateByState('exact-external', 'pending', 'pending', { payload_json: { ...payload, body: body + '\nChanged action' } })).toBe(true)
    const stale = await request('/approval', { id: first.id, fingerprint: first.fingerprint, decision: 'approve', reason: 'Approved old displayed action' })
    expect(stale).toMatchObject({ status: 409, body: { code: 'conflict' } })
    const second = (await request('/approvals')).body.data.items[0]
    expect(second.fingerprint).not.toBe(first.fingerprint); expect(second.impact.details.body).toBe(body + '\nChanged action')
    expect(store.repos.approval.updateByState('exact-external', 'pending', 'pending', { payload_json: { ...payload, recipient: 'different@example.test' } })).toBe(true)
    expect(await request('/approval', { id: second.id, fingerprint: second.fingerprint, decision: 'approve', reason: 'Approved former recipient' })).toMatchObject({ status: 409, body: { code: 'conflict' } })
    expect(store.repos.approval.get(first.id)?.state).toBe('pending')
  })

  it.each(['body', 'recipient'] as const)('allows only deny when the exact %s was redacted, never summary-based approval', async field => {
    const store = database(), request = panel(store), secret = 'Bearer synthetic-approval-secret'
    const payload = { recipient: 'owner@example.test', body: 'Visible exact outbound body', [field]: secret }
    expect(approvalImpact('send-external', payload)).toMatchObject({ reviewable: false, reason: 'approval_action_redacted', details: {} })
    insertApproval(store, 'redacted-action', 'send-external', payload)
    const item = (await request('/approvals')).body.data.items[0]
    expect(item).toMatchObject({ impact: { reviewable: false, reason: 'approval_action_redacted' }, allowed: { approve: false, deny: true } })
    expect(JSON.stringify(item)).not.toContain(secret)
    expect(await request('/approval', { id: item.id, fingerprint: item.fingerprint, decision: 'approve', reason: 'Harmless summary is enough' })).toMatchObject({ status: 409, body: { code: 'approval_unreviewable' } })
    expect(store.repos.approval.get(item.id)?.state).toBe('pending')
    expect(await request('/approval', { id: item.id, fingerprint: item.fingerprint, decision: 'deny', reason: 'Exact action is not visible' })).toMatchObject({ status: 200, body: { ok: true, data: { state: 'denied' } } })
    expect(store.repos.approval.get(item.id)?.state).toBe('denied')
  })
})

describe('S1 adversarial installed role guard execution block', () => {
  it('rejects worker native write/bash/structured_output even with valid lifecycle and an allowlist, without affecting unrelated presets', () => {
    let callback: ((execution: ToolExecutionContext) => unknown) | undefined
    const remove = vi.fn(), resolveWorker = vi.fn<() => WorkerGuardSnapshot | undefined>()
    const guard = installRoleGuard({ tools: { guard(value) { callback = value; return remove } },
      agentPresets: { composedPreset(ctx) { return (ctx as { preset: string }).preset } } }, {
      executionBlocked: true, roleTools: { router: [], watchdog: [], worker: ['write', 'bash', 'structured_output'] }, resolveWorker,
    })
    expect(guard).toBeDefined(); expect(callback).toBeTypeOf('function')
    try {
      const agent = { ctx: { preset: 'dsh-superagent-worker' } }
      const snapshot: WorkerGuardSnapshot = { sessionId: 'worker:fixture', binding: { ticketId: ticketId('B'), assignmentId: assignmentId('assignment:B') },
        ticket: { id: ticketId('B'), state: 'running', currentAssignment: assignmentId('assignment:B') },
        assignment: { id: assignmentId('assignment:B'), ticketId: ticketId('B'), sessionId: 'worker:fixture', state: 'running' } }
      resolveWorker.mockReturnValue(snapshot); guard!.bindWorker(agent, snapshot)
      for (const name of ['write', 'bash', 'structured_output']) expect(callback!({ agent, name })).toMatchObject({ info: { name: 'SuperagentToolGuardError', code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } })
      // The block is preset-wide, not contingent on a successful binding resolver.
      resolveWorker.mockReturnValue(undefined)
      for (const name of ['write', 'bash', 'structured_output']) expect(callback!({ agent, name })).toMatchObject({ info: { code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } })
      for (const preset of ['general-purpose', 'custom-worker', 'dsh-superagent-worker-copy']) {
        for (const name of ['write', 'bash', 'structured_output']) expect(callback!({ agent: { ctx: { preset } }, name })).toBeUndefined()
      }
    } finally { guard?.dispose() }
    expect(remove).toHaveBeenCalledOnce()
  })
})
