import { mkdirSync } from 'node:fs'
import { resolveConfig, type Config } from './config.js'
import { openStore } from './store/index.js'
import { installRoleGuard } from './tools/runtime.js'

/** Host adapter boundary. Sessions remain behind src/sessions; P2 only installs the deny-only guard. */
export interface PluginContext {
  effect(factory: () => (() => void | Promise<void>)): unknown
  logger?: { info(message: string): void }
  tools?: { guard?(callback: (execution: import('./tools/runtime.js').ToolExecutionContext) => unknown): unknown }
  agentPresets?: { composedPreset(ctx: unknown): string | undefined }
}

export const inject = ['tools', 'agentPresets']

export function apply(ctx: PluginContext, input: Config): void {
  const config = resolveConfig(input)
  let store: ReturnType<typeof openStore>
  try {
    mkdirSync(config.stateDir, { recursive: true })
    store = openStore({ dbPath: config.dbPath, lockPath: config.lockPath, busyTimeoutMs: config.sqliteBusyTimeoutMs, staleLockMs: config.staleLockMs })
  } catch {
    // Cordis may log activation failures: do not forward OS errors containing private paths.
    throw new Error('Superagent store could not open; check configured paths, lock ownership and migration compatibility')
  }
  try {
    ctx.effect(() => () => store.close())
    const roleGuard = ctx.tools && ctx.agentPresets ? installRoleGuard({ tools: ctx.tools, agentPresets: ctx.agentPresets }, {
      roleTools: config.roleTools,
      routerPreset: 'dsh-superagent-router',
      workerPreset: 'dsh-superagent-worker',
      watchdogPreset: 'dsh-superagent-watchdog',
    }) : undefined
    if (roleGuard) ctx.effect(() => () => roleGuard.dispose())
    // No paths, input data, credentials, raw diagnostics or private URLs in logs.
    console.log('[superagent] loaded')
  } catch (error) {
    store.close()
    throw error
  }
}

export { createConfigSchema, resolveConfig, defaults } from './config.js'
export type { Config } from './config.js'
export * from './domain/index.js'
