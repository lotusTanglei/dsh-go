/** Clone a domain value and recursively freeze object graphs at the pure-domain boundary. */
export function snapshot<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()
  const clone = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input
    const existing = seen.get(input)
    if (existing) return existing
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null && !Array.isArray(input)) throw new Error('Domain snapshot requires plain JSON-like values')
    if (Array.isArray(input)) {
      const result: unknown[] = []
      seen.set(input, result)
      for (const item of input) result.push(clone(item))
      return Object.freeze(result)
    }
    const result: Record<string, unknown> = {}
    seen.set(input, result)
    for (const key of Object.keys(input)) result[key] = clone((input as Record<string, unknown>)[key])
    return Object.freeze(result)
  }
  return clone(value) as T
}
