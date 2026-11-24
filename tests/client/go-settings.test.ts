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
const names: Record<string, string> = { Refresh: '刷新核实', Back: '返回列表', SaveModels: '保存阶段模型配置', MutationStatus: '核实原请求状态', MutationClose: '封存缺记录 ID，不重做' }
const stages = ['locate', 'understand', 'plan', 'execute', 'summarize', 'verify']
const catalog = [{ id: 'provider', name: '服务商', models: [{ id: 'model', name: '模型', reasoningEfforts: [{ id: 'high', name: '高' }] }, { id: 'second', name: '模型二' }] }]
const config = (revision = 2) => ({ revision, default: { provider: 'provider', model: 'model' }, stages: Object.fromEntries(stages.map(s => [s, { mode: 'inherit' }])) })
const settings = (c: any = config()) => ({ config: c, configVersion: c?.revision || 0, stages: Object.fromEntries(stages.map(stage => [stage, c ? { state: 'ready', configVersion: c.revision, ...(c.stages[stage].mode === 'override' ? c.stages[stage].selection : c.default), capabilityProof: { vision: 'supported', tools: 'unknown', structured: 'unsupported', contextWindow: 64000 } } : { state: 'blocked', configVersion: 0, code: 'stage_models_not_configured' }])), existingSessionModelPolicy: 'preserve', existingSessionOverride: 'unsupported', catalog })
function nodes(v: any): any[] { return Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' ? [v, ...(v.children || []).flatMap(nodes)] : [] }
function text(v: any): string { return Array.isArray(v) ? v.map(text).join('') : v && typeof v === 'object' ? text(v.children || []) : v == null || v === false ? '' : String(v) }
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
function envelope(input: any, value?: any, state = 'settled', extra: any = {}) {
  const kind = 'stage-save', payload = Object.fromEntries(Object.entries(input).filter(([k]) => !['action', 'epoch', 'requestId'].includes(k)))
  const digest = createHash('sha256').update(JSON.stringify(canonical([input.epoch, input.requestId, kind, payload]))).digest('hex')
  return canonical({ mutation: { version: 1, epoch: input.epoch, requestId: input.requestId, kind, digest, state, at: 100, updatedAt: state === 'closed' || state === 'recorded' ? 100 : 101, ...(state === 'closed' ? { code: 'config_mutation_id_closed' } : {}), ...extra }, ...(state === 'settled' ? { value } : {}) })
}
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes }); return { promise, resolve } }
function harness(initial: any = settings()) {
  const slots: any[] = [], calls: any[] = [], effects: any[] = []
  let cursor = 0, view: any, dirty = false, props: any = { epoch: 'epoch-one', active: true }, minted = 0
  const React = {
    createElement: (tag: any, props: any, ...children: any[]) => ({ tag, props: props || {}, children }), Fragment: 'fragment',
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true }] },
    useRef(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    useEffect(action: any, deps: any[]) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, k) => !Object.is(v, old.deps[k]))) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = action() }) } },
  }
  let respond = async (_path: string, body: any): Promise<any> => body.action === 'settings' ? initial : body.action === 'inspect' ? { provider: body.provider, model: body.model, reasoningEfforts: [{ id: 'high', name: '高' }] } : null
  const context = createContext({ React, TextEncoder, AbortController, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`, subtle: webcrypto.subtle } })
  new Script(serialized).runInContext(context)
  const components = context.factory(React, async (path: string, input: any, signal: any) => { calls.push({ path, input: JSON.parse(JSON.stringify(input)), signal }); return respond(path, input) }, (key: string) => key)
  const render = (next?: any) => { if (next) props = { ...props, ...next }; cursor = 0; dirty = false; view = components.StageModels(props); while (effects.length) effects.shift()(); return view }
  const flush = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); if (dirty) render() }; return view }
  const find = (tag: string, label?: string) => nodes(view).find(v => v.tag === tag && (label === undefined || text(v) === label))
  const press = async (key: string) => { const node = find('button', names[key] || key); expect(node, `Missing button ${key}`).toBeDefined(); if (!node.props.disabled) await node.props.onClick?.(); render(); return flush() }
  const input = (index: number, value: any, tag = 'input') => { const node = nodes(view).filter(v => v.tag === tag)[index]!; expect(node).toBeDefined(); if (!node.props.disabled) node.props.onChange({ target: { value, checked: value } }); render() }
  const submit = async () => { const node = find('form'); await node.props.onSubmit({ preventDefault() {} }); render(); await flush() }
  render()
  return { render, flush, calls, press, input, submit, nodes: () => nodes(view), text: () => text(view), find, setReply: (fn: typeof respond) => { respond = fn }, minted: () => minted, state: () => slots.find(v => v?.current?.state)?.current.state }
}

// Executes the complete serialized factory and actual handlers with tiny hook scheduling.
// This is interaction/closure contract evidence, not a React DOM, screenshot or visual acceptance claim.
describe('serialized GO settings factory and stage model UI', () => {
  it('has no imports/free helpers and only consumes injected React/request/t', async () => {
    expect(ast.statements.some(ts.isImportDeclaration)).toBe(false)
    const h = harness(); await h.flush()
    expect(h.calls.map(v => [v.path, v.input.action])).toEqual([['stage-models', 'settings'], ['stage-models', 'inspect']])
    expect(h.text()).toContain('阶段模型'); expect(h.text()).toContain('默认路由')
    expect(h.nodes().some(v => v.props.dangerouslySetInnerHTML)).toBe(false)
  })
})

describe('stage models actual configuration handlers', () => {
  it('returns Escape to the current list without bubbling into the shell or dropping edited drafts', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select')
    const calls = h.calls.length, events: string[] = []
    h.nodes().find(v => v.tag === 'section' && v.props.onKeyDown).props.onKeyDown({ key: 'Escape', preventDefault: () => events.push('prevent'), stopPropagation: () => events.push('stop') })
    h.render(); await h.flush(); expect(events).toEqual(['prevent', 'stop']); expect(h.calls).toHaveLength(calls)
    expect(h.state().selectedStage).toBeNull(); expect(h.state().form.default.reasoningEffort).toBe('high')
  })
  it('starts with seven route summaries and edits only one item, retaining draft and request count on back/navigation', async () => {
    const h = harness(); await h.flush(); const count = h.calls.length
    expect(h.state().selectedStage).toBeNull(); expect(h.nodes().filter(v => v.tag === 'li')).toHaveLength(7); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(0); expect(h.find('form')).toBeUndefined(); expect(h.text()).toContain('provider / model')
    await h.press('默认路由'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(3); h.input(2, 'high', 'select')
    await h.press('Back'); await h.press('定位'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(1); h.input(0, 'override', 'select'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(4)
    await h.press('Back'); await h.press('理解'); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(1); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.state().form.stages.locate.mode).toBe('override'); expect(h.calls).toHaveLength(count)
    h.nodes()[0].props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); h.render(); expect(h.state().selectedStage).toBeNull(); expect(h.nodes().filter(v => v.tag === 'select')).toHaveLength(0)
  })
  it('shows effective Host routes, explicit known/unknown capabilities and preserve policy without a test call', async () => {
    const h = harness(); await h.flush()
    await h.press('定位'); expect(h.text()).toContain('既有会话保留原模型'); expect(h.text()).toContain('工具: 未知'); expect(h.text()).toContain('结构化输出: 已知不支持'); expect(h.text()).toContain('provider'); expect(h.text()).toContain('Host 配置版本: 2')
    expect(h.calls.map(v => v.input.action)).toEqual(['settings', 'inspect']); expect(h.nodes().filter(v => v.tag === 'button').some(v => /测试/.test(text(v)))).toBe(false)
  })
  it('edits provider/model/effort and one override, sending exact CAS configuration only on save', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); await h.press('Back'); await h.press('定位'); h.input(0, 'override', 'select'); h.input(2, 'second', 'select'); await h.flush()
    expect(h.calls.every(v => ['settings', 'inspect'].includes(v.input.action))).toBe(true)
    h.setReply(async (_path, input) => envelope(input, settings({ ...input.config, revision: input.config.revision + 1 }))); await h.submit()
    const saved = h.calls.at(-1)?.input
    expect(saved.action).toBe('save'); expect(saved.epoch).toBe('epoch-one'); expect(saved.config.revision).toBe(2); expect(saved.config.default.reasoningEffort).toBe('high'); expect(saved.config.stages.locate).toEqual({ mode: 'override', selection: { provider: 'provider', model: 'second' } })
    expect(h.text()).toContain('Host 已确认保存'); expect(h.text()).toContain('Host 配置版本: 3'); expect(h.calls.every(v => v.path === 'stage-models')).toBe(true)
  })
  it('does not optimistically update a version or resubmit an uncertain save, and refreshes to verify', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); const original = JSON.parse(JSON.stringify(h.state().form))
    h.setReply(async () => { throw new Error('lost') }); await h.submit(); await h.submit(); h.input(2, '', 'select')
    expect(h.calls.filter(v => v.input.action === 'save')).toHaveLength(1); expect(h.state().settings.configVersion).toBe(2); expect(h.state().pending.input.config).toEqual(original)
    const input = h.state().pending.input
    h.setReply(async () => settings({ ...original, revision: 3 })); await h.press('Refresh')
    expect(h.state().pending.input).toEqual(input)
    h.setReply(async () => envelope(input, settings({ ...original, revision: 3 }))); await h.press('MutationStatus')
    expect(h.state().pending).toBeNull(); expect(h.state().settings.configVersion).toBe(3); expect(h.text()).toContain('Host 已确认保存')
  })
  it('records an older canonical saved-version receipt without rolling back newer settings after refresh', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select')
    h.setReply(async () => { throw new Error('lost') }); await h.submit(); const input = h.state().pending.input
    h.setReply(async () => settings(config(4))); await h.press('Refresh')
    h.setReply(async () => envelope(input, settings({ ...input.config, revision: 3 }))); await h.press('MutationStatus')
    expect(h.state().pending).toBeNull(); expect(h.state().history).toHaveLength(1); expect(h.state().settings.configVersion).toBe(4); expect(h.state().needsReset).toBe(true)
    await h.press('载入 Host 最新配置（替换当前表单）'); expect(h.state().form.revision).toBe(4); expect(h.state().needsReset).toBe(false)
  })
  it('unlocks editing after journal-rejected save409 while retaining the old CAS until explicit reload', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.setReply(async (_path, input) => envelope(input, undefined, 'rejected', { code: 'stage_models_revision_conflict' })); await h.submit()
    expect(h.state().pending).toBeNull(); expect(h.state().history[0].mutation.state).toBe('rejected'); h.input(2, 'high', 'select'); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.state().form.revision).toBe(2)
    h.setReply(async () => settings(config(4))); await h.press('Refresh'); expect(h.state().form.revision).toBe(2); expect(h.state().settings.configVersion).toBe(4)
    await h.press('载入 Host 最新配置（替换当前表单）'); expect(h.state().form.revision).toBe(4); expect(h.state().history).toHaveLength(1)
  })
  it.each(['digest', 'requestId', 'epoch', 'kind', 'version', 'updatedAt'])('rejects contradictory mutation %s before applying a saved config', async field => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select')
    h.setReply(async (_path, input) => envelope(input, settings({ ...input.config, revision: input.config.revision + 1 }), 'settled', { [field]: field === 'version' ? 2 : field === 'updatedAt' ? 99 : 'forged' }))
    await h.submit()
    expect(h.state().pending.status).toBe('unknown'); expect(h.state().settings.configVersion).toBe(2); expect(h.state().history).toHaveLength(0)
  })
  it('rejects receipt revision/selection mismatch as unknown', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); h.setReply(async (_path, input) => envelope(input, settings(config(8)))); await h.submit()
    expect(h.state().pending.status).toBe('unknown'); expect(h.state().settings.configVersion).toBe(2); expect(h.text()).not.toContain('Host 已确认保存')
  })
  it('keeps edits across refresh without borrowing the new CAS revision; reset is explicit', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); h.setReply(async () => settings(config(3))); await h.press('Refresh')
    expect(h.state().form.revision).toBe(2); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.state().settings.configVersion).toBe(3); await h.press('SaveModels'); expect(h.calls.map(v => v.input.action)).not.toContain('save')
    await h.press('载入 Host 最新配置（替换当前表单）'); expect(h.state().form.revision).toBe(3); expect(h.state().form.default.reasoningEffort).toBeUndefined()
  })
  it('fences an old save on epoch changes, retaining evidence without adopting late success', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); const d = deferred(); h.setReply(async () => d.promise); const pending = h.submit(), oldConfig = h.calls.at(-1)?.input.config
    h.setReply(async () => settings(config(9))); h.render({ epoch: 'epoch-two' }); await h.flush(); d.resolve(envelope(h.calls.find(v => v.input.action === 'save')?.input, settings({ ...oldConfig, revision: 3 }))); await pending
    expect(h.state().settings.configVersion).toBe(9); expect(h.state().prior.epoch).toBe('epoch-one'); expect(h.state().pending).toBeNull(); expect(h.text()).not.toContain('Host 已确认保存')
  })
  it('loads real reasoning metadata for the selected model and blocks saving while inspect is pending', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); const d = deferred(); h.setReply(async () => d.promise)
    h.input(1, 'second', 'select'); await h.flush(); expect(h.state().form.default.reasoningEffort).toBeUndefined(); expect(h.text()).toContain('正在核实'); await h.press('SaveModels'); expect(h.calls.map(v => v.input.action)).not.toContain('save')
    d.resolve({ provider: 'provider', model: 'second', reasoningEfforts: [{ id: 'deep', name: '深入' }], defaultEffort: 'deep' }); await h.flush()
    expect(h.state().metadata[JSON.stringify(['provider', 'second'])].reasoningEfforts[0].id).toBe('deep'); expect(h.nodes().some(v => v.tag === 'option' && v.props.value === 'deep')).toBe(true)
  })
  it('ignores late reasoning metadata after model/epoch changes, including uncancelable replies', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); const d = deferred(); h.setReply(async () => d.promise); h.input(1, 'second', 'select')
    h.input(1, 'model', 'select'); d.resolve({ provider: 'provider', model: 'second', reasoningEfforts: [{ id: 'wrong', name: '旧模型' }] }); await h.flush()
    expect(h.state().metadata[JSON.stringify(['provider', 'second'])]).toBeUndefined(); expect(h.state().form.default.model).toBe('model')
  })
  it('does not load data while inactive and does not lose edited form across hide/reactivate', async () => {
    const h = harness(); await h.flush(); await h.press('默认路由'); h.input(2, 'high', 'select'); h.render({ active: false }); const count = h.calls.length
    await h.press('Refresh'); expect(h.calls).toHaveLength(count); h.render({ active: true }); await h.flush(); expect(h.state().form.default.reasoningEffort).toBe('high'); expect(h.calls.at(-1)?.input.action).toBe('settings')
  })
})
