import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStore, type Store } from '../../src/store/index.js'
import { encodeJson } from '../../src/store/codec.js'
import { createPolicy } from '../../src/domain/policy.js'
import { sourceId, threadKey } from '../../src/domain/ids.js'
import { createTrigger } from '../../src/domain/trigger.js'
import type { TicketBrief } from '../../src/domain/ticket.js'
import { ingestTrigger } from '../../src/engine/intake.js'
import { createAdmissionService, type AdmissionPlanDTO } from '../../src/workspace/admission.js'
import { bindWorkspace, commandDigest, commandError, createCommandJournal, validateCommand, type WorkspaceCommand } from '../../src/workspace/commands.js'
import { createWorkspaceIngress, type IngressPorts } from '../../src/workspace/ingress.js'
import { validDocumentOrigin, type DocumentOrigin, type DocumentOriginAuthority } from '../../src/workspace/document-origin.js'

const cleanups: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const origin = (patch: Partial<DocumentOrigin> = {}): DocumentOrigin => ({ kind: 'wecom-document', itemKey: '1'.repeat(64), revision: '2'.repeat(64), evidenceDigest: '3'.repeat(64), configVersion: '4'.repeat(64), ...patch })
const brief = (): TicketBrief => ({ goal: 'Review selected item', scope: { repo: '/Users/tester/repo', subdirs: ['src'] }, base: { ref: 'main', requireCleanTree: true }, allowWrite: ['src/**'], denyWrite: ['secrets/**'], runtime: 'node', acceptance: [{ id: 'A1', check: 'focused proof passes', kind: 'assertion' }], outOfScope: ['deploy'], blockers: [], firstAction: 'inspect evidence', approvalsRequired: [] })
const approve = (plan: AdmissionPlanDTO) => ({ epoch: plan.epoch, requestId: plan.requestId, planId: plan.planId, fingerprint: plan.fingerprint, decision: 'approve' as const })
function fixture() {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'kanban-document-origin-'))), path = join(dir, 'state.sqlite')
  let store: Store = openStore({ dbPath: path })
  cleanups.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('kanban-document-origin-')) throw new Error('unsafe cleanup'); rmSync(dir, { recursive: true, force: true }) })
  cleanups.push(() => store.close())
  const binding = bindWorkspace(store, 'origin-test').current, source = sourceId('session:origin-test')
  const policy = createPolicy({ acceptedSources: [source], acceptMode: 'auto', confirm: 'always', bots: 'deny', paused: false, evalTimeoutMs: 60_000, budgets: { maxWorkers: 2, maxStepsPerTicket: 5, maxTokensPerTicket: 1000, maxDurationMsPerTicket: 1000, maxRetries: 2, queueLimit: 20, watchdog: { intervalMs: 10, stallMs: 100, repeatCallThreshold: 3 } } })
  let invalid: string | undefined
  const validate = vi.fn((value: DocumentOrigin, requestId: string) => {
    if (invalid) return commandError(invalid)
    if (value.itemKey !== origin().itemKey || value.revision !== origin().revision || value.evidenceDigest !== origin().evidenceDigest || value.configVersion !== origin().configVersion) return commandError('document_origin_stale')
    const claim = store.repos.kv.get(`test:claim:${value.itemKey}`)?.v as { requestId: string } | undefined
    if (claim && claim.requestId !== requestId) return commandError('document_origin_claimed')
  })
  const reserve = vi.fn((value: DocumentOrigin, requestId: string) => {
    validate(value, requestId)
    store.repos.kv.insertOrIgnore({ k: `test:claim:${value.itemKey}`, v: { requestId } })
  })
  const link = vi.fn((value: DocumentOrigin, requestId: string, ticketId: string) => {
    const claim = store.repos.kv.get(`test:claim:${value.itemKey}`)?.v as { requestId: string; ticketId?: string } | undefined
    if (!claim || claim.requestId !== requestId || claim.ticketId && claim.ticketId !== ticketId) return commandError('document_origin_claimed')
    store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson({ requestId, ticketId }, false), `test:claim:${value.itemKey}`)
  })
  const authority: DocumentOriginAuthority = { validate, reserve, link, context: vi.fn(() => ({ trust: 'untrusted', text: 'external evidence' })) }
  const input = (documentOrigin?: DocumentOrigin): WorkspaceCommand => ({ epoch: binding.epoch, requestId: randomUUID(), intent: 'new-task', text: 'Generate a reviewable plan, not execution', ...(documentOrigin ? { documentOrigin } : {}) })
  function admitted(documentOrigin?: DocumentOrigin) {
    const value = input(documentOrigin), journal = createCommandJournal(store)
    if (documentOrigin) reserve(documentOrigin, value.requestId)
    const record = journal.receive(value, `workspace:${value.requestId}`)
    expect(ingestTrigger(store, createTrigger({ source, externalId: record.messageId, threadKey: threadKey(record.threadKey), actor: { id: 'human', source, bot: false }, text: value.text, at: Date.now(), trust: 'human', addressed: 'direct', raw: null }), { policy }).status).toBe('accepted')
    return journal.update(record.requestId, { stage: 'processing', durable: true })
  }
  function ingress(withAuthority = true) {
    const documentOrigins = withAuthority ? authority : undefined
    const events: any[] = [], calls: any[] = [], admittedCalls: string[] = []
    const agent = { session: {}, followup(message: any) { calls.push(message); events.push({ type: 'agent/inbox/spliced', seq: events.length, time: Date.now(), data: { target: 'next-turn', start: 0, inserted: [message] } }) } }
    const ports: IngressPorts = { binding: () => binding, agent: () => agent, async readSession() { return { events } }, async flush() { return true }, async modelAvailable() { return true }, paused: () => false, queueLimit: 20, target: () => undefined, async ingest(record) { admittedCalls.push(record.requestId) }, documentOrigins }
    return { ingress: createWorkspaceIngress(store, ports), ports, calls, events, admittedCalls }
  }
  return { get store() { return store }, dir, binding, policy, authority, validate, reserve, link, input, admitted, ingress,
    service(withAuthority = true, paused?: () => boolean) { return createAdmissionService(store, { policy, workRoot: join(dir, 'work'), ...(withAuthority ? { documentOrigins: authority } : {}), paused }) },
    invalidate(code = 'document_origin_stale') { invalid = code }, restart() { store.close(); store = openStore({ dbPath: path }) } }
}

describe('document provenance binds real human commands without authorizing evidence', () => {
  it('preserves legacy digest bytes and makes provenance order-independent, immutable and conflict-sensitive', () => {
    const h = fixture(), old = h.input()
    for (const value of [old, { ...old, recreateFrom: 'stopped-ticket' }]) {
      const expected = createHash('sha256').update(JSON.stringify([value.epoch, value.intent, value.text, value.ticketId ?? null, ...('recreateFrom' in value ? [value.recreateFrom] : [])])).digest('hex')
      expect(commandDigest(value)).toBe(expected)
    }
    const selected = { ...old, documentOrigin: origin() }, journal = createCommandJournal(h.store)
    const reordered = Object.fromEntries(Object.entries(origin()).reverse()) as unknown as DocumentOrigin
    expect(commandDigest({ ...selected, documentOrigin: reordered })).toBe(commandDigest(selected))
    expect(commandDigest(selected)).not.toBe(commandDigest(old))
    const record = journal.receive(selected, 'isolated')
    expect(Object.isFrozen(record.documentOrigin)).toBe(true)
    selected.documentOrigin = origin({ revision: '5'.repeat(64) })
    expect(journal.read(record.requestId)?.documentOrigin).toEqual(origin())
    expect(() => journal.receive(selected, 'isolated')).toThrow('request_conflict')
  })
  it('rejects malformed provenance and any non-new-task or recreation use', () => {
    const h = fixture(), selected = h.input(origin())
    for (const value of [
      { ...selected, documentOrigin: { ...origin(), extra: 'smuggled' } },
      { ...selected, documentOrigin: origin({ revision: 'bad' }) },
      { ...selected, documentOrigin: null },
      { ...selected, intent: 'message' },
      { ...selected, intent: 'ticket-input', ticketId: 'ticket' },
      { ...selected, recreateFrom: 'ticket' },
    ]) expect(() => validateCommand(value as WorkspaceCommand)).toThrow('invalid_command')
  })
  it('rejects getter, symbol and prototype provenance without executing an accessor', () => {
    const getter = vi.fn(() => '2'.repeat(64)), selected = origin()
    Object.defineProperty(selected, 'revision', { enumerable: true, get: getter })
    expect(validDocumentOrigin(selected)).toBe(false)
    expect(getter).not.toHaveBeenCalled()
    expect(validDocumentOrigin({ ...origin(), [Symbol('hidden')]: 'bad' })).toBe(false)
    expect(validDocumentOrigin(Object.assign(Object.create({ inherited: true }), origin()))).toBe(false)
  })
  it('accepts only the explicit local kind and binds it distinctly from the same wecom hashes without coercing objects', () => {
    const local = origin({ kind: 'local-document' }); expect(validDocumentOrigin(local)).toBe(true)
    const h = fixture(), input = h.input(local); expect(() => validateCommand(input)).not.toThrow()
    expect(commandDigest(input)).not.toBe(commandDigest({ ...input, documentOrigin: origin() }))
    const toString = vi.fn(() => 'local-document')
    expect(validDocumentOrigin({ ...local, kind: { toString } })).toBe(false); expect(toString).not.toHaveBeenCalled()
    expect(validDocumentOrigin({ ...local, kind: 'local' })).toBe(false)
  })

  it('requires authority and reserves one item/request before the only genuine human followup', async () => {
    const h = fixture(), noAuthority = h.ingress(false), selected = h.input(origin())
    await expect(noAuthority.ingress.submit(selected)).rejects.toMatchObject({ code: 'document_origin_unavailable' })
    expect(noAuthority.calls).toEqual([])
    const run = h.ingress()
    await run.ingress.submit(selected)
    expect(h.reserve).toHaveBeenCalledWith(origin(), selected.requestId)
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({ source: { kind: 'user' }, content: [{ type: 'text', text: selected.text }] })
    expect(run.calls[0].content).toHaveLength(1)
    expect(JSON.stringify(run.calls[0])).not.toContain('external evidence')
    await run.ingress.submit(selected)
    expect(run.calls).toHaveLength(1)
    await expect(run.ingress.submit(h.input(origin()))).rejects.toMatchObject({ code: 'document_origin_claimed' })
    h.invalidate()
    await expect(run.ingress.submit(selected)).rejects.toMatchObject({ code: 'document_origin_stale' })
    expect(run.calls).toHaveLength(1)
  })
  it('rechecks authority after awaited model availability and before any reservation or dispatch', async () => {
    const h = fixture(), run = h.ingress(), selected = h.input(origin())
    run.ports.modelAvailable = async () => { h.invalidate('document_origin_stopped'); return true }
    await expect(run.ingress.submit(selected)).rejects.toMatchObject({ code: 'document_origin_stopped' })
    expect(h.reserve).not.toHaveBeenCalled()
    expect(run.ingress.journal.read(selected.requestId)).toBeUndefined()
    expect(run.calls).toEqual([])
  })
  it('commits the item reservation and command receipt together or neither on an insertion failure', async () => {
    const h = fixture(), run = h.ingress(), selected = h.input(origin())
    const receive = run.ingress.journal.receive
    expect(() => receive(selected, `workspace:${selected.requestId}`, () => { h.reserve(origin(), selected.requestId); throw new Error('simulated crash before journal insert') })).toThrow('simulated crash')
    expect(h.store.repos.kv.get(`test:claim:${origin().itemKey}`)).toBeUndefined()
    expect(run.ingress.journal.read(selected.requestId)).toBeUndefined()
    await run.ingress.submit(selected)
    expect(h.store.repos.kv.get(`test:claim:${origin().itemKey}`)).toBeDefined()
    expect(run.ingress.journal.read(selected.requestId)).toBeDefined()
  })
  it('isolates a stale external command during recovery so ordinary workspace commands still reconcile', async () => {
    const h = fixture(), run = h.ingress(), selected = h.input(origin()), ordinary = h.input()
    const external = await run.ingress.submit(selected), normal = await run.ingress.submit(ordinary)
    run.events.push({type:'user/message', seq:run.events.length,time:Date.now(),data:run.calls.find(row=>row.id===external.messageId)})
    run.events.push({type:'user/message', seq:run.events.length,time:Date.now(),data:run.calls.find(row=>row.id===normal.messageId)})
    h.invalidate('document_snapshot_changed')
    await expect(run.ingress.recover()).resolves.toBeUndefined()
    expect(run.ingress.journal.read(selected.requestId)).toMatchObject({stage:'rejected',error:'document_snapshot_changed'})
    expect(run.ingress.journal.read(ordinary.requestId)?.stage).toBe('processing')
    expect(run.admittedCalls).toEqual([ordinary.requestId])
  })
  it('keeps legacy admission independent of the optional document authority', () => {
    const h = fixture(), command = h.admitted(), service = h.service(false)
    const plan = service.propose(command, brief())
    expect(plan.documentOrigin).toBeUndefined()
    const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    expect(plan.fingerprint).toBe(createHash('sha256').update(canonical({ requestId: command.requestId, brief: brief(), policy: h.policy })).digest('hex'))
    expect(service.decide(approve(plan)).state).toBe('consumed')
    expect(h.validate).not.toHaveBeenCalled()
    expect(h.link).not.toHaveBeenCalled()
  })
  it('requires fresh authority at proposal and decision without weakening the human source gate', () => {
    const h = fixture(), command = h.admitted(origin()), service = h.service()
    expect(() => h.service(false).propose(command, brief())).toThrow('document_origin_unavailable')
    const plan = service.propose(command, brief())
    expect(plan.documentOrigin).toEqual(origin())
    h.invalidate('document_origin_stopped')
    expect(() => service.propose(command, brief())).toThrow('document_origin_stopped')
    expect(() => service.decide(approve(plan))).toThrow('document_origin_stopped')
    expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('pending')
    expect(h.store.repos.ticket.all()).toEqual([])
    expect(service.decide({ ...approve(plan), decision: 'reject' }).state).toBe('rejected')
  })
  it('blocks a previously approved paused plan when its source becomes stale or stopped', () => {
    const h = fixture(), command = h.admitted(origin())
    const plan = h.service(true, () => true).propose(command, brief())
    expect(h.service(true, () => true).decide(approve(plan)).state).toBe('approved')
    h.invalidate('document_origin_stopped')
    expect(h.service().recover()).toMatchObject([{ state: 'approved', blockedReason: 'document_origin_stopped' }])
    expect(h.store.repos.ticket.all()).toEqual([])
    expect(h.store.repos.eval.all()).toEqual([])
  })
  it('checks origin again immediately before settlement, after claiming the Eval', () => {
    const h = fixture(), service = h.service(), plan = service.propose(h.admitted(origin()), brief())
    const original = h.validate.getMockImplementation()!
    let calls = 0
    h.validate.mockImplementation((value, requestId) => { if (++calls === 3) return commandError('document_origin_stopped'); return original(value, requestId) })
    expect(() => service.decide(approve(plan))).toThrow('document_origin_stopped')
    expect(h.store.repos.eval.all()).toHaveLength(1)
    expect(h.store.repos.ticket.all()).toEqual([])
    expect(h.store.repos.decision.all()).toEqual([])
  })
  it('retains the original real-human trigger gate for document-backed commands', () => {
    const h = fixture(), command = h.admitted(origin())
    h.store.db.prepare("UPDATE trigger SET trust='system', actor_bot=1 WHERE external_id=?").run(command.messageId)
    expect(() => h.service().propose(command, brief())).toThrow('admission_trigger_denied')
    expect(h.store.repos.eval.all()).toEqual([])
    expect(h.store.repos.ticket.all()).toEqual([])
  })
  it('links settlement atomically with consumed and recovers a crash without a second ticket', () => {
    const h = fixture(), command = h.admitted(origin()), service = h.service(), plan = service.propose(command, brief())
    h.link.mockImplementationOnce(() => { throw new Error('link crash') })
    expect(() => service.decide(approve(plan))).toThrow('link crash')
    expect(h.store.repos.ticket.all()).toHaveLength(1)
    expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('approved')
    h.restart()
    expect(h.service().recover()).toMatchObject([{ state: 'consumed', ticketId: `ticket:admission:${plan.planId}` }])
    expect(h.store.repos.ticket.all()).toHaveLength(1)
    const linked = h.store.repos.kv.get(`test:claim:${origin().itemKey}`)?.v
    expect(linked).toEqual({ requestId: command.requestId, ticketId: `ticket:admission:${plan.planId}` })
    h.invalidate('document_origin_stopped')
    expect(h.service().decide(approve(plan)).state).toBe('consumed')
    expect(h.service().propose(command, brief()).state).toBe('consumed')
    expect(h.store.repos.ticket.all()).toHaveLength(1)
  })
  it.each(['remove', 'change'] as const)('detects %s provenance tampering in persisted plan fingerprints', mode => {
    const h = fixture(), command = h.admitted(origin()), service = h.service(), plan = service.propose(command, brief())
    const key = `admission-plan:v1:${plan.planId}`, saved = h.store.repos.kv.get(key)?.v as any
    if (mode === 'remove') delete saved.command.documentOrigin
    else saved.command.documentOrigin.evidenceDigest = '6'.repeat(64)
    h.store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(saved, false), key)
    expect(() => service.decide(approve(plan))).toThrow('admission_record_invalid')
    expect(h.store.repos.ticket.all()).toEqual([])
  })
  it('does not accept caller provenance removal even when every original scalar binding matches', () => {
    const h = fixture(), command = h.admitted(origin())
    const { documentOrigin: _origin, ...stripped } = command
    expect(() => h.service().propose(stripped, brief())).toThrow('admission_command_mismatch')
  })
})
