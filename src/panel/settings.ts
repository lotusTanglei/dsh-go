import type { Config } from '../config.js'
import { defaults } from '../config.js'
import { redact } from '../store/codec.js'

export type ConfigOrigin = 'patch' | 'environment' | 'default' | 'derived' | 'unavailable'
export interface EffectiveSetting {
  readonly key: string
  readonly value: unknown
  readonly origin: ConfigOrigin
  readonly redacted?: boolean
  readonly originDetail?: string
}

/** Inspect Loader's pre-interpolation values, never compare effective values to defaults.
 * Raw expressions are classified but never evaluated or returned to the browser.
 * Missing Loader metadata is unknown, not evidence that a value was a default.
 */
export function effectiveSettings(config: Partial<Config>, raw?: Record<string, unknown>): readonly EffectiveSetting[] {
  const values: Record<string, unknown> = { ...config }
  if (Object.hasOwn(values, 'stateDir') && !Object.hasOwn(values, 'mainSessionId')) values.mainSessionId = null
  const keys = Object.keys(values).filter(key => Object.hasOwn(defaults, key) || ['stateDir', 'dbPath', 'lockPath', 'workRoot', 'mainSessionId', 'sources', 'localSourceRoots'].includes(key))
  const origin = (key: string, parent?: string): Pick<EffectiveSetting, 'origin' | 'originDetail'> => {
    if (!raw) return { origin: 'unavailable', originDetail: 'Loader pre-interpolation configuration unavailable' }
    if (Object.hasOwn(raw, '__jsExpr')) return { origin: 'unavailable', originDetail: 'Whole configuration is a Loader expression; per-field origin unavailable' }
    const parentValue = parent ? raw[parent] : undefined
    if (parentValue && typeof parentValue === 'object' && '__jsExpr' in parentValue) return expressionOrigin(parentValue as Record<string, unknown>)
    const container = parent ? parentValue : raw
    if (container && typeof container === 'object' && Object.hasOwn(container, key)) {
      const value = (container as Record<string, unknown>)[key]
      if (value && typeof value === 'object' && '__jsExpr' in value) return expressionOrigin(value as Record<string, unknown>)
      if (['dbPath', 'lockPath', 'workRoot'].includes(key) && !value) return { origin: 'derived', originDetail: 'Resolved from stateDir/dbPath' }
      return { origin: 'patch', originDetail: 'Explicit Loader configuration; bundle/profile/overlay layer not distinguished' }
    }
    if (['dbPath', 'lockPath', 'workRoot'].includes(key)) return { origin: 'derived', originDetail: 'Resolved from stateDir/dbPath' }
    return { origin: 'default' }
  }
  return keys.flatMap(key => {
    if (key === 'roleTools') return Object.entries(config.roleTools ?? {}).map(([role, value]) => ({ key: `roleTools.${role}`, value: redact(value), ...origin(role, key) }))
    const path = ['stateDir', 'dbPath', 'lockPath', 'workRoot'].includes(key)
    const value = key === 'localSourceRoots' ? (config.localSourceRoots ?? []).map(root => ({ id: root.id, name: root.name ?? root.id })) : path ? '[REDACTED_PATH]' : redact(values[key])
    return [{ key, value, ...origin(key), ...(path ? { redacted: true } : {}) }]
  })
}
function expressionOrigin(value: Record<string, unknown>): Pick<EffectiveSetting, 'origin' | 'originDetail'> {
  return typeof value.__jsExpr === 'string' && /\b(?:process\.)?env(?:\.|\[)/.test(value.__jsExpr)
    ? { origin: 'environment', originDetail: 'Environment-backed Loader expression (may include a fallback)' }
    : { origin: 'patch', originDetail: 'Explicit Loader expression (not evaluated by the panel)' }
}
