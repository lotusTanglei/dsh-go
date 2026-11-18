// Frozen S4 fixture: real installed Host services, deterministic local text adapter.
// S1's historical probe and receipts are deliberately neither required nor rewritten.
const fs = require('node:fs')
const p = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { createHash, randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

exports.inject = ['superagentRuntime', 'agents', 'agentPresets', 'connection', 'sessionQuery', 'sessions', 'llm', 'clientModules']
exports.apply = function (ctx, config) {
  const resultPath = p.resolve(config.resultPath)
  // Never rerun into an old success OR failure receipt; the final write is also exclusive.
  if (fs.existsSync(resultPath)) throw new Error('S4_RECEIPT_ALREADY_EXISTS')
  const installed = createRequire(p.join(process.env.DSH_INSTALL_DIR, 'package.json'))
  const { LlmAdapter } = installed('@deepseek-ai/dsh-llm')
  const provider = 'kanban-s4-local-text'
  const reply = 'S4 local adapter: one conversational reply; no ticket or Worker execution.'
  const result = {
    kind: 'kanban-s4-real-host-single-workspace', startedAt: new Date().toISOString(), state: 'running',
    externalProviderRequests: 0, localAdapterCalls: 0, mainCalls: 0, titleCalls: 0, purposes: [], inputTokens: 0, outputTokens: 0,
    boundaries: {
      owner: 'connection.browserPeer is the installed in-process owner Peer; not a real browser cookie/authentication proof.',
      nonOwner: 'A real connection.createPeer with synthetic unknown principal tests only the exact-route principal fence, not HTTP credential admission.',
      client: 'Actual current lib/client.js and Host manifest/bundle are read. A VM registers its factory and three slots without rendering; no DOM, browser, screenshots, visual/layout/interaction proof.',
      execution: 'One message intent only. No ticket admission, assignment start, Worker, external provider, or alternative GUI/server.',
      cleanup: 'Runtime disposal and probe-owned SQLite read-only checks precede receipt. Host-store closure, file-lock release and runner process cleanup remain for lead after runner exit.',
    },
    installedSourceContracts: {
      presets: '@deepseek-ai/dsh-agent-preset-registry/src/index.ts:193 list(): Promise<AgentPreset[]>; broken omitted when usable',
      modules: '@deepseek-ai/dsh-client-modules/src/index.ts:719 graph(), :728 clientPath(id), :745 fetchBundle(Request)',
      manifest: '@deepseek-ai/dsh-client-modules/src/client/manifest.ts:52 WebBootEntry { id, url, rev, inject?, immediately?, external? }; :94 WebBootGraph { rev, entries, batches }',
      connection: '@deepseek-ai/dsh-client-connection/src/rpc.ts:247 createPeer({principal, interactions}); src/rpc-host.ts:215-222 exact route rejects non-owner principal with 403',
    },
  }
  const requireProof = (condition, code) => { if (!condition) throw new Error(code) }
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const recordError = (key, error) => { result[key] = { code: String(error?.code || error?.message || 'S4_FAILED') }; result.state = 'failed' }
  let adapter, nonOwner, removeStreamGuard
  const task = (async () => {
    try {
      class LocalTextAdapter extends LlmAdapter {
        async *stream(options) {
          result.localAdapterCalls++
          const title = options.purpose === 'session-title'
          result.purposes.push(title ? 'session-title' : options.purpose || 'main')
          if (title) result.titleCalls++; else result.mainCalls++
          requireProof(result.mainCalls <= 1 && result.titleCalls <= 1 && result.localAdapterCalls <= 2, 'S4_LOCAL_ADAPTER_RUNAWAY')
          // Same proven S1 LlmAdapter block/usage/finish protocol; no tool calls.
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: title ? 'Synthetic local workspace probe' : reply } }
          yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      adapter = ctx.llm.registerAdapter([provider], new LocalTextAdapter())
      removeStreamGuard = ctx.on('llm/stream', (options, next) => {
        if (options.provider !== provider) { result.externalProviderRequests++; throw new Error('S4_EXTERNAL_PROVIDER_FORBIDDEN') }
        return next()
      })
      const runtime = ctx.superagentRuntime
      await runtime.ready
      const agent = ctx.agents.get(runtime.diagnostics().mainSessionId)
      requireProof(agent, 'S4_ROUTER_MISSING')
      agent.model.select({ provider, model: 'deterministic' })

      const wanted = ['dsh-superagent-router', 'dsh-superagent-worker', 'dsh-superagent-watchdog']
      const roster = await ctx.agentPresets.list()
      result.presets = { rosterCount: roster.length, rows: roster.filter(row => wanted.includes(row.id)) }
      requireProof(result.presets.rows.length === 3 && wanted.every(id => result.presets.rows.filter(row => row.id === id).length === 1) && result.presets.rows.every(row => row.broken === undefined), 'S4_PRESET_BROKEN_OR_MISSING')

      const graph = ctx.clientModules.graph()
      const entries = graph.entries.filter(row => row.id === 'dsh-superagent')
      requireProof(entries.length === 1, 'S4_CLIENT_GRAPH_ENTRY_COUNT')
      const entry = entries[0]
      requireProof(typeof entry.url === 'string' && typeof entry.rev === 'string', 'S4_CLIENT_MANIFEST_INVALID')
      const clientPath = ctx.clientModules.clientPath(entry.id)
      const expectedPath = p.resolve(__dirname, '../../lib/client.js')
      requireProof(typeof clientPath === 'string' && fs.realpathSync(clientPath) === fs.realpathSync(expectedPath), 'S4_CLIENT_PATH_NOT_CURRENT_LIB')
      requireProof(fs.statSync(clientPath).size <= 2 * 1024 * 1024, 'S4_CLIENT_ARTIFACT_OVERSIZE')
      const bytes = fs.readFileSync(clientPath)
      const source = bytes.toString('utf8')
      const bundleUrl = new URL(entry.url, 'http://localhost/')
      requireProof(bundleUrl.origin === 'http://localhost' && bundleUrl.pathname.startsWith('/plugins/'), 'S4_CLIENT_BUNDLE_URL_INVALID')
      const response = await ctx.clientModules.fetchBundle(new Request(bundleUrl))
      const served = await response.text()
      result.client = { graphRev: graph.rev, entry, clientPath, expectedPath, bytes: bytes.length, sha256: digest(bytes), bundleUrl: bundleUrl.href, bundleStatus: response.status, bundleSha256: digest(served), servedContainsExactArtifact: served.includes(source.trim()), proof: 'factory-and-slot registration only; no React render or DOM' }
      requireProof(response.status === 200 && result.client.servedContainsExactArtifact, 'S4_SERVED_ARTIFACT_MISMATCH')
      const requiredSeams = ['function WorkspacePage', 'saw-workspace', 'command-status', 'timelineCursor', 'RetrySameRequest', 'BoundaryTitle']
      result.client.workspaceSeams = Object.fromEntries(requiredSeams.map(term => [term, source.includes(term)]))
      requireProof(Object.values(result.client.workspaceSeams).every(Boolean), 'S4_SINGLE_WORKSPACE_SEAM_MISSING')
      requireProof(!/function\s+SevenPages\b|function\s+Page\s*\(|createRoot\s*\(|ReactDOM|document\.body|dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b/.test(source), 'S4_OLD_OR_ROOT_OWNING_CLIENT')

      const modules = [], slots = [], owners = [], imports = [], effects = [], definitions = []
      const sandbox = vm.createContext({ window: { __ModuleLoader__: { load(row) { modules.push(row) } } } })
      new vm.Script(source, { filename: clientPath }).runInContext(sandbox, { timeout: 1000 })
      requireProof(modules.length === 1 && modules[0].id === entry.id, 'S4_FACTORY_ENTRY_INVALID')
      const plugin = modules[0].factory(id => {
        imports.push(id)
        requireProof(id === 'react', 'S4_UNEXPECTED_BROWSER_IMPORT')
        return { createElement() { throw new Error('S4_RENDERING_FORBIDDEN') } }
      })
      requireProof(JSON.stringify(Array.from(plugin.inject)) === JSON.stringify(['slots', 'locale', 'layout', 'uiConversation']), 'S4_CLIENT_INJECT_INVALID')
      try {
        plugin.apply({
          effect(factory) { effects.push(factory()) },
          locale: { register() { return () => {} }, bind() { return key => key } },
          uiConversation: { events: { register(row) { definitions.push(row.kind); return () => {} } } },
          layout: { selectPanel() { throw new Error('S4_NAVIGATION_FORBIDDEN') } },
          slots: {
            inject(owner, register) { owners.push(owner); register() },
            register(options, component) { slots.push({ ...options, componentName: component.name, isFunction: typeof component === 'function' }) },
          },
        })
      } finally { for (const dispose of effects.reverse()) if (typeof dispose === 'function') dispose() }
      result.client.registration = { entries: modules.length, imports, owners, slots, definitions, rendered: false, browser: false }
      requireProof(JSON.stringify(owners) === JSON.stringify(['conversation.chat.node', 'sidebar.panellist', 'main']) && slots.length === 3 && slots.every(row => row.isFunction) && slots[0].key === 'superagent-channel-notice' && slots[1].id === 'superagent' && slots[2].key === 'superagent' && slots[2].componentName === 'WorkspacePage', 'S4_THREE_SLOT_REGISTRATION_INVALID')
      requireProof(JSON.stringify(definitions) === JSON.stringify(['superagent-channel-notice']), 'S4_NOTICE_DEFINITION_INVALID')

      const handler = ctx.connection.createSharedFetchHandler('/api')
      const post = async (route, body, peer, origin) => {
        const response = await handler.fetch(new Request(`http://localhost/api/superagent/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }), peer)
        const text = await response.text()
        let value
        try { value = JSON.parse(text) } catch { value = { text } }
        return { status: response.status, body: value }
      }
      requireProof(ctx.connection.browserPeer?.principal?.kind === 'owner', 'S4_OWNER_PEER_MISSING')
      // This is a genuine Peer from the installed factory, not { principal: ... } masquerading as PeerScope.
      // Unknown is deliberately synthetic; this tests the route's non-owner discriminant only.
      nonOwner = ctx.connection.createPeer({ principal: { kind: 'unknown' }, interactions: 'none' })
      result.nonOwnerDenied = await post('workspace', {}, nonOwner)
      result.originDenied = await post('workspace', {}, ctx.connection.browserPeer, 'https://hostile.invalid')
      result.workspace = await post('workspace', {}, ctx.connection.browserPeer)
      requireProof(result.nonOwnerDenied.status === 403 && result.originDenied.status === 403, 'S4_ROUTE_FENCE_FAILED')
      requireProof(result.workspace.status === 200 && result.workspace.body.ok === true && result.workspace.body.data.model.available === true && result.workspace.body.data.capabilities.workerExecution === false, 'S4_WORKSPACE_NOT_READY_OR_WORKER_OPEN')
      const epoch = result.workspace.body.data.epoch
      const input = { epoch, requestId: randomUUID(), intent: 'message', text: 'S4 local conversation fixture. Reply once without tools or creating a task.' }
      result.command = await post('command', input, ctx.connection.browserPeer)
      await agent.whenIdle()
      result.flush = await ctx.sessions.flush(agent.session)
      await runtime.tick()
      result.status = await post('command-status', { epoch, requestId: input.requestId }, ctx.connection.browserPeer)
      result.conversation = await post('conversation', { epoch, limit: 100 }, ctx.connection.browserPeer)
      const snapshot = await ctx.sessionQuery.readSession(agent.id)
      result.userMessageEvents = snapshot.events.filter(row => row.type === 'user/message' && row.data?.id === `workspace:${input.requestId}`).length
      const items = result.conversation.body.data?.items || []
      result.conversationProof = { user: items.filter(row => row.id === `workspace:${input.requestId}` && row.text === input.text).length, assistant: items.filter(row => row.kind === 'assistant' && row.text === reply).length }
      requireProof(result.command.status === 200 && result.command.body.data.accepted === true && result.status.status === 200 && result.status.body.data.accepted === true && result.status.body.data.requestId === input.requestId && ['processing', 'published'].includes(result.status.body.data.stage), 'S4_COMMAND_RECEIPT_FAILED')
      requireProof(result.flush === true && result.userMessageEvents === 1 && result.conversation.status === 200 && result.conversationProof.user === 1 && result.conversationProof.assistant === 1, 'S4_DURABLE_CONVERSATION_FAILED')
      requireProof(result.mainCalls === 1 && result.localAdapterCalls === result.mainCalls + result.titleCalls && result.titleCalls <= 1 && result.externalProviderRequests === 0, 'S4_PROVIDER_BOUNDARY_FAILED')
      result.state = 'passed'
    } catch (error) { recordError('error', error) }
    finally {
      // Keep the external-provider guard until all runtime-owned Agents have stopped.
      try { await ctx.superagentRuntime.dispose() } catch (error) { recordError('disposeError', error) }
      try { if (nonOwner) await nonOwner.dispose() } catch (error) { recordError('peerDisposeError', error) }
      try { if (adapter) adapter() } catch (error) { recordError('adapterDisposeError', error) }
      try { if (typeof removeStreamGuard === 'function') removeStreamGuard() } catch (error) { recordError('guardDisposeError', error) }
      try {
        result.liveAgents = ctx.agents.list().length
        requireProof(result.liveAgents === 0, 'S4_LIVE_AGENTS_AFTER_DISPOSE')
        // Independent read-only SQLite connection; the Host's store/lock are still runner-owned.
        const db = new DatabaseSync(p.resolve(config.dbPath), { readOnly: true })
        try {
          const count = sql => Number(db.prepare(sql).get().n)
          result.sqlite = {
            dbPath: p.resolve(config.dbPath), readOnly: true,
            runningAssignments: count("SELECT COUNT(*) n FROM assignment WHERE state='running'"),
            pendingOrEvaluatingTriggers: count("SELECT COUNT(*) n FROM thread_trigger WHERE state IN ('pending','evaluating')"),
            runningEvals: count("SELECT COUNT(*) n FROM eval WHERE state='running'"),
            pendingOutbox: count("SELECT COUNT(*) n FROM outbound WHERE state='pending'"),
            outboxTotal: count('SELECT COUNT(*) n FROM outbound'),
            tickets: count('SELECT COUNT(*) n FROM ticket'),
            assignments: count('SELECT COUNT(*) n FROM assignment'),
          }
          requireProof(['runningAssignments', 'pendingOrEvaluatingTriggers', 'runningEvals', 'pendingOutbox', 'outboxTotal', 'tickets', 'assignments'].every(key => result.sqlite[key] === 0), 'S4_SQLITE_NOT_QUIESCENT')
        } finally { db.close() }
      } catch (error) { recordError('cleanupProofError', error) }
      result.finishedAt = new Date().toISOString()
      // Failure receipts are evidence too: wx forbids overwriting either outcome.
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    }
  })()
  ctx.effect(() => async () => { await task })
}
