// Explicit-start probe only. Uses the product sampler; never mounts a Worker or changes DB state.
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
exports.inject = ['subagents', 'agents', 'superagentRuntime', 'connection', 'sessionQuery']
exports.apply = function apply(ctx, config = {}) {
  const output = resolve(config.resultPath || resolve(__dirname, 'p4-live-result.json'))
  const timeoutMs = Math.min(55000, Math.max(1000, Number(config.timeoutMs) || 45000))
  const controller = new AbortController()
  const handles = new Map()
  let running, disposed = false
  const result = { kind: 'product-p4-sample-deviation', state: 'idle', modelsStarted: false, scope: 'Product sampleDeviation only; no full watchdog tick or Worker steer is claimed.' }
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }) }
  const liveIds = () => ctx.agents.list().map(agent => agent.id)
  const originAllowed = request => { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin }
  const safeReason = value => String(value || '').replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]').replace(/\/Users\/[^\s"'<>]+/g, '[PRIVATE_PATH]').replace(/(?:sk|ghp|github_pat)[_-][A-Za-z0-9_-]+/g, '[SECRET]').slice(0, 500)
  const captureSession = async id => {
    const snapshot = await ctx.sessionQuery.readSession(id)
    const events = snapshot.events || []
    const usageRows = events.filter(event => event.type === 'assistant/message' && event.data.usage).map(event => event.data.usage)
    const usage = usageRows.length ? usageRows.reduce((sum, row) => {
      for (const key of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) sum[key] = (sum[key] || 0) + (Number(row[key]) || 0)
      return sum
    }, {}) : null
    const calls = events.filter(event => event.type === 'tool/call').map(event => ({ name: event.data.name, callId: event.data.callId }))
    const toolResults = events.filter(event => event.type === 'tool/result').map(event => ({ callId: event.data.message.toolCallId, isError: event.data.message.isError === true }))
    return { sessionId: id, turns: events.filter(event => event.type === 'turn/start').length, steps: events.filter(event => event.type === 'step/start').length, usage, toolCalls: calls, toolResults, readonlyCalls: calls.every(call => ['read', 'structured_output'].includes(call.name)), onlyStructuredOutput: calls.length === 1 && calls[0].name === 'structured_output', structuredOutputSucceeded: calls.some(call => call.name === 'structured_output' && toolResults.some(item => item.callId === call.callId && !item.isError)) }
  }
  const task = async () => {
    let hardTimer
    result.state = 'running'; result.startedAt = Date.now(); save()
    const hardDeadline = new Promise((_, reject) => { hardTimer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('probe deadline'), { code: 'PROBE_DEADLINE' })) }, timeoutMs + 5000) })
    try {
      await Promise.race([ctx.superagentRuntime.ready, hardDeadline])
      if (disposed) throw Object.assign(new Error('probe disposed'), { code: 'PROBE_DISPOSED' })
      const diagnostic = ctx.superagentRuntime.diagnostics()
      const main = ctx.agents.get(diagnostic.mainSessionId)
      if (!main) throw Object.assign(new Error('Router unavailable'), { code: 'NO_ROUTER' })
      main.model.select({ provider: 'deepseek-official', model: 'deepseek-flash' })
      result.mainSessionId = main.id
      result.liveIdsBefore = liveIds()
      result.timeoutMs = timeoutMs
      const { sampleDeviation } = await import('../lib/sessions/watchdog.js')
      const adapter = {
        async startActivation(input) {
          // Observe, do not replace, the production request or its output budget/schema.
          result.request = { provider: input.provider, agentPreset: input.agentPreset, maxTokens: input.agentOptions?.maxTokens, delivery: input.delivery }
          result.modelsStarted = true; save()
          const activation = await ctx.subagents.startActivation(input)
          const record = { childId: activation.childId, disposeRequested: false, disposed: false }
          result.activation = record
          let release
          const dispose = () => release ||= (async () => { record.disposeRequested = true; await activation.dispose(); record.disposed = true })()
          handles.set(activation.childId, dispose)
          if (controller.signal.aborted) { await dispose(); throw Object.assign(new Error('probe cancelled'), { code: 'PROBE_CANCELLED' }) }
          return { ...activation, result: activation.result.then(value => { result.modelResult = { stopReason: value.stopReason, structured: { deviated: value.structured?.deviated === true, reason: safeReason(value.structured?.reason) } }; return value }), dispose }
        },
      }
      const correction = await Promise.race([sampleDeviation({ goal: 'Repair the SQLite outbox idempotency transaction so duplicate delivery never causes a second payment. Relevant work concerns database transaction boundaries and the idempotency ledger only.', summary: { done: ['Wrote a long tropical aquarium decoration guide describing coral colors, seaweed arrangements and fish tank wallpaper. No SQLite, payment, idempotency, code or outbox work was attempted.'], todo: ['Continue choosing decorative aquarium wallpapers.'], acceptance: [{ id: 'outbox-dedup', result: 'failed', evidence: 'No related implementation or test was performed.' }] }, cwd: resolve(config.cwd || resolve(__dirname, '..')), parent: main, signal: controller.signal, timeoutMs }, adapter), hardDeadline])
      result.correction = safeReason(correction)
      result.deviationDetected = Boolean(correction && correction.trim())
    } catch (error) {
      result.error = { name: String(error?.name || 'Error'), code: String(error?.code || 'P4_SAMPLE_FAILED') }
    } finally {
      clearTimeout(hardTimer); controller.abort()
      const cleanup = await Promise.allSettled([...handles.values()].map(dispose => dispose()))
      result.activationCleanupSucceeded = cleanup.every(item => item.status === 'fulfilled')
      if (result.activation?.childId) {
        try { result.session = await captureSession(result.activation.childId) }
        catch { result.evidenceError = { code: 'COLD_READ_FAILED' } }
      }
      result.liveIdsAfter = liveIds()
      result.childReleased = Boolean(result.activation?.childId) && !result.liveIdsAfter.includes(result.activation.childId)
      result.newLiveIds = result.liveIdsAfter.filter(id => !(result.liveIdsBefore || []).includes(id))
      result.finishedAt = Date.now()
      result.state = !result.error && result.deviationDetected && result.modelResult?.stopReason === 'completed' && result.modelResult.structured.deviated && result.request?.agentPreset === 'dsh-superagent-watchdog' && result.request.maxTokens === 512 && result.session?.usage && result.session.onlyStructuredOutput && result.session.structuredOutputSucceeded && result.activation?.disposed && result.activationCleanupSucceeded && result.childReleased && result.newLiveIds.length === 0 ? 'passed' : 'failed'
      save()
    }
  }
  save()
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/superagent-dev/channel-check', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    if (!originAllowed(request)) return json({ ok: false, code: 'ORIGIN_DENIED' }, 403)
    await ctx.superagentRuntime.ready
    const main = ctx.agents.get(ctx.superagentRuntime.diagnostics().mainSessionId)
    const snapshot = () => ctx.sessionQuery.readSession(main.id)
    const before = await snapshot()
    const id = 'verify-channel-notice-20261118'
    const input = { threadKey: `session:${main.id}`, body: 'Channel acceptance: durable notification without a model wake.' }
    await ctx.superagentRuntime.invoke('channel_reply', input, { agent: main, callId: id })
    await ctx.superagentRuntime.invoke('channel_reply', input, { agent: main, callId: id })
    const after = await snapshot()
    const splices = after.events.filter(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === id))
    const turns = events => events.filter(event => event.type === 'turn/start').length
    const { createChannelDefinitions } = await import('../lib/client/channel.js')
    const definition = createChannelDefinitions()[0]
    const event = splices[0]
    const state = event ? definition.start({}, { event }) : undefined
    const node = state ? definition.buildViewNode({ key: `superagent-channel-notice:${id}`, id, state, start: { location: { kind: 'session' } } }) : undefined
    const receipt = { kind: 'product-channel-notice', mainSessionId: main.id, id, modelsStarted: false, matchingSplices: splices.length, addedTurns: turns(after.events) - turns(before.events), admitted: after.events.some(event => event.type === 'user/message' && event.data.id === id), projection: node, realEvents: splices, visual: 'pending-human' }
    receipt.state = splices.length === 1 && receipt.addedTurns === 0 && node?.visibility === 'visible' && node.data.messages[0].text === input.body ? 'passed' : 'failed'
    writeFileSync(resolve(__dirname, 'final-channel-result.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
    return json(receipt)
  } }))
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/superagent-dev/p4-cleanup', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    if (!originAllowed(request)) return json({ ok: false, code: 'ORIGIN_DENIED' }, 403)
    await ctx.superagentRuntime.dispose()
    const receipt = { kind: 'production-runtime-cleanup', liveAgents: liveIds().length, liveSessionIds: liveIds(), at: Date.now() }
    writeFileSync(resolve(__dirname, 'final-cleanup-result.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
    return json(receipt)
  } }))
  // DSH connection's exact custom route carrier is owner-only. Origin is an additional check.
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/superagent-dev/p4-status', methods: ['POST'], requestBody: 'buffered', fetch: async request => originAllowed(request) ? json(result) : json({ ok: false, code: 'ORIGIN_DENIED' }, 403) }))
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/superagent-dev/p4-start', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    if (!originAllowed(request)) return json({ ok: false, code: 'ORIGIN_DENIED' }, 403)
    let body
    try { body = await request.json() } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return json({ ok: false, code: 'INVALID_INPUT' }, 400)
    if (disposed) return json({ ok: false, code: 'PROBE_DISPOSED' }, 409)
    if (running) return json({ ok: false, code: 'ALREADY_STARTED' }, 409)
    running = task()
    return json({ ok: true, state: 'started' })
  } }))
  ctx.effect(() => async () => { disposed = true; controller.abort(); await Promise.allSettled([...handles.values()].map(dispose => dispose())); if (running) await running })
}
