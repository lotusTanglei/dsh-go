import type { DatabaseSync } from 'node:sqlite'
import { encodeJson, decodeJson, redact } from '../codec.js'

export interface Row { readonly [key: string]: unknown }
export interface TableRepo<T extends Row = Row> {
  insert(row: T): void
  insertOrIgnore(row: T): void
  get(key: unknown): T | undefined
  all(): T[]
  updateByState(key: unknown, expectedState: string, nextState: string, extra?: Partial<T>): boolean
}

export type TableName = 'source_instance' | 'trigger' | 'trigger_disposition' | 'thread' | 'thread_trigger' | 'eval' | 'decision' | 'ticket' | 'assignment' | 'thread_subscription' | 'approval' | 'outbound' | 'side_effect' | 'audit' | 'kv'
export type Repositories = { readonly [K in TableName]: TableRepo }
export const TABLE_DEFS: Record<string, { columns: readonly string[]; pk: readonly string[]; state?: string }> = {
  source_instance: { columns: ['id','kind','config','cursor','health','updated_at'], pk: ['id'] },
  trigger: { columns: ['id','source','external_id','thread_key','actor_id','actor_bot','text','trust','addressed','at','raw'], pk: ['id'] },
  trigger_disposition: { columns: ['trigger_id','at','filtered','eval_id','decision_id','ticket_id','delivered_to','requeued','acked_by'], pk: ['trigger_id'] },
  thread: { columns: ['key','source','ref_json','created_at','last_at','seq','paused','evaluating'], pk: ['key'] },
  thread_trigger: { columns: ['thread_key','trigger_id','seq','state'], pk: ['thread_key','trigger_id'], state: 'state' },
  eval: { columns: ['id','thread_key','policy_version','trigger_ids','started_at','deadline','state','requeues'], pk: ['id'], state: 'state' },
  decision: { columns: ['id','eval_id','thread_key','policy_version','kind','reason','strength','ticket_id','trigger_ids','at'], pk: ['id'] },
  ticket: { columns: ['id','thread_key','decision_id','title','state','mandate_json','brief_json','workdir','stopped_by_human','attention_json','current_assignment','created_at','updated_at','ended_at','ended_by','outcome'], pk: ['id'], state: 'state' },
  assignment: { columns: ['id','ticket_id','session_id','state','created_at','started_at','ended_at','ended_reason','last_progress_at','steps','tokens','retries','repeated_calls','report_json'], pk: ['id'], state: 'state' },
  thread_subscription: { columns: ['thread_key','ticket_id'], pk: ['thread_key','ticket_id'] },
  approval: { columns: ['id','ticket_id','kind','summary','payload_json','requested_by','created_at','state','decided_by','decided_at','reason'], pk: ['id'], state: 'state' },
  outbound: { columns: ['id','ticket_id','thread_key','channel','kind','body','idempotency_key','state','attempts','next_at','last_error'], pk: ['id'], state: 'state' },
  side_effect: { columns: ['key','kind','ticket_id','at','state','detail'], pk: ['key'], state: 'state' },
  audit: { columns: ['id','at','actor','action','ticket_id','thread_key','detail'], pk: ['id'] },
  kv: { columns: ['k','v'], pk: ['k'] },
}

const JSON_COLUMNS = new Set(['config','raw','ref_json','trigger_ids','mandate_json','brief_json','attention_json','report_json','payload_json','detail','v'])
const REDACT_JSON_COLUMNS = new Set(['config','raw','attention_json','report_json','payload_json','detail'])

function toDbValue(column: string, value: unknown): unknown {
  if (value === undefined) return null
  if (JSON_COLUMNS.has(column)) {
    if (value === null) return null
    // Contract data must roundtrip exactly; reject credentials/URLs rather than silently mutate it.
    if (!REDACT_JSON_COLUMNS.has(column) && JSON.stringify(redact(value)) !== JSON.stringify(value)) throw new Error('Sensitive value is not permitted in contract data')
    // Normalize an already wrapped value, reapplying redaction rather than bypassing it.
    if (typeof value === 'string') {
      try {
        const p = JSON.parse(value) as { schemaVersion?: unknown; value?: unknown }
        if (p && p.schemaVersion === 1 && Object.prototype.hasOwnProperty.call(p, 'value')) return encodeJson(p.value, REDACT_JSON_COLUMNS.has(column))
      } catch { /* encode below */ }
    }
    return encodeJson(value, REDACT_JSON_COLUMNS.has(column))
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && /^(text|body|title|reason|summary|last_error)$/.test(column)) {
    return redact(value)
  }
  return value
}

function fromDbValue(column: string, value: unknown): unknown {
  if (value === null || value === undefined || !JSON_COLUMNS.has(column) || typeof value !== 'string') return value
  return decodeJson(value)
}

function keyWhere(def: { pk: readonly string[] }, key: unknown): { sql: string; values: unknown[] } {
  const obj = typeof key === 'object' && key !== null ? key as Record<string, unknown> : { [def.pk[0]!]: key }
  for (const k of def.pk) if (!(k in obj)) throw new Error(`Missing key column ${k}`)
  return { sql: def.pk.map((k) => `${k} = ?`).join(' AND '), values: def.pk.map((k) => obj[k]) }
}

export function createRepo(db: DatabaseSync, table: string, def: { columns: readonly string[]; pk: readonly string[]; state?: string }): TableRepo {
  const stmt = (sql: string) => (db as unknown as { prepare(sql: string): any }).prepare(sql)
  const mapRow = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...row }
    for (const c of JSON_COLUMNS) if (c in out) out[c] = fromDbValue(c, out[c])
    return out
  }
  const encodeRow = (row: Row) => {
    const unknown = Object.keys(row).filter((c) => !def.columns.includes(c))
    if (unknown.length) throw new Error(`Unknown columns for ${table}: ${unknown.join(',')}`)
    const cols = def.columns.filter((c) => Object.prototype.hasOwnProperty.call(row, c))
    if (!cols.length) throw new Error(`No writable columns for ${table}`)
    return { cols, values: cols.map((c) => toDbValue(c, row[c])) }
  }
  return {
    insert(row) {
      const { cols, values } = encodeRow(row)
      stmt(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values)
    },
    insertOrIgnore(row) {
      const { cols, values } = encodeRow(row)
      stmt(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`).run(...values)
    },
    get(key) {
      const w = keyWhere(def, key)
      const row = stmt(`SELECT * FROM ${table} WHERE ${w.sql}`).get(...w.values) as Record<string, unknown> | undefined
      return row ? mapRow(row) : undefined
    },
    all() {
      return (stmt(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]).map(mapRow)
    },
    updateByState(key, expectedState, nextState, extra = {}) {
      if (!def.state) throw new Error(`${table} has no state column`)
      if (def.pk.some(key => Object.hasOwn(extra, key))) throw new Error('Primary keys are immutable')
      const update = { ...extra, [def.state]: nextState }
      const { cols, values } = encodeRow(update)
      const w = keyWhere(def, key)
      const result = stmt(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${w.sql} AND ${def.state} = ?`).run(...values, ...w.values, expectedState) as { changes?: number }
      return Number(result?.changes ?? 0) === 1
    },
  }
}

