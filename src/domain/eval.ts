import type { DecisionId, EvalId, ThreadKey, TriggerId, TicketId } from './ids.js'
import type { Policy } from './policy.js'
import { decisionId as makeDecisionId } from './ids.js'

export type EvalState = 'running' | 'decided' | 'expired'
export type DecisionKind = 'accept' | 'ignore' | 'stop' | 'unavailable'
export type Strength = 'explicit' | 'inferred'

export interface Eval {
  readonly id: EvalId
  readonly threadKey: ThreadKey
  readonly policyVersion: string
  readonly triggerIds: readonly TriggerId[]
  readonly startedAt: number
  readonly deadline: number
  readonly state: EvalState
  readonly requeues: number
}

export interface Decision {
  readonly id: DecisionId
  readonly evalId: EvalId
  readonly threadKey: ThreadKey
  readonly triggerIds: readonly TriggerId[]
  readonly policyVersion: string
  readonly kind: DecisionKind
  readonly reason: string
  readonly strength: Strength
  readonly ticketId?: TicketId
  readonly at: number
}

export function createEval(input: Omit<Eval, 'state' | 'requeues'>): Eval {
  if (input.deadline < input.startedAt) throw new Error('eval: deadline must not precede startedAt')
  return Object.freeze({ ...input, state: 'running' as const, requeues: 0, triggerIds: Object.freeze([...input.triggerIds]) })
}

export function decideEval(evaluation: Eval, decision: Omit<Decision, 'evalId' | 'threadKey' | 'triggerIds' | 'policyVersion'>, policy: Policy): Decision {
  if (evaluation.state !== 'running') throw new Error(`eval: cannot decide ${evaluation.state}`)
  if (evaluation.policyVersion !== policy.version) throw new Error('eval: stale policy version')
  return Object.freeze({ ...decision, evalId: evaluation.id, threadKey: evaluation.threadKey, triggerIds: evaluation.triggerIds, policyVersion: evaluation.policyVersion })
}

export function markDecided(evaluation: Eval, policyVersion: string): Eval {
  if (evaluation.state !== 'running') throw new Error(`eval: cannot mark ${evaluation.state} decided`)
  if (evaluation.policyVersion !== policyVersion) throw new Error('eval: stale policy version')
  return Object.freeze({ ...evaluation, state: 'decided' as const })
}

export function expireEval(evaluation: Eval, now: number): Eval {
  if (evaluation.state !== 'running') throw new Error(`eval: cannot expire ${evaluation.state}`)
  if (now < evaluation.deadline) throw new Error('eval: deadline has not elapsed')
  return Object.freeze({ ...evaluation, state: 'expired' as const })
}

export function requeueEval(evaluation: Eval, now: number, timeoutMs: number, maxRequeues: number): Eval {
  if (evaluation.state !== 'expired') throw new Error('eval: only expired evaluations can requeue')
  if (evaluation.requeues >= maxRequeues) throw new Error('eval: requeue limit reached')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('eval: timeout must be non-negative')
  return Object.freeze({ ...evaluation, state: 'running' as const, requeues: evaluation.requeues + 1, deadline: now + timeoutMs })
}

export function unavailableDecision(evaluation: Eval, at: number, reason = 'evaluation expired'): Decision {
  if (evaluation.state !== 'expired') throw new Error('eval: unavailable requires expired evaluation')
  return Object.freeze({ id: makeDecisionId(`${evaluation.id}:unavailable:${at}`), evalId: evaluation.id, threadKey: evaluation.threadKey, triggerIds: evaluation.triggerIds, policyVersion: evaluation.policyVersion, kind: 'unavailable' as const, reason, strength: 'inferred' as const, at })
}
