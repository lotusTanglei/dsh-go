import type { AcceptanceCriterion, TicketBrief } from '../domain/ticket.js'
import { validateTicketBrief } from '../domain/ticket.js'

/** Input accepted by the pure brief constructor. All TicketBrief fields are explicit. */
export type TicketBriefInput = {
  readonly goal: string
  readonly scope: { readonly repo: string; readonly subdirs: readonly string[] }
  readonly base: { readonly ref: string; readonly requireCleanTree: boolean }
  readonly allowWrite: readonly string[]
  readonly denyWrite: readonly string[]
  readonly runtime: string
  readonly acceptance: readonly AcceptanceCriterion[]
  readonly outOfScope: readonly string[]
  readonly blockers: readonly string[]
  readonly firstAction: string
  readonly approvalsRequired: readonly string[]
}

/** The eleven concrete keys in the rev2 TicketBrief contract. */
export const TICKET_BRIEF_FIELDS = [
  'goal',
  'scope',
  'base',
  'allowWrite',
  'denyWrite',
  'runtime',
  'acceptance',
  'outOfScope',
  'blockers',
  'firstAction',
  'approvalsRequired',
] as const

/**
 * Build an immutable brief without adding policy or side effects.
 * Unknown values belong in the input (for example `blockers: ['unknown']`),
 * rather than being silently invented by this constructor.
 */
export function generateBrief(input: TicketBriefInput): TicketBrief {
  const brief: TicketBrief = {
    goal: input.goal,
    scope: { repo: input.scope.repo, subdirs: [...input.scope.subdirs] },
    base: { ref: input.base.ref, requireCleanTree: input.base.requireCleanTree },
    allowWrite: [...input.allowWrite],
    denyWrite: [...input.denyWrite],
    runtime: input.runtime,
    acceptance: input.acceptance.map((criterion) => ({ id: criterion.id, check: criterion.check, kind: criterion.kind })),
    outOfScope: [...input.outOfScope],
    blockers: [...input.blockers],
    firstAction: input.firstAction,
    approvalsRequired: [...input.approvalsRequired],
  }
  if (!validateBrief(brief)) throw new Error('brief: invalid TicketBrief')
  return Object.freeze({
    ...brief,
    scope: Object.freeze(brief.scope),
    base: Object.freeze(brief.base),
    allowWrite: Object.freeze(brief.allowWrite),
    denyWrite: Object.freeze(brief.denyWrite),
    acceptance: Object.freeze(brief.acceptance.map((criterion) => Object.freeze(criterion))),
    outOfScope: Object.freeze(brief.outOfScope),
    blockers: Object.freeze(brief.blockers),
    approvalsRequired: Object.freeze(brief.approvalsRequired),
  })
}

/** Runtime type guard for the pure brief contract. */
export function validateBrief(value: unknown): value is TicketBrief {
  if (!validateTicketBrief(value as TicketBrief)) return false
  const ids = (value as TicketBrief).acceptance.map((criterion) => criterion.id)
  return new Set(ids).size === ids.length
}

/** Throwing counterpart useful at a boundary where invalid input is exceptional. */
export function assertBrief(value: unknown): asserts value is TicketBrief {
  if (!validateBrief(value)) throw new Error('brief: invalid TicketBrief')
}

// Explicit aliases make the engine seam readable to callers that use domain naming.
export const generateTicketBrief = generateBrief
export const validateTicketBriefInput = validateBrief
