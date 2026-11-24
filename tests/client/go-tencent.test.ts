import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { createContext, Script } from 'node:vm'
import { TextEncoder } from 'node:util'
import ts from 'typescript'

const source = readFileSync('src/client/go-tencent.ts', 'utf8')
const ast = ts.createSourceFile('go-tencent.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const declaration = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'createGoTencent')!
const serialized = ts.transpileModule(`globalThis.factory = (${declaration.getText(ast).replace(/^export /, '')});`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
const revision = 'a'.repeat(64), snapshotId = 'b'.repeat(64), itemId = 'c'.repeat(64), nextRevision = 'd'.repeat(64)
const row = (extra: any = {}) => ({ id: 'issues', fileId: 'FILE_ID', sheetId: 'SHEET_ID', range: 'A1:C2', idColumn: 'A', titleColumn: 'B', textColumns: ['B', 'C'], revision, state: 'unscanned', snapshotId: null, ...extra })
const list = (sources = [row()]) => ({ sources, connection: 'blocked-auth-unavailable', support: [{ kind: 'tencent-sheet', state: 'partial' }, { kind: 'tencent-document', state: 'unsupported' }] })
const items = [{ itemId, rowId: 'BUG-1', row: 1, title: '<script>not-executed()</script>', text: '<img src=x onerror=run()> 原始任务', strike: 'unknown', eligible: false }]
const observation = (extra: any = {}) => ({ sourceId: 'issues', configRevision: revision, snapshotId, revision: snapshotId, state: 'partial', reason: 'tencent_sheet_evidence_incomplete', items, remoteRevision: 'unknown', images: { state: 'unknown', imageSeen: false }, authorization: 'not-granted', ...extra })
const snapshot = (extra: any = {}) => ({ ...observation(), config: row(), trust: 'external-untrusted', current: true, ...extra })
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const payload = (input: any) => Object.fromEntries(Object.entries(input).filter(([k]) => !['action', 'epoch', 'requestId'].includes(k)))
function envelope(input: any, value?: any, state = 'settled', extra: any = {}) {
  const kind = `tencent-${input.action}`, digest = createHash('sha256').update(JSON.stringify(canonical([input.epoch, input.requestId, kind, payload(input)]))).digest('hex')
  return { mutation: { version: 1, epoch: input.epoch, requestId: input.requestId, kind, digest, state, at: 100, updatedAt: state === 'recorded' || state === 'closed' ? 100 : 101, ...extra }, ...(state === 'settled' ? { value } : {}) }
}
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes }); return { promise, resolve } }
function nodes(v: any): any[] { return Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' ? [v, ...(v.children || []).flatMap(nodes)] : [] }
function text(v: any): string { return Array.isArray(v) ? v.map(text).join('') : v && typeof v === 'object' ? text(v.children || []) : v == null || v === false ? '' : String(v) }
const names: Record<string, string> = { Add: '添加来源', Configure: '配置来源', Back: '返回列表', Refresh: '刷新核实', Save: '保存配置', Scan: '手动读取', Preview: '查看文本快照', Remove: '移除配置', Status: '核实原请求状态', Close: '封存缺记录 ID，不重做', Reset: '载入 Host 最新配置（替换当前表单）' }
function harness(initial = list(), initialProps: any = {}) {
  const slots: any[] = [], effects: any[] = [], calls: any[] = []; let cursor = 0, dirty = false, view: any, minted = 0, props: any = { epoch: 'epoch-one', active: true, ...initialProps }
  const React = {
    createElement: (tag: any, props: any, ...children: any[]) => ({ tag, props: props || {}, children }),
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true }] },
    useRef(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    useEffect(action: any, deps: any[]) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, k) => !Object.is(v, old.deps[k]))) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = action() }) } },
  }
  let respond = async (_path: string, input: any): Promise<any> => input.action === 'list' ? initial : input.action === 'detail' ? snapshot() : null
  const context = createContext({ React, AbortController, TextEncoder, Uint8Array, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`, subtle: webcrypto.subtle } })
  new Script(serialized).runInContext(context)
  const { TencentSources } = context.factory(React, async (path: string, input: any, signal: any) => { calls.push({ path, input: JSON.parse(JSON.stringify(input)), signal }); return respond(path, input) }, (key: string) => key)
  const render = (next?: any) => { if (next) props = { ...props, ...next }; cursor = 0; dirty = false; view = TencentSources(props); while (effects.length) effects.shift()(); return view }
  const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render() }; return view }
  const find = (tag: string, label?: string) => nodes(view).find(n => n.tag === tag && (label === undefined || text(n) === label))
  const press = async (name: string) => { const node = find('button', names[name] || name); expect(node, name).toBeDefined(); if (!node.props.disabled) await node.props.onClick(); render(); return flush() }
  const input = (index: number, value: any) => { const node = nodes(view).filter(n => n.tag === 'input')[index]; expect(node).toBeDefined(); if (!node.props.disabled) node.props.onChange({ target: { value, checked: value } }); render() }
  const submit = async () => { await find('form').props.onSubmit({ preventDefault() {} }); render(); await flush() }
  render()
  return { calls, render, flush, find, press, input, submit, text: () => text(view), nodes: () => nodes(view), state: () => slots.find(v => v?.current?.state)?.current.state, minted: () => minted, setReply: (fn: typeof respond) => { respond = fn } }
}
async function editView(h: ReturnType<typeof harness>) { await h.flush(); await h.press('Configure') }

// Executes the serialized factory's actual handlers with hook scheduling; not a DOM/browser/visual test.
describe('Tencent source configuration factory contracts', () => {
  it('is self-contained, capped, reads only metadata on mount and exposes honest unsupported/auth/image/version gaps', async () => {
    expect(ast.statements.some(ts.isImportDeclaration)).toBe(false); expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(160)
    const h = harness(); await h.flush()
    expect(h.calls.map(c => [c.path, c.input])).toEqual([['tencent-source', { action: 'list', epoch: 'epoch-one' }]])
    for (const message of ['Host 授权缺失', '远端版本与原图仍未知', '普通腾讯文档、Office、PDF 不支持', '企微在线表格不是此连接器']) expect(h.text()).toContain(message)
    expect(h.nodes().some(n => n.tag === 'img' || n.props.dangerouslySetInnerHTML)).toBe(false)
    expect(h.nodes().filter(n => n.tag === 'button').some(n => /OAuth|授权登录|承接/.test(text(n)))).toBe(false)
    const inactive = harness(list(), { active: false }); await inactive.flush(); expect(inactive.calls).toEqual([])
  })
  it('accepts IDs and bounded A1 mapping, saves exact CAS payload and never auto scans', async () => {
    const h = harness(list([])); await h.flush(); await h.press('Add')
    h.input(0, 'new-source'); h.input(1, 'https://docs.qq.com/sheet/file'); h.input(2, 'tab'); await h.submit(); expect(h.minted()).toBe(0)
    h.input(1, 'FILE'); h.input(3, 'A2:C3'); h.input(6, ' B, C ')
    h.setReply(async (_path, input) => envelope(input, row({ ...payload(input), revision: nextRevision }))); await h.submit()
    expect(h.calls.at(-1).input).toEqual({ action: 'configure', epoch: 'epoch-one', requestId: '00000000-0000-4000-8000-000000000001', id: 'new-source', fileId: 'FILE', sheetId: 'tab', range: 'A2:C3', idColumn: 'A', titleColumn: 'B', textColumns: ['B', 'C'], expectedRevision: null })
    expect(h.calls.map(c => c.input.action)).toEqual(['list', 'configure']); expect(h.state().source.revision).toBe(nextRevision); expect(h.state().history).toHaveLength(1)
  })
  it.each(['A1:C1001', 'C3:A1', 'A1:ZZZ1000', 'A1:C0', 'A:A', 'A1:C2'])('blocks invalid range/mapping %s before mutation', async range => {
    const h = harness(); await editView(h); h.input(3, range); if (range === 'A1:C2') h.input(6, 'B,B')
    await h.submit(); expect(h.minted()).toBe(0); expect(h.calls).toHaveLength(1)
  })
  it('keeps stale edited CAS instead of borrowing a refreshed config revision', async () => {
    const h = harness(); await editView(h); h.input(1, 'EDITED_FILE')
    h.setReply(async (_path, input) => input.action === 'list' ? list([row({ revision: nextRevision })]) : envelope(input, row({ fileId: 'EDITED_FILE', revision: 'e'.repeat(64) })))
    await h.press('Refresh'); await h.submit(); expect(h.calls.at(-1).input.expectedRevision).toBe(revision)
  })
  it('records a real explicit scan as blocked auth, retaining unknown evidence and no task/claim path', async () => {
    const h = harness(); await editView(h)
    h.setReply(async (_path, input) => envelope(input, observation({ snapshotId: null, revision: undefined, state: 'blocked', reason: 'tencent_sheet_auth_unavailable', items: [] })))
    await h.press('Scan')
    expect(h.calls.at(-1).input).toEqual({ action: 'scan', epoch: 'epoch-one', requestId: '00000000-0000-4000-8000-000000000001', id: 'issues', expectedRevision: revision, expectedSnapshot: null })
    expect(h.state().pending).toBeNull(); expect(h.state().source.state).toBe('blocked'); expect(h.text()).toContain('tencent_sheet_auth_unavailable'); expect(h.find('button', names.Preview).props.disabled).toBe(true)
    expect(h.calls.some(c => c.input.action === 'claim' || c.path === 'command')).toBe(false)
  })
  it('shows only escaped partial text snapshots, rejects stronger image/version/authority claims', async () => {
    const h = harness(list([row({ snapshotId, state: 'partial' })])); await editView(h); await h.press('Preview')
    expect(h.calls.at(-1).input).toEqual({ action: 'detail', epoch: 'epoch-one', id: 'issues', expectedRevision: revision, snapshotId })
    expect(h.text()).toContain('<img src=x onerror=run()>'); expect(h.text()).toContain('remoteRevision: unknown'); expect(h.text()).toContain('imageSeen: false')
    expect(h.nodes().some(n => n.tag === 'img' || n.props.dangerouslySetInnerHTML)).toBe(false)
    for (const forged of [{ remoteRevision: 'known' }, { images: { state: 'available', imageSeen: true } }, { authorization: 'granted' }, { config: row({ revision: nextRevision }) }, { items: [{ ...items[0], eligible: true }] }]) {
      await h.press('Back'); await h.press('Configure'); h.setReply(async () => snapshot(forged)); await h.press('Preview'); expect(h.state().view).toBe('config'); expect(h.state().error).toBeTruthy()
    }
  })
  it('locks unknown mutations, does not infer completion from list and preserves original ID across 404 status', async () => {
    const h = harness(); await editView(h); h.input(1, 'EDITED')
    h.setReply(async () => { throw new Error('lost') }); await h.submit(); const original = h.state().pending.input
    h.input(1, 'CHANGED'); await h.submit(); expect(h.minted()).toBe(1); expect(h.state().pending.input).toEqual(original)
    h.setReply(async () => list([row({ fileId: 'EDITED', revision: nextRevision })])); await h.press('Refresh'); expect(h.state().pending.input).toEqual(original)
    h.setReply(async () => { throw Object.assign(new Error('missing'), { status: 404 }) }); await h.press('Status')
    expect(h.calls.at(-1).path).toBe('config-mutation'); expect(h.calls.at(-1).input).toEqual({ action: 'status', epoch: 'epoch-one', requestId: original.requestId }); expect(h.state().pending.input).toEqual(original)
    h.setReply(async () => envelope(original, row({ fileId: 'EDITED', revision: nextRevision }))); await h.press('Status'); expect(h.state().pending).toBeNull(); expect(h.state().history[0].input).toEqual(original)
  })
  it('closes a missing original ID explicitly without replay, requires refresh/reset and ignores late old execution', async () => {
    const h = harness(); await editView(h); const d = deferred(); h.setReply(async () => d.promise)
    const saving = h.submit(); const original = h.calls.at(-1).input; h.render({ active: false }); expect(h.calls.at(-1).signal.aborted).toBe(true)
    h.setReply(async () => list()); h.render({ active: true }); await h.flush()
    h.setReply(async () => envelope(original, undefined, 'closed', { code: 'config_mutation_id_closed' })); await h.press('Close')
    expect(h.calls.at(-1).input).toEqual({ action: 'close', epoch: 'epoch-one', requestId: original.requestId, kind: 'tencent-configure', payload: payload(original) }); expect(h.state().needsReset).toBe(true); expect(h.state().data).toBeNull()
    d.resolve(envelope(original, row({ revision: nextRevision }))); await saving; expect(h.state().source.revision).toBe(revision); expect(h.state().history).toHaveLength(1)
    h.setReply(async () => list([row({ revision: nextRevision })])); await h.press('Refresh'); expect(h.state().needsReset).toBe(true); await h.press('Reset'); expect(h.state().needsReset).toBe(false); expect(h.state().form.revision).toBe(nextRevision); expect(h.minted()).toBe(1)
  })
  it('allows explicit new editing only after a validated rejection and retains rejected receipt', async () => {
    const h = harness(); await editView(h); h.setReply(async (_path, input) => envelope(input, undefined, 'rejected', { code: 'tencent_sheet_config_conflict' })); await h.submit()
    expect(h.state().pending).toBeNull(); expect(h.state().history[0].mutation.state).toBe('rejected'); expect(h.text()).toContain('Host 已明确拒绝')
    h.input(1, 'NEW_FILE'); h.setReply(async (_path, input) => envelope(input, row({ fileId: 'NEW_FILE', revision: nextRevision }))); await h.submit()
    expect(h.minted()).toBe(2); expect(h.state().history).toHaveLength(2); expect(h.state().source.fileId).toBe('NEW_FILE')
  })
  it('requires exact digest/state/monotonic receipt and never closes a recorded operation', async () => {
    const h = harness(); await editView(h); h.setReply(async (_path, input) => envelope(input, undefined, 'recorded')); await h.submit(); const original = h.state().pending.input
    expect(h.state().pending.status).toBe('recorded'); expect(h.find('button', names.Close).props.disabled).toBe(true)
    for (const extra of [{ digest: 'f'.repeat(64) }, { epoch: 'another' }, { kind: 'local-configure' }, { requestId: 'other' }, { at: 99 }, { updatedAt: 99 }]) {
      h.setReply(async () => envelope(original, row({ revision: nextRevision }), 'settled', extra)); await h.press('Status'); expect(h.state().pending).not.toBeNull(); expect(h.state().source.revision).toBe(revision)
    }
    h.setReply(async () => envelope(original, row({ revision: nextRevision }))); await h.press('Status'); expect(h.state().pending).toBeNull()
  })
  it('retains a settled old scan receipt without attaching its snapshot to a newer refreshed configuration', async () => {
    const h = harness(); await editView(h); h.setReply(async () => { throw new Error('lost') }); await h.press('Scan'); const original = h.state().pending.input
    h.setReply(async () => list([row({ revision: nextRevision })])); await h.press('Refresh')
    h.setReply(async () => envelope(original, observation())); await h.press('Status')
    expect(h.state().pending).toBeNull(); expect(h.state().history).toHaveLength(1); expect(h.state().source.revision).toBe(nextRevision); expect(h.state().source.snapshotId).toBeNull(); expect(h.state().needsReset).toBe(true)
  })
  it('requires removal confirmation and accepts only the exact id removal receipt', async () => {
    const h = harness(); await editView(h); await h.press('Remove'); expect(h.minted()).toBe(0); h.input(7, true)
    h.setReply(async (_path, input) => envelope(input, { id: input.id, removed: true })); await h.press('Remove')
    expect(h.calls.at(-1).input).toMatchObject({ action: 'remove', id: 'issues', expectedRevision: revision }); expect(h.state().view).toBe('list'); expect(h.state().data.sources).toEqual([])
  })
  it('fences double clicks, stale handlers, hidden/old epochs and late detail navigation', async () => {
    const h = harness(list([row({ snapshotId, state: 'partial' })])); await editView(h); const d = deferred(), oldForm = h.find('form'); h.setReply(async () => d.promise)
    const saving = h.submit(); const original = h.calls.at(-1).input; oldForm.props.onSubmit({ preventDefault() {} }); expect(h.minted()).toBe(1)
    h.setReply(async () => list()); h.render({ epoch: 'epoch-two' }); await h.flush(); const count = h.calls.length; oldForm.props.onSubmit({ preventDefault() {} }); await h.flush(); expect(h.calls).toHaveLength(count)
    d.resolve(envelope(original, row({ revision: nextRevision }))); await saving; expect(h.state().history[0].input.epoch).toBe('epoch-one'); expect(h.state().pending).toBeNull(); expect(h.state().view).toBe('list')
    const other = harness(list([row({ snapshotId, state: 'partial' })])); await editView(other); const detail = deferred(); other.setReply(async () => detail.promise); const reading = other.press('Preview'); other.render(); await other.press('Back'); detail.resolve(snapshot()); await reading; expect(other.state().view).toBe('list'); expect(other.state().detail).toBeNull()
  })
})
