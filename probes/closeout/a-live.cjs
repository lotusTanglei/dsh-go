// Explicitly enabled only by the closeout command-line overlay. Never starts a model.
const { writeFileSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')
exports.inject = ['superagentRuntime', 'agentPresets', 'agents', 'clientModules', 'connection']
exports.apply = function (ctx, config) {
  let disposed = false
  let modelRequests = 0
  // Observe every streaming request in this isolated Host and fail before its adapter.
  ctx.on('llm/stream', function () { modelRequests++; throw Object.assign(new Error('zero-token gate refused model call'), { code: 'SA_ZERO_TOKEN_MODEL_REQUEST' }) })
  const task = (async () => {
    const result = { kind: 'closeout-a-live-zero-token', startedAt: new Date().toISOString(), modelsStarted: false, visual: 'pending-human' }
    try {
      await ctx.superagentRuntime.ready
      if (disposed) throw new Error('probe stopped')
      const presets = await ctx.agentPresets.list()
      result.presets = ['dsh-superagent-router', 'dsh-superagent-worker', 'dsh-superagent-watchdog'].map(id => { const value = presets.find(row => row.id === id); return { id, present: Boolean(value), broken: value?.broken || null } })
      const entry = ctx.clientModules.graph().entries.find(row => row.id === 'dsh-superagent')
      if (!entry) throw new Error('client entry missing')
      const response = await ctx.clientModules.fetchBundle(new Request(new URL(entry.url, 'http://localhost')))
      const script = await response.text()
      const local = readFileSync(resolve(__dirname, '../../lib/client.js'), 'utf8')
      const dictionaries = ['en', 'zh'].map(language => JSON.parse(readFileSync(resolve(__dirname, `../../locale/${language}.json`), 'utf8')).panel)
      const pages = ['overview', 'tickets', 'threads', 'sources', 'approvals', 'health', 'settings']
      result.resource = { status: response.status, bytes: Buffer.byteLength(script), sha256: createHash('sha256').update(script).digest('hex'), includesCurrentFactory: script.includes(local.trim()), markers: ['sidebar.panellist', 'main', 'superagent'].every(value => script.includes(value)), localizedPages: dictionaries.every(dict => pages.every(key => script.includes(JSON.stringify(key) + ':' + JSON.stringify(dict[key])))), slotRegistrations: [...script.matchAll(/\bctx\.slots\.register\s*\(/g)].length }
      // Use the real owner Peer, not an anonymous HTTP request or an invented authorization bypass.
      const handler = ctx.connection.createSharedFetchHandler('/api')
      result.routes = {}
      for (const path of ['threads', 'settings', 'health']) {
        const response = await handler.fetch(new Request(`http://localhost/api/superagent/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), ctx.connection.browserPeer)
        const data = await response.json()
        result.routes[path] = { status: response.status, response: data }
      }
      result.routeBoundary = 'Actual Connection handler with in-process owner Peer; no HTTP carrier authentication or browser rendering claimed.'
      const settings = result.routes.settings.response.data?.effective || []
      result.settingsOrigins = { explicit: settings.find(row => row.key === 'maxWorkers')?.origin, environment: settings.find(row => row.key === 'panelPollMs')?.origin, default: settings.find(row => row.key === 'queueLimit')?.origin, derived: settings.find(row => row.key === 'dbPath')?.origin }
      await ctx.superagentRuntime.dispose()
      result.liveAgents = ctx.agents.list().length
      result.state = result.presets.every(row => row.present && !row.broken) && result.resource.status === 200 && result.resource.includesCurrentFactory && result.resource.markers && result.resource.localizedPages && result.resource.slotRegistrations === 3 && Object.values(result.routes).every(row => row.status === 200 && row.response.ok) && result.routes.health.response.data?.runtime?.state === 'ready' && result.settingsOrigins.explicit === 'patch' && result.settingsOrigins.environment === 'environment' && result.settingsOrigins.default === 'default' && result.settingsOrigins.derived === 'derived' && result.liveAgents === 0 && modelRequests === 0 ? 'passed' : 'failed'
    } catch (error) {
      result.state = 'failed'
      result.error = { code: String(error?.code || 'SA_CLOSEOUT_A_FAILED') }
      try { await ctx.superagentRuntime.dispose(); result.liveAgents = ctx.agents.list().length } catch { result.cleanupFailed = true }
    } finally {
      result.modelRequests = modelRequests
      result.finishedAt = new Date().toISOString()
      writeFileSync(resolve(config.resultPath), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    }
  })()
  ctx.effect(() => async () => { disposed = true; await task })
}
