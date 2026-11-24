import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { createContext, Script } from 'node:vm'
import { TextEncoder } from 'node:util'
import ts from 'typescript'

const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function initializer(name: string) {
  let value = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) value = node.initializer.getText(tree); node.forEachChild(visit) }
  visit(tree)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
function closure(name: string, globals: Record<string, any>): any {
  const context = createContext(globals)
  new Script(ts.transpileModule(`globalThis.actual = (${initializer(name)})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  return context.actual
}
const scope = 'a'.repeat(64), fact = 'b'.repeat(64), imageDigest = 'c'.repeat(64)
const array = (value: any) => Array.isArray(value) ? value : []
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children })
const button = (title: string, onClick: () => void, disabled = false, props: any = {}) => h('button', { type: 'button', onClick, disabled, ...props }, title)
function nodes(value: any): any[] { return value && typeof value === 'object' ? [value, ...array(value.children).flatMap(nodes)] : [] }
const text = (value: any) => value === undefined || value === null || value === '' ? 'Unknown' : String(value)
const row = (sessionId = 'session-one', factRevision = fact) => ({ sessionId, project: { kind: 'project', key: 'project-one', name: 'Same project name' }, factRevision, title: 'Same session title' })
const located = (target = row(), revision = scope) => ({ status: 'located', target, candidates: [target], revision, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
const deliveryDigest = (input: any) => createHash('sha256').update(JSON.stringify([input.epoch, input.requestId, input.confirmationId, input.operation, input.text,
  input.target.sessionId, input.target.scopeRevision, input.target.factRevision, input.images.map((item: any) => [item.imageId, item.digest, item.seq])])).digest('hex')
function receipt(input: any, state = 'prepared', extra: any = {}) {
  return { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId, operation: input.operation,
    target: { ...input.target, project: { kind: 'project', key: 'project-one' } }, digest: deliveryDigest(input), bodyBytes: new TextEncoder().encode(input.text).length,
    images: input.images.map((item: any) => ({ ...item })), seq: state === 'prepared' ? 1 : 2, at: 100, updatedAt: state === 'prepared' ? 100 : 101, state,
    humanConfirmed: state === 'confirmed', delivered: false, accepted: false, executed: false, completed: false,
    disposition: state === 'confirmed' ? 'confirmed-pending-delivery' : state === 'canceled' ? 'canceled' : 'not-confirmed', durable: true, ...extra }
}
function harness() {
  const calls: any[] = [], events: any[] = [], draft = { draft: 'Main draft must not change', target: { id: 'main-target' }, pending: { requestId: 'main-request' } }
  let id = 0
  const target = row()
  const g: any = {
    array, TextEncoder, crypto: webcrypto, h, button, React: { Fragment: 'fragment' }, text, time: String,
    tr: (key: string) => key, mintId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    alive: { current: true }, epochRef: { current: 'epoch-one' }, systemRef: { current: 'locate' },
    locateResultRef: { current: located(target) }, locateVersion: { current: 0 }, locateBusyRef: { current: null },
    sessionActionsRef: { current: {} }, deliveries: {}, deliveriesRef: { current: {} }, deliveryBusyRef: { current: null },
    imageDraftsRef: { current: {} },
    scopeProjectKey: (p: any) => p?.kind === 'project' && p.key ? `project:${p.key}` : p?.kind === 'unassigned' ? 'unassigned' : '',
    scopeProjectName: (p: any) => p?.name || p?.key, sessionSourceTitle: (value: any) => value.title,
    composerRef: { current: draft }, updateComposer: () => { throw new Error('Delivery must not change main composer') },
    setDeliveries: (value: any) => { g.deliveries = value; events.push(value) },
    setLocateResult: (value: any) => { g.locateResultRef.current = value; events.push(value) }, setLocateBusy: () => {}, setLocateError: () => {},
    call: async (path: string, input: any) => {
      calls.push({ path, input })
      if (path !== 'delivery') throw new Error(`delivery UI must not call ${path}`)
      if (input.action === 'confirm') return receipt(input, 'confirmed')
      if (input.action === 'cancel') return receipt(input, 'canceled')
      if (input.action === 'status') return receipt(input, 'prepared')
      return receipt(input, 'prepared')
    },
  }
  for (const name of ['sessionActionKey', 'currentSessionAction', 'deliveryKey', 'currentDelivery', 'deliveryDraftText', 'deliveryOperation', 'deliveryImageRefs',
    'deliveryPayload', 'deliveryDigest', 'saveDelivery', 'validDeliveryReceipt', 'deliveryStatusName', 'deliveryOperationName', 'deliverySummary',
    'prepareDelivery', 'confirmDelivery', 'cancelDelivery', 'checkDeliveryStatus', 'deliveryConfirmationView', 'resetLocate']) g[name] = closure(name, g)
  const edit = (textValue = '  本次人类文字\r\nKeep Unicode 🧭 exactly  ', operation = 'continue') => {
    const current = g.currentDelivery()
    g.sessionActionsRef.current = { ...g.sessionActionsRef.current, [current.key]: { ...current, text: textValue, operation, status: 'draft' } }
    return current.key
  }
  const bindImage = (overrides: any = {}) => {
    const current = g.currentDelivery(), epoch = current.epoch, item = { id: overrides.imageId || 'img-one', digest: overrides.digest || imageDigest, status: 'bound', stale: false,
      receipt: { imageId: overrides.imageId || 'img-one', digest: overrides.digest || imageDigest, seq: overrides.seq || 1, state: 'bound' } }
    g.imageDraftsRef.current = { ...g.imageDraftsRef.current, [epoch]: { epoch, draftId: 'draft-one', selected: '', target: { ...current.target, project: { ...current.target.project } }, items: overrides.items || [item] } }
    return item
  }
  return { g, calls, events, draft, target, edit, bindImage, minted: () => id }
}

// Execute the actual extracted closures and interaction contracts; no DOM or visual claim.
describe('pre-delivery confirmation card UI contracts', () => {
  it('renders the located project, session, action, body summary and image count without any request', () => {
    const { g, calls, edit, bindImage } = harness()
    edit('Continue this exact work\nsecond line', 'supplement'); bindImage()
    const view = g.deliveryConfirmationView(), elements = nodes(view), content = JSON.stringify(view)
    expect(content).toContain('DeliveryTitle'); expect(content).toContain('Project: Same project name')
    expect(content).toContain('session-one'); expect(content).toContain('SessionActionSupplement')
    expect(content).toContain('Continue this exact work'); expect(content).toContain('DeliveryImages: 1')
    expect(elements.filter(node => node.tag === 'button').map(node => node.children[0])).toEqual(['DeliveryPrepare'])
    expect(content).not.toContain('DeliveryConfirm')
    expect(calls).toEqual([])
  })

  it('offers no confirmation surface without a unique exact location', () => {
    const { g, edit, calls } = harness()
    edit('Some draft body')
    g.locateResultRef.current = { ...located(), status: 'clarify', candidates: [row(), row('session-two')], target: undefined }
    expect(g.currentDelivery()).toBeNull()
    expect(JSON.stringify(g.deliveryConfirmationView())).toContain('DeliveryNoTarget')
    g.prepareDelivery(); expect(calls).toEqual([])
    g.locateResultRef.current = { ...located(), status: 'no_match', candidates: [], target: undefined, coverage: 'complete' }
    expect(g.currentDelivery()).toBeNull(); expect(calls).toEqual([])
  })

  it('prepares exactly one bound payload and shows the confirmation card with confirm and cancel buttons', async () => {
    const { g, calls, edit, bindImage, minted } = harness()
    const key = edit('  保留原字节 🧭\r\nnot a copied old instruction  ', 'steer'); bindImage()
    await g.prepareDelivery()
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('delivery'); expect(calls[0].input).toMatchObject({ action: 'prepare', epoch: 'epoch-one', operation: 'steer', text: '  保留原字节 🧭\r\nnot a copied old instruction  ',
      target: { sessionId: 'session-one', scopeRevision: scope, factRevision: fact }, images: [{ imageId: 'img-one', digest: imageDigest, seq: 1 }] })
    expect(minted()).toBe(2)
    const entry = g.deliveries[key]
    expect(entry).toMatchObject({ status: 'prepared', receipt: { state: 'prepared', humanConfirmed: false, delivered: false } })
    expect(entry.receipt.digest).toBe(deliveryDigest(calls[0].input))
    const view = g.deliveryConfirmationView(), elements = nodes(view)
    expect(JSON.stringify(view)).toContain('DeliveryConfirmSummary'); expect(JSON.stringify(view)).toContain('DeliveryConfirmHint')
    expect(elements.filter(node => node.tag === 'button').map(node => node.children[0])).toEqual(['DeliveryConfirm', 'DeliveryCancel'])
    expect(calls.map(value => value.path)).not.toContain('command'); expect(calls.map(value => value.path)).not.toContain('session-action')
  })

  it('confirms the exact prepared payload once and exposes only confirmed-pending-delivery', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Exact body to deliver'); await g.prepareDelivery()
    const prepared = calls[0]
    await g.confirmDelivery(key)
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual({ path: 'delivery', input: { ...prepared.input, action: 'confirm' } })
    const entry = g.deliveries[key]
    expect(entry).toMatchObject({ status: 'confirmed', receipt: { state: 'confirmed', humanConfirmed: true, delivered: false, accepted: false, executed: false, completed: false, disposition: 'confirmed-pending-delivery' } })
    const content = JSON.stringify(g.deliveryConfirmationView())
    expect(content).toContain('DeliveryConfirmed'); expect(content).toContain('DeliveryConfirmedHint'); expect(content).toContain('DeliveryHandoff')
    await g.confirmDelivery(key); expect(calls).toHaveLength(2)
  })

  it('invalidates the prepared object when the body or operation changes without sending a confirm', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Original body'); await g.prepareDelivery()
    const draftEntry = g.sessionActionsRef.current[key]
    g.sessionActionsRef.current = { ...g.sessionActionsRef.current, [key]: { ...draftEntry, text: 'Edited body' } }
    await g.confirmDelivery(key)
    expect(calls).toHaveLength(1)
    expect(g.deliveries[key]).toMatchObject({ status: 'draft', pending: null, receipt: null, error: 'DeliveryContentChanged' })
    g.sessionActionsRef.current = { ...g.sessionActionsRef.current, [key]: { ...draftEntry, operation: 'supplement' } }
    await g.prepareDelivery()
    expect(calls).toHaveLength(2); expect(g.deliveries[key]).toMatchObject({ status: 'prepared', receipt: { operation: 'supplement' } })
  })

  it('invalidates the prepared object when bound images change, keeping the draft intact', async () => {
    const { g, calls, edit, bindImage } = harness()
    const key = edit('Body with one image'); bindImage(); await g.prepareDelivery()
    expect(calls[0].input.images).toHaveLength(1)
    const extra = { id: 'img-two', digest: 'd'.repeat(64), status: 'bound', stale: false, receipt: { imageId: 'img-two', digest: 'd'.repeat(64), seq: 1, state: 'bound' } }
    bindImage({ items: [g.imageDraftsRef.current['epoch-one'].items[0], extra] })
    await g.confirmDelivery(key)
    expect(calls).toHaveLength(1)
    expect(g.deliveries[key]).toMatchObject({ status: 'draft', pending: null, error: 'DeliveryContentChanged' })
    expect(g.sessionActionsRef.current[key].text).toBe('Body with one image')
    expect(g.imageDraftsRef.current['epoch-one'].items).toHaveLength(2)
  })

  it('never confirms a prepared object after the located target changes, and preserves evidence by target', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Old target body'); await g.prepareDelivery()
    const old = g.deliveries[key]
    g.locateResultRef.current = located(row('session-one', 'e'.repeat(64)))
    expect(g.currentDelivery().key).not.toBe(key)
    await g.confirmDelivery(key)
    expect(calls).toHaveLength(1); expect(g.deliveries[key]).toBe(old)
  })

  it('cancels the local prepared object, keeps the draft and images, and never confirms', async () => {
    const { g, calls, edit, bindImage } = harness()
    const key = edit('Cancelled body'), image = bindImage(); await g.prepareDelivery()
    await g.cancelDelivery(key)
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'cancel'])
    expect(g.deliveries[key]).toMatchObject({ status: 'draft', pending: null, receipt: null })
    expect(g.sessionActionsRef.current[key].text).toBe('Cancelled body')
    expect(g.imageDraftsRef.current['epoch-one'].items).toEqual([image])
    expect(JSON.stringify(g.deliveryConfirmationView())).toContain('DeliveryPrepare')
    expect(calls.map(value => value.input.action)).not.toContain('confirm')
  })

  it('keeps an uncertain confirmation unknown, queries only the original status and never auto-retries', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Unknown confirmation body'); await g.prepareDelivery()
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (input.action === 'confirm') throw new Error('lost reply'); return receipt(input, 'prepared') }
    await g.confirmDelivery(key)
    expect(g.deliveries[key]).toMatchObject({ status: 'unknown' })
    const pending = g.deliveries[key].pending
    await g.confirmDelivery(key); expect(calls.filter(value => value.input.action === 'confirm')).toHaveLength(1)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return receipt({ ...pending, action: undefined }, 'confirmed') }
    await g.checkDeliveryStatus(key)
    expect(calls.at(-1)).toEqual({ path: 'delivery', input: { action: 'status', epoch: 'epoch-one', confirmationId: pending.confirmationId } })
    expect(g.deliveries[key]).toMatchObject({ status: 'confirmed', receipt: { delivered: false, accepted: false } })
    expect(calls.filter(value => value.input.action === 'confirm')).toHaveLength(1)
  })

  it('retains draft and target through navigation and only binds the same exact re-located target', async () => {
    const { g, calls, edit, draft } = harness()
    const key = edit('Keep while navigating'); await g.prepareDelivery()
    const prepared = g.deliveries[key]
    g.resetLocate(); g.systemRef.current = 'settings'
    expect(g.currentDelivery()).toBeNull(); expect(g.deliveries[key]).toBe(prepared)
    g.systemRef.current = 'locate'; g.locateResultRef.current = located(row())
    expect(g.currentDelivery().key).toBe(key)
    expect(g.sessionActionsRef.current[key].text).toBe('Keep while navigating')
    expect(g.deliveries[key]).toBe(prepared); expect(calls).toHaveLength(1)
    expect(g.composerRef.current).toBe(draft); expect(draft.draft).toBe('Main draft must not change')
  })

  it('rejects contradictory receipts and keeps the original evidence without a second request', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Receipt contract body')
    g.call = async (path: string, input: any) => { calls.push({ path, input }); const value: any = receipt(input); value.delivered = true; return value }
    await g.prepareDelivery()
    expect(g.deliveries[key]).toMatchObject({ status: 'unknown', pending: expect.any(Object) })
    expect(g.deliveries[key].receipt).toBeNull()
    await g.prepareDelivery()
    expect(calls).toHaveLength(1)
  })

  it('uses only the delivery route with no dispatch, send, steer or cancel side effect in source', () => {
    for (const name of ['prepareDelivery', 'confirmDelivery', 'cancelDelivery', 'deliveryConfirmationView']) {
      const value = initializer(name)
      expect(value, name).not.toMatch(/followup|steer\(|inject\(|agent\.cancel|call\('command'|call\('session-action'|updateComposer|composerRef/)
    }
    expect(initializer('prepareDelivery')).toContain("call('delivery'")
    expect(initializer('confirmDelivery')).toContain("call('delivery'")
    const languages = ['zh', 'en'].map(language => JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).panel)
    const keys = Object.keys(languages[0]).filter(key => key.startsWith('wDelivery'))
    expect(keys.length).toBeGreaterThanOrEqual(25)
    for (const key of keys) for (const locale of languages) expect(locale[key]).toBeTruthy()
    expect(languages[0].wDeliveryConfirmedHint).toContain('不等于投递'); expect(languages[1].wDeliveryConfirmedHint).toContain('not delivery')
    expect(languages[0].wDeliveryHint).toContain('确认前不发送'); expect(languages[1].wDeliveryHint).toContain('Nothing is sent')
  })
})
