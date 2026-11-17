import type { TicketBrief, TicketState } from '../domain/ticket.js'
import { invalidParameters, nonemptyString, objectSchema, stringArray, validateParameters } from './descriptor.js'
import type { ParameterSchema, ParameterValidation, ToolDescriptor } from './descriptor.js'

export interface RouterToolParams {
  readonly ticket_create: { readonly brief: TicketBrief }
  readonly ticket_list: { readonly state?: TicketState; readonly threadKey?: string; readonly limit?: number }
  readonly ticket_status: { readonly ticketId: string }
  readonly ticket_cancel: { readonly ticketId: string; readonly reason: string }
  readonly ticket_resume: { readonly ticketId: string }
  readonly assignment_start: { readonly ticketId: string }
  readonly assignment_stop: { readonly assignmentId: string; readonly reason: string }
  readonly human_ask: { readonly question: string; readonly ticketId?: string }
  readonly channel_reply: { readonly threadKey: string; readonly body: string }
}
export type RouterToolName = keyof RouterToolParams

export const ticketBriefSchema: ParameterSchema = objectSchema({
  goal: nonemptyString,
  scope: objectSchema({ repo: nonemptyString, subdirs: stringArray }),
  base: objectSchema({ ref: nonemptyString, requireCleanTree: { type: 'boolean' } }),
  allowWrite: { ...stringArray, description: 'Path glob allowlist; unlisted paths remain forbidden.' },
  denyWrite: stringArray,
  runtime: nonemptyString,
  acceptance: {
    type: 'array',
    items: objectSchema({ id: nonemptyString, check: nonemptyString, kind: { type: 'string', enum: ['command', 'assertion'] } }),
  },
  outOfScope: stringArray,
  blockers: stringArray,
  firstAction: nonemptyString,
  approvalsRequired: stringArray,
})

/** Structural descriptors only. Host registration, engine commands and authorization are separate. */
export const routerToolDescriptors = [
  { name: 'ticket_create', description: 'Propose a Ticket from a complete structured brief.', parameters: objectSchema({ brief: ticketBriefSchema }) },
  { name: 'ticket_list', description: 'List Tickets, optionally filtered by state or thread.', parameters: objectSchema({ state: { type: 'string', enum: ['open', 'running', 'waiting_human', 'ended'] }, threadKey: nonemptyString, limit: { type: 'integer' } }, []) },
  { name: 'ticket_status', description: 'Read the status of one Ticket.', parameters: objectSchema({ ticketId: nonemptyString }) },
  { name: 'ticket_cancel', description: 'Request cancellation of a Ticket with a reason.', parameters: objectSchema({ ticketId: nonemptyString, reason: nonemptyString }) },
  { name: 'ticket_resume', description: 'Request resumption of an ended Ticket; human trust and Mandate checks remain required.', parameters: objectSchema({ ticketId: nonemptyString }) },
  { name: 'assignment_start', description: 'Request a new Assignment for an open Ticket.', parameters: objectSchema({ ticketId: nonemptyString }) },
  { name: 'assignment_stop', description: 'Request stopping an Assignment with a reason.', parameters: objectSchema({ assignmentId: nonemptyString, reason: nonemptyString }) },
  { name: 'human_ask', description: 'Ask the human a question, optionally about a Ticket.', parameters: objectSchema({ question: nonemptyString, ticketId: nonemptyString }, ['question']) },
  { name: 'channel_reply', description: 'Reply through the thread\'s Channel; outbound policy and approval checks remain required.', parameters: objectSchema({ threadKey: nonemptyString, body: nonemptyString }) },
] as const satisfies readonly ToolDescriptor<RouterToolName>[]

export const routerToolNames: readonly RouterToolName[] = Object.freeze(routerToolDescriptors.map(tool => tool.name))

/** Strict shape validation only; does not create, resume, dispatch or send anything. */
export function validateRouterToolParams<Name extends RouterToolName>(name: Name, input: unknown): ParameterValidation<RouterToolParams[Name]> {
  const descriptor = routerToolDescriptors.find(tool => tool.name === name)
  if (!descriptor) return invalidParameters('$.name', 'Unknown Router tool.')
  const result = validateParameters<RouterToolParams[Name]>(descriptor, input)
  if (result.ok && name === 'ticket_create') {
    const { acceptance } = (result.value as RouterToolParams['ticket_create']).brief
    if (new Set(acceptance.map(criterion => criterion.id)).size !== acceptance.length) {
      return invalidParameters('$.brief.acceptance', 'Acceptance criterion ids must be unique.')
    }
  }
  return result
}
