import { createHash } from 'node:crypto'
import { sourceId } from '../domain/ids.js'
import { redact } from '../store/codec.js'
import { WorkspaceError } from '../workspace/commands.js'
import type { Source, ThreadContext } from './types.js'

export interface SessionWorkPorts {
  listSessions(signal: AbortSignal): Promise<readonly any[]>
  read(sessionId: string, signal: AbortSignal): Promise<{ asOfSeq: number; values: Record<string, unknown> }>
  agent(sessionId: string): any
  ownedSessionIds(): readonly string[]
  canAccess(sessionId: string): boolean
  getExcluded(): readonly string[]
  setExcluded(ids: readonly string[]): void
  signal: AbortSignal
}
export interface SessionWorkItem {
  sessionId: string; title: string; objective?: string
  runtime: 'running' | 'idle' | 'unavailable' | 'unknown'
  goalPhase?: string; progress?: string; nextAction?: string; blocker?: string; decision?: string
  observedAt: number; evidence: 'structured' | 'missing' | 'unavailable'; excluded: boolean
}
export interface SessionWorkListInput { view?: 'included' | 'excluded'; cursor?: string; limit?: number }
export interface SessionWorkList {
  state: 'ready' | 'partial' | 'unavailable'; sampledAt: number; scope: 'current-host'; defaultIncluded: true
  total: number | null; excludedTotal: number | null; internalTotal: number | null
  items: SessionWorkItem[]; hasMore: boolean; next?: string; revision?: string
  error?: 'session_work_unavailable' | 'session_work_partial'
}
type Roster = { at: number; revision: string; ownedKey: string; ordinary: string[]; included: string[]; excluded: string[]; internal: string[]; partial: boolean }
const TTL = 15_000, FALLBACK = '未提供会话标题'
const idValid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value) && !value.includes('://')
const object = (value: unknown): Record<string, any> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const resync = (): never => { throw new WorkspaceError('session_work_resync', 409) }
function text(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  // Projection strings are untrusted display data, never instructions or execution input.
  return String(redact(value.slice(0, 4_096)))
    .replace(/\b(?:file|ssh|ftp):\/\/\S+|(?:https?:\/\/|www\.)\S+/gi, '[REDACTED_URL]')
    .replace(/(?:^|\s)(?:\/(?:[^\s/]+\/)*[^\s]+|[A-Z]:[\\/][^\r\n]+)/g, ' [REDACTED_PATH]')
    .replace(/\b(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_SECRET]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || undefined
}

/** Manual, read-only current-host projection. No subscriptions, prompts, triggers, or actions. */
export class SessionWorkSource implements Source {
  readonly id = sourceId('session-work:current-host')
  readonly kind = 'session-work' as const
  readonly attended = false
  private active = false
  private localAbort = new AbortController()
  private generation = 0
  private roster?: Roster
  private rosterFlight?: Promise<Roster>
  private readonly pending = new Set<Promise<unknown>>()
  private readonly reads = new Set<Promise<unknown>>()
  private readonly itemFlights = new Map<string, Promise<SessionWorkItem>>()
  private readonly items = new Map<string, { at: number; item: SessionWorkItem }>()
  private readonly labels = new Map<string, string>()
  constructor(private readonly ports: SessionWorkPorts) {}
  async start(): Promise<void> { if (!this.ports.signal.aborted) { if (this.localAbort.signal.aborted) this.localAbort = new AbortController(); this.active = true } }
  async stop(): Promise<void> {
    this.active = false; this.localAbort.abort(); this.invalidate()
    await Promise.allSettled([...this.pending])
  }
  async health() { return { ok: this.available() && Boolean(this.roster), lastAt: this.roster?.at } }
  async verify(_input: unknown): Promise<boolean> { return false }
  async normalize(_input: unknown): Promise<[]> { return [] }
  async readThread(key: Parameters<Source['readThread']>[0]): Promise<ThreadContext> {
    if (String(key) !== this.id) throw new WorkspaceError('session_work_foreign_thread', 400)
    return { threadKey: key, triggers: [] }
  }
  async reply(..._args: Parameters<Source['reply']>): Promise<void> { throw new WorkspaceError('session_work_read_only', 403) }
  summary(): Promise<SessionWorkList> { return this.list({ view: 'included', limit: 6 }) }
  list(input: SessionWorkListInput = {}): Promise<SessionWorkList> { return this.track(this.page(input)) }
  setIncluded(sessionId: string, included: boolean, input: { revision: string }): Promise<{ sessionId: string; included: boolean; revision: string }> {
    return this.track((async () => {
      if (!idValid(sessionId) || typeof included !== 'boolean' || !input || typeof input.revision !== 'string') return resync()
      const current = await this.getRoster(true)
      if (!this.available() || current.revision !== input.revision || this.makeRosterFromMembership(current).revision !== current.revision || ![...current.included, ...current.excluded].includes(sessionId) || !this.access(sessionId)) return resync()
      const ids = new Set(this.ports.getExcluded().filter(idValid))
      if (included) ids.delete(sessionId); else ids.add(sessionId)
      this.ports.setExcluded([...ids].sort()) // Only IDs are persisted; never captions or projection bodies.
      this.invalidate()
      return { sessionId, included, revision: this.makeRosterFromMembership(current).revision }
    })())
  }
  private available() { return this.active && !this.ports.signal.aborted && !this.localAbort.signal.aborted }
  private access(id: string) { try { return this.ports.canAccess(id) === true } catch { return false } }
  private runtime(id: string): SessionWorkItem['runtime'] {
    try { const agent = this.ports.agent(id); return !agent ? 'unavailable' : agent.status === 'running' || agent.status === 'idle' ? agent.status : 'unknown' } catch { return 'unknown' }
  }
  private signal() { return AbortSignal.any([this.ports.signal, this.localAbort.signal]) }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work); void work.then(() => this.pending.delete(work), () => this.pending.delete(work)); return work
  }
  private invalidate() { this.generation++; this.roster = undefined; this.rosterFlight = undefined; this.items.clear(); this.itemFlights.clear() }
  private makeRosterFromMembership(base: Roster): Roster {
    const excluded = new Set(this.ports.getExcluded().filter(idValid))
    const ordinary = base.ordinary
    const next = { ...base, included: ordinary.filter(id => !excluded.has(id)), excluded: ordinary.filter(id => excluded.has(id)) }
    next.revision = hash([ordinary, next.internal, [...excluded].sort()])
    return next
  }
  private async getRoster(fresh = false): Promise<Roster> {
    if (!this.available()) throw new Error('inactive')
    if (!fresh && this.roster && Date.now() - this.roster.at < TTL) {
      const cached = this.makeRosterFromMembership(this.roster)
      // Access revocation and out-of-band membership changes must not reuse cached bodies.
      if (cached.revision === this.roster.revision && cached.ownedKey === hash([...this.ports.ownedSessionIds()].sort()) && [...cached.included, ...cached.excluded].every(id => this.access(id))) return cached
      this.invalidate()
    }
    if (this.rosterFlight) return this.rosterFlight
    const generation = this.generation
    const flight = (async () => {
      const rows = await this.ports.listSessions(this.signal())
      if (!Array.isArray(rows)) throw new Error('invalid roster')
      const headers = new Map<string, Record<string, any>>()
      let partial = false
      for (const row of rows) {
        const header = object(object(row)?.header)
        if (!header || !idValid(header.id)) { partial = true; continue }
        if (!this.access(header.id)) continue
        if (headers.has(header.id)) partial = true
        headers.set(header.id, header)
      }
      const owned = new Set(this.ports.ownedSessionIds().filter(idValid))
      for (const [id, header] of headers) if (['dsh-superagent-router', 'dsh-superagent-worker', 'dsh-superagent-watchdog'].includes(header.agentPreset)) owned.add(id)
      // Include ordinary forks, even with unresolved parents. Only known owned ancestry is removed.
      let changed = true
      while (changed) { changed = false; for (const [id, header] of headers) if (!owned.has(id) && owned.has(header.parentSession)) { owned.add(id); changed = true } }
      const internal: string[] = [], ordinary: string[] = []
      for (const [id, header] of headers) (owned.has(id) || header.origin === 'subagent' ? internal : ordinary).push(id)
      ordinary.sort((a, b) => {
        const running = (id: string) => { try { return this.ports.agent(id)?.status === 'running' ? 1 : 0 } catch { return 0 } }
        const created = (id: string) => { const value = headers.get(id)?.createdAt; return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
        return running(b) - running(a) || created(b) - created(a) || a.localeCompare(b)
      })
      const base: Roster = { at: Date.now(), revision: '', ownedKey: hash([...this.ports.ownedSessionIds()].sort()), ordinary, included: ordinary, excluded: [], internal: internal.sort(), partial }
      const roster = this.makeRosterFromMembership(base)
      if (generation !== this.generation || !this.available()) return resync()
      this.roster = roster
      return roster
    })()
    this.rosterFlight = flight
    try { return await flight } finally { if (this.rosterFlight === flight) this.rosterFlight = undefined }
  }
  private async page(input: SessionWorkListInput): Promise<SessionWorkList> {
    const sampledAt = Date.now(), view = input.view ?? 'included', limit = input.limit ?? 20
    if (!['included', 'excluded'].includes(view) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new WorkspaceError('session_work_invalid_page', 400)
    try {
      const roster = await this.getRoster(), generation = this.generation
      let offset = 0
      if (input.cursor !== undefined) {
        try {
          if (typeof input.cursor !== 'string' || input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) return resync()
          const cursor: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
          if (!Array.isArray(cursor) || cursor.length !== 4 || cursor[0] !== roster.revision || cursor[1] !== view || cursor[3] !== limit || !Number.isSafeInteger(cursor[2]) || cursor[2] <= 0 || cursor[2] % limit !== 0) return resync()
          offset = cursor[2]
        } catch { return resync() }
      }
      const ids = roster[view]
      if (offset > ids.length) return resync()
      const pageIds = ids.slice(offset, offset + limit)
      const items = view === 'excluded' ? pageIds.map(id => this.empty(id, true, 'missing')) : await Promise.all(pageIds.map(id => this.project(id, generation)))
      if (!this.available() || generation !== this.generation || this.makeRosterFromMembership(roster).revision !== roster.revision || roster.ownedKey !== hash([...this.ports.ownedSessionIds()].sort()) || pageIds.some(id => !this.access(id))) return resync()
      const hasMore = offset + limit < ids.length
      const partial = roster.partial || items.some(item => item.evidence === 'unavailable')
      return { state: partial ? 'partial' : 'ready', sampledAt, scope: 'current-host', defaultIncluded: true,
        total: ids.length, excludedTotal: roster.excluded.length, internalTotal: roster.internal.length, items, hasMore,
        revision: roster.revision, ...(hasMore ? { next: Buffer.from(JSON.stringify([roster.revision, view, offset + limit, limit])).toString('base64url') } : {}),
        ...(partial ? { error: 'session_work_partial' as const } : {}) }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error
      return { state: 'unavailable', sampledAt, scope: 'current-host', defaultIncluded: true, total: null, excludedTotal: null, internalTotal: null, items: [], hasMore: false, error: 'session_work_unavailable' }
    }
  }
  private empty(id: string, excluded: boolean, evidence: SessionWorkItem['evidence']): SessionWorkItem {
    return { sessionId: id, title: this.labels.get(id) ?? FALLBACK, runtime: excluded ? 'unknown' : 'unavailable', observedAt: Date.now(), evidence, excluded }
  }
  private project(id: string, generation: number): Promise<SessionWorkItem> {
    const cached = this.items.get(id)
    if (cached && Date.now() - cached.at < TTL) return Promise.resolve({ ...cached.item, runtime: cached.item.evidence === 'unavailable' ? 'unknown' : this.runtime(id) })
    const existing = this.itemFlights.get(id); if (existing) return existing.then(item => ({ ...item }))
    const work = (async () => {
      while (this.reads.size >= 4) await Promise.race(this.reads)
      if (!this.available() || generation !== this.generation || !this.access(id) || this.ports.getExcluded().includes(id)) return resync()
      const read = this.readProjection(id)
      this.reads.add(read)
      let item: SessionWorkItem
      try { item = await read } finally { this.reads.delete(read) }
      if (!this.available() || generation !== this.generation || !this.access(id) || this.ports.getExcluded().includes(id)) return resync()
      this.items.set(id, { at: Date.now(), item }); this.labels.set(id, item.title)
      return { ...item }
    })()
    this.track(work)
    this.itemFlights.set(id, work)
    void work.then(() => { if (this.itemFlights.get(id) === work) this.itemFlights.delete(id) }, () => { if (this.itemFlights.get(id) === work) this.itemFlights.delete(id) })
    return work
  }
  private async readProjection(id: string): Promise<SessionWorkItem> {
    const item = this.empty(id, false, 'missing')
    let malformed = false, structured = false
    try {
      const result = await this.ports.read(id, this.signal())
      if (!Number.isSafeInteger(result?.asOfSeq) || result.asOfSeq < -1 || !object(result.values)) throw new Error('invalid projection')
      const values = result.values
      const value = (key: string): any => values[key] == null ? undefined : values[key]
      if (values.title != null && typeof values.title !== 'string') malformed = true
      item.title = typeof values.title === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(values.title.trim()) ? FALLBACK : text(values.title, 120) ?? FALLBACK
      const goalState = value('goal'), goal = object(goalState)?.goal
      if (goalState !== undefined) {
        if (!object(goalState) || !object(goal) || !['active', 'paused', 'blocked', 'complete'].includes(goal.phase) || typeof goal.objective !== 'string') malformed = true
        else { structured = true; item.objective = text(goal.objective, 600); item.goalPhase = goal.phase; item.blocker = text(object(goal.blockedReason)?.message) }
      }
      const todos = value('todos')
      if (todos !== undefined) {
        if (!Array.isArray(todos) || todos.length > 512 || todos.some(row => !object(row) || typeof row.content !== 'string' || !['pending', 'in_progress', 'completed'].includes(row.status))) malformed = true
        else { structured = true; item.progress = text(todos.find(row => row.status === 'in_progress')?.content); item.nextAction = text(todos.find(row => row.status === 'pending')?.content) }
      }
      const team = value('agentTeam')
      if (team !== undefined) {
        if (!object(team) || !Array.isArray(team.tasks) || team.tasks.length > 512 || team.failure) malformed = true
        else {
          const tasks = team.tasks.filter((row: any) => object(row) && ['pending', 'in_progress', 'completed', 'deleted'].includes(row.status) && typeof row.subject === 'string')
          if (tasks.length !== team.tasks.length) malformed = true
          else { structured = true; item.progress ??= text(tasks.find((row: any) => row.status === 'in_progress')?.subject); item.nextAction ??= text(tasks.find((row: any) => row.status === 'pending')?.subject) }
        }
      }
      const questions = value('userQuestions')
      if (questions !== undefined) {
        if (!object(questions) || !Array.isArray(questions.active) || questions.active.length > 512) malformed = true
        else {
          structured = true
          for (const call of questions.active) {
            if (!object(call) || !['open', 'continued'].includes(call.state) || !Array.isArray(call.questions) || call.questions.length > 512) { malformed = true; continue }
            for (const question of call.questions) {
              if (!object(question) || typeof question.question !== 'string') { malformed = true; continue }
              item.decision ??= text(question.question)
            }
          }
        }
      }
      item.runtime = malformed ? 'unknown' : this.runtime(id)
      item.evidence = malformed ? 'unavailable' : structured ? 'structured' : 'missing'
      return item
    } catch { return { ...item, runtime: 'unknown', evidence: 'unavailable' } }
  }
}
