import type { SourceId, ThreadKey } from '../domain/ids.js'
import type { ChannelKind } from '../domain/outbound.js'
import type { Trigger } from '../domain/trigger.js'

export interface SourceHealth { readonly ok: boolean; readonly lastAt?: number; readonly detail?: string }
export interface ThreadContext { readonly threadKey: ThreadKey; readonly triggers: readonly Trigger[] }
export interface Channel {
  readonly id: SourceId
  reply(channel: ChannelKind, threadKey: ThreadKey, body: string, idemKey: string): Promise<void>
}
export interface Source extends Channel {
  readonly kind: 'session' | 'inbox' | 'session-work'
  readonly attended: boolean
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<SourceHealth>
  verify(input: unknown): Promise<boolean>
  normalize(input: unknown): Promise<Trigger | Trigger[]>
  readThread(threadKey: ThreadKey): Promise<ThreadContext>
}
export type TriggerSink = (trigger: Trigger) => void | Promise<void>
export interface SourceLifecycle { effect(factory: () => (() => void | Promise<void>)): unknown }
