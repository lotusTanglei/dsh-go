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
    const read = closure('readComposer', { blankComposer, sessionStorage, storageKey: (epoch: string) => `draft:${epoch}` })
    expect(read('new').intent).toBe('new-task')
    for (const saved of [{ draft: '', intent: 'message' }, { draft: 'legacy body' }]) {
      sessionStorage.setItem('draft:current', JSON.stringify(saved))
      expect(read('current')).toMatchObject({ draft: saved.draft, intent: 'message' })
    }
    sessionStorage.setItem('draft:current', JSON.stringify({ draft: 'plan body', intent: 'new-task' }))
    expect(read('current')).toMatchObject({ draft: 'plan body', intent: 'new-task' })
  })

  it('preserves the exact pending recovery payload and task target rather than converting it to a new plan', () => {
    const blankComposer = closure('blankComposer'), sessionStorage = storage()
    const pending = { epoch: 'current', requestId: 'request-1', text: 'Original input', intent: 'ticket-input', ticketId: 'ticket-A' }
    const saved = { draft: 'Edited chat draft', intent: 'message', pending, target: { id: 'ticket-A', title: 'A' } }
    sessionStorage.setItem('draft:current', JSON.stringify(saved))
    const read = closure('readComposer', { blankComposer, sessionStorage, storageKey: (epoch: string) => `draft:${epoch}` })
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
      imageBusyRef: { current: null }, imageDraftsRef: { current: {} }, array: (value: any) => Array.isArray(value) ? value : [],
      replyBaselineReady: h.replyBaselineReady, replyReadThrough: h.replyReadThrough, conversations: h.conversations,
      sessionStorage: h.shared, mintId: () => 'immutable-request', TextEncoder, AbortController,
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
