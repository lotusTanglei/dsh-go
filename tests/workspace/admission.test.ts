import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openStore, type Store } from '../../src/store/index.js'
import { createPolicy, type Policy } from '../../src/domain/policy.js'
import { sourceId, threadKey } from '../../src/domain/ids.js'
import { createTrigger } from '../../src/domain/trigger.js'
import type { TicketBrief } from '../../src/domain/ticket.js'
import { ingestTrigger } from '../../src/engine/intake.js'
import { setPaused } from '../../src/engine/pause.js'
import { bindWorkspace, createCommandJournal, type CommandIntent, type CommandRecord } from '../../src/workspace/commands.js'
import { createAdmissionService, type AdmissionOptions, type AdmissionPlanDTO } from '../../src/workspace/admission.js'

const cleanups: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function makePolicy(extra: Partial<Omit<Policy, 'version'>> = {}): Policy {
  return createPolicy({ acceptedSources: [sourceId('session:admission-test')], acceptMode: 'auto', confirm: 'always', bots: 'deny', paused: false, evalTimeoutMs: 60_000,
    budgets: { maxWorkers: 2, maxStepsPerTicket: 5, maxTokensPerTicket: 1000, maxDurationMsPerTicket: 1000, maxRetries: 2, queueLimit: 20,
      watchdog: { intervalMs: 10, stallMs: 100, repeatCallThreshold: 3 } }, ...extra })
}
function makeBrief(): TicketBrief {
  return { goal: 'Ship the scoped change', scope: { repo: '/Users/tester/Local Projects/repo', subdirs: ['src'] }, base: { ref: 'main', requireCleanTree: true },
    allowWrite: ['src/**'], denyWrite: ['secrets/**'], runtime: 'node', acceptance: [{ id: 'A1', check: 'focused test passes', kind: 'assertion' }],
    outOfScope: ['deploy'], blockers: ['review required'], firstAction: 'inspect existing code', approvalsRequired: ['network writes'] }
}
function fixture() {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'kanban-admission-'))), path = join(dir, 'state.sqlite')
  let store: Store = openStore({ dbPath: path })
  cleanups.push(() => { if (!dir.startsWith(resolve(tmpdir()) + '/') || !dir.includes('kanban-admission-')) throw new Error('unsafe cleanup'); rmSync(dir, { recursive: true, force: true }) })
  cleanups.push(() => store.close())
  const binding = bindWorkspace(store, 'admission-test').current, policy = makePolicy()
  function admitted(intent: CommandIntent = 'new-task', input: { ingest?: boolean; thread?: string; source?: string } = {}): CommandRecord {
    const journal = createCommandJournal(store), requestId = randomUUID()
    const record = journal.receive({ epoch: binding.epoch, requestId, intent, text: 'Create one scoped task', ...(intent === 'ticket-input' ? { ticketId: 'target' } : {}) }, input.thread ?? `workspace:${requestId}`)
    if (input.ingest !== false) {
      const source = sourceId(input.source ?? 'session:admission-test')
      const result = ingestTrigger(store, createTrigger({ source, externalId: record.messageId, threadKey: threadKey(record.threadKey), actor: { id: 'human', source, bot: false },
        text: 'Synthetic ingested authoritative source message', at: Date.now(), trust: 'human', addressed: 'direct', raw: null }), { policy })
      expect(result.status).toBe('accepted')
    }
    return journal.update(record.requestId, { stage: 'processing', durable: true })
  }
  return { get store() { return store }, binding, policy, dir, admitted,
    service(extra: Partial<AdmissionOptions> = {}) {
      return createAdmissionService(store, { policy, workRoot: join(dir, 'work'), ...extra })
    }, restart() { store.close(); store = openStore({ dbPath: path }) } }
}
function approve(plan: AdmissionPlanDTO) {
  return { epoch: plan.epoch, requestId: plan.requestId, planId: plan.planId, fingerprint: plan.fingerprint, decision: 'approve' as const }
}
function counts(store: Store) {
  return { tickets: store.repos.ticket.all().length, evaluations: store.repos.eval.all().length, decisions: store.repos.decision.all().length }
}

describe('workspace immutable single-ticket admission', () => {
  it('persists one complete immutable plan without claiming an Eval, preserving legal execution paths', () => {
    const h = fixture(), command = h.admitted(), service = h.service(), brief = makeBrief()
    const proposed = service.propose(command, brief)
    expect(proposed).toMatchObject({ state: 'pending', scope: brief.scope, acceptance: brief.acceptance, risk: { blockers: brief.blockers, approvalsRequired: brief.approvalsRequired } })
    expect(proposed.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(proposed.brief.scope.subdirs)).toBe(true)
    ;(brief.scope.subdirs as string[]).push('unapproved')
    expect(proposed.brief.scope.subdirs).toEqual(['src'])
    expect(service.list(h.binding.epoch)[0]?.brief.scope.repo).toBe('/Users/tester/Local Projects/repo')
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 0, decisions: 0 })
    expect(h.store.db.prepare('SELECT state FROM thread_trigger').get()?.state).toBe('pending')
    const full = h.store.repos.kv.get(`admission-plan:v1:${proposed.planId}`)?.v as { brief: TicketBrief }
    expect(full.brief).toEqual(makeBrief())
    const detail = JSON.stringify(h.store.repos.side_effect.get(`admission:${proposed.planId}`)?.detail)
    expect(detail).not.toContain('/Users/tester'); expect(detail).not.toContain('scoped change')
    expect(service.list('archive-without-plans')).toEqual([])
  })
  it('hashes sorted object keys stably and revises pending plans rather than silently changing approval', () => {
    const h = fixture(), command = h.admitted(), service = h.service(), brief = makeBrief()
    const first = service.propose(command, brief)
    const reordered = Object.fromEntries(Object.entries(brief).reverse()) as unknown as TicketBrief
    expect(service.propose(command, reordered).planId).toBe(first.planId)
    const revised = service.propose(command, { ...brief, goal: 'Different task requires confirmation' })
    expect(revised.planId).not.toBe(first.planId); expect(revised.fingerprint).not.toBe(first.fingerprint)
    expect(h.store.repos.side_effect.get(`admission:${first.planId}`)?.state).toBe('superseded')
    expect(() => service.decide(approve(first))).toThrow('admission_not_current')
    expect(service.propose(command, { ...brief, goal: 'Different task requires confirmation' }).planId).toBe(revised.planId)
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 0, decisions: 0 })
  })
  it('checks epoch, request, current plan and fingerprint before a pending-state CAS', () => {
    const h = fixture(), service = h.service(), plan = service.propose(h.admitted(), makeBrief())
    for (const patch of [{ epoch: 'old' }, { requestId: randomUUID() }, { fingerprint: '0'.repeat(64) }]) expect(() => service.decide({ ...approve(plan), ...patch })).toThrow('admission_binding_mismatch')
    expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('pending')
    const rejected = service.decide({ ...approve(plan), decision: 'reject' })
    expect(rejected.state).toBe('rejected')
    expect(service.decide({ ...approve(plan), decision: 'reject' }).state).toBe('rejected')
    expect(() => service.decide(approve(plan))).toThrow('admission_not_pending')
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 0, decisions: 0 })
  })
  it('does not extend expired pending approval by replaying the same plan', () => {
    const h = fixture(), service = h.service({ timeoutMs: 10 }), command = h.admitted()
    const plan = service.propose(command, makeBrief())
    vi.spyOn(Date, 'now').mockReturnValue(plan.expiresAt)
    expect(service.propose(command, makeBrief()).expiresAt).toBe(plan.expiresAt)
    expect(() => service.decide(approve(plan))).toThrow('admission_expired')
    expect(() => service.decide({ ...approve(plan), decision: 'reject' })).toThrow('admission_expired')
    expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('pending')
  })
  it('requires a durable new-task command and its real ingested human trigger, never redacted-text replay', () => {
    const h = fixture(), service = h.service()
    expect(() => service.propose(h.admitted('message'), makeBrief())).toThrow('admission_new_task_required')
    expect(() => service.propose(h.admitted('ticket-input'), makeBrief())).toThrow('admission_new_task_required')
    expect(() => service.propose(h.admitted('new-task', { ingest: false }), makeBrief())).toThrow('admission_trigger_missing')
    const command = h.admitted()
    expect(() => service.propose({ ...command, threadKey: 'foreign-thread' }, makeBrief())).toThrow('admission_command_mismatch')
    createCommandJournal(h.store).update(command.requestId, { durable: false })
    expect(() => service.propose(command, makeBrief())).toThrow('admission_command_not_admitted')
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 0, decisions: 0 })
  })
  it('rejects secrets, URL contracts, malformed or non-JSON brief additions before any plan persists', () => {
    const h = fixture(), command = h.admitted(), service = h.service()
    for (const brief of [
      { ...makeBrief(), goal: 'Use Bearer abcdef-secret' },
      { ...makeBrief(), scope: { repo: 'https://private.example/repo', subdirs: ['src'] } },
      { ...makeBrief(), extra: { token: 'sensitive' } },
      { ...makeBrief(), firstAction: '' },
      { ...makeBrief(), extra: undefined },
    ]) expect(() => service.propose(command, brief)).toThrow()
    expect(service.list()).toEqual([])
  })
  it('approves through grantMandate and core Eval APIs once, with stable IDs and no implicit plan replacement', () => {
    const h = fixture(), command = h.admitted(), service = h.service(), plan = service.propose(command, makeBrief())
    const result = service.decide(approve(plan))
    expect(result).toMatchObject({ state: 'consumed', ticketId: `ticket:admission:${plan.planId}` })
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
    const ticket = h.store.repos.ticket.get(result.ticketId!)!
    expect(ticket.brief_json).toEqual(makeBrief())
    expect(ticket.mandate_json).toMatchObject({ strength: 'explicit', via: 'admission', policyVersion: h.policy.version, grantedBy: { id: 'human', source: 'session:admission-test', bot: false } })
    expect(ticket.decision_id).toBe(`decision:admission:${plan.planId}`)
    expect(h.store.repos.eval.get(`eval:admission:${plan.planId}`)?.state).toBe('decided')
    expect(service.decide(approve(plan))).toEqual(result)
    expect(service.propose(command, makeBrief()).planId).toBe(plan.planId)
    expect(() => service.propose(command, { ...makeBrief(), goal: 'A second ticket' })).toThrow('admission_plan_locked')
    expect(() => service.decide({ ...approve(plan), decision: 'reject' })).toThrow('admission_not_pending')
    expect(service.recover()).toEqual([])
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
  })
  it('respects dynamic/global pause and off/observe acceptance without changing policy', () => {
    const h = fixture(), command = h.admitted()
    let paused = true
    const service = h.service({ paused: () => paused }), plan = service.propose(command, makeBrief())
    expect(service.decide(approve(plan))).toMatchObject({ state: 'approved', blockedReason: 'admission_paused' })
    expect(() => service.propose(command, { ...makeBrief(), goal: 'Overwrite approval' })).toThrow('admission_plan_locked')
    paused = false; setPaused(h.store, true)
    expect(service.recover()[0]).toMatchObject({ state: 'approved', blockedReason: 'admission_paused' })
    setPaused(h.store, false)
    expect(service.recover()[0]?.state).toBe('consumed')
    for (const mode of ['off', 'observe'] as const) {
      const service = h.service({ policy: makePolicy({ acceptMode: mode }) }), plan = service.propose(h.admitted(), makeBrief())
      expect(service.decide(approve(plan))).toMatchObject({ state: 'approved', blockedReason: 'admission_accept_mode' })
      expect(service.recover().find(item => item.planId === plan.planId)?.state).toBe('approved')
    }
    expect(h.policy.acceptMode).toBe('auto')
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
  })
  it('does not co-consume other pending commands on a shared thread', () => {
    const h = fixture(), a = h.admitted('new-task', { thread: 'shared-thread' })
    h.admitted('new-task', { thread: 'shared-thread' })
    const service = h.service(), plan = service.propose(a, makeBrief())
    expect(() => service.decide(approve(plan))).toThrow('admission_input_ambiguous')
    expect(service.recover()[0]).toMatchObject({ state: 'approved', blockedReason: 'admission_input_ambiguous' })
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 0, decisions: 0 })
    expect(h.store.db.prepare("SELECT COUNT(*) n FROM thread_trigger WHERE state='pending'").get()?.n).toBe(2)
  })
  it('recovers an approval committed before startEval after a real SQLite reopen', () => {
    const h = fixture(), command = h.admitted(), service = h.service({ paused: () => true }), plan = service.propose(command, makeBrief())
    expect(service.decide(approve(plan)).state).toBe('approved')
    h.restart()
    expect(h.service().recover()[0]).toMatchObject({ state: 'consumed', ticketId: `ticket:admission:${plan.planId}` })
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
    expect(h.service().recover()).toEqual([])
  })
  it('recovers startEval committed before settleEval with the same Eval, never opening a second Eval', () => {
    const h = fixture(), service = h.service(), plan = service.propose(h.admitted(), makeBrief())
    const original = h.store.transaction.bind(h.store)
    let transaction = 0
    h.store.transaction = ((fn: Parameters<Store['transaction']>[0]) => { if (++transaction === 3) throw new Error('crash before settle'); return original(fn) }) as Store['transaction']
    expect(() => service.decide(approve(plan))).toThrow('crash before settle')
    h.store.transaction = original
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 1, decisions: 0 })
    h.restart()
    expect(h.service().recover()[0]?.state).toBe('consumed')
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
  })
  it('reconciles settlement committed before consumed and never settles an already-decided Eval twice', () => {
    const h = fixture(), service = h.service(), plan = service.propose(h.admitted(), makeBrief())
    const original = h.store.transaction.bind(h.store)
    let transaction = 0
    h.store.transaction = ((fn: Parameters<Store['transaction']>[0]) => { if (++transaction === 4) throw new Error('crash before consumed'); return original(fn) }) as Store['transaction']
    expect(() => service.decide(approve(plan))).toThrow('crash before consumed')
    h.store.transaction = original
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
    expect(h.store.repos.side_effect.get(`admission:${plan.planId}`)?.state).toBe('approved')
    h.restart()
    expect(h.service().recover()[0]?.state).toBe('consumed')
    expect(counts(h.store)).toEqual({ tickets: 1, evaluations: 1, decisions: 1 })
  })
  it('halts safely when a crashed running Eval expires, rather than backdating or duplicating settlement', () => {
    const h = fixture(), service = h.service(), plan = service.propose(h.admitted(), makeBrief())
    const original = h.store.transaction.bind(h.store)
    let transaction = 0
    h.store.transaction = ((fn: Parameters<Store['transaction']>[0]) => { if (++transaction === 3) throw new Error('crash'); return original(fn) }) as Store['transaction']
    expect(() => service.decide(approve(plan))).toThrow('crash')
    h.store.transaction = original
    const evaluation = h.store.repos.eval.get(`eval:admission:${plan.planId}`)!
    vi.spyOn(Date, 'now').mockReturnValue(Number(evaluation.deadline))
    expect(service.recover()[0]).toMatchObject({ state: 'approved', blockedReason: 'admission_evaluation_expired' })
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 1, decisions: 0 })
  })
  it('does not reinterpret approved work under a new policy or a replaced canonical Session epoch', () => {
    const h = fixture(), service = h.service({ paused: () => true }), plan = service.propose(h.admitted(), makeBrief())
    service.decide(approve(plan))
    expect(h.service({ policy: makePolicy({ confirm: 'never' }) }).recover()[0]).toMatchObject({ state: 'approved', blockedReason: 'admission_policy_changed' })
    bindWorkspace(h.store, 'replacement-session')
    expect(h.service().recover()[0]).toMatchObject({ state: 'approved', blockedReason: 'admission_epoch_changed' })
    expect(counts(h.store)).toEqual({ tickets: 0, evaluations: 0, decisions: 0 })
  })
})
