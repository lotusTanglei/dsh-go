import { mkdirSync } from 'node:fs'
import { resolveConfig, type Config } from './config.js'
import { openStore } from './store/index.js'
import { installRoleGuard } from './tools/runtime.js'
import { createRuntime, readWorkerSnapshot, type RuntimeContext } from './runtime.js'
import { installPanelRoutes, type PanelConnection } from './panel/routes.js'

/** Host owns ordered resource cleanup; runtime keeps DSH calls behind structural adapters. */
export interface PluginContext {
  effect(factory: () => (() => void | Promise<void>)): unknown
  provide?(name: string, value: unknown): unknown
  logger?: { info(message: string): void }
  tools?: { guard?(callback: (execution: import('./tools/runtime.js').ToolExecutionContext) => unknown): unknown }
  agentPresets?: { composedPreset(ctx: unknown): string | undefined }
  connection?: PanelConnection
  agents?: RuntimeContext['agents']
  subagents?: RuntimeContext['subagents']
  sessionQuery?: RuntimeContext['sessionQuery']
  on?: RuntimeContext['on']
}

export const inject = ['tools', 'agentPresets', 'connection', 'agents', 'subagents', 'sessionQuery']

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
    let runtime: ReturnType<typeof createRuntime> | undefined
    let panel: ReturnType<typeof installPanelRoutes> | undefined
    let roleGuard: ReturnType<typeof installRoleGuard>
    // Cordis disposes independent effects concurrently. Keep resource ordering in one owner.
    ctx.effect(() => () => {
      if (!runtime && !panel) { roleGuard?.dispose(); store.close(); return }
      return (async () => {
        try { await panel?.dispose() }
        finally { try { await runtime?.dispose() } finally { roleGuard?.dispose(); store.close() } }
      })()
    })
    roleGuard = ctx.tools && ctx.agentPresets ? installRoleGuard({ tools: ctx.tools, agentPresets: ctx.agentPresets }, {
      roleTools: config.roleTools,
      routerPreset: 'dsh-superagent-router',
      workerPreset: 'dsh-superagent-worker',
      watchdogPreset: 'dsh-superagent-watchdog',
      resolveWorker: agent => readWorkerSnapshot(store, String((agent as { id?: string }).id ?? '')),
    }) : undefined
    if (roleGuard) {
      ctx.provide?.('superagentRoleGuard', roleGuard)
    }
    if (ctx.agents && ctx.subagents && ctx.sessionQuery && ctx.on && ctx.agentPresets) {
      runtime = createRuntime(ctx as unknown as RuntimeContext, store, config, roleGuard)
      ctx.provide?.('superagentRuntime', runtime)
      void runtime.ready.catch(() => console.error('[superagent] runtime initialization failed'))
      if (ctx.connection) panel = installPanelRoutes({ connection: ctx.connection }, store, config, runtime.panelPorts)
    } else if (ctx.connection) {
      panel = installPanelRoutes({ connection: ctx.connection }, store, config)
    }
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
export { createEngine } from './engine/index.js'
export { createWatchdog, measureWorker } from './engine/watchdog.js'
export { installPanelRoutes } from './panel/routes.js'
