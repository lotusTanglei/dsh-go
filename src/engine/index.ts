import type { Store } from '../store/index.js'
import type { Trigger } from '../domain/trigger.js'
import type { Policy } from '../domain/policy.js'
import type { ThreadKey, EvalId } from '../domain/ids.js'
import { ingestTrigger, ackDelivery, type IntakeResult } from './intake.js'
import { evaluateThread, expireAndRequeue, type Evaluation, type EvalDecisionInput, type EvalResult } from './eval.js'
import { drainOutbox, enqueueOutbox, type OutboxMessage, type OutboxOptions, type OutboxRunResult, type OutboxSender } from './outbox.js'
import { setPaused, isPaused, type PauseResult } from './pause.js'
import { reconcile, type RecoveryPorts, type RecoveryReport } from './recovery.js'

export interface EngineConfig {
  readonly policy: Pick<Policy, 'version' | 'evalTimeoutMs' | 'acceptedSources' | 'bots' | 'paused' | 'budgets'>
  readonly queueLimit?: number
  readonly maxEvalRequeues?: number
  readonly outbox?: OutboxOptions
}

export interface EnginePorts extends RecoveryPorts {
  readonly sender?: OutboxSender
  readonly evaluate?: Evaluation
}

/** Small host-facing facade; all state is persisted in the supplied Store. */
export function createEngine(store: Store, config: EngineConfig, ports: EnginePorts = {}) {
  const now = config.outbox?.now
  return {
    ingest(trigger: Trigger, scoped?: { targetTicketId: import('../domain/ids.js').TicketId }): IntakeResult {
      return ingestTrigger(store, trigger, { policy: config.policy, queueLimit: config.queueLimit, now, ...scoped })
    },
    ackDelivery(triggerId: import('../domain/ids.js').TriggerId, assignmentId: import('../domain/ids.js').AssignmentId): boolean {
      return ackDelivery(store, triggerId, assignmentId, now ? now() : Date.now())
    },
    async evaluate(threadKey: ThreadKey): Promise<EvalResult | undefined> {
      if (!ports.evaluate) throw new Error('engine: evaluate port is not configured')
      return evaluateThread(store, threadKey, config.policy, ports.evaluate, { now, maxRequeues: config.maxEvalRequeues })
    },
    enqueue(message: OutboxMessage) {
      return enqueueOutbox(store, message, { now })
    },
    async drainOutbox(): Promise<OutboxRunResult> {
      if (!ports.sender) throw new Error('engine: outbox sender port is not configured')
      return drainOutbox(store, ports.sender, config.outbox)
    },
    pause(): PauseResult {
      return setPaused(store, true, { now })
    },
    resume(): PauseResult {
      return setPaused(store, false, { now })
    },
    paused(): boolean {
      return isPaused(store)
    },
    expireEval(id: EvalId) {
      return expireAndRequeue(store, id, { evalTimeoutMs: config.policy.evalTimeoutMs, maxRequeues: config.maxEvalRequeues }, { now })
    },
    recover(): Promise<RecoveryReport> {
      return reconcile(store, ports, { now, evalTimeoutMs: config.policy.evalTimeoutMs, maxEvalRequeues: config.maxEvalRequeues })
    },
  }
}

export * from './intake.js'
export * from './eval.js'
export * from './outbox.js'
export * from './pause.js'
export * from './recovery.js'
