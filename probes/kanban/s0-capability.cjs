// Explicit isolated CLI fixture. No model requests, no user files or profile changes.
const fs = require('node:fs')
const p = require('node:path')
const { randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')
exports.inject = ['superagentRuntime', 'agentPresets', 'agents', 'subagents', 'sessions', 'sandboxPolicy', 'permissionPresets', 'fs', 'shell', 'sessionQuery']
exports.apply = function (ctx, config) {
  let requests = 0
  const handles = []
  ctx.on('llm/stream', () => { requests++; throw Object.assign(new Error('zero-token fixture'), { code: 'SA_ZERO_TOKEN' }) })
  const result = { kind: 'kanban-s0-installed-capability', startedAt: new Date().toISOString(), providerRequests: 0, cases: [] }
  const task = (async () => {
    try {
      await ctx.superagentRuntime.ready
      const presets = await ctx.agentPresets.list()
      result.presets = ['dsh-superagent-router', 'dsh-superagent-worker', 'dsh-superagent-watchdog'].map(id => ({ id, present: presets.some(row => row.id === id), broken: presets.find(row => row.id === id)?.broken ?? null }))
      const root = p.resolve(config.fixtureRoot)
      if (!root.startsWith(p.resolve(__dirname, '../../.probe') + '/kanban-s0-') || fs.existsSync(root)) throw new Error('fixture root invalid or stale')
      fs.mkdirSync(p.join(root, 'ticket-a/src'), { recursive: true })
      fs.mkdirSync(p.join(root, 'ticket-a/private'), { recursive: true })
      fs.mkdirSync(p.join(root, 'ticket-b'), { recursive: true })
      const ticket = p.join(root, 'ticket-a')
      const installed = createRequire(p.join(process.env.DSH_INSTALL_DIR, 'package.json'))
      const { setApprovalPolicy } = installed('@deepseek-ai/dsh-user-approval')
      const candidates = ctx.permissionPresets.catalog().options.filter(row => row.value !== 'custom' && row.value !== 'auto').map(row => ({ name: row.value, ...ctx.permissionPresets.resolve(row.value) }))
      const preset = candidates.find(row => row.sandbox === 'workspace-write')
      if (!preset) throw new Error('no constrained preset')
      result.permissionCatalog = candidates
      const agentHandle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: ticket, agentPreset: 'dsh-superagent-router' }, setup: async (scope, agent) => { await ctx.agentPresets.mount(scope, 'dsh-superagent-router'); ctx.permissionPresets.set(agent.session, preset.name); setApprovalPolicy(agent.session, 'never') } })
      handles.push(agentHandle)
      const agent = agentHandle.agent
      const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
      result.directAgentPolicy = { mode: policy.mode, rootMatchesTicket: policy.workspaceRoot === ticket, additionalWritableRoots: policy.additionalWritableRoots?.length ?? 0, fsSandboxMode: ctx.fs.sandboxMode, shellSandboxMode: ctx.shell.sandboxMode }
      if (policy.mode !== 'workspace-write' || policy.workspaceRoot !== ticket || policy.additionalWritableRoots?.length || !ctx.fs.sandboxMode || !ctx.shell.sandboxMode) throw new Error('fixture cannot establish constrained backend')
      const native = async (label, relative) => {
        const target = p.resolve(root, relative)
        let errorCode, returned = false
        try { const resolved = await ctx.fs.resolve(target); await ctx.fs.writeText(resolved, 'synthetic fixture\n', undefined, undefined, policy); returned = true } catch (error) { errorCode = String(error?.code || error?.name || 'ERROR') }
        result.cases.push({ label, layer: 'real-fs-provider', returned, exists: fs.existsSync(target), errorCode })
      }
      await native('allowed-native', 'ticket-a/src/allowed-native.txt')
      await native('cross-ticket-native', 'ticket-b/cross-native.txt')
      await native('L2-unlisted-native-counterexample', 'ticket-a/private/unlisted-native.txt')
      await native('L2-deny-native-counterexample', 'ticket-a/src/deny-native.txt')
      fs.symlinkSync(p.join(root, 'ticket-b'), p.join(ticket, 'escape'))
      await native('symlink-native', 'ticket-a/escape/symlink-native.txt')
      const shell = async (label, command, relative) => {
        const spec = ctx.shell.resolve({ command, workdir: ticket, timeoutMs: 10000, onExpiry: 'kill', sandboxPolicy: policy })
        const process = await ctx.shell.execute(spec)
        const raw = await process.result()
        result.cases.push({ label, layer: 'real-shell-provider', command, exitCode: raw.exitCode, stdout: raw.stdout.text, stderr: raw.stderr.text, sandbox: raw.sandbox, exists: fs.existsSync(p.resolve(root, relative)) })
      }
      await shell('allowed-shell', "printf 'fixture' > src/allowed-shell.txt", 'ticket-a/src/allowed-shell.txt')
      await shell('cross-ticket-shell', "printf 'fixture' > ../ticket-b/cross-shell.txt", 'ticket-b/cross-shell.txt')
      await shell('L2-unlisted-shell-counterexample', "printf 'fixture' > private/unlisted-shell.txt", 'ticket-a/private/unlisted-shell.txt')
      await shell('L2-deny-shell-counterexample', "printf 'fixture' > src/deny-shell.txt", 'ticket-a/src/deny-shell.txt')
      await shell('cross-ticket-heredoc', "sh <<'FIXTURE'\nprintf 'fixture' > ../ticket-b/heredoc.txt\nFIXTURE", 'ticket-b/heredoc.txt')
      await shell('cross-ticket-background', "(printf 'fixture' > ../ticket-b/background.txt) & wait", 'ticket-b/background.txt')
      const main = ctx.agents.get(ctx.superagentRuntime.diagnostics().mainSessionId)
      let spawnedPolicy
      const stop = ctx.on('agent/created', ({ agent: child }) => {
        if (child.id === agent.id || child.session.header.parentSession !== main.id) return
        spawnedPolicy = { headerMatchesParent: child.session.header.cwd === main.session.header.cwd, headerMatchesTicket: child.session.header.cwd === ticket, policyMatchesTicket: ctx.sandboxPolicy.resolve({ session: child.session }).workspaceRoot === ticket }
        child.ctx.on('agent/pre-step', () => ({ kind: 'reject' }))
      })
      const child = await ctx.subagents.startActivation({ provider: 'spawn', delivery: 'caller', label: 'kanban-zero-token-lifecycle', parent: main, cwd: ticket, childId: randomUUID(), signal: new AbortController().signal, agentPreset: 'dsh-superagent-router', agentOptions: { provider: 'fixture-route', model: 'fixture-model' }, prompt: [{ type: 'text', text: 'Zero-token lifecycle fixture; pre-step must reject.' }] })
      handles.push(child)
      await child.result
      stop()
      result.spawnedPolicy = spawnedPolicy
      result.L1 = 'direct agents.create boundary tested; production spawn cwd does not establish ticket root'
      result.L2 = 'unsupported: unlisted/deny paths writable inside ticket under directory policy'
      result.state = result.presets.every(row => row.present && !row.broken) && result.cases.find(row => row.label === 'allowed-native')?.exists && result.cases.find(row => row.label === 'allowed-shell')?.exists && !result.cases.find(row => row.label === 'cross-ticket-native')?.exists && !result.cases.find(row => row.label === 'cross-ticket-shell')?.exists && result.cases.find(row => row.label === 'L2-unlisted-native-counterexample')?.exists && result.cases.find(row => row.label === 'L2-unlisted-shell-counterexample')?.exists && spawnedPolicy?.headerMatchesParent && !spawnedPolicy?.policyMatchesTicket ? 'evidence-recorded' : 'failed'
    } catch (error) { result.state = 'failed'; result.error = { code: String(error?.code || error?.message || 'SA_S0_FAILED') } }
    finally {
      for (const handle of handles.reverse()) try { await handle.dispose() } catch { result.cleanupFailed = true }
      await ctx.superagentRuntime.dispose()
      result.liveAgents = ctx.agents.list().length; result.providerRequests = requests; result.finishedAt = new Date().toISOString()
      fs.writeFileSync(p.resolve(config.resultPath), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    }
  })()
  ctx.effect(() => async () => { await task })
}
