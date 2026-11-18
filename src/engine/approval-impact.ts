import { redact } from '../store/codec.js'
/** Approval is business consent only, never Host/profile/sandbox authority. */
const fields: Record<string, { required: string[]; optional: string[] }> = {
  'merge-pr': { required: ['repository', 'ref', 'base', 'commit'], optional: ['pr', 'impact'] },
  'delete-branch': { required: ['repository', 'branch', 'commit'], optional: ['impact'] },
  'close-pr': { required: ['repository', 'pr'], optional: ['impact'] },
  'send-external': { required: ['recipient', 'body'], optional: ['subject', 'impact'] },
  payment: { required: ['recipient', 'amount', 'currency', 'purpose'], optional: ['impact'] },
  permission: { required: ['scope', 'operation', 'impact'], optional: [] },
}
export function approvalImpact(kind: unknown, payload: unknown): { reviewable: boolean; reason?: string; details: Record<string, string | number> } {
  const spec = Object.hasOwn(fields, String(kind)) ? fields[String(kind)] : undefined
  if (!spec || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { reviewable: false, reason: 'approval_action_schema_required', details: {} }
  const value = payload as Record<string, unknown>, keys = Object.keys(value)
  if (keys.some(key => ![...spec.required, ...spec.optional].includes(key)) || spec.required.some(key => !Object.hasOwn(value, key))) return { reviewable: false, reason: 'approval_action_schema_required', details: {} }
  const details: Record<string, string | number> = {}
  for (const key of keys) {
    const item = value[key]
    if (!(typeof item === 'string' && item.trim() && item.length <= 8000 || typeof item === 'number' && Number.isFinite(item)) || key === 'amount' && !(typeof item === 'number' && item > 0)) return { reviewable: false, reason: 'approval_action_schema_required', details: {} }
    const safe = redact(item)
    // If the owner cannot see an exact scope/action, a hash alone cannot grant consent.
    if (safe !== item || typeof item === 'string' && item.includes('[REDACTED')) return { reviewable: false, reason: 'approval_action_redacted', details: {} }
    details[key] = item as string | number
  }
  return { reviewable: true, details }
}
