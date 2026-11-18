// Explicitly started, isolated-profile acceptance adapter. Never auto-runs a model.
const { randomUUID } = require('node:crypto')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
exports.inject = ['agents', 'sessionQuery', 'superagentRuntime', 'connection']
exports.apply = function apply(ctx, config) {
  let running, timer, releaseWait, disposed = false
  const result = { state: 'idle', kind: 'production-runtime-e2e', modelsStarted: false }
  const output = resolve(config.resultPath)
  const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }) }
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const current = () => ctx.superagentRuntime.diagnostics()
  const waitFor = async (condition, deadline) => {
    while (!disposed) {
      if (condition()) return
      if (Date.now() >= deadline) throw Object.assign(new Error('probe deadline'), { code: 'PROBE_DEADLINE' })
      // Bounded acceptance observer, not a model request or a product timer.
      await new Promise(resolve => { releaseWait = resolve; timer = setTimeout(resolve, 100) })
    }
    throw Object.assign(new Error('probe disposed'), { code: 'PROBE_DISPOSED' })
  }
  const summarizeSession = async id => {
    const snapshot = await ctx.sessionQuery.readSession(id)
    const events = snapshot.events || []
    const messages = events.filter(event => event.type === 'assistant/message')
    const usageRows = messages.map(event => event.data.usage).filter(Boolean)
    const usage = usageRows.length ? usageRows.reduce((sum, row) => {
      for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) sum[key] = (sum[key] || 0) + (row[key] || 0)
      return sum
    }, {}) : null
    return { id, turns: events.filter(event => event.type === 'turn/start').length, steps: events.filter(event => event.type === 'step/start').length, usage, toolCalls: events.filter(event => event.type === 'tool/call').map(event => event.data.name), injectedReportMessages: events.filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted || []).filter(message => message.source?.kind !== 'user' && message.content?.some(block => typeof block.text === 'string' && block.text.includes('assignmentId') && block.text.includes('report'))).map(message => ({ id: message.id, sourceKind: message.source.kind })) }
  }
  const task = async () => {
    try {
      await ctx.superagentRuntime.ready
      const before = current()
      result.before = before
      const main = ctx.agents.get(before.mainSessionId)
      if (!main) throw Object.assign(new Error('Router missing'), { code: 'NO_ROUTER' })
      main.model.select({ provider: 'deepseek-official', model: 'deepseek-flash' })
      const deadline = Date.now() + 300000
      const send = async (text, externalId) => {
        const first = await summarizeSession(main.id)
        main.followup({ id: externalId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
        result.modelsStarted = true
        let timeout
        try { await Promise.race([main.whenIdle(), new Promise((_, reject) => { timeout = setTimeout(() => { main.cancel({ kind: 'user' }); reject(Object.assign(new Error('Router deadline'), { code: 'ROUTER_DEADLINE' })) }, Math.max(1, deadline - Date.now())) })]) }
        finally { clearTimeout(timeout) }
        const after = await summarizeSession(main.id)
        result.triggerTurns ||= []
        result.triggerTurns.push({ externalId, turns: after.turns - first.turns, steps: after.steps - first.steps })
      }
      const makeBrief = number => ({ goal: `Harmless acceptance fixture ${number}. No file reads, writes, shell, channels, approvals or human questions. Complete by calling structured_output with state ready, done [fixture completed], todo [], changedPaths [], acceptance [{id:A1,result:passed,evidence:fixture}], risks [], needHuman [].`, scope: { repo: config.cwd, subdirs: [] }, base: { ref: 'fixture', requireCleanTree: false }, allowWrite: [], denyWrite: ['**'], runtime: 'No external effects. Only structured_output is needed.', acceptance: [{ id: 'A1', check: 'Submit the fixture report through structured_output.', kind: 'assertion' }], outOfScope: ['Any filesystem or network operation'], blockers: [], firstAction: 'Submit the fixture structured_output report.', approvalsRequired: [] })
      result.triggerIds = [randomUUID(), randomUUID(), randomUUID()]
      result.state = 'running'; save()
      await send(`This is a bounded authorized fixture task, not a request for planning. Use ticket_create once with exactly this complete brief, then assignment_start with its returned ticketId, then stop your turn. Do not use any other tool, do not fabricate ids. Brief: ${JSON.stringify(makeBrief(1))}`, result.triggerIds[0])
      await waitFor(() => current().tickets.filter(row => !before.tickets.some(old => old.id === row.id) && row.state === 'ended').length >= 1, deadline)
      await send('Hello. This message is conversational only: do not create or start a ticket, do not use tools. Answer HELLO in prose.', result.triggerIds[1])
      await send(`Second independent bounded fixture task. Use ticket_create once with exactly this complete brief, then assignment_start with its returned ticketId, then stop your turn. Do not use any other tool, do not fabricate ids. Brief: ${JSON.stringify(makeBrief(2))}`, result.triggerIds[2])
      await waitFor(() => current().tickets.filter(row => !before.tickets.some(old => old.id === row.id) && row.state === 'ended').length >= 2, deadline)
      const after = current()
      result.after = after
      const tickets = after.tickets.filter(row => !before.tickets.some(old => old.id === row.id))
      const assignments = after.assignments.filter(row => !before.assignments.some(old => old.id === row.id))
      const triggers = after.triggers.filter(row => result.triggerIds.includes(row.externalId))
      result.observed = { triggers: triggers.length, tickets: tickets.length, assignments: assignments.length, validReports: assignments.filter(row => row.report?.state === 'ready' && row.report.acceptance?.every(item => item.result === 'passed')).length, completedTickets: tickets.filter(row => row.outcome === 'completed').length }
      result.sessions = await Promise.all([main.id, ...assignments.map(row => row.sessionId)].map(summarizeSession))
      result.state = result.observed.triggers === 3 && result.observed.tickets === 2 && result.observed.assignments === 2 && result.observed.validReports === 2 && result.observed.completedTickets === 2 && result.sessions[0].injectedReportMessages.length >= 2 && result.triggerTurns.every(row => row.turns > 0 && row.turns <= 3) ? 'passed' : 'failed'
    } catch (error) {
      result.state = 'failed'
      result.error = { name: String(error?.name || 'Error'), code: String(error?.code || 'PROBE_FAILED') }
      try { result.after = current() } catch {}
    } finally { save() }
  }
  save()
  void ctx.superagentRuntime.ready.then(() => { result.ready = true; save() }, error => { result.ready = false; result.startupError = { name: String(error?.name), code: String(error?.code || ''), reason: String(error?.message || '').replace(/\/Users\/[^\s"']+/g, '[PRIVATE_PATH]').slice(0, 1500) }; save() })
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/superagent-dev/probe-status', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ ok: false }, 403)
    return json(result)
  } }))
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/superagent-dev/probe-start', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ ok: false }, 403)
    if (running) return json({ ok: false, code: 'ALREADY_STARTED' }, 409)
    running = task()
    return json({ ok: true, state: 'started' })
  } }))
  ctx.effect(() => async () => { disposed = true; clearTimeout(timer); releaseWait?.(); const main = ctx.agents.get(current().mainSessionId); main?.cancel({ kind: 'user' }); if (running) await running })
}
