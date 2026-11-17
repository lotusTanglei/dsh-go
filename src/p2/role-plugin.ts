import { createRequire } from 'node:module'
import type { ParameterSchema, ToolDescriptor } from '../tools/descriptor.js'

export interface RoleToolsContext {
  readonly tools: {
    register(tool: unknown): unknown
  }
}

export interface ToolHandlerMap {
  readonly [name: string]: ((args: unknown) => unknown | Promise<unknown>) | undefined
}

function installDir(): string {
  return process.env.DSH_INSTALL_DIR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'
}

function toDsl(schema: ParameterSchema, required: boolean): Record<string, unknown> {
  const output: Record<string, unknown> = { type: schema.type ?? 'string' }
  if (required) output.required = true
  if (schema.description) output.description = schema.description
  if (schema.enum) output.enum = schema.enum
  if (schema.type === 'array' && schema.items) output.items = toDsl(schema.items, false)
  if (schema.type === 'object') {
    const properties = schema.properties ?? {}
    const requiredNames = new Set(schema.required ?? [])
    output.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toDsl(value, requiredNames.has(key))]))
    output.additionalProperties = schema.additionalProperties === false ? false : true
  }
  return output
}

function descriptorParameters(schema: ParameterSchema): Record<string, unknown> {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toDsl(value, required.has(key))]))
}

/** Mount descriptors through DSH's defineTool/register contract in the current preset scope. */
export function registerRoleTools(context: RoleToolsContext, descriptors: readonly ToolDescriptor[], handlers: ToolHandlerMap = {}): () => void {
  const installed = createRequire(`${installDir()}/package.json`)
  const { defineTool } = installed('@deepseek-ai/dsh-tools') as { defineTool(input: Record<string, unknown>): unknown }
  const disposers: Array<() => void> = []
  for (const descriptor of descriptors) {
    const registration = context.tools.register(defineTool({
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptorParameters(descriptor.parameters),
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean', required: true }, code: { type: 'string', required: true } }, additionalProperties: false },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args: unknown) {
        const handler = handlers[descriptor.name]
        if (!handler) return { ok: false, code: 'SA_P2_ENGINE_UNWIRED' }
        return handler(args)
      },
    }))
    if (typeof registration === 'function') disposers.push(registration as () => void)
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
