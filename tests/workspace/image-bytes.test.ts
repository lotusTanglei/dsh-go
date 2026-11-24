import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, linkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createImageBytes, inspectImageBytes } from '../../src/workspace/image-bytes.js'

function crc(bytes: Buffer) { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1)) } return (n ^ 0xffffffff) >>> 0 }
function chunk(type: string, bytes: Buffer) { const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4); return out }
function png(width = 1, height = 1, raw = Buffer.from([0, 255, 0, 0, 255]), extras: Buffer[] = []) { const h = Buffer.alloc(13); h.writeUInt32BE(width); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', h), ...extras, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]) }
const cleanups: Array<() => void> = []
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn() })
function directory() {
  const root = realpathSync(tmpdir()), path = resolve(mkdtempSync(join(root, 'go-image-bytes-test-'))), identity = lstatSync(path)
  cleanups.push(() => { const s = lstatSync(path); if (dirname(path) !== root || !basename(path).startsWith('go-image-bytes-test-') || !s.isDirectory() || s.isSymbolicLink() || s.dev !== identity.dev || s.ino !== identity.ino || realpathSync(path) !== path) throw new Error('unsafe fixture cleanup'); rmSync(path, { recursive: true, force: true }) })
  return path
}
describe('immutable original PNG byte contract, no image interpretation', () => {
  it('validates actual CRC/inflated raster and preserves source bytes and digest', () => {
    const bytes = png(), root = directory(), store = createImageBytes(root), info = store.put(bytes, 'image/png')
    expect(info).toMatchObject({ width: 1, height: 1, size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') })
    expect(store.read(info.digest)).toEqual(bytes); expect(readFileSync(join(root, 'image-originals', info.digest + '.png'))).toEqual(bytes)
    expect(store.put(bytes, 'image/png')).toEqual(info)
    expect(createImageBytes(root).read(info.digest)).toEqual(bytes)
  })
  it.each(['image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])('blocks unsupported %s rather than stripping or converting the image', type => { expect(() => inspectImageBytes(png(), type)).toThrow('image_format_unsupported') })
  it('rejects signature, CRC, truncation and trailing/polyglot bytes', () => {
    const good = png(), badCrc = Buffer.from(good); badCrc[badCrc.length - 1] = badCrc[badCrc.length - 1]! ^ 1
    for (const value of [Buffer.from('not png'), badCrc, good.subarray(0, -1), Buffer.concat([good, Buffer.from('<script>')])]) expect(() => inspectImageBytes(value, 'image/png')).toThrow()
  })
  it('rejects invalid high-bit chunk names and extra compressed-stream suffixes despite valid CRC', () => {
    const good = png(), header = Buffer.from(good.subarray(8, 33))
    for (let i = 4; i < 8; i++) header[i] = header[i]! | 0x80
    header.writeUInt32BE(crc(header.subarray(4, -4)), header.length - 4)
    const highBit = Buffer.concat([good.subarray(0, 8), header, good.subarray(33)])
    expect(() => inspectImageBytes(highBit, 'image/png')).toThrow('image_png_invalid')
    const suffix = Buffer.concat([good.subarray(0, 33), chunk('IDAT', Buffer.concat([deflateSync(Buffer.from([0,255,0,0,255])), Buffer.from('TRAILING_NON_ZLIB_DATA')])), chunk('IEND', Buffer.alloc(0))])
    expect(() => inspectImageBytes(suffix, 'image/png')).toThrow('image_png_invalid')
  })
  it('rejects unsupported dimensions, inflated bombs, bad row filters and animation', () => {
    for (const value of [png(8193, 1), png(3000,3000), png(1,1,Buffer.alloc(1_000_000)), png(1,1,Buffer.from([5,0,0,0,0])), png(1,1,Buffer.from([0,0,0,0,0]),[chunk('acTL',Buffer.alloc(8))])]) expect(() => inspectImageBytes(value, 'image/png')).toThrow()
  })
  it('pins a canonical trusted state root while rejecting a linked private blob directory', () => {
    const root = directory(), alias = join(root, 'host-root-alias')
    symlinkSync(root, alias)
    const store = createImageBytes(alias), info = store.put(png(), 'image/png')
    expect(store.read(info.digest)).toEqual(png())
    expect(lstatSync(join(root, 'image-originals')).isSymbolicLink()).toBe(false)
    const other = directory(); symlinkSync(join(root, 'image-originals'), join(other, 'image-originals'))
    expect(() => createImageBytes(other)).toThrow('image_storage_unavailable')
  })
  it('rejects a corrupt stored blob and does not silently repair it', () => {
    const root = directory(), bytes = png(), store = createImageBytes(root), info = store.put(bytes, 'image/png')
    writeFileSync(join(root,'image-originals',info.digest+'.png'), 'corrupt', { mode: 0o600 })
    expect(() => store.read(info.digest)).toThrow('image_original_corrupt'); expect(() => store.put(bytes,'image/png')).toThrow('image_original_corrupt')
  })
  it('rejects blob links, unsafe modes and directory replacement', () => {
    const root = directory(), store = createImageBytes(root), info = store.put(png(), 'image/png'), file = join(root,'image-originals',info.digest+'.png')
    chmodSync(file, 0o644); expect(() => store.read(info.digest)).toThrow('image_storage_unavailable'); chmodSync(file,0o600)
    linkSync(file, join(root,'hardlink.png')); expect(() => store.read(info.digest)).toThrow('image_storage_unavailable'); unlinkSync(join(root,'hardlink.png'))
    unlinkSync(file); symlinkSync(join(root,'missing.png'),file); expect(() => store.read(info.digest)).toThrow()
    chmodSync(join(root,'image-originals'),0o755); expect(() => store.read(info.digest)).toThrow('image_storage_unavailable'); chmodSync(join(root,'image-originals'),0o700)
  })
})
