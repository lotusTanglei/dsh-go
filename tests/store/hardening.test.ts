import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { openStore, m001, decodeJson, encodeJson, redact } from '../../src/store/index.js'

function temporary<T>(fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-hardening-'))
  try { return fn(join(dir, 'store.sqlite')) } finally {
    if (!dir.startsWith(join(tmpdir(), 'superagent-hardening-'))) throw new Error('unexpected temporary directory')
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('P1 persistence regression proofs', () => {
  it('deduplicates 3 actual inserts and does not mask malformed input as a duplicate', () => temporary(path => {
    const s = openStore({ dbPath: path })
    try {
      const row = { id: 't', source: 's', external_id: 'e', thread_key: 'th', actor_id: 'u', actor_bot: 0, text: 'hello', trust: 'human', addressed: 'direct', at: 1 }
      for (let i = 0; i < 3; i++) s.repos.trigger.insertOrIgnore(row)
      expect(s.repos.trigger.all()).toHaveLength(1)
      expect(() => s.repos.trigger.insertOrIgnore({ id: 'broken' })).toThrow()
    } finally { s.close() }
  }))
  it('keeps schema-versioned JSON strict and preserves hash/cost fields under redaction', () => {
    expect(() => decodeJson('{}')).toThrow('schema')
    expect(() => decodeJson('{"schemaVersion":2,"value":{}}')).toThrow('version')
    const hash = 'a'.repeat(64)
    expect(decodeJson(encodeJson({ policyVersion: hash, tokens: 100, token: 'fake' }))).toEqual({ policyVersion: hash, tokens: 100, token: '[REDACTED]' })
    const sample = ['sk' + '-DUMMYsecret123', 'ghp' + '_DUMMYsecret123', 'Bearer ' + 'DUMMYcredential', 'https://' + 'service.internal/api']
    for (const value of sample) expect(redact(value)).not.toBe(value)
  })
  it('rejects sensitive contract data instead of silently corrupting persisted briefs', () => temporary(path => {
    const s = openStore({ dbPath: path })
    try {
      const row = { id: 'sensitive', thread_key: 'th', decision_id: 'd', title: 'test', state: 'open', mandate_json: {}, brief_json: { goal: 'ok', token: 'dummy-value' }, workdir: '/tmp/work', created_at: 1, updated_at: 1 }
      expect(() => s.repos.ticket.insert(row)).toThrow('Sensitive value')
      expect(s.repos.ticket.get('sensitive')).toBeUndefined()
    } finally { s.close() }
  }))
  it('uses bound parameters for hostile ids and refuses changing a primary key', () => temporary(path => {
    const s = openStore({ dbPath: path })
    try {
      const id = "id'); DROP TABLE eval; --"
      s.repos.eval.insert({ id, thread_key: 'th', policy_version: 'p', trigger_ids: [], started_at: 1, deadline: 2, state: 'running' })
      expect(s.repos.eval.get(id)?.id).toBe(id)
      expect(() => s.repos.eval.updateByState(id, 'running', 'decided', { id: 'new' })).toThrow('immutable')
      expect(s.repos.eval.updateByState(id, 'running', 'decided')).toBe(true)
      expect(s.repos.eval.get(id)?.state).toBe('decided')
    } finally { s.close() }
  }))
  it('rejects async transactions and rolls back writes before callback returns', () => temporary(path => {
    const s = openStore({ dbPath: path })
    try {
      expect(() => s.transaction(async () => { s.repos.kv.insert({ k: 'not-committed', v: {} }) })).toThrow('synchronous')
      expect(s.repos.kv.get('not-committed')).toBeUndefined()
    } finally { s.close() }
  }))
  it('preserves a failed-migration backup and verifies old data after retries', () => temporary(path => {
    const s = openStore({ dbPath: path }); s.repos.kv.insert({ k: 'keep', v: { keep: true } }); s.close()
    const bad = { version: 2, up(db: DatabaseSync) { db.exec('CREATE TABLE failing (id TEXT)'); throw new Error('planned failure') } }
    expect(() => openStore({ dbPath: path, migrations: [m001, bad] })).toThrow('planned failure')
    const backup = readFileSync(`${path}.bak.2`)
    expect(() => openStore({ dbPath: path, migrations: [m001, bad] })).toThrow('planned failure')
    expect(readFileSync(`${path}.bak.2`)).toEqual(backup)
    const backupDb = new DatabaseSync(`${path}.bak.2`, { readOnly: true })
    expect(backupDb.prepare('SELECT k FROM kv').get()?.k).toBe('keep'); backupDb.close()
    const check = openStore({ dbPath: path }); expect(check.repos.kv.get('keep')?.v).toEqual({ keep: true }); check.close()
  }))
  it('rejects duplicate code migrations and gaps in applied migration history', () => temporary(path => {
    expect(() => openStore({ dbPath: path, migrations: [m001, m001] })).toThrow('contiguous')
    const s = openStore({ dbPath: path }); s.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(3, 1); s.close()
    const more = [{ version: 2, up() {} }, { version: 3, up() {} }]
    expect(() => openStore({ dbPath: path, migrations: [m001, ...more] })).toThrow('gap')
  }))
  it('releases the SQLite recovery mutex after process termination', () => temporary(path => {
    const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN EXCLUSIVE');process.kill(process.pid,'SIGKILL')`
    const killed = spawnSync(process.execPath, ['-e', script, `${path}.lock.recovery`])
    expect(killed.signal).toBe('SIGKILL')
    const s = openStore({ dbPath: path }); s.close()
    expect(existsSync(`${path}.lock`)).toBe(false)
  }))
  it('publishes a complete lock payload and reuses a stale recovery mutex safely', () => temporary(path => {
    const s = openStore({ dbPath: path })
    expect(JSON.parse(readFileSync(`${path}.lock`, 'utf8')).pid).toBe(process.pid)
    expect(() => openStore({ dbPath: path })).toThrow('locked')
    s.close()
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 999999, startedAt: 0, nonce: 'dead' }))
    const recovered = openStore({ dbPath: path, staleLockMs: 0 }); recovered.close()
    expect(existsSync(`${path}.lock`)).toBe(false)
    expect(existsSync(`${path}.lock.recovery`)).toBe(true)
  }))
})
