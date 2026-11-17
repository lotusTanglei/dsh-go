import type { SourceId, ThreadKey, TriggerId, EvalId, DecisionId, TicketId, AssignmentId } from './ids.js'
import { threadKey as makeThreadKey, triggerId as makeTriggerId } from './ids.js'
import { snapshot } from './immutable.js'

export type Trust = 'human' | 'bot' | 'ci' | 'system'
export type Addressed = 'direct' | 'mention' | 'none'

export interface Actor {
  readonly id: string
  readonly source: SourceId
  readonly bot: boolean
}

export interface Trigger {
  readonly id: TriggerId
  readonly source: SourceId
  readonly externalId: string
  readonly threadKey: ThreadKey
  readonly actor: Actor
  readonly text: string
  readonly at: number
  readonly trust: Trust
  readonly addressed: Addressed
  readonly raw: unknown
}

export interface TriggerDisposition {
  readonly triggerId: TriggerId
  readonly at: number
  readonly filtered?: Reason
  readonly evalId?: EvalId
  readonly decisionId?: DecisionId
  readonly ticketId?: TicketId
  readonly deliveredTo?: AssignmentId
  readonly requeued?: boolean
  readonly ackedBy?: string
}

export type Reason = 'not-addressed' | 'untrusted' | 'suspicious' | 'paused' | 'queue-full' | string

export interface TriggerInput {
  readonly source: SourceId
  readonly externalId: string
  readonly threadKey?: ThreadKey
  readonly threadRef?: { readonly source: SourceId; readonly kind: string; readonly id: string }
  readonly actor: Actor
  readonly text: string
  readonly at: number
  readonly trust: Trust
  readonly addressed: Addressed
  readonly raw: unknown
}

/** Construct an immutable trigger. The id is the source/external id deduplication key. */
export function createTrigger(input: TriggerInput): Trigger {
  const key = input.threadKey ?? (input.threadRef ? makeThreadKey(`${input.threadRef.source}:${input.threadRef.id}`) : undefined)
  if (!key) throw new Error('trigger: threadKey or threadRef is required')
  if (!input.externalId) throw new Error('trigger: externalId is required')
  if (!Number.isFinite(input.at) || !Number.isInteger(input.at) || input.at < 0) throw new Error('trigger: at must be a non-negative integer epoch milliseconds')
  return snapshot({ ...input, id: makeTriggerId(`${input.source}:${input.externalId}`), threadKey: key })
}

export function triggerDedupKey(trigger: Pick<Trigger, 'source' | 'externalId'>): string {
  return `${trigger.source}:${trigger.externalId}`
}

export function validateTrigger(trigger: Trigger): boolean {
  return Boolean(trigger.id && trigger.source && trigger.externalId && trigger.threadKey && trigger.actor && Number.isFinite(trigger.at))
}
