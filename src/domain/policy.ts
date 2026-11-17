import { createHash } from 'node:crypto'
import type { SourceId } from './ids.js'

export type AcceptMode = 'off' | 'observe' | 'auto'
export type ConfirmMode = 'always' | 'when-ambiguous' | 'never'
export type BotPolicy = 'deny' | 'infer'

export interface Budgets {
  readonly maxWorkers: number
  readonly maxStepsPerTicket: number
  readonly maxTokensPerTicket: number
  readonly maxDurationMsPerTicket: number
  readonly maxRetries: number
  readonly queueLimit: number
  readonly watchdog: { readonly intervalMs: number; readonly stallMs: number; readonly repeatCallThreshold: number }
}

export interface Policy {
  readonly version: string
  readonly acceptedSources: readonly SourceId[]
  readonly acceptMode: AcceptMode
  readonly confirm: ConfirmMode
  readonly bots: BotPolicy
  readonly paused: boolean
  readonly evalTimeoutMs: number
  readonly budgets: Budgets
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/** SHA-256 of canonical (sorted-key) policy JSON. */
export function policyVersion(input: Omit<Policy, 'version'> | Policy): string {
  const { version: _version, ...rest } = input as Policy
  return createHash('sha256').update(canonical(rest), 'utf8').digest('hex')
}

export function createPolicy(input: Omit<Policy, 'version'>): Policy {
  const version = policyVersion(input)
  return Object.freeze({ ...input, version, acceptedSources: Object.freeze([...input.acceptedSources]), budgets: Object.freeze({ ...input.budgets, watchdog: Object.freeze({ ...input.budgets.watchdog }) }) })
}

export function isPolicyVersion(policy: Policy, version: string): boolean {
  return policy.version === version
}
