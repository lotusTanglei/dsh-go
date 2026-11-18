// Opt-in synthetic Host fixture only. Lead executes; never invoke the production Worker.
// No model run, provider stub, install, permission-root edit, or additionalWritableRoots.
const fs = require('node:fs')
const p = require('node:path')
const { randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')

const REPO = p.resolve(__dirname, '../..')
const ID = '20261118-213300'
const FIXTURE_ROOT = p.join(REPO, '.probe', `kanban-s0-indirect-${ID}`)
const RESULT_PATH = p.join(REPO, 'probes/kanban', `s0-indirect-${ID}-result.json`)
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'"
const errorInfo = error => ({ code: String(error?.code || error?.name || 'ERROR'), message: String(error?.message || error).slice(0, 4000) })

exports.inject = ['superagentRuntime', 'agentPresets', 'agents', 'sandboxPolicy', 'permissionPresets', 'fs', 'shell']
exports.apply = function (ctx, config) {
  // Exact identity, not a prefix check: never create a fixture or receipt elsewhere.
  if (!p.isAbsolute(config.fixtureRoot || '') || config.fixtureRoot !== FIXTURE_ROOT || p.resolve(config.fixtureRoot) !== FIXTURE_ROOT) throw new Error('indirect fixtureRoot exact check failed')
  if (!p.isAbsolute(config.resultPath || '') || config.resultPath !== RESULT_PATH || p.resolve(config.resultPath) !== RESULT_PATH) throw new Error('indirect resultPath exact check failed')
  if (fs.realpathSync(REPO) !== REPO || fs.realpathSync(__dirname) !== __dirname) throw new Error('fixture repository must not be symlinked')
  const probeBase = p.join(REPO, '.probe')
  const baseStat = fs.lstatSync(probeBase)
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink() || fs.realpathSync(probeBase) !== probeBase) throw new Error('fixture parent must be an existing exact real directory')
  if (fs.existsSync(FIXTURE_ROOT) || fs.existsSync(RESULT_PATH)) throw new Error('indirect fixture or receipt is stale; retained evidence is never overwritten')

  const handles = []
  let requests = 0
  let unexpectedSteps = 0
  let rootCreated = false
  let ticket = null
  const stopProvider = ctx.on('llm/stream', () => {
    requests++
    throw Object.assign(new Error('indirect fixture forbids provider requests'), { code: 'SA_ZERO_TOKEN' })
  })
  const result = {
    kind: 'kanban-s0-installed-indirect-capability',
    identity: ID,
    state: 'recording',
    startedAt: new Date().toISOString(),
    fixtureRoot: FIXTURE_ROOT,
    providerRequests: 0,
    cases: [],
    setupFiles: [],
    retained: true,
    scope: 'Direct agents.create synthetic fixture only; no production Worker, spawn-root repair, or file allow/deny enforcement is claimed.',
    previousEvidence: 's0-20261118-202300-result.json; three non-broken presets and production spawn header behavior are not re-tested.',
  }
  const task = (async () => {
    try {
      await ctx.superagentRuntime.ready
      const node = process.env.DSH_NODE_EXECUTABLE
      if (!node || !p.isAbsolute(node) || !fs.statSync(node).isFile()) throw new Error('absolute existing DSH_NODE_EXECUTABLE required; no PATH fallback')
      fs.accessSync(node, fs.constants.X_OK)
      if (!process.env.DSH_INSTALL_DIR || !p.isAbsolute(process.env.DSH_INSTALL_DIR)) throw new Error('absolute DSH_INSTALL_DIR required')
      result.executables = { node, nodeEnvironment: { ELECTRON_RUN_AS_NODE: '1' }, python: { path: '/usr/bin/python3', status: 'unavailable' } }
      let python = null
      try {
        if (fs.statSync('/usr/bin/python3').isFile()) {
          fs.accessSync('/usr/bin/python3', fs.constants.X_OK)
          python = '/usr/bin/python3'
          result.executables.python.status = 'available'
        }
      } catch (error) { result.executables.python.reason = errorInfo(error) }

      // mkdir with no recursive final component atomically rejects an already-created root.
      fs.mkdirSync(FIXTURE_ROOT, { mode: 0o700 })
      rootCreated = true
      if (fs.realpathSync(FIXTURE_ROOT) !== FIXTURE_ROOT) throw new Error('created root exact realpath check failed')
      ticket = p.join(FIXTURE_ROOT, 'ticket-a')
      for (const relative of ['ticket-a', 'ticket-a/src', 'ticket-a/private', 'ticket-a/scripts', 'ticket-b']) fs.mkdirSync(p.join(FIXTURE_ROOT, relative), { mode: 0o700 })
      const installed = createRequire(p.join(process.env.DSH_INSTALL_DIR, 'package.json'))
      const { setApprovalPolicy } = installed('@deepseek-ai/dsh-user-approval')
      const candidates = ctx.permissionPresets.catalog().options.filter(row => row.value !== 'custom' && row.value !== 'auto').map(row => ({ name: row.value, ...ctx.permissionPresets.resolve(row.value) }))
      const preset = candidates.find(row => row.sandbox === 'workspace-write')
      if (!preset) throw new Error('no constrained preset')
      const agentHandle = await ctx.agents.create({
        sessionId: randomUUID(),
        meta: { cwd: ticket, agentPreset: 'dsh-superagent-router' },
        setup: async (scope, agent) => {
          // A second fail-closed guard; no child turn or activation is ever started.
          scope.on('agent/pre-step', () => { unexpectedSteps++; return { kind: 'reject' } })
          await ctx.agentPresets.mount(scope, 'dsh-superagent-router')
          ctx.permissionPresets.set(agent.session, preset.name)
          setApprovalPolicy(agent.session, 'never')
        },
      })
      handles.push(agentHandle)
      const agent = agentHandle.agent
      const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
      result.directAgentPolicy = { preset: preset.name, approval: 'never', headerMatchesTicket: agent.session.header.cwd === ticket, mode: policy.mode, rootMatchesTicket: policy.workspaceRoot === ticket, additionalWritableRoots: policy.additionalWritableRoots?.length ?? 0, fsSandboxMode: ctx.fs.sandboxMode, shellSandboxMode: ctx.shell.sandboxMode }
      if (policy.mode !== 'workspace-write' || policy.workspaceRoot !== ticket || agent.session.header.cwd !== ticket || policy.additionalWritableRoots?.length || !ctx.fs.sandboxMode || !ctx.shell.sandboxMode) throw new Error('fixture cannot establish constrained real-provider backend')

      const ownedPath = relative => {
        const target = p.resolve(FIXTURE_ROOT, relative)
        if (!relative || target === FIXTURE_ROOT || !target.startsWith(FIXTURE_ROOT + p.sep)) throw new Error('target outside exact synthetic root')
        return target
      }
      const targetFor = (layer, kind) => ownedPath(kind === 'crossTicket' ? `ticket-b/${layer}-crossTicket.txt` : kind === 'unlisted' ? `ticket-a/private/${layer}-unlisted.txt` : `ticket-a/src/${layer}-${kind}.txt`)
      const layers = ['native', 'realNode', 'heredoc', 'indirectScript', 'background', 'python']
      const kinds = ['allowed', 'crossTicket', 'unlisted', 'deny']
      const targets = Object.fromEntries(layers.map(layer => [layer, Object.fromEntries(kinds.map(kind => [kind, targetFor(layer, kind)]))]))
      // These are a declared synthetic Ticket contract, NOT installed sandbox capabilities.
      result.syntheticTicket = { root: ticket, allowedFiles: layers.map(layer => targets[layer].allowed), denyPaths: layers.map(layer => targets[layer].deny), unlistedPaths: layers.map(layer => targets[layer].unlisted), crossTicketRoot: p.join(FIXTURE_ROOT, 'ticket-b'), contractEnforcedByHost: false }
      const observe = target => ({ exists: fs.existsSync(target), contentsMatch: fs.existsSync(target) && fs.readFileSync(target, 'utf8') === 'synthetic fixture\n' })
      const writeFixture = async (relative, text) => {
        const target = ownedPath(relative)
        if (!target.startsWith(ticket + p.sep) || fs.existsSync(target)) throw new Error('setup target is not a fresh owned Ticket file')
        const resolved = await ctx.fs.resolve(target)
        await ctx.fs.writeText(resolved, text, undefined, undefined, policy)
        if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error('real Host fs fixture setup did not persist exact script')
        result.setupFiles.push({ path: target, layer: 'real-fs-provider', exists: true, exactContents: true })
        return target
      }
      const scripts = { node: {}, indirect: {}, python: {} }
      for (const kind of kinds) {
        const js = target => `// Synthetic exact self-owned target only.\nrequire('node:fs').writeFileSync(${JSON.stringify(target)}, 'synthetic fixture\\n', { flag: 'wx' });\n`
        scripts.node[kind] = await writeFixture(`ticket-a/scripts/node-${kind}.cjs`, js(targets.realNode[kind]))
        const writer = await writeFixture(`ticket-a/scripts/indirect-${kind}.cjs`, js(targets.indirectScript[kind]))
        scripts.indirect[kind] = await writeFixture(`ticket-a/scripts/indirect-${kind}.sh`, `#!/bin/sh\n# Invoke a second on-disk script; all writes remain in the exact synthetic root.\nELECTRON_RUN_AS_NODE=1 ${quote(node)} ${quote(writer)}\n`)
        scripts.python[kind] = await writeFixture(`ticket-a/scripts/python-${kind}.py`, `# Synthetic exact self-owned target only.\nwith open(${JSON.stringify(targets.python[kind])}, 'x', encoding='utf-8') as output:\n    output.write('synthetic fixture\\n')\n`)
      }
      await writeFixture('ticket-a/scripts/ticket-contract.json', JSON.stringify(result.syntheticTicket, null, 2) + '\n')

      const native = async kind => {
        const target = targets.native[kind]
        const row = { label: `native-${kind}`, layer: 'native', kind, provider: 'real-fs-provider', target, expectedDirectoryAccess: kind !== 'crossTicket', expectedTicketContractAccess: kind === 'allowed', attempted: true }
        try { const resolved = await ctx.fs.resolve(target); await ctx.fs.writeText(resolved, 'synthetic fixture\n', undefined, undefined, policy); row.returned = true } catch (error) { row.returned = false; row.error = errorInfo(error) }
        Object.assign(row, observe(target))
        result.cases.push(row)
      }
      const shell = async (layer, kind, command) => {
        const target = targets[layer][kind]
        const row = { label: `${layer}-${kind}`, layer, kind, provider: 'real-shell-provider', target, command, expectedDirectoryAccess: kind !== 'crossTicket', expectedTicketContractAccess: kind === 'allowed', attempted: true }
        try {
          // Exact provider API copied from s0-capability.cjs, including real policy.
          const spec = ctx.shell.resolve({ command, workdir: ticket, timeoutMs: 10000, onExpiry: 'kill', sandboxPolicy: policy })
          const process = await ctx.shell.execute(spec)
          const raw = await process.result()
          row.returned = true
          row.exitCode = raw.exitCode
          row.stdout = raw.stdout.text
          row.stderr = raw.stderr.text
          row.sandbox = raw.sandbox
        } catch (error) { row.returned = false; row.error = errorInfo(error) }
        Object.assign(row, observe(target))
        result.cases.push(row)
      }
      for (const kind of kinds) await native(kind)
      for (const kind of kinds) await shell('realNode', kind, `ELECTRON_RUN_AS_NODE=1 ${quote(node)} ${quote(scripts.node[kind])}`)
      for (const kind of kinds) await shell('heredoc', kind, `/bin/sh <<'KANBAN_SYNTHETIC_FIXTURE'\nprintf 'synthetic fixture\\n' > ${quote(targets.heredoc[kind])}\nKANBAN_SYNTHETIC_FIXTURE`)
      for (const kind of kinds) await shell('indirectScript', kind, `/bin/sh ${quote(scripts.indirect[kind])}`)
      for (const kind of kinds) await shell('background', kind, `(printf 'synthetic fixture\\n' > ${quote(targets.background[kind])}) & fixture_pid=$!; wait "$fixture_pid"`)
      if (python) {
        // Do not fall back to PATH, install Python, or invoke developer-tool setup.
        const check = { command: `${quote(python)} --version`, available: false }
        try {
          const spec = ctx.shell.resolve({ command: check.command, workdir: ticket, timeoutMs: 10000, onExpiry: 'kill', sandboxPolicy: policy })
          const process = await ctx.shell.execute(spec)
          const raw = await process.result()
          Object.assign(check, { exitCode: raw.exitCode, stdout: raw.stdout.text, stderr: raw.stderr.text, sandbox: raw.sandbox })
          check.available = raw.exitCode === 0 && /Python\s+\d+\./.test(raw.stdout.text + raw.stderr.text)
        } catch (error) { check.error = errorInfo(error) }
        result.executables.python.check = check
        if (!check.available) { python = null; result.executables.python.status = 'unavailable' }
      }
      for (const kind of kinds) {
        if (python) await shell('python', kind, `${quote(python)} ${quote(scripts.python[kind])}`)
        else result.cases.push({ label: `python-${kind}`, layer: 'python', kind, provider: 'real-shell-provider', target: targets.python[kind], attempted: false, status: 'unavailable', reason: 'Existing executable /usr/bin/python3 absent or not runnable; no installation or PATH fallback.', ...observe(targets.python[kind]) })
      }

      // Refresh every exists result after every child process has completed.
      for (const row of result.cases) Object.assign(row, observe(row.target))
      const attempted = result.cases.filter(row => row.attempted)
      const shells = attempted.filter(row => row.provider === 'real-shell-provider')
      result.assessment = {
        allCasesRecorded: result.cases.length === layers.length * kinds.length,
        allowedWritesObserved: attempted.filter(row => row.kind === 'allowed').every(row => row.exists && row.contentsMatch),
        crossTicketWritesAbsent: attempted.filter(row => row.kind === 'crossTicket').every(row => !row.exists),
        insideTicketCounterexamples: attempted.filter(row => ['unlisted', 'deny'].includes(row.kind) && row.exists).map(row => row.label),
        insideTicketCounterexamplesComplete: attempted.filter(row => ['unlisted', 'deny'].includes(row.kind)).every(row => row.exists && row.contentsMatch),
        shellResultsHaveFullSandbox: shells.every(row => row.returned && row.sandbox?.mode === 'workspace-write' && row.sandbox?.enforcement === 'full'),
        pythonAvailable: !!python,
      }
      result.L1 = result.assessment.crossTicketWritesAbsent && result.assessment.allowedWritesObserved && result.assessment.shellResultsHaveFullSandbox ? 'Direct-agent synthetic directory boundary observed for recorded available executors only; not a production Worker/spawn guarantee.' : 'Directory-boundary expectation not established; inspect per-case evidence.'
      result.L2 = result.assessment.insideTicketCounterexamples.length ? 'Unsupported file-level Ticket enforcement: declared unlisted/deny files were writable inside the Ticket; see exact case counterexamples.' : 'No file-level enforcement claim; inspect individual case evidence.'
      result.state = 'evidence-recorded'
    } catch (error) { result.state = 'failed'; result.error = errorInfo(error) }
    finally {
      result.cleanup = { handlesDisposed: 0, runtimeDisposed: false, errors: [] }
      for (const handle of handles.reverse()) {
        try { await handle.dispose(); result.cleanup.handlesDisposed++ } catch (error) { result.cleanup.errors.push(errorInfo(error)) }
      }
      try { await ctx.superagentRuntime.dispose(); result.cleanup.runtimeDisposed = true } catch (error) { result.cleanup.errors.push(errorInfo(error)) }
      try { result.liveAgents = ctx.agents.list().length } catch (error) { result.cleanup.errors.push(errorInfo(error)) }
      result.providerRequests = requests
      result.unexpectedAgentSteps = unexpectedSteps
      result.cleanupComplete = result.cleanup.runtimeDisposed && result.cleanup.errors.length === 0 && result.liveAgents === 0
      if (requests || unexpectedSteps || !result.cleanupComplete) result.state = 'failed'
      result.fixtureCreated = rootCreated
      result.finishedAt = new Date().toISOString()
      // Independent durable receipt; never call this a safety pass or overwrite old evidence.
      fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      stopProvider()
    }
  })()
  ctx.effect(() => async () => { await task })
}
