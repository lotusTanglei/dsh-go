import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

// Execute actual pure state closures, not a React/DOM surrogate or visual proof.
const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any> = {}): any {
  let initializer = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) initializer = node.initializer.getText(tree)
    node.forEachChild(visit)
  }
  visit(tree)
  if (!initializer) throw new Error(`Missing actual state closure: ${name}`)
  const js = ts.transpileModule(`globalThis.actual = (${initializer})`, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText
  const context = createContext(globals)
  new Script(js).runInContext(context)
  return context.actual
}
function storage() {
  const data = new Map<string, string>()
  return { data, getItem(key: string) { return data.get(key) ?? null }, setItem(key: string, value: string) { data.set(key, value) } }
}
const plain = (value: any) => JSON.parse(JSON.stringify(value))

describe('actual composer state closures (not UI rendering)', () => {
  it('defaults only brand new state to planning, retaining an existing empty or legacy message draft', () => {
    const blankComposer = closure('blankComposer'), sessionStorage = storage()
    const read = closure('readComposer', { blankComposer, validDocumentOrigin: closure('validDocumentOrigin'), sessionStorage, storageKey: (epoch: string) => `draft:${epoch}` })
    expect(read('new').intent).toBe('new-task')
    for (const saved of [{ draft: '', intent: 'message' }, { draft: 'legacy body' }]) {
      sessionStorage.setItem('draft:current', JSON.stringify(saved))
      expect(read('current')).toMatchObject({ draft: saved.draft, intent: 'message' })
    }
    sessionStorage.setItem('draft:current', JSON.stringify({ draft: 'plan body', intent: 'new-task' }))
    expect(read('current')).toMatchObject({ draft: 'plan body', intent: 'new-task' })
  })

  it('restores exact document-origin drafts and pending requests, without leaking origin into chat or legacy state', () => {
    const blankComposer = closure('blankComposer'), sessionStorage = storage(), validDocumentOrigin = closure('validDocumentOrigin')
    const read = closure('readComposer', { blankComposer, validDocumentOrigin, sessionStorage, storageKey: (epoch: string) => `draft:${epoch}` })
    const documentOrigin = { kind: 'wecom-document', itemKey: 'a'.repeat(64), revision: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64), configVersion: 'd'.repeat(64) }
    const pending = { epoch: 'current', requestId: 'request-doc', text: 'Plan only', intent: 'new-task', documentOrigin }
    sessionStorage.setItem('draft:current', JSON.stringify({ draft: 'Plan only', intent: 'new-task', documentOrigin, pending }))
    expect(plain(read('current'))).toMatchObject({ documentOrigin, pending })
    for (const saved of [{ intent: 'message' }, { intent: 'new-task', target: { id: 'task' } }, { intent: 'new-task', origin: { id: 'old-task' } }]) {
      sessionStorage.setItem('draft:current', JSON.stringify({ draft: 'Preserve text', documentOrigin, ...saved }))
      expect(read('current').draft).toBe('Preserve text'); expect(read('current').documentOrigin).toBeNull()
    }
    sessionStorage.setItem('draft:current', JSON.stringify({ draft: 'Preserve text', intent: 'new-task', documentOrigin: { ...documentOrigin, url: 'https://untrusted.invalid' } }))
    expect(read('current').documentOrigin).toBeNull()
    sessionStorage.setItem('draft:current', JSON.stringify({ draft: 'Preserve text', intent: 'message', pending: { ...pending, intent: 'message' } }))
    expect(read('current').pending).toBeNull()
  })

  it('trusts source eligibility for task-bearing cells while requiring every available screenshot to render and explicit review', () => {
    const documentOrigin = { kind: 'wecom-document', itemKey: 'a'.repeat(64), revision: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64), configVersion: 'd'.repeat(64) }
    const documentImagesRef = { current: {} as any }, documentReviewedRef = { current: true }
    const canPlan = closure('documentCanPlan', { epochRef: { current: 'current' }, validDocumentOrigin: closure('validDocumentOrigin'), array: closure('array'), documentImagesRef, documentReviewedRef })
    const entry = { documentOrigin, eligible: true, state: 'candidate' }
    const detail = { documentOrigin, eligible: true, epoch: 'current', cells: [{ column: 'A', strike: 'no' }, { column: 'Z', strike: 'unknown' }], screenshots: [] }
    expect(canPlan(entry, detail)).toBe(true) // text-only task; unrelated unknown column does not override Source eligibility
    expect(canPlan({ ...entry, eligible: false }, detail)).toBe(false)
    expect(canPlan(entry, { ...detail, eligible: false })).toBe(false)
    for (const state of ['blocked', 'claimed', 'linked', 'stopped']) expect(canPlan({ ...entry, state }, detail)).toBe(false)
    const withImage = { ...detail, screenshots: [{ digest: 'e'.repeat(64) }] }
    expect(canPlan(entry, withImage)).toBe(false)
    documentImagesRef.current['e'.repeat(64)] = { loaded: false }; expect(canPlan(entry, withImage)).toBe(false)
    documentImagesRef.current['e'.repeat(64)] = { loaded: true }; expect(canPlan(entry, withImage)).toBe(true)
    documentReviewedRef.current = false; expect(canPlan(entry, withImage)).toBe(false)
    documentReviewedRef.current = true; expect(canPlan(entry, { ...detail, epoch: 'archived' })).toBe(false)
    expect(canPlan(entry, { ...detail, documentOrigin: { ...documentOrigin, revision: 'f'.repeat(64) } })).toBe(false)
  })

  it('permits manual unknown-format review only for exact reviewable snapshots, official original links, loaded evidence and owner acknowledgement', () => {
    const documentOrigin = { kind: 'wecom-document', itemKey: 'a'.repeat(64), revision: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64), configVersion: 'd'.repeat(64) }
    const documentImagesRef = { current: {} as any }, documentReviewedRef = { current: false }
    const canReview = closure('documentCanReview', { epochRef: { current: 'current' }, validDocumentOrigin: closure('validDocumentOrigin'), validDocumentLink: closure('validDocumentLink'), array: closure('array'), documentImagesRef, documentReviewedRef })
    const entry = { documentOrigin, eligible: false, reviewable: true, state: 'blocked' }
    const detail = { documentOrigin, eligible: false, reviewable: true, epoch: 'current', documentLink: 'https://doc.weixin.qq.com/sheet/id?tab=sheet_1', screenshots: [] }
    expect(canReview(entry, detail)).toBe(false)
    documentReviewedRef.current = true; expect(canReview(entry, detail)).toBe(true) // text-only task still needs explicit original-sheet attestation
    for (const patch of [{ reviewable: false }, { eligible: true }, { state: 'linked' }, { state: 'claimed' }, { state: 'stopped' }]) expect(canReview({ ...entry, ...patch }, detail)).toBe(false)
    for (const patch of [{ reviewable: false }, { eligible: true }, { epoch: 'archived' }, { documentOrigin: { ...documentOrigin, revision: 'f'.repeat(64) } }]) expect(canReview(entry, { ...detail, ...patch })).toBe(false)
    for (const documentLink of ['https://evil.invalid', 'javascript:alert(1)', 'https://user:pass@doc.weixin.qq.com/sheet/id?tab=sheet', 'https://doc.weixin.qq.com/sheet/id?tab=sheet#auth', 'https://doc.weixin.qq.com/sheet/id?tab=sheet&token=secret']) expect(canReview(entry, { ...detail, documentLink })).toBe(false)
    const withImage = { ...detail, screenshots: [{ digest: 'e'.repeat(64) }] }
    expect(canReview(entry, withImage)).toBe(false)
    documentImagesRef.current['e'.repeat(64)] = { loaded: true }; expect(canReview(entry, withImage)).toBe(true)
    documentImagesRef.current['e'.repeat(64)] = { loaded: false }; expect(canReview(entry, withImage)).toBe(false)
  })

  it('records an explicit exact review before enabling a separate plan draft and never sends a command', async () => {
    const documentOrigin = { kind: 'wecom-document', itemKey: 'a'.repeat(64), revision: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64), configVersion: 'd'.repeat(64) }
    const entry = { itemKey: documentOrigin.itemKey, revision: documentOrigin.revision, documentOrigin, eligible: false, reviewable: true, state: 'blocked' }
    const detail = { documentOrigin, eligible: false, reviewable: true, epoch: 'current', documentLink: 'https://doc.weixin.qq.com/sheet/id?tab=sheet_1', screenshots: [] }
    const documentDetailRef = { current: detail as any }, documentReviewedRef = { current: true }, documentImagesRef = { current: {} }, epochRef = { current: 'current' }
    const canReview = closure('documentCanReview', { epochRef, validDocumentOrigin: closure('validDocumentOrigin'), validDocumentLink: closure('validDocumentLink'), array: closure('array'), documentImagesRef, documentReviewedRef })
    const calls: any[] = [], notices: string[] = [], details: any[] = []
    let documents: any = { items: [entry] }
    const globals = { documentDetailRef, epochRef, composerRef: { current: { draft: '', pending: null, target: null, origin: null, documentOrigin: null } }, documentBusyRef: { current: false }, documentCanReview: canReview,
      draftEpochRef: { current: 'current' }, historyRef: { current: 'current' }, validDocumentOrigin: closure('validDocumentOrigin'), array: closure('array'), alive: { current: true },
      setDocumentBusy() {}, setDocumentError() {}, setDocumentDetail: (next: any) => details.push(next), setDocuments: (update: any) => { documents = update(documents) }, setNotice: (notice: string) => notices.push(notice), tr: (key: string) => key,
      call: async (path: string, input: any) => { calls.push({ path, input }); return { documentOrigin, eligible: true, reviewable: false, state: 'candidate' } },
    }
    await closure('reviewDocument', globals)(entry)
    expect(calls).toEqual([{ path: 'document-source', input: { action: 'review', epoch: 'current', itemKey: documentOrigin.itemKey, revision: documentOrigin.revision, evidenceDigest: documentOrigin.evidenceDigest, decision: 'reviewed-not-struck' } }])
    expect(details.at(-1)).toMatchObject({ eligible: true, reviewable: false })
    expect(documents.items[0]).toMatchObject({ eligible: true, reviewable: false, state: 'candidate' })
    expect(notices).toContain('DocumentReviewSaved')
    documentDetailRef.current = detail; documents = { items: [entry] }; calls.length = 0
    globals.composerRef.current.draft = 'Keep my draft'
    await closure('reviewDocument', globals)(entry)
    expect(calls).toEqual([]); expect(notices.at(-1)).toBe('ResolveDraftFirst')
  })

  it('clears document origin on intent/target changes and explicit cancellation without dropping draft text', () => {
    const origin = { kind: 'wecom-document', itemKey: 'a'.repeat(64), revision: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64), configVersion: 'd'.repeat(64) }
    const saved = { draft: 'Keep me', intent: 'new-task', documentOrigin: origin }, outcomes: any[] = []
    const update = closure('updateComposer', { draftEpochRef: { current: 'current' }, composerCache: { current: { current: saved } }, saveComposer: (_epoch: string, next: any) => outcomes.push(next) })
    for (const patch of [{ intent: 'message' }, { target: { id: 'task' } }, { origin: { id: 'old' } }, { documentOrigin: null }]) {
      update(patch); expect(outcomes.at(-1)).toMatchObject({ draft: 'Keep me', documentOrigin: null })
    }
  })

  it('preserves the exact pending recovery payload and task target rather than converting it to a new plan', () => {
    const blankComposer = closure('blankComposer'), sessionStorage = storage()
    const pending = { epoch: 'current', requestId: 'request-1', text: 'Original input', intent: 'ticket-input', ticketId: 'ticket-A' }
    const saved = { draft: 'Edited local draft', intent: 'message', pending, target: { id: 'ticket-A', title: 'A' } }
    sessionStorage.setItem('draft:current', JSON.stringify(saved))
    const read = closure('readComposer', { blankComposer, validDocumentOrigin: closure('validDocumentOrigin'), sessionStorage, storageKey: (epoch: string) => `draft:${epoch}` })
    expect(plain(read('current'))).toMatchObject(saved)
    expect(read('other').pending).toBeNull()
  })
})

function replyFixture(shared = storage()) {
  const conversations = { current: {} as Record<string, any> }, replyReadThrough = { current: {} as Record<string, number> }
  const replyBaselineReady = { current: {} as Record<string, boolean> }, replyWatermarks = { current: {} as Record<string, number> }
  const epochRef = { current: 'current' }, counts: number[] = []
  const setPage = closure('setConversationPage', { conversations, replyReadThrough, replyBaselineReady, replyWatermarks, epochRef,
    sessionStorage: shared, setNewReplies: (value: number) => counts.push(value), setConversation() {},
    array: (value: any) => Array.isArray(value) ? value : [], messageOrder: (a: any, b: any) => a.seq - b.seq,
    merge: (old: any[], incoming: any[]) => [...new Map([...old, ...incoming].map(item => [item.id, item])).values()],
  })
  const acknowledge = closure('readLatestReply', { conversations, replyReadThrough, epochRef, sessionStorage: shared, setNewReplies: (value: number) => counts.push(value) })
  return { shared, setPage, acknowledge, counts, replyBaselineReady, replyReadThrough, conversations }
}
const reply = (seq: number, body = 'Please clarify scope') => ({ id: 'reply', seq, lastSeq: seq, kind: 'assistant', text: body })

describe('actual reply baseline and explicit reading closures', () => {
  it('baselines an empty first successful read, then makes the first real clarification discoverable', () => {
    const h = replyFixture()
    h.setPage('current', { items: [] }, 'recent')
    expect(h.replyBaselineReady.current.current).toBe(true)
    expect(h.replyReadThrough.current.current).toBe(-1)
    h.setPage('current', { items: [], latestAssistant: reply(4) }, 'after')
    expect(h.counts.at(-1)).toBe(1)
  })

  it('does not relabel the historical latest reply as new on first visit, but flags a later reply', () => {
    const h = replyFixture()
    h.setPage('current', { items: [], latestAssistant: reply(4, 'Old fixture reply') }, 'recent')
    expect(h.counts.at(-1)).toBe(0)
    h.setPage('current', { items: [], latestAssistant: reply(8) }, 'after')
    expect(h.counts.at(-1)).toBe(1)
    expect(h.replyReadThrough.current.current).toBe(4)
  })

  it('persists an unread baseline across reload until the actual reply is explicitly opened', () => {
    const first = replyFixture()
    first.setPage('current', { items: [] }, 'recent')
    first.setPage('current', { items: [], latestAssistant: reply(8) }, 'after')
    const reloaded = replyFixture(first.shared)
    reloaded.setPage('current', { items: [], latestAssistant: reply(8) }, 'recent')
    expect(reloaded.counts.at(-1)).toBe(1)
    reloaded.acknowledge()
    expect(reloaded.counts.at(-1)).toBe(0)
    const afterReading = replyFixture(first.shared)
    afterReading.setPage('current', { items: [], latestAssistant: reply(8) }, 'recent')
    expect(afterReading.counts.at(-1)).toBe(0)
    afterReading.setPage('current', { items: [], latestAssistant: reply(9, 'Updated question') }, 'after')
    expect(afterReading.counts.at(-1)).toBe(1)
  })

  it('keeps the first reply visible when sending races the first history request', async () => {
    const h = replyFixture(), saved = { draft: 'Plan a scoped check', intent: 'new-task', pending: null, target: null, origin: null }
    const submit = closure('submit', {
      sendBusy: { current: false }, epochRef: { current: 'current' }, draftEpochRef: { current: 'current' }, historyRef: { current: 'current' },
      workspaceRef: { current: { capabilities: { send: true } } }, composerRef: { current: saved },
      replyBaselineReady: h.replyBaselineReady, replyReadThrough: h.replyReadThrough, conversations: h.conversations,
      sessionStorage: h.shared, validDocumentOrigin: closure('validDocumentOrigin'), mintId: () => 'immutable-request', TextEncoder, AbortController,
      sendController: { current: null }, alive: { current: true }, setSending() {}, updateComposer() {},
      call: async () => ({ accepted: true, stage: 'published' }), applyReceipt() {}, poke: { current() {} }, setNotice() {}, tr: (key: string) => key,
    })
    await submit()
    expect(h.replyReadThrough.current.current).toBe(-1)
    h.setPage('current', { items: [], latestAssistant: reply(4) }, 'recent')
    expect(h.counts.at(-1)).toBe(1)
  })

  it('does not acknowledge a current reply merely by loading older or archived history', () => {
    const h = replyFixture()
    h.setPage('current', { items: [] }, 'recent')
    h.setPage('current', { items: [], latestAssistant: reply(8) }, 'after')
    const counts = h.counts.length
    h.setPage('archive', { items: [], latestAssistant: reply(50) }, 'recent')
    h.setPage('current', { items: [], latestAssistant: reply(8) }, 'before')
    expect(h.counts).toHaveLength(counts)
    expect(h.replyReadThrough.current.current).toBe(-1)
  })
})
