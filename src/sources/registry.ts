import type { SourceId } from '../domain/ids.js'
import type { Source, SourceLifecycle } from './types.js'

/** Keys are exact instance ids; multiple instances of one kind may coexist. */
export class SourceRegistry {
  private readonly sources = new Map<SourceId, Source>()
  private readonly disposers = new Map<SourceId, () => Promise<void>>()
  constructor(private readonly lifecycle?: SourceLifecycle) {}
  register(source: Source): () => Promise<void> {
    if (!source.id.trim()) throw new Error('source: instance id is required')
    if (this.sources.has(source.id)) throw new Error(`source: duplicate instance id ${source.id}`)
    this.sources.set(source.id, source)
    let removed = false
    const dispose = async () => {
      if (removed) return
      removed = true
      this.sources.delete(source.id)
      this.disposers.delete(source.id)
      await source.stop()
    }
    this.disposers.set(source.id, dispose)
    this.lifecycle?.effect(() => dispose)
    return dispose
  }
  get(id: SourceId): Source | undefined { return this.sources.get(id) }
  all(): readonly Source[] { return [...this.sources.values()] }
  async stopAll(): Promise<void> {
    const disposers = [...this.disposers.values()]
    const outcomes = await Promise.allSettled(disposers.map(dispose => dispose()))
    const errors = outcomes.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
    if (errors.length) throw new AggregateError(errors.map(entry => entry.reason), 'source: stop failed')
  }
}
