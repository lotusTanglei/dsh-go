import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { createContext, Script } from 'node:vm'
import { TextEncoder } from 'node:util'
import ts from 'typescript'

const source = readFileSync('src/client/go-settings.ts', 'utf8')
const ast = ts.createSourceFile('go-settings.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const declaration = ast.statements.find((v): v is ts.FunctionDeclaration => ts.isFunctionDeclaration(v) && v.name?.text === 'createGoSettings')!
const serialized = ts.transpileModule(`globalThis.factory = (${declaration.getText(ast).replace(/^export /, '')});`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
const revision = 'a'.repeat(64), snapshotId = 'b'.repeat(64), itemId = 'c'.repeat(64), nextRevision = 'd'.repeat(64)
const names: Record<string, string> = { Refresh: '刷新核实', Add: '添加来源', Configure: '配置来源', Back: '返回列表', Save: '保存配置', Scan: '手动扫描', Preview: '查看快照', OpenImage: '读取并预览原图', Claim: '承接为独立草稿', RetryClaim: '用原 requestId 核实承接', SaveModels: '保存阶段模型配置', MutationStatus: '核实原请求状态', MutationClose: '封存缺记录 ID，不重做', PlanDraft: '带出处交给 Go（只生成待审阅计划）' }
const sourceRow = (extra: any = {}) => ({ id: 'notes', rootId: 'root', relativePath: 'notes/example.md', kind: 'md', revision, state: 'ready', snapshotId, ...extra })
const list = (sources = [sourceRow()], roots = [{ id: 'root', name: '资料' }]) => ({ roots, sources, support: [{ kind: 'md', state: 'supported' }, { kind: 'pdf', state: 'unsupported' }] })
const snapshot = (extra: any = {}) => ({ kind: 'snapshot', sourceId: 'notes', snapshotId, revision: snapshotId, config: sourceRow(), capturedAt: 100, text: '<img src=x onerror=run()> 原始文字', items: [{ itemId, text: '所选原文', location: { relativePath: 'notes/example.md' } }], images: [], trust: 'external-untrusted', authorization: 'not-granted', current: true, ...extra })
const stages = ['locate', 'understand', 'plan', 'execute', 'summarize', 'verify']
const catalog = [{ id: 'provider', name: '服务商', models: [{ id: 'model', name: '模型', reasoningEfforts: [{ id: 'high', name: '高' }] }, { id: 'second', name: '模型二' }] }]
const config = (revision = 2) => ({ revision, default: { provider: 'provider', model: 'model' }, stages: Object.fromEntries(stages.map(s => [s, { mode: 'inherit' }])) })
const settings = (c: any = config()) => ({ config: c, configVersion: c?.revision || 0, stages: Object.fromEntries(stages.map(stage => [stage, c ? { state: 'ready', configVersion: c.revision, ...(c.stages[stage].mode === 'override' ? c.stages[stage].selection : c.default), capabilityProof: { vision: 'supported', tools: 'unknown', structured: 'unsupported', contextWindow: 64000 } } : { state: 'blocked', configVersion: 0, code: 'stage_models_not_configured' }])), existingSessionModelPolicy: 'preserve', existingSessionOverride: 'unsupported', catalog })
function nodes(v: any): any[] { return Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' ? [v, ...(v.children || []).flatMap(nodes)] : [] }
function text(v: any): string { return Array.isArray(v) ? v.map(text).join('') : v && typeof v === 'object' ? text(v.children || []) : v == null || v === false ? '' : String(v) }
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
function envelope(input: any, value?: any, state = 'settled', extra: any = {}) {
  const kind = input.config ? 'stage-save' : `local-${input.action}`, payload = Object.fromEntries(Object.entries(input).filter(([k]) => !['action', 'epoch', 'requestId'].includes(k)))
  const digest = createHash('sha256').update(JSON.stringify(canonical([input.epoch, input.requestId, kind, payload]))).digest('hex')
  return canonical({ mutation: { version: 1, epoch: input.epoch, requestId: input.requestId, kind, digest, state, at: 100, updatedAt: state === 'closed' || state === 'recorded' ? 100 : 101, ...(state === 'closed' ? { code: 'config_mutation_id_closed' } : {}), ...extra }, ...(state === 'settled' ? { value } : {}) })
}
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes }); return { promise, resolve } }
function harness(component: 'LocalSources' | 'StageModels', initial: any = component === 'LocalSources' ? list() : settings()) {
  const slots: any[] = [], calls: any[] = [], urls: string[] = [], revoked: string[] = [], effects: any[] = []
  let cursor = 0, view: any, dirty = false, props: any = { epoch: 'epoch-one', active: true }, minted = 0
  const React = {
    createElement: (tag: any, props: any, ...children: any[]) => ({ tag, props: props || {}, children }), Fragment: 'fragment',
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true }] },
    useRef(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    useEffect(action: any, deps: any[]) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, k) => !Object.is(v, old.deps[k]))) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = action() }) } },
  }
  let respond = async (_path: string, body: any): Promise<any> => body.action === 'list' || body.action === 'settings' ? initial : body.action === 'detail' ? snapshot() : body.action === 'inspect' ? { provider: body.provider, model: body.model, reasoningEfforts: [{ id: 'high', name: '高' }] } : null
  const context = createContext({ React, TextEncoder, AbortController, Blob, Uint8Array, URL: { createObjectURL: () => { const url = `blob:original-${urls.length}`; urls.push(url); return url }, revokeObjectURL: (url: string) => revoked.push(url) }, atob: (v: string) => Buffer.from(v, 'base64').toString('binary'), crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`, subtle: webcrypto.subtle } })
  new Script(serialized).runInContext(context)
  const components = context.factory(React, async (path: string, input: any, signal: any) => { calls.push({ path, input: JSON.parse(JSON.stringify(input)), signal }); return respond(path, input) }, (key: string) => key)
  const render = (next?: any) => { if (next) props = { ...props, ...next }; cursor = 0; dirty = false; view = components[component](props); while (effects.length) effects.shift()(); return view }
  const flush = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); if (dirty) render() }; return view }
  const find = (tag: string, label?: string) => nodes(view).find(v => v.tag === tag && (label === undefined || text(v) === label))
  const press = async (key: string) => { const node = find('button', names[key] || key); expect(node, `Missing button ${key}`).toBeDefined(); if (!node.props.disabled) await node.props.onClick?.(); render(); return flush() }
  const input = (index: number, value: any, tag = 'input') => { const node = nodes(view).filter(v => v.tag === tag)[index]!; expect(node).toBeDefined(); if (!node.props.disabled) node.props.onChange({ target: { value, checked: value } }); render() }
  const submit = async () => { const node = find('form'); await node.props.onSubmit({ preventDefault() {} }); render(); await flush() }
  render()
  return { render, flush, calls, press, input, submit, nodes: () => nodes(view), text: () => text(view), find, setReply: (fn: typeof respond) => { respond = fn }, minted: () => minted, urls, revoked, state: () => slots.find(v => v?.current?.state)?.current.state }
}
async function detailView(h: ReturnType<typeof harness>) { await h.flush(); await h.press('Configure'); await h.press('Preview') }
async function selectAndReview(h: ReturnType<typeof harness>) { h.input(0, itemId, 'select'); h.input(0, true) }
function claimReceipt(input: any, d = snapshot()) { return { draftId: `local-draft:${'e'.repeat(64)}`, requestId: input.requestId, origin: { kind: 'local', sourceId: input.id, itemId: input.itemId, snapshotId: input.snapshotId, revision: input.snapshotId, configRevision: input.expectedRevision }, text: d.items[0]!.text, images: d.images, trust: 'external-untrusted', authorization: 'not-granted', humanReview: 'reviewed-for-draft' } }
function planOrigin(receipt: any, epoch = 'epoch-one') {
  const o = receipt.origin
  return { documentOrigin: { kind: 'local-document', itemKey: o.itemId, revision: o.snapshotId, evidenceDigest: createHash('sha256').update(JSON.stringify(['local-plan-origin-v1', epoch, receipt.draftId, receipt.requestId, o.sourceId, o.itemId, o.snapshotId, o.configRevision])).digest('hex'), configVersion: o.configRevision }, draftId: receipt.draftId, trust: 'external-untrusted', authorization: 'not-granted', planningOnly: true }
}
async function claimedView(h: ReturnType<typeof harness>, onPlanDraft?: any) {
  h.render({ onPlanDraft }); await detailView(h); await selectAndReview(h)
  h.setReply(async (_path, input) => claimReceipt(input)); await h.press('Claim')
  return h.state().drafts[0].receipt
}

// Executes the complete serialized factory and actual handlers with tiny hook scheduling.
// This is interaction/closure contract evidence, not a React DOM, screenshot or visual acceptance claim.
describe('serialized GO settings factory and local evidence UI', () => {
  it('has no imports/free helpers and only consumes injected React/request/t', async () => {
    expect(ast.statements.some(ts.isImportDeclaration)).toBe(false)
    const h = harness('LocalSources'); await h.flush()
    expect(h.calls.map(v => [v.path, v.input])).toEqual([['local-sources', { action: 'list', epoch: 'epoch-one' }]])
    expect(h.text()).toContain('本地来源'); expect(h.text()).toContain('Office、PDF'); expect(h.nodes().some(v => v.props.dangerouslySetInnerHTML)).toBe(false)
  })
  it('requires Host-authorized roots and never accepts an arbitrary root path', async () => {
    const h = harness('LocalSources', list([], [])); await h.flush(); await h.press('Add')
    expect(h.text()).toContain('Host 管理员授权'); expect(h.find('form')).toBeUndefined(); expect(h.calls).toHaveLength(1)
  })
  it('saves exact CSV CAS config before a separate explicit scan and detail', async () => {
    const h = harness('LocalSources', list([])); await h.flush(); await h.press('Add')
    h.input(0, 'csv-notes'); h.input(1, 'tasks.csv'); h.input(1, 'csv', 'select'); h.input(2, 'ticket-id')
    h.setReply(async (_path, input) => input.action === 'configure' ? envelope(input, sourceRow({ ...input, revision: nextRevision, snapshotId: null, state: 'blocked' })) : input.action === 'scan' ? envelope(input, { sourceId: 'csv-notes', configRevision: nextRevision, snapshotId, revision: snapshotId, state: 'ready' }) : snapshot())
    await h.submit()
    expect(h.calls.at(-1)?.input).toEqual({ action: 'configure', epoch: 'epoch-one', requestId: '00000000-0000-4000-8000-000000000001', id: 'csv-notes', rootId: 'root', relativePath: 'tasks.csv', kind: 'csv', csv: { idColumn: 'ticket-id' }, expectedRevision: null })
    expect(h.calls.map(v => v.input.action)).toEqual(['list', 'configure']); expect(h.text()).toContain('Host 已确认保存')
    await h.press('Scan'); expect(h.calls.at(-1)?.input).toEqual({ action: 'scan', epoch: 'epoch-one', requestId: '00000000-0000-4000-8000-000000000002', id: 'csv-notes', expectedRevision: nextRevision, expectedSnapshot: null })
  })
  it('locks uncertain configure payload and reconciles only from exact original-ID journal receipt', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.input(1, 'notes/new.md')
    h.setReply(async () => { throw new Error('lost') }); await h.submit(); const original = h.state().pending.input
    h.input(1, 'must-not-change'); await h.submit(); expect(h.calls.filter(v => v.input.action === 'configure')).toHaveLength(1); expect(h.state().pending.input).toEqual(original)
    h.setReply(async () => list([sourceRow({ relativePath: 'notes/new.md', revision: nextRevision })])); await h.press('Refresh')
    expect(h.state().pending.input).toEqual(original)
    h.setReply(async () => envelope(original, sourceRow({ relativePath: 'notes/new.md', revision: nextRevision }))); await h.press('MutationStatus')
    expect(h.state().pending).toBeNull(); expect(h.text()).toContain('Host 已确认保存'); expect(h.state().history[0].input).toEqual(original)
  })
  it('retains exact older configure/scan/remove receipts without replacing a newer refreshed source', async () => {
    for (const action of ['configure', 'scan', 'remove']) {
      const h = harness('LocalSources'); await h.flush(); await h.press('Configure')
      if (action === 'configure') h.input(1, 'notes/old-change.md')
      h.setReply(async () => { throw new Error('lost') })
      if (action === 'configure') await h.submit()
      else if (action === 'scan') await h.press('Scan')
      else { h.input(2, true); await h.press('移除配置') }
      const original = h.state().pending.input, latest = sourceRow({ relativePath: 'notes/newest.md', revision: 'e'.repeat(64), snapshotId: 'f'.repeat(64) })
      h.setReply(async () => list([latest])); await h.press('Refresh')
      const value = action === 'configure' ? sourceRow({ relativePath: original.relativePath, revision: nextRevision }) : action === 'scan' ? { sourceId: original.id, configRevision: original.expectedRevision, snapshotId, revision: snapshotId, state: 'ready' } : { id: original.id, removed: true, revision: original.expectedRevision }
      h.setReply(async () => envelope(original, value)); await h.press('MutationStatus')
      expect(h.state().pending).toBeNull(); expect(h.state().history).toHaveLength(1); expect(h.state().needsReset).toBe(true)
      expect(h.state().data.sources[0]).toEqual(latest); expect(h.state().source.revision).toBe(latest.revision)
      const before = h.calls.length; await h.submit(); expect(h.calls).toHaveLength(before)
    }
  })
  it('does not borrow a new source revision for a stale edited form after refresh', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.input(1, 'notes/edited.md')
    h.setReply(async (_path, input) => input.action === 'list' ? list([sourceRow({ revision: nextRevision })]) : sourceRow({ ...input, revision: 'f'.repeat(64) })); await h.press('Refresh'); await h.submit()
    expect(h.calls.at(-1)?.input.expectedRevision).toBe(revision)
  })
  it('renders raw text only, selects one item, and claims only after explicit human review into a separate draft', async () => {
    const h = harness('LocalSources'); await detailView(h)
    expect(h.nodes().some(v => v.tag === 'img' || v.props.dangerouslySetInnerHTML)).toBe(false); expect(h.text()).toContain('<img src=x onerror=run()>')
    await h.press('Claim'); expect(h.minted()).toBe(0)
    await selectAndReview(h); h.setReply(async (_path, input) => claimReceipt(input)); await h.press('Claim')
    expect(h.calls.at(-1)?.input).toEqual({ action: 'claim', epoch: 'epoch-one', id: 'notes', expectedRevision: revision, snapshotId, itemId, requestId: '00000000-0000-4000-8000-000000000001', humanReview: 'reviewed-for-draft' })
    expect(h.text()).toContain('独立草稿'); expect(h.text()).toContain('所选原文'); expect(h.text()).toContain('未写入主输入框、未发送'); expect(h.state().drafts).toHaveLength(1)
    await h.press('Back'); expect(h.state().drafts).toHaveLength(1); expect(h.calls.every(v => ['local-sources'].includes(v.path))).toBe(true)
  })
  it('uses the identical requestId for explicit unknown-claim reconciliation, never auto retries', async () => {
    const h = harness('LocalSources'); await detailView(h); await selectAndReview(h)
    h.setReply(async () => { throw new Error('lost') }); await h.press('Claim'); const input = h.calls.at(-1)?.input
    expect(h.minted()).toBe(1); expect(h.text()).toContain('承接结果未知'); expect(h.calls.filter(v => v.input.action === 'claim')).toHaveLength(1)
    h.setReply(async (_path, input) => claimReceipt(input)); await h.press('RetryClaim')
    expect(h.calls.at(-1)?.input).toEqual(input); expect(h.minted()).toBe(1)
  })
  it('rejects forged claim origin/authorization and preserves the original request', async () => {
    const h = harness('LocalSources'); await detailView(h); await selectAndReview(h)
    h.setReply(async (_path, input) => ({ ...claimReceipt(input), authorization: 'granted' })); await h.press('Claim')
    expect(h.state().drafts).toHaveLength(0); expect(h.text()).toContain('承接结果未知'); expect(h.minted()).toBe(1)
  })
  it('does not navigate over a newer view on a late claim reply, but retains its independent receipt', async () => {
    const h = harness('LocalSources'); await detailView(h); await selectAndReview(h); const d = deferred()
    h.setReply(async () => d.promise); const pending = h.press('Claim'); h.render(); await h.press('Back')
    d.resolve(claimReceipt(h.calls.at(-1)?.input)); await pending
    expect(h.state().view).toBe('list'); expect(h.state().drafts).toHaveLength(1)
  })
  it('fences hidden/epoch handlers and retains drafts without reusing an old save authorization', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); const d = deferred(); h.setReply(async () => d.promise)
    const oldForm = h.find('form'), pending = h.submit(); h.render({ active: false }); expect(h.calls.at(-1)?.signal.aborted).toBe(true)
    d.resolve(sourceRow({ revision: nextRevision })); await pending
    expect(h.state().pending.status).toBe('unknown'); const before = h.calls.length; oldForm.props.onSubmit({ preventDefault() {} }); await h.flush(); expect(h.calls).toHaveLength(before)
    h.setReply(async () => list()); h.render({ epoch: 'epoch-two', active: true }); await h.flush()
    expect(h.state().pending).toBeNull(); expect(h.calls.at(-1)?.input).toEqual({ action: 'list', epoch: 'epoch-two' })
  })
  it('requires digest/MIME/size verified original bytes and successful image load before review', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]), digest = createHash('sha256').update(bytes).digest('hex')
    const image = { reference: '![原图](image.png)', relativePath: 'image.png', state: 'available', imageSeen: false, digest, mediaType: 'image/png', size: bytes.length }, d = snapshot({ images: [image] })
    const h = harness('LocalSources'); await h.flush(); h.setReply(async (_path, input) => input.imageDigest ? { kind: 'image', digest, mediaType: 'image/png', imageSeen: false, encoded: bytes.toString('base64') } : d)
    await h.press('Configure'); await h.press('Preview'); h.input(0, itemId, 'select'); h.input(0, true); expect(h.state().reviewed).toBe(false)
    await h.press('OpenImage'); expect(h.urls).toHaveLength(1); expect(h.state().images[digest].loaded).toBe(false); h.input(0, true); expect(h.state().reviewed).toBe(false)
    h.find('img').props.onLoad({ currentTarget: { naturalWidth: 1 } }); h.render(); h.input(0, true); expect(h.state().reviewed).toBe(true); expect(h.text()).toContain('不代表模型已看图')
    h.render({ active: false }); expect(h.revoked).toEqual(h.urls); expect(h.state().reviewed).toBe(false); expect(h.state().images).toEqual({})
  })
  it('does not create a Blob for a tampered digest and never marks a failed image as seen', async () => {
    const image = { state: 'available', digest: 'e'.repeat(64), mediaType: 'image/png', size: 24, reference: '![x](x.png)' }, h = harness('LocalSources')
    await h.flush(); h.setReply(async (_path, input) => input.imageDigest ? { kind: 'image', digest: image.digest, mediaType: 'image/png', imageSeen: false, encoded: 'AAAA' } : snapshot({ images: [image] })); await h.press('Configure'); await h.press('Preview'); await h.press('OpenImage')
    expect(h.urls).toHaveLength(0); expect(h.text()).toContain('原图校验或显示失败'); expect(h.state().reviewed).toBe(false)
  })
})

describe('local draft explicit planning-only provenance bridge', () => {
  it('reads only the claimed original request, checks exact epoch-bound digest, and fills without sending or minting', async () => {
    const accepted: any[] = [], h = harness('LocalSources'), receipt = await claimedView(h, (value: any) => { accepted.push(value); return true })
    const before = JSON.stringify(h.state().drafts), minted = h.minted()
    expect(h.calls.map(v => v.input.action)).toEqual(['list', 'detail', 'claim']); expect(accepted).toEqual([])
    h.setReply(async () => planOrigin(receipt)); await h.press('PlanDraft')
    expect(h.calls.at(-1)).toMatchObject({ path: 'local-sources', input: { action: 'plan-origin', epoch: 'epoch-one', id: 'notes', expectedRevision: revision, snapshotId, itemId, requestId: receipt.requestId } })
    expect(Object.keys(h.calls.at(-1).input).sort()).toEqual(['action', 'epoch', 'id', 'expectedRevision', 'snapshotId', 'itemId', 'requestId'].sort())
    expect(accepted).toEqual([{ epoch: 'epoch-one', draftId: receipt.draftId, documentOrigin: planOrigin(receipt).documentOrigin }])
    expect(h.text()).toContain('已填入主对话待审阅计划草稿，未发送、未授权执行'); expect(h.find('form')).toBeUndefined()
    expect(h.minted()).toBe(minted); expect(JSON.stringify(h.state().drafts)).toBe(before)
    expect(h.calls.map(v => v.input.action)).toEqual(['list', 'detail', 'claim', 'plan-origin'])
  })
  it.each([
    ['extra envelope field', (r: any) => { r.send = true }],
    ['extra origin field', (r: any) => { r.documentOrigin.authorized = true }],
    ['missing envelope field', (r: any) => { delete r.authorization }],
    ['missing origin field', (r: any) => { delete r.documentOrigin.configVersion }],
    ['wrong draft ID', (r: any) => { r.draftId = `local-draft:${'f'.repeat(64)}` }],
    ['wrong item ID', (r: any) => { r.documentOrigin.itemKey = 'f'.repeat(64) }],
    ['wrong snapshot ID', (r: any) => { r.documentOrigin.revision = 'f'.repeat(64) }],
    ['wrong config revision', (r: any) => { r.documentOrigin.configVersion = 'f'.repeat(64) }],
    ['wrong digest', (r: any) => { r.documentOrigin.evidenceDigest = 'f'.repeat(64) }],
    ['wrong kind', (r: any) => { r.documentOrigin.kind = 'wecom-document' }],
    ['trusted material', (r: any) => { r.trust = 'trusted' }],
    ['granted authorization', (r: any) => { r.authorization = 'granted' }],
    ['execution claim', (r: any) => { r.planningOnly = false }],
    ['nonboolean planning', (r: any) => { r.planningOnly = 'true' }],
    ['array origin', (r: any) => { r.documentOrigin = [] }],
  ])('rejects %s without calling the main conversation or changing drafts', async (_label, mutate: any) => {
    const accepted: any[] = [], h = harness('LocalSources'), receipt = await claimedView(h, (value: any) => { accepted.push(value); return true }), before = JSON.stringify(h.state().drafts)
    const result = planOrigin(receipt); mutate(result); h.setReply(async () => result); await h.press('PlanDraft')
    expect(accepted).toEqual([]); expect(h.text()).toContain('出处回执缺失或不匹配'); expect(h.text()).not.toContain('已填入主对话')
    expect(JSON.stringify(h.state().drafts)).toBe(before); expect(h.minted()).toBe(1)
  })
  it('rejects digests bound to another epoch, request ID, or source ID', async () => {
    for (const field of ['epoch', 'requestId', 'sourceId']) {
      const accepted: any[] = [], h = harness('LocalSources'), receipt = await claimedView(h, (v: any) => { accepted.push(v); return true }), forged = JSON.parse(JSON.stringify(receipt))
      if (field === 'requestId') forged.requestId = 'different-request'; if (field === 'sourceId') forged.origin.sourceId = 'different-source'
      h.setReply(async () => planOrigin(forged, field === 'epoch' ? 'other-epoch' : 'epoch-one')); await h.press('PlanDraft')
      expect(accepted).toEqual([]); expect(h.text()).toContain('出处回执缺失或不匹配')
    }
  })
  it('disables without a callback and never treats a provenance read as authorization', async () => {
    const h = harness('LocalSources'); await claimedView(h); const before = h.calls.length
    expect(h.find('button', names.PlanDraft).props.disabled).toBe(true); expect(h.text()).toContain('尚未提供待审阅计划入口')
    await h.press('PlanDraft'); expect(h.calls).toHaveLength(before); expect(h.minted()).toBe(1)
  })
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'blocked'])('blocks %s images without dropping original images or sending a request', async mediaType => {
    const accepted: any[] = [], h = harness('LocalSources'); await claimedView(h, (v: any) => { accepted.push(v); return true })
    h.state().drafts[0].receipt.images = [{ mediaType, digest: 'f'.repeat(64), state: mediaType === 'blocked' ? 'blocked' : 'available', imageSeen: false }]; h.render()
    const before = JSON.stringify(h.state().drafts), calls = h.calls.length
    expect(h.text()).toContain('含图计划桥尚未支持，不省图'); expect(h.find('button', names.PlanDraft).props.disabled).toBe(true)
    await h.press('PlanDraft'); expect(h.calls).toHaveLength(calls); expect(accepted).toEqual([]); expect(JSON.stringify(h.state().drafts)).toBe(before)
  })
  it('blocks old-epoch drafts and stale handlers without claim, mint, or plan reads', async () => {
    const h = harness('LocalSources'); await claimedView(h, () => true); const oldButton = h.find('button', names.PlanDraft), receipt = h.state().drafts[0].receipt
    h.setReply(async () => list()); h.render({ epoch: 'epoch-two' }); await h.flush(); await h.press('独立草稿')
    expect(h.text()).toContain('旧工作区草稿'); expect(h.find('button', names.PlanDraft).props.disabled).toBe(true)
    const count = h.calls.length; await oldButton.props.onClick(); await h.press('PlanDraft'); expect(h.calls).toHaveLength(count)
    expect(h.state().drafts[0].receipt).toBe(receipt); expect(h.minted()).toBe(1)
  })
  it.each(['navigate', 'round-trip navigation', 'hidden', 'hidden round-trip', 'epoch', 'epoch ABA', 'draft ID', 'receipt draft ID', 'callback removed'])('ignores an uncancelable late response after %s', async scenario => {
    const accepted: any[] = [], h = harness('LocalSources'), receipt = await claimedView(h, (v: any) => { accepted.push(v); return true }), d = deferred()
    h.setReply(async () => d.promise); const pending = h.press('PlanDraft'); h.render()
    if (scenario === 'navigate' || scenario === 'round-trip navigation') { await h.press('Back'); if (scenario === 'round-trip navigation') await h.press('独立草稿') }
    if (scenario === 'hidden' || scenario === 'hidden round-trip') { h.render({ active: false }); if (scenario === 'hidden round-trip') { h.setReply(async () => list()); h.render({ active: true }); await h.flush() } }
    if (scenario === 'epoch' || scenario === 'epoch ABA') { h.setReply(async () => list()); h.render({ epoch: 'epoch-two' }); await h.flush(); if (scenario === 'epoch ABA') { h.render({ epoch: 'epoch-one' }); await h.flush() } }
    if (scenario === 'draft ID') { h.state().draftId = `local-draft:${'f'.repeat(64)}`; h.render() }
    if (scenario === 'receipt draft ID') receipt.draftId = `local-draft:${'f'.repeat(64)}`
    if (scenario === 'callback removed') h.render({ onPlanDraft: undefined })
    d.resolve(planOrigin(receipt)); await pending
    expect(accepted).toEqual([]); expect(h.text()).not.toContain('已填入主对话'); expect(h.state().drafts[0].receipt).toBe(receipt)
    expect(h.calls.filter(v => v.input.action === 'plan-origin')).toHaveLength(1); expect(h.minted()).toBe(1)
  })
  it('reports callback false as occupied, retains every draft, and retries read-only using the same original ID', async () => {
    const h = harness('LocalSources'), accepted: any[] = [], receipt = await claimedView(h, (v: any) => { accepted.push(v); return false })
    const other = { epoch: 'epoch-one', receipt: { ...JSON.parse(JSON.stringify(receipt)), draftId: `local-draft:${'f'.repeat(64)}`, text: '另一份独立草稿' } }; h.state().drafts.push(other)
    const before = JSON.stringify(h.state().drafts); h.setReply(async () => planOrigin(receipt)); await h.press('PlanDraft')
    expect(h.text()).toContain('主对话已有草稿或已切页，原稿保留'); expect(h.text()).not.toContain('已填入主对话'); expect(JSON.stringify(h.state().drafts)).toBe(before)
    await h.press('PlanDraft'); expect(h.calls.filter(v => v.input.action === 'plan-origin').map(v => v.input)).toEqual([h.calls.at(-1).input, h.calls.at(-1).input])
    expect(accepted).toHaveLength(2); expect(h.minted()).toBe(1); expect(h.state().drafts[1]).toBe(other)
  })
  it('retries a failed read explicitly without minting, sending, claiming, or locating', async () => {
    const accepted: any[] = [], h = harness('LocalSources'), receipt = await claimedView(h, (v: any) => { accepted.push(v); return true })
    h.setReply(async () => { throw new Error('read failed') }); await h.press('PlanDraft'); expect(h.text()).toContain('出处读取失败'); const input = h.calls.at(-1).input
    expect(h.calls.filter(v => v.input.action === 'plan-origin')).toHaveLength(1); expect(accepted).toEqual([])
    h.setReply(async () => planOrigin(receipt)); await h.press('PlanDraft'); expect(h.calls.at(-1).input).toEqual(input); expect(accepted).toHaveLength(1)
    expect(h.calls.map(v => v.input.action)).toEqual(['list', 'detail', 'claim', 'plan-origin', 'plan-origin']); expect(h.minted()).toBe(1)
  })
  it('binds the explicit button to its original draft and navigation, not a later selected draft', async () => {
    const h = harness('LocalSources'); await claimedView(h, () => true); const originalButton = h.find('button', names.PlanDraft), before = h.calls.length
    await h.press('Back'); await h.press('独立草稿'); await originalButton.props.onClick()
    expect(h.calls).toHaveLength(before)
    const receipt = h.state().drafts[0].receipt, other = { epoch: 'epoch-one', receipt: { ...receipt, draftId: `local-draft:${'f'.repeat(64)}` } }
    h.state().drafts.push(other); h.state().draftId = other.receipt.draftId; h.render(); await originalButton.props.onClick()
    expect(h.calls).toHaveLength(before); expect(h.state().draftId).toBe(other.receipt.draftId)
  })
  it('fences synchronous double clicks while retaining the original read-only request ID', async () => {
    const accepted: any[] = [], h = harness('LocalSources'), receipt = await claimedView(h, (v: any) => { accepted.push(v); return true }), d = deferred(), button = h.find('button', names.PlanDraft)
    h.setReply(async () => d.promise); const pending = button.props.onClick(); await button.props.onClick()
    expect(h.calls.filter(v => v.input.action === 'plan-origin')).toHaveLength(1)
    d.resolve(planOrigin(receipt)); await pending; h.render(); expect(accepted).toHaveLength(1); expect(h.minted()).toBe(1)
  })
  it('does not accept a retained draft that is not bound to a claimed receipt', async () => {
    const h = harness('LocalSources'); await claimedView(h, () => true); h.state().claims = {}; h.render(); const before = h.calls.length
    await h.press('PlanDraft'); expect(h.calls).toHaveLength(before); expect(h.find('button', names.PlanDraft).props.disabled).toBe(true)
  })
})

describe('configuration mutation journal recovery contracts', () => {
  it('accepts exact rejected configure 415 evidence, retains history and permits editing without changing the original CAS', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.input(1, 'notes/wrong.pdf')
    h.setReply(async (_path, input) => envelope(input, undefined, 'rejected', { code: 'local_source_unsupported' })); await h.submit()
    expect(h.state().pending).toBeNull(); expect(h.state().history[0].mutation.state).toBe('rejected'); expect(h.text()).toContain('Host 已明确拒绝'); expect(h.text()).not.toContain('Host 已确认保存')
    h.input(1, 'notes/correct.md'); expect(h.state().form.relativePath).toBe('notes/correct.md'); await h.submit()
    expect(h.calls.filter(v => v.input.action === 'configure').map(v => v.input.expectedRevision)).toEqual([revision, revision]); expect(h.minted()).toBe(2)
  })
  it('recovers a lost remove only from settled status and never resends the remove', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.input(2, true)
    h.setReply(async () => { throw new Error('lost') }); await h.press('移除配置'); const input = h.state().pending.input
    h.setReply(async () => envelope(input, { id: input.id, revision: input.expectedRevision, removed: true })); await h.press('MutationStatus')
    expect(h.state().pending).toBeNull(); expect(h.state().data.sources).toHaveLength(0); expect(h.state().view).toBe('list'); expect(h.calls.filter(v => v.input.action === 'remove')).toHaveLength(1)
    expect(h.calls.at(-1)?.input).toEqual({ action: 'status', epoch: 'epoch-one', requestId: input.requestId })
  })
  it('does not release on status404 or matching list; closeclosed seals the exact ID and requires explicit latest-form reload', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.setReply(async () => { throw Object.assign(new Error('missing'), { status: 404 }) }); await h.submit()
    const input = h.state().pending.input; await h.press('MutationStatus'); expect(h.state().pending.input).toEqual(input)
    h.setReply(async () => envelope(input, undefined, 'closed')); await h.press('MutationClose')
    expect(h.state().pending).toBeNull(); expect(h.state().needsReset).toBe(true); expect(h.state().history[0].mutation.state).toBe('closed'); const count = h.calls.length; await h.submit(); expect(h.calls).toHaveLength(count)
    expect(h.calls.at(-1)?.input).toEqual({ action: 'close', epoch: 'epoch-one', requestId: input.requestId, kind: 'local-configure', payload: { id: 'notes', rootId: 'root', relativePath: 'notes/example.md', kind: 'md', expectedRevision: revision } })
    h.setReply(async () => list([sourceRow({ revision: nextRevision })])); await h.press('Refresh'); await h.press('载入 Host 最新配置（替换当前表单）')
    expect(h.state().needsReset).toBe(false); expect(h.state().form.revision).toBe(nextRevision); expect(h.state().history).toHaveLength(1)
  })
  it('keeps recorded mutations locked and disables close without exposing a new-ID retry', async () => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.setReply(async (_path, input) => envelope(input, undefined, 'recorded')); await h.submit()
    const input = h.state().pending.input; await h.press('MutationClose'); h.input(1, 'do-not-change'); await h.submit()
    expect(h.calls.filter(v => v.input.action === 'configure')).toHaveLength(1); expect(h.calls.filter(v => v.input.action === 'close')).toHaveLength(0); expect(h.state().pending.input).toEqual(input); expect(h.state().pending.status).toBe('recorded')
    h.setReply(async () => envelope(input, undefined, 'recorded')); await h.press('MutationStatus'); expect(h.state().pending.status).toBe('recorded'); expect(h.minted()).toBe(1)
  })
  it.each(['digest', 'requestId', 'epoch', 'kind', 'version', 'updatedAt'])('rejects contradictory mutation %s before applying value', async field => {
    const h = harness('LocalSources'); await h.flush(); await h.press('Configure'); h.setReply(async (_path, input) => envelope(input, sourceRow({ revision: nextRevision }), 'settled', { [field]: field === 'version' ? 2 : field === 'updatedAt' ? 99 : 'forged' })); await h.submit()
    expect(h.state().pending.status).toBe('unknown'); expect(h.state().source.revision).toBe(revision); expect(h.state().history).toHaveLength(0)
  })
})

describe('stage models actual configuration handlers', () => {
  it('returns Escape to the current list without bubbling into the shell or dropping edited drafts', async () => {
    for (const component of ['StageModels', 'LocalSources'] as const) {
      const h = harness(component); await h.flush(); await h.press(component === 'StageModels' ? '默认路由' : 'Configure')
      if (component === 'StageModels') h.input(2, 'high', 'select'); else h.input(1, 'notes/kept.md')
      const calls = h.calls.length, events: string[] = []
      h.nodes().find(v => v.tag === 'section' && v.props.onKeyDown).props.onKeyDown({ key: 'Escape', preventDefault: () => events.push('prevent'), stopPropagation: () => events.push('stop') })
      h.render(); await h.flush(); expect(events).toEqual(['prevent', 'stop']); expect(h.calls).toHaveLength(calls)
      if (component === 'StageModels') { expect(h.state().selectedStage).toBeNull(); expect(h.state().form.default.reasoningEffort).toBe('high') }
      else { expect(h.state().view).toBe('list'); expect(h.state().form.relativePath).toBe('notes/kept.md') }
    }
  })
  it('starts with seven route summaries and edits only one item, retaining draft and request count on back/navigation', async () => {
    const h = harness('StageModels'); await h.flush(); const count = h.calls.length
    expect(h.state().selectedStage).toBeNull(); expect(h.nodes().filter(v => v.tag === 'li')).toHaveLength(7); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(0); expect(h.find('form')).toBeUndefined(); expect(h.text()).toContain('provider / model')
    await h.press('默认路由'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(3); h.input(2, 'high', 'select')
    await h.press('Back'); await h.press('定位'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(1); h.input(0, 'override', 'select'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(4)
    await h.press('Back'); await h.press('理解'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(1); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.state().form.stages.locate.mode).toBe('override'); expect(h.calls).toHaveLength(count)
    h.nodes()[0].props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); h.render(); expect(h.state().selectedStage).toBeNull(); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(0)
  })
  it('shows effective Host routes, explicit known/unknown capabilities and preserve policy without a test call', async () => {
    const h = harness('StageModels'); await h.flush()
    await h.press('定位'); expect(h.text()).toContain('既有会话保留原模型'); expect(h.text()).toContain('工具: 未知'); expect(h.text()).toContain('结构化输出: 已知不支持'); expect(h.text()).toContain('provider'); expect(h.text()).toContain('Host 配置版本: 2')
    expect(h.calls.map(v => v.input.action)).toEqual(['settings', 'inspect']); expect(h.nodes().filter(v => v.tag === 'button').some(v => /测试/.test(text(v)))).toBe(false)
  })
  it('edits provider/model/effort and one override, sending exact CAS configuration only on save', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); await h.press('Back'); await h.press('定位'); h.input(0, 'override', 'select'); h.input(2, 'second', 'select'); await h.flush()
    expect(h.calls.every(v => ['settings', 'inspect'].includes(v.input.action))).toBe(true)
    h.setReply(async (_path, input) => envelope(input, settings({ ...input.config, revision: input.config.revision + 1 }))); await h.submit()
    const saved = h.calls.at(-1)?.input
    expect(saved.action).toBe('save'); expect(saved.epoch).toBe('epoch-one'); expect(saved.config.revision).toBe(2); expect(saved.config.default.reasoningEffort).toBe('high'); expect(saved.config.stages.locate).toEqual({ mode: 'override', selection: { provider: 'provider', model: 'second' } })
    expect(h.text()).toContain('Host 已确认保存'); expect(h.text()).toContain('Host 配置版本: 3'); expect(h.calls.every(v => v.path === 'stage-models')).toBe(true)
  })
  it('does not optimistically update a version or resubmit an uncertain save, and refreshes to verify', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); const original = JSON.parse(JSON.stringify(h.state().form))
    h.setReply(async () => { throw new Error('lost') }); await h.submit(); await h.submit(); h.input(2, '', 'select')
    expect(h.calls.filter(v => v.input.action === 'save')).toHaveLength(1); expect(h.state().settings.configVersion).toBe(2); expect(h.state().pending.input.config).toEqual(original)
    const input = h.state().pending.input
    h.setReply(async () => settings({ ...original, revision: 3 })); await h.press('Refresh')
    expect(h.state().pending.input).toEqual(input)
    h.setReply(async () => envelope(input, settings({ ...original, revision: 3 }))); await h.press('MutationStatus')
    expect(h.state().pending).toBeNull(); expect(h.state().settings.configVersion).toBe(3); expect(h.text()).toContain('Host 已确认保存')
  })
  it('records an older canonical saved-version receipt without rolling back newer settings after refresh', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select')
    h.setReply(async () => { throw new Error('lost') }); await h.submit(); const input = h.state().pending.input
    h.setReply(async () => settings(config(4))); await h.press('Refresh')
    h.setReply(async () => envelope(input, settings({ ...input.config, revision: 3 }))); await h.press('MutationStatus')
    expect(h.state().pending).toBeNull(); expect(h.state().history).toHaveLength(1); expect(h.state().settings.configVersion).toBe(4); expect(h.state().needsReset).toBe(true)
    await h.press('载入 Host 最新配置（替换当前表单）'); expect(h.state().form.revision).toBe(4); expect(h.state().needsReset).toBe(false)
  })
  it('unlocks editing after journal-rejected save409 while retaining the old CAS until explicit reload', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.setReply(async (_path, input) => envelope(input, undefined, 'rejected', { code: 'stage_models_revision_conflict' })); await h.submit()
    expect(h.state().pending).toBeNull(); expect(h.state().history[0].mutation.state).toBe('rejected'); h.input(2, 'high', 'select'); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.state().form.revision).toBe(2)
    h.setReply(async () => settings(config(4))); await h.press('Refresh'); expect(h.state().form.revision).toBe(2); expect(h.state().settings.configVersion).toBe(4)
    await h.press('载入 Host 最新配置（替换当前表单）'); expect(h.state().form.revision).toBe(4); expect(h.state().history).toHaveLength(1)
  })
  it('rejects receipt revision/selection mismatch as unknown', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); h.setReply(async (_path, input) => envelope(input, settings(config(8)))); await h.submit()
    expect(h.state().pending.status).toBe('unknown'); expect(h.state().settings.configVersion).toBe(2); expect(h.text()).not.toContain('Host 已确认保存')
  })
  it('keeps edits across refresh without borrowing the new CAS revision; reset is explicit', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); h.setReply(async () => settings(config(3))); await h.press('Refresh')
    expect(h.state().form.revision).toBe(2); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.state().settings.configVersion).toBe(3); await h.press('SaveModels'); expect(h.calls.map(v => v.input.action)).not.toContain('save')
    await h.press('载入 Host 最新配置（替换当前表单）'); expect(h.state().form.revision).toBe(3); expect(h.state().form.default.reasoningEffort).toBeUndefined()
  })
  it('fences an old save on epoch changes, retaining evidence without adopting late success', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); const d = deferred(); h.setReply(async () => d.promise); const pending = h.submit(), oldConfig = h.calls.at(-1)?.input.config
    h.setReply(async () => settings(config(9))); h.render({ epoch: 'epoch-two' }); await h.flush(); d.resolve(envelope(h.calls.find(v => v.input.action === 'save')?.input, settings({ ...oldConfig, revision: 3 }))); await pending
    expect(h.state().settings.configVersion).toBe(9); expect(h.state().prior.epoch).toBe('epoch-one'); expect(h.state().pending).toBeNull(); expect(h.text()).not.toContain('Host 已确认保存')
  })
  it('loads real reasoning metadata for the selected model and blocks saving while inspect is pending', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); const d = deferred(); h.setReply(async () => d.promise)
    h.input(1, 'second', 'select'); await h.flush(); expect(h.state().form.default.reasoningEffort).toBeUndefined(); expect(h.text()).toContain('正在核实'); await h.press('SaveModels'); expect(h.calls.map(v => v.input.action)).not.toContain('save')
    d.resolve({ provider: 'provider', model: 'second', reasoningEfforts: [{ id: 'deep', name: '深入' }], defaultEffort: 'deep' }); await h.flush()
    expect(h.state().metadata[JSON.stringify(['provider', 'second'])].reasoningEfforts[0].id).toBe('deep'); expect(h.nodes().some(v => v.tag === 'option' && v.props.value === 'deep')).toBe(true)
  })
  it('ignores late reasoning metadata after model/epoch changes, including uncancelable replies', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); const d = deferred(); h.setReply(async () => d.promise); h.input(1, 'second', 'select')
    h.input(1, 'model', 'select'); d.resolve({ provider: 'provider', model: 'second', reasoningEfforts: [{ id: 'wrong', name: '旧模型' }] }); await h.flush()
    expect(h.state().metadata[JSON.stringify(['provider', 'second'])]).toBeUndefined(); expect(h.state().form.default.model).toBe('model')
  })
  it('does not load data while inactive and does not lose edited form across hide/reactivate', async () => {
    const h = harness('StageModels'); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); h.render({ active: false }); const count = h.calls.length
    await h.press('Refresh'); expect(h.calls).toHaveLength(count); h.render({ active: true }); await h.flush(); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.calls.at(-1)?.input.action).toBe('settings')
  })
})
