const { randomUUID } = require('node:crypto')
const { writeFileSync, mkdirSync } = require('node:fs')
const { createRequire } = require('node:module')

exports.inject = ['agents', 'subagents', 'agentPresets', 'tools', 'tokenMeter', 'sessionQuery', 'superagentRoleGuard']
exports.apply = function apply(ctx, config) {
  const handles = []
  const controller = new AbortController()
  const result = { state: 'running', acceptedTickets: config.singleWorker ? 1 : 2, expectedTriggers: config.singleWorker ? 1 : 3, workerReports: [], turns: {}, tokenUsage: {}, effectiveOptions: { router: config.routerAgentOptions, worker: config.workerAgentOptions }, sessionEvents: {} }
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
      const { startWorker, spawnerFromContext } = await import('../lib/sessions/worker.js')
      const spawner = spawnerFromContext({ subagents: ctx.subagents, agents: ctx.agents, superagentRoleGuard: ctx.superagentRoleGuard })
      const workers = []
      mkdirSync(config.workRoot, { recursive: true })
      for (let i = 0; i < (config.singleWorker ? 1 : 2); i++) {
        const ticketId = `ticket-${i + 1}`
        const assignmentId = `assignment-${i + 1}`
        const sessionId = randomUUID()
        const workdir = `${config.workRoot}/${ticketId}`
        mkdirSync(workdir, { recursive: true })
        const brief = {
          goal: 'Complete the harmless fixture task and submit a structured report.',
          scope: { repo: config.cwd, subdirs: [] },
          base: { ref: 'fixture', requireCleanTree: false },
          allowWrite: [], denyWrite: ['**'], runtime: 'No external side effects.',
          acceptance: [{ id: 'A1', check: 'Return a ready report with fixture evidence.', kind: 'assertion' }],
          outOfScope: ['All code changes'], blockers: [], firstAction: 'Read the supplied fixture brief.', approvalsRequired: [],
        }
        const worker = await startWorker({
          ticket: { id: ticketId, title: `Fixture ticket ${i + 1}`, brief, workdir },
          assignment: { id: assignmentId, ticketId, sessionId }, brief, workdir,
          preset: config.workerPreset, parent: routerAgent, signal: controller.signal, agentOptions: config.workerAgentOptions,
        }, spawner)
        workers.push(worker)
      }
      result.turns.router = 1
      result.routerInjectedReports = []
      for (const worker of workers) {
        const output = await worker.result
        result.workerReports.push({
          structured: output.structured ?? null,
          hasStructured: output.structured !== undefined,
          stopReason: output.stopReason ?? null,
          outputCount: Array.isArray(output.output) ? output.output.length : null,
          outputKinds: Array.isArray(output.output) ? output.output.map(item => typeof item?.type === 'string' ? item.type : 'unknown') : [],
          diagnostic: output.diagnostic ?? null,
          tokenUsage: output.tokenUsage ?? output.usage ?? null,
        })
        result.routerInjectedReports.push({ ticketId: `ticket-${result.routerInjectedReports.length + 1}`, assignmentId: `assignment-${result.routerInjectedReports.length + 1}`, report: output.structured ?? null, wakeup: false })
        const childId = worker.childId ?? worker.id ?? worker.sessionId
        if (ctx.sessionQuery?.readSession && childId) {
          try {
            const snapshot = await ctx.sessionQuery.readSession(childId)
            result.sessionEvents[childId] = snapshot.events.slice(-5).map(event => ({ type: event.type, summary: JSON.stringify(event).slice(0, 500) }))
          } catch (error) {
            result.sessionEvents[childId] = { readError: String(error?.message ?? error) }
          }
        }
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
