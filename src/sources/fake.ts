import type { SourceId, ThreadKey } from '../domain/ids.js'
import { validateTrigger, type Trigger } from '../domain/trigger.js'
import type { Source, TriggerSink } from './types.js'

/** Fixture adapter: excluded from distributable output by the build configuration. */
export class FakeSource implements Source {
  readonly kind = 'inbox' as const
  readonly attended = false
  private running = false
  private failures = 0
  private normalizeFailures = 0
  private readonly history: Trigger[] = []
  readonly replies = new Map<string, string>()
  constructor(readonly id: SourceId, private readonly sink: TriggerSink) {}
  async start() { this.running = true }
  async stop() { this.running = false }
  async health() { return { ok: this.running, lastAt: this.history.at(-1)?.at } }
  async verify(input: unknown) { return validateTrigger(input as Trigger) && (input as Trigger).source === this.id }
  async normalize(input: unknown): Promise<Trigger> {
    if (this.normalizeFailures > 0) { this.normalizeFailures--; throw new Error('fake normalize failure') }
    if (!await this.verify(input)) throw new Error('fake source: invalid trigger')
    return input as Trigger
  }
  failNext(n: number) { if (!Number.isSafeInteger(n) || n < 0) throw new Error('fake source: invalid failure count'); this.failures = n }
  failNormalizeNext(n: number) { if (!Number.isSafeInteger(n) || n < 0) throw new Error('fake source: invalid failure count'); this.normalizeFailures = n }
  async emit(input: Trigger) {
    if (!this.running) throw new Error('fake source: not started')
    const trigger = await this.normalize(input)
    this.history.push(trigger)
    await this.sink(trigger)
  }
  async emitMany(input: readonly Trigger[]) { for (const trigger of input) await this.emit(trigger) }
  async readThread(key: ThreadKey) { return { threadKey: key, triggers: this.history.filter(trigger => trigger.threadKey === key).sort((a, b) => a.at - b.at) } }
  async reply(_channel: Parameters<Source['reply']>[0], _key: ThreadKey, body: string, idemKey: string) {
    if (this.failures > 0) { this.failures--; throw new Error('fake reply failure') }
    if (!this.replies.has(idemKey)) this.replies.set(idemKey, body)
  }
}
