import type { Actor } from './trigger.js'
import type { Decision, Strength } from './eval.js'
import type { Policy } from './policy.js'
import { snapshot } from './immutable.js'

export type MandateVia = 'addressed' | 'followup' | 'listed' | 'admission'

export interface Mandate {
  readonly strength: Strength
  readonly policyVersion: string
  readonly grantedBy: Actor
  readonly at: number
  readonly scope: string
  readonly via: MandateVia
  readonly rules: readonly string[]
}

export interface RevalidationResult {
  readonly valid: boolean
  readonly mandate: Mandate
  readonly reason?: string
}

/** Only an accept decision with the current policy may create a mandate. */
export function canGrant(decision: Pick<Decision, 'kind' | 'policyVersion' | 'strength'>, policy: Pick<Policy, 'version'>): boolean {
  return decision.kind === 'accept' && decision.policyVersion === policy.version
}

export function grantMandate(input: Omit<Mandate, 'policyVersion' | 'strength'> & { readonly decision: Pick<Decision, 'kind' | 'policyVersion' | 'strength'> }, policy: Pick<Policy, 'version'>): Mandate {
  if (!canGrant(input.decision, policy)) throw new Error('mandate: grant requires an accept decision matching current policy')
  return snapshot({ strength: input.decision.strength, policyVersion: policy.version, grantedBy: input.grantedBy, at: input.at, scope: input.scope, via: input.via, rules: [...input.rules] })
}

/** Revocation is only legal when the caller has an explicit human-stop action. */
export interface HumanStop {
  readonly trust: string
  readonly explicitStop: boolean
}

export function canWithdraw(trigger: HumanStop): boolean {
  return trigger.trust === 'human' && trigger.explicitStop === true
}

export function withdrawMandate(mandate: Mandate, trigger: HumanStop): undefined {
  void mandate
  if (!canWithdraw(trigger)) throw new Error('mandate: only an explicit human stop may withdraw')
  return undefined
}

/** Revalidation never mutates an existing mandate; it reports whether policy still permits it. */
export function revalidate(mandate: Mandate, policy: Pick<Policy, 'version' | 'acceptedSources'>, source: Mandate['grantedBy']['source'] = mandate.grantedBy.source): RevalidationResult {
  const valid = policy.acceptedSources.length === 0 || policy.acceptedSources.includes(source)
  return Object.freeze({ valid, mandate, ...(valid ? {} : { reason: 'policy no longer matches mandate scope' }) })
}
