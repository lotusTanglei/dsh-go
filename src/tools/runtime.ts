import { createRequire } from 'node:module'
import { guardToolCall, type RoleToolAllowlist, type ToolGuardInput, type WorkerBinding } from './guard.js'
import type { Assignment } from '../domain/assignment.js'
import type { Ticket } from '../domain/ticket.js'

export interface RuntimeRoleConfig {
  readonly roleTools: RoleToolAllowlist
  readonly routerPreset?: string
  readonly workerPreset?: string
  readonly watchdogPreset?: string
}

export interface ToolExecutionContext {
  readonly agent?: object & { readonly ctx?: unknown }
  readonly name: string
}

export interface ToolGuardContext {
  readonly tools: {
    guard?(callback: (execution: ToolExecutionContext) => unknown): unknown
  }
  readonly agentPresets?: { composedPreset(ctx: unknown): string | undefined }
}

export interface WorkerGuardSnapshot {
  readonly sessionId: string
  readonly binding: WorkerBinding
  readonly ticket: Pick<Ticket, 'id' | 'state' | 'currentAssignment'>
  readonly assignment: Pick<Assignment, 'id' | 'ticketId' | 'sessionId' | 'state'>
}

export interface RoleGuardRuntime {
  bindWorker(agent: object, snapshot: WorkerGuardSnapshot): void
  unbindWorker(agent: object): void
  dispose(): void
}

/** Install the final deny-only guard for exact Super-agent preset identities. */
export function installRoleGuard(context: ToolGuardContext, config: RuntimeRoleConfig): RoleGuardRuntime | undefined {
  if (!context.tools.guard || !context.agentPresets) return undefined
  const bindings = new WeakMap<object, WorkerGuardSnapshot>()
  const guardDisposer = context.tools.guard(execution => {
    const composedPreset = execution.agent?.ctx ? context.agentPresets!.composedPreset(execution.agent.ctx) : undefined
    const snapshot = execution.agent ? bindings.get(execution.agent) : undefined
    const input: ToolGuardInput = {
      composedPreset,
      toolName: execution.name,
      roleTools: config.roleTools,
      ...(snapshot ?? {}),
    }
    return guardToolCall(input)
  })
  return {
    bindWorker(agent, snapshot) { bindings.set(agent, snapshot) },
    unbindWorker(agent) { bindings.delete(agent) },
    dispose() { if (typeof guardDisposer === 'function') (guardDisposer as () => void)() },
  }
}

function installDirFromEnvironment(): string {
  return process.env.DSH_INSTALL_DIR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'
}

function toToolSpec(schema: Record<string, unknown>, required: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type }
  if (required) result.required = true
  if (schema.description) result.description = schema.description
  if (schema.enum) result.enum = schema.enum
  if (schema.type === 'array' && schema.items && typeof schema.items === 'object') result.items = toToolSpec(schema.items as Record<string, unknown>, false)
  if (schema.type === 'object') {
    const properties = (schema.properties && typeof schema.properties === 'object') ? schema.properties as Record<string, Record<string, unknown>> : {}
    const requiredNames = new Set(Array.isArray(schema.required) ? schema.required : [])
    result.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toToolSpec(value, requiredNames.has(key))]))
    result.additionalProperties = schema.additionalProperties === false ? false : true
  }
  return result
}

/** Register descriptor placeholders inside a mounted role scope; engine handlers are P3-owned. */
export function registerRoleToolDescriptors(context: ToolGuardContext & { tools: ToolGuardContext['tools'] & { register(tool: unknown): unknown } }, descriptors: readonly { name: string; description: string; parameters: Record<string, unknown> }[]): () => void {
  const installed = createRequire(`${installDirFromEnvironment()}/package.json`)
  const { defineTool } = installed('@deepseek-ai/dsh-tools') as { defineTool(input: Record<string, unknown>): unknown }
  const disposers: Array<() => void> = []
  for (const descriptor of descriptors) {
    const properties = descriptor.parameters.properties && typeof descriptor.parameters.properties === 'object' ? descriptor.parameters.properties as Record<string, Record<string, unknown>> : {}
    const required = new Set(Array.isArray(descriptor.parameters.required) ? descriptor.parameters.required : [])
    const registration = context.tools.register(defineTool({
      name: descriptor.name,
      description: descriptor.description,
      parameters: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toToolSpec(value, required.has(key))])),
      output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, code: { type: 'string' } }, required: ['ok', 'code'], additionalProperties: false }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => ({ ok: false, code: 'SA_P2_ENGINE_UNWIRED' }),
    }))
    if (typeof registration === 'function') disposers.push(registration as () => void)
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
