import type { ApprovalKind } from '../domain/approval.js'
import type { TicketBrief } from '../domain/ticket.js'
import type { Report } from '../engine/report.js'
import { invalidParameters, nonemptyString, objectSchema, stringArray, validateParameters } from './descriptor.js'
import type { ParameterSchema, ParameterValidation, ToolDescriptor } from './descriptor.js'

export interface WorkerToolParams {
  readonly report_progress: Pick<Report, 'state' | 'done' | 'todo' | 'changedPaths' | 'risks' | 'needHuman'> & { readonly acceptance?: Report['acceptance'] }
  readonly report_result: Report
  readonly request_approval: { readonly kind: ApprovalKind; readonly summary: string; readonly payload: Record<string, unknown> }
  readonly ask_router: { readonly question: string }
}
export type WorkerToolName = keyof WorkerToolParams

const reportFields: Readonly<Record<string, ParameterSchema>> = {
  state: { type: 'string', enum: ['progress', 'ready', 'blocked', 'failed'] },
  done: stringArray,
  todo: stringArray,
  changedPaths: stringArray,
  acceptance: { type: 'array', items: objectSchema({ id: nonemptyString, result: { type: 'string', enum: ['passed', 'failed', 'not-run'] }, evidence: nonemptyString }) },
  risks: stringArray,
  needHuman: stringArray,
}

export const workerToolDescriptors = [
  { name: 'report_progress', description: 'Report bounded progress against the supplied TicketBrief.', parameters: objectSchema(reportFields, ['state', 'done', 'todo', 'changedPaths', 'risks', 'needHuman']) },
  { name: 'report_result', description: 'Return the final structured report for the supplied TicketBrief.', parameters: objectSchema(reportFields) },
  { name: 'request_approval', description: 'Request one human approval for a declared action.', parameters: objectSchema({ kind: { type: 'string', enum: ['merge-pr', 'send-external', 'delete-branch', 'close-pr', 'payment', 'permission'] }, summary: nonemptyString, payload: { type: 'object', additionalProperties: {} } }) },
  { name: 'ask_router', description: 'Ask Router for clarification without contacting a channel.', parameters: objectSchema({ question: nonemptyString }) },
] as const satisfies readonly ToolDescriptor<WorkerToolName>[]

export const workerToolNames: readonly WorkerToolName[] = Object.freeze(workerToolDescriptors.map(tool => tool.name))

export function validateWorkerToolParams<Name extends WorkerToolName>(name: Name, input: unknown): ParameterValidation<WorkerToolParams[Name]> {
  const descriptor = workerToolDescriptors.find(tool => tool.name === name)
  if (!descriptor) return invalidParameters('$.name', 'Unknown Worker tool.')
  return validateParameters<WorkerToolParams[Name]>(descriptor, input)
}

export type WorkerBriefContext = Pick<TicketBrief, 'acceptance'>
