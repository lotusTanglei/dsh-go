export const JSON_SCHEMA_VERSION = 1 as const

const SECRET_KEY = /^(?:token|secret|password|passwd|api[_-]?(?:key|token)|authorization|credential|private[_-]?key|access[_-]?key|refresh[_-]?token|bearer[_-]?token)$/i
const PRIVATE_URL = /https?:\/\/[^\s"'<>]+/gi
const PRIVATE_URL_VALUE = /https?:\/\/[^\s"'<>]+/i
const PRIVATE_URL_KEY = /^https?:\/\//i
const SECRET_VALUE = /(?:Bearer\s+)[A-Za-z0-9._~+\/-]+|(?:sk|ghp|github_pat)[_-][A-Za-z0-9_\-]+|\b(?=[A-Za-z0-9+/]{32,}={0,2}\b)(?![a-f0-9]{64}\b)[A-Za-z0-9+/]{32,}={0,2}\b/gi
const SECRET_PREFIX = /(?:Bearer\s+|(?:sk|ghp|github_pat)[_-])/i
// Include spaces inside a user path; stop only at quoting/control/punctuation delimiters.
const USER_PATH = /(?:\/(?:Users|home)\/|[A-Z]:[\\/]+Users[\\/]+)[^"'<>`,;)}\]\r\n]+/gi
const USER_PATH_KEY = /(?:\/(?:Users|home)\/|[A-Z]:[\\/]+Users[\\/]+)/i

function redactValue(value: unknown, redactPaths: boolean): unknown {
  if (typeof value === 'string') {
    const safe = value.replace(PRIVATE_URL, '[REDACTED_URL]').replace(SECRET_VALUE, '[REDACTED_SECRET]')
    return redactPaths ? safe.replace(USER_PATH, '[REDACTED_PATH]') : safe
  }
  if (Array.isArray(value)) return value.map(item => redactValue(item, redactPaths))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const fieldKey = SECRET_KEY.test(key)
      const urlKey = PRIVATE_URL_KEY.test(key)
      const pathKey = USER_PATH_KEY.test(key)
      const secretKey = SECRET_PREFIX.test(key) || hasLongSecret(key)
      const outputKey = redactPaths && urlKey ? '[REDACTED_URL]' : redactPaths && pathKey ? '[REDACTED_PATH]' : redactPaths && secretKey ? '[REDACTED_SECRET]' : key
      out[outputKey] = fieldKey ? '[REDACTED]' : redactValue(item, redactPaths)
    }
    return out
  }
  return value
}

function hasLongSecret(value: string): boolean {
  if (SECRET_PREFIX.test(value) || PRIVATE_URL_VALUE.test(value)) return true
  // A path component is not a credential merely because it is long/high-entropy.
  if (USER_PATH_KEY.test(value)) return false
  const matches = value.match(/\b(?=[A-Za-z0-9+/]{32,}={0,2}\b)(?![a-f0-9]{64}\b)[A-Za-z0-9+/]{32,}={0,2}\b/g)
  return Boolean(matches?.length)
}

function hasSensitiveContractValue(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as { schemaVersion?: unknown; value?: unknown }
      if (parsed && parsed.schemaVersion === JSON_SCHEMA_VERSION && Object.hasOwn(parsed, 'value')) return hasSensitiveContractValue(parsed.value)
    } catch { /* ordinary string */ }
    return hasLongSecret(value)
  }
  if (Array.isArray(value)) return value.some(hasSensitiveContractValue)
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => SECRET_KEY.test(key) || PRIVATE_URL_KEY.test(key) || USER_PATH_KEY.test(key) && hasSensitiveContractValue(item) || hasSensitiveContractValue(item))
  }
  return false
}

/** Privacy sinks hide user paths; execution contracts must retain their exact local paths. */
export function redact(value: unknown): unknown { return redactValue(value, true) }

/** Contracts reject credentials/URLs rather than mutate them; local repo paths remain legal. */
export function hasSensitiveContractData(value: unknown): boolean {
  return hasSensitiveContractValue(value)
}

export function encodeJson(value: unknown, shouldRedact = true): string {
  return JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, value: shouldRedact ? redact(value) : value })
}

export function decodeJson<T = unknown>(raw: string): T {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || !('schemaVersion' in parsed) || !('value' in parsed)) {
    throw new Error('Invalid JSON schema wrapper')
  }
  const version = (parsed as { schemaVersion: unknown }).schemaVersion
  if (version !== JSON_SCHEMA_VERSION) throw new Error(`Unsupported JSON schema version: ${String(version)}`)
  return (parsed as { value: T }).value
}
