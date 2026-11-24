import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  COPY_RECEIPT_SCHEMA, digestTree, isInsideTemporaryRoot, isSensitivePath, prepareTicketCopy,
  ticketCopyRetention, toTicketCopyRecord, verifyTicketCopyBaseline,
} from '../../src/isolation/workcopy.js'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    const absolute = resolve(dir)
    if (!absolute.includes('.probe/worker-isolation-test-') || !absolute.startsWith(resolve(process.cwd()))) throw new Error('unexpected workcopy fixture cleanup path')
    rmSync(absolute, { recursive: true, force: true })
  }
})
/** Ticket directories must be outside platform temp roots, so fixtures live under the repository. */
function nonTempRoot(): string {
  const parent = resolve(process.cwd(), '.probe')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'worker-isolation-test-'))
  cleanups.push(root)
  return root
}
function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' } })
}
function repository(root: string): string {
  const repo = join(root, 'source')
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(repo, 'keys'), { recursive: true })
  writeFileSync(join(repo, 'src', 'index.ts'), 'export const ok = true\n')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  writeFileSync(join(repo, '.env'), 'SECRET=tracked-secret-value\n')
  writeFileSync(join(repo, 'keys', 'prod.pem'), '-----BEGIN PRIVATE KEY-----\nnever-copy\n')
  symlinkSync('src/index.ts', join(repo, 'internal-link'))
  symlinkSync('/etc/hosts', join(repo, 'external-link'))
  git(repo, ['init', '-q'])
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'fixture'])
  writeFileSync(join(repo, 'untracked-secret.txt'), 'untracked never copied\n')
  return repo
}

describe('L2 per-Ticket working copy', () => {
  it('copies committed HEAD without credential-shaped paths, .git, or untracked files', async () => {
    const root = nonTempRoot(), source = repository(root), workRoot = join(root, 'work')
    mkdirSync(workRoot)
    const receipt = await prepareTicketCopy({ sourceDir: source, workRoot, ticketDir: join(workRoot, 'ticket-1'), ticketId: 'ticket-1', requestedBase: 'main' })
    const ticketDir = join(workRoot, 'ticket-1')
    expect(receipt.reused).toBe(false)
    expect(receipt.receipt).toMatchObject({ schemaVersion: COPY_RECEIPT_SCHEMA, ticketId: 'ticket-1', requestedBase: 'main' })
    expect(receipt.receipt.baselineDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.receipt.excludedPaths).toBeGreaterThanOrEqual(2)
    expect(readFileSync(join(ticketDir, 'src', 'index.ts'), 'utf8')).toBe('export const ok = true\n')
    expect(existsSync(join(ticketDir, '.env'))).toBe(false)
    expect(existsSync(join(ticketDir, 'keys', 'prod.pem'))).toBe(false)
    expect(existsSync(join(ticketDir, '.git'))).toBe(false)
    expect(existsSync(join(ticketDir, 'untracked-secret.txt'))).toBe(false)
    // Committed symlinks that escape the copy are dropped; internal ones stay.
    expect(existsSync(join(ticketDir, 'external-link'))).toBe(false)
    expect(lstatSync(join(ticketDir, 'internal-link')).isSymbolicLink()).toBe(true)
    expect(verifyTicketCopyBaseline(ticketDir, receipt.receipt)).toEqual({ ok: true, digest: receipt.receipt.baselineDigest })
    expect(git(source, ['rev-parse', 'HEAD']).trim()).toBe(receipt.receipt.head)
  })

  it('reuses only a managed copy with matching provenance and detects tampering', async () => {
    const root = nonTempRoot(), source = repository(root), workRoot = join(root, 'work')
    mkdirSync(workRoot)
    const first = await prepareTicketCopy({ sourceDir: source, workRoot, ticketDir: join(workRoot, 'ticket-1'), ticketId: 'ticket-1', requestedBase: 'main' })
    const reused = await prepareTicketCopy({ sourceDir: source, workRoot, ticketDir: join(workRoot, 'ticket-1'), ticketId: 'ticket-1', requestedBase: 'main', existingReceipt: toTicketCopyRecord(first.receipt) })
    expect(reused.reused).toBe(true)
    writeFileSync(join(workRoot, 'ticket-1', 'src', 'index.ts'), 'tampered\n')
    const verified = verifyTicketCopyBaseline(join(workRoot, 'ticket-1'), first.receipt)
    expect(verified.ok).toBe(false)
    expect(verified.digest).not.toBe(first.receipt.baselineDigest)
  })

  it('refuses an unmanaged non-empty Ticket directory and non-git or temp sources', async () => {
    const root = nonTempRoot(), source = repository(root), workRoot = join(root, 'work')
    mkdirSync(join(workRoot, 'ticket-1'), { recursive: true })
    writeFileSync(join(workRoot, 'ticket-1', 'stale.txt'), 'x')
    await expect(prepareTicketCopy({ sourceDir: source, workRoot, ticketDir: join(workRoot, 'ticket-1'), ticketId: 'ticket-1', requestedBase: 'main' })).rejects.toMatchObject({ code: 'SA_WORKDIR_UNMANAGED' })

    const plain = join(root, 'plain')
    mkdirSync(plain)
    await expect(prepareTicketCopy({ sourceDir: plain, workRoot, ticketDir: join(workRoot, 'ticket-2'), ticketId: 'ticket-2', requestedBase: 'main' })).rejects.toMatchObject({ code: 'SA_COPY_NOT_GIT' })

    const temp = mkdtempSync(join(tmpdir(), 'worker-isolation-test-temp-'))
    mkdirSync(join(temp, 'work'))
    await expect(prepareTicketCopy({ sourceDir: source, workRoot: join(temp, 'work'), ticketDir: join(temp, 'work', 'ticket-1'), ticketId: 'ticket-1', requestedBase: 'main' })).rejects.toMatchObject({ code: 'SA_WORKDIR_TEMP' })
    rmSync(temp, { recursive: true, force: true })
  })

  it('classifies secrets and states the retention policy without deleting anything', () => {
    for (const path of ['.env', 'config/.env.local', 'keys/prod.pem', 'id_ed25519', 'secrets/api.txt', 'nested/credentials.json', '.npmrc', '.config/gcloud/application_default_credentials.json']) {
      expect(isSensitivePath(path)).toBe(true)
    }
    for (const path of ['src/index.ts', 'README.md', 'docs/design.md', 'config/app.yaml', 'tests/env.test.ts']) {
      expect(isSensitivePath(path)).toBe(false)
    }
    expect(isInsideTemporaryRoot(tmpdir())).toBe(true)
    expect(isInsideTemporaryRoot(resolve(process.cwd()))).toBe(false)
    expect(ticketCopyRetention()).toEqual({ delete: false, retain: 'working-copy-and-products' })
  })

  it('digests deterministically and changes when content changes', () => {
    const root = nonTempRoot()
    writeFileSync(join(root, 'a.txt'), 'a')
    writeFileSync(join(root, 'b.txt'), 'b')
    const first = digestTree(root)
    expect(first).toMatchObject({ files: 2 })
    expect(digestTree(root).digest).toBe(first.digest)
    writeFileSync(join(root, 'b.txt'), 'changed')
    expect(digestTree(root).digest).not.toBe(first.digest)
  })
})
