import type { TicketBrief } from '../domain/ticket.js'

export type ReportState = 'progress' | 'ready' | 'blocked' | 'failed'
export type AcceptanceResult = 'passed' | 'failed' | 'not-run'

export interface ReportAcceptance {
  readonly id: string
  readonly result: AcceptanceResult
  readonly evidence: string
}

export interface Report {
  readonly state: ReportState
  readonly done: readonly string[]
  readonly todo: readonly string[]
  readonly changedPaths: readonly string[]
  readonly acceptance: readonly ReportAcceptance[]
  readonly risks: readonly string[]
  readonly needHuman: readonly string[]
}

export type ReportInput = Report

export interface ReportValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

const STATES: readonly ReportState[] = ['progress', 'ready', 'blocked', 'failed']
const RESULTS: readonly AcceptanceResult[] = ['passed', 'failed', 'not-run']

function objectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringArray(value: unknown, field: string, errors: string[], allowEmpty = true): value is readonly string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`)
    return false
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || (!allowEmpty && !entry.trim())) errors.push(`${field}[${index}] must be a non-empty string`)
  })
  return true
}

/**
 * Explain every schema/acceptance mismatch without mutating either input.
 * `not-run` is intentionally rejected: a result must provide evidence for
 * every criterion before the router can consume it.
 */
export function inspectReport(value: unknown, brief: TicketBrief): ReportValidation {
  const errors: string[] = []
  if (!objectLike(value)) return { valid: false, errors: ['report must be an object'] }

  if (typeof value.state !== 'string' || !STATES.includes(value.state as ReportState)) errors.push('state must be progress, ready, blocked, or failed')
  stringArray(value.done, 'done', errors)
  stringArray(value.todo, 'todo', errors)
  stringArray(value.changedPaths, 'changedPaths', errors, false)
  stringArray(value.risks, 'risks', errors)
  stringArray(value.needHuman, 'needHuman', errors)

  if (!Array.isArray(value.acceptance)) {
    errors.push('acceptance must be an array')
  } else {
    const expected = brief.acceptance.map((criterion) => criterion.id)
    const seen = new Set<string>()
    for (const [index, entry] of value.acceptance.entries()) {
      if (!objectLike(entry)) {
        errors.push(`acceptance[${index}] must be an object`)
        continue
      }
      if (typeof entry.id !== 'string' || !entry.id.trim()) errors.push(`acceptance[${index}].id must be a non-empty string`)
      else {
        if (seen.has(entry.id)) errors.push(`acceptance contains duplicate id ${entry.id}`)
        seen.add(entry.id)
        if (!expected.includes(entry.id)) errors.push(`acceptance contains unknown id ${entry.id}`)
      }
      if (typeof entry.result !== 'string' || !RESULTS.includes(entry.result as AcceptanceResult)) errors.push(`acceptance[${index}].result is invalid`)
      else if (entry.result === 'not-run') errors.push(`acceptance[${index}] ${entry.id ?? '<unknown>'} is not-run`)
      if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) errors.push(`acceptance[${index}].evidence must be a non-empty string`)
    }
    for (const id of expected) if (!seen.has(id)) errors.push(`acceptance is missing id ${id}`)
    if (value.acceptance.length !== expected.length) errors.push('acceptance must contain exactly one row per brief criterion')
  }

  return { valid: errors.length === 0, errors }
}

/** Runtime type guard used by Router/dispatch boundaries. */
export function validateReport(value: unknown, brief: TicketBrief): value is Report {
  return inspectReport(value, brief).valid
}

/** Build an immutable report and apply the same boundary checks as parsing. */
export function generateReport(input: ReportInput, brief: TicketBrief): Report {
  const report: Report = {
    state: input.state,
    done: [...input.done],
    todo: [...input.todo],
    changedPaths: [...input.changedPaths],
    acceptance: input.acceptance.map((entry) => ({ id: entry.id, result: entry.result, evidence: entry.evidence })),
    risks: [...input.risks],
    needHuman: [...input.needHuman],
  }
  if (!validateReport(report, brief)) throw new Error(`report: invalid structured result (${inspectReport(report, brief).errors.join('; ')})`)
  return Object.freeze({
    ...report,
    done: Object.freeze(report.done),
    todo: Object.freeze(report.todo),
    changedPaths: Object.freeze(report.changedPaths),
    acceptance: Object.freeze(report.acceptance.map((entry) => Object.freeze(entry))),
    risks: Object.freeze(report.risks),
    needHuman: Object.freeze(report.needHuman),
  })
}

/**
 * F4's narrow retry policy: only a first `ready` result with failed criteria
 * gets one correction attempt. Missing/not-run reports are also retryable when
 * inspected directly; no caller may obtain a second retry.
 */
export function shouldRetryReport(value: unknown, brief: TicketBrief, retryCount: number): boolean {
  if (retryCount >= 1) return false
  const inspected = inspectReport(value, brief)
  // F4 returns malformed/incomplete reports once for correction. A valid
  // report is retried only when a ready result contains a failed criterion.
  if (!inspected.valid) return true
  if (!objectLike(value) || value.state !== 'ready') return false
  return Array.isArray(value.acceptance) && value.acceptance.some((entry) => objectLike(entry) && entry.result === 'failed')
}

export const validateStructuredReport = validateReport
