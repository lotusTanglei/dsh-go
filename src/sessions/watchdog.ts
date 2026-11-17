/**
 * Watchdog seam only. P2 owns the structural contract; polling, cold reads,
 * metrics, and actions are implemented by the later Watchdog stage.
 */

export interface AssignmentSnapshot {
  readonly assignmentId: string
  readonly ticketId: string
  readonly sessionId: string
  readonly state: 'pending' | 'running' | 'ended'
  readonly lastProgressAt?: number
  readonly steps?: number
  readonly tokens?: number
  readonly repeatedCalls?: number
}

export interface SessionSnapshot {
  readonly sessionId: string
  readonly events?: readonly unknown[]
  readonly status?: string
  readonly [key: string]: unknown
}

/** Cold-read query adapter; implementations must not wake a session. */
export interface SessionQuery {
  readSession(sessionId: string): Promise<SessionSnapshot | undefined>
}

/**
 * Narrow Watchdog interface. No scheduler, policy, store, or DSH dependency is
 * present here; callers inject an implementation in P4 or tests.
 */
export interface Watchdog {
  snapshotAssignments(): Promise<readonly AssignmentSnapshot[]>
  nudge?(sessionId: string, message: string): Promise<void>
  steer?(sessionId: string, message: string): Promise<void>
  cancel?(sessionId: string, reason?: string): Promise<void>
  escalate?(sessionId: string, message: string): Promise<void>
}

export interface WatchdogContext {
  readonly sessionQuery: SessionQuery
}
