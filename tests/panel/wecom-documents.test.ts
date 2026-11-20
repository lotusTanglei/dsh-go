import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { installPanelRoutes, type PanelPorts } from '../../src/panel/routes.js'
import type { Store } from '../../src/store/index.js'
import { WorkspaceError } from '../../src/workspace/commands.js'

const epoch = 'epoch-1', itemKey = 'a'.repeat(64), revision = 'b'.repeat(64)
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const digestOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const digest = digestOf(image)
const imageInput = { epoch, itemKey, revision, digest }

/** Installed handler + Origin boundary only, NOT a substitute for Host owner authentication. */
function fixture(ports: PanelPorts = {}) {
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const registrations: any[] = []
  installPanelRoutes({ connection: { fetch: { register(route) { registrations.push(route); routes.set(route.path, route.fetch); return () => {} } } } }, {} as Store, {}, ports)
  return {
    registrations,
    async post(path: string, input: unknown, origin = 'http://owner.test') {
      const response = await routes.get(`/api/superagent/${path}`)!(new Request(`http://owner.test/api/superagent/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(input) }))
      return { status: response.status, body: await response.json() as any }
    },
  }
}

describe('manual WeCom document owner-route contracts (not live owner authentication or DOM proof)', () => {
  it('uses the existing Host registration and rejects nonowner Origins before any document port', async () => {
    const documentSource = vi.fn(async (_input: any) => ({ sources: [], items: [] })), documentImage = vi.fn(async () => ({ bytes: image, mimeType: 'image/png' }))
    const f = fixture({ documentSource, documentImage })
    expect(f.registrations.filter(row => row.path.includes('/document-'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/superagent/document-source', methods: ['POST'], requestBody: 'buffered' }),
      expect.objectContaining({ path: '/api/superagent/document-image', methods: ['POST'], requestBody: 'buffered' }),
    ]))
    for (const origin of ['https://nonowner.invalid', 'null']) {
      expect((await f.post('document-source', { action: 'scan', epoch, sourceId: 'configured-source' }, origin)).status).toBe(403)
      expect((await f.post('document-image', imageInput, origin)).status).toBe(403)
    }
    expect(documentSource).not.toHaveBeenCalled(); expect(documentImage).not.toHaveBeenCalled()
    expect((await f.post('document-source', { action: 'list', epoch })).status).toBe(200)
    expect(documentSource).toHaveBeenCalledExactlyOnceWith({ action: 'list', epoch })
  })

  it('strictly separates list/scan/detail field shapes and rejects caller documents, URLs, tools, paths and sessions', async () => {
    const documentSource = vi.fn(async (_input: any) => ({ sources: [], items: [] })), f = fixture({ documentSource })
    const valid = [{ action: 'list', epoch }, { action: 'scan', epoch, sourceId: 'configured-source' }, { action: 'scan', epoch, sourceId: `valid/source:${'x'.repeat(150)}` }, { action: 'detail', epoch, itemKey, revision }]
    const forbidden = ['doc', 'url', 'path', 'tool', 'tools', 'session', 'sessionId', 'actor', 'source', 'sourceConfig', 'args', 'range', 'sheet', 'ignoreStrike', 'force']
    for (const input of valid) for (const key of forbidden) expect((await f.post('document-source', { ...input, [key]: 'caller-controlled' })).status, key).toBe(400)
    for (const input of [
      { action: 'list', epoch, sourceId: 'extra' }, { action: 'scan', epoch }, { action: 'scan', epoch, sourceId: '/private' },
      { action: 'scan', epoch, sourceId: 'https://untrusted?doc=caller' }, { action: 'scan', epoch, sourceId: 'id', revision },
      { action: 'detail', epoch, itemKey }, { action: 'detail', epoch, itemKey, revision: 'not-a-hash' },
      { action: 'detail', epoch, itemKey, revision, sourceId: 'extra' }, { action: 'read', epoch }, { action: 'list' },
    ]) expect((await f.post('document-source', input)).status).toBe(400)
    expect(documentSource).not.toHaveBeenCalled()
    for (const input of valid) expect((await f.post('document-source', input)).status).toBe(200)
    expect(documentSource.mock.calls.map(row => row[0])).toEqual(valid)
  })

  it('allows a hash cursor only for local list pagination, never for scan/detail', async () => {
    const cursor = 'f'.repeat(64), documentSource = vi.fn(async (_input: any) => ({ sources: [], items: [], total: 201, hasMore: true, cursor }))
    const f = fixture({ documentSource })
    const page = await f.post('document-source', { action: 'list', epoch, cursor })
    expect(page.status).toBe(200); expect(page.body.data.cursor).toBe(cursor)
    expect(documentSource).toHaveBeenCalledExactlyOnceWith({ action: 'list', epoch, cursor })
    for (const input of [{ action: 'list', epoch, cursor: 'not-a-hash' }, { action: 'scan', epoch, sourceId: 'configured-source', cursor }, { action: 'detail', epoch, itemKey, revision, cursor }]) expect((await f.post('document-source', input)).status).toBe(400)
    expect(documentSource).toHaveBeenCalledTimes(1)
  })

  it('accepts only exact owner review attestations and delegates stale snapshot rejection without implicit reads', async () => {
    const review = { action: 'review', epoch, itemKey, revision, evidenceDigest: 'c'.repeat(64), decision: 'reviewed-not-struck' }
    const documentSource = vi.fn(async (input: any) => {
      if (input.epoch !== epoch || input.revision !== revision || input.evidenceDigest !== review.evidenceDigest) throw new WorkspaceError('document_snapshot_changed', 409)
      return { eligible: true, reviewable: false, state: 'candidate' }
    })
    const f = fixture({ documentSource })
    for (const key of ['itemKey', 'revision', 'evidenceDigest']) for (const value of [undefined, 'bad', 'A'.repeat(64)]) expect((await f.post('document-source', { ...review, [key]: value })).status).toBe(400)
    for (const extra of [{ decision: 'ignore-strike' }, { decision: true }, { sourceId: 'source' }, { cursor: itemKey }, { documentLink: 'https://doc.weixin.qq.com/sheet/evil?tab=main' }, { force: true }, { ignoreStrike: true }, { sessionId: 'foreign' }]) expect((await f.post('document-source', { ...review, ...extra })).status).toBe(400)
    for (const input of [{ action: 'list', epoch }, { action: 'scan', epoch, sourceId: 'source' }, { action: 'detail', epoch, itemKey, revision }]) {
      for (const extra of [{ evidenceDigest: review.evidenceDigest }, { decision: review.decision }]) expect((await f.post('document-source', { ...input, ...extra })).status).toBe(400)
    }
    expect((await f.post('document-source', review, 'https://nonowner.invalid')).status).toBe(403)
    expect(documentSource).not.toHaveBeenCalled()
    expect((await f.post('document-source', review)).status).toBe(200)
    expect(documentSource).toHaveBeenCalledExactlyOnceWith(review)
    for (const patch of [{ epoch: 'stale' }, { revision: 'd'.repeat(64) }, { evidenceDigest: 'd'.repeat(64) }]) {
      const result = await f.post('document-source', { ...review, ...patch })
      expect(result.status).toBe(409); expect(result.body.message).toBe('Workspace request could not be completed')
    }
    expect(documentSource.mock.calls.every(row => row[0].action === 'review')).toBe(true)
  })

  it('preserves only canonical configured official document links without weakening the global sanitizer', async () => {
    let documentLink = 'https://doc.weixin.qq.com/sheet/fixtureId?tab=sheet_1'
    const f = fixture({ documentSource: async () => ({ reviewable: true, documentLink }) })
    expect((await f.post('document-source', { action: 'detail', epoch, itemKey, revision })).body.data.documentLink).toBe(documentLink)
    for (const link of ['javascript:alert(1)', 'http://doc.weixin.qq.com/sheet/id?tab=sheet', 'https://user:pass@doc.weixin.qq.com/sheet/id?tab=sheet', 'https://doc.weixin.qq.com.evil.invalid/sheet/id?tab=sheet', 'https://doc.weixin.qq.com/sheet/id?tab=sheet#token', 'https://doc.weixin.qq.com/sheet/id?tab=sheet&token=secret', 'https://doc.weixin.qq.com:444/sheet/id?tab=sheet']) {
      documentLink = link
      expect((await f.post('document-source', { action: 'detail', epoch, itemKey, revision })).body.data.documentLink).toBeUndefined()
    }
  })

  it('does not automatically scan from list/detail and preserves exact validated DTO hashes without weakening sanitizer', async () => {
    const documentOrigin = { kind: 'wecom-document', itemKey, revision, evidenceDigest: 'c'.repeat(64), configVersion: 'd'.repeat(64) }
    const documentSource = vi.fn(async (input: any) => input.action === 'detail' ? { documentOrigin, text: 'untrusted source', screenshots: [{ cell: 'A3', digest, mediaType: 'image/png' }] } : { sources: [{ id: 'configured-source', sheet: 'Issues', range: 'A1:C10' }], items: [{ documentOrigin, itemKey, revision, evidenceDigest: documentOrigin.evidenceDigest, configVersion: documentOrigin.configVersion, url: 'https://private.invalid', text: '/Users/private-owner/hidden' }] })
    const f = fixture({ documentSource })
    const list = await f.post('document-source', { action: 'list', epoch })
    expect(list.body.data.items[0].documentOrigin).toEqual(documentOrigin)
    expect(list.body.data.items[0].itemKey).toBe(itemKey)
    expect(JSON.stringify(list.body)).not.toMatch(/private-owner|private\.invalid/)
    const detail = await f.post('document-source', { action: 'detail', epoch, itemKey, revision })
    expect(detail.body.data.screenshots[0].digest).toBe(digest)
    expect(documentSource.mock.calls.map(row => row[0].action)).toEqual(['list', 'detail'])
    const source = readFileSync('src/panel/routes.ts', 'utf8')
    const sanitizer = source.slice(source.indexOf('function sanitize('), source.indexOf('function isObject('))
    expect(sanitizer).not.toContain('encoded'); expect(sanitizer).not.toContain('evidenceDigest')
  })

  it('delegates epoch/current-revision checks to runtime ports and keeps every error text static', async () => {
    const documentSource = vi.fn(async () => { throw new WorkspaceError('epoch_mismatch', 409) })
    const f = fixture({ documentSource, documentImage: async () => { throw new Error('/Users/private-owner/token-secret') } })
    expect((await f.post('document-source', { action: 'scan', epoch: 'stale-epoch', sourceId: 'configured-source' })).status).toBe(409)
    expect(documentSource).toHaveBeenCalledExactlyOnceWith({ action: 'scan', epoch: 'stale-epoch', sourceId: 'configured-source' })
    const failed = await f.post('document-image', imageInput)
    expect(failed.status).toBe(500); expect(JSON.stringify(failed.body)).not.toMatch(/private-owner|token-secret/)
    expect((await fixture().post('document-source', { action: 'list', epoch })).status).toBe(503)
    expect((await fixture().post('document-image', imageInput)).status).toBe(503)
  })

  it('rejects nonhash identities and all image request extras before the local evidence port', async () => {
    const documentImage = vi.fn(async () => ({ bytes: image, mimeType: 'image/png' })), f = fixture({ documentImage })
    for (const key of ['doc', 'url', 'path', 'tool', 'sessionId', 'sourceId', 'encoded', 'mediaType', 'force']) expect((await f.post('document-image', { ...imageInput, [key]: 'caller-controlled' })).status).toBe(400)
    for (const key of ['itemKey', 'revision', 'digest']) for (const value of [undefined, 'bad', 'A'.repeat(64), '../private']) expect((await f.post('document-image', { ...imageInput, [key]: value })).status).toBe(400)
    expect(documentImage).not.toHaveBeenCalled()
  })

  it('returns exact bounded raster base64 without redaction, but rejects MIME/magic/digest/size failures', async () => {
    const f = fixture({ documentImage: async () => ({ bytes: image, mimeType: 'image/png' }) })
    const result = await f.post('document-image', imageInput)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, data: { mediaType: 'image/png', encoded: image.toString('base64') } })
    expect(Buffer.from(result.body.data.encoded, 'base64')).toEqual(image)
    for (const output of [
      { bytes: image, mimeType: 'image/svg+xml' }, { bytes: image, mimeType: 'image/jpeg' },
      { bytes: Buffer.from('<svg onload="attack()"/>'), mimeType: 'image/png' }, { bytes: Buffer.alloc(0), mimeType: 'image/png' },
      { bytes: Buffer.alloc(8 * 1024 * 1024 + 1), mimeType: 'image/png' }, { bytes: image.toString('base64'), mimeType: 'image/png' },
    ]) {
      const bad = fixture({ documentImage: async () => output as any })
      const failure = await bad.post('document-image', imageInput)
      expect(failure.status).toBe(400); expect(failure.body.code).toBe('document_image_invalid')
      expect(failure.body.data).toBeUndefined()
    }
    expect((await f.post('document-image', { ...imageInput, digest: 'e'.repeat(64) })).status).toBe(400)
  })
})
