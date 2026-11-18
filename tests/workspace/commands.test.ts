import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openStore } from '../../src/store/index.js'
import { bindWorkspace, createCommandJournal } from '../../src/workspace/commands.js'
import { createWorkspaceIngress } from '../../src/workspace/ingress.js'
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture() {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'kanban-command-')))
  const store = openStore({ dbPath: join(dir, 'state.sqlite') })
  cleanups.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('kanban-command-')) throw new Error('unsafe cleanup'); rmSync(dir, { recursive: true, force: true }) })
  cleanups.push(() => store.close())
  const binding = bindWorkspace(store, 'canonical').current, events: any[] = [], calls: any[] = []
  let flush = true, paused = false, available = true
  const agent = { session: {}, followup(message: any) { calls.push(message); events.push({ type: 'agent/inbox/spliced', seq: events.length, time: Date.now(), data: { target: 'next-turn', start: 0, inserted: [message] } }) } }
  const admitted: string[] = []
  const ports = { binding: () => binding, agent: () => agent, async readSession() { return { events } }, async flush() { return flush }, async modelAvailable() { return available }, paused: () => paused, queueLimit: 2, target: (id: string) => id === 'ticket-a' ? { threadKey: 'ticket-thread-a' } : undefined, async ingest(record: any) { admitted.push(record.requestId) } }
  const ingress = createWorkspaceIngress(store, ports)
  return { store, binding, ingress, events, calls, admitted, ports, input: (text = 'same content') => ({ epoch: binding.epoch, requestId: randomUUID(), intent: 'new-task' as const, text }), setFlush(value: boolean) { flush = value }, setPaused(value: boolean) { paused = value }, setAvailable(value: boolean) { available = value } }
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
