import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import { webcrypto, createHash } from 'node:crypto'
import { TextEncoder } from 'node:util'
import ts from 'typescript'

const source = readFileSync('src/client/go-decisions.ts', 'utf8'), tree = ts.createSourceFile('go-decisions.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any>): any {
  let init = ''; const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) init = node.initializer.getText(tree); node.forEachChild(walk) }; walk(tree)
  if (!init) throw new Error(`Missing ${name}`)
  const context = createContext(globals); new Script(ts.transpileModule(`globalThis.actual=(${init})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context); return context.actual
}
const scope = 'a'.repeat(64), fact = 'b'.repeat(64), revision = 'c'.repeat(64), uuid = '11111111-1111-4111-8111-111111111111'
const target = { sessionId: 'session-one', scopeRevision: scope, factRevision: fact, project: { kind: 'project', key: 'project-one' } }
const candidate = { sessionId: target.sessionId, factRevision: fact, project: target.project, title: 'Handle work' }
const located = { status: 'located', coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', revision: scope, target: candidate, candidates: [candidate] }
const question = { id: 'q1', question: 'Choose a plan?', options: [{ label: 'Keep compatibility', description: 'Retain old clients' }, { label: 'New only' }] }
const questionCall = { callId: 'call-one', state: 'continued', questions: [question], canAnswer: false }
const list = (extra: any = {}) => ({ target, availability: 'live', complete: true, asOfSeq: 12, snapshotRevision: revision, calls: [questionCall], canAnswer: false, approval: false, code: 'session_decision_execution_unverified', ...extra })
const clone = (value: any) => JSON.parse(JSON.stringify(value))
function harness() {
  const calls: any[] = [], events: any[] = [], g: any = { TextEncoder, Uint8Array, crypto: webcrypto, tr: (key: string) => key,
    array: (v: any) => Array.isArray(v) ? v : [], mounted: { current: true }, generation: { current: 0 }, composing: { current: false }, busyRef: { current: null }, listsRef: { current: {} }, entriesRef: { current: {} }, selectedRef: { current: '' }, opener: { current: null }, mint: () => uuid,
    call: async (input: any) => { calls.push(input); return list() },
  }
  for (const name of ['hashValid', 'idValid', 'plain', 'bytes', 'digestValue', 'bindingKey', 'locatedBinding', 'sameTarget', 'validQuestion', 'validList', 'listDigest', 'canonicalAnswers', 'inputDigest', 'answerSummary', 'callKey', 'emptyAnswer', 'compileAnswers', 'validReceipt', 'validClosure']) g[name] = closure(name, g)
  const current = g.locatedBinding('epoch', located); g.viewRef = { current: { epoch: 'epoch', active: true, current } }; g.listsRef.current[current.key] = list()
  for (const key of ['Entries', 'Lists', 'Selected', 'History', 'Error', 'Busy']) g[`set${key}`] = (v: any) => { g[key[0]!.toLowerCase() + key.slice(1)] = v; events.push([key, v]) }
  for (const name of ['saveEntry', 'activeEntry', 'unresolved', 'canClose', 'readQuestions', 'openCall', 'editAnswer', 'checkAnswers', 'checkStatus', 'confirmClose', 'closeDecision', 'newDraft']) g[name] = closure(name, g)
  return { g, calls, events, current }
}
function opened(g: any) { g.openCall(questionCall.callId); return g.entriesRef.current[g.selectedRef.current] }
async function receipt(g: any, entry: any, state = 'blocked', extra: any = {}) {
  const input = entry.pending, uncertain = ['dispatch_unknown', 'accepted'].includes(state)
  return { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, target: entry.target, callId: input.callId, snapshot: input.snapshot, digest: entry.digest, answerSummary: entry.summary, seq: ({ recorded: 1, blocked: 2, dispatch_unknown: 2, accepted: 3 } as any)[state], at: 100, updatedAt: 100, state, code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', durable: true, accepted: state === 'accepted', executed: uncertain ? null : false, completed: uncertain ? null : false, approval: false, disposition: state === 'accepted' ? 'target-durable-receipt' : state === 'dispatch_unknown' ? 'reconcile-only' : 'not-dispatched', ...(uncertain ? { controlRevision: 'd'.repeat(64), grantRevision: 'e'.repeat(64) } : {}), ...extra }
}

function closedReceipt(entry: any, extra: any = {}) {
  const input = entry.pending
  return { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, target: clone(input.target), callId: input.callId, snapshot: clone(input.snapshot), digest: entry.digest, seq: 1, at: 100, updatedAt: 100, state: 'closed', bindingVerified: false, durable: true, accepted: false, executed: null, completed: null, approval: false, disposition: 'closed-before-dispatch', code: 'session_decision_id_closed', ...extra }
}
async function unknownEntry(g: any, calls: any[]) {
  opened(g); g.editAnswer('q1', 'mode', 'custom'); g.editAnswer('q1', 'custom', 'Original exact answer 原文\n  not consent')
  g.call = async (input: any) => { calls.push(input); throw new Error('timeout') }; await g.checkAnswers()
  return { key: g.selectedRef.current, entry: g.entriesRef.current[g.selectedRef.current] }
}
function factoryHarness() {
  const slots: any[] = [], dependencies = new Map<number, any[]>(), cleanups = new Map<number, any>(), effects: Array<() => void> = [], listeners = new Set<() => void>(), requests: any[] = []
  let cursor = 0, props = { epoch: 'epoch', active: true, located }, respond = async (_input: any): Promise<any> => { throw new Error('not configured') }
  const React = {
    Fragment: 'fragment', createElement: (tag: any, attrs: any, ...children: any[]) => ({ tag, props: attrs, children }),
    useRef: (initial: any) => { const index = cursor++; return slots[index] ||= { current: initial } },
    useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = value; for (const listener of [...listeners]) listener() }] },
    useEffect: (effect: () => any, deps: any[]) => { const index = cursor++, old = dependencies.get(index); if (!old || old.length !== deps.length || deps.some((value, i) => value !== old[i])) { dependencies.set(index, deps); effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()) }) } },
  }
  const context = createContext({ React, TextEncoder, Uint8Array, AbortController, crypto: webcrypto }); new Script(ts.transpileModule(source.replace('export function createGoDecisions', 'function createGoDecisions') + '\nglobalThis.factory=createGoDecisions', { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  const { Decisions } = (context as any).factory(React, async (path: string, input: any) => { expect(path).toBe('session-decision'); requests.push(input); return respond(input) }, (key: string) => key)
  const nodes = (value: any): any[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
  const render = (patch: any = {}) => { props = { ...props, ...patch }; cursor = 0; let view = Decisions(props); const pending = effects.splice(0); for (const effect of pending) effect(); if (pending.length) { cursor = 0; view = Decisions(props); for (const effect of effects.splice(0)) effect() }; return view }
  const waitFor = (predicate: () => boolean) => predicate() ? Promise.resolve() : new Promise<void>(resolve => { const listener = () => { if (predicate()) { listeners.delete(listener); resolve() } }; listeners.add(listener) })
  const entry = () => Object.values(slots[2] || {}).find((value: any) => !value.history) as any
  const button = (label: string) => nodes(render()).find(node => node.tag === 'button' && node.children.includes(label))
  return { slots, requests, nodes, render, entry, button, waitFor, respond: (handler: typeof respond) => { respond = handler } }
}

// Actual factory closures and fake React hooks only: no DOM/browser/visual proof.
describe('G6 exact business answer closures', () => {
  it('factory renders only the active list/detail, literal text and disabled cold/open checks without a DOM', async () => {
    const slots: any[] = [], effects: Array<() => any> = []; let cursor = 0, installed: any
    const listInstalled = new Promise<void>(yes => { installed = yes })
    const React = { Fragment: 'fragment', createElement: (tag: any, props: any, ...children: any[]) => ({ tag, props, children }), useRef: (initial: any) => { const index = cursor++; return slots[index] ||= { current: initial } }, useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = value; if (index === 0 && Object.keys(value).length) installed() }] }, useEffect: (effect: any) => { effects.push(effect) } }
    const context = createContext({ React, TextEncoder, Uint8Array, AbortController, crypto: webcrypto }); new Script(ts.transpileModule(source.replace('export function createGoDecisions', 'function createGoDecisions') + '\nglobalThis.factory=createGoDecisions', { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
    const { g } = harness(), dto = list({ availability: 'cold', calls: [{ ...questionCall, questions: [{ ...question, question: '<script>untrusted</script>' }] }] }); dto.snapshotRevision = await g.listDigest(target, dto)
    const requests: any[] = [], { Decisions } = (context as any).factory(React, async (_path: string, input: any) => { requests.push(input); return dto }, (v: string) => v)
    const render = (active: boolean) => { cursor = 0; return Decisions({ epoch: 'epoch', active, located }) }
    const nodes = (value: any): any[] => value && typeof value === 'object' ? [value, ...g.array(value.children).flatMap(nodes)] : []
    expect(render(false)).toBeNull(); for (const effect of effects.splice(0)) effect()
    let view = render(true); for (const effect of effects.splice(0)) effect()
    await nodes(view).find((node: any) => node.tag === 'button' && node.children.includes('读取当前目标问题')).props.onClick()
    // Event handlers are fire-and-forget; the actual list state setter signals completion.
    await listInstalled
    view = render(true); const detail = nodes(view).find((node: any) => node.tag === 'button' && node.children.includes('查看原问题与答案草稿')); expect(detail).toBeTruthy(); detail.props.onClick(); view = render(true)
    const elements = nodes(view); expect(elements.some((node: any) => node.tag === 'p' && node.children.includes('<script>untrusted</script>'))).toBe(true); expect(elements.some((node: any) => node.tag === 'script' || node.props?.dangerouslySetInnerHTML)).toBe(false)
    expect(elements.find((node: any) => node.tag === 'button' && node.children.includes('核对答案（不发送）')).props.disabled).toBe(true); expect(requests.map(input => input.action)).toEqual(['list'])
  })
  it('requires exact located target, project, scope and fact evidence', () => {
    const { g } = harness(); expect(g.locatedBinding('epoch', located).target).toEqual(target)
    for (const patch of [{ status: 'clarify' }, { coverage: 'partial' }, { revision: 'bad' }, { controlAvailable: true }, { target: { ...candidate, factRevision: 'f'.repeat(64) } }, { target: { ...candidate, project: { kind: 'unknown', key: 'unknown' } } }]) expect(g.locatedBinding('epoch', { ...located, ...patch })).toBeNull()
  })
  it('validates exact original question DTO and never accepts canAnswer or approval upgrades', () => {
    const { g, current } = harness(); expect(g.validList(list(), current)).toBe(true)
    for (const patch of [{ canAnswer: true }, { approval: true }, { target: { ...target, factRevision: 'f'.repeat(64) } }, { calls: [{ ...questionCall, questions: [question, question] }] }, { snapshotRevision: 'invalid' }]) expect(g.validList(list(patch), current)).toBe(false)
  })
  it('preserves bounded Unicode and prototype-like question IDs as exact IDs, not inherited form values', () => {
    const { g } = harness()
    for (const id of ['范围说明 🌏', '__proto__', 'constructor', 'toString']) {
      const q = { ...question, id }, call = { ...questionCall, questions: [q] }
      expect(g.validQuestion(q)).toBe(true)
      expect(g.compileAnswers(call, {})).toBeNull()
      g.listsRef.current[g.viewRef.current.current.key] = list({ calls: [call] }); opened(g)
      g.editAnswer(id, 'mode', 'custom'); g.editAnswer(id, 'custom', 'Exact answer')
      const entry = g.entriesRef.current[g.selectedRef.current]
      expect(Object.hasOwn(entry.form, id)).toBe(true)
      expect(g.compileAnswers(call, entry.form)).toEqual([{ id, selected: [], custom: 'Exact answer' }])
      g.entriesRef.current = {}; g.selectedRef.current = ''
    }
    expect(g.validQuestion({ ...question, id: 'x'.repeat(513) })).toBe(false)
    expect(g.validQuestion({ ...question, id: 'q\u0000x' })).toBe(false)
  })
  it('requires every question answered or explicitly skipped; blank is never consent', () => {
    const { g } = harness(), call = { ...questionCall, questions: [question, { id: 'q2', question: 'Another?' }] }
    expect(g.compileAnswers(call, {})).toBeNull()
    expect(g.compileAnswers(call, { q1: { mode: 'custom', custom: 'Explain independently' } })).toBeNull()
    expect(g.compileAnswers(call, { q1: { mode: 'custom', custom: 'Explain independently' }, q2: { mode: 'skip', custom: 'hidden', selected: ['hidden'] } })).toEqual([{ id: 'q1', selected: [], custom: 'Explain independently' }, { id: 'q2', selected: [], skip: true }])
  })
  it('preserves distinct option-combination conditions and custom drafts while excluding hidden content', () => {
    const { g } = harness(); opened(g)
    g.editAnswer('q1', 'option', 'Keep compatibility'); g.editAnswer('q1', 'adding', true); g.editAnswer('q1', 'conditions', 'Only old API v2\nDo not approve tools')
    g.editAnswer('q1', 'option', 'New only'); g.editAnswer('q1', 'adding', true); g.editAnswer('q1', 'conditions', 'Migrate first')
    g.editAnswer('q1', 'mode', 'custom'); g.editAnswer('q1', 'custom', 'A third plan')
    let entry = g.entriesRef.current[g.selectedRef.current]; expect(g.compileAnswers(questionCall, entry.form)).toEqual([{ id: 'q1', selected: [], custom: 'A third plan' }])
    g.editAnswer('q1', 'option', 'Keep compatibility'); entry = g.entriesRef.current[g.selectedRef.current]; expect(g.compileAnswers(questionCall, entry.form)[0].custom).toBe('Only old API v2\nDo not approve tools')
    g.editAnswer('q1', 'adding', false); entry = g.entriesRef.current[g.selectedRef.current]; expect(g.compileAnswers(questionCall, entry.form)).toEqual([{ id: 'q1', selected: ['Keep compatibility'] }])
    g.editAnswer('q1', 'mode', 'custom'); expect(g.entriesRef.current[g.selectedRef.current].form.q1.custom).toBe('A third plan')
  })
  it('allows multiple selections only for multiSelect and retains their exact order', () => {
    const { g } = harness(), multi = { ...questionCall, questions: [{ ...question, multiSelect: true }] }; const form = { q1: { mode: 'options', selected: ['New only', 'Keep compatibility'] } }
    expect(g.compileAnswers(multi, form)[0].selected).toEqual(['New only', 'Keep compatibility']); expect(g.compileAnswers(questionCall, form)).toBeNull()
  })
  it.each([{ availability: 'cold' }, { complete: false }, { calls: [{ ...questionCall, state: 'open' }] }])('shows but never checks unanswerable projections %j', async patch => {
    const { g, calls, current } = harness(); g.listsRef.current[current.key] = list(patch); opened(g); g.editAnswer('q1', 'mode', 'skip'); await g.checkAnswers(); expect(calls).toEqual([])
  })
  it('prepares one exact immutable payload and validates matching blocked receipt and answer digest without sending approval', async () => {
    const { g, calls } = harness(); opened(g); g.editAnswer('q1', 'mode', 'custom'); g.editAnswer('q1', 'custom', 'Original Unicode 原文\n  do not trim')
    g.call = async (input: any) => { calls.push(input); return receipt(g, g.entriesRef.current[g.selectedRef.current]) }; await g.checkAnswers()
    const input = calls[0]; expect(Object.keys(input).sort()).toEqual(['action', 'epoch', 'requestId', 'actionId', 'target', 'callId', 'snapshot', 'answers'].sort()); expect(input.action).toBe('prepare'); expect(input.target).toEqual({ sessionId: target.sessionId, scopeRevision: scope, factRevision: fact }); expect(input.answers[0].custom).toBe('Original Unicode 原文\n  do not trim')
    const entry = g.entriesRef.current[g.selectedRef.current]; expect(entry.status).toBe('blocked'); expect(entry.receipt.approval).toBe(false); expect(entry.receipt.executed).toBe(false)
    const expected = createHash('sha256').update(JSON.stringify([input.epoch, input.requestId, input.actionId, input.target.sessionId, scope, fact, input.callId, 12, revision, [['q1', [], input.answers[0].custom, false]]])).digest('hex'); expect(entry.digest).toBe(expected)
    await g.checkAnswers(); expect(calls).toHaveLength(1)
  })
  it('retains uncertain payload and performs status only, never new IDs, retries, or 404-as-no-delivery', async () => {
    const { g, calls } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); g.call = async (input: any) => { calls.push(input); throw Object.assign(new Error('lost'), { status: 404 }) }
    await g.checkAnswers(); const key = g.selectedRef.current, old = g.entriesRef.current[key].pending; expect(g.entriesRef.current[key].status).toBe('unknown')
    await g.checkAnswers(); g.newDraft(); await g.checkStatus(key)
    expect(calls.map(input => input.action)).toEqual(['prepare', 'status']); expect(calls[1]).toEqual({ action: 'status', epoch: 'epoch', actionId: old.actionId }); expect(g.entriesRef.current[key].pending).toBe(old); expect(g.entriesRef.current[key].error).toBe('NotFound')
  })
  it('blocks old epoch status recovery and competing unknown drafts', async () => {
    const { g, calls } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); g.call = async (input: any) => { calls.push(input); throw new Error('unknown') }; await g.checkAnswers()
    const key = g.selectedRef.current; g.viewRef.current.epoch = 'other'; await g.checkStatus(key); expect(calls).toHaveLength(1); expect(g.unresolved()).toBe(true)
  })
  it('retains late receipt under original target and rejects navigation during async hashing before any request', async () => {
    const { g, calls } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); let resolve: any
    g.inputDigest = () => new Promise(yes => { resolve = yes }); const pending = g.checkAnswers(); g.generation.current++; resolve('f'.repeat(64)); await pending; expect(calls).toEqual([])
    const other = harness(); opened(other.g); other.g.editAnswer('q1', 'mode', 'skip'); let finish: any, started: any; const began = new Promise<void>(yes => { started = yes }); other.g.call = (input: any) => { other.calls.push(input); started(); return new Promise(yes => { finish = yes }) }; const request = other.g.checkAnswers(); await began; const key = other.g.selectedRef.current, entry = other.g.entriesRef.current[key]; other.g.viewRef.current.current = null; other.g.viewRef.current.active = false; other.g.generation.current++; finish(await receipt(other.g, entry)); await request
    expect(other.g.entriesRef.current[key].status).toBe('blocked'); expect(other.calls).toHaveLength(1)
  })
  it('uses new snapshot keys with no old answers copied, and creates empty blocked drafts only explicitly', async () => {
    const { g, current } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); g.call = async () => receipt(g, g.entriesRef.current[g.selectedRef.current]); await g.checkAnswers(); const original = g.entriesRef.current[g.selectedRef.current]; g.newDraft(); expect(g.entriesRef.current[g.selectedRef.current].form).toEqual({}); expect(g.entriesRef.current[`history:${original.pending.actionId}`].pending).toBe(original.pending)
    g.listsRef.current[current.key] = list({ snapshotRevision: 'd'.repeat(64) }); g.openCall(questionCall.callId); expect(g.entriesRef.current[g.selectedRef.current].form).toEqual({}); expect(g.entriesRef.current[g.selectedRef.current].snapshot.revision).toBe('d'.repeat(64))
  })
  it.each(['epoch', 'actionId', 'callId', 'digest', 'snapshot', 'target', 'answerSummary', 'seq', 'approval', 'durable', 'executed'])('rejects contradictory receipt field %s without success', async field => {
    const { g } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); g.call = async () => { const result = await receipt(g, g.entriesRef.current[g.selectedRef.current]); result[field] = field === 'approval' ? true : field === 'seq' ? 3 : field === 'executed' ? null : 'wrong'; return result }; await g.checkAnswers(); expect(g.entriesRef.current[g.selectedRef.current].status).toBe('unknown')
  })
  it('honors composition and inactive lifecycle before issuing requests', async () => {
    const { g, calls } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); g.composing.current = true; await g.checkAnswers(); g.composing.current = false; g.viewRef.current.active = false; await g.checkAnswers(); expect(calls).toEqual([])
  })
  it('verifies the complete original-question snapshot digest before installing a list', async () => {
    const { g, current } = harness(), dto = list(); dto.snapshotRevision = await g.listDigest(target, dto); g.call = async () => dto; await g.readQuestions(); expect(g.listsRef.current[current.key].snapshotRevision).toBe(dto.snapshotRevision)
    g.call = async () => ({ ...dto, calls: [{ ...questionCall, questions: [{ ...question, question: 'Tampered question' }] }] }); await g.readQuestions(); expect(g.error).toBe('Changed'); expect(g.listsRef.current[current.key].snapshotRevision).toBe(dto.snapshotRevision)
  })
  it('reads the list only on explicit user request and ignores stale in-flight snapshots', async () => {
    const { g, calls, current } = harness(); let finish: any; g.call = (input: any) => { calls.push(input); return new Promise(yes => { finish = yes }) }
    const reading = g.readQuestions(); g.generation.current++; finish(list({ snapshotRevision: 'e'.repeat(64) })); await reading
    expect(calls).toEqual([{ action: 'list', epoch: 'epoch', target: { sessionId: target.sessionId, scopeRevision: scope, factRevision: fact } }]); expect(g.listsRef.current[current.key].snapshotRevision).toBe(revision)
  })
  it('requires a separate explicit close confirmation and sends only the complete original payload with no mint or reprepare', async () => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls), original = entry.pending
    g.mint = () => { throw new Error('must not mint') }; g.call = async (input: any) => { calls.push(input); return closedReceipt(g.entriesRef.current[key]) }
    await g.closeDecision(key); expect(calls).toHaveLength(1)
    g.confirmClose(key, true); expect(calls).toHaveLength(1); expect(g.entriesRef.current[key].closeRequested).toBeUndefined()
    g.confirmClose(key, false); await g.closeDecision(key); expect(calls).toHaveLength(1)
    g.confirmClose(key, true); await g.closeDecision(key)
    expect(calls.map(input => input.action)).toEqual(['prepare', 'close']); expect(calls[1]).toEqual({ action: 'close', ...original })
    const closed = g.entriesRef.current[key]; expect(closed.status).toBe('closed'); expect(closed.closeRequested).toBe(true); expect(closed.pending).toBe(original); expect(closed.call).toBe(entry.call); expect(closed.form).toBe(entry.form); expect(closed.receipt).not.toHaveProperty('answerSummary'); expect(closed.receipt.target).not.toHaveProperty('project'); expect(g.unresolved()).toBe(false)
    await g.checkAnswers(); await g.closeDecision(key); await g.checkStatus(key); expect(calls).toHaveLength(2)
    g.newDraft(); const draft = g.entriesRef.current[key], history = g.entriesRef.current[`history:${original.actionId}`]
    expect(draft.form).toEqual({}); expect(draft.pending).toBeUndefined(); expect(draft.status).toBe('draft'); expect(history.pending).toBe(original); expect(history.form).toBe(entry.form); expect(history.receipt).toBe(closed.receipt); expect(calls).toHaveLength(2)
  })
  it('keeps closeRequested on timeout and 404, then recovers only a verified same-ID closed status', async () => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls)
    g.confirmClose(key, true); await g.closeDecision(key); expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.entriesRef.current[key].closeRequested).toBe(true); expect(g.entriesRef.current[key].error).toBe('CloseUnknown')
    expect(g.canClose(g.entriesRef.current[key])).toBe(false); g.confirmClose(key, true); await g.closeDecision(key); expect(calls).toHaveLength(2)
    g.call = async (input: any) => { calls.push(input); throw Object.assign(new Error('missing'), { status: 404 }) }; await g.checkStatus(key)
    expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.entriesRef.current[key].closeRequested).toBe(true); expect(g.entriesRef.current[key].error).toBe('NotFound'); expect(g.unresolved()).toBe(true)
    g.newDraft(); expect(g.entriesRef.current[key].pending).toBe(entry.pending)
    g.call = async (input: any) => { calls.push(input); return closedReceipt(g.entriesRef.current[key]) }; await g.checkStatus(key)
    expect(g.entriesRef.current[key].status).toBe('closed'); expect(g.entriesRef.current[key].pending).toBe(entry.pending); expect(calls.map(input => input.action)).toEqual(['prepare', 'close', 'status', 'status']); expect(calls.slice(2)).toEqual([1, 2].map(() => ({ action: 'status', epoch: entry.epoch, actionId: entry.pending.actionId })))
  })
  it.each(['recorded', 'blocked', 'dispatch_unknown', 'accepted'])('retains real %s evidence returned by close and never closes an existing receipt even after status failure', async state => {
    const { g, calls } = harness(), { key } = await unknownEntry(g, calls)
    g.call = async (input: any) => { calls.push(input); return receipt(g, g.entriesRef.current[key], state) }; g.confirmClose(key, true); await g.closeDecision(key)
    const saved = g.entriesRef.current[key]; expect(saved.status).toBe(state); expect(saved.receipt.state).toBe(state)
    g.call = async (input: any) => { calls.push(input); throw new Error('lost status') }; await g.checkStatus(key)
    expect(g.entriesRef.current[key].receipt).toBe(saved.receipt); g.confirmClose(key, true); await g.closeDecision(key); expect(calls.filter(input => input.action === 'close')).toHaveLength(1)
    if (state !== 'blocked') { g.newDraft(); expect(g.entriesRef.current[key].pending).toBe(saved.pending) }
  })
  it.each(['recorded', 'blocked', 'dispatch_unknown', 'accepted'])('does not offer close or a new draft for an existing %s receipt disguised as unknown', async state => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls), real = await receipt(g, entry, state)
    g.entriesRef.current[key] = { ...entry, receipt: real, status: 'unknown', closeConfirm: true, closeRequested: true }
    expect(g.canClose(g.entriesRef.current[key])).toBe(false); await g.closeDecision(key); g.newDraft(); expect(calls).toHaveLength(1); expect(g.entriesRef.current[key].receipt).toBe(real); expect(g.unresolved()).toBe(true)
    expect(g.validClosure(closedReceipt(entry), g.entriesRef.current[key])).toBe(false)
  })
  it('never accepts an unsolicited closed receipt from prepare or status without an explicit close request', async () => {
    const { g, calls } = harness(); opened(g); g.editAnswer('q1', 'mode', 'skip'); g.call = async (input: any) => { calls.push(input); return closedReceipt(g.entriesRef.current[g.selectedRef.current]) }
    await g.checkAnswers(); const key = g.selectedRef.current; expect(g.entriesRef.current[key].status).toBe('unknown'); await g.checkStatus(key); expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.entriesRef.current[key].receipt).toBeUndefined(); g.newDraft(); expect(calls.map(input => input.action)).toEqual(['prepare', 'status']); expect(g.unresolved()).toBe(true)
  })
  it.each([
    ['wrong digest', (r: any) => { r.digest = 'f'.repeat(64) }],
    ['fake project', (r: any) => { r.target.project = target.project }],
    ['summary', (r: any) => { r.answerSummary = {} }],
    ['answer body', (r: any) => { r.answers = [{ id: 'q1', selected: [], custom: 'leaked' }] }],
    ['extra field', (r: any) => { r.extra = 'not allowed' }],
    ['future timestamp', (r: any) => { r.at = r.updatedAt = Date.now() + 60000 }],
    ['different timestamp', (r: any) => { r.updatedAt++ }],
    ['negative timestamp', (r: any) => { r.at = r.updatedAt = -1 }],
    ['wrong call', (r: any) => { r.callId = 'another-call' }],
    ['wrong epoch', (r: any) => { r.epoch = 'another-epoch' }],
    ['wrong request ID', (r: any) => { r.requestId = '22222222-2222-4222-8222-222222222222' }],
    ['wrong action ID', (r: any) => { r.actionId = '22222222-2222-4222-8222-222222222222' }],
    ['wrong target', (r: any) => { r.target.sessionId = 'another-session' }],
    ['wrong scope', (r: any) => { r.target.scopeRevision = 'f'.repeat(64) }],
    ['wrong fact', (r: any) => { r.target.factRevision = 'f'.repeat(64) }],
    ['wrong snapshot sequence', (r: any) => { r.snapshot.asOfSeq++ }],
    ['wrong snapshot revision', (r: any) => { r.snapshot.revision = 'f'.repeat(64) }],
    ['snapshot extra field', (r: any) => { r.snapshot.project = 'fake' }],
    ['missing bindingVerified', (r: any) => { delete r.bindingVerified }],
    ['binding upgraded', (r: any) => { r.bindingVerified = true }],
    ['approval upgraded', (r: any) => { r.approval = true }],
    ['accepted upgraded', (r: any) => { r.accepted = true }],
    ['executed downgraded to false', (r: any) => { r.executed = false }],
    ['completed downgraded to false', (r: any) => { r.completed = false }],
    ['non-durable', (r: any) => { r.durable = false }],
    ['wrong sequence', (r: any) => { r.seq = 2 }],
    ['wrong code', (r: any) => { r.code = 'session_action_id_closed' }],
    ['wrong disposition', (r: any) => { r.disposition = 'not-dispatched' }],
    ['wrong state', (r: any) => { r.state = 'blocked' }],
    ['symbol field', (r: any) => { r[Symbol('extra')] = true }],
    ['target symbol field', (r: any) => { r.target[Symbol('extra')] = true }],
    ['snapshot symbol field', (r: any) => { r.snapshot[Symbol('extra')] = true }],
  ])('rejects closed receipt %s on both close and status and keeps original evidence locked', async (_name, corrupt) => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls)
    g.call = async (input: any) => { calls.push(input); const result = closedReceipt(entry); (corrupt as (r: any) => void)(result); return result }
    g.confirmClose(key, true); await g.closeDecision(key); expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.entriesRef.current[key].receipt).toBeUndefined(); expect(g.entriesRef.current[key].closeRequested).toBe(true)
    await g.checkStatus(key); g.newDraft(); expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.entriesRef.current[key].pending).toBe(entry.pending); expect(g.entriesRef.current[key].form).toBe(entry.form); expect(g.unresolved()).toBe(true); expect(calls.map(input => input.action)).toEqual(['prepare', 'close', 'status'])
  })
  it('rejects dispatch_unknown to blocked/recorded/old closed state downgrades and closed to any real record', async () => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls), unknown = await receipt(g, entry, 'dispatch_unknown')
    const previous = { ...entry, status: 'dispatch_unknown', receipt: unknown, closeRequested: true }
    for (const state of ['recorded', 'blocked']) expect(g.validReceipt(await receipt(g, entry, state), previous)).toBe(false)
    expect(g.validClosure(closedReceipt(entry), previous)).toBe(false)
    g.entriesRef.current[key] = previous; g.call = async (input: any) => { calls.push(input); return closedReceipt(entry) }; await g.checkStatus(key)
    expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.entriesRef.current[key].receipt).toBe(unknown); g.confirmClose(key, true); await g.closeDecision(key); g.newDraft(); expect(calls.map(input => input.action)).toEqual(['prepare', 'status'])
    const closed = { ...entry, closeRequested: true, status: 'closed', receipt: closedReceipt(entry) }; expect(g.validClosure(closed.receipt, closed)).toBe(true); expect(g.validClosure(closedReceipt(entry, { at: 101, updatedAt: 101 }), closed)).toBe(false)
    for (const state of ['recorded', 'blocked', 'dispatch_unknown', 'accepted']) expect(g.validReceipt(await receipt(g, entry, state), closed)).toBe(false)
  })
  it('keeps old epoch unknown locked with its original question/answer/pending and makes no cross-epoch close or query', async () => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls)
    g.confirmClose(key, true); g.viewRef.current.epoch = 'new-epoch'; await g.closeDecision(key); await g.checkStatus(key); g.confirmClose(key, true); g.newDraft()
    expect(g.entriesRef.current[key].pending).toBe(entry.pending); expect(g.entriesRef.current[key].call).toBe(entry.call); expect(g.entriesRef.current[key].form).toBe(entry.form); expect(g.entriesRef.current[key].status).toBe('unknown'); expect(g.unresolved()).toBe(true)
    const next = g.locatedBinding('new-epoch', located); g.viewRef.current.current = next; g.listsRef.current[next.key] = list(); g.openCall(questionCall.callId); g.editAnswer('q1', 'mode', 'skip'); await g.checkAnswers(); expect(calls).toHaveLength(1)
  })
  it('guards close during composition/inactive/unmounted/busy and retains a late exact closure under only the original ID', async () => {
    const { g, calls } = harness(), { key, entry } = await unknownEntry(g, calls); g.confirmClose(key, true)
    g.composing.current = true; await g.closeDecision(key); g.composing.current = false; g.viewRef.current.active = false; await g.closeDecision(key); g.viewRef.current.active = true; g.mounted.current = false; await g.closeDecision(key); g.mounted.current = true; g.busyRef.current = {}; await g.closeDecision(key); g.busyRef.current = null; expect(calls).toHaveLength(1)
    let finish: any; g.call = (input: any) => { calls.push(input); return new Promise(resolve => { finish = resolve }) }; const closing = g.closeDecision(key); await g.closeDecision(key); expect(calls).toHaveLength(2)
    g.viewRef.current.epoch = 'new-epoch'; g.viewRef.current.current = null; g.viewRef.current.active = false; finish(closedReceipt(entry)); await closing
    expect(g.entriesRef.current[key].status).toBe('closed'); expect(g.entriesRef.current[key].pending).toBe(entry.pending); expect(g.entriesRef.current[key].epoch).toBe('epoch'); g.newDraft(); expect(g.entriesRef.current[key].pending).toBe(entry.pending)
  })
  it('actual factory handlers expose a cancelable two-step close, preserve exact evidence, and create only an explicit blank draft', async () => {
    const { g } = harness(), dto = list(); dto.snapshotRevision = await g.listDigest(target, dto)
    const ui = factoryHarness(); ui.respond(async input => { if (input.action === 'list') return dto; if (input.action === 'prepare') throw new Error('lost response'); if (input.action === 'close') return closedReceipt(ui.entry()); throw new Error('unexpected action') }); ui.render()
    ui.button('读取当前目标问题').props.onClick(); await ui.waitFor(() => Object.keys(ui.slots[0]).length === 1); ui.button('查看原问题与答案草稿').props.onClick()
    let view = ui.render(); const custom = ui.nodes(view).find(node => node.tag === 'label' && node.children.includes('自行说明 / 另一种方案')); ui.nodes(custom).find(node => node.tag === 'input').props.onChange(); view = ui.render(); ui.nodes(view).find(node => node.tag === 'textarea').props.onChange({ target: { value: 'Exact local answer 原文' } })
    ui.button('核对答案（不发送）').props.onClick(); await ui.waitFor(() => ui.entry()?.status === 'unknown'); const original = ui.entry(), initial = ui.requests[1]
    expect(ui.button('再次确认：仅封存原ID，不投递答案')).toBeUndefined(); ui.button('封存未确认的原记录ID（不停止会话）').props.onClick(); expect(ui.requests.map(input => input.action)).toEqual(['list', 'prepare'])
    expect(ui.nodes(ui.render()).some(node => node.children?.includes('仅当原ID尚无记录时封存；不停止、撤销或批准任何操作。保留原题、答案与回执证据，不换ID、不重新核对。'))).toBe(true)
    ui.button('返回').props.onClick(); expect(ui.button('再次确认：仅封存原ID，不投递答案')).toBeUndefined(); ui.button('封存未确认的原记录ID（不停止会话）').props.onClick(); ui.button('再次确认：仅封存原ID，不投递答案').props.onClick(); await ui.waitFor(() => ui.entry()?.status === 'closed')
    expect(ui.requests[2]).toEqual({ ...initial, action: 'close' }); expect(ui.entry().pending).toBe(original.pending); expect(ui.entry().form).toBe(original.form); expect(ui.button('查询原操作状态（不重投）')).toBeUndefined(); expect(ui.button('封存未确认的原记录ID（不停止会话）')).toBeUndefined()
    expect(ui.nodes(ui.render()).some(node => node.children?.includes('原记录ID已持久封存，未投递；不代表停止、撤销或批准'))).toBe(true); expect(ui.button('核对答案（不发送）').props.disabled).toBe(true)
    ui.button('显式新建空白答案草稿（保留原回执）').props.onClick(); expect(ui.entry().form).toEqual({}); expect(ui.entry().pending).toBeUndefined(); const history = (Object.values(ui.slots[2]) as any[]).find(value => value.history); expect(history.pending).toBe(original.pending); expect(history.receipt.state).toBe('closed'); expect(ui.requests.map(input => input.action)).toEqual(['list', 'prepare', 'close'])
  })
})
