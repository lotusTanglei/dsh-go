// Installed Host contract proof over probe-owned sessions only. No private log reads.
const fs = require('node:fs')
const p = require('node:path')
const { randomUUID } = require('node:crypto')
exports.inject = ['agents', 'agentPresets', 'sessionQuery', 'sessionProjections', 'sessions', 'remoteAccess', 'connection', 'subagents', 'llm', 'workspaceRegistry']
exports.apply = function(ctx, config) {
  const target = p.resolve(config.resultPath)
  if (fs.existsSync(target)) throw new Error('SESSION_WORK_RECEIPT_EXISTS')
  const { openStore } = require('../../lib/store/index.js')
  const { createRuntime } = require('../../lib/runtime.js')
  const { defaults, resolveConfig } = require('../../lib/config.js')
  const { installPanelRoutes } = require('../../lib/panel/routes.js')
  const result = { kind: 'session-work-installed-host', state: 'running', startedAt: new Date().toISOString(), privateSessionContentReads: 0, externalProviderRequests: 0,
    boundary: 'Actual installed Session list/inspect/selective projections, real SQLite and owner Peer. Directory filtered to probe-owned identities before any content inspection. Synthetic Session records, no browser DOM or real-user-work completeness claim.' }
  let runtime, panel, store, nonOwner, releaseGuard
  const task = (async () => {
    try {
      const root = p.resolve(config.stateDir)
      fs.mkdirSync(root, { recursive: true })
      const cfg = resolveConfig({ ...defaults, stateDir: root, dbPath: '', lockPath: '', workRoot: '', sources: [] })
      store = openStore({ dbPath: cfg.dbPath, lockPath: cfg.lockPath })
      const ordinaryId = randomUUID(), forkId = randomUUID(), childId = randomUUID()
      const fixtureIds = new Set([ordinaryId, forkId, childId])
      const ordinary = ctx.sessions.create(ordinaryId, { meta: { cwd: root } })
      const fork = ctx.sessions.create(forkId, { meta: { cwd: root, parentSession: ordinaryId } })
      ctx.sessions.create(childId, { meta: { cwd: root, parentSession: ordinaryId, origin: 'subagent' } })
      ordinary.append('session/title', { title: 'Synthetic ordinary work', messageSeqs: [], source: { kind: 'user' } })
      ordinary.append('todo/write', { todos: [{ content: 'Verify cross-session scope', status: 'in_progress' }] })
      fork.append('session/title', { title: 'Synthetic ordinary fork', messageSeqs: [], source: { kind: 'user' } })
      const reads = []
      releaseGuard = ctx.on('llm/stream', () => { result.externalProviderRequests++; throw new Error('SESSION_WORK_PROVIDER_FORBIDDEN') })
      const port = {
        agents: ctx.agents, agentPresets: ctx.agentPresets, subagents: ctx.subagents, sessions: ctx.sessions, llm: ctx.llm,
        workspaceRegistry: ctx.workspaceRegistry,
        agentDefaultModel: ctx.get('agentDefaultModel'), remoteAccess: ctx.remoteAccess, sessionProjections: ctx.sessionProjections,
        effect: factory => ctx.effect(factory), on: (name, listener) => ctx.on(name, listener),
        sessionQuery: {
          readSession: id => { if (!fixtureIds.has(id) && id !== runtime?.diagnostics().mainSessionId) { result.privateSessionContentReads++; throw new Error('SESSION_WORK_FOREIGN_READ') } return ctx.sessionQuery.readSession(id) },
          listSessions: async signal => (await ctx.sessionQuery.listSessions(signal)).filter(record => fixtureIds.has(record.header.id) || record.header.id === runtime?.diagnostics().mainSessionId),
          inspectSession: (id, read, signal) => { if (!fixtureIds.has(id)) { result.privateSessionContentReads++; throw new Error('SESSION_WORK_FOREIGN_INSPECTION') } reads.push(id); return ctx.sessionQuery.inspectSession(id, read, signal) },
        },
      }
      runtime = createRuntime(port, store, cfg)
      await runtime.ready
      panel = installPanelRoutes({ connection: ctx.connection }, store, cfg, runtime.panelPorts)
      const handler = ctx.connection.createSharedFetchHandler('/api')
      const post = async (route, body, peer = ctx.connection.browserPeer, origin = 'http://localhost') => {
        const response = await handler.fetch(new Request(`http://localhost/api/superagent/${route}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), peer)
        const text = await response.text()
        let parsed; try { parsed = JSON.parse(text) } catch { parsed = { code: text === 'forbidden' ? 'forbidden' : 'non-json-response' } }
        return { status: response.status, body: parsed }
      }
      nonOwner = ctx.connection.createPeer({ principal: { kind: 'session-work-untrusted' }, interactions: { respondable: false } })
      const agentCount = ctx.agents.list().length
      result.initial = await post('workspace', {})
      const data = result.initial.body.data, epoch = data.epoch, page = data.sessionWork
      if (result.initial.status !== 200 || page.state !== 'ready' || page.total !== 2 || !page.items.some(item => item.sessionId === ordinaryId && item.progress === 'Verify cross-session scope') || !page.items.some(item => item.sessionId === forkId) || reads.includes(childId)) throw new Error('SESSION_WORK_DEFAULT_SCOPE_FAILED')
       if (page.items.some(item => item.project?.kind !== 'unassigned' || item.project.key !== 'unassigned')) throw new Error('SESSION_WORK_PROJECT_MEMBERSHIP_FAILED')
      result.denied = await post('session-work', { action: 'list', epoch }, nonOwner)
      result.origin = await post('session-work', { action: 'list', epoch }, ctx.connection.browserPeer, 'https://hostile.invalid')
      result.stale = await post('session-work', { action: 'list', epoch: 'wrong-epoch' })
      result.arbitrary = await post('session-work', { action: 'list', epoch, activate: true })
      result.exclude = await post('session-work', { action: 'set-included', epoch, sessionId: ordinaryId, included: false, revision: page.revision })
      const before = reads.filter(id => id === ordinaryId).length
      result.after = await post('workspace', {})
      result.excluded = await post('session-work', { action: 'list', epoch, view: 'excluded' })
      if (result.exclude.status !== 200 || result.after.body.data.sessionWork.total !== 1 || reads.filter(id => id === ordinaryId).length !== before || result.excluded.body.data.items[0]?.sessionId !== ordinaryId) throw new Error('SESSION_WORK_EXCLUSION_FAILED')
      result.restore = await post('session-work', { action: 'set-included', epoch, sessionId: ordinaryId, included: true, revision: result.excluded.body.data.revision })
      result.restored = await post('workspace', {})
      if (result.restore.status !== 200 || result.restored.body.data.sessionWork.total !== 2) throw new Error('SESSION_WORK_RESTORE_FAILED')
      if (result.denied.status !== 403 || result.origin.status !== 403 || result.stale.status !== 409 || result.arbitrary.status !== 400) throw new Error('SESSION_WORK_ACCESS_FAILED')
      result.proof = { authoritativeRegistryRead: true, unassignedNotGuessedFromCwd: true, ordinaryIncluded: true, ordinaryForkIncluded: true, childNotInspected: !reads.includes(childId), exclusionStopsRead: true, restoreMembershipOnly: true, agentCountBefore: agentCount, agentCountAfter: ctx.agents.list().length, tickets: store.repos.ticket.all().length, triggers: store.repos.trigger.all().length, assignments: store.repos.assignment.all().length }
      if (result.proof.agentCountAfter !== agentCount || result.proof.tickets || result.proof.triggers || result.proof.assignments || result.privateSessionContentReads || result.externalProviderRequests) throw new Error('SESSION_WORK_SIDE_EFFECT_FAILED')
      result.state = 'passed'
    } catch(error) { result.state = 'failed'; result.error = { code: String(error?.code || error?.message || 'SESSION_WORK_FAILED') } }
    finally {
      await panel?.dispose(); await runtime?.dispose(); store?.close(); releaseGuard?.(); nonOwner?.dispose()
      result.finishedAt = new Date().toISOString()
      fs.writeFileSync(target, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
    }
  })()
  ctx.effect(() => () => task)
}
