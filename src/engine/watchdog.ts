import type { SessionQuery } from '../sessions/watchdog.js'

export interface WatchdogAssignment {
  readonly assignmentId: string; readonly ticketId: string; readonly sessionId: string
  readonly state: 'pending' | 'running' | 'ended'
  readonly startedAt: number; readonly lastProgressAt: number
  readonly steps: number; readonly tokens: number
  readonly waitingSince?: number
  readonly briefGoal: string
}
export interface WatchdogMetrics {
  readonly at: number; readonly lastProgressAt: number; readonly steps: number; readonly tokens: number
  readonly durationMs: number; readonly repeatedCalls: number; readonly repeatedCall?: string; readonly waitingMs: number
}
export interface WatchdogState { stallAt?: number; repeatSignature?: string; budgetStage?: number; deviationAt?: number; waitingAt?: number }
export type WatchdogAction = 'nudge' | 'steer' | 'cancel' | 'escalate'
export interface WatchdogAudit {
  readonly assignmentId: string; readonly ticketId: string; readonly sessionId: string
  readonly action: WatchdogAction; readonly rule: string; readonly message: string
  readonly metrics: WatchdogMetrics; readonly state: WatchdogState; readonly outcome: 'requested' | 'completed' | 'failed'
}
export interface WatchdogOptions {
  readonly stallMs: number; readonly repeatCallThreshold: number; readonly waitingHumanMs: number
  readonly maxSteps: number; readonly maxTokens: number; readonly maxDurationMs: number
  readonly deviationIntervalMs: number
}
export interface WatchdogPorts {
  readonly sessionQuery: SessionQuery
  assignments(): Promise<readonly WatchdogAssignment[]>
  state?(id: string): WatchdogState | undefined
  nudge(sessionId: string, message: string): Promise<void>
  steer(sessionId: string, message: string): Promise<void>
  cancel(assignment: WatchdogAssignment, reason: string): Promise<void>
  escalate(assignment: WatchdogAssignment, message: string): Promise<void>
  audit(record: WatchdogAudit): void | Promise<void>
  deviation?(assignment: WatchdogAssignment, metrics: WatchdogMetrics): Promise<string | undefined>
}
function canonical(value: any): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
/** Read-only metrics: tool calls alone never count as progress. */
export function measureWorker(assignment: WatchdogAssignment, events: readonly unknown[], now: number): WatchdogMetrics {
  let signature = '', repeatedCalls = 0, steps = 0, tokens = 0
  for (const raw of events) {
    const event = raw as any
    if (event.type === 'step/start') steps++
    if (event.type === 'assistant/message' && event.data?.usage) {
      const usage = event.data.usage
      tokens += ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'].reduce((sum, key) => sum + (Number(usage[key]) || 0), 0)
    }
    if (event.type !== 'tool/call' || ['report_progress', 'report_result', 'structured_output'].includes(event.data?.name)) continue
    let args = event.data.arguments
    try { args = JSON.parse(args) } catch { /* retain exact non-JSON input for repetition detection */ }
    const next = `${event.data.name} ${canonical(args)}`
    repeatedCalls = next === signature ? repeatedCalls + 1 : 1
    signature = next
  }
  return { at: now, lastProgressAt: assignment.lastProgressAt, steps: Math.max(assignment.steps, steps), tokens: Math.max(assignment.tokens, tokens), durationMs: Math.max(0, now - assignment.startedAt), repeatedCalls, repeatedCall: signature || undefined, waitingMs: assignment.waitingSince === undefined ? 0 : Math.max(0, now - assignment.waitingSince) }
}
export function createWatchdog(ports: WatchdogPorts, options: WatchdogOptions) {
  for (const value of Object.values(options)) if (!Number.isFinite(value) || value <= 0) throw new Error('watchdog: positive finite thresholds required')
  const states = new Map<string, WatchdogState>()
  let running = false
  async function act(assignment: WatchdogAssignment, metrics: WatchdogMetrics, state: WatchdogState, action: WatchdogAction, rule: string, message: string) {
    const record = { assignmentId: assignment.assignmentId, ticketId: assignment.ticketId, sessionId: assignment.sessionId, metrics, state: { ...state }, action, rule, message }
    await ports.audit({ ...record, outcome: 'requested' })
    try {
      if (action === 'cancel') await ports.cancel(assignment, message)
      else if (action === 'escalate') await ports.escalate(assignment, message)
      else await ports[action](assignment.sessionId, message)
      await ports.audit({ ...record, outcome: 'completed' })
      states.set(assignment.assignmentId, { ...state })
    } catch (error) {
      await ports.audit({ ...record, outcome: 'failed' })
      throw error
    }
  }
  return {
    async tick(now = Date.now()): Promise<void> {
      if (running) return
      running = true
      try {
        for (const assignment of await ports.assignments()) {
          if (assignment.state === 'pending') continue
          const state = { ...ports.state?.(assignment.assignmentId), ...states.get(assignment.assignmentId) }
          const snapshot = await ports.sessionQuery.readSession(assignment.sessionId)
          const metrics = measureWorker(assignment, snapshot?.events ?? [], now)
          // Human waiting is not Worker execution time; reminder-only always precedes budgets.
          if (assignment.waitingSince !== undefined) {
            if (metrics.waitingMs > options.waitingHumanMs && (state.waitingAt === undefined || now - state.waitingAt > options.waitingHumanMs)) await act(assignment, metrics, { ...state, waitingAt: now }, 'escalate', 'waiting-human', 'Worker is waiting for human input; please review the pending question or approval.')
            continue
          }
          const over = metrics.steps > options.maxSteps || metrics.tokens > options.maxTokens || metrics.durationMs > options.maxDurationMs
          if (over || (state.budgetStage ?? 0) > 0) {
            const stage = state.budgetStage ?? 0
            if (stage >= 3) continue
            const action = (['nudge', 'cancel', 'escalate'] as const)[stage]!
            await act(assignment, metrics, { ...state, budgetStage: stage + 1 }, action, 'budget', `Worker budget exceeded: steps=${metrics.steps}, tokens=${metrics.tokens}, durationMs=${metrics.durationMs}. Stop unsafe expansion and report.`)
            continue
          }
          if (assignment.state === 'ended') continue
          if (now - assignment.lastProgressAt > options.stallMs) {
            if (state.stallAt === undefined || assignment.lastProgressAt > state.stallAt) await act(assignment, metrics, { ...state, stallAt: now }, 'nudge', 'stall', 'No recorded progress. Report completed work or a specific blocker; do not repeat ineffective actions.')
            else if (now - state.stallAt > options.stallMs) await act(assignment, metrics, state, 'cancel', 'stall', 'Still no progress after nudge; stopping the Assignment.')
            continue
          }
          if (metrics.repeatedCalls >= options.repeatCallThreshold && state.repeatSignature !== metrics.repeatedCall) {
            await act(assignment, metrics, { ...state, repeatSignature: metrics.repeatedCall }, 'nudge', 'repeat', `Repeated ${metrics.repeatedCalls} times: ${metrics.repeatedCall}. Change approach or report the blocker.`)
            continue
          }
          if (ports.deviation && now - (state.deviationAt ?? assignment.startedAt) >= options.deviationIntervalMs) {
            const message = await ports.deviation(assignment, metrics)
            states.set(assignment.assignmentId, { ...state, deviationAt: now })
            if (message) await act(assignment, metrics, { ...state, deviationAt: now }, 'steer', 'deviation', message)
          }
        }
      } finally { running = false }
    },
  }
}
