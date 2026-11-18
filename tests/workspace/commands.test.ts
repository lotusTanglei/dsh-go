import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openStore } from '../../src/store/index.js'
import { bindWorkspace, createCommandJournal } from '../../src/workspace/commands.js'
import { createWorkspaceIngress } from '../../src/workspace/ingress.js'
const cleanups: (() => void)[] = []
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture() {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'kanban-command-')))
  const store = openStore({ dbPath: join(dir, 'state.sqlite') })
  cleanups.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('kanban-command-')) throw new Error('unsafe cleanup'); rmSync(dir, { recursive: true, force: true }) })
  cleanups.push(() => store.close())
  const binding = bindWorkspace(store, 'canonical').current, events: any[] = [], calls: any[] = []
  let flush = true, paused = false, available = true, dispatchThrows = false
  const agent = { session: {}, followup(message: any) { calls.push(message); if (dispatchThrows) throw new Error('dispatch uncertain'); events.push({ type: 'agent/inbox/spliced', seq: events.length, time: Date.now(), data: { target: 'next-turn', start: 0, inserted: [message] } }) } }
  const admitted: string[] = []
  const ports = { binding: () => binding, agent: () => agent, async readSession() { return { events } }, async flush() { return flush }, async modelAvailable() { return available }, paused: () => paused, queueLimit: 2, target: (id: string) => id === 'ticket-a' ? { threadKey: 'ticket-thread-a' } : undefined, async ingest(record: any) { admitted.push(record.requestId) } }
  const ingress = createWorkspaceIngress(store, ports)
  return { store, binding, ingress, events, calls, admitted, ports, input: (text = 'same content') => ({ epoch: binding.epoch, requestId: randomUUID(), intent: 'new-task' as const, text }), setFlush(value: boolean) { flush = value }, setPaused(value: boolean) { paused = value }, setAvailable(value: boolean) { available = value }, setDispatchThrows(value: boolean) { dispatchThrows = value } }
}
describe('workspace journal and durable single ingress', () => {
  it('deduplicates concurrent retries and refuses payload conflicts without another followup', async () => {
    const h = fixture(), input = h.input()
    const replies = await Promise.all([h.ingress.submit(input), h.ingress.submit(input)])
    expect(h.calls).toHaveLength(1); expect(replies[0]).toMatchObject({ accepted: true, stage: 'queued' })
    await expect(h.ingress.submit({ ...input, text: 'different' })).rejects.toMatchObject({ code: 'request_conflict', status: 409 })
    expect(h.calls).toHaveLength(1)
  })
  it('same text different request ids remains distinct; scopes new tasks independently', async () => {
    const h = fixture(), a = h.input(), b = h.input()
    await h.ingress.submit(a); await h.ingress.submit(b)
    expect(h.calls).toHaveLength(2)
    expect(h.ingress.journal.read(a.requestId)?.threadKey).not.toBe(h.ingress.journal.read(b.requestId)?.threadKey)
    expect(JSON.stringify(h.store.repos.side_effect.all())).not.toContain('same content')
  })
  it('reconciles historical splice/claim/admit on restart without re-waking', async () => {
    const h = fixture(), input = h.input()
    await h.ingress.submit(input)
    h.events.push({ type: 'agent/inbox/spliced', seq: 1, data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } })
    const restarted = createWorkspaceIngress(h.store, h.ports)
    expect(await restarted.status(input.epoch, input.requestId)).toMatchObject({ stage: 'claimed', accepted: true })
    await restarted.submit(input); expect(h.calls).toHaveLength(1)
    h.events.push({ type: 'user/message', seq: 2, time: Date.now(), data: h.calls[0] })
    await restarted.catchUp([h.calls[0].id])
    expect(h.admitted).toEqual([input.requestId])
    await restarted.submit(input); expect(h.calls).toHaveLength(1)
  })
  it('false flush never claims durable accepted; retry checks log not pending queue', async () => {
    const h = fixture(), input = h.input(); h.setFlush(false)
    expect(await h.ingress.submit(input)).toMatchObject({ accepted: false, code: 'durability_unavailable' })
    h.setFlush(true)
    expect(await h.ingress.submit(input)).toMatchObject({ accepted: true })
    expect(h.calls).toHaveLength(1)
  })
  it('ambiguous dispatch fence without log remains unknown and never blindly re-follows', async () => {
    const h = fixture(), input = h.input(), journal = createCommandJournal(h.store)
    journal.receive(input, `workspace:${input.requestId}`)
    journal.update(input.requestId, { stage: 'unknown', error: 'dispatch_uncertain' })
    expect(await h.ingress.submit(input)).toMatchObject({ stage: 'unknown', accepted: false })
    expect(h.calls).toHaveLength(0)
  })
  it('cancels a thrown dispatch fence idempotently without body replay, even after late Session admission', async () => {
    const h = fixture(), input = h.input('private canceled input')
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input)
    expect(unknown).toMatchObject({ stage: 'unknown', accepted: false, code: 'dispatch_uncertain', seq: 2 })
    expect(h.events).toEqual([])
    let flushes = 0
    h.ports.flush = async () => { flushes++; return true }
    const replies = await Promise.all([
      h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq),
      h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq),
    ])
    const canceled = replies[0]
    expect(canceled).toMatchObject({ stage: 'canceled', accepted: false, code: 'human_canceled_unknown', seq: unknown.seq + 1 })
    expect(replies[1]).toEqual(canceled)
    expect(flushes).toBe(1)
    expect(h.events).toEqual([])
    expect(h.calls).toHaveLength(1)
    const message = h.calls[0]
    h.events.push({ type: 'agent/inbox/spliced', seq: 0, data: { target: 'next-turn', start: 0, inserted: [message] } }, { type: 'user/message', seq: 1, data: message })
    await h.ingress.catchUp([message.id])
    const restarted = createWorkspaceIngress(h.store, h.ports)
    await restarted.recover()
    expect(await restarted.status(input.epoch, input.requestId)).toEqual(canceled)
    expect(await restarted.cancelUnknown(input.epoch, input.requestId, canceled.seq)).toEqual(canceled)
    expect(await restarted.submit(input)).toEqual(canceled)
    expect(h.admitted).toEqual([])
    expect(h.calls).toHaveLength(1)
    expect(h.events).toHaveLength(2)
    expect(JSON.stringify(h.store.repos.side_effect.all())).not.toContain(input.text)
  })
  it('does not re-inject targeted input when resolving an unknown dispatch', async () => {
    const h = fixture(), input = { ...h.input(), intent: 'ticket-input' as const, ticketId: 'ticket-a' }
    let injections = 0
    const agent = { ...h.ports.agent(), inject() { injections++; throw new Error('inject uncertain') } }
    h.ports.agent = () => agent
    h.setFlush(false)
    const unknown = await h.ingress.submit(input)
    expect(unknown).toMatchObject({ stage: 'unknown', accepted: false })
    const canceled = await h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq)
    expect(canceled).toMatchObject({ stage: 'canceled', code: 'human_canceled_unknown', ticketId: 'ticket-a' })
    expect(await h.ingress.submit(input)).toEqual(canceled)
    expect(injections).toBe(1)
    expect(h.calls).toEqual([])
    expect(h.events).toEqual([])
    expect(h.admitted).toEqual([])
  })
  it('requires the exact unknown fence seq and a positive safe integer', async () => {
    const h = fixture(), input = h.input()
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input)
    for (const seq of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '2']) {
      await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, seq as number)).rejects.toMatchObject({ code: 'invalid_input', status: 400 })
    }
    for (const seq of [unknown.seq - 1, unknown.seq + 1]) {
      await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, seq)).rejects.toMatchObject({ code: 'command_conflict', status: 409 })
    }
    expect(h.ingress.journal.read(input.requestId)).toMatchObject({ stage: 'unknown', seq: unknown.seq })
    expect(await h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq)).toMatchObject({ stage: 'canceled' })
  })
  it('rechecks the exact fence seq after awaiting flush', async () => {
    const h = fixture(), input = h.input()
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input), entered = deferred<void>(), release = deferred<boolean>()
    h.ports.flush = async () => { entered.resolve(); return release.promise }
    const result = h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq).catch(error => error)
    await entered.promise
    const changed = h.ingress.journal.update(input.requestId, { error: 'dispatch_uncertain' })
    release.resolve(true)
    expect(await result).toMatchObject({ code: 'command_conflict', status: 409 })
    expect(h.ingress.journal.read(input.requestId)).toEqual(changed)
  })
  it('refuses absent commands and any non-current epoch, including archived canceled duplicates', async () => {
    const h = fixture(), input = h.input()
    await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, 1)).rejects.toMatchObject({ code: 'command_not_found', status: 404 })
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input)
    const canceled = await h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq)
    await expect(h.ingress.cancelUnknown('old', input.requestId, canceled.seq)).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    const next = bindWorkspace(h.store, 'replacement').current
    h.ports.binding = () => next
    await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, canceled.seq)).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    await expect(h.ingress.cancelUnknown(next.epoch, input.requestId, canceled.seq)).rejects.toMatchObject({ code: 'epoch_mismatch', status: 409 })
    expect(h.ingress.journal.read(input.requestId)?.seq).toBe(canceled.seq)
  })
  it.each(['received', 'queued', 'claimed', 'admitted', 'processing', 'published', 'rejected', 'canceled'] as const)('denies %s even without durable acceptance', async stage => {
    const h = fixture(), input = h.input()
    h.ingress.journal.receive(input, 'scope')
    const record = h.ingress.journal.update(input.requestId, { stage, durable: false })
    await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, record.seq)).rejects.toMatchObject({ code: 'command_cancel_denied', status: 409 })
    expect(h.ingress.journal.read(input.requestId)).toEqual(record)
    expect(h.calls).toEqual([])
    expect(h.admitted).toEqual([])
  })
  it('denies a durable unknown command', async () => {
    const h = fixture(), input = h.input()
    h.ingress.journal.receive(input, 'scope')
    const record = h.ingress.journal.update(input.requestId, { stage: 'unknown', durable: true })
    await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, record.seq)).rejects.toMatchObject({ code: 'command_cancel_denied', status: 409 })
    expect(h.ingress.journal.read(input.requestId)).toEqual(record)
  })
  it('reconciles observed queued evidence before cancellation even when its flush is false', async () => {
    const h = fixture(), input = h.input()
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input)
    h.events.push({ type: 'agent/inbox/spliced', seq: 0, data: { target: 'next-turn', start: 0, inserted: h.calls } })
    h.setFlush(false)
    await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq)).rejects.toMatchObject({ code: 'command_cancel_denied', status: 409 })
    const queued = h.ingress.journal.read(input.requestId)!
    expect(queued).toMatchObject({ stage: 'queued', durable: false, error: 'durability_unavailable' })
    await expect(h.ingress.cancelUnknown(input.epoch, input.requestId, queued.seq)).rejects.toMatchObject({ code: 'command_cancel_denied', status: 409 })
    expect(h.calls).toHaveLength(1)
    expect(h.admitted).toEqual([])
  })
  it('uses post-flush Session evidence rather than canceling an in-flight dispatch', async () => {
    const h = fixture(), input = h.input()
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input), entered = deferred<void>(), release = deferred<boolean>()
    h.ports.flush = async () => { entered.resolve(); return release.promise }
    const result = h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq).catch(error => error)
    await entered.promise
    h.events.push({ type: 'user/message', seq: 0, data: h.calls[0] })
    release.resolve(true)
    expect(await result).toMatchObject({ code: 'command_cancel_denied', status: 409 })
    expect(h.ingress.journal.read(input.requestId)).toMatchObject({ stage: 'admitted', durable: true })
    expect(h.admitted).toEqual([])
    await h.ingress.catchUp([h.calls[0].id])
    expect(h.admitted).toEqual([input.requestId])
    expect(h.calls).toHaveLength(1)
  })
  it('serializes cancellation with status/catch-up and cannot resurrect after late Session insertion', async () => {
    const h = fixture(), input = h.input()
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input), entered = deferred<void>(), release = deferred<boolean>()
    h.ports.flush = async () => { entered.resolve(); return release.promise }
    const pendingStatus = h.ingress.status(input.epoch, input.requestId)
    await entered.promise
    const pendingCancel = h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq)
    const pendingCatchUp = h.ingress.catchUp([h.calls[0].id])
    release.resolve(true)
    expect(await pendingStatus).toMatchObject({ stage: 'unknown' })
    const canceled = await pendingCancel
    expect(canceled).toMatchObject({ stage: 'canceled', code: 'human_canceled_unknown' })
    h.events.push({ type: 'user/message', seq: 0, data: h.calls[0] })
    expect(await pendingCatchUp).toMatchObject([{ stage: 'canceled' }])
    await h.ingress.recover()
    expect(await h.ingress.status(input.epoch, input.requestId)).toEqual(canceled)
    expect(h.admitted).toEqual([])
    expect(h.calls).toHaveLength(1)
  })
  it('rechecks epoch after awaiting cancellation flush', async () => {
    const h = fixture(), input = h.input()
    h.setDispatchThrows(true)
    const unknown = await h.ingress.submit(input), entered = deferred<void>(), release = deferred<boolean>()
    h.ports.flush = async () => { entered.resolve(); return release.promise }
    const result = h.ingress.cancelUnknown(input.epoch, input.requestId, unknown.seq).catch(error => error)
    await entered.promise
    const next = bindWorkspace(h.store, 'replacement').current
    h.ports.binding = () => next
    release.resolve(true)
    expect(await result).toMatchObject({ code: 'epoch_mismatch', status: 409 })
    expect(h.ingress.journal.read(input.requestId)).toMatchObject({ stage: 'unknown', seq: unknown.seq })
  })
  it.each(['published', 'rejected', 'canceled'] as const)('preserves %s committed while ingest is awaited', async stage => {
    const h = fixture(), input = h.input()
    await h.ingress.submit(input)
    h.events.push({ type: 'user/message', seq: 1, data: h.calls[0] })
    const entered = deferred<void>(), release = deferred<void>()
    h.ports.ingest = async record => {
      expect(record.stage).toBe('admitted')
      entered.resolve()
      await release.promise
    }
    const pending = h.ingress.catchUp([h.calls[0].id])
    await entered.promise
    const terminal = h.ingress.journal.update(input.requestId, { stage })
    release.resolve()
    expect(await pending).toEqual([terminal])
    expect(h.ingress.journal.read(input.requestId)).toEqual(terminal)
    expect(h.calls).toHaveLength(1)
  })
  it('validates epoch, target, UTF8 bytes, UUID, paused and model before acceptance', async () => {
    const h = fixture()
    await expect(h.ingress.submit({ ...h.input(), epoch: 'old' })).rejects.toMatchObject({ status: 409 })
    await expect(h.ingress.submit({ ...h.input(), intent: 'ticket-input', ticketId: 'foreign' })).rejects.toMatchObject({ code: 'ticket_input_denied' })
    await expect(h.ingress.submit(h.input('界'.repeat(6000)))).rejects.toMatchObject({ status: 400 })
    h.setPaused(true); await expect(h.ingress.submit(h.input())).rejects.toMatchObject({ status: 429 })
    h.setPaused(false); h.setAvailable(false); await expect(h.ingress.submit(h.input())).rejects.toMatchObject({ status: 503 })
    expect(h.calls).toHaveLength(0)
  })
  it('retains validated archive bindings and never reuses request IDs across epochs', () => {
    const h = fixture(), input = h.input(), journal = createCommandJournal(h.store)
    journal.receive(input, 'scope')
    const next = bindWorkspace(h.store, 'replacement')
    expect(next.archives).toEqual([h.binding]); expect(next.current.epoch).not.toBe(h.binding.epoch)
    expect(() => journal.receive({ ...input, epoch: next.current.epoch }, 'scope')).toThrow('request_conflict')
  })
})
