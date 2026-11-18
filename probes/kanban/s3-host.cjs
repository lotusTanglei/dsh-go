// Real installed Host, no network provider: owner reviews a home-relative exact scope,
// revises immutable goal/firstAction, then approves only the replacement fingerprint.
const fs = require('node:fs')
const p = require('node:path')
const { homedir } = require('node:os')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
exports.inject = ['superagentRuntime', 'agents', 'connection', 'sessionQuery', 'sessions', 'llm']
exports.apply = function (ctx, config) {
  const resultPath = p.resolve(config.resultPath)
  if (fs.existsSync(resultPath)) throw new Error('S3_RECEIPT_ALREADY_EXISTS')
  const installed = createRequire(p.join(process.env.DSH_INSTALL_DIR, 'package.json'))
  const { LlmAdapter } = installed('@deepseek-ai/dsh-llm')
  const result = { kind: 'kanban-s3-real-host-owner-plan-revision', startedAt: new Date().toISOString(), externalProviderRequests: 0, mainCalls: 0, titleCalls: 0, boundary: 'Real Agent/inbox/owner handler/flush; local synthetic adapter, synthetic planning-only repo not created or executed. In-process owner Peer, not browser cookie proof. Worker execution stays blocked.' }
  const brief = { goal: 'Synthetic revision task', scope: { repo: p.join(homedir(), 'kanban-host-planning-only'), subdirs: ['src'] }, base: { ref: 'fixture', requireCleanTree: false }, allowWrite: ['src/**'], denyWrite: ['src/deny/**'], runtime: 'isolated zero-token fixture', acceptance: [{ id: 'A1', kind: 'assertion', check: 'Synthetic scope is fully reviewable' }], outOfScope: ['real file execution'], blockers: [], firstAction: 'Report boundary', approvalsRequired: [] }
  class LocalFixtureAdapter extends LlmAdapter {
    async *stream(options) {
      const title = options.purpose === 'session-title'
      if (title) result.titleCalls++; else result.mainCalls++
      if (result.mainCalls > 2 || result.titleCalls > 1) throw new Error('S3_LOCAL_RUNAWAY')
      const tool = !title && result.mainCalls === 1
      const block = tool ? { type: 'tool-call', id: 'kanban-s3-create', name: 'ticket_create', arguments: JSON.stringify({ brief }) } : { type: 'text', text: title ? 'Synthetic revision fixture' : 'Review the exact scope and revise the plan before confirming.' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: tool ? 'tool-calls' : 'stop' } }
    }
  }
  const removeAdapter = ctx.llm.registerAdapter(['kanban-s3-local'], new LocalFixtureAdapter())
  const removeGuard = ctx.on('llm/stream', (options, next) => {
    if (options.provider !== 'kanban-s3-local') { result.externalProviderRequests++; throw new Error('S3_EXTERNAL_FORBIDDEN') }
    return next()
  })
  const check = (condition, code) => { if (!condition) throw new Error(code) }
  const task = (async () => {
    const runtime = ctx.superagentRuntime
    try {
      await runtime.ready
      const agent = ctx.agents.get(runtime.diagnostics().mainSessionId)
      agent.model.select({ provider: 'kanban-s3-local', model: 'deterministic' })
      const handler = ctx.connection.createSharedFetchHandler('/api')
      const post = async (route, body) => {
        const response = await handler.fetch(new Request(`http://localhost/api/superagent/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) }), ctx.connection.browserPeer)
        return { status: response.status, body: await response.json() }
      }
      const workspace = await post('workspace', {})
      const epoch = workspace.body.data.epoch
      const input = { epoch, requestId: randomUUID(), intent: 'new-task', text: 'Create one planning-only fixture; do not execute files.' }
      result.command = await post('command', input)
      await agent.whenIdle(); await ctx.sessions.flush(agent.session)
      const current = await post('workspace', {})
      const plan = current.body.data.admissions.find(row => row.requestId === input.requestId)
      check(plan?.reviewable === true && plan.scopeIdentity === 'host-owner-home-relative' && plan.brief.scope.repo === '~/kanban-host-planning-only', 'S3_SCOPE_NOT_REVIEWABLE')
      check(!JSON.stringify(current).includes(homedir()), 'S3_HOME_LEAK')
      result.review = { project: plan.brief.scope.repo, scopeIdentity: plan.scopeIdentity, reviewable: plan.reviewable, fingerprint: plan.fingerprint }
      const identity = { epoch, requestId: input.requestId, planId: plan.planId, fingerprint: plan.fingerprint }
      result.revision = await post('admission-revise', { ...identity, patch: { goal: 'Owner revised exact goal', firstAction: 'Inspect allowed source only' } })
      const revised = result.revision.body.data
      check(result.revision.status === 200 && revised.state === 'pending' && revised.planId !== plan.planId && revised.fingerprint !== plan.fingerprint, 'S3_REVISION_FAILED')
      result.stale = await post('admission', { ...identity, decision: 'approve' })
      check(result.stale.status === 409, 'S3_STALE_NOT_REJECTED')
      result.forbiddenScope = await post('admission-revise', { epoch, requestId: input.requestId, planId: revised.planId, fingerprint: revised.fingerprint, patch: { scope: { repo: '/tmp/other' } } })
      check(result.forbiddenScope.status === 400, 'S3_SCOPE_MUTATION_ALLOWED')
      result.admission = await post('admission', { epoch, requestId: input.requestId, planId: revised.planId, fingerprint: revised.fingerprint, decision: 'approve' })
      check(result.admission.body.data.state === 'consumed', 'S3_APPROVAL_FAILED')
      check(result.admission.body.data.reviewable === true && result.admission.body.data.brief.scope.repo === plan.brief.scope.repo, 'S3_APPROVAL_REVIEW_MISMATCH')
      result.executionGate = await runtime.startAssignment(result.admission.body.data.ticketId)
      check(result.executionGate.code === 'SA_EXECUTION_BOUNDARY_UNVERIFIED', 'S3_EXECUTION_NOT_BLOCKED')
      await runtime.tick()
      result.board = await post('board', {})
      result.status = await post('command-status', { epoch, requestId: input.requestId })
      const log = await ctx.sessionQuery.readSession(agent.id)
      result.userMessageEvents = log.events.filter(row => row.type === 'user/message' && row.data.id === `workspace:${input.requestId}`).length
      check(result.userMessageEvents === 1 && result.externalProviderRequests === 0 && result.mainCalls === 2, 'S3_COMMAND_BOUNDARY_FAILED')
      result.state = 'passed'
    } catch (error) { result.state = 'failed'; result.error = { code: String(error?.code || error?.message || 'S3_FAILED') } }
    finally {
      try { await runtime.dispose() } catch { result.state = 'failed'; result.cleanupError = true }
      removeAdapter(); removeGuard()
      result.liveAgents = ctx.agents.list().length
      if (result.liveAgents) result.state = 'failed'
      result.finishedAt = new Date().toISOString()
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    }
  })()
  ctx.effect(() => async () => { await task })
}
