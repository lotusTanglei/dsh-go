import { createHash, randomUUID } from 'node:crypto'
import type { Store } from '../store/index.js'

export type CommandIntent = 'message' | 'new-task' | 'ticket-input'
export interface WorkspaceCommand { epoch: string; requestId: string; intent: CommandIntent; text: string; ticketId?: string; recreateFrom?: string }
export interface CommandRecord {
  version: 1; requestId: string; epoch: string; intent: CommandIntent; digest: string; messageId: string
  threadKey: string; targetTicket?: string; originTicket?: string; stage: 'received' | 'queued' | 'claimed' | 'admitted' | 'processing' | 'published' | 'canceled' | 'rejected' | 'unknown'
  seq: number; at: number; updatedAt: number; durable: boolean; error?: string
}
export class WorkspaceError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}
export const commandError = (code: string, status = 409): never => { throw new WorkspaceError(code, status) }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function validateCommand(value: WorkspaceCommand): void {
  if (!value || !UUID.test(value.requestId) || typeof value.epoch !== 'string' || !value.epoch || !['message', 'new-task', 'ticket-input'].includes(value.intent)
    || typeof value.text !== 'string' || !value.text.trim() || Buffer.byteLength(value.text, 'utf8') > 16_384 || value.text.includes('\0')
    || (value.intent === 'ticket-input' ? typeof value.ticketId !== 'string' || !value.ticketId : value.ticketId !== undefined)
    || (value.recreateFrom !== undefined && (value.intent !== 'new-task' || typeof value.recreateFrom !== 'string' || !value.recreateFrom || value.recreateFrom.length > 200))) commandError('invalid_command', 400)
}
export function commandDigest(value: WorkspaceCommand): string {
  // Preserve exact Unicode/newlines. No lossy normalization or redacted replay copy.
  return createHash('sha256').update(JSON.stringify([value.epoch, value.intent, value.text, value.ticketId ?? null, ...(value.recreateFrom === undefined ? [] : [value.recreateFrom])])).digest('hex')
}
export function createCommandJournal(store: Store) {
  const key = (id: string) => `workspace-command:v1:${id}`
  const read = (id: string): CommandRecord | undefined => {
    const row = store.repos.side_effect.get(key(id))
    if (!row) return undefined
    const value = row.detail as CommandRecord
    if (row.kind !== 'workspace-command-v1' || value?.version !== 1 || value.requestId !== id) return commandError('command_record_invalid', 503)
    return value
  }
  const all = (): CommandRecord[] => (store.db.prepare("SELECT key FROM side_effect WHERE kind = ? ORDER BY at, key").all('workspace-command-v1') as { key: string }[]).map(row => read(row.key.slice('workspace-command:v1:'.length))!)
  return {
    read, all,
    byMessage(messageId: string) { return all().find(row => row.messageId === messageId) },
    receive(input: WorkspaceCommand, thread: string): CommandRecord {
      validateCommand(input)
      return store.transaction(() => {
        const existing = read(input.requestId), digest = commandDigest(input)
        if (existing) { if (existing.digest !== digest) return commandError('request_conflict'); return existing }
        const at = Date.now()
        const record: CommandRecord = { version: 1, requestId: input.requestId, epoch: input.epoch, intent: input.intent, digest,
          messageId: `workspace:${input.requestId}`, threadKey: thread, ...(input.ticketId ? { targetTicket: input.ticketId } : {}),
          ...(input.recreateFrom ? { originTicket: input.recreateFrom } : {}), stage: 'received', seq: 1, at, updatedAt: at, durable: false }
        store.repos.side_effect.insert({ key: key(input.requestId), kind: 'workspace-command-v1', ticket_id: input.ticketId ?? null, at, state: 'v1:1', detail: record })
        return record
      })
    },
    update(id: string, patch: Partial<Pick<CommandRecord, 'stage' | 'durable' | 'error'>>): CommandRecord {
      return store.transaction(() => {
        const current = read(id); if (!current) return commandError('command_not_found', 404)
        const next: CommandRecord = { ...current, ...patch, seq: current.seq + 1, updatedAt: Date.now() }
        if (!store.repos.side_effect.updateByState(key(id), `v1:${current.seq}`, `v1:${next.seq}`, { detail: next })) return commandError('command_conflict')
        return next
      })
    },
  }
}

export interface WorkspaceBinding { version: 1; epoch: string; sessionId: string; createdAt: number }
export function bindWorkspace(store: Store, sessionId: string): { current: WorkspaceBinding; archives: WorkspaceBinding[] } {
  return store.transaction(() => {
    const saved = store.repos.kv.get('workspace-bindings-v1')?.v as { current: WorkspaceBinding; archives: WorkspaceBinding[] } | undefined
    const valid = (row: WorkspaceBinding) => row && row.version === 1 && UUID.test(row.epoch) && typeof row.sessionId === 'string' && Boolean(row.sessionId) && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0
    if (saved && (!valid(saved.current) || !Array.isArray(saved.archives) || saved.archives.some(row => !valid(row)) || new Set([saved.current, ...saved.archives].map(row => row.epoch)).size !== saved.archives.length + 1 || new Set([saved.current, ...saved.archives].map(row => row.sessionId)).size !== saved.archives.length + 1)) return commandError('binding_invalid', 503)
    if (saved?.current.sessionId === sessionId) return saved
    const next = { current: { version: 1 as const, epoch: randomUUID(), sessionId, createdAt: Date.now() }, archives: [...(saved?.archives ?? []), ...(saved ? [saved.current] : [])] }
    store.repos.kv.insertOrIgnore({ k: 'workspace-bindings-v1', v: next })
    // Metadata only; no message body or duplicated chat history is stored here.
    if (saved) store.db.prepare('UPDATE kv SET v = ? WHERE k = ?').run(JSON.stringify({ schemaVersion: 1, value: next }), 'workspace-bindings-v1')
    return next
  })
}
