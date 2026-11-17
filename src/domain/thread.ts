import type { SourceId, ThreadKey, TicketId, TriggerId, EvalId } from './ids.js'
import { threadKey as makeThreadKey } from './ids.js'

export type ThreadKind = 'session' | 'issue' | 'pr' | 'im-thread'

export interface ThreadRef {
  readonly source: SourceId
  readonly kind: ThreadKind
  readonly id: string
  readonly address: Readonly<Record<string, string>>
}

export interface Thread {
  readonly key: ThreadKey
  readonly ref: ThreadRef
  readonly createdAt: number
  readonly lastAt: number
  readonly seq: number
  readonly paused: boolean
  readonly subscriptions: readonly TicketId[]
  readonly pending: readonly TriggerId[]
  readonly evaluating?: EvalId
}

export function threadKeyOf(ref: Pick<ThreadRef, 'source' | 'id'>): ThreadKey {
  return makeThreadKey(`${ref.source}:${ref.id}`)
}

export function createThread(ref: ThreadRef, at: number): Thread {
  if (!Number.isFinite(at)) throw new Error('thread: at must be finite')
  return Object.freeze({
    key: threadKeyOf(ref), ref: Object.freeze({ ...ref, address: Object.freeze({ ...ref.address }) }),
    createdAt: at, lastAt: at, seq: 0, paused: false, subscriptions: Object.freeze([] as TicketId[]), pending: Object.freeze([] as TriggerId[]),
  })
}

export function enqueueTrigger(thread: Thread, trigger: Pick<{ id: TriggerId; at: number }, 'id' | 'at'>): Thread {
  const pending = [...thread.pending, trigger.id]
  return Object.freeze({ ...thread, pending: Object.freeze(pending), lastAt: Math.max(thread.lastAt, trigger.at), seq: thread.seq + 1 })
}

export function startEvaluation(thread: Thread, id: EvalId, triggerIds?: readonly TriggerId[]): Thread {
  if (thread.paused) throw new Error(`thread: ${thread.key} is paused`)
  if (thread.evaluating) throw new Error(`thread: ${thread.key} already evaluating ${thread.evaluating}`)
  const pending = triggerIds ? thread.pending.filter((t) => !triggerIds.includes(t)) : []
  return Object.freeze({ ...thread, evaluating: id, pending: Object.freeze(pending) })
}

export function finishEvaluation(thread: Thread, evalId: EvalId): Thread {
  if (thread.evaluating !== evalId) throw new Error(`thread: evaluation mismatch; expected ${String(thread.evaluating)} got ${String(evalId)}`)
  const { evaluating: _ignored, ...rest } = thread
  return Object.freeze(rest)
}

export function setThreadPaused(thread: Thread, paused: boolean): Thread {
  return Object.freeze({ ...thread, paused })
}

export function subscribeThread(thread: Thread, ticket: TicketId): Thread {
  if (thread.subscriptions.includes(ticket)) return thread
  return Object.freeze({ ...thread, subscriptions: Object.freeze([...thread.subscriptions, ticket]) })
}

export function unsubscribeThread(thread: Thread, ticket: TicketId): Thread {
  return Object.freeze({ ...thread, subscriptions: Object.freeze(thread.subscriptions.filter((id) => id !== ticket)) })
}
