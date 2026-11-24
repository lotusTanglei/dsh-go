import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, linkSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { WorkspaceError } from './commands.js'

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const fail = (code: string): never => { throw new WorkspaceError(code, 400) }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
/** Narrow, decoded raster contract: 8-bit non-interlaced PNG only. Preserve every source byte.
 * Unknown formats/animated images are blocked, never relabeled or converted behind the user.
 */
export function inspectImageBytes(bytes: Buffer, mediaType: string): { width: number; height: number; mediaType: 'image/png'; digest: string; size: number } {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || bytes.length > IMAGE_MAX_BYTES) return fail('image_size_invalid')
  if (mediaType !== 'image/png' || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return fail('image_format_unsupported')
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, dataEnded = false, dataStarted = false, chunks = 0
  const compressed: Buffer[] = []
  while (offset + 12 <= bytes.length) {
    if (++chunks > 2048) return fail('image_png_invalid')
    const size = bytes.readUInt32BE(offset), type = bytes.toString('latin1', offset + 4, offset + 8), end = offset + 12 + size
    if (size > IMAGE_MAX_BYTES || end > bytes.length || !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return fail('image_png_invalid')
    const body = bytes.subarray(offset + 8, end - 4)
    if (chunks === 1 && type !== 'IHDR') return fail('image_png_invalid')
    if (type === 'IHDR') {
      if (chunks !== 1 || size !== 13) return fail('image_png_invalid')
      width = body.readUInt32BE(0); height = body.readUInt32BE(4)
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[body[9]!] ?? 0
      if (!width || !height || width > 8192 || height > 8192 || width * height > 8_000_000 || body[8] !== 8 || !channels || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return fail('image_dimensions_unsupported')
    } else if (type === 'IDAT') {
      if (dataEnded) return fail('image_png_invalid')
      dataStarted = true; compressed.push(body)
    } else {
      if (dataStarted) dataEnded = true
      if (type === 'IEND') { if (size !== 0 || !dataStarted || end !== bytes.length) return fail('image_png_invalid'); ended = true; offset = end; break }
      if (['acTL', 'fcTL', 'fdAT'].includes(type) || /^[A-Z]/.test(type) && type !== 'PLTE') return fail('image_format_unsupported')
      if (type === 'PLTE' && (dataStarted || size === 0 || size % 3 !== 0 || size > 768)) return fail('image_png_invalid')
    }
    offset = end
  }
  if (!ended || offset !== bytes.length) return fail('image_png_invalid')
  const rowSize = width * channels + 1, expected = height * rowSize
  let decoded: Buffer
  try {
    const input = Buffer.concat(compressed), result = inflateSync(input, { maxOutputLength: expected + 1, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
    if (result.engine.bytesWritten !== input.length) return fail('image_png_invalid')
    decoded = result.buffer
  } catch { return fail('image_png_invalid') }
  if (decoded.length !== expected) return fail('image_png_invalid')
  for (let row = 0; row < height; row++) if (decoded[row * rowSize]! > 4) return fail('image_png_invalid')
  return { width, height, mediaType: 'image/png', digest: hash(bytes), size: bytes.length }
}

/** Private, pinned directory. The raw blob is never stored in SQLite or a log. */
export function createImageBytes(root: string) {
  // Host state roots may contain OS aliases (e.g. macOS /var -> /private/var).
  // Resolve that trusted root once; never follow an alias for the private child thereafter.
  const directory = resolve(realpathSync(root), 'image-originals')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const identity = lstatSync(directory), canonical = realpathSync(directory)
  const check = () => {
    const current = lstatSync(directory)
    if (canonical !== directory || realpathSync(directory) !== canonical || !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || (current.mode & 0o077) !== 0 || typeof process.getuid === 'function' && current.uid !== process.getuid()) throw new WorkspaceError('image_storage_unavailable', 503)
  }
  check()
  const path = (digest: string) => { if (!/^[a-f0-9]{64}$/.test(digest)) throw new WorkspaceError('image_reference_invalid', 400); return join(directory, digest + '.png') }
  const read = (digest: string) => {
    check(); const fd = openSync(path(digest), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = fstatSync(fd)
      if (!info.isFile() || info.nlink !== 1 || info.size > IMAGE_MAX_BYTES || info.size === 0 || (info.mode & 0o077) !== 0 || typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new WorkspaceError('image_storage_unavailable', 503)
      const bytes = readFileSync(fd); check()
      if (hash(bytes) !== digest) throw new WorkspaceError('image_original_corrupt', 503)
      return bytes
    } finally { closeSync(fd) }
  }
  return { read, put(bytes: Buffer, mediaType: string) {
    const image = inspectImageBytes(bytes, mediaType); check()
    const target = path(image.digest)
    try { read(image.digest); return image } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = join(directory, `.${image.digest}.${randomUUID()}.pending`), fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    check()
    // Exact generated children; never unlink a caller-selected path. Install immutable blob without replacement.
    if (resolve(temporary) !== temporary || !temporary.startsWith(directory + '/') || resolve(target) !== target || !target.startsWith(directory + '/')) throw new WorkspaceError('image_storage_unavailable', 503)
    const temporaryIdentity = lstatSync(temporary)
    try { linkSync(temporary, target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const current = lstatSync(temporary)
    if (current.dev !== temporaryIdentity.dev || current.ino !== temporaryIdentity.ino || !current.isFile() || current.isSymbolicLink()) throw new WorkspaceError('image_storage_unavailable', 503)
    unlinkSync(temporary)
    const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { fsyncSync(parent) } finally { closeSync(parent) }
    read(image.digest)
    return image
  } }
}
