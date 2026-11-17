import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, m001, type Store } from '../../src/store/index.js'

const dirs: string[] = []
function makeStore(extra: Partial<Parameters<typeof openStore>[0]> = {}): Store {
  const dir = mkdtempSync(join(tmpdir(), 'p1-store-')); dirs.push(dir)
  return openStore({ dbPath: join(dir, 'state.sqlite'), ...extra })
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('SQLite persistence migration', () => {
  it('creates exact 16 user tables and documented indexes', () => {
    const s = makeStore()
    const tables = (s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
    expect(tables).toHaveLength(16)
    expect(tables).toEqual(['approval','assignment','audit','decision','eval','kv','outbound','schema_migrations','side_effect','source_instance','thread','thread_subscription','thread_trigger','ticket','trigger','trigger_disposition'])
    const indexes = (s.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
    expect(indexes).toEqual(['idx_approval_state','idx_assignment_state','idx_audit_at','idx_outbound_due','idx_ticket_state','idx_ticket_thread','idx_trigger_thread'])
    expect(s.migrateVersion).toBe(1); s.close()
  })

  it('rejects a future schema version without mutating it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-future-')); dirs.push(dir); const p = join(dir, 'future.sqlite')
    const first = openStore({ dbPath: p }); first.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)').run(99, 1); first.close()
    expect(() => openStore({ dbPath: p })).toThrow(/newer than supported/)
    expect(existsSync(`${p}.lock`)).toBe(false)
  })

  it('rolls back failed migration and creates checkpointed backup before applying', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-fail-')); dirs.push(dir); const p = join(dir, 'state.sqlite')
    const first = openStore({ dbPath: p }); first.close()
    expect(existsSync(`${p}.bak.1`)).toBe(true)
    const bad = { version: 2, up: (db: any) => { db.exec('CREATE TABLE transient(x TEXT);'); throw new Error('migration failed') } }
    expect(() => openStore({ dbPath: p, migrations: [m001, bad] })).toThrow('migration failed')
    const check = openStore({ dbPath: p }); expect(check.db.prepare("SELECT name FROM sqlite_master WHERE name='transient'").get()).toBeUndefined(); check.close()
    expect(existsSync(`${p}.bak.2`)).toBe(true)
  })
})

describe('repositories and transaction boundaries', () => {
  it('binds parameters, wraps JSON with v1, redacts secrets, and state updates atomically', () => {
    const s = makeStore()
    s.repos.trigger.insert({ id: 't1', source: 's', external_id: 'e', thread_key: 'th', actor_id: 'a', actor_bot: false, text: 'hello', trust: 'human', addressed: 'none', at: 1, raw: { token: 'secret-value', url: 'https://service.internal/api' } })
    const trigger = s.repos.trigger.get('t1') as Record<string, unknown>
    expect((trigger.raw as Record<string, unknown>).token).toBe('[REDACTED]')
    expect((trigger.raw as Record<string, unknown>).url).toBe('[REDACTED_URL]')
    const hash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    s.repos.eval.insert({ id: 'e1', thread_key: 'th', policy_version: hash, trigger_ids: ['t1'], started_at: 1, deadline: 2, state: 'running', requeues: 0 })
    expect((s.repos.eval.get('e1') as Record<string, unknown>).policy_version).toBe(hash)
    s.repos.ticket.insert({ id: 'ticket-1', thread_key: 'th', decision_id: 'd1', title: 'Goal', state: 'open', mandate_json: { scope: 'repo:x', rules: ['r'] }, brief_json: { goal: 'ship', scope: { repo: 'repo/x', subdirs: ['src'] }, base: { ref: 'main', requireCleanTree: true }, allowWrite: ['src/**'], denyWrite: ['.env'], runtime: 'node', acceptance: [{ id: 'A1', check: 'npm test', kind: 'command' }], outOfScope: [], blockers: ['unknown'], firstAction: 'inspect', approvalsRequired: [] }, workdir: '/Users/example/project', created_at: 1, updated_at: 1 })
    const ticket = s.repos.ticket.get('ticket-1') as Record<string, unknown>
    expect(ticket.brief_json).toEqual({ goal: 'ship', scope: { repo: 'repo/x', subdirs: ['src'] }, base: { ref: 'main', requireCleanTree: true }, allowWrite: ['src/**'], denyWrite: ['.env'], runtime: 'node', acceptance: [{ id: 'A1', check: 'npm test', kind: 'command' }], outOfScope: [], blockers: ['unknown'], firstAction: 'inspect', approvalsRequired: [] })
    s.repos.assignment.insert({ id: 'a1', ticket_id: 'ticket-1', session_id: 'session', state: 'running', created_at: 1, last_progress_at: 1, report_json: { tokens: 1234, steps: 5, api_token: 'hide' } })
    expect((s.repos.assignment.get('a1') as Record<string, unknown>).report_json).toEqual({ tokens: 1234, steps: 5, api_token: '[REDACTED]' })
    expect(s.repos.eval.updateByState('e1', 'running', 'decided')).toBe(true)
    expect(s.repos.eval.updateByState('e1', 'running', 'expired')).toBe(false)
    expect(() => s.repos.eval.insert({ id: 'e2', thread_key: 'th', policy_version: 'p', trigger_ids: ['x'], started_at: 1, deadline: 2, state: 'running', requeues: 0, nope: 1 } as never)).toThrow(/Unknown columns/)
    expect(() => s.transaction(() => { s.repos.kv.insert({ k: 'rollback', v: { ok: true } }); throw new Error('rollback') })).toThrow('rollback')
    expect(s.repos.kv.get('rollback')).toBeUndefined()
    s.close()
  })

  it('enforces unique idempotency keys for outbound and side effects', () => {
    const s = makeStore()
    const outbound = { id: 'o1', ticket_id: null, thread_key: 'th', channel: 'x', kind: 'reply', body: 'b', idempotency_key: 'same', state: 'pending', attempts: 0, next_at: 1, last_error: null }
    s.repos.outbound.insert(outbound)
    expect(() => s.repos.outbound.insert({ ...outbound, id: 'o2' })).toThrow()
    s.repos.outbound.insertOrIgnore({ ...outbound, id: 'o3' }); expect(s.repos.outbound.get('o3')).toBeUndefined()
    s.repos.side_effect.insert({ key: 'approval:1', kind: 'approval', ticket_id: null, at: 1, state: 'claimed', detail: null })
    s.repos.side_effect.insertOrIgnore({ key: 'approval:1', kind: 'approval', ticket_id: null, at: 2, state: 'done', detail: null })
    expect((s.repos.side_effect.get('approval:1') as Record<string, unknown>).state).toBe('claimed')
    s.close()
  })
})

describe('single process lock', () => {
  it('rejects contention and recovers only an old dead owner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-lock-')); dirs.push(dir); const p = join(dir, 'state.sqlite'); const lock = `${p}.lock`
    const s = openStore({ dbPath: p }); expect(() => openStore({ dbPath: p })).toThrow(/locked/); s.close()
    writeFileSync(lock, JSON.stringify({ pid: 999999, startedAt: 1, nonce: 'dead' }))
    const recovered = openStore({ dbPath: p, now: () => 10_000, staleLockMs: 10 }); recovered.close()
  })
})
