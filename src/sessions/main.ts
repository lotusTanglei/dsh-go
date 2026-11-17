/** Host session id is intentionally structural: no DSH package is required. */
export type SessionId = string

export interface MainAgent {
  readonly sessionId?: string
  inject(message: string): void | Promise<void>
  followup(message: string): void | Promise<void>
}

export interface MainKv {
  get(key: unknown): unknown
  insertOrIgnore?(row: { readonly k: string; readonly v: string }): void
  /** Optional replacement operation supplied by a host/store adapter. */
  upsert?(row: { readonly k: string; readonly v: string }): void
  replace?(row: { readonly k: string; readonly v: string }): void
  set?(key: string, value: string): void
  update?(key: string, value: string): void
  delete?(key: unknown): void
}

/** Narrow injected context; callers adapt DSH services to this shape. */
export interface MainSessionContext {
  /** Optional atomic binding writer supplied by the host/store adapter. */
  readonly setMainSessionId?: (sessionId: string) => void
  readonly kv?: MainKv
  readonly store?: { readonly repos?: { readonly kv?: MainKv } }
  readonly sessions: {
    get?(sessionId: string): unknown
    create?(sessionId?: string, options?: unknown): unknown
  }
  readonly agents: {
    get?(sessionId: string): MainAgent | undefined
    resume?(input: { resumeSessionId: string }): Promise<MainAgent>
    create?(input: { sessionId: string; meta?: Record<string, unknown> }): Promise<MainAgent>
  }
  readonly on?: (event: string, listener: (...args: unknown[]) => void) => unknown
}

export interface MainSessionConfig {
  readonly mainSessionId?: string
  readonly routerPreset?: string
}

const disposalRegistered = new WeakSet<object>()

function kv(context: MainSessionContext): MainKv | undefined {
  return context.kv ?? context.store?.repos?.kv
}

function readBinding(context: MainSessionContext): string | undefined {
  const row = kv(context)?.get('mainSessionId')
  const value = row && typeof row === 'object' ? (row as { v?: unknown }).v : typeof row === 'string' ? row : undefined
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function writeBinding(context: MainSessionContext, sessionId: string): void {
  context.setMainSessionId?.(sessionId)
  const repository = kv(context)
  if (!repository) return
  const row = { k: 'mainSessionId', v: sessionId } as const
  if (repository.upsert) {
    repository.upsert(row)
    return
  }
  if (repository.replace) {
    repository.replace(row)
    return
  }
  if (repository.set) {
    repository.set(row.k, row.v)
    return
  }
  if (repository.update) {
    repository.update(row.k, row.v)
    return
  }
  const existing = repository.get('mainSessionId')
  if (existing === undefined || existing === null) repository.insertOrIgnore?.(row)
}

function clearBinding(context: MainSessionContext): void {
  kv(context)?.delete?.('mainSessionId')
}

function generatedSessionId(): string {
  return `superagent-main-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function createOrResume(context: MainSessionContext, sessionId: string, preset?: string): Promise<MainAgent> {
  const existing = context.agents.get?.(sessionId)
  if (existing) return existing
  const live = context.sessions.get?.(sessionId)
  if (live && context.agents.resume) return context.agents.resume({ resumeSessionId: sessionId })
  if (!context.agents.create) throw new Error('Main session context cannot create an agent')
  return context.agents.create({ sessionId, ...(preset ? { meta: { agentPreset: preset } } : {}) })
}

/** Ensure the configured, persisted, or newly-created Router session is available. */
export function ensureMainSession(context: MainSessionContext, config?: MainSessionConfig): Promise<SessionId>
export function ensureMainSession(config: MainSessionConfig, context: MainSessionContext): Promise<SessionId>
export async function ensureMainSession(first: MainSessionContext | MainSessionConfig, second: MainSessionConfig | MainSessionContext = {}): Promise<SessionId> {
  const context = 'agents' in first ? first : second as MainSessionContext
  const config = 'agents' in first ? second as MainSessionConfig : first
  if (!context || !('agents' in context)) throw new Error('Main session context is required')
  const configured = config.mainSessionId
  const persisted = configured ?? readBinding(context)
  // An explicit configuration is authoritative. A stale persisted binding is rebuilt.
  const sessionId = configured ?? (persisted && (context.agents.get?.(persisted) || context.sessions.get?.(persisted)) ? persisted : generatedSessionId())
  await createOrResume(context, sessionId, config.routerPreset)
  writeBinding(context, sessionId)
  if (context.on && !disposalRegistered.has(context)) {
    watchMainSessionDisposal(context)
    disposalRegistered.add(context)
  }
  return sessionId
}

/** Inject context without waking a model turn. */
export function injectContext(context: MainSessionContext, sessionId: SessionId, text: string): void {
  const agent = context.agents.get?.(sessionId)
  if (!agent) throw new Error(`Main session is not live: ${sessionId}`)
  void agent.inject(text)
}

/** Notify Router and wake one model turn. */
export function notifyRouter(context: MainSessionContext, sessionId: SessionId, text: string): void {
  const agent = context.agents.get?.(sessionId)
  if (!agent) throw new Error(`Main session is not live: ${sessionId}`)
  void agent.followup(text)
}

/** Build a context that forwards a session disposal event to KV cleanup. */
export function watchMainSessionDisposal(context: MainSessionContext): () => void {
  if (!context.on) return () => undefined
  const listener = (...args: unknown[]) => {
    const session = args[0] as { id?: unknown; sessionId?: unknown } | undefined
    const id = typeof session?.id === 'string' ? session.id : typeof session?.sessionId === 'string' ? session.sessionId : undefined
    if (!id || readBinding(context) !== id) return
    clearBinding(context)
  }
  const registration = context.on('session/disposed', listener)
  return typeof registration === 'function' ? registration as () => void : () => undefined
}

/** Factory form for callers that want the docs' config-first method shape. */
export function createMainSessions(context: MainSessionContext): {
  ensureMainSession(config?: MainSessionConfig): Promise<SessionId>
  injectContext(sessionId: SessionId, text: string): void
  notifyRouter(sessionId: SessionId, text: string): void
} {
  return {
    ensureMainSession: (config = {}) => ensureMainSession(context, config),
    injectContext: (sessionId, text) => injectContext(context, sessionId, text),
    notifyRouter: (sessionId, text) => notifyRouter(context, sessionId, text),
  }
}
