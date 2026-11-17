export const JSON_SCHEMA_VERSION = 1 as const

const SECRET_KEY = /^(?:token|secret|password|passwd|api[_-]?(?:key|token)|authorization|credential|private[_-]?key|access[_-]?key|refresh[_-]?token|bearer[_-]?token)$/i
const PRIVATE_URL = /https?:\/\/[^\s"'<>]+/gi
const SECRET_VALUE = /(?:Bearer\s+)[A-Za-z0-9._~+\/-]+|(?:sk|ghp|github_pat)[_-][A-Za-z0-9_\-]+|\b(?=[A-Za-z0-9+/]{32,}={0,2}\b)(?![a-f0-9]{64}\b)[A-Za-z0-9+/]{32,}={0,2}\b/gi

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(PRIVATE_URL, '[REDACTED_URL]').replace(SECRET_VALUE, '[REDACTED_SECRET]')
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v)
    }
    return out
  }
  return value
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
