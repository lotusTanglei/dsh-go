/** Framework-neutral JSON-schema subset used by the P2 descriptors; no registration or execution. */
export interface ParameterSchema {
  readonly type?: 'object' | 'array' | 'string' | 'boolean' | 'integer'
  readonly description?: string
  readonly properties?: Readonly<Record<string, ParameterSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: false | ParameterSchema
  readonly items?: ParameterSchema
  readonly enum?: readonly string[]
}

export interface ToolDescriptor<Name extends string = string> {
  readonly name: Name
  readonly description: string
  readonly parameters: ParameterSchema
}

export interface ParameterIssue {
  readonly path: string
  readonly message: string
}
export type ParameterValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'SA_TOOL_PARAMETERS_INVALID'; readonly issues: readonly ParameterIssue[] }

export function invalidParameters(path: string, message: string): ParameterValidation<never> {
  return { ok: false, code: 'SA_TOOL_PARAMETERS_INVALID', issues: [{ path, message }] }
}

export function objectSchema(properties: Readonly<Record<string, ParameterSchema>>, required: readonly string[] = Object.keys(properties)): ParameterSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}
export const nonemptyString: ParameterSchema = { type: 'string' }
export const stringArray: ParameterSchema = { type: 'array', items: { type: 'string' } }

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Reject non-JSON data, sparse arrays and cycles before schema checking. */
function isJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!Array.isArray(value) && !isObject(value)) return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && Array.from(value).every(item => isJson(item, seen))
    : Object.values(value).every(item => isJson(item, seen))
  seen.delete(value)
  return valid
}

function check(schema: ParameterSchema, value: unknown, path: string, issues: ParameterIssue[]): void {
  const issue = (message: string) => { issues.push({ path, message }) }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return issue('Expected a string.')
    if (schema.enum && !schema.enum.includes(value)) issue(`Expected one of: ${schema.enum.join(', ')}.`)
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') issue('Expected a boolean.')
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return issue('Expected a safe integer.')
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return issue('Expected an array.')
    if (schema.items) value.forEach((item, index) => check(schema.items!, item, `${path}[${index}]`, issues))
  } else if (schema.type === 'object') {
    if (!isObject(value)) return issue('Expected a plain object.')
    const properties = schema.properties ?? {}
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) issues.push({ path: `${path}.${key}`, message: 'Required parameter is missing.' })
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) check(properties[key]!, item, `${path}.${key}`, issues)
      else if (schema.additionalProperties === false) issues.push({ path: `${path}.${key}`, message: 'Unknown parameter.' })
      else if (schema.additionalProperties) check(schema.additionalProperties, item, `${path}.${key}`, issues)
    }
  }
}

/** Return an immutable copy, so later caller mutation cannot change validated parameters. */
function copyJson<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(item => copyJson(item))) as T
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item)]))) as T
  }
  return value
}

export function validateParameters<T>(descriptor: ToolDescriptor, input: unknown): ParameterValidation<T> {
  if (!isJson(input)) return invalidParameters('$', 'Expected finite, acyclic JSON data.')
  const issues: ParameterIssue[] = []
  check(descriptor.parameters, input, '$', issues)
  return issues.length ? { ok: false, code: 'SA_TOOL_PARAMETERS_INVALID', issues } : { ok: true, value: copyJson(input) as T }
}
