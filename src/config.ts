import { isAbsolute, resolve } from 'node:path'

/** Minimal adapter for the installed Schemastery API; no fabricated DSH service. */
export interface SchemaNode<T = unknown> {
  (input?: unknown): T
  required(): SchemaNode<T>
  default(value: unknown): SchemaNode<T>
  min(value: number): SchemaNode<T>
  step(value: number): SchemaNode<T>
}
export interface SchemaFactory {
  string(): SchemaNode<string>
  number(): SchemaNode<number>
  boolean(): SchemaNode<boolean>
  object(properties: Record<string, SchemaNode>): SchemaNode
  array(inner: SchemaNode): SchemaNode
  union(values: readonly string[]): SchemaNode
}
export interface SourceConfig {
  readonly id: string
  readonly kind: 'session' | 'inbox' | 'wecom-document'
  readonly attended: boolean
}
export interface WecomDocumentConfig extends SourceConfig {
  readonly kind: 'wecom-document'
  readonly attended: false
  readonly doc: string
  readonly sheet: string
  readonly range: string
  readonly idColumn: string
  readonly titleColumn: string
  readonly textColumns: readonly string[]
  readonly filter?: { readonly column: string; readonly values: readonly string[] }
  /** Actual sheet row number, not an offset; defaults to the range's first row. */
  readonly firstDataRow?: number
}
export interface WecomDocumentRange {
  readonly r0: number; readonly r1: number; readonly c0: number; readonly c1: number
}

/** Only finite, explicit A1 rectangles are accepted; no sheet names or open ranges. */
export function parseWecomDocumentRange(input: string): WecomDocumentRange {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(input)
  if (!match) throw new Error('wecom-document: range must be an explicit uppercase A1 rectangle')
  const column = (text: string) => [...text].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0)
  const c0 = column(match[1]!), r0 = Number(match[2]), c1 = column(match[3]!), r1 = Number(match[4])
  if (r0 > r1 || c0 > c1 || r1 > 1_048_576 || c1 > 16_384 || r1 - r0 >= 500 || c1 - c0 >= 100) throw new Error('wecom-document: range exceeds finite 500 row / 100 column bounds')
  return { r0, r1, c0, c1 }
}

/** Canonical identity excludes tab query parameters but never accepts a foreign URL. */
export function wecomDocumentId(doc: string): string {
  if (typeof doc !== 'string' || doc.length > 2048 || doc.trim() !== doc || /[\s\\]/.test(doc) || !/^https:\/\/doc\.weixin\.qq\.com(?::443)?\/sheet\/[A-Za-z0-9_-]{1,256}(?:\?[^#]*)?$/.test(doc)) throw new Error('wecom-document: invalid document URL')
  let url: URL
  try { url = new URL(doc) } catch { throw new Error('wecom-document: invalid document URL') }
  const match = /^\/sheet\/([A-Za-z0-9_-]{1,256})$/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'doc.weixin.qq.com' || url.username || url.password || (url.port && url.port !== '443') || doc.includes('#') || !match) throw new Error('wecom-document: official HTTPS sheet URL required')
  return match[1]!
}

/** Reused by resolveConfig and the manual adapter; no runtime or connector policy here. */
export function validateWecomDocumentConfig(input: unknown): asserts input is WecomDocumentConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('wecom-document: configuration object required')
  const config = input as Record<string, unknown>
  const fields = ['id', 'kind', 'attended', 'doc', 'sheet', 'range', 'idColumn', 'titleColumn', 'textColumns', 'filter', 'firstDataRow']
  if (Object.keys(config).some(key => !fields.includes(key))) throw new Error('wecom-document: unsupported configuration field')
  if (typeof config.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(config.id) || /^(?:session|workspace):/i.test(config.id) || config.kind !== 'wecom-document' || config.attended !== false) throw new Error('wecom-document: valid non-reserved id, kind and attended:false required')
  wecomDocumentId(config.doc as string)
  if (typeof config.sheet !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(config.sheet)) throw new Error('wecom-document: stable sheet id required')
  if (typeof config.range !== 'string') throw new Error('wecom-document: range required')
  const bounds = parseWecomDocumentRange(config.range)
  const validColumn = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^[A-Z]{1,3}$/.test(value)) return false
    const number = [...value].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0)
    return number >= bounds.c0 && number <= bounds.c1
  }
  if (!validColumn(config.idColumn) || !validColumn(config.titleColumn) || !Array.isArray(config.textColumns) || config.textColumns.length < 1 || config.textColumns.length > 100 || !config.textColumns.every(validColumn) || new Set(config.textColumns).size !== config.textColumns.length) throw new Error('wecom-document: configured columns must be unique uppercase letters within range')
  if (config.firstDataRow !== undefined && (!Number.isSafeInteger(config.firstDataRow) || Number(config.firstDataRow) < bounds.r0 || Number(config.firstDataRow) > bounds.r1)) throw new Error('wecom-document: firstDataRow must be an actual row within range')
  if (config.filter !== undefined) {
    if (!config.filter || typeof config.filter !== 'object' || Array.isArray(config.filter)) throw new Error('wecom-document: invalid filter')
    const filter = config.filter as Record<string, unknown>
    if (Object.keys(filter).some(key => !['column', 'values'].includes(key)) || !validColumn(filter.column) || !Array.isArray(filter.values) || !filter.values.length || filter.values.length > 100 || !filter.values.every(value => typeof value === 'string' && value.length <= 32_768) || new Set(filter.values).size !== filter.values.length) throw new Error('wecom-document: invalid literal filter values or column')
  }
}

export interface Config {
  readonly stateDir: string
  readonly dbPath: string
  readonly lockPath: string
  readonly workRoot: string
  readonly mainSessionId?: string
  readonly routerReadScope: 'none' | 'reported' | 'repo'
  readonly confirm: 'always' | 'when-ambiguous' | 'never'
  readonly acceptMode: 'off' | 'observe' | 'auto'
  readonly bots: 'deny' | 'infer'
  readonly paused: boolean
  readonly maxWorkers: number
  readonly queueLimit: number
  readonly evalTimeoutMs: number
  readonly maxEvalRequeues: number
  readonly maxStepsPerTicket: number
  readonly maxTokensPerTicket: number
  readonly maxDurationMsPerTicket: number
  readonly maxRetries: number
  readonly watchdogIntervalMs: number
  readonly stallMs: number
  readonly repeatCallThreshold: number
  readonly waitingHumanMs: number
  readonly budgetWarningRatio: number
  readonly approvalTimeoutMs: number
  readonly outboxMaxAttempts: number
  readonly outboxBackoffMs: number
  readonly outboxBackoffMaxMs: number
  readonly panelPollMs: number
  readonly panelPageSize: number
  readonly backupIntervalMs: number
  readonly backupKeep: number
  readonly triggerRetentionMs: number
  readonly outboundRetentionMs: number
  readonly sqliteBusyTimeoutMs: number
  readonly staleLockMs: number
  readonly sources: readonly SourceConfig[]
  /** Explicit Host-authorized roots; never derived from projects or browser paths. */
  readonly localSourceRoots?: readonly { readonly id: string; readonly path: string; readonly name?: string }[]
  readonly roleTools: {
    readonly router: readonly string[]
    readonly worker: readonly string[]
    readonly watchdog: readonly string[]
  }
}

/** Defaults are centralized configuration, never deployment constants in consumers. */
export const defaults = Object.freeze({
  routerReadScope: 'reported', confirm: 'when-ambiguous', acceptMode: 'auto', bots: 'deny', paused: false,
  maxWorkers: 3, queueLimit: 200, evalTimeoutMs: 120_000, maxEvalRequeues: 2,
  maxStepsPerTicket: 80, maxTokensPerTicket: 2_000_000, maxDurationMsPerTicket: 7_200_000, maxRetries: 2,
  watchdogIntervalMs: 60_000, stallMs: 300_000, repeatCallThreshold: 3, waitingHumanMs: 1_800_000,
  budgetWarningRatio: 0.8, approvalTimeoutMs: 86_400_000,
  outboxMaxAttempts: 5, outboxBackoffMs: 1_000, outboxBackoffMaxMs: 60_000,
  panelPollMs: 5_000, panelPageSize: 20, backupIntervalMs: 86_400_000, backupKeep: 7,
  triggerRetentionMs: 7_776_000_000, outboundRetentionMs: 2_592_000_000, sqliteBusyTimeoutMs: 5_000, staleLockMs: 3_600_000,
  roleTools: Object.freeze({
    router: ['read', 'glob', 'grep', 'ticket_create', 'ticket_list', 'ticket_status', 'ticket_cancel', 'ticket_resume', 'assignment_start', 'assignment_stop', 'human_ask', 'channel_reply', 'task_source_context'],
    worker: ['read', 'read_image', 'glob', 'grep', 'write', 'edit', 'bash', 'job_list', 'job_output', 'job_kill', 'report_progress', 'report_result', 'request_approval', 'ask_router', 'structured_output'],
    watchdog: ['read', 'watchdog_nudge', 'watchdog_steer', 'watchdog_cancel', 'watchdog_escalate', 'structured_output'],
  }),
})

/** Exported by host.cjs as the actual callable Schemastery Config, not a JSON object. */
export function createConfigSchema(z: SchemaFactory): SchemaNode<Config> {
  const positive = (value: number) => z.number().min(1).step(1).default(value)
  const nonnegative = (value: number) => z.number().min(0).step(1).default(value)
  return z.object({
    stateDir: z.string().required(), dbPath: z.string(), lockPath: z.string(), workRoot: z.string(),
    mainSessionId: z.string(),
    routerReadScope: z.union(['none', 'reported', 'repo']).default(defaults.routerReadScope),
    confirm: z.union(['always', 'when-ambiguous', 'never']).default(defaults.confirm),
    acceptMode: z.union(['off', 'observe', 'auto']).default(defaults.acceptMode),
    bots: z.union(['deny', 'infer']).default(defaults.bots), paused: z.boolean().default(defaults.paused),
    maxWorkers: positive(defaults.maxWorkers), queueLimit: positive(defaults.queueLimit),
    evalTimeoutMs: positive(defaults.evalTimeoutMs), maxEvalRequeues: nonnegative(defaults.maxEvalRequeues),
    maxStepsPerTicket: positive(defaults.maxStepsPerTicket), maxTokensPerTicket: positive(defaults.maxTokensPerTicket),
    maxDurationMsPerTicket: positive(defaults.maxDurationMsPerTicket), maxRetries: nonnegative(defaults.maxRetries),
    watchdogIntervalMs: positive(defaults.watchdogIntervalMs), stallMs: positive(defaults.stallMs),
    repeatCallThreshold: positive(defaults.repeatCallThreshold), waitingHumanMs: positive(defaults.waitingHumanMs),
    budgetWarningRatio: z.number().min(0).default(defaults.budgetWarningRatio),
    approvalTimeoutMs: positive(defaults.approvalTimeoutMs), outboxMaxAttempts: positive(defaults.outboxMaxAttempts),
    outboxBackoffMs: positive(defaults.outboxBackoffMs), outboxBackoffMaxMs: positive(defaults.outboxBackoffMaxMs),
    panelPollMs: positive(defaults.panelPollMs), panelPageSize: positive(defaults.panelPageSize),
    backupIntervalMs: positive(defaults.backupIntervalMs), backupKeep: positive(defaults.backupKeep),
    triggerRetentionMs: positive(defaults.triggerRetentionMs), outboundRetentionMs: positive(defaults.outboundRetentionMs),
    sqliteBusyTimeoutMs: nonnegative(defaults.sqliteBusyTimeoutMs), staleLockMs: nonnegative(defaults.staleLockMs),
    localSourceRoots: z.array(z.object({ id: z.string().required(), path: z.string().required(), name: z.string() })).default([]),
    sources: z.array(z.object({
      id: z.string().required(), kind: z.union(['session', 'inbox', 'wecom-document']).required(), attended: z.boolean().required(),
      doc: z.string(), sheet: z.string(), range: z.string(), idColumn: z.string(), titleColumn: z.string(),
      textColumns: z.array(z.string()).default(undefined), filter: z.object({ column: z.string().required(), values: z.array(z.string()).required() }).default(undefined),
      firstDataRow: z.number().min(1).step(1),
    })).default([]),
    roleTools: z.object({
      router: z.array(z.string()).default(defaults.roleTools.router),
      worker: z.array(z.string()).default(defaults.roleTools.worker),
      watchdog: z.array(z.string()).default(defaults.roleTools.watchdog),
    }).default({}),
  }) as SchemaNode<Config>
}

/** Cross-field/path validation, called after real Schemastery validation. */
export function resolveConfig(config: Config): Config {
  if (!isAbsolute(config.stateDir)) throw new Error('stateDir must be absolute')
  const dbPath = config.dbPath || resolve(config.stateDir, 'superagent.sqlite')
  const lockPath = config.lockPath || `${dbPath}.lock`
  const workRoot = config.workRoot || resolve(config.stateDir, 'work')
  if (![dbPath, lockPath, workRoot].every(isAbsolute)) throw new Error('configured paths must be absolute')
  if (new Set([resolve(dbPath), resolve(lockPath), resolve(workRoot)]).size !== 3) throw new Error('state paths must be distinct')
  if (config.budgetWarningRatio <= 0 || config.budgetWarningRatio >= 1) throw new Error('budgetWarningRatio must be between zero and one')
  if (config.outboxBackoffMaxMs < config.outboxBackoffMs) throw new Error('outbox backoff maximum is below base')
  const routerDenied = ['bash', 'write', 'edit', 'apply_patch', 'job_kill', 'job_output', 'job_list', 'git', 'merge_pr']
  if (config.roleTools.router.some(name => routerDenied.includes(name))) throw new Error('Router execution tools are forbidden')
  if (config.roleTools.worker.some(name => ['channel_reply', 'human_ask', 'ticket_create', 'ticket_list', 'ticket_status', 'ticket_cancel', 'ticket_resume', 'assignment_start', 'assignment_stop'].includes(name))) throw new Error('Worker channel tools are forbidden')
  if (config.roleTools.watchdog.some(name => !name.startsWith('watchdog_') && !['read', 'structured_output'].includes(name))) throw new Error('Watchdog execution tools are forbidden')
  for (const source of config.sources) {
    if (source.kind === 'wecom-document') validateWecomDocumentConfig(source)
    else {
      if (!['session', 'inbox'].includes(source.kind)) throw new Error('unsupported source kind')
      if (Object.entries(source).some(([key, value]) => !['id', 'kind', 'attended'].includes(key) && value !== undefined)) throw new Error('document fields require wecom-document kind')
    }
  }
  if (new Set(config.sources.map(source => source.id)).size !== config.sources.length) throw new Error('duplicate source instance id')
  const roots = config.localSourceRoots ?? []
  if (!Array.isArray(roots) || roots.length > 100 || roots.some(root => !root || Object.keys(root).some(key => !['id', 'path', 'name'].includes(key)) || typeof root.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(root.id) || typeof root.path !== 'string' || !isAbsolute(root.path) || root.name !== undefined && (typeof root.name !== 'string' || root.name.length > 80 || /[\/\\\x00-\x1f]/.test(root.name))) || new Set(roots.map(root => root.id)).size !== roots.length) throw new Error('local source roots must be distinct explicit Host authorizations')
  return { ...config, stateDir: resolve(config.stateDir), dbPath: resolve(dbPath), lockPath: resolve(lockPath), workRoot: resolve(workRoot) }
}
