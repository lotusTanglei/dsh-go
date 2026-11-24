import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import { webcrypto, createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import ts from 'typescript'

const source = readFileSync('src/client/workspace.ts', 'utf8'), tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any>): any {
  let initializer = ''
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) initializer = node.initializer.getText(tree); node.forEachChild(walk) }; walk(tree)
  if (!initializer) throw new Error(`Missing ${name}`)
  const context = createContext(globals); new Script(ts.transpileModule(`globalThis.actual = (${initializer})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context); return context.actual
}
const array = (v: any) => Array.isArray(v) ? v : [], scope = 'a'.repeat(64), fact = 'b'.repeat(64), uuid = '11111111-1111-4111-8111-111111111111', draftId = '22222222-2222-4222-8222-222222222222'
function png() {
  const chunk = (type: string, data: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(type, 4); return Buffer.concat([header, data, Buffer.alloc(4)]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))])
}
const bytes = png(), digest = createHash('sha256').update(bytes).digest('hex')
const record = (extra: any = {}) => ({ epoch: 'epoch', draftId, uploadId: uuid, imageId: uuid, digest, scopeRevision: scope, mediaType: 'image/png', width: 1, height: 1, size: bytes.length, state: 'staged', seq: 1, original: true, uploadedNotSent: true, ...extra })
function harness() {
  const calls: any[] = [], events: any[] = [], g: any = { array, tr: (v: string) => v, crypto: webcrypto, Uint8Array, DataView, Blob, btoa: (v: string) => Buffer.from(v, 'binary').toString('base64'), atob: (v: string) => Buffer.from(v, 'base64').toString('binary'), mintId: () => uuid,
    alive: { current: true }, epochRef: { current: 'epoch' }, imageDraftsRef: { current: {} }, imageScopeRef: { current: scope }, imageGeneration: { current: 0 }, imageBusyRef: { current: null }, imageViewerRef: { current: { close: () => events.push('close') } }, imageURLs: { current: new Set<string>() }, imageRevokeQueue: { current: new Set<string>() },
    URL: { createObjectURL: () => { const url = `blob:${events.length}`; events.push('create'); return url }, revokeObjectURL: (url: string) => events.push(['revoke', url]) },
    call: async (path: string, input: any) => { calls.push({ path, input }); return record() }, openSystem: (tab: string) => events.push(tab), currentSessionAction: () => null,
  }
  for (const key of ['ImageDrafts', 'ImageBusy', 'ImageError', 'ImageViewer']) g[`set${key}`] = (v: any) => { g[key[0]!.toLowerCase() + key.slice(1)] = v; events.push([key, v]) }
  for (const name of ['saveImageDraft', 'imageDraft', 'closeImageViewer', 'retireImageURLs', 'fenceImageScope', 'imageHash', 'inspectDraftPNG', 'validImageRecord', 'imageReference', 'addDraftImages', 'pasteDraftImages', 'readDraftImages', 'uploadDraftImage', 'openDraftOriginal', 'chooseImageTarget', 'changeDraftImage', 'selectDraftImage']) g[name] = closure(name, g)
  return { g, calls, events }
}
function staged(g: any, extra: any = {}) {
  const payload = { epoch: 'epoch', draftId, uploadId: uuid, digest, mediaType: 'image/png', encoded: bytes.toString('base64') }, row = { id: uuid, digest, payload, src: 'blob:original', status: 'local', ...extra }
  g.imageURLs.current.add(row.src); const draft = { epoch: 'epoch', draftId, items: [row], selected: uuid, target: null }; g.saveImageDraft('epoch', draft); return { row, draft, payload }
}
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children }), button = (title: string, onClick: any, disabled = false) => h('button', { onClick, disabled }, title)
function nodes(v: any): any[] { return v && typeof v === 'object' ? [v, ...array(v.children).flatMap(nodes)] : [] }

// Execute actual closures: contract/interaction evidence only, not browser, DOM, or visual proof.
describe('independent image draft lifecycle UI', () => {
  it('preserves original bytes/hash, previews locally and never uploads or alters composer implicitly', async () => {
    const { g, calls } = harness(), composer = { draft: 'Keep my text', target: 'unchanged' }; g.composerRef = { current: composer }
    await g.addDraftImages([{ type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }])
    const draft = g.imageDraft(); expect(draft.items).toHaveLength(1); expect(draft.items[0].digest).toBe(digest); expect(draft.items[0].payload.encoded).toBe(bytes.toString('base64')); expect(draft.items[0].status).toBe('local'); expect(calls).toEqual([]); expect(g.composerRef.current).toBe(composer)
  })
  it('blocks unsupported MIME, interlacing, bit depth, dimensions and over-quota input without conversion', async () => {
    const { g, calls } = harness()
    expect(() => g.inspectDraftPNG(bytes, 'image/jpeg')).toThrow()
    for (const [offset, value] of [[24, 16], [28, 1]]) { const bad = Buffer.from(bytes); bad[offset!] = value!; expect(() => g.inspectDraftPNG(bad, 'image/png')).toThrow() }
    const huge = Buffer.from(bytes); huge.writeUInt32BE(8193, 16); expect(() => g.inspectDraftPNG(huge, 'image/png')).toThrow()
    await g.addDraftImages(Array.from({ length: 6 }, () => ({}))); expect(g.imageError).toBe('ImageLimit'); expect(calls).toEqual([])
  })
  it('handles image clipboard files locally only, without touching text paste or automatic Host calls', async () => {
    const { g, calls } = harness(); let prevented = false, received: any
    g.addDraftImages = async (files: any) => { received = files }
    g.pasteDraftImages({ clipboardData: { items: [{ kind: 'string', getAsFile: () => null }] }, preventDefault: () => { prevented = true } })
    expect(prevented).toBe(false)
    const file = { type: 'image/png' }; g.pasteDraftImages({ clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] }, preventDefault: () => { prevented = true } })
    expect(prevented).toBe(true); expect(received).toEqual([file]); expect(calls).toEqual([])
  })
  it('preserves mixed clipboard text at the composer selection without dropping it beside an image', () => {
    const { g, calls } = harness(), file = { type: 'image/png' }, received: any[] = []
    g.composerRef = { current: { draft: 'before OLD after', pending: null, target: { id: 'unchanged' } } }
    g.updateComposer = (value: any) => { g.composerRef.current = { ...g.composerRef.current, ...value } }
    g.addDraftImages = async (files: any) => { received.push(...files) }
    const event = { target: { id: 'saw-draft', selectionStart: 7, selectionEnd: 10, disabled: false }, clipboardData: { items: [{ kind: 'file', getAsFile: () => file }], getData: () => 'exact pasted text' }, preventDefault() {} }
    g.pasteDraftImages(event)
    expect(g.composerRef.current.draft).toBe('before exact pasted text after'); expect(g.composerRef.current.target.id).toBe('unchanged'); expect(received).toEqual([file]); expect(calls).toEqual([])
    event.target.disabled = true; g.pasteDraftImages(event); expect(received).toHaveLength(1)
  })
  it('retains the original epoch draft on ordinary navigation and clears bind-pending data on scope withdrawal', async () => {
    const { g } = harness(); staged(g, { receipt: record(), status: 'staged' }); const draft = g.imageDraft(), target = { sessionId: 'target', scopeRevision: scope, factRevision: fact, project: { kind: 'unassigned', key: 'unassigned' } }; draft.target = target
    expect(g.imageDraft()).toBe(draft)
    let resolve: any; g.call = () => new Promise(yes => { resolve = yes }); const pending = g.changeDraftImage(uuid, 'bind')
    g.fenceImageScope('e'.repeat(64)); resolve(record({ state: 'bound', seq: 2, target })); await pending
    expect(g.imageDraft().target).toBeNull(); expect(g.imageDraft().items[0].status).toBe('bind-unknown'); expect(g.imageDraft().items[0].src).toBe(''); expect(g.imageDraft().items[0].receipt.seq).toBe(1)
  })
  it('keeps immutable unknown upload payload and only retries the same ID and bytes explicitly', async () => {
    const { g, calls } = harness(), { payload } = staged(g)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); throw new Error('network') }
    await g.uploadDraftImage(uuid); expect(calls).toHaveLength(1); expect(g.imageDraft().items[0].status).toBe('upload-unknown'); expect(g.imageDraft().items[0].payload).toBe(payload)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return record() }; await g.uploadDraftImage(uuid)
    expect(calls[0].input).toEqual(calls[1].input); expect(g.imageDraft().items[0].status).toBe('staged')
  })
  it('rejects mismatched upload receipts without claiming saved success', async () => {
    const { g } = harness(); staged(g); g.call = async () => record({ digest: 'c'.repeat(64) }); await g.uploadDraftImage(uuid)
    expect(g.imageDraft().items[0].status).toBe('upload-unknown'); expect(g.imageDraft().items[0].receipt).toBeUndefined()
  })
  it('reconciles unknown upload and release through Host list without an automatic mutation', async () => {
    const { g, calls } = harness(); staged(g, { status: 'upload-unknown' })
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return { scopeRevision: scope, items: [record()] } }; await g.readDraftImages()
    expect(g.imageDraft().items[0].status).toBe('staged'); expect(calls.map(v => v.input.action)).toEqual(['list'])
    g.imageDraft().items[0].status = 'release-unknown'; g.call = async () => ({ scopeRevision: scope, items: [] }); await g.readDraftImages(); expect(g.imageDraft().items).toEqual([])
  })
  it('hash-verifies original bytes and rejects tampering before creating a verified preview', async () => {
    const { g, events } = harness(); staged(g, { receipt: record(), status: 'staged' })
    g.call = async () => ({ digest, encoded: bytes.toString('base64'), mediaType: 'image/png' }); await g.openDraftOriginal(uuid)
    expect(g.imageDraft().items[0].originalVerified).toBe(true); expect(events).toContain('close'); expect(g.imageRevokeQueue.current.has('blob:original')).toBe(true)
    const { g: bad, events: badEvents } = harness(); staged(bad, { receipt: record(), status: 'staged' }); bad.call = async () => ({ digest: 'f'.repeat(64), encoded: bytes.toString('base64'), mediaType: 'image/png' }); await bad.openDraftOriginal(uuid)
    expect(bad.imageDraft().items[0].originalVerified).toBe(false); expect(badEvents).not.toContain('create')
  })
  it('scope/epoch fences close the viewer before deferred URL revocation and clear raw caches, blocking late upload', async () => {
    const { g, events } = harness(); staged(g); let resolve: any; g.call = () => new Promise(yes => { resolve = yes })
    const pending = g.uploadDraftImage(uuid); g.fenceImageScope('d'.repeat(64)); resolve(record()); await pending
    const row = g.imageDraft().items[0]; expect(row.src).toBe(''); expect(row.payload).toBeNull(); expect(row.stale).toBe(true); expect(row.receipt).toBeUndefined(); expect(events).toContain('close'); expect(g.imageRevokeQueue.current.has('blob:original')).toBe(true)
    expect(events.some(v => Array.isArray(v) && v[0] === 'revoke')).toBe(false)
    expect(source).toContain('fenceImageScope(data.sessionWork?.revision, epoch)'); expect(source).toContain('URL.revokeObjectURL(url)')
  })
  it('does not install late original bytes after removal or an epoch change', async () => {
    const { g, events } = harness(); staged(g, { receipt: record(), status: 'staged' }); let resolve: any; g.call = () => new Promise(yes => { resolve = yes })
    const pending = g.openDraftOriginal(uuid); g.epochRef.current = 'other'; g.fenceImageScope(scope, 'other'); resolve({ digest, encoded: bytes.toString('base64'), mediaType: 'image/png' }); await pending
    expect(events).not.toContain('create'); expect(g.imageDraftsRef.current.epoch.items[0].src).toBe('')
  })
  it('selects only an explicit located binding and does not change the text composer', () => {
    const { g, events } = harness(), target = { sessionId: 'target', scopeRevision: scope, factRevision: fact, project: { kind: 'project', key: 'p' } }; staged(g)
    g.chooseImageTarget(); expect(g.imageDraft().target).toBeNull()
    g.currentSessionAction = () => ({ target, title: 'Exact target' }); g.chooseImageTarget(); expect(g.imageDraft().target).toEqual(target); expect(events).toContain('images')
  })
  it('binds exact reference/target only and preserves unknown changes without automatic retry', async () => {
    const { g, calls } = harness(); staged(g, { receipt: record(), status: 'staged' }); const target = { sessionId: 'target', scopeRevision: scope, factRevision: fact, project: { kind: 'unassigned', key: 'unassigned' } }; g.imageDraft().target = target
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return record({ seq: 2, state: 'bound', target }) }; await g.changeDraftImage(uuid, 'bind')
    expect(calls[0].input).toEqual({ action: 'bind', epoch: 'epoch', reference: { imageId: uuid, digest, seq: 1 }, target: { sessionId: 'target', scopeRevision: scope, factRevision: fact } }); expect(g.imageDraft().items[0].status).toBe('bound')
    g.call = async (path: string, input: any) => { calls.push({ path, input }); throw new Error('unknown') }; await g.changeDraftImage(uuid, 'release'); expect(g.imageDraft().items).toHaveLength(1); expect(g.imageDraft().items[0].status).toBe('release-unknown'); await g.changeDraftImage(uuid, 'release'); expect(calls).toHaveLength(2)
  })
  it('removes local preview without Host work and removes Host references only after exact release receipt', async () => {
    const { g, calls } = harness(); staged(g); await g.changeDraftImage(uuid, 'release'); expect(g.imageDraft().items).toEqual([]); expect(calls).toEqual([])
    staged(g, { receipt: record(), status: 'staged' }); g.call = async () => ({ imageId: uuid, seq: 2, state: 'released', bytesRetained: true, thirdPartyErasureGuaranteed: false }); await g.changeDraftImage(uuid, 'release'); expect(g.imageDraft().items).toEqual([])
  })
  it('renders only thumbnails or the selected detail and always discloses blocked capabilities', () => {
    const { g } = harness(); staged(g); Object.assign(g, { h, button, React: { Fragment: 'fragment' }, imageBusy: '', imageError: '', imageViewer: null, imageDrafts: g.imageDraftsRef.current })
    const render = closure('imageDraftView', g), detail = JSON.stringify(render()); expect(detail).toContain('ImageCapabilityBlocked'); expect(detail).toContain('ImageDetails'); expect(detail).not.toContain('ImageThumbnails')
    g.imageDraft().selected = ''; const thumbnails = JSON.stringify(render()); expect(thumbnails).toContain('ImageThumbnails'); expect(thumbnails).not.toContain('ImageBackThumbnails')
    expect(nodes(render()).some(v => v.props?.dangerouslySetInnerHTML)).toBe(false)
    for (const lang of ['zh', 'en']) expect(JSON.parse(readFileSync(`locale/${lang}.json`, 'utf8')).panel.wImageCapabilityBlocked).toBeTruthy()
  })
})
