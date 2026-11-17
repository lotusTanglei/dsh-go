/** Nominal branded primitive helpers used throughout the pure domain model. */
export type Brand<T, K extends string> = T & { readonly __brand: K }

export type TriggerId = Brand<string, 'TriggerId'>
export type ThreadKey = Brand<string, 'ThreadKey'>
export type TicketId = Brand<string, 'TicketId'>
export type AssignmentId = Brand<string, 'AssignmentId'>
export type EvalId = Brand<string, 'EvalId'>
export type DecisionId = Brand<string, 'DecisionId'>
export type ApprovalId = Brand<string, 'ApprovalId'>
export type SourceId = Brand<string, 'SourceId'>

/** Brand a value at a boundary where it has already been validated. */
export function brand<T, K extends string>(value: T): Brand<T, K> {
  return value as Brand<T, K>
}

export const triggerId = (value: string): TriggerId => brand<string, 'TriggerId'>(value)
export const threadKey = (value: string): ThreadKey => brand<string, 'ThreadKey'>(value)
export const ticketId = (value: string): TicketId => brand<string, 'TicketId'>(value)
export const assignmentId = (value: string): AssignmentId => brand<string, 'AssignmentId'>(value)
export const evalId = (value: string): EvalId => brand<string, 'EvalId'>(value)
export const decisionId = (value: string): DecisionId => brand<string, 'DecisionId'>(value)
export const approvalId = (value: string): ApprovalId => brand<string, 'ApprovalId'>(value)
export const sourceId = (value: string): SourceId => brand<string, 'SourceId'>(value)

export function unbrand<T>(value: Brand<T, string>): T {
  return value as T
}
