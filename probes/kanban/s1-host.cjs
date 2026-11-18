// Real installed Host + deterministic local adapter. No network/model provider requests.
const fs = require('node:fs')
const p = require('node:path')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
exports.inject = ['superagentRuntime', 'agents', 'agentPresets', 'connection', 'sessionQuery', 'sessions', 'llm', 'clientModules']
exports.apply = function (ctx, config) {
  const installed = createRequire(p.join(process.env.DSH_INSTALL_DIR, 'package.json'))
  const { LlmAdapter } = installed('@deepseek-ai/dsh-llm')
  const result = { kind: 'kanban-s1-real-host-local-adapter', startedAt: new Date().toISOString(), externalProviderRequests: 0, localAdapterCalls: 0, boundary: 'Real Agent/inbox/admission/owner handler/flush. Router adapter synthetic; production Worker stays blocked by verified safety failure. Channel notice fixture is not a real Worker completion.' }
  const brief = { goal: 'Synthetic Host admission task', scope: { repo: '/tmp/kanban-host-planning-only', subdirs: [] }, base: { ref: 'fixture', requireCleanTree: false }, allowWrite: ['src/**'], denyWrite: ['src/deny/**'], runtime: 'isolated zero-token fixture', acceptance: [{ id: 'A1', kind: 'assertion', check: 'Synthetic Host evidence only' }], outOfScope: ['real file execution'], blockers: [], firstAction: 'Report boundary', approvalsRequired: [] }
  class LocalFixtureAdapter extends LlmAdapter {
    async *stream(options) {
      result.localAdapterCalls++
      if (result.localAdapterCalls > 3) throw new Error('fixture runaway')
      const first = result.localAdapterCalls === 1
      const block = first ? { type: 'tool-call', id: 'kanban-fixture-create', name: 'ticket_create', arguments: JSON.stringify({ brief }) } : { type: 'text', text: 'A specific plan is ready for your confirmation in this workspace.' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: first ? 'tool-calls' : 'stop' } }
    }
  }
  const adapter = ctx.llm.registerAdapter(['kanban-local-fixture'], new LocalFixtureAdapter())
  ctx.on('llm/stream', (options, next) => {
    if (options.provider !== 'kanban-local-fixture') { result.externalProviderRequests++; throw new Error('external provider forbidden') }
    return next()
  })
  const task = (async () => {
    const runtime = ctx.superagentRuntime
    try {
      await runtime.ready
      const agent = ctx.agents.get(runtime.diagnostics().mainSessionId)
      agent.model.select({ provider: 'kanban-local-fixture', model: 'deterministic' })
      const handler = ctx.connection.createSharedFetchHandler('/api')
      const post = async (route, body, origin) => {
        const response = await handler.fetch(new Request(`http://localhost/api/superagent/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }), ctx.connection.browserPeer)
        return { status: response.status, body: await response.json() }
      }
      result.workspace = await post('workspace', {})
      result.originDenied = (await post('workspace', {}, 'https://hostile.invalid')).status
      const epoch = result.workspace.body.data.epoch
      const input = { epoch, requestId: randomUUID(), intent: 'new-task', text: 'Create one synthetic fixture task. Do not execute files.' }
      result.input = await post('command', input)
      result.retry = await post('command', input)
      result.conflict = await post('command', { ...input, text: 'different input' })
      await agent.whenIdle()
      result.receipt = await post('command-status', { epoch, requestId: input.requestId })
      const current = await post('workspace', {})
      const plan = current.body.data.admissions.find(row => row.requestId === input.requestId)
      result.plan = plan ? { planId: plan.planId, state: plan.state, fingerprint: plan.fingerprint } : null
      if (!plan) throw new Error('admission plan missing')
      result.admission = await post('admission', { epoch, requestId: input.requestId, planId: plan.planId, fingerprint: plan.fingerprint, decision: 'approve' })
      const ticket = result.admission.body.data.ticketId
      result.executionGate = await runtime.startAssignment(ticket)
      result.board = await post('board', {})
      result.conversation = await post('conversation', { epoch, limit: 100 })
      const key = `kanban-host-notice:${input.requestId}`
      runtime.engine.enqueue({ channel: 'session', threadKey: `session:${agent.id}`, ticketId: ticket, kind: 'notice', body: 'Synthetic result publication probe — not Worker execution.', idempotencyKey: key })
      result.drain = await runtime.engine.drainOutbox()
      await runtime.engine.drainOutbox()
      result.afterNotice = await post('conversation', { epoch, limit: 100 })
      result.flush = await ctx.sessions.flush(agent.session)
      const snapshot = await ctx.sessionQuery.readSession(agent.id)
      result.messageEvents = snapshot.events.filter(row => row.type === 'user/message' && row.data.id === `workspace:${input.requestId}`).length
      result.noticeInsertions = snapshot.events.filter(row => row.type === 'agent/inbox/spliced').flatMap(row => row.data.inserted).filter(row => row.id === key).length
      result.state = result.workspace.status === 200 && result.originDenied === 403 && result.input.body.data.accepted === true && result.conflict.status === 409 && result.admission.body.data.state === 'consumed' && result.executionGate.code === 'SA_EXECUTION_BOUNDARY_UNVERIFIED' && result.flush === true && result.messageEvents === 1 && result.noticeInsertions === 1 && result.afterNotice.body.data.items.some(row => row.text.includes('Synthetic result publication')) && result.externalProviderRequests === 0 ? 'passed' : 'failed'
    } catch (error) { result.state = 'failed'; result.error = { code: String(error?.code || error?.message || 'SA_HOST_FAILED') } }
    finally {
      await ctx.superagentRuntime.dispose(); adapter()
      result.liveAgents = ctx.agents.list().length
      result.finishedAt = new Date().toISOString()
      fs.writeFileSync(p.resolve(config.resultPath), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    }
  })()
  ctx.effect(() => async () => { await task })
}
