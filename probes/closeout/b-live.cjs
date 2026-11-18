// Explicit CLI-only acceptance fixture: one real Worker held at its first report tool.
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { DatabaseSync } = require('node:sqlite')
exports.inject = ['superagentRuntime', 'agents', 'subagents', 'sessionQuery', 'agentPresets']
exports.apply = function (ctx, config) {
  const runtime = ctx.superagentRuntime
  const result = { kind: 'closeout-b-production-stall-chain', state: 'running', startedAt: new Date().toISOString(), providerRequests: [], actualCalls: [], boundary: 'Real Worker/model; controlled report-tool hold; production runtime.tick/stopTicket/outbox. Router fixture is created deterministically, not a Router-model e2e.' }
  let workerId, ticketId, held = false, disposed = false, runtimeReady = false
  let releaseHold, holdReady
  const hold = new Promise(resolve => { holdReady = resolve })
  const restores = []
  const record = (name, details = {}) => result.actualCalls.push({ at: Date.now(), name, ...details })
  const until = async (condition, timeoutMs) => {
    const start = Date.now()
    while (!condition()) { if (disposed || Date.now() - start >= timeoutMs) throw Object.assign(new Error('fixture deadline'), { code: 'SA_FIXTURE_DEADLINE' }); await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  const originalInterrupt = ctx.subagents.interrupt
  ctx.subagents.interrupt = function (id, authority) { if (id === workerId) record('subagents.interrupt', { sessionId: id, authority: authority.kind }); return originalInterrupt.call(this, id, authority) }
  restores.push(() => { ctx.subagents.interrupt = originalInterrupt })
  ctx.on('agent/created', ({ agent }) => {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== 'dsh-superagent-worker') return
    workerId = agent.id
    const original = agent.steer
    agent.steer = function (message) { record('agent.steer', { sessionId: agent.id, messageId: message.id, text: message.content.filter(row => row.type === 'text').map(row => row.text).join('\n') }); return original.call(this, message) }
    restores.push(() => { agent.steer = original })
  })
  ctx.on('llm/stream', function (options, next) {
    if (options.sessionId === workerId) {
      if (result.providerRequests.length >= 2) throw Object.assign(new Error('fixture request budget'), { code: 'SA_FIXTURE_REQUEST_LIMIT' })
      result.providerRequests.push({ at: Date.now(), sessionId: options.sessionId, provider: options.provider, model: options.model })
    }
    return next()
  })
  ctx.on('tools/execute', async (execution, next) => {
    if (execution.agent?.id !== workerId || execution.name !== 'structured_output' || held) return next()
    held = true; record('fixture.report_hold', { sessionId: workerId, callId: execution.callId }); holdReady()
    await new Promise(resolve => {
      const release = () => { execution.signal.removeEventListener('abort', release); resolve() }
      releaseHold = release
      if (execution.signal.aborted) release()
      else execution.signal.addEventListener('abort', release, { once: true })
    })
    record('fixture.hold_released', { aborted: execution.signal.aborted })
    return next()
  })
  const task = (async () => {
    let database
    try {
      await runtime.ready; runtimeReady = true
      const main = ctx.agents.get(runtime.diagnostics().mainSessionId)
      main.model.select({ provider: 'deepseek-official', model: 'deepseek-flash' })
      const { createTrigger } = await import('../../lib/domain/trigger.js')
      const trigger = createTrigger({ source: `session:${main.id}`, externalId: 'closeout-b-controlled-input', threadKey: `session:${main.id}`, actor: { id: 'human', source: `session:${main.id}`, bot: false }, text: 'Controlled acceptance fixture: return the report only; never read or write files.', at: Date.now(), trust: 'human', addressed: 'direct', raw: null })
      runtime.engine.ingest(trigger)
      const brief = { goal: 'Controlled acceptance fixture. Immediately call structured_output with state ready, done [fixture], todo [], changedPaths [], acceptance [{id:A1,result:passed,evidence:fixture}], risks [], needHuman []. Do not call any other tool.', scope: { repo: resolve(config.workRoot), subdirs: [] }, base: { ref: 'unknown', requireCleanTree: false }, allowWrite: [], denyWrite: ['**'], runtime: 'controlled fixture', acceptance: [{ id: 'A1', kind: 'assertion', check: 'Return fixture only' }], outOfScope: ['all file operations', 'network', 'shell'], blockers: [], firstAction: 'Call structured_output immediately', approvalsRequired: [] }
      const created = await runtime.invoke('ticket_create', { brief }, { agent: main })
      if (created.code !== 'SA_CREATED') throw Object.assign(new Error('ticket fixture failed'), { code: created.code })
      ticketId = created.ticketId; result.ticketId = ticketId
      const started = await runtime.startAssignment(ticketId)
      if (started.code !== 'SA_STARTED') throw Object.assign(new Error('worker fixture failed'), { code: started.code })
      result.assignmentId = started.assignmentId; result.workerSessionId = workerId
      await Promise.race([hold, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('hold deadline'), { code: 'SA_HOLD_DEADLINE' })), 45_000))])
      database = new DatabaseSync(resolve(config.dbPath), { readOnly: true })
      const rows = () => database.prepare("SELECT * FROM audit WHERE action = 'watchdog' ORDER BY id").all().map(row => ({ at: row.at, ...JSON.parse(row.detail).value }))
      // Wall-clock sleeps are bounded fixture timing, not fabricated progress or injected metrics.
      await until(() => rows().some(row => row.action === 'nudge' && row.outcome === 'completed'), 1500).catch(async () => { await runtime.tick() })
      if (!rows().some(row => row.action === 'nudge' && row.outcome === 'completed')) throw Object.assign(new Error('nudge missing'), { code: 'SA_NUDGE_MISSING' })
      const firstNudge = rows().find(row => row.action === 'nudge' && row.outcome === 'completed')
      await until(() => Date.now() - firstNudge.metrics.at > config.stallMs, 2000)
      await runtime.tick()
      record('assignmentStop.persisted', { ...database.prepare('SELECT state, ended_reason FROM assignment WHERE id=?').get(started.assignmentId) })
      await runtime.tick(); await runtime.tick()
      result.audits = rows()
      result.outbound = database.prepare('SELECT id,state,attempts,idempotency_key FROM outbound').all()
      const worker = await ctx.sessionQuery.readSession(workerId)
      result.usage = worker.events.filter(row => row.type === 'assistant/message' && row.data?.usage).reduce((sum, row) => { for (const key of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) sum[key] += Number(row.data.usage[key]) || 0; return sum }, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
      result.workerEvents = worker.events.filter(row => ['turn/start', 'turn/end', 'tool/call', 'agent/inbox/spliced'].includes(row.type)).map(row => ({ type: row.type, time: row.time, ...(row.type === 'tool/call' ? { name: row.data.name } : {}) }))
      const router = await ctx.sessionQuery.readSession(main.id)
      result.noticeSplices = router.events.filter(row => row.type === 'agent/inbox/spliced' && row.data.inserted.some(message => result.outbound.some(out => out.idempotency_key === message.id))).map(row => ({ type: row.type, time: row.time, ids: row.data.inserted.map(message => message.id) }))
      result.ticket = database.prepare('SELECT state,outcome,stopped_by_human FROM ticket WHERE id=?').get(ticketId)
      result.workerCount = database.prepare('SELECT COUNT(*) AS n FROM assignment').get().n
      result.ticketCount = database.prepare('SELECT COUNT(*) AS n FROM ticket').get().n
      const actions = result.audits.filter(row => row.outcome === 'completed').map(row => row.action)
      result.chainPassed = JSON.stringify(actions) === JSON.stringify(['nudge', 'cancel', 'escalate']) && result.audits.length === 6 && result.audits.every(row => row.rule === 'stall' && !row.state?.budgetStage && ['stallMs', 'tokens', 'durationMs', 'repeatedCalls'].every(key => typeof row.metrics?.[key] === 'number')) && JSON.stringify(result.audits.filter(row => row.outcome === 'completed').map(row => row.state.stallStage)) === '[1,2,3]' && result.actualCalls.some(row => row.name === 'agent.steer') && result.actualCalls.some(row => row.name === 'subagents.interrupt') && result.ticketCount === 1 && result.workerCount === 1 && result.outbound.length === 1 && result.outbound[0].state === 'sent' && result.noticeSplices.length === 1
    } catch (error) { result.error = { code: String(error?.code || 'SA_CLOSEOUT_B_FAILED') } }
    finally {
      releaseHold?.()
      if (runtimeReady) try { await runtime.dispose() } catch { result.cleanupFailed = true }
      for (const restore of restores.reverse()) restore()
      database?.close()
      result.liveAgents = ctx.agents.list().length
      result.finishedAt = new Date().toISOString()
      result.state = !result.error && !result.cleanupFailed && result.chainPassed && result.actualCalls.some(row => row.name === 'fixture.hold_released' && row.aborted === true) && result.actualCalls.some(row => row.name === 'assignmentStop.persisted' && row.state === 'ended') && result.ticket?.state === 'ended' && result.ticket.outcome === 'stopped' && result.ticket.stopped_by_human === 0 && result.liveAgents === 0 && result.providerRequests.length > 0 && result.providerRequests.length <= 2 ? 'passed' : 'failed'
      writeFileSync(resolve(config.resultPath), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    }
  })()
  ctx.effect(() => async () => { disposed = true; releaseHold?.(); await task })
}
