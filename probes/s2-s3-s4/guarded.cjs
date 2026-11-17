// Disposable real-executor probe for approved option 1. No model or external effects.
const { randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')
const { writeFileSync } = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
exports.inject = ['agents', 'tools', 'agentPresets']
exports.apply = function apply(ctx, config) {
  const installed = createRequire(`${config.installDir}/package.json`)
  const { defineTool } = installed('@deepseek-ai/dsh-tools')
  const bindings = new WeakMap()
  const handles = []
  const result = { state: 'running', kind: 'option-1 actual executor guard', counts: {}, checks: {}, cleanup: {} }
  const save = () => writeFileSync(config.resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  const denial = (code, reason) => ({ reason, info: { name: 'SuperagentProbeDenial', code } })
  // Host-global registration, but the callback only constrains exact configured role presets.
  ctx.tools.guard(exec => {
    if (!exec.agent) return
    const preset = ctx.agentPresets.composedPreset(exec.agent.ctx)
    const role = config.roles.find(role => role.preset === preset)
    if (!role) return
    if (role.worker) {
      const binding = bindings.get(exec.agent)
      if (!binding) return denial('SA_ASSIGNMENT_UNBOUND', 'Worker Assignment is not bound')
      if (binding.state === 'ended') return denial('SA_ASSIGNMENT_ENDED', 'Worker Assignment has ended')
      if (!binding.current) return denial('SA_ASSIGNMENT_STALE', 'Worker Assignment is no longer current')
    }
    if (!role.allowedTools.includes(exec.name)) return denial('SA_ROLE_TOOL_DENIED', 'Tool is outside the Super-agent role capability set')
  })
  for (const name of [config.allowedSentinel, config.deniedSentinel]) {
    result.counts[name] = 0
    ctx.tools.register(defineTool({
      name,
      description: 'Disposable local counter sentinel. No external action.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { result.counts[name]++; return 'sentinel-ok' },
    }))
  }
  console.log('[superagent-probe] loaded')
  result.loadedMarkerEmitted = true
  const run = async () => {
    let db
    try {
      db = new DatabaseSync(config.dbPath)
      const wal = db.prepare('PRAGMA journal_mode=WAL').get()
      db.exec('CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY)')
      const committed = randomUUID()
      db.exec('BEGIN IMMEDIATE')
      db.prepare('INSERT INTO probe(id) VALUES (?)').run(committed)
      db.exec('COMMIT')
      const rolledBack = randomUUID()
      db.exec('BEGIN IMMEDIATE')
      db.prepare('INSERT INTO probe(id) VALUES (?)').run(rolledBack)
      db.exec('ROLLBACK')
      result.sqlite = { wal: wal.journal_mode, commitVisible: Boolean(db.prepare('SELECT id FROM probe WHERE id=?').get(committed)), rollbackInvisible: !db.prepare('SELECT id FROM probe WHERE id=?').get(rolledBack) }
      db.close(); db = undefined
      const make = async (preset, bind) => {
        const handle = await ctx.agents.create({
          sessionId: randomUUID(),
          meta: { cwd: config.cwd, ...(preset ? { agentPreset: preset } : {}) },
          agentOptions: { provider: config.modelProvider, model: config.model },
          setup: async (agentCtx, agent) => {
            if (preset) await ctx.agentPresets.mount(agentCtx, preset)
            if (bind) bindings.set(agent, { state: 'running', current: true })
          },
        })
        handles.push(handle)
        return handle.agent
      }
      const router = await make(config.routerPreset)
      const worker = await make(config.workerPreset, true)
      const watchdog = await make(config.watchdogPreset)
      const unbound = await make(config.workerPreset)
      const ordinary = await make()
      const call = async (agent, name, args = {}) => {
        const batch = await ctx.tools.execute({
          calls: [{ type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) }],
          agent, signal: new AbortController().signal,
        })
        const outcome = batch.results[0].result
        // Persist only fixed probe outputs or stable guard identity, never arbitrary body text.
        return { isError: outcome.isError, code: outcome.error?.info?.code ?? null, name: outcome.error?.info?.name ?? null, ...(outcome.value === 'sentinel-ok' || outcome.value === 'progress-probe-ok' ? { value: outcome.value } : {}) }
      }
      result.checks.ordinaryBefore = await call(ordinary, config.deniedSentinel)
      result.checks.routerAllowed = await call(router, config.allowedSentinel)
      result.checks.workerAllowed = await call(worker, 'report_progress')
      result.checks.routerDenied = await call(router, config.deniedSentinel)
      result.checks.workerDenied = await call(worker, config.deniedSentinel)
      result.checks.watchdogDenied = await call(watchdog, config.deniedSentinel)
      result.checks.unbound = await call(unbound, 'report_progress')
      bindings.get(worker).current = false
      result.checks.stale = await call(worker, 'report_progress')
      bindings.get(worker).current = true
      bindings.get(worker).state = 'ended'
      result.checks.ended = {}
      for (const [name, args] of Object.entries(config.endedCalls)) result.checks.ended[name] = await call(worker, name, args)
      result.checks.workerStillLiveWhenEnded = Boolean(ctx.agents.get(worker.id))
      result.checks.ordinaryAfter = await call(ordinary, config.deniedSentinel)
      result.guardDefinitionsStillVisible = ctx.tools.definitions(router).some(tool => tool.name === config.deniedSentinel)
      result.state = 'finished'
    } catch (error) {
      result.state = 'failed'
      result.failure = { name: String(error.name), code: typeof error.code === 'string' ? error.code : null }
    } finally {
      if (db) db.close()
      for (const handle of handles.reverse()) {
        try { await handle.dispose() } catch (error) { result.cleanup.error = String(error.name) }
      }
      result.cleanup.liveAgents = handles.filter(handle => ctx.agents.get(handle.agent.id)).length
      save()
    }
  }
  save()
  const running = Promise.resolve().then(run)
  ctx.effect(() => async () => { await running })
}
