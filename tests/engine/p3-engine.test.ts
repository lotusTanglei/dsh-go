import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStore, type Store } from '../../src/store/index.js'
import { createPolicy, sourceId, threadKey, type Policy } from '../../src/domain/index.js'
import { createTrigger } from '../../src/domain/trigger.js'
import { ingestTrigger, ackDelivery } from '../../src/engine/intake.js'
import { startEval, settleEval, expireAndRequeue } from '../../src/engine/eval.js'
import { enqueueOutbox, drainOutbox } from '../../src/engine/outbox.js'
import { setPaused, isPaused, pendingTriggers } from '../../src/engine/pause.js'
import { reconcile } from '../../src/engine/recovery.js'
import { ticketId, assignmentId } from '../../src/domain/ids.js'
import { evaluateThread } from '../../src/engine/eval.js'
import { FakeSource } from '../../src/sources/fake.js'

const dirs: string[] = []
function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'p3-engine-')); dirs.push(dir)
  return openStore({ dbPath: join(dir, 'state.sqlite') })
}
function policy(extra: Partial<Pick<Policy, 'paused'>> = {}): Policy {
  return createPolicy({ acceptedSources: [sourceId('session:test')], acceptMode: 'auto', confirm: 'never', bots: 'deny', paused: false, evalTimeoutMs: 10, budgets: { maxWorkers: 2, maxStepsPerTicket: 5, maxTokensPerTicket: 1000, maxDurationMsPerTicket: 1000, maxRetries: 2, queueLimit: 20, watchdog: { intervalMs: 10, stallMs: 100, repeatCallThreshold: 3 } }, ...extra })
}
function trigger(id: string, at = 1) {
  const source = sourceId('session:test')
  return createTrigger({ source, externalId: id, threadKey: threadKey('session:test'), actor: { id: 'human', source, bot: false }, text: id, at, trust: 'human', addressed: 'direct', raw: null })
}
const brief = { goal: 'ship', scope: { repo: 'repo', subdirs: ['src'] }, base: { ref: 'main', requireCleanTree: true }, allowWrite: ['src/**'], denyWrite: [], runtime: 'node', acceptance: [{ id: 'A1', check: 'test', kind: 'assertion' as const }], outOfScope: [], blockers: [], firstAction: 'inspect', approvalsRequired: [] }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('P3 engine persistence', () => {
  it('deduplicates and keeps paused triggers pending (never consumed/delivered)', () => {
    const store = makeStore(); const p = policy(); setPaused(store, true, { now: () => 2 })
    const first = ingestTrigger(store, trigger('m1'), { policy: p, now: () => 2 })
    expect(first.status).toBe('accepted')
    expect(ingestTrigger(store, trigger('m1'), { policy: p, now: () => 2 }).status).toBe('duplicate')
    expect(pendingTriggers(store)).toHaveLength(1)
    expect(store.db.prepare('SELECT state FROM thread_trigger').get()).toEqual({ state: 'pending' })
    expect(store.db.prepare('SELECT delivered_to FROM trigger_disposition').get()).toEqual({ delivered_to: null })
    store.close()
  })

  it('accepts a new fake Source without engine changes and three duplicates produce one Trigger and one Ticket', async () => {
    const store = makeStore(); const p = policy()
    const fake = new FakeSource(sourceId('session:test'), item => { ingestTrigger(store, item, { policy: p, now: () => 1 }) })
    await fake.start()
    await fake.emitMany([trigger('fake-dedup'), trigger('fake-dedup'), trigger('fake-dedup')])
    const evaluation = startEval(store, threadKey('session:test'), p, { now: () => 2 })!
    settleEval(store, evaluation.id, { kind: 'accept', reason: 'explicit task', strength: 'explicit', ticket: { title: 'Fake task', brief, mandate: { strength: 'explicit', policyVersion: p.version, grantedBy: { id: 'human', source: sourceId('session:test'), bot: false }, at: 2, scope: 'repo', via: 'addressed', rules: [] }, workdir: '/tmp/fake-task' } }, p, { now: () => 3 })
    expect(store.repos.trigger.all()).toHaveLength(1)
    expect(store.repos.ticket.all()).toHaveLength(1)
    expect(store.repos.decision.all()).toHaveLength(1)
    await fake.stop(); store.close()
  })

  it('does not let a backdated decision bypass the Host clock or a stale policy', () => {
    const store = makeStore(); const p = policy()
    ingestTrigger(store, trigger('deadline'), { policy: p, now: () => 1 })
    const evaluation = startEval(store, threadKey('session:test'), p, { now: () => 2 })!
    expect(() => settleEval(store, evaluation.id, { kind: 'ignore', reason: 'late', strength: 'inferred', at: 3 }, p, { now: () => 13 })).toThrow('deadline')
    expect(() => settleEval(store, evaluation.id, { kind: 'ignore', reason: 'old', strength: 'inferred', at: 3 }, { version: 'different' }, { now: () => 3 })).toThrow('stale policy')
    expect(store.repos.decision.all()).toHaveLength(0)
    store.close()
  })

  it('pause retains ordered pending input and resume permits one evaluation', () => {
    const store = makeStore(); const p = policy()
    setPaused(store, true, { now: () => 1 })
    ingestTrigger(store, trigger('pause-1'), { policy: p, now: () => 1 })
    ingestTrigger(store, trigger('pause-2'), { policy: p, now: () => 1 })
    expect(startEval(store, threadKey('session:test'), p, { now: () => 2 })).toBeUndefined()
    expect(isPaused(store)).toBe(true)
    setPaused(store, false, { now: () => 3 })
    expect(startEval(store, threadKey('session:test'), p, { now: () => 3 })?.triggerIds).toEqual(['session:test:pause-1', 'session:test:pause-2'])
    store.close()
  })

  it('allows one running Eval per Thread and settles accept atomically with ticket/subscription', () => {
    const store = makeStore(); const p = policy(); ingestTrigger(store, trigger('e1'), { policy: p, now: () => 1 })
    const first = startEval(store, threadKey('session:test'), p, { now: () => 2, evalId: 'eval-1' as never })!
    expect(startEval(store, threadKey('session:test'), p, { now: () => 2 })).toBeUndefined()
    const actor = { id: 'human', source: sourceId('session:test'), bot: false }
    const result = settleEval(store, first.id, { kind: 'accept', reason: 'yes', strength: 'explicit', ticket: { id: ticketId('ticket-1'), title: 'Ship', brief, mandate: { strength: 'explicit', policyVersion: p.version, grantedBy: actor, at: 2, scope: 'repo', via: 'addressed', rules: [] }, workdir: '/tmp/ticket-1' } }, p, { now: () => 3 })
    expect(result.ticketId).toBe('ticket-1')
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM ticket').get()).toEqual({ n: 1 })
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM thread_subscription').get()).toEqual({ n: 1 })
    expect(store.db.prepare('SELECT state FROM eval').get()).toEqual({ state: 'decided' })
    store.close()
  })

  it('leaves subscription Trigger pending until delivery acknowledgement', async () => {
    const store = makeStore(); const p = policy();
    store.repos.ticket.insert({ id: 'ticket-sub', thread_key: 'session:test', decision_id: 'd-sub', title: 'sub', state: 'running', mandate_json: {}, brief_json: brief, workdir: '/tmp/sub', current_assignment: 'assignment-sub', created_at: 1, updated_at: 1 })
    store.repos.assignment.insert({ id: 'assignment-sub', ticket_id: 'ticket-sub', session_id: 'worker', state: 'running', created_at: 1, last_progress_at: 1 })
    store.repos.thread_subscription.insert({ thread_key: 'session:test', ticket_id: 'ticket-sub' })
    const result = ingestTrigger(store, trigger('sub-1'), { policy: p, now: () => 2 })
    expect(result.status).toBe('subscription')
    expect(store.db.prepare('SELECT tt.state AS state, td.delivered_to AS delivered_to FROM thread_trigger tt JOIN trigger_disposition td ON tt.trigger_id = td.trigger_id').get()).toMatchObject({ state: 'pending', delivered_to: null })
    expect(ackDelivery(store, result.triggerId, assignmentId('assignment-sub'), 3)).toBe(true)
    expect(store.db.prepare('SELECT state FROM thread_trigger').get()).toEqual({ state: 'consumed' })
    store.close()
  })

  it('concurrent evaluateThread calls claim one Eval and run one evaluator', async () => {
    const store = makeStore(); const p = policy(); ingestTrigger(store, trigger('con-1'), { policy: p, now: () => 1 })
    let calls = 0
    const evaluator = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 2)); return { kind: 'ignore' as const, reason: 'conversation', strength: 'inferred' as const, at: 3 } }
    const results = await Promise.all([evaluateThread(store, threadKey('session:test'), p, evaluator, { now: () => 2 }), evaluateThread(store, threadKey('session:test'), p, evaluator, { now: () => 2 }), evaluateThread(store, threadKey('session:test'), p, evaluator, { now: () => 2 })])
    expect(calls).toBe(1)
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(store.db.prepare('SELECT state FROM eval').get()).toEqual({ state: 'decided' })
    store.close()
  })

  it('pumps triggers arriving during a running Eval after the first decision', async () => {
    const store = makeStore(); const p = policy(); ingestTrigger(store, trigger('pump-1'), { policy: p, now: () => 1 })
    let calls = 0
    const evaluator = async ({ evaluation }: { evaluation: { triggerIds: readonly unknown[] } }) => {
      calls++
      if (calls === 1) {
        ingestTrigger(store, trigger('pump-2', 2), { policy: p, now: () => 2 })
        ingestTrigger(store, trigger('pump-3', 3), { policy: p, now: () => 3 })
      }
      return { kind: 'ignore' as const, reason: `eval-${evaluation.triggerIds.join(',')}`, strength: 'inferred' as const, at: 4 }
    }
    const result = await evaluateThread(store, threadKey('session:test'), p, evaluator, { now: () => 2 })
    expect(result?.decision.triggerIds).toHaveLength(2)
    expect(calls).toBe(2)
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM thread_trigger WHERE state = 'consumed'").get()).toEqual({ n: 3 })
    store.close()
  })

  it('requeues expired Eval with same claim and bounded retry count', () => {
    const store = makeStore(); const p = policy(); ingestTrigger(store, trigger('e2'), { policy: p, now: () => 1 })
    const ev = startEval(store, threadKey('session:test'), p, { now: () => 2, evalId: 'eval-2' as never })!
    const retry = expireAndRequeue(store, ev.id, { evalTimeoutMs: 10, maxRequeues: 2 }, { now: () => 20 })!
    expect(retry.state).toBe('running'); expect(retry.requeues).toBe(1)
    expect(store.db.prepare('SELECT evaluating FROM thread').get()).toEqual({ evaluating: 'eval-2' })
    store.close()
  })

  it('outbox idempotency, exponential retry, and dead-letter', async () => {
    const store = makeStore(); const msg = { threadKey: threadKey('session:test'), channel: 'session' as const, kind: 'reply' as const, body: 'hello', idempotencyKey: 'idem-1' }
    const a = enqueueOutbox(store, msg, { now: () => 1 }); expect(enqueueOutbox(store, msg, { now: () => 1 }).id).toBe(a.id)
    let calls = 0; const result = await drainOutbox(store, { async send() { calls++; throw new Error('nope') } }, { now: () => 1, maxRetries: 2, backoffMs: 10, backoffMaxMs: 100 })
    expect(result.retried).toBe(1); expect(calls).toBe(1)
    const due = store.db.prepare('SELECT next_at, attempts FROM outbound').get() as { next_at: number; attempts: number }; expect(due).toEqual({ next_at: 11, attempts: 1 })
    const dropped = await drainOutbox(store, { async send() { throw new Error('nope') } }, { now: () => 11, maxRetries: 2, backoffMs: 10, backoffMaxMs: 100 })
    expect(dropped.dropped).toBe(1); expect(store.db.prepare('SELECT state FROM outbound').get()).toEqual({ state: 'dropped' })
    store.close()
  })

  it('recovery marks orphan assignment and requeues pending work in sequence', async () => {
    const store = makeStore(); const p = policy(); ingestTrigger(store, trigger('r1'), { policy: p, now: () => 1 })
    store.repos.ticket.insert({ id: 'ticket-r', thread_key: 'session:test', decision_id: 'd', title: 'x', state: 'running', mandate_json: {}, brief_json: brief, workdir: '/tmp/r', current_assignment: 'a-r', created_at: 1, updated_at: 1 })
    store.repos.assignment.insert({ id: 'a-r', ticket_id: 'ticket-r', session_id: 'gone', state: 'running', created_at: 1, last_progress_at: 1 })
    const queued: string[] = []; const report = await reconcile(store, { liveSessionIds: () => new Set(), enqueue: async (_thread, id) => { queued.push(String(id)) } }, { now: () => 100, evalTimeoutMs: 10 })
    expect(report.assignments.orphaned).toBe(1); expect(queued).toEqual(['session:test:r1'])
    expect(store.db.prepare('SELECT state, ended_reason FROM assignment').get()).toEqual({ state: 'ended', ended_reason: 'orphaned' })
    expect(store.db.prepare('SELECT current_assignment, state FROM ticket').get()).toEqual({ current_assignment: null, state: 'open' })
    store.close()
  })
})
