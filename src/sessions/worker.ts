import { isAbsolute, resolve } from 'node:path'
import type { Assignment } from '../domain/assignment.js'
import type { Ticket, TicketBrief } from '../domain/ticket.js'

/** Structural subset of DSH's activation result. */
export interface ActivationResult {
  readonly structured?: unknown
  readonly [key: string]: unknown
}

/** Structural activation returned by ctx.subagents.startActivation. */
export interface WorkerActivation {
  readonly id?: string
  readonly sessionId?: string
  readonly childSessionId?: string
  readonly result: Promise<ActivationResult>
  dispose?(): void | Promise<void>
}

/** JSON schema shape accepted by DSH; kept structural to avoid a runtime dependency. */
export interface ObjectJsonSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
  readonly additionalProperties?: boolean
}

export interface SpawnActivationInput {
  readonly provider: 'spawn'
  readonly delivery: 'caller'
  readonly cwd: string
  readonly agentPreset: string
  readonly outputSchema: ObjectJsonSchema
  readonly label: string
  readonly name?: string
  readonly childId?: string
  readonly signal?: AbortSignal
  readonly prompt?: readonly Record<string, unknown>[]
  readonly parent?: { readonly id: string; readonly [key: string]: unknown }
  readonly agentOptions?: Record<string, unknown>
}

/** Injectable adapter over ctx.subagents.startActivation. */
export interface Spawner {
  startActivation(input: SpawnActivationInput): Promise<WorkerActivation>
}

/** Input kept domain-structural and free of DSH types. */
export interface WorkerInput {
  readonly ticket: Pick<Ticket, 'id' | 'title' | 'brief' | 'workdir'>
  readonly assignment: Pick<Assignment, 'id' | 'ticketId' | 'sessionId'>
  readonly brief: TicketBrief
  readonly workdir: string
  readonly preset: string
  readonly parent?: { readonly id: string; readonly [key: string]: unknown }
  readonly signal?: AbortSignal
  readonly agentOptions?: Record<string, unknown>
}

export interface WorkerHandle {
  readonly activation: WorkerActivation
  readonly sessionId?: string
  readonly result: Promise<ActivationResult>
  dispose(): Promise<void>
}

/** Structured report schema enforced by the DSH spawn adapter. */
export const REPORT_OUTPUT_SCHEMA: ObjectJsonSchema = Object.freeze({
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['progress', 'ready', 'blocked', 'failed'] },
    done: { type: 'array', items: { type: 'string' } },
    todo: { type: 'array', items: { type: 'string' } },
    changedPaths: { type: 'array', items: { type: 'string' } },
    acceptance: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          result: { type: 'string', enum: ['passed', 'failed', 'not-run'] },
          evidence: { type: 'string' },
        },
        required: ['id', 'result', 'evidence'],
        additionalProperties: false,
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    needHuman: { type: 'array', items: { type: 'string' } },
  },
  required: ['state', 'done', 'todo', 'changedPaths', 'acceptance', 'risks', 'needHuman'],
  additionalProperties: false,
})

function reportPrompt(input: WorkerInput): readonly Record<string, unknown>[] {
  return [{
    type: 'text',
    text: JSON.stringify({
      ticketId: input.ticket.id,
      assignmentId: input.assignment.id,
      title: input.ticket.title,
      brief: input.brief,
      instruction: 'Execute the ticket in the supplied cwd and return a structured report matching the output schema.',
    }),
  }]
}

/**
 * Start one worker activation through the injected Spawner. The adapter is the
 * only place that knows DSH's provider/delivery/cwd/outputSchema contract.
 */
export async function startWorker(input: WorkerInput, spawner: Spawner): Promise<WorkerHandle> {
  if (!isAbsolute(input.workdir)) throw new Error('worker: cwd must be absolute')
  if (!input.preset.trim()) throw new Error('worker: agent preset is required')
  if (input.assignment.ticketId !== input.ticket.id) throw new Error('worker: assignment belongs to another ticket')
  const cwd = resolve(input.workdir)
  const activation = await spawner.startActivation({
    provider: 'spawn',
    delivery: 'caller',
    cwd,
    agentPreset: input.preset,
    outputSchema: REPORT_OUTPUT_SCHEMA,
    label: `assignment-${input.assignment.id}`,
    name: `worker-${input.assignment.id}`.replace(/[^a-z0-9-]/g, '-').slice(0, 32),
    childId: input.assignment.sessionId,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.parent ? { parent: input.parent } : {}),
    ...(input.agentOptions ? { agentOptions: input.agentOptions } : {}),
    prompt: reportPrompt(input),
  })
  return {
    activation,
    sessionId: activation.sessionId ?? activation.childSessionId ?? input.assignment.sessionId,
    result: activation.result,
    async dispose() {
      await activation.dispose?.()
    },
  }
}

/** Alias retained for callers that use the docs' shorter `start` name. */
export const start = startWorker

/** Adapter helper for a real DSH context; no DSH package import is needed. */
export function spawnerFromContext(context: { readonly subagents: { startActivation(input: SpawnActivationInput): Promise<WorkerActivation> } }): Spawner {
  return { startActivation: (input) => context.subagents.startActivation(input) }
}
