// Disposable actual spawn probe. Exactly one child; no shell or write tool calls.
const { randomUUID } = require('node:crypto')
const { writeFileSync } = require('node:fs')
exports.inject = ['agents', 'tools', 'agentPresets', 'subagents']
exports.apply = function apply(ctx, config) {
  let parentHandle
  let activation
  let timer
  const controller = new AbortController()
  const result = { scope: 'Desktop actual spawn activation', state: 'running', cleanup: {} }
  const save = () => writeFileSync(config.resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  const task = async () => {
    try {
      parentHandle = await ctx.agents.create({
        sessionId: randomUUID(),
        meta: { cwd: config.cwd, agentPreset: config.routerPreset },
        agentOptions: { provider: config.modelProvider, model: config.model, reasoningEffort: config.reasoningEffort, maxTokens: config.maxTokens },
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, config.routerPreset) },
      })
      timer = setTimeout(() => controller.abort(), config.timeoutMs)
      activation = await ctx.subagents.startActivation({
        provider: 'spawn',
        label: config.childLabel,
        name: config.childName,
        parent: parentHandle.agent,
        cwd: config.cwd,
        agentPreset: config.workerPreset,
        prompt: [{ type: 'text', text: config.prompt }],
        agentOptions: { provider: config.modelProvider, model: config.model, reasoningEffort: config.reasoningEffort, maxTokens: config.maxTokens },
        signal: controller.signal,
        delivery: 'caller',
      })
      const child = ctx.agents.get(activation.childId)
      if (!child) throw new Error('PROBE_CHILD_NOT_LIVE_AT_PUBLICATION')
      const names = agent => ctx.tools.definitions(agent).map(tool => tool.name).sort()
      result.s2 = {
        startActivationReturned: true,
        actualPreset: ctx.agentPresets.composedPreset(child.ctx),
        expectedPreset: config.workerPreset,
        childIsDistinct: child.id !== parentHandle.agent.id,
      }
      const routerTools = names(parentHandle.agent)
      const workerTools = names(child)
      result.s3 = {
        routerTools, workerTools,
        routerPass: ['bash', 'write', 'edit', 'apply_patch'].every(name => !routerTools.includes(name)) && ['read', 'channel_reply', 'human_ask'].every(name => routerTools.includes(name)),
        workerPass: ['channel_reply', 'human_ask'].every(name => !workerTools.includes(name)) && ['bash', 'write', 'edit', 'report_progress'].every(name => workerTools.includes(name)),
      }
      const call = async () => {
        try {
          return { batch: await ctx.tools.execute({
            calls: [{ type: 'tool-call', id: randomUUID(), name: 'report_progress', arguments: '{}' }],
            agent: child,
            signal: new AbortController().signal,
          }) }
        } catch (error) {
          return { thrown: { name: String(error.name), code: typeof error.code === 'string' ? error.code : null } }
        }
      }
      const before = await call()
      save()
      const terminal = await activation.result
      result.s2.stopReason = terminal.stopReason
      result.s2.outputMatches = terminal.output.length === 1 && terminal.output[0].type === 'text' && terminal.output[0].text.trim() === config.expectedOutput
      result.s2.hasStructured = terminal.structured !== undefined
      result.s4 = { mechanism: 'actual activation completion/dispose; not a live Assignment gate', before, afterResult: await call() }
      await activation.dispose()
      result.s4.afterDispose = await call()
      result.state = 'finished'
    } catch (error) {
      result.state = 'failed'
      // Never persist arbitrary transport messages, credentials, or private URLs.
      result.failure = { name: String(error.name), code: typeof error.code === 'string' ? error.code : null }
    } finally {
      clearTimeout(timer)
      if (activation) {
        try { await activation.dispose() } catch (error) { result.cleanup.activationError = String(error.name) }
        result.cleanup.childStillLive = Boolean(ctx.agents.get(activation.childId))
      }
      if (parentHandle) {
        try { await parentHandle.dispose() } catch (error) { result.cleanup.parentError = String(error.name) }
        result.cleanup.parentStillLive = Boolean(ctx.agents.get(parentHandle.agent.id))
      }
      result.timedOut = controller.signal.aborted
      save()
    }
  }
  save()
  const running = Promise.resolve().then(task)
  ctx.effect(() => async () => { controller.abort(); await running })
}
