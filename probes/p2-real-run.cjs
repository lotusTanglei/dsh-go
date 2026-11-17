const { randomUUID } = require('node:crypto')
const { writeFileSync, mkdirSync } = require('node:fs')
const { createRequire } = require('node:module')

exports.inject = ['agents', 'subagents', 'agentPresets', 'tools', 'tokenMeter']
exports.apply = function apply(ctx, config) {
  const handles = []
  const controller = new AbortController()
  const result = { state: 'running', acceptedTickets: 2, expectedTriggers: 3, workerReports: [], turns: {}, tokenUsage: {} }
  const save = () => writeFileSync(config.resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  const make = async (sessionId, preset, prompt, agentOptions) => {
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: config.cwd, agentPreset: preset },
      agentOptions,
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) },
    })
    handles.push(handle)
    return handle
  }
  const task = async () => {
    try {
      const router = await make(randomUUID(), config.routerPreset, [{ type: 'text', text: config.routerPrompt }], config.routerAgentOptions)
      const routerAgent = router.agent
      const workers = []
      mkdirSync(config.workRoot, { recursive: true })
      for (let i = 0; i < 2; i++) {
        const worker = await ctx.subagents.startActivation({
          provider: 'spawn', delivery: 'caller', parent: routerAgent,
          label: `p2-worker-${i + 1}`, name: `p2-worker-${i + 1}`,
          childId: randomUUID(), cwd: `${config.workRoot}/ticket-${i + 1}`,
          _ensureCwd: mkdirSync(`${config.workRoot}/ticket-${i + 1}`, { recursive: true }),
          agentPreset: config.workerPreset, prompt: [{ type: 'text', text: `${config.workerPrompt}\nTicket ${i + 1}: return a complete structured report.` }],
          outputSchema: config.outputSchema, signal: controller.signal, agentOptions: config.workerAgentOptions,
        })
        workers.push(worker)
      }
      result.turns.router = 1
      for (const worker of workers) {
        const output = await worker.result
        result.workerReports.push({
          structured: output.structured ?? null,
          hasStructured: output.structured !== undefined,
          stopReason: output.stopReason ?? null,
          outputCount: Array.isArray(output.output) ? output.output.length : null,
          outputKinds: Array.isArray(output.output) ? output.output.map(item => typeof item?.type === 'string' ? item.type : 'unknown') : [],
        })
        result.turns[worker.childId ?? worker.id ?? 'worker'] = 1
        try { await worker.dispose() } catch (error) { result.disposeError = String(error.name) }
      }
      try { result.tokenUsage.router = ctx.tokenMeter?.measure(routerAgent)?.tokenUsage ?? ctx.tokenMeter?.measure(routerAgent)?.totalTokens ?? null } catch { result.tokenUsage.router = null }
      result.state = 'finished'
    } catch (error) {
      result.state = 'failed'
      result.failure = { name: String(error?.name ?? 'Error'), code: typeof error?.code === 'string' ? error.code : null }
    } finally {
      controller.abort()
      for (const handle of handles.reverse()) { try { await handle.dispose() } catch {} }
      result.cleanup = { liveAgents: handles.filter(handle => ctx.agents.get(handle.agent.id)).length }
      save()
    }
  }
  save()
  const running = task()
  ctx.effect(() => async () => { controller.abort(); await running })
}
