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
  readonly kind: 'session' | 'inbox'
  readonly attended: boolean
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
    router: ['read', 'glob', 'grep', 'ticket_create', 'ticket_list', 'ticket_status', 'ticket_cancel', 'ticket_resume', 'assignment_start', 'assignment_stop', 'human_ask', 'channel_reply'],
    worker: ['read', 'read_image', 'glob', 'grep', 'write', 'edit', 'bash', 'job_list', 'job_output', 'job_kill', 'report_progress', 'report_result', 'request_approval', 'ask_router', 'structured_output'],
    watchdog: ['read', 'watchdog_nudge', 'watchdog_steer', 'watchdog_cancel', 'watchdog_escalate'],
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
    sources: z.array(z.object({ id: z.string().required(), kind: z.union(['session', 'inbox']).required(), attended: z.boolean().required() })).default([]),
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
  if (config.roleTools.worker.some(name => ['channel_reply', 'human_ask'].includes(name))) throw new Error('Worker channel tools are forbidden')
  if (config.roleTools.watchdog.some(name => !name.startsWith('watchdog_') && name !== 'read')) throw new Error('Watchdog execution tools are forbidden')
  if (new Set(config.sources.map(source => source.id)).size !== config.sources.length) throw new Error('duplicate source instance id')
  return { ...config, stateDir: resolve(config.stateDir), dbPath: resolve(dbPath), lockPath: resolve(lockPath), workRoot: resolve(workRoot) }
}
