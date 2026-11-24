/**
 * L1 Worker launch: the Go plugin creates its own Agent on a fresh Session whose
 * durable `meta.cwd` is the Ticket working copy, then mounts the Worker preset
 * and pins the Host permission knobs (workspace-write, approval never) inside the
 * unpublished setup. Nothing here inherits the Router's session or sandbox root.
 *
 * If the installed Host does not expose `ctx.agents.create`/`resume` (the rc.5
 * contract recorded in docs/GO-SESSION-ACTIONS.md), the path fails closed with a
 * fixed code instead of guessing an interface.
 *
 * @module dsh-go/sessions/agent-worker
 */
import { randomUUID } from 'node:crypto'
import type { WorkerActivation, WorkerHandle, WorkerInput } from './worker.js'
import { workerPromptBlocks } from './worker.js'

/** Structural Host surface used by this adapter; no DSH package import. */
export interface WorkerAgentHost {
  readonly agents: {
    create?(input: unknown): Promise<any>
    resume?(input: unknown): Promise<any>
    get?(id: string): any
  }
  readonly agentPresets: {
    mount(ctx: any, preset: string): Promise<unknown>
    composedPreset(ctx: any): string | undefined
  }
  readonly agentDefaultModel?: { currentSelection(): any }
}

/** Provenance kept on the handle for receipts/diagnostics (no Host paths beyond the Ticket dir). */
export interface AgentWorkerIdentity {
  readonly sessionId: string
  readonly ticketDir: string
  readonly preset: string
  /** `create` for a fresh L1 Agent, `resume` for recovery of a persisted Worker Session. */
  readonly mode: 'create' | 'resume'
}

export interface AgentWorkerHandle extends WorkerHandle {
  readonly identity: AgentWorkerIdentity
  /** Resolve the activation result from the Worker's own final `report_result`. */
  settle(result: unknown): void
}

/** Host global execution tools a Worker must not see; the guard denies them as a second line. */
export const HOST_WORKER_DENIED_TOOLS = Object.freeze(['bash', 'pwsh', 'job_list', 'job_output', 'job_kill'])

function coded(code: string, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message), { name: 'GoWorkerError', code, ...(cause === undefined ? {} : { cause }) })
}

function errorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && /^SA_/.test(code) ? code : fallback
}

/**
 * Compose the unpublished Agent scope: preset tools/prompt, Host permission
 * knobs, and removal of Host execution tools that could bypass `go_bash`.
 */
function workerSetup(host: WorkerAgentHost, identity: Pick<AgentWorkerIdentity, 'ticketDir' | 'preset'>) {
  return async (agentCtx: any, agent: any): Promise<void> => {
    const session = agent?.session
    if (!session || session.header?.cwd !== identity.ticketDir) throw coded('SA_WORKER_BOUNDARY_UNBOUND', 'Worker session cwd is not the Ticket working copy')
    if (typeof session.append !== 'function') throw coded('SA_WORKER_BOUNDARY_UNBOUND', 'Worker session does not accept permission events')
    await host.agentPresets.mount(agentCtx, identity.preset)
    if (host.agentPresets.composedPreset(agentCtx) !== identity.preset) throw coded('SA_WORKER_PRESET_MISMATCH', 'Worker preset did not mount')
    // These are the installed rc.5 canonical setters' exact durable payloads
    // (setSandboxMode / setApprovalPolicy): the Host enforces them for every
    // native fs/shell capability of this Agent; Go does not invent a parallel policy.
    session.append('sandbox/mode', { mode: 'workspace-write' })
    session.append('approval/policy', { policy: 'never' })
    if (typeof agentCtx?.tools?.restrict === 'function') {
      for (const name of HOST_WORKER_DENIED_TOOLS) {
        // Call through the agent context so Cordis traces the caller scope; an
        // extracted method reference would fall back to the root scope and throw.
        // A deployment may not mount every Host tool; unknown names are skipped,
        // never treated as a reason to fall through to the Host tool.
        try { agentCtx.tools.restrict({ deny: [name] }) } catch { /* tool not mounted here */ }
      }
    }
  }
}

/** Verify the exact live identity the boundary depends on. */
function verifyLive(host: WorkerAgentHost, handle: any, identity: AgentWorkerIdentity): void {
  const agent = handle?.agent
  if (!agent || agent.id !== identity.sessionId) throw coded('SA_WORKER_BOUNDARY_UNBOUND', 'Worker Agent identity does not match the Assignment session')
  if (agent.session?.header?.cwd !== identity.ticketDir) throw coded('SA_WORKER_BOUNDARY_UNBOUND', 'Worker Agent cwd is not the Ticket working copy')
  if (host.agentPresets.composedPreset(agent.ctx) !== identity.preset) throw coded('SA_WORKER_PRESET_MISMATCH', 'Worker Agent preset is not the Worker preset')
}

function taskMessage(input: WorkerInput): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: 'user',
    content: workerPromptBlocks(input, 'report_result'),
    source: { kind: 'superagent', form: 'notice', summary: 'Go Worker task' },
  }
}

function continuationMessage(): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: 'Continue the Ticket inside your working copy. When the work is complete, call report_result with the complete structured report; do not answer with prose.' }],
    source: { kind: 'superagent', form: 'notice', summary: 'Go Worker recovery' },
  }
}

/** Build the handle shared by the create and resume paths. */
function handleFor(handle: any, identity: AgentWorkerIdentity): AgentWorkerHandle {
  let resultResolve!: (value: any) => void
  const result = new Promise<any>(resolvePromise => { resultResolve = resolvePromise })
  let settled = false
  let disposing: Promise<void> | undefined
  const activation: WorkerActivation = {
    id: identity.sessionId,
    sessionId: identity.sessionId,
    agent: handle.agent,
    result,
    dispose: () => dispose(),
  }
  const settle = (value: unknown): void => {
    if (settled) return
    settled = true
    resultResolve(value)
  }
  const dispose = (): Promise<void> => (disposing ??= (async () => {
    try { await handle.dispose?.() } finally { settle({ stopReason: 'disposed' }) }
  })())
  return {
    activation,
    sessionId: identity.sessionId,
    identity,
    result,
    settle,
    dispose,
  }
}

/** Model route fallback for a resumed Worker that recorded no selection yet. */
function resumeAgentOptions(host: WorkerAgentHost): Record<string, unknown> | undefined {
  const defaults = host.agentDefaultModel
  if (!defaults || typeof defaults.currentSelection !== 'function') return undefined
  const current = (): any => { try { return defaults.currentSelection() } catch { return undefined } }
  return {
    get provider() { return current()?.provider },
    get model() { return current()?.model },
    get reasoningEffort() { return current()?.reasoningEffort },
  }
}

/**
 * Create a fresh independent Worker Agent (L1). The Session identity is the
 * Assignment's pre-allocated session id; the Ticket directory is durable
 * `meta.cwd`, so the Host sandbox root is the Ticket, not the Router parent.
 */
export async function startAgentWorker(input: WorkerInput & { readonly boundaryAllowed: boolean }, host: WorkerAgentHost): Promise<AgentWorkerHandle> {
  if (!input.boundaryAllowed) throw coded('SA_EXECUTION_BOUNDARY_UNVERIFIED', 'Worker execution boundary is not verified')
  if (typeof host.agents.create !== 'function') throw coded('SA_WORKER_AGENT_UNAVAILABLE', 'Host agent factory is unavailable; L1 Worker cannot be created')
  const identity: AgentWorkerIdentity = { sessionId: input.assignment.sessionId, ticketDir: input.workdir, preset: input.preset, mode: 'create' }
  let handle: any
  try {
    handle = await host.agents.create({
      sessionId: identity.sessionId,
      meta: { cwd: identity.ticketDir, agentPreset: identity.preset, origin: 'subagent', delegationDepth: 1 },
      ...(input.agentOptions ? { agentOptions: input.agentOptions } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      setup: workerSetup(host, identity),
    })
  } catch (error) {
    throw coded(errorCode(error, 'SA_WORKER_CREATE_FAILED'), 'Host refused to create the Worker Agent', error)
  }
  try {
    verifyLive(host, handle, identity)
    if (typeof handle?.agent?.followup !== 'function') throw coded('SA_WORKER_PROMPT_FAILED', 'Worker Agent cannot accept its task message')
    await handle.agent.followup(taskMessage(input))
  } catch (error) {
    try { await handle?.dispose?.() } catch { /* rollback failure keeps the primary reason */ }
    throw error
  }
  return handleFor(handle, identity)
}

/**
 * Resume a persisted Worker Session for recovery. The caller must already have
 * proven the persisted cwd is the Ticket copy; this function composes the same
 * preset/permission/restriction setup and re-verifies the boundary afterwards.
 */
export async function resumeAgentWorker(input: WorkerInput & { readonly boundaryAllowed: boolean }, host: WorkerAgentHost): Promise<AgentWorkerHandle> {
  if (!input.boundaryAllowed) throw coded('SA_EXECUTION_BOUNDARY_UNVERIFIED', 'Worker execution boundary is not verified')
  if (typeof host.agents.resume !== 'function') throw coded('SA_WORKER_RESUME_UNAVAILABLE', 'Host agent resume is unavailable; recovered Worker stays stopped')
  const identity: AgentWorkerIdentity = { sessionId: input.assignment.sessionId, ticketDir: input.workdir, preset: input.preset, mode: 'resume' }
  const agentOptions = resumeAgentOptions(host)
  let handle: any
  try {
    handle = await host.agents.resume({
      resumeSessionId: identity.sessionId,
      ...(agentOptions === undefined ? {} : { agentOptions }),
      ...(input.signal ? { signal: input.signal } : {}),
      setup: workerSetup(host, identity),
    })
  } catch (error) {
    throw coded(errorCode(error, 'SA_WORKER_RESUME_FAILED'), 'Host refused to resume the Worker Agent', error)
  }
  try {
    verifyLive(host, handle, identity)
    if (typeof handle?.agent?.followup !== 'function') throw coded('SA_WORKER_PROMPT_FAILED', 'Worker Agent cannot accept its continuation message')
    await handle.agent.followup(continuationMessage())
  } catch (error) {
    try { await handle?.dispose?.() } catch { /* rollback failure keeps the primary reason */ }
    throw error
  }
  return handleFor(handle, identity)
}
