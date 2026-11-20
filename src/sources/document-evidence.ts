import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, lstatSync, fstatSync, fsyncSync, renameSync, constants } from 'node:fs'
import { join, resolve } from 'node:path'

/** Restricted content-addressed local evidence. Not a document catalog or execution path. */
export function createDocumentEvidence(root: string) {
  const directory = resolve(root, 'document-evidence')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('document_evidence_permissions')
  const path = (digest: string) => {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('document_evidence_invalid')
    return join(directory, `${digest}.json`)
  }
  return {
    put(value: unknown): string {
      const current = lstatSync(directory)
      if (!current.isDirectory() || current.isSymbolicLink() || (current.mode & 0o077) !== 0 || typeof process.getuid === 'function' && current.uid !== process.getuid()) throw new Error('document_evidence_permissions')
      const bytes = Buffer.from(JSON.stringify(value), 'utf8')
      if (bytes.length > 24 * 1024 * 1024) throw new Error('document_evidence_too_large')
      const digest = createHash('sha256').update(bytes).digest('hex')
      const target = path(digest)
      try {
        const prior = lstatSync(target)
        if (!prior.isFile() || prior.isSymbolicLink() || (prior.mode & 0o077) !== 0 || typeof process.getuid === 'function' && prior.uid !== process.getuid()) throw new Error('document_evidence_permissions')
        try { this.read(digest); return digest } catch (error) {
          if (!(error instanceof Error) || error.message !== 'document_evidence_corrupt') throw error
          // Repair only this exact owned hash target from newly verified identical input.
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (!(error instanceof Error) || error.message !== 'document_evidence_corrupt')) throw error }
      const temporary = join(directory, `.${digest}.${randomUUID()}.pending`)
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
      // Both absolute paths are checked children of the private evidence directory.
      if (resolve(temporary) !== temporary || !temporary.startsWith(directory + '/') || resolve(target) !== target || !target.startsWith(directory + '/')) throw new Error('document_evidence_invalid')
      renameSync(temporary, target)
      const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
      try { fsyncSync(parent) } finally { closeSync(parent) }
      // Content is immutable and hash checked on every read; a partial write is never usable.
      this.read(digest)
      return digest
    },
    read(digest: string): any {
      const fd = openSync(path(digest), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = fstatSync(fd)
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 24 * 1024 * 1024 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('document_evidence_permissions')
        const bytes = readFileSync(fd)
        if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('document_evidence_corrupt')
        return JSON.parse(bytes.toString('utf8'))
      } finally { closeSync(fd) }
    },
  }
}
