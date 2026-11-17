import { isAbsolute, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { transitionAssignment, type Assignment } from '../domain/assignment.js'
import type { AssignmentId, TicketId } from '../domain/ids.js'
import { transition, type Ticket } from '../domain/ticket.js'
import type { Trigger } from '../domain/trigger.js'
import { startWorker, type Spawner } from '../sessions/worker.js'
import { validateReport, type Report } from './report.js'

export type { Spawner } from '../sessions/worker.js'

/** Router has already accepted/admitted this trigger and supplied its open ticket and pending assignment. */
export interface AcceptedDispatch {
  readonly ticket: Ticket
  readonly assignment: Assignment
}

export interface DispatchOptions extends Pick<Parameters<typeof startWorker>[0], 'parent' | 'signal'> {
  readonly spawner: Spawner
  readonly workRoot: string
  readonly workerPreset: string
  readonly accept: (trigger: Trigger) => AcceptedDispatch | undefined | Promise<AcceptedDispatch | undefined>
  readonly now: () => number
}

/** Correlation stays outside the worker-controlled report body. */
export interface RouterReport {
  readonly ticketId: TicketId
  readonly assignmentId: AssignmentId
  readonly report: Report
}

function workdirFor(ticket: Ticket, workRoot: string): string {
  if (!ticket.id.trim() || ticket.id === '.' || ticket.id === '..' || /[/\\\u0000]/u.test(ticket.id)) {
    throw new Error('dispatch: ticket id must be a single safe path segment')
  }
  const workdir = join(workRoot, ticket.id)
  if (!isAbsolute(ticket.workdir) || resolve(ticket.workdir) !== workdir) {
    throw new Error('dispatch: ticket workdir must match the absolute workRoot/ticketId path')
  }
  return workdir
}

/**
 * Narrow F4 seam: Router acceptance -> one worker per accepted ticket -> validated reports.
 * This does not evaluate triggers, persist state, retry, or decide ticket completion (P3).
 * The caller supplies the Router's acceptance decision; undefined means conversational/ignored.
 */
export async function dispatchTriggers(triggers: readonly Trigger[], options: DispatchOptions): Promise<readonly RouterReport[]> {
  if (!isAbsolute(options.workRoot)) throw new Error('dispatch: workRoot must be absolute')
  if (!options.workerPreset.trim()) throw new Error('dispatch: worker preset is required')
  const workRoot = resolve(options.workRoot)
  const reports: RouterReport[] = []

  for (const trigger of triggers) {
    const accepted = await options.accept(trigger)
    if (!accepted) continue
    const { ticket, assignment } = accepted
    if (assignment.ticketId !== ticket.id) throw new Error('dispatch: assignment belongs to another ticket')
    if (ticket.state !== 'open' || assignment.state !== 'pending') {
      throw new Error('dispatch: an open ticket and pending assignment are required')
    }
    const workdir = workdirFor(ticket, workRoot)
    mkdirSync(workdir, { recursive: true })
    const at = options.now()
    const runningTicket = transition(ticket, { type: 'assignment_start', assignmentId: assignment.id, at, hasCapacity: true })
    const runningAssignment = transitionAssignment(assignment, { type: 'start', at })
    const worker = await startWorker({
      ticket: runningTicket, assignment: runningAssignment, brief: ticket.brief,
      workdir, preset: options.workerPreset, parent: options.parent, signal: options.signal,
    }, options.spawner)
    try {
      const result = await worker.result
      if (!validateReport(result.structured, ticket.brief)) {
        throw new Error(`dispatch: invalid structured report for assignment ${assignment.id}`)
      }
      reports.push({ ticketId: ticket.id, assignmentId: assignment.id, report: result.structured })
    } finally {
      await worker.dispose()
    }
  }

  return reports
}
