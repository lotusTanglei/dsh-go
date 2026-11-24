import { createHash } from 'node:crypto'
import { encodeJson, type Store } from '../store/index.js'
import { WorkspaceError } from './commands.js'

export type ConfigMutationJSON = null | boolean | number | string | ConfigMutationJSON[] | { [key: string]: ConfigMutationJSON }
export type ConfigMutationKind = 'local-configure' | 'local-remove' | 'local-scan' | 'stage-save' | 'tencent-configure' | 'tencent-remove' | 'tencent-scan'
export interface ConfigMutationInput { epoch: string; requestId: string; kind: ConfigMutationKind; payload: ConfigMutationJSON }
export interface ConfigMutationMetadata {
  version: 1; epoch: string; requestId: string; kind: ConfigMutationKind; digest: string
  state: 'recorded' | 'settled' | 'rejected' | 'closed'; at: number; updatedAt: number; code?: string
}
export interface ConfigMutationReceipt { mutation: ConfigMutationMetadata; value?: ConfigMutationJSON }
export type ConfigMutationHandler = (commit: (value: ConfigMutationJSON) => void, checkpoint: () => void) => Promise<ConfigMutationJSON> | ConfigMutationJSON

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/, HASH = /^[a-f0-9]{64}$/, CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/
const KINDS = ['local-configure', 'local-remove', 'local-scan', 'stage-save', 'tencent-configure', 'tencent-remove', 'tencent-scan']
const LIMIT = 2 * 1024 * 1024
const fail = (code: string, status = 409): never => { throw new WorkspaceError(code, status) }
const plain = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
const validEpoch = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !value.includes('://')
const key = (requestId: string) => `config-mutation:v1:${requestId}`

/** Strict JSON, UTF-8 bounded, deep sorted object keys; never invokes accessors or toJSON. */
function canonicalJSON(value: unknown): string {
  const parts: string[] = [], seen = new Set<object>()
  let bytes = 0
  const emit = (part: string) => {
    bytes += Buffer.byteLength(part, 'utf8')
    if (bytes > LIMIT) return fail('config_mutation_invalid', 400)
    parts.push(part)
  }
  function visit(item: unknown, depth: number): void {
    if (depth > 64) return fail('config_mutation_invalid', 400)
    if (item === null || typeof item === 'string' || typeof item === 'boolean') { emit(JSON.stringify(item)); return }
    if (typeof item === 'number' && Number.isFinite(item)) { emit(JSON.stringify(item)); return }
    if (!item || typeof item !== 'object' || seen.has(item) || Object.getOwnPropertySymbols(item).length) return fail('config_mutation_invalid', 400)
    if (!Array.isArray(item) && !plain(item)) return fail('config_mutation_invalid', 400)
    seen.add(item)
    try {
      const names = Object.getOwnPropertyNames(item)
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || names.length !== item.length + 1) return fail('config_mutation_invalid', 400)
        emit('[')
        for (let index = 0; index < item.length; index++) {
          const field = Object.getOwnPropertyDescriptor(item, String(index))
          if (!field || !('value' in field) || !field.enumerable) return fail('config_mutation_invalid', 400)
          if (index) emit(',')
          visit(field.value, depth + 1)
        }
        emit(']')
      } else {
        if (names.length !== Object.keys(item).length) return fail('config_mutation_invalid', 400)
        emit('{')
        names.sort().forEach((name, index) => {
          if (['__proto__', 'prototype', 'constructor'].includes(name) || /[\u0000-\u001f]/.test(name)) return fail('config_mutation_invalid', 400)
          const field = Object.getOwnPropertyDescriptor(item, name)!
          if (!('value' in field) || !field.enumerable) return fail('config_mutation_invalid', 400)
          if (index) emit(',')
          emit(JSON.stringify(name)); emit(':'); visit(field.value, depth + 1)
        })
        emit('}')
      }
    } finally { seen.delete(item) }
  }
  visit(value, 0)
  return parts.join('')
}
function snapshot<T>(value: T): T { return JSON.parse(canonicalJSON(value)) as T }
function validateInput(raw: unknown): ConfigMutationInput {
  const input = snapshot(raw)
  if (!plain(input) || !only(input, ['epoch', 'requestId', 'kind', 'payload']) || !validEpoch(input.epoch)
    || typeof input.requestId !== 'string' || !UUID.test(input.requestId) || !KINDS.includes(input.kind) || !Object.hasOwn(input, 'payload')) return fail('config_mutation_invalid', 400)
  return input as ConfigMutationInput
}
export function configMutationDigest(raw: ConfigMutationInput): string {
  const input = validateInput(raw)
  return createHash('sha256').update(canonicalJSON([input.epoch, input.requestId, input.kind, input.payload]), 'utf8').digest('hex')
}
function receiptValid(value: unknown, requestId: string): value is ConfigMutationReceipt {
  if (!plain(value) || !only(value, ['mutation', 'value']) || !plain(value.mutation)) return false
  const m = value.mutation
  if (!only(m, ['version', 'epoch', 'requestId', 'kind', 'digest', 'state', 'at', 'updatedAt', 'code']) || m.version !== 1
    || !validEpoch(m.epoch) || m.requestId !== requestId || !UUID.test(requestId) || !KINDS.includes(m.kind)
    || typeof m.digest !== 'string' || !HASH.test(m.digest) || !Number.isSafeInteger(m.at) || m.at < 0
    || !Number.isSafeInteger(m.updatedAt) || m.updatedAt < m.at) return false
  if (m.state === 'settled') return Object.hasOwn(value, 'value') && !Object.hasOwn(m, 'code')
  if (Object.hasOwn(value, 'value')) return false
  if (m.state === 'recorded') return m.updatedAt === m.at && !Object.hasOwn(m, 'code')
  if (m.state === 'closed') return m.updatedAt === m.at && m.code === 'config_mutation_id_closed'
  return m.state === 'rejected' && typeof m.code === 'string' && CODE.test(m.code)
}

/** Caller owns safe payload/result DTOs and the core SQL transaction. No content filtering or replay. */
export function createConfigMutations(store: Store, ports: { requireEpoch(epoch: string): void }) {
  let tail = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>) => { const next = tail.then(fn); tail = next.then(() => {}, () => {}); return next }
  function read(requestId: string): { receipt: ConfigMutationReceipt; raw: string } | undefined {
    const row = store.db.prepare('SELECT v FROM kv WHERE k=?').get(key(requestId))
    if (!row) return undefined
    try {
      if (typeof row.v !== 'string') return fail('config_mutation_record_invalid', 503)
      const wrapper = snapshot(JSON.parse(row.v))
      if (!plain(wrapper) || !only(wrapper, ['schemaVersion', 'value']) || wrapper.schemaVersion !== 1 || !receiptValid(wrapper.value, requestId)) return fail('config_mutation_record_invalid', 503)
      return { receipt: wrapper.value, raw: row.v }
    } catch { return fail('config_mutation_record_invalid', 503) }
  }
  function match(input: ConfigMutationInput) {
    const prior = read(input.requestId)
    if (prior && (prior.receipt.mutation.epoch !== input.epoch || prior.receipt.mutation.kind !== input.kind || prior.receipt.mutation.digest !== configMutationDigest(input))) return fail('config_mutation_request_conflict')
    return prior
  }
  function insert(input: ConfigMutationInput, state: 'recorded' | 'closed') {
    const at = Date.now(), receipt: ConfigMutationReceipt = { mutation: { version: 1, epoch: input.epoch, requestId: input.requestId,
      kind: input.kind, digest: configMutationDigest(input), state, at, updatedAt: at,
      ...(state === 'closed' ? { code: 'config_mutation_id_closed' } : {}) } }
    store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run(key(input.requestId), encodeJson(receipt, false))
    return read(input.requestId)!
  }
  function update(prior: NonNullable<ReturnType<typeof read>>, next: ConfigMutationReceipt) {
    // Validate the complete persisted envelope before SQL; a near-limit result must not create an unreadable receipt.
    canonicalJSON({ schemaVersion: 1, value: next })
    const result = store.db.prepare('UPDATE kv SET v=? WHERE k=? AND v=?')
      .run(encodeJson(next, false), key(prior.receipt.mutation.requestId), prior.raw)
    if (Number(result.changes) !== 1) return fail('config_mutation_conflict')
  }
  return {
    async run(raw: ConfigMutationInput, handler: ConfigMutationHandler): Promise<ConfigMutationReceipt> {
      const input = validateInput(raw)
      if (typeof handler !== 'function') return fail('config_mutation_invalid', 400)
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const prior = match(input)
        if (prior) return snapshot(prior.receipt)
        const recorded = store.transaction(() => insert(input, 'recorded'))
        let active = true
        const checkpoint = () => {
          if (!active) return fail('config_mutation_commit_inactive')
          ports.requireEpoch(input.epoch)
        }
        const commit = (value: ConfigMutationJSON): void => {
          checkpoint()
          if (store.db.isTransaction !== true) return fail('config_mutation_commit_outside_transaction')
          const result = snapshot(value), current = match(input)
          if (!current || current.raw !== recorded.raw || current.receipt.mutation.state !== 'recorded') return fail('config_mutation_conflict')
          update(current, { mutation: { ...current.receipt.mutation, state: 'settled', updatedAt: Math.max(Date.now(), current.receipt.mutation.updatedAt) }, value: result })
        }
        let failed = false, error: unknown
        try {
          const returned = handler(commit, checkpoint)
          // Synchronous handlers expire immediately, not after an artificial await microtask gap.
          if (returned && typeof returned === 'object' && typeof (returned as Promise<ConfigMutationJSON>).then === 'function') await returned
        } catch (caught) { failed = true; error = caught }
        finally { active = false }
        // A callback must have finished its owning transaction before returning. Never expose uncommitted settled data.
        if (store.db.isTransaction !== false) return fail('config_mutation_transaction_open', 503)
        const current = match(input)
        if (!current) return fail('config_mutation_record_invalid', 503)
        if (current.receipt.mutation.state === 'settled') return snapshot(current.receipt)
        if (current.raw !== recorded.raw) return fail('config_mutation_conflict')
        if (failed) {
          const code = error instanceof WorkspaceError && CODE.test(error.code) ? error.code : 'config_mutation_failed'
          store.transaction(() => update(current, { mutation: { ...current.receipt.mutation, state: 'rejected',
            updatedAt: Math.max(Date.now(), current.receipt.mutation.updatedAt), code } }))
        }
        return snapshot(read(input.requestId)!.receipt)
      })
    },
    async status(raw: { epoch: string; requestId: string }): Promise<ConfigMutationReceipt> {
      const input = snapshot(raw)
      if (!plain(input) || !only(input, ['epoch', 'requestId']) || !validEpoch(input.epoch) || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) return fail('config_mutation_invalid', 400)
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const current = read(input.requestId)
        if (!current || current.receipt.mutation.epoch !== input.epoch) return fail('config_mutation_not_found', 404)
        return snapshot(current.receipt)
      })
    },
    async close(raw: ConfigMutationInput): Promise<ConfigMutationReceipt> {
      const input = validateInput(raw)
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        return store.transaction(() => snapshot((match(input) ?? insert(input, 'closed')).receipt))
      })
    },
  }
}
