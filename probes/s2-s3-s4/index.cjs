// One-shot, real Agent/executor probe. No waking input and no LLM calls.
const { randomUUID } = require('node:crypto')
const { writeFileSync } = require('node:fs')
exports.inject = ['agents', 'tools', 'agentPresets']
exports.apply = function apply(ctx, config) {
  const handles = []
  const result = { scope: 'Desktop real Agent + native tool executor; no LLM input', state: 'running', evidence: [] }
  const save = () => writeFileSync(config.resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  const task = async () => {
    try {
      const make = async preset => {
        const handle = await ctx.agents.create({
          sessionId: randomUUID(),
          meta: { cwd: config.cwd, agentPreset: preset, origin: 'subagent' },
          agentOptions: { provider: config.modelProvider, model: config.model },
          setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) },
        })
        handles.push(handle)
        return handle
      }
      const router = await make(config.routerPreset)
      const worker = await make(config.workerPreset)
      const names = agent => ctx.tools.definitions(agent).map(tool => tool.name).sort()
      const routerTools = names(router.agent)
      const workerTools = names(worker.agent)
      const forbiddenRouter = ['bash', 'write', 'edit', 'apply_patch']
      const forbiddenWorker = ['channel_reply', 'human_ask']
      result.s2 = { declarationAndAgentCreate: true, startActivation: 'NOT RUN: no model or waking input authorized' }
      result.s3 = {
        routerTools, workerTools,
        routerPass: forbiddenRouter.every(name => !routerTools.includes(name)) && ['read', 'channel_reply', 'human_ask'].every(name => routerTools.includes(name)),
        workerPass: forbiddenWorker.every(name => !workerTools.includes(name)) && ['bash', 'write', 'edit', 'report_progress'].every(name => workerTools.includes(name)),
        routerStatus: router.agent.status, workerStatus: worker.agent.status,
        routerPreset: ctx.agentPresets.composedPreset(router.agent.ctx),
        workerPreset: ctx.agentPresets.composedPreset(worker.agent.ctx),
      }
      const call = async () => {
        try {
          return { batch: await ctx.tools.execute({
            calls: [{ type: 'tool-call', id: randomUUID(), name: 'report_progress', arguments: '{}' }],
            agent: worker.agent,
            signal: new AbortController().signal,
          }) }
        } catch (error) {
          // Never serialize arbitrary error messages/stacks with possible private data.
          return { thrown: { name: String(error.name), code: typeof error.code === 'string' ? error.code : null } }
        }
      }
      const before = await call()
      await worker.dispose()
      const after = await call()
      result.s4 = { mechanism: 'AgentHandle.dispose only; not a product Assignment-state gate', before, after }
      result.state = 'finished'
    } catch (error) {
      result.state = 'failed'
      result.failure = { name: String(error.name), code: typeof error.code === 'string' ? error.code : null }
    } finally {
      for (const handle of handles.reverse()) {
        try { await handle.dispose() } catch (error) { result.evidence.push({ cleanupFailure: String(error.name) }) }
      }
      result.cleanup = { liveProbeAgentsRemaining: handles.filter(handle => ctx.agents.get(handle.agent.id)).length }
      save()
    }
  }
  save()
  // Defer beyond apply; all promise failures are contained and recorded.
  const running = Promise.resolve().then(task)
  ctx.effect(() => async () => { await running })
}
