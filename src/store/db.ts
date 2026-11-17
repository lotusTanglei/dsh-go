import { DatabaseSync } from 'node:sqlite'
import { constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, closeSync, unlinkSync, writeFileSync, lstatSync, fstatSync, linkSync, fsyncSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { migrations as defaultMigrations, type Migration } from './migrations.js'
import { TABLE_DEFS, createRepo, type TableName, type TableRepo, type Repositories } from './repos/index.js'

export interface OpenStoreOptions {
  dbPath: string
  lockPath?: string
  now?: () => number
  migrations?: readonly Migration[]
  staleLockMs?: number
  busyTimeoutMs?: number
}

export interface Store {
  readonly db: DatabaseSync
  readonly repos: Repositories
  readonly version: number
  readonly migrateVersion: number
  transaction<T>(fn: (db: DatabaseSync) => T): T
  close(): void
}

interface LockHandle { fd: number; nonce: string }
function acquireLock(lockPath: string, now: () => number, staleLockMs: number): LockHandle {
  mkdirSync(dirname(lockPath), { recursive: true })
  // A persistent SQLite recovery mutex is released by the OS even on SIGKILL.
  // The published ownership lock itself is a fully-written atomic hard link.
  const mutex = new DatabaseSync(`${lockPath}.recovery`)
  let begun = false
  try {
    mutex.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
    begun = true
    if (existsSync(lockPath)) {
      const target = lstatSync(lockPath)
      if (!target.isFile() || target.isSymbolicLink()) throw new Error('Store lock is not a regular file')
      let info: { pid?: unknown; startedAt?: unknown; nonce?: unknown }
      try { info = JSON.parse(readFileSync(lockPath, 'utf8')) as typeof info } catch { throw new Error('Store lock exists and is invalid; manual recovery required') }
      const pid = typeof info.pid === 'number' && Number.isInteger(info.pid) ? info.pid : 0
      const age = typeof info.startedAt === 'number' ? now() - info.startedAt : -1
      let alive = true
      if (pid > 0) {
        try { process.kill(pid, 0) } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
      }
      if (pid <= 0 || alive || typeof info.nonce !== 'string' || age < staleLockMs) throw new Error(`Store is locked by pid ${pid || 'unknown'}`)
      // Serialized by recovery mutex; validated exact absolute lock path and dead owner above.
      unlinkSync(lockPath)
    }
    const nonce = randomUUID()
    const pendingPath = `${lockPath}.${nonce}.pending`
    const fd = openSync(pendingPath, 'wx', 0o600)
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: now(), nonce }), 'utf8')
      fsyncSync(fd)
      linkSync(pendingPath, lockPath)
      // Exact temporary file created above; ownership verified before unlinking.
      const pending = lstatSync(pendingPath)
      const own = fstatSync(fd)
      if (pending.ino !== own.ino || pending.dev !== own.dev) throw new Error('Pending lock owner changed')
      unlinkSync(pendingPath)
      return { fd, nonce }
    } catch (error) {
      closeSync(fd)
      try { if (existsSync(pendingPath)) unlinkSync(pendingPath) } catch { /* leave diagnostic temporary artifact */ }
      throw error
    }
  } finally {
    if (begun) mutex.exec('ROLLBACK')
    mutex.close()
  }
}

function migrate(db: DatabaseSync, dbPath: string, now: () => number, list: readonly Migration[]): number {
  const versions = list.map(migration => migration.version).sort((a, b) => a - b)
  if (versions.some((version, index) => !Number.isInteger(version) || version !== index + 1)) throw new Error('Migration versions must be unique and contiguous from one')
  const hasMeta = Boolean((db as unknown as { prepare(sql: string): any }).prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get())
  const applied = hasMeta ? db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version)) : []
  const current = applied.at(-1) ?? 0
  const max = list.length ? Math.max(...list.map((m) => m.version)) : 0
  if (current > max) throw new Error(`Database schema version ${current} is newer than supported ${max}`)
  if (applied.some((version, index) => !Number.isInteger(version) || version !== index + 1)) throw new Error('Applied migration history has a gap')
  for (const migration of list.filter((m) => m.version > current).sort((a,b) => a.version - b.version)) {
    if (existsSync(dbPath)) {
      const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
      if (Number(checkpoint?.busy ?? 0) !== 0) throw new Error('Migration backup checkpoint is busy')
      const backupPath = `${dbPath}.bak.${migration.version}`
      if (!existsSync(backupPath)) copyFileSync(dbPath, backupPath, constants.COPYFILE_EXCL)
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      migration.up(db)
      ;(db as unknown as { prepare(sql: string): any }).prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, now())
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    }
  }
  return list.length ? Math.max(...list.map((m) => m.version)) : current
}

export function openStore(options: OpenStoreOptions): Store {
  if (!options?.dbPath) throw new Error('dbPath is required')
  const dbPath = resolve(options.dbPath)
  mkdirSync(dirname(dbPath), { recursive: true })
  const now = options.now ?? (() => Date.now())
  const lockPath = resolve(options.lockPath ?? `${dbPath}.lock`)
  const lock = acquireLock(lockPath, now, options.staleLockMs ?? 0)
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath)
    const opened = db
    const busyTimeoutMs = options.busyTimeoutMs
    if (busyTimeoutMs !== undefined) {
      if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs < 0) throw new Error('busyTimeoutMs must be a non-negative finite number')
      opened.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeoutMs)}`)
    }
    opened.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    const version = migrate(opened, dbPath, now, options.migrations ?? defaultMigrations)
    const repos = {} as { [K in TableName]: TableRepo }
    for (const [name, def] of Object.entries(TABLE_DEFS) as [TableName, { columns: readonly string[]; pk: readonly string[]; state?: string }][]) repos[name] = createRepo(opened, name, def)
    let closed = false
    return {
      db: opened,
      repos,
      version,
      migrateVersion: version,
      transaction<T>(fn: (db: DatabaseSync) => T): T {
        opened.exec('BEGIN IMMEDIATE')
        try {
          const result = fn(opened)
          if (result && typeof result === 'object' && 'then' in result) {
            opened.exec('ROLLBACK')
            throw new Error('Store.transaction callback must be synchronous')
          }
          opened.exec('COMMIT')
          return result
        } catch (error) {
          try { opened.exec('ROLLBACK') } catch { /* preserve original */ }
          throw error
        }
      },
      close() {
        if (closed) return
        closed = true
        opened.close()
        try { closeSync(lock.fd) } finally {
          try {
            const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { nonce?: unknown }
            if (current.nonce === lock.nonce) unlinkSync(lockPath)
          } catch { /* already gone or replaced */ }
        }
      },
    }
  } catch (error) {
    try { closeSync(lock.fd) } catch { /* noop */ }
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { nonce?: unknown }
      if (current.nonce === lock.nonce) unlinkSync(lockPath)
    } catch { /* don't remove another owner's lock */ }
    try { if (db) db.close() } catch { /* preserve original error */ }
    throw error
  }
}

