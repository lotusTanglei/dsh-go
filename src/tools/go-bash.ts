/**
 * The `go_bash` Worker tool descriptor and execution adapter.
 *
 * Unlike the Host `bash` tool, every invocation is executed by
 * {@link IsolatedShell}: a new process group under the macOS Seatbelt profile,
 * with credentials filtered out of the environment. The tool is deliberately
 * narrow — one command string, no workdir override, no environment override.
 *
 * @module dsh-go/tools/go-bash
 */
import { IsolatedShell, GO_BASH_CODES, type IsolatedCommandResult } from '../isolation/shell.js'
import { NETWORK_POLICY } from '../isolation/seatbelt.js'
import { objectSchema, validateParameters, invalidParameters, type ParameterSchema, type ParameterValidation, type ToolDescriptor } from './descriptor.js'

/** Accepted parameters: exactly one bounded command string. */
export interface GoBashParams {
  readonly command: string
}

export type GoBashToolName = 'go_bash'

/** A model-authored command is one shell line, not an uploaded script. */
export const MAX_GO_BASH_COMMAND_BYTES = 100_000

const goBashParameters: Readonly<Record<string, ParameterSchema>> = {
  command: { type: 'string', description: 'One shell command. Runs in the Ticket working copy under the Go isolation boundary; output is bounded; network is not restricted.' },
}

export const goBashDescriptor: ToolDescriptor<GoBashToolName> = {
  name: 'go_bash',
  description: 'Execute one shell command inside the Ticket working copy. Writes are confined to the Ticket directory by the OS sandbox; the process group is killed on completion, timeout or stop. Network access is NOT restricted. `bash`, `job_*` and other Host execution tools are unavailable to a Worker.',
  parameters: objectSchema(goBashParameters, ['command']),
}

/** Validate the exact model-supplied parameters; unknown keys are rejected. */
export function validateGoBashParams(input: unknown): ParameterValidation<GoBashParams> {
  const validated = validateParameters<GoBashParams>(goBashDescriptor, input)
  if (!validated.ok) return validated
  const command = validated.value.command
  if (typeof command !== 'string' || !command.trim()) return invalidParameters('$.command', 'Command must be a non-empty string.')
  if (command.includes('\0')) return invalidParameters('$.command', 'Command must not contain NUL bytes.')
  if (Buffer.byteLength(command, 'utf8') > MAX_GO_BASH_COMMAND_BYTES) return invalidParameters('$.command', 'Command is longer than the permitted bound.')
  return validated
}

/** Stable, model-facing explanation for each failure code. */
export function goBashFailureMessage(code: string): string {
  switch (code) {
    case GO_BASH_CODES.denied: return 'The OS sandbox denied a write outside the Ticket working copy.'
    case GO_BASH_CODES.timeout: return 'The command exceeded its time budget and its process group was killed.'
    case GO_BASH_CODES.aborted: return 'The command was cancelled and its process group was killed.'
    case GO_BASH_CODES.outputLimit: return 'The command exceeded the output bound and its process group was killed.'
    case GO_BASH_CODES.unavailable: return 'The macOS sandbox runner is unavailable; the command did not run.'
    case GO_BASH_CODES.workdir: return 'The Ticket working copy is not a valid isolation directory; the command did not run.'
    case GO_BASH_CODES.invalid: return 'The command parameters are invalid; the command did not run.'
    case GO_BASH_CODES.exit: return 'The command exited non-zero inside the Ticket working copy.'
    default: return 'The command did not complete normally.'
  }
}

/** Model-facing result object; bounded and free of Host environment values. */
export interface GoBashResult {
  readonly ok: boolean
  readonly code: string
  readonly message: string
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly denied: boolean
  readonly timedOut: boolean
  readonly outputTruncated: boolean
  readonly durationMs: number
  readonly networkPolicy: typeof NETWORK_POLICY
}

/** Convert one confined run into the tool result shape. */
export function toGoBashResult(result: IsolatedCommandResult): GoBashResult {
  return {
    ok: result.ok,
    code: result.code,
    message: result.ok ? 'Command exited 0 inside the Ticket working copy.' : goBashFailureMessage(result.code),
    exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    denied: result.denied, timedOut: result.timedOut, outputTruncated: result.outputTruncated,
    durationMs: result.durationMs, networkPolicy: NETWORK_POLICY,
  }
}

/**
 * Execute one validated go_bash call. Identity/lifecycle/boundary checks belong
 * to the runtime and the role guard; this adapter owns the OS execution only.
 */
export async function executeGoBash(input: {
  readonly command: string
  readonly ticketDir: string
  readonly ticketKey: string
  readonly shell: IsolatedShell
  readonly signal?: AbortSignal
}): Promise<GoBashResult> {
  const validated = validateGoBashParams({ command: input.command })
  if (!validated.ok) return { ok: false, code: GO_BASH_CODES.invalid, message: goBashFailureMessage(GO_BASH_CODES.invalid), exitCode: null, stdout: '', stderr: '', denied: false, timedOut: false, outputTruncated: false, durationMs: 0, networkPolicy: NETWORK_POLICY }
  return toGoBashResult(await input.shell.run({ ticketDir: input.ticketDir, ticketKey: input.ticketKey, command: validated.value.command, ...(input.signal ? { signal: input.signal } : {}) }))
}
