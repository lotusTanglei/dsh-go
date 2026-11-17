import { describe, expect, it } from 'vitest'
import {
  createTrigger, sourceId, threadKey, createThread, enqueueTrigger, startEvaluation, finishEvaluation, evalId,
  createEval, decideEval, markDecided, createPolicy, ticketId, decisionId, assignmentId, createTicket, transition,
  createAssignment, transitionAssignment, canInvokeAssignmentTool, createOutbound, markOutboundSent, validateTicketBrief,
  grantMandate, canGrant, canWithdraw, revalidate,
  invariantI1UniqueTriggers, invariantI2OneTicketPerTrigger, invariantI3SingleRunningEval, invariantI4CurrentPolicy,
  invariantI5MandatePolicy, invariantI6HumanOnlyResume, invariantI7CurrentAssignment, invariantI8OutboundIdempotent,
  invariantI9MandatePersists, invariantI10EndedAssignmentDenied, isOrphan,
  type Policy, type Ticket, type TicketBrief, type Assignment, type Decision,
} from '../../src/domain/index.js'

const source = sourceId('session:test')
const baseBrief: TicketBrief = {
  goal: 'do thing', scope: { repo: 'repo', subdirs: ['src'] }, base: { ref: 'main', requireCleanTree: true },
  allowWrite: ['src/**'], denyWrite: ['.git/**'], runtime: 'node', acceptance: [{ id: 'A1', check: 'test -f result', kind: 'assertion' }],
  outOfScope: [], blockers: ['unknown'], firstAction: 'inspect', approvalsRequired: [],
}
const budgets = { maxWorkers: 2, maxStepsPerTicket: 5, maxTokensPerTicket: 1000, maxDurationMsPerTicket: 1000, maxRetries: 2, queueLimit: 10, watchdog: { intervalMs: 100, stallMs: 500, repeatCallThreshold: 3 } }
const policyWithoutVersion = { acceptedSources: [source], acceptMode: 'auto' as const, confirm: 'when-ambiguous' as const, bots: 'deny' as const, paused: false, evalTimeoutMs: 100, budgets }
const policy: Policy = createPolicy(policyWithoutVersion)
const mandate = { strength: 'explicit' as const, policyVersion: policy.version, grantedBy: { id: 'human', source, bot: false }, at: 1, scope: 'repo', via: 'addressed' as const, rules: ['accept'] }

function ticket(state: Ticket['state'] = 'open'): Ticket {
  return createTicket({ id: ticketId('t1'), threadKey: threadKey('session:test:thread'), decisionId: decisionId('d1'), mandate, brief: baseBrief, title: 'title', workdir: '/tmp/t', createdAt: 1, state })
}
function assignment(): Assignment {
  return transitionAssignment(createAssignment({ id: assignmentId('a1'), ticketId: ticketId('t1'), sessionId: 's', createdAt: 1 }), { type: 'start', at: 2 })
}
function decision(id: string, ticketIdValue?: string, triggerIds: string[] = ['tr1']): Decision {
  return { id: decisionId(id), evalId: evalId(`e-${id}`), threadKey: threadKey('th'), triggerIds: triggerIds.map((v) => v as never), policyVersion: policy.version, kind: 'accept', reason: 'ok', strength: 'explicit', at: 1, ...(ticketIdValue ? { ticketId: ticketId(ticketIdValue) } : {}) }
}

describe('I1 trigger deduplication', () => {
  it('allows unique source/external id and rejects duplicates', () => {
    const t = createTrigger({ source, externalId: 'x', threadKey: threadKey('th'), actor: { id: 'u', source, bot: false }, text: 'x', at: 1, trust: 'human', addressed: 'direct', raw: {} })
    expect(invariantI1UniqueTriggers([t])).toBe(true)
    expect(invariantI1UniqueTriggers([t, t])).toBe(false)
  })
})

describe('I2 accepted mapping', () => {
  it('rejects two tickets created from decisions sharing one trigger', () => {
    expect(invariantI2OneTicketPerTrigger([decision('d1', 't1'), decision('d2', 't2')], [])).toBe(false)
    expect(invariantI2OneTicketPerTrigger([decision('d1', 't1'), decision('d2', 't1')], [])).toBe(true)
  })
})

describe('I3 thread evaluation', () => {
  it('tracks exact running Eval id and queues concurrent triggers', () => {
    const first = createTrigger({ source, externalId: '1', threadKey: threadKey('th'), actor: { id: 'u', source, bot: false }, text: 'a', at: 1, trust: 'human', addressed: 'direct', raw: {} })
    const second = createTrigger({ source, externalId: '2', threadKey: threadKey('th'), actor: { id: 'u', source, bot: false }, text: 'b', at: 2, trust: 'human', addressed: 'direct', raw: {} })
    const thread = startEvaluation(enqueueTrigger(createThread({ source, kind: 'session', id: 'th', address: {} }, 0), first), evalId('e1'), [first.id])
    const queued = enqueueTrigger(thread, second)
    expect(() => startEvaluation(queued, evalId('e2'))).toThrow()
    expect(invariantI3SingleRunningEval([{ id: evalId('e1'), threadKey: queued.key, state: 'running' }], [{ key: queued.key, evaluating: evalId('e1') }])).toBe(true)
    expect(invariantI3SingleRunningEval([{ id: evalId('e1'), threadKey: queued.key, state: 'running' }], [{ key: queued.key, evaluating: evalId('other') as never }])).toBe(false)
    expect(finishEvaluation(queued, evalId('e1')).evaluating).toBeUndefined()
  })
})

describe('I4 policy version', () => {
  it('rejects stale decisions and emits a 64-hex policy hash', () => {
    expect(policy.version).toMatch(/^[0-9a-f]{64}$/)
    const ev = createEval({ id: evalId('e1'), threadKey: threadKey('th'), policyVersion: policy.version, triggerIds: [], startedAt: 1, deadline: 10 })
    expect(decideEval(ev, { id: decisionId('d1'), kind: 'ignore', reason: 'no', strength: 'inferred', at: 2 }, policy).policyVersion).toBe(policy.version)
    expect(() => decideEval(ev, { id: decisionId('d2'), kind: 'ignore', reason: 'no', strength: 'inferred', at: 2 }, { ...policy, version: 'stale' })).toThrow()
    expect(invariantI4CurrentPolicy(ev, policy)).toBe(true)
    expect(markDecided(ev, policy.version).state).toBe('decided')
  })
})

describe('I5 mandate mutation gates', () => {
  it('permits only current accept grant, explicit human stop withdrawal, or failed revalidation', () => {
    const accept = { kind: 'accept' as const, policyVersion: policy.version, strength: 'explicit' as const }
    expect(canGrant(accept, policy)).toBe(true)
    expect(canGrant({ ...accept, kind: 'ignore' }, policy)).toBe(false)
    expect(canGrant({ ...accept, policyVersion: 'old' }, policy)).toBe(false)
    expect(invariantI5MandatePolicy('grant', { accepted: true, policyVersion: policy.version, currentPolicyVersion: policy.version })).toBe(true)
    expect(invariantI5MandatePolicy('grant', { accepted: false, policyVersion: policy.version, currentPolicyVersion: policy.version })).toBe(false)
    expect(canWithdraw({ trust: 'human', explicitStop: true })).toBe(true)
    expect(canWithdraw({ trust: 'human', explicitStop: false })).toBe(false)
    expect(canWithdraw({ trust: 'bot', explicitStop: true })).toBe(false)
    expect(invariantI5MandatePolicy('withdraw', { humanStop: true })).toBe(true)
    expect(invariantI5MandatePolicy('revalidate', { revalidated: true, valid: false })).toBe(true)
    expect(invariantI5MandatePolicy('revalidate', { revalidated: true, valid: true })).toBe(false)
    expect(grantMandate({ decision: accept, grantedBy: mandate.grantedBy, at: 1, scope: 'repo', via: 'addressed', rules: [] }, policy).policyVersion).toBe(policy.version)
  })
})

describe('I6 Ticket resume and I7 assignment reports', () => {
  it('resumes only by human and never after a human stop', () => {
    const started = transition(ticket(), { type: 'assignment_start', assignmentId: assignmentId('a1'), at: 2, hasCapacity: true })
    const waiting = transition(started, { type: 'waiting', at: 3, attention: { id: 'q', question: 'need input' } })
    const running = transition(waiting, { type: 'human_answer', at: 4, trust: 'human' })
    const ended = transition(running, { type: 'end', at: 5, by: 'executor', outcome: 'completed' })
    expect(() => transition(ended, { type: 'resume', at: 6, trust: 'bot', mandateValid: true, hasPendingInput: true })).toThrow()
    expect(transition(ended, { type: 'resume', at: 6, trust: 'human', mandateValid: true, hasPendingInput: true }).state).toBe('open')
    const stopped = transition(running, { type: 'end', at: 7, by: 'human', outcome: 'stopped' })
    expect(stopped.stoppedByHuman).toBe(true)
    expect(() => transition(stopped, { type: 'resume', at: 8, trust: 'human', mandateValid: true, hasPendingInput: true })).toThrow()
    expect(invariantI6HumanOnlyResume({ state: 'ended', stoppedByHuman: false }, 'bot')).toBe(false)
    expect(invariantI6HumanOnlyResume({ state: 'ended', stoppedByHuman: false }, 'human')).toBe(true)
  })
  it('accepts only current assignment reports', () => {
    const started = transition(ticket(), { type: 'assignment_start', assignmentId: assignmentId('a1'), at: 2, hasCapacity: true })
    const a = assignment()
    expect(invariantI7CurrentAssignment(started, a, assignmentId('a1'))).toBe(true)
    expect(invariantI7CurrentAssignment(started, a, assignmentId('old') as never)).toBe(false)
  })
})

describe('I8 outbound and I9 mandate persistence', () => {
  it('sends one idempotency key and preserves mandate across policy change', () => {
    const out = createOutbound({ id: 'o1', channel: 'session', threadKey: threadKey('th'), kind: 'reply', body: 'ok', idempotencyKey: 'k1', nextAt: 1 })
    expect(markOutboundSent(out).state).toBe('sent')
    expect(invariantI8OutboundIdempotent([out, { idempotencyKey: 'k2' }])).toBe(true)
    expect(invariantI8OutboundIdempotent([out, { idempotencyKey: 'k1' }])).toBe(false)
    const changedPolicy = createPolicy({ ...policyWithoutVersion, paused: true })
    const stillSame = { ...mandate }
    expect(invariantI9MandatePersists(mandate, stillSame)).toBe(true)
    expect(invariantI9MandatePersists(mandate, { policyVersion: changedPolicy.version })).toBe(false)
    expect(revalidate(mandate, { version: changedPolicy.version, acceptedSources: [] }).mandate.policyVersion).toBe(policy.version)
  })
})

describe('I11 orphan assignments and D5 mandate export surface', () => {
  it('identifies absent live sessions and keeps live assignments non-orphaned', () => {
    const pending = createAssignment({ id: assignmentId('orphan'), ticketId: ticketId('t1'), sessionId: 'gone', createdAt: 1 })
    const running = transitionAssignment(pending, { type: 'start', at: 2 })
    expect(isOrphan(running, new Set())).toBe(true)
    expect(isOrphan(running, new Set(['gone']))).toBe(false)
  })
  it('requires a non-empty ending reason for ended assignments', () => {
    const pending = createAssignment({ id: assignmentId('ended-reason'), ticketId: ticketId('t1'), sessionId: 'live', createdAt: 1 })
    const running = transitionAssignment(pending, { type: 'start', at: 2 })
    expect(() => transitionAssignment(running, { type: 'end', at: 3 })).toThrow('endedReason')
    expect(() => transitionAssignment(running, { type: 'end', at: 3, reason: '  ' })).toThrow('endedReason')
    expect(transitionAssignment(running, { type: 'end', at: 3, reason: 'completed' }).endedReason).toBe('completed')
  })
  it('exposes exactly the three mandate mutation entry points', async () => {
    const mandateModule = await import('../../src/domain/mandate.js')
    expect(Object.keys(mandateModule).sort()).toEqual(['canGrant', 'canWithdraw', 'grantMandate', 'revalidate', 'withdrawMandate'].sort())
    const mutators = Object.keys(mandateModule).filter((name) => ['grantMandate', 'withdrawMandate', 'revalidate'].includes(name)).sort()
    expect(mutators).toEqual(['grantMandate', 'revalidate', 'withdrawMandate'])
    expect(Object.keys(mandateModule).some((name) => /^(mutate|update|set|replace|revoke|invalidate)/i.test(name))).toBe(false)
  })
})

describe('I10 tool gate and rev2 brief', () => {
  it('denies ended, ended-assignment, and stale bindings', () => {
    const started = transition(ticket(), { type: 'assignment_start', assignmentId: assignmentId('a1'), at: 2, hasCapacity: true })
    const a = assignment()
    expect(canInvokeAssignmentTool(started, a, assignmentId('a1'))).toBe(true)
    expect(canInvokeAssignmentTool({ ...started, state: 'ended' }, a, assignmentId('a1'))).toBe(false)
    expect(canInvokeAssignmentTool(started, { ...a, state: 'ended' }, assignmentId('a1'))).toBe(false)
    expect(canInvokeAssignmentTool(started, a, assignmentId('old') as never)).toBe(false)
    expect(invariantI10EndedAssignmentDenied({ ...started, state: 'ended' }, a)).toBe(true)
  })
  it('requires all TicketBrief fields and executable criteria', () => {
    expect(validateTicketBrief(baseBrief)).toBe(true)
    expect(validateTicketBrief({ ...baseBrief, base: { ref: 'main', requireCleanTree: undefined as never } })).toBe(false)
    expect(validateTicketBrief({ ...baseBrief, acceptance: [{ id: '', check: '', kind: 'assertion' }] })).toBe(false)
  })
})
