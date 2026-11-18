import { sourceId, threadKey } from '../domain/ids.js'
import { createTrigger, type Trigger } from '../domain/trigger.js'
import type { Source, ThreadContext, TriggerSink } from './types.js'

export interface SessionEventInput { readonly session: { readonly id: string }; readonly event: { readonly type: string; readonly time: number; readonly data: any } }
export interface SessionSourcePorts {
  on(name: 'session/event', listener: (session: { id: string }, event: SessionEventInput['event']) => void): (() => void)
  readThread?(key: string): Promise<readonly Trigger[]>
  reply(body: string, idempotencyKey: string): Promise<void>
  onError?(error: unknown): void
}
export class SessionSource implements Source {
  readonly id
  readonly kind = 'session' as const
  readonly attended = true
  private unsubscribe?: () => void
  private lastAt?: number
  private error?: string
  private readonly pending = new Set<Promise<void>>()
  private stopping = false
  constructor(readonly sessionId: string, private readonly ports: SessionSourcePorts, private readonly sink: TriggerSink) {
    if (!sessionId.trim()) throw new Error('session source: session id required')
    this.id = sourceId(`session:${sessionId}`)
  }
  async verify(input: unknown): Promise<boolean> {
    const row = input as SessionEventInput | undefined
    // user/message also carries injected context: source.kind=user is essential.
    return Boolean(row?.session?.id === this.sessionId && row.event?.type === 'user/message' && row.event.data?.source?.kind === 'user' && typeof row.event.data?.id === 'string')
  }
  async normalize(input: unknown): Promise<Trigger> {
    if (!await this.verify(input)) throw new Error('session source: not a direct human message')
    const { event } = input as SessionEventInput
    const text = (event.data.content ?? []).filter((block: any) => block.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
    return createTrigger({ source: this.id, externalId: event.data.id, threadKey: threadKey(this.id), actor: { id: 'human', source: this.id, bot: false }, text, at: event.time, trust: 'human', addressed: 'direct', raw: null })
  }
  /** Normalize one genuine durable human inbox insertion without fabricating user/message. */
  async normalizeInbox(input: SessionEventInput, messageId: string): Promise<Trigger> {
    if (input.session.id !== this.sessionId || input.event.type !== 'agent/inbox/spliced') throw new Error('session source: foreign inbox')
    const message = input.event.data?.inserted?.find((item: any) => item.id === messageId && item.role === 'user' && item.source?.kind === 'user')
    if (!message) throw new Error('session source: not a human inbox insertion')
    const text = (message.content ?? []).filter((block: any) => block.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
    return createTrigger({ source: this.id, externalId: message.id, threadKey: threadKey(this.id), actor: { id: 'human', source: this.id, bot: false }, text, at: input.event.time, trust: 'human', addressed: 'direct', raw: null })
  }
  async start(): Promise<void> {
    if (this.unsubscribe) return
    this.stopping = false
    this.unsubscribe = this.ports.on('session/event', (session, event) => {
      if (this.stopping) return
      const input = { session, event }
      const work = this.verify(input).then(async accepted => {
        if (!accepted || this.stopping) return
        const trigger = await this.normalize(input)
        if (this.stopping) return
        await this.sink(trigger)
        this.lastAt = trigger.at; this.error = undefined
      }).catch(error => { this.error = 'Source event failed'; this.ports.onError?.(error) })
      this.pending.add(work)
      void work.finally(() => this.pending.delete(work))
    })
  }
  async stop(): Promise<void> { this.stopping = true; this.unsubscribe?.(); this.unsubscribe = undefined; await Promise.allSettled([...this.pending]) }
  async health() { return { ok: !this.error, lastAt: this.lastAt, detail: this.error } }
  async readThread(key: Parameters<Source['readThread']>[0]): Promise<ThreadContext> {
    if (String(key) !== String(this.id)) throw new Error('session source: foreign thread')
    return { threadKey: key, triggers: await this.ports.readThread?.(key) ?? [] }
  }
  async reply(channel: Parameters<Source['reply']>[0], key: Parameters<Source['reply']>[1], body: string, idemKey: string): Promise<void> {
    if (channel !== 'session' || String(key) !== String(this.id)) throw new Error('session source: foreign channel')
    await this.ports.reply(body, idemKey)
  }
}
