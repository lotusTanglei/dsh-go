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
    humanConfirmed: state === 'confirmed', delivered: false, accepted: false, executed: false, completed: false, targetState: 'unknown',
    imageCapability: input.images.length ? 'supported' : 'not-required',
    disposition: state === 'confirmed' ? 'confirmed-pending-delivery' : state === 'canceled' ? 'canceled' : 'not-confirmed', durable: true, ...extra }
}
function dispatchReceipt(input: any, state = 'accepted', extra: any = {}) {
  const dispatchId = `00000000-0000-4000-8000-${'9'.repeat(12)}`
  const stop = input.operation === 'stop'
  return { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId, dispatchId, ...(stop ? {} : { messageId: `go:${dispatchId}` }),
    operation: input.operation, target: { ...input.target, project: { kind: 'project', key: 'project-one' } }, digest: deliveryDigest(input),
    bodyBytes: new TextEncoder().encode(input.text).length, images: input.images.map((item: any) => ({ ...item })),
    seq: state === 'accepted' || state === 'interrupted' ? 2 : 2, at: 200, updatedAt: 201, state, durable: true, humanConfirmed: true,
    delivered: state === 'accepted', accepted: state === 'accepted', interrupted: state === 'interrupted',
    executed: state === 'blocked' ? false : null, completed: state === 'blocked' ? false : null,
    disposition: state === 'accepted' ? 'target-durable-receipt' : state === 'interrupted' ? 'stop-interrupted' : state === 'blocked' ? 'not-dispatched' : 'reconcile-only',
    woke: false, ...(stop && state === 'interrupted' ? { stopEvidence: 'turn-aborted' } : {}), ...extra }
}
const stageLocated = (target = row(), revision = scope, code?: string) => ({ version: 1, status: 'located', ...(code ? { code } : {}), stage: null, intent: { action: 'continue', confidence: 0.9 }, receipt: null, locate: located(target, revision) })
function harness() {
  const calls: any[] = [], events: any[] = [], draft = { draft: 'Main draft must not change', target: { id: 'main-target' }, pending: { requestId: 'main-request' } }
  let id = 0
  const target = row(), updates: any[] = [], notices: string[] = [], navigations: string[] = []
  const g: any = {
    array, TextEncoder, crypto: webcrypto, h, button, React: { Fragment: 'fragment' }, text, time: String,
    tr: (key: string) => key, mintId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    alive: { current: true }, epochRef: { current: 'epoch-one' }, systemRef: { current: 'locate' },
    locateResultRef: { current: located(target) }, locateTextRef: { current: '' }, locateVersion: { current: 0 }, locateBusyRef: { current: null },
    sessionActionsRef: { current: {} }, deliveries: {}, deliveriesRef: { current: {} }, deliveryBusyRef: { current: null },
    imageDraftsRef: { current: {} },
    scopeProjectKey: (p: any) => p?.kind === 'project' && p.key ? `project:${p.key}` : p?.kind === 'unassigned' ? 'unassigned' : '',
    scopeProjectName: (p: any) => p?.name || p?.key, sessionSourceTitle: (value: any) => value.title,
    composerRef: { current: draft }, updates, notices, navigations,
    updateComposer: (value: any) => { updates.push(value) }, navigatePrimary: (tab: string) => { navigations.push(tab) }, setNotice: (value: string) => { notices.push(value) },
    inputRef: { current: null }, draftEpochRef: { current: 'epoch-one' }, imageBusyRef: { current: null },
    setDeliveries: (value: any) => { g.deliveries = value; events.push(value) },
    setLocateResult: (value: any) => { g.locateResultRef.current = value; events.push(value) }, setLocateBusy: (value: any) => { g.locateBusy = value }, setLocateError: (value: any) => { g.locateError = value; events.push(value) },
    call: async (path: string, input: any) => {
      calls.push({ path, input })
      if (path !== 'delivery') throw new Error(`delivery UI must not call ${path}`)
      if (input.action === 'confirm') return receipt(input, 'confirmed')
      if (input.action === 'cancel') return receipt(input, 'canceled')
      if (input.action === 'status') return receipt(input, 'prepared')
      if (input.action === 'dispatch') return dispatchReceipt(input, 'accepted')
      return receipt(input, 'prepared')
    },
  }
  for (const name of ['sessionActionKey', 'currentSessionAction', 'deliveryKey', 'currentDelivery', 'deliveryDraftText', 'deliveryStopReason', 'deliveryOperation',
    'selectDeliveryOperation', 'editDeliveryStopReason', 'deliveryImageRefs', 'deliveryImagePreviews',
    'deliveryPayload', 'deliveryDigest', 'saveDelivery', 'validDeliveryReceipt', 'deliveryStatusName', 'deliveryOperationName', 'deliverySummary',
    'prepareDelivery', 'confirmDelivery', 'validDeliveryDispatchReceipt', 'deliveryWakeCode', 'deliveryImageCode', 'deliveryBlockedName', 'deliveryBlockedHint', 'dispatchDelivery', 'cancelDelivery', 'checkDeliveryStatus', 'prepareAgainDelivery',
    'recreateFromStoppedDelivery', 'deliveryConfirmationView', 'resetLocate',
    'stageLocateEvidence', 'readLocate']) g[name] = closure(name, g)
  const edit = (textValue = '  本次人类文字\r\nKeep Unicode 🧭 exactly  ', operation = 'continue') => {
    const current = g.currentDelivery()
    g.sessionActionsRef.current = { ...g.sessionActionsRef.current, [current.key]: { ...current, text: textValue, operation, status: 'draft' } }
    return current.key
  }
  const bindImage = (overrides: any = {}) => {
    const current = g.currentDelivery(), epoch = current.epoch, item = { id: overrides.imageId || 'img-one', digest: overrides.digest || imageDigest, status: 'bound', stale: false,
      ...(overrides.src ? { src: overrides.src } : {}),
      receipt: { imageId: overrides.imageId || 'img-one', digest: overrides.digest || imageDigest, seq: overrides.seq || 1, state: 'bound' } }
    g.imageDraftsRef.current = { ...g.imageDraftsRef.current, [epoch]: { epoch, draftId: 'draft-one', selected: '', target: { ...current.target, project: { ...current.target.project } }, items: overrides.items || [item] } }
    return item
  }
  return { g, calls, events, draft, target, edit, bindImage, updates, notices, navigations, minted: () => id }
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
    g.selectDeliveryOperation(key, 'supplement')
    await g.prepareDelivery()
    expect(calls).toHaveLength(2); expect(calls[1].input.operation).toBe('supplement'); expect(g.deliveries[key]).toMatchObject({ status: 'prepared', receipt: { operation: 'supplement' } })
    g.selectDeliveryOperation(key, 'resume'); expect(g.deliveries[key].operation).toBe('supplement')
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

  it('shows verified local thumbnails, original-byte hints and the blocked visual-capability warning on the card', async () => {
    const { g, calls, edit, bindImage } = harness()
    const key = edit('Body with one image')
    bindImage({ src: 'blob:verified-original' })
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return input.action === 'confirm' ? receipt(input, 'confirmed', { imageCapability: 'unsupported' }) : receipt(input, 'prepared', { imageCapability: 'unsupported' }) }
    await g.prepareDelivery()
    const view = g.deliveryConfirmationView(), elements = nodes(view), content = JSON.stringify(view)
    expect(content).toContain('DeliveryImagesHint'); expect(content).toContain('DeliveryImagesOriginal')
    expect(elements.filter(node => node.tag === 'img').map(node => node.props.src)).toEqual(['blob:verified-original'])
    expect(content).toContain('DeliveryVisionUnsupported'); expect(content).not.toContain('DeliveryVisionUnknown')
    // Confirm keeps the same visible block: the warning is on the confirmation card, not after a failure.
    await g.confirmDelivery(key)
    const confirmed = JSON.stringify(g.deliveryConfirmationView())
    expect(confirmed).toContain('DeliveryConfirmed'); expect(confirmed).toContain('DeliveryVisionUnsupported')
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'confirm'])
    expect(calls[1].input.images).toEqual([{ imageId: 'img-one', digest: imageDigest, seq: 1 }])
  })

  it('treats unknown visual capability as blocked copy and never drops images to keep text sending', async () => {
    const { g, calls, edit, bindImage } = harness()
    compileUnknown: {
      const key = edit('Unknown capability body'); bindImage()
      g.call = async (path: string, input: any) => { calls.push({ path, input }); return receipt(input, 'prepared', { imageCapability: 'unknown' }) }
      await g.prepareDelivery()
      const content = JSON.stringify(g.deliveryConfirmationView())
      expect(content).toContain('DeliveryVisionUnknown'); expect(content).not.toContain('DeliveryVisionUnsupported')
      expect(g.deliveries[key].receipt.images).toHaveLength(1)
    }
  })

  it('keeps the image draft, body and target after a blocked image dispatch and offers only a fresh confirmation', async () => {
    const { g, calls, edit, bindImage } = harness()
    const image = bindImage(), key = edit('Blocked image delivery body')
    await g.prepareDelivery(); await g.confirmDelivery(key)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return dispatchReceipt(input, 'blocked', { code: 'delivery_image_model_unsupported' }) }
    await g.dispatchDelivery(key)
    expect(g.deliveries[key]).toMatchObject({ dispatchStatus: 'blocked', dispatch: { state: 'blocked', code: 'delivery_image_model_unsupported' } })
    const content = JSON.stringify(g.deliveryConfirmationView())
    expect(content).toContain('DeliveryVisionBlocked'); expect(content).toContain('DeliveryVisionBlockedHint'); expect(content).toContain('Code: delivery_image_model_unsupported')
    expect(content).not.toContain('DeliveryAccepted')
    // The draft body and the exact bound image are retained; nothing is silently removed.
    expect(g.sessionActionsRef.current[key].text).toBe('Blocked image delivery body')
    expect(g.imageDraftsRef.current['epoch-one'].items).toEqual([image])
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'confirm', 'dispatch'])
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

describe('colloquial locate consumes the stage endpoint before the existing confirmation card', () => {
  it.each(['继续修复回调这个项目的工作', '问一下修复回调的进展'])('routes %s through stage-locate into the exact confirmation card', async text => {
    const { g, calls } = harness()
    g.locateTextRef.current = text
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (path === 'stage-locate') return stageLocated(); throw new Error(`unexpected ${path}`) }
    await g.readLocate()
    expect(calls).toEqual([{ path: 'stage-locate', input: { epoch: 'epoch-one', text } }])
    expect(g.locateResultRef.current).toMatchObject({ status: 'located', target: { sessionId: 'session-one', project: { kind: 'project', key: 'project-one' } },
      revision: scope, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
    expect(g.currentDelivery()).toMatchObject({ epoch: 'epoch-one', target: { sessionId: 'session-one', scopeRevision: scope, factRevision: fact, project: { kind: 'project', key: 'project-one' } } })
    const content = JSON.stringify(g.deliveryConfirmationView())
    expect(content).toContain('DeliveryPrepare'); expect(content).toContain('session-one'); expect(content).not.toContain('DeliveryNoTarget')
    expect(calls.some(value => value.path === 'session-locate')).toBe(false)
  })

  it.each(['stage_locate_intent_invalid', 'stage_locate_intent_low_confidence'])('asks a follow-up question on %s and never silently falls back to literal search', async code => {
    const { g, calls } = harness()
    g.locateTextRef.current = '那个东西接着弄一下'
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return { version: 1, status: 'clarify', code, stage: null, intent: null, receipt: null, locate: null } }
    await g.readLocate()
    expect(calls.map(value => value.path)).toEqual(['stage-locate'])
    expect(g.locateResultRef.current).toMatchObject({ status: 'clarify', code, candidates: [], candidateTotal: 0, controlAvailable: false })
    expect(g.currentDelivery()).toBeNull()
    expect(JSON.stringify(g.deliveryConfirmationView())).toContain('DeliveryNoTarget')
    expect(g.locateError).toBe('')
    expect(initializer('locateView')).toContain('LocateIntentClarify')
  })

  it('falls back to the bounded literal chain only when the stage capability is unavailable', async () => {
    const { g, calls } = harness()
    g.locateTextRef.current = '继续修复回调'
    g.call = async (path: string, input: any) => {
      calls.push({ path, input })
      if (path === 'stage-locate') throw Object.assign(new Error('stage unavailable'), { status: 503, code: 'stage_models_call_unavailable' })
      if (path === 'session-locate') return located()
      throw new Error(`unexpected ${path}`)
    }
    await g.readLocate()
    expect(calls.map(value => value.path)).toEqual(['stage-locate', 'session-locate'])
    expect(calls[1].input).toEqual({ epoch: 'epoch-one', text: '继续修复回调' })
    expect(g.currentDelivery()).not.toBeNull()
    expect(JSON.stringify(g.deliveryConfirmationView())).toContain('DeliveryPrepare')
  })

  it('keeps clarify candidate rechecks on the exact literal chain without another stage call', async () => {
    const { g, calls } = harness(), candidate = row()
    g.locateTextRef.current = '修复回调'
    g.locateResultRef.current = { status: 'clarify', revision: scope, candidates: [candidate], controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' }
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (path === 'session-locate') return located(candidate); throw new Error(`unexpected ${path}`) }
    await g.readLocate(candidate)
    expect(calls).toEqual([{ path: 'session-locate', input: { epoch: 'epoch-one', text: '修复回调', sessionId: 'session-one', revision: scope } }])
    expect(g.currentDelivery()).not.toBeNull()
  })
})

describe('confirmed delivery dispatch UI contracts', () => {
  it('offers dispatch only after confirmation, sends the exact confirmed object once and renders accepted without completion', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Exact confirmed body\n保留原字节 🧭', 'supplement')
    await g.prepareDelivery(); await g.confirmDelivery(key)
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'confirm'])
    const before = nodes(g.deliveryConfirmationView()).filter(node => node.tag === 'button').map(node => node.children[0])
    expect(before).toEqual(['DeliveryDispatch'])
    expect(JSON.stringify(g.deliveryConfirmationView())).not.toContain('DeliveryCompleted')
    await g.dispatchDelivery(key)
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'confirm', 'dispatch'])
    expect(calls[2].input).toEqual({ action: 'dispatch', epoch: 'epoch-one', requestId: calls[1].input.requestId, confirmationId: calls[1].input.confirmationId,
      operation: 'supplement', text: 'Exact confirmed body\n保留原字节 🧭', target: calls[1].input.target, images: [] })
    expect(g.deliveries[key]).toMatchObject({ dispatchStatus: 'accepted', dispatch: { state: 'accepted', accepted: true, delivered: true, executed: null, completed: null, disposition: 'target-durable-receipt' } })
    const accepted = JSON.stringify(g.deliveryConfirmationView())
    expect(accepted).toContain('DeliveryAccepted'); expect(accepted).toContain('DeliveryAcceptedHint'); expect(accepted).not.toContain('DeliveryCompleted')
    await g.dispatchDelivery(key)
    expect(calls).toHaveLength(3)
  })

  it('renders a cold/blocked dispatch as blocked without completion and never retries it', async () => {
    const { g, calls, edit, bindImage } = harness()
    const key = edit('Blocked cold body'); bindImage(); await g.prepareDelivery(); await g.confirmDelivery(key)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (input.action === 'dispatch') return dispatchReceipt(input, 'blocked', { code: 'delivery_target_cold' }); return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared') }
    await g.dispatchDelivery(key)
    const entry = g.deliveries[key]
    expect(entry).toMatchObject({ dispatchStatus: 'blocked', error: 'DeliveryTargetCold', dispatch: { state: 'blocked', accepted: false, delivered: false, executed: false, completed: false, disposition: 'not-dispatched', code: 'delivery_target_cold' } })
    const content = JSON.stringify(g.deliveryConfirmationView())
    expect(content).toContain('DeliveryTargetCold'); expect(content).toContain('DeliveryDispatchBlocked'); expect(content).not.toContain('DeliveryAccepted')
    await g.dispatchDelivery(key)
    expect(calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(1)
  })

  it('keeps an uncertain dispatch unknown, offers reconciliation by the same dispatch, and never rewrites the draft', async () => {
    const { g, calls, edit, bindImage, draft } = harness()
    const key = edit('Unknown dispatch body', 'steer'); bindImage(); await g.prepareDelivery(); await g.confirmDelivery(key)
    const confirmedText = g.sessionActionsRef.current[key].text
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (input.action === 'dispatch') throw new Error('lost dispatch reply'); return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared') }
    await g.dispatchDelivery(key)
    expect(g.deliveries[key]).toMatchObject({ status: 'confirmed', dispatchStatus: 'dispatch_unknown', error: 'DeliveryDispatchUnknown' })
    expect(g.deliveries[key].dispatch).toBeUndefined()
    const unknown = JSON.stringify(g.deliveryConfirmationView())
    expect(unknown).toContain('DeliveryDispatchUnknown'); expect(unknown).toContain('DeliveryQueryDispatch'); expect(unknown).not.toContain('DeliveryAccepted')
    expect(g.sessionActionsRef.current[key].text).toBe(confirmedText)
    expect(g.imageDraftsRef.current['epoch-one'].items).toHaveLength(1)
    expect(g.composerRef.current).toBe(draft); expect(draft.draft).toBe('Main draft must not change')
    expect(calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(1)
    // Reconciling the same dispatch can surface target evidence; it mints no new confirmation.
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return dispatchReceipt(input, 'accepted', { seq: 3, at: 200, updatedAt: 210 }) }
    await g.dispatchDelivery(key)
    expect(g.deliveries[key]).toMatchObject({ dispatchStatus: 'accepted', dispatch: { state: 'accepted', accepted: true, seq: 3 } })
    expect(calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(2)
    expect(g.deliveries[key].dispatch.requestId).toBe(calls[1].input.requestId)
    expect(g.sessionActionsRef.current[key].text).toBe(confirmedText)
  })

  it('keeps a changed-content rejection local to the confirmation card without dispatching or touching drafts', async () => {
    const { g, calls, edit } = harness()
    const key = edit('Rejected changed body'); await g.prepareDelivery(); await g.confirmDelivery(key)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (input.action === 'dispatch') throw Object.assign(new Error('changed'), { status: 409 }); return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared') }
    await g.dispatchDelivery(key)
    expect(g.deliveries[key]).toMatchObject({ status: 'confirmed', error: 'DeliveryDispatchChanged' }); expect(g.deliveries[key].dispatch).toBeUndefined()
    expect(g.sessionActionsRef.current[key].text).toBe('Rejected changed body')
    expect(calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(1)
    const content = JSON.stringify(g.deliveryConfirmationView())
    expect(content).toContain('DeliveryDispatch'); expect(content).not.toContain('DeliveryAccepted')
  })

  it('dispatches through only the delivery route with no Agent, send or composer side effect, and ships localized states', () => {
    for (const name of ['dispatchDelivery', 'deliveryConfirmationView']) {
      const value = initializer(name)
      expect(value, name).not.toMatch(/followup|steer\(|inject\(|agent\.cancel|call\('command'|call\('session-action'|updateComposer|composerRef/)
    }
    expect(initializer('dispatchDelivery')).toContain("call('delivery'")
    const languages = ['zh', 'en'].map(language => JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).panel)
    for (const key of ['wDeliveryDispatch', 'wDeliveryAccepted', 'wDeliveryAcceptedHint', 'wDeliveryDispatchUnknown', 'wDeliveryDispatchBlocked', 'wDeliveryDispatchBlockedHint',
      'wDeliveryDispatchChanged', 'wDeliveryTargetCold', 'wDeliveryQueryDispatch', 'wLocateIntentClarify']) for (const locale of languages) expect(locale[key], key).toBeTruthy()
    expect(languages[0].wDeliveryAcceptedHint).toContain('不等于'); expect(languages[1].wDeliveryAcceptedHint).toContain('does not mean')
  })
})


describe('stop operation in the same confirmation card (human confirm, real Host evidence, honest states)', () => {
  const stopEntry = (h: ReturnType<typeof harness>, reason = 'Owner stopped this conversation') => {
    const key = h.g.currentDelivery().key
    h.g.selectDeliveryOperation(key, 'stop')
    h.g.editDeliveryStopReason(key, reason)
    expect(JSON.stringify(h.g.deliveryConfirmationView())).toContain('DeliveryStopHint')
    expect(JSON.stringify(h.g.deliveryConfirmationView())).toContain('DeliveryStopReason')
    return key
  }
  const buttons = (view: any) => nodes(view).filter(node => node.tag === 'button').map(node => node.children[0])

  it('prepares an empty-body stop, confirms the consequence, dispatches once and renders interrupted with recreate entry', async () => {
    const h = harness(), key = stopEntry(h)
    await h.g.prepareDelivery()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].input).toMatchObject({ action: 'prepare', operation: 'stop', text: 'Owner stopped this conversation', images: [] })
    expect(h.g.deliveries[key]).toMatchObject({ status: 'prepared', receipt: { operation: 'stop', bodyBytes: new TextEncoder().encode('Owner stopped this conversation').length } })
    const prepared = JSON.stringify(h.g.deliveryConfirmationView())
    expect(prepared).toContain('DeliveryStopConfirmSummary'); expect(prepared).toContain('DeliveryStopConfirmHint')
    expect(buttons(h.g.deliveryConfirmationView())).not.toContain('DeliveryComplete')
    await h.g.confirmDelivery(key)
    expect(h.g.deliveries[key].receipt).toMatchObject({ state: 'confirmed', delivered: false, accepted: false })
    expect(JSON.stringify(h.g.deliveryConfirmationView())).toContain('DeliveryStopDispatch')
    h.g.call = async (path: string, input: any) => {
      h.calls.push({ path, input })
      if (input.action === 'dispatch') return dispatchReceipt(input, 'interrupted')
      return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared')
    }
    await h.g.dispatchDelivery(key)
    expect(h.calls.map(value => value.input?.action)).toEqual(['prepare', 'confirm', 'dispatch'])
    expect(h.g.deliveries[key]).toMatchObject({ dispatchStatus: 'interrupted',
      dispatch: { state: 'interrupted', accepted: false, delivered: false, interrupted: true, executed: null, completed: null, disposition: 'stop-interrupted', stopEvidence: 'turn-aborted' } })
    expect(h.g.deliveries[key].dispatch.messageId).toBeUndefined()
    const view = h.g.deliveryConfirmationView(), content = JSON.stringify(view)
    expect(content).toContain('DeliveryStopInterrupted'); expect(content).toContain('DeliveryStopInterruptedHint')
    expect(content).toContain('DeliveryStopEvidenceTurn'); expect(content).not.toContain('DeliveryAccepted')
    expect(content).toContain('RecreateTask')
    // Same confirmed stop replays the stored receipt; the Host is never asked to cancel twice.
    await h.g.dispatchDelivery(key)
    expect(h.calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(1)
  })

  it('renders a cold stop as blocked without retry, then allows one fresh human confirmation', async () => {
    const h = harness(), key = stopEntry(h, '')
    h.g.call = async (path: string, input: any) => {
      h.calls.push({ path, input })
      if (input.action === 'dispatch') return dispatchReceipt(input, 'blocked', { code: 'delivery_target_cold' })
      return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared')
    }
    await h.g.prepareDelivery(); await h.g.confirmDelivery(key); await h.g.dispatchDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ dispatchStatus: 'blocked', error: 'DeliveryStopTargetCold', dispatch: { state: 'blocked', code: 'delivery_target_cold', accepted: false, delivered: false } })
    const blocked = JSON.stringify(h.g.deliveryConfirmationView())
    expect(blocked).toContain('DeliveryStopTargetCold'); expect(blocked).toContain('DeliveryStopBlockedHint'); expect(blocked).not.toContain('DeliveryStopInterrupted')
    await h.g.dispatchDelivery(key)
    expect(h.calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(1)
    // A blocked fence is terminal for its exact IDs; retry means a new human confirmation.
    h.g.prepareAgainDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ status: 'draft', dispatch: undefined, operation: 'stop', stopReason: '' })
    await h.g.prepareDelivery()
    const prepares = h.calls.filter(value => value.input?.action === 'prepare')
    expect(prepares).toHaveLength(2)
    expect(prepares[1].input.operation).toBe('stop'); expect(prepares[1].input.text).toBe('')
    expect(prepares[1].input.requestId).not.toBe(prepares[0].input.requestId)
    expect(prepares[1].input.confirmationId).not.toBe(prepares[0].input.confirmationId)
  })

  it('keeps an uncertain stop unknown and reconciles only the original dispatch', async () => {
    const h = harness(), key = stopEntry(h)
    await h.g.prepareDelivery(); await h.g.confirmDelivery(key)
    h.g.call = async (path: string, input: any) => {
      h.calls.push({ path, input })
      if (input.action === 'dispatch') throw new Error('lost cancel reply')
      return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared')
    }
    await h.g.dispatchDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ status: 'confirmed', dispatchStatus: 'dispatch_unknown', error: 'DeliveryStopUnknown' })
    const unknown = JSON.stringify(h.g.deliveryConfirmationView())
    expect(unknown).toContain('DeliveryStopUnknown'); expect(unknown).toContain('DeliveryQueryDispatch'); expect(unknown).not.toContain('DeliveryStopInterrupted')
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input }); return dispatchReceipt(input, 'interrupted', { seq: 3, at: 200, updatedAt: 210 }) }
    await h.g.dispatchDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ dispatchStatus: 'interrupted', dispatch: { state: 'interrupted', seq: 3 } })
    expect(h.calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(2)
    expect(h.g.deliveries[key].dispatch.requestId).toBe(h.g.deliveries[key].pending.requestId)
  })

  it('rejects forged stop receipts instead of claiming interruption', async () => {
    for (const forged of [
      { state: 'interrupted', accepted: true, delivered: true },
      { state: 'interrupted', messageId: 'go:00000000-0000-4000-8000-000000000009' },
      { state: 'interrupted', stopEvidence: undefined },
      { state: 'accepted', interrupted: false, accepted: true, delivered: true },
    ]) {
      const h = harness(), key = stopEntry(h)
      await h.g.prepareDelivery(); await h.g.confirmDelivery(key)
      h.g.call = async (path: string, input: any) => { h.calls.push({ path, input }); return { ...dispatchReceipt(input, 'interrupted'), ...forged } }
      await h.g.dispatchDelivery(key)
      expect(h.g.deliveries[key].dispatch, JSON.stringify(forged)).toBeUndefined()
      expect(h.g.deliveries[key].dispatchStatus).toBe('dispatch_unknown')
      expect(JSON.stringify(h.g.deliveryConfirmationView())).not.toContain('DeliveryStopInterrupted')
    }
  })

  it('new-task entry from an interrupted stop copies the requirement and never sends a session recreateFrom', async () => {
    const h = harness(), key = stopEntry(h)
    await h.g.prepareDelivery(); await h.g.confirmDelivery(key)
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input }); return dispatchReceipt(input, 'interrupted') }
    await h.g.dispatchDelivery(key)
    const recreate = nodes(h.g.deliveryConfirmationView()).find(node => node.tag === 'button' && node.children[0] === 'RecreateTask')
    expect(recreate).toBeDefined()
    // The explicit entry refuses to silently replace an occupied main draft.
    recreate.props.onClick(); expect(h.updates).toEqual([])
    h.g.composerRef.current = { draft: '', pending: null, target: null, origin: null }
    recreate.props.onClick()
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).toMatchObject({ intent: 'new-task', target: null, draft: 'Same session title', origin: { id: 'session-one', source: 'session', title: 'Same session title' } })
    expect(h.navigations).toEqual(['chat'])
    expect(h.draft.draft).toBe('Main draft must not change')
    expect(h.calls.map(value => value.input?.action)).toEqual(['prepare', 'confirm', 'dispatch'])
    // The growing origin chip keeps the source visible; only ticket origins may become recreateFrom.
    expect(initializer('recreate')).toContain("source: 'ticket'")
    expect(initializer('submit')).toContain("saved.origin.source !== 'session'")
    expect(initializer('submit')).toContain('recreateFrom: saved.origin.id')
    expect(initializer('recreateFromStoppedDelivery')).not.toMatch(/call\('delivery'|call\('command'|call\('session-action'/)
  })

  it('ships localized stop copy for the consequence, three honest states and the new-task entry', () => {
    const languages = ['zh', 'en'].map(language => JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).panel)
    for (const key of ['wSessionActionStop', 'wDeliveryStopHint', 'wDeliveryStopReason', 'wDeliveryStopReasonHint', 'wDeliveryStopNoReason', 'wDeliveryStopConfirmSummary', 'wDeliveryStopConfirmHint',
      'wDeliveryStopConfirm', 'wDeliveryStopDispatch', 'wDeliveryStopDispatching', 'wDeliveryStopInterrupted', 'wDeliveryStopInterruptedHint', 'wDeliveryStopEvidence',
      'wDeliveryStopEvidenceTurn', 'wDeliveryStopEvidenceCancel', 'wDeliveryStopUnknown', 'wDeliveryStopBlocked', 'wDeliveryStopBlockedHint', 'wDeliveryStopTargetCold',
      'wDeliveryStopPrepare', 'wDeliveryStopRecreateHint', 'wDeliveryStopReasonBytes', 'wDeliveryPrepareAgain']) for (const locale of languages) expect(locale[key], key).toBeTruthy()
    expect(languages[0].wDeliveryStopHint).toContain('不撤销已外发内容'); expect(languages[0].wDeliveryStopHint).toContain('不保证模型已完全停止')
    expect(languages[1].wDeliveryStopHint).toContain('does not undo content already sent'); expect(languages[1].wDeliveryStopHint).toContain('does not guarantee the model has fully stopped')
    expect(languages[0].wDeliveryStopInterruptedHint).toContain('不保证'); expect(languages[1].wDeliveryStopInterruptedHint).toContain('does not guarantee')
    expect(languages[0].wDeliveryStopConfirmHint).toContain('不会撤销已外发内容'); expect(languages[1].wDeliveryStopConfirmHint).toContain('does not undo content already sent')
    expect(languages[0].wDeliveryStopRecreateHint).toContain('不会被恢复'); expect(languages[1].wDeliveryStopRecreateHint).toContain('not resumed')
  })
})

describe('cold wake copy and evidence in the same confirmation card', () => {
  const cold = (h: ReturnType<typeof harness>) => {
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input }); return receipt(input, 'prepared', { targetState: 'cold' }) }
  }
  it('states on the confirmation card that dispatch will wake the cold conversation, before any wake side effect', async () => {
    const h = harness(), key = h.edit('Wake this cold target deliberately')
    cold(h)
    await h.g.prepareDelivery()
    expect(h.calls.map(value => value.input.action)).toEqual(['prepare'])
    const prepared = JSON.stringify(h.g.deliveryConfirmationView())
    expect(prepared).toContain('DeliveryColdWake'); expect(prepared).toContain('DeliveryConfirmSummary')
    expect(prepared).not.toContain('DeliveryAccepted')
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input }); return receipt(input, 'confirmed', { targetState: 'cold' }) }
    await h.g.confirmDelivery(key)
    const confirmed = JSON.stringify(h.g.deliveryConfirmationView())
    expect(confirmed).toContain('DeliveryColdWake'); expect(confirmed).toContain('DeliveryDispatch')
  })

  it('renders a failed wake as blocked with its fixed code and requires a fresh confirmation to retry', async () => {
    const h = harness(), key = h.edit('Blocked wake body')
    await h.g.prepareDelivery(); await h.g.confirmDelivery(key)
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input })
      if (input.action === 'dispatch') return dispatchReceipt(input, 'blocked', { code: 'delivery_wake_conflict' })
      return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared') }
    await h.g.dispatchDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ dispatchStatus: 'blocked', error: 'DeliveryWakeBlocked',
      dispatch: { state: 'blocked', code: 'delivery_wake_conflict', accepted: false, delivered: false, woke: false } })
    const blocked = JSON.stringify(h.g.deliveryConfirmationView())
    expect(blocked).toContain('DeliveryWakeBlocked'); expect(blocked).toContain('DeliveryWakeBlockedHint'); expect(blocked).toContain('delivery_wake_conflict')
    expect(blocked).not.toContain('DeliveryWoke'); expect(blocked).not.toContain('DeliveryAccepted')
    await h.g.dispatchDelivery(key)
    expect(h.calls.filter(value => value.input?.action === 'dispatch')).toHaveLength(1)
    expect(h.g.sessionActionsRef.current[key].text).toBe('Blocked wake body')
    h.g.prepareAgainDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ status: 'draft', dispatch: undefined })
    await h.g.prepareDelivery()
    const prepares = h.calls.filter(value => value.input?.action === 'prepare')
    expect(prepares).toHaveLength(2)
    expect(prepares[1].input.confirmationId).not.toBe(prepares[0].input.confirmationId)
  })

  it('renders accepted wake evidence and rejects forged woke receipts instead of claiming a wake', async () => {
    const h = harness(), key = h.edit('Woken before delivery')
    await h.g.prepareDelivery(); await h.g.confirmDelivery(key)
    const wakeId = h.g.mintId()
    const wake = { version: 1, wakeId, sessionId: 'session-one', from: 'cold', to: 'live', agentPreset: 'dsh-preset-original',
      model: { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'medium' } }
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input })
      if (input.action === 'dispatch') return dispatchReceipt(input, 'accepted', { woke: true, wake })
      return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared') }
    await h.g.dispatchDelivery(key)
    expect(h.g.deliveries[key]).toMatchObject({ dispatchStatus: 'accepted', dispatch: { woke: true, wake, accepted: true, delivered: true } })
    const accepted = JSON.stringify(h.g.deliveryConfirmationView())
    expect(accepted).toContain('DeliveryWoke'); expect(accepted).toContain('DeliveryWakePreset'); expect(accepted).toContain('dsh-preset-original')
    expect(accepted).toContain('DeliveryWakeModel'); expect(accepted).toContain('fake-model'); expect(accepted).toContain('DeliveryWakeId')
    expect(accepted).toContain('DeliveryAccepted'); expect(accepted).not.toContain('DeliveryCompleted')
    for (const forged of [
      { woke: undefined, wake: undefined },
      { woke: true, wake: undefined },
      { woke: false, wake },
      { woke: true, wake: { ...wake, sessionId: 'other-session' } },
      { woke: true, wake: { ...wake, from: 'live' } },
      { woke: true, wake: { ...wake, wakeId: 'not-a-uuid' } },
      { woke: true, wake: { ...wake, agentPreset: 'https://evil.example' } },
      { woke: true, wake: { ...wake, extra: true } },
      { woke: true, wake: { ...wake, model: { provider: 'p', model: 'm', extra: true } } },
    ]) {
      const g = harness(), forgedKey = g.edit('Forged wake body')
      await g.g.prepareDelivery(); await g.g.confirmDelivery(forgedKey)
      g.g.call = async (path: string, input: any) => { g.calls.push({ path, input })
        if (input.action === 'dispatch') return dispatchReceipt(input, 'accepted', forged as any)
        return receipt(input, input.action === 'confirm' ? 'confirmed' : 'prepared') }
      await g.g.dispatchDelivery(forgedKey)
      expect(g.g.deliveries[forgedKey].dispatch, JSON.stringify(forged)).toBeUndefined()
      expect(g.g.deliveries[forgedKey].dispatchStatus).toBe('dispatch_unknown')
      expect(JSON.stringify(g.g.deliveryConfirmationView())).not.toContain('DeliveryWoke')
    }
  })

  it('ships localized cold-wake and failed-wake copy in both languages', () => {
    const languages = ['zh', 'en'].map(language => JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).panel)
    for (const key of ['wDeliveryColdWake', 'wDeliveryWoke', 'wDeliveryWakePreset', 'wDeliveryWakeModel', 'wDeliveryWakeId', 'wDeliveryWakeBlocked', 'wDeliveryWakeBlockedHint']) {
      for (const locale of languages) expect(locale[key], key).toBeTruthy()
    }
    expect(languages[0].wDeliveryColdWake).toContain('唤醒'); expect(languages[1].wDeliveryColdWake).toContain('wake')
    expect(languages[0].wDeliveryWakeBlockedHint).toContain('不会自动重试'); expect(languages[1].wDeliveryWakeBlockedHint).toContain('never retried')
  })
})

describe('cold stop never claims a wake', () => {
  it('keeps the stop confirmation free of wake copy even when the target is cold', async () => {
    const h = harness(), key = h.g.currentDelivery().key
    h.g.selectDeliveryOperation(key, 'stop')
    h.g.editDeliveryStopReason(key, 'Owner stops a cold target')
    h.g.call = async (path: string, input: any) => { h.calls.push({ path, input }); return receipt(input, 'prepared', { targetState: 'cold' }) }
    await h.g.prepareDelivery()
    const prepared = JSON.stringify(h.g.deliveryConfirmationView())
    expect(prepared).toContain('DeliveryStopConfirmSummary'); expect(prepared).toContain('DeliveryStopHint')
    expect(prepared).not.toContain('DeliveryColdWake')
    expect(h.g.deliveries[key].receipt).toMatchObject({ operation: 'stop', targetState: 'cold' })
  })
})
