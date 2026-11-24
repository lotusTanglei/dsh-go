import { createHash } from 'node:crypto'
import { sourceId } from '../domain/ids.js'
import { redact } from '../store/codec.js'
import { WorkspaceError } from '../workspace/commands.js'
import type { Source, ThreadContext } from './types.js'

export interface SessionWorkPorts {
  listProjects?(): readonly { id: string; title: string; sessionIds: readonly string[]; accessible?: boolean }[]
  listSessions(signal: AbortSignal): Promise<readonly any[]>
  read(sessionId: string, signal: AbortSignal): Promise<{ asOfSeq: number; values: Record<string, unknown> }>
  agent(sessionId: string): any
  ownedSessionIds(): readonly string[]
  canAccess(sessionId: string): boolean
  getExcluded(): readonly string[]
  setExcluded(ids: readonly string[]): void
  getExcludedProjects?(): readonly string[]
  setExcludedProjects?(ids: readonly string[]): void
  getScopeVersion?(): number
  signal: AbortSignal
}
export type SessionWorkProject = { kind: 'project'; key: string; name: string } | { kind: 'unassigned' | 'unknown'; key: 'unassigned' | 'unknown' }
export interface SessionWorkItem {
  sessionId: string; title: string; objective?: string; project: SessionWorkProject
  runtime: 'running' | 'idle' | 'unavailable' | 'unknown'
  goalPhase?: string; progress?: string; nextAction?: string; blocker?: string; decision?: string
  done?: string[]
  result?: { state: 'goal-complete' | 'unverified'; summary?: string; acceptanceVerified: false }
  approvalCoverage: 'unavailable'
  observedAt: number; evidence: 'structured' | 'missing' | 'unavailable'; excluded: boolean
  exclusionReason?: 'session' | 'project' | 'membership-unknown'
  factRevision?: string
}
export interface SessionWorkListInput { view?: 'included' | 'excluded'; cursor?: string; limit?: number; projectKey?: string }
export interface ScopeProject { key: string; kind: SessionWorkProject['kind']; name?: string; excluded: boolean; sessionTotal: number; includedTotal: number }
export interface ScopeProjectList { state: 'ready' | 'partial'; revision: string; sampledAt: number; items: ScopeProject[]; total: number; hasMore: boolean; next?: string }
export interface SessionWorkList {
  state: 'ready' | 'partial' | 'unavailable'; sampledAt: number; scope: 'current-host'; defaultIncluded: true
  total: number | null; excludedTotal: number | null; internalTotal: number | null
  items: SessionWorkItem[]; hasMore: boolean; next?: string; revision?: string
  error?: 'session_work_unavailable' | 'session_work_partial'
}
type Roster = { at: number; revision: string; ownedKey: string; projects: Record<string, SessionWorkProject>; catalog: ScopeProject[]; projectRevision: string; ordinary: string[]; included: string[]; excluded: string[]; internal: string[]; partial: boolean }
const TTL = 15_000, FALLBACK = '未提供会话标题'
const idValid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value) && !value.includes('://')
const projectKeyValid = (value: unknown): value is string => value === 'unassigned' || value === 'unknown' || typeof value === 'string' && value.startsWith('project:') && idValid(value.slice(8))
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
      if (!this.available() || current.revision !== input.revision || this.makeRosterFromMembership(current).revision !== current.revision || hash(this.readProjects(current.ordinary)) !== current.projectRevision || ![...current.included, ...current.excluded].includes(sessionId) || !this.access(sessionId)) return resync()
      // Project exclusion has priority; restoring a child cannot bypass its parent.
      if (included && current.projects[sessionId]?.kind === 'project' && this.ports.getExcludedProjects?.().includes(current.projects[sessionId]!.key)) throw new WorkspaceError('session_work_project_excluded', 409)
      const ids = new Set(this.ports.getExcluded().filter(idValid))
      if (included) ids.delete(sessionId); else ids.add(sessionId)
      this.ports.setExcluded([...ids].sort()) // Only IDs are persisted; never captions or projection bodies.
      this.invalidate()
      return { sessionId, included, revision: this.makeRosterFromMembership(current).revision }
    })())
  }
  listScopeProjects(input: { cursor?: string; limit?: number } = {}): Promise<ScopeProjectList> {
    return this.track((async () => {
      const roster = await this.getRoster(true), generation = this.generation, limit = input.limit ?? 20
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new WorkspaceError('session_work_invalid_page', 400)
      let offset = 0
      if (input.cursor !== undefined) {
        try {
          if (!/^[A-Za-z0-9_-]{1,1024}$/.test(input.cursor)) return resync()
          const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
          if (!Array.isArray(cursor) || cursor.length !== 4 || cursor[0] !== roster.revision || cursor[1] !== 'projects' || cursor[3] !== limit || !Number.isSafeInteger(cursor[2]) || cursor[2] <= 0 || cursor[2] % limit !== 0) return resync()
          offset = cursor[2]
        } catch { return resync() }
      }
      if (!this.available() || generation !== this.generation || offset > roster.catalog.length || this.makeRosterFromMembership(roster).revision !== roster.revision || hash(this.readProjects(roster.ordinary)) !== roster.projectRevision || roster.ownedKey !== hash([...this.ports.ownedSessionIds()].sort()) || roster.ordinary.some(id => !this.access(id))) return resync()
      const items = roster.catalog.slice(offset, offset + limit), hasMore = offset + limit < roster.catalog.length
      return { state: roster.partial ? 'partial' : 'ready', revision: roster.revision, sampledAt: roster.at, items, total: roster.catalog.length, hasMore,
        ...(hasMore ? { next: Buffer.from(JSON.stringify([roster.revision, 'projects', offset + limit, limit])).toString('base64url') } : {}) }
    })())
  }
  setProjectIncluded(projectId: string, included: boolean, input: { revision: string }): Promise<{ projectId: string; included: boolean; revision: string; stopped: false }> {
    return this.track((async () => {
      if (!idValid(projectId) || typeof included !== 'boolean' || typeof input?.revision !== 'string') return resync()
      const roster = await this.getRoster(true)
      if (!this.available() || roster.revision !== input.revision || this.makeRosterFromMembership(roster).revision !== roster.revision || hash(this.readProjects(roster.ordinary)) !== roster.projectRevision || !roster.catalog.some(row => row.kind === 'project' && row.key === projectId)) return resync()
      if (!this.ports.setExcludedProjects) throw new WorkspaceError('session_work_scope_unavailable', 503)
      const ids = new Set(this.ports.getExcludedProjects?.() ?? [])
      if (included) ids.delete(projectId); else ids.add(projectId)
      this.ports.setExcludedProjects([...ids].sort())
      this.invalidate()
      // Exclusion revokes management only. No stop, activation, or replay takes place here.
      return { projectId, included, revision: this.makeRosterFromMembership(roster).revision, stopped: false }
    })())
  }
  /** Bounded fact search, not a control grant. Explicit stable IDs never bypass membership.
   * A title match alone requires clarification; only structured objective evidence locates.
   * Optional Host-authoritative filters: an exact session id or an exact project key never authorize by themselves.
   * Empty text is accepted only together with an explicit filter, and then only structured work evidence locates.
   */
  locate(input: { text: string; sessionId?: string; revision?: string; projectKey?: string }) {
    return this.track((async () => {
      if (!input || typeof input.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > 16_384 || input.text.includes('\0') || input.sessionId !== undefined && !idValid(input.sessionId) || input.projectKey !== undefined && !projectKeyValid(input.projectKey)) throw new WorkspaceError('invalid_input', 400)
      if (!input.text.trim() && input.sessionId === undefined && input.projectKey === undefined) throw new WorkspaceError('invalid_input', 400)
      input = { text: input.text, ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }), ...(input.revision === undefined ? {} : { revision: input.revision }), ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }) }
      const roster = await this.getRoster(true), generation = this.generation
      if (input.revision !== undefined && input.revision !== roster.revision) return resync()
      const base = { revision: roster.revision, controlAvailable: false as const, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' }
      const blocked = (code: string) => ({ ...base, status: 'blocked' as const, code, candidates: [] })
      if (input.sessionId !== undefined && (!roster.included.includes(input.sessionId) || this.exclusion(input.sessionId, roster.projects) || !this.access(input.sessionId))) return blocked('target_not_available')
      // Avoid silently selecting a target outside the inspected window. No unbounded scan.
      const projectOf = (id: string) => roster.projects[id]?.kind === 'project' ? `project:${roster.projects[id]!.key}` : roster.projects[id]?.kind
      // Exclusions are an intentional scope decision, not missing coverage; only the window cap is partial.
      const eligible = (input.sessionId ? [input.sessionId] : roster.included)
        .filter(id => (input.projectKey === undefined || projectOf(id) === input.projectKey) && !this.exclusion(id, roster.projects))
      const ids = input.sessionId ? eligible : eligible.slice(0, 100)
      const items = await Promise.all(ids.map(id => this.project(id, generation, true)))
      if (!this.available() || generation !== this.generation || this.makeRosterFromMembership(roster).revision !== roster.revision || hash(this.readProjects(roster.ordinary)) !== roster.projectRevision || roster.ownedKey !== hash([...this.ports.ownedSessionIds()].sort()) || ids.some(id => !this.access(id))) return resync()
      const partial = roster.partial || !input.sessionId && eligible.length > ids.length || items.some(item => item.evidence === 'unavailable')
      const needle = input.text.normalize('NFC').trim().toLocaleLowerCase()
      const matches = items.filter(item => input.sessionId === item.sessionId || !needle || [item.objective, item.progress, item.nextAction, item.title].some(value => value && value.normalize('NFC').toLocaleLowerCase().includes(needle)))
      const candidates = matches.slice(0, 20).map(item => {
        const fields = ['objective', 'progress', 'nextAction', 'title'] as const
        const matchField = (needle ? fields.find(field => item[field]?.normalize('NFC').toLocaleLowerCase().includes(needle)) : undefined) ?? (item.objective ? 'objective' : 'title')
        return { sessionId: item.sessionId, title: item.title, project: roster.projects[item.sessionId]!, factRevision: item.factRevision, observedAt: item.observedAt, evidence: item.evidence,
          matchField, matchText: item[matchField]?.slice(0, 600) ?? '' }
      })
      if (partial) return { ...base, status: 'blocked' as const, code: 'locate_coverage_partial', coverage: 'partial' as const, searched: ids.length, candidates }
      if (!matches.length) return { ...base, status: 'no_match' as const, coverage: 'complete' as const, searched: ids.length, candidates }
      const only = matches[0]!, strong = input.sessionId === only.sessionId || only.evidence === 'structured' && (!needle || Boolean(only.objective?.normalize('NFC').toLocaleLowerCase().includes(needle)))
      if (matches.length !== 1 || !strong) return { ...base, status: 'clarify' as const, code: matches.length > 1 ? 'target_ambiguous' : 'title_only_match', candidates, candidateTotal: matches.length }
      return { ...base, status: 'located' as const, target: candidates[0], candidates, coverage: 'complete' as const, searched: ids.length }
    })())
  }
  /** Metadata-only global scope cut for staged uploads; no work bodies or control grant. */
  imageScope() {
    return this.track((async () => {
      const roster = await this.getRoster(true), generation = this.generation
      const fence = () => {
        if (!this.available() || generation !== this.generation || this.makeRosterFromMembership(roster).revision !== roster.revision || hash(this.readProjects(roster.ordinary)) !== roster.projectRevision || roster.ownedKey !== hash([...this.ports.ownedSessionIds()].sort()) || roster.ordinary.some(id => !this.access(id))) throw new WorkspaceError('image_scope_changed', 409)
      }
      fence(); return { revision: roster.revision, fence }
    })())
  }
  /** A fresh, exact target binding plus synchronous revocation fence. Not a control grant. */
  actionTarget(input: { sessionId: string; scopeRevision: string; factRevision: string }) {
    return this.track((async () => {
      if (!input || !idValid(input.sessionId) || !/^[a-f0-9]{64}$/.test(input.scopeRevision) || !/^[a-f0-9]{64}$/.test(input.factRevision)) throw new WorkspaceError('session_action_invalid', 400)
      const expected = { ...input }, roster = await this.getRoster(true), generation = this.generation
      const check = () => {
        if (!this.available() || generation !== this.generation || roster.revision !== expected.scopeRevision || this.makeRosterFromMembership(roster).revision !== roster.revision || hash(this.readProjects(roster.ordinary)) !== roster.projectRevision || roster.ownedKey !== hash([...this.ports.ownedSessionIds()].sort()) || !roster.included.includes(expected.sessionId) || !this.access(expected.sessionId) || this.exclusion(expected.sessionId, roster.projects)) throw new WorkspaceError('session_action_target_changed', 409)
      }
      check()
      const item = await this.project(expected.sessionId, generation, true)
      check()
      if (item.evidence === 'unavailable' || item.factRevision !== expected.factRevision) throw new WorkspaceError('session_action_target_changed', 409)
      const project = roster.projects[expected.sessionId]!
      if (project.kind === 'unknown') throw new WorkspaceError('session_action_target_changed', 409)
      return { binding: { sessionId: expected.sessionId, scopeRevision: roster.revision, factRevision: item.factRevision, project: { kind: project.kind, key: project.key } }, fence: check }
    })())
  }
  private available() { return this.active && !this.ports.signal.aborted && !this.localAbort.signal.aborted }
  /**
   * Current-scope check for an already recorded target. Used only to reconcile an unknown answer:
   * it loads/refreshes the membership roster (a read-only Host query) but reads no session facts —
   * settling the answered question legitimately changes those — and it never wakes or dispatches.
   * Any missing roster, access or exclusion evidence stays `false`.
   */
  async authorize(sessionId: string): Promise<boolean> {
    if (!idValid(sessionId) || !this.available()) return false
    try { await this.getRoster(false) } catch { return false }
    const roster = this.roster
    if (!roster) return false
    return roster.included.includes(sessionId) && this.access(sessionId) && !this.exclusion(sessionId, this.readProjects(roster.ordinary).projects)
  }
  private access(id: string) { try { return this.ports.canAccess(id) === true } catch { return false } }
  private runtime(id: string): SessionWorkItem['runtime'] {
    try { const agent = this.ports.agent(id); return !agent ? 'unavailable' : agent.status === 'running' || agent.status === 'idle' ? agent.status : 'unknown' } catch { return 'unknown' }
  }
  private signal() { return AbortSignal.any([this.ports.signal, this.localAbort.signal]) }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work); void work.then(() => this.pending.delete(work), () => this.pending.delete(work)); return work
  }
  private invalidate() { this.generation++; this.roster = undefined; this.rosterFlight = undefined; this.items.clear(); this.itemFlights.clear() }
  private exclusion(id: string, projects: Record<string, SessionWorkProject>): SessionWorkItem['exclusionReason'] | undefined {
    if (this.ports.getExcluded().includes(id)) return 'session'
    const project = projects[id]
    // Unknown membership cannot grant fresh access, nor bypass an excluded project.
    if (!project || project.kind === 'unknown') return 'membership-unknown'
    if (project.kind === 'project' && this.ports.getExcludedProjects?.().includes(project.key)) return 'project'
    return undefined
  }
  private makeRosterFromMembership(base: Roster): Roster {
    const excluded = new Set(this.ports.getExcluded().filter(idValid)), projectExcluded = new Set(this.ports.getExcludedProjects?.().filter(idValid) ?? [])
    const ordinary = base.ordinary
    // One preference snapshot per computation, not a kv read for every project/member pair.
    const isExcluded = (id: string) => excluded.has(id) || base.projects[id]?.kind === 'project' && projectExcluded.has(base.projects[id]!.key)
    const next = { ...base, included: ordinary.filter(id => !isExcluded(id)), excluded: ordinary.filter(isExcluded) }
    const totals = new Map<string, { total: number; included: number }>()
    for (const id of ordinary) {
      const project = base.projects[id]!, key = JSON.stringify([project.kind, project.key]), count = totals.get(key) ?? { total: 0, included: 0 }
      count.total++; if (!isExcluded(id) && project.kind !== 'unknown') count.included++
      totals.set(key, count)
    }
    // Unknown ownership remains visible as partial metadata, without reading its work.
    next.catalog = base.catalog.map(project => ({ ...project, excluded: project.kind === 'project' && projectExcluded.has(project.key),
      sessionTotal: totals.get(JSON.stringify([project.kind, project.key]))?.total ?? 0,
      includedTotal: totals.get(JSON.stringify([project.kind, project.key]))?.included ?? 0 }))
    next.revision = hash([ordinary.map(id => [id, base.projects[id]]), base.projectRevision, next.internal, [...excluded].sort(), [...projectExcluded].sort(), this.ports.getScopeVersion?.() ?? 0])
    return next
  }
  private readProjects(ordinary: readonly string[]) {
    // Host membership is authoritative; no cwd/title/path guesses or log reads.
    const projects: Record<string, SessionWorkProject> = Object.create(null), catalog: ScopeProject[] = []
    let partial = false
    try {
      const rows = this.ports.listProjects?.()
      if (!Array.isArray(rows)) throw new Error('project registry unavailable')
      const members = new Set(ordinary), seen = new Set<string>()
      for (const row of rows) {
        if (!object(row) || !idValid(row.id) || seen.has(row.id) || typeof row.title !== 'string' || !Array.isArray(row.sessionIds) || new Set(row.sessionIds).size !== row.sessionIds.length || row.sessionIds.some((id: unknown) => !idValid(id))) throw new Error('invalid project registry')
        seen.add(row.id)
        if (row.accessible !== false) catalog.push({ key: row.id, kind: 'project', name: text(row.title, 120) ?? '', excluded: false, sessionTotal: 0, includedTotal: 0 })
        if (row.accessible === false && row.sessionIds.some((id: string) => members.has(id))) partial = true
        const project: SessionWorkProject = row.accessible === false ? { kind: 'unknown', key: 'unknown' } : { kind: 'project', key: row.id, name: text(row.title, 120) ?? '' }
        for (const id of row.sessionIds) if (members.has(id)) {
          if (projects[id]) { projects[id] = { kind: 'unknown', key: 'unknown' }; partial = true }
          else projects[id] = project
        }
      }
      for (const id of ordinary) projects[id] ??= { kind: 'unassigned', key: 'unassigned' }
    } catch {
      partial = true; catalog.length = 0
      for (const id of ordinary) projects[id] = { kind: 'unknown', key: 'unknown' }
    }
    for (const kind of ['unassigned', 'unknown'] as const) if (ordinary.some(id => projects[id]?.kind === kind)) catalog.push({ key: kind, kind, excluded: false, sessionTotal: 0, includedTotal: 0 })
    catalog.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
    return { projects, catalog, partial }
  }
  private async getRoster(fresh = false): Promise<Roster> {
    if (!this.available()) throw new Error('inactive')
    if (!fresh && this.roster && Date.now() - this.roster.at < TTL) {
      const cached = this.makeRosterFromMembership(this.roster)
      // Access revocation and out-of-band membership changes must not reuse cached bodies.
      if (hash(this.readProjects(cached.ordinary)) === cached.projectRevision && cached.revision === this.roster.revision && cached.ownedKey === hash([...this.ports.ownedSessionIds()].sort()) && [...cached.included, ...cached.excluded].every(id => this.access(id))) return cached
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
      const projectSnapshot = this.readProjects(ordinary)
      const projects = projectSnapshot.projects; partial ||= projectSnapshot.partial
      const base: Roster = { at: Date.now(), revision: '', ownedKey: hash([...this.ports.ownedSessionIds()].sort()), projects, catalog: projectSnapshot.catalog, projectRevision: hash(projectSnapshot), ordinary, included: ordinary, excluded: [], internal: internal.sort(), partial }
      const roster = this.makeRosterFromMembership(base)
      if (generation !== this.generation || !this.available()) return resync()
      if (this.roster && this.roster.revision !== roster.revision) {
        // A fresh metadata request can observe a move/exclusion before the cached path.
        // Invalidate old fact flights without clearing this newly built roster.
        this.generation++; this.items.clear(); this.itemFlights.clear()
      }
      this.roster = roster
      return roster
    })()
    this.rosterFlight = flight
    try { return await flight } finally { if (this.rosterFlight === flight) this.rosterFlight = undefined }
  }
  private async page(input: SessionWorkListInput): Promise<SessionWorkList> {
    const sampledAt = Date.now(), view = input.view ?? 'included', limit = input.limit ?? 20
    if (!['included', 'excluded'].includes(view) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || input.projectKey !== undefined && !projectKeyValid(input.projectKey)) throw new WorkspaceError('session_work_invalid_page', 400)
    try {
      const roster = await this.getRoster(), generation = this.generation
      let offset = 0
      if (input.cursor !== undefined) {
        try {
          if (typeof input.cursor !== 'string' || input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) return resync()
          const cursor: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
          if (!Array.isArray(cursor) || cursor.length !== 5 || cursor[0] !== roster.revision || cursor[1] !== view || cursor[3] !== limit || cursor[4] !== (input.projectKey ?? null) || !Number.isSafeInteger(cursor[2]) || cursor[2] <= 0 || cursor[2] % limit !== 0) return resync()
          offset = cursor[2]
        } catch { return resync() }
      }
      const projectKey = (project: SessionWorkProject | undefined) => project?.kind === 'project' ? `project:${project.key}` : project?.kind
      if (input.projectKey !== undefined && !roster.catalog.some(row => (row.kind === 'project' ? `project:${row.key}` : row.kind) === input.projectKey)) return resync()
      const ids = roster[view].filter(id => input.projectKey === undefined || projectKey(roster.projects[id]) === input.projectKey)
      if (offset > ids.length) return resync()
      const pageIds = ids.slice(offset, offset + limit)
      const observed = await Promise.all(pageIds.map(id => {
        const reason = this.exclusion(id, roster.projects)
        return view === 'excluded' || reason === 'membership-unknown' ? { ...this.empty(id, view === 'excluded', reason === 'membership-unknown' ? 'unavailable' : 'missing'), ...(reason ? { exclusionReason: reason } : {}) } : this.project(id, generation)
      }))
      const items = observed.map(item => ({ ...item, project: roster.projects[item.sessionId] ?? { kind: 'unknown' as const, key: 'unknown' as const } }))
      if (!this.available() || generation !== this.generation || hash(this.readProjects(roster.ordinary)) !== roster.projectRevision || this.makeRosterFromMembership(roster).revision !== roster.revision || roster.ownedKey !== hash([...this.ports.ownedSessionIds()].sort()) || pageIds.some(id => !this.access(id))) return resync()
      const hasMore = offset + limit < ids.length
      const partial = roster.partial || items.some(item => item.evidence === 'unavailable')
      return { state: partial ? 'partial' : 'ready', sampledAt, scope: 'current-host', defaultIncluded: true,
        total: ids.length, excludedTotal: roster.excluded.length, internalTotal: roster.internal.length, items, hasMore,
        revision: roster.revision, ...(hasMore ? { next: Buffer.from(JSON.stringify([roster.revision, view, offset + limit, limit, input.projectKey ?? null])).toString('base64url') } : {}),
        ...(partial ? { error: 'session_work_partial' as const } : {}) }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error
      return { state: 'unavailable', sampledAt, scope: 'current-host', defaultIncluded: true, total: null, excludedTotal: null, internalTotal: null, items: [], hasMore: false, error: 'session_work_unavailable' }
    }
  }
  private empty(id: string, excluded: boolean, evidence: SessionWorkItem['evidence']): SessionWorkItem {
    // Ordinary session approvals have no exact projection here; questions are not approvals.
    return { sessionId: id, project: { kind: 'unknown', key: 'unknown' }, title: this.labels.get(id) ?? FALLBACK, runtime: excluded ? 'unknown' : 'unavailable', observedAt: Date.now(), evidence, excluded, approvalCoverage: 'unavailable' }
  }
  private copyItem(item: SessionWorkItem): SessionWorkItem {
    return { ...item, ...(item.done ? { done: [...item.done] } : {}), ...(item.result ? { result: { ...item.result } } : {}) }
  }
  private project(id: string, generation: number, fresh = false): Promise<SessionWorkItem> {
    const cached = this.items.get(id)
    if (!fresh && cached && Date.now() - cached.at < TTL) return Promise.resolve({ ...this.copyItem(cached.item), runtime: cached.item.evidence === 'unavailable' ? 'unknown' : this.runtime(id) })
    const flightKey = `${fresh ? 'locate' : 'summary'}:${id}`
    const existing = this.itemFlights.get(flightKey); if (existing) return existing.then(item => this.copyItem(item))
    const work = (async () => {
      while (this.reads.size >= 4) await Promise.race(this.reads)
      if (!this.available() || generation !== this.generation || !this.access(id) || !this.roster || Boolean(this.exclusion(id, this.readProjects(this.roster.ordinary).projects))) return resync()
      const read = this.readProjection(id)
      this.reads.add(read)
      let item: SessionWorkItem
      try { item = await read } finally { this.reads.delete(read) }
      if (!this.available() || generation !== this.generation || !this.access(id) || !this.roster || Boolean(this.exclusion(id, this.readProjects(this.roster.ordinary).projects))) return resync()
      this.items.set(id, { at: Date.now(), item }); this.labels.set(id, item.title)
      return this.copyItem(item)
    })()
    this.track(work)
    this.itemFlights.set(flightKey, work)
    void work.then(() => { if (this.itemFlights.get(flightKey) === work) this.itemFlights.delete(flightKey) }, () => { if (this.itemFlights.get(flightKey) === work) this.itemFlights.delete(flightKey) })
    return work
  }
  private async readProjection(id: string): Promise<SessionWorkItem> {
    const item = this.empty(id, false, 'missing'), done: string[] = []
    const completed = (value: unknown) => {
      const fact = text(value)
      if (fact && done.length < 3 && !done.includes(fact)) done.push(fact)
    }
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
        else {
          structured = true; item.progress = text(todos.find(row => row.status === 'in_progress')?.content); item.nextAction = text(todos.find(row => row.status === 'pending')?.content)
          for (const row of todos) if (row.status === 'completed') completed(row.content)
        }
      }
      const team = value('agentTeam')
      if (team !== undefined) {
        if (!object(team) || !Array.isArray(team.tasks) || team.tasks.length > 512 || team.failure) malformed = true
        else {
          const tasks = team.tasks.filter((row: any) => object(row) && ['pending', 'in_progress', 'completed', 'deleted'].includes(row.status) && typeof row.subject === 'string')
          if (tasks.length !== team.tasks.length) malformed = true
          else {
            structured = true; item.progress ??= text(tasks.find((row: any) => row.status === 'in_progress')?.subject); item.nextAction ??= text(tasks.find((row: any) => row.status === 'pending')?.subject)
            for (const row of tasks) if (row.status === 'completed') completed(row.subject)
          }
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
      if (!malformed) {
        if (done.length) item.done = done
        // A goal's own completion declaration is not acceptance verification. Completed
        // task facts alone establish neither goal completion nor a successful outcome.
        if (item.goalPhase === 'complete') item.result = { state: 'goal-complete', ...(item.objective ? { summary: item.objective } : {}), acceptanceVerified: false }
        else if (done.length) item.result = { state: 'unverified', summary: done[0], acceptanceVerified: false }
      }
      item.runtime = malformed ? 'unknown' : this.runtime(id)
      item.evidence = malformed ? 'unavailable' : structured ? 'structured' : 'missing'
      item.factRevision = hash([id, result.asOfSeq, item.title, item.objective ?? null, item.goalPhase ?? null, item.progress ?? null, item.nextAction ?? null, item.blocker ?? null, item.decision ?? null, item.done ?? null, item.result ?? null, item.approvalCoverage, item.evidence])
      return item
    } catch { return { ...item, runtime: 'unknown', evidence: 'unavailable' } }
  }
}
