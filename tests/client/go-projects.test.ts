import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'
import { SessionWorkSource } from '../../src/sources/session-work.js'

const source = readFileSync('src/client/go-projects.ts', 'utf8')
const ast = ts.createSourceFile('go-projects.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const declaration = ast.statements.find((v): v is ts.FunctionDeclaration => ts.isFunctionDeclaration(v) && v.name?.text === 'createGoProjects')!
const serialized = ts.transpileModule(`globalThis.factory = (${declaration.getText(ast).replace(/^export /, '')});`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64), factRevision = 'c'.repeat(64)
const project = (key = 'one', extra: any = {}) => ({ kind: 'project', key, name: '同名项目', excluded: false, sessionTotal: 1, includedTotal: 1, ...extra })
const projects = (items = [project()], extra: any = {}) => ({ state: 'ready', revision, sampledAt: 100, items, total: items.length, hasMore: false, ...extra })
const item = (sessionId = 'session-one', extra: any = {}) => ({ sessionId, title: '原会话', objective: '真实结构化目标', project: { kind: 'project', key: 'one', name: '同名项目' }, runtime: 'idle', goalPhase: 'active', progress: '正在修复', done: ['已复现'], nextAction: '回归测试', blocker: '等待外部环境', decision: '是否兼容旧接口？', result: { state: 'unverified', summary: '已复现', acceptanceVerified: false }, approvalCoverage: 'unavailable', observedAt: 101, evidence: 'structured', excluded: false, factRevision, ...extra })
const page = (items = [item()], extra: any = {}) => ({ state: 'ready', sampledAt: 101, scope: 'current-host', defaultIncluded: true, total: items.length, excludedTotal: 0, internalTotal: 0, items, hasMore: false, revision, ...extra })
function nodes(v: any): any[] { return Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' ? [v, ...(v.children || []).flatMap(nodes)] : [] }
function text(v: any): string { return Array.isArray(v) ? v.map(text).join('') : v && typeof v === 'object' ? text(v.children || []) : v == null || v === false ? '' : String(v) }
function deferred() { let resolve!: (v: any) => void, reject!: (v: any) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function harness(options: { props?: any; reply?: (path: string, input: any) => Promise<any>; t?: (key: string) => string } = {}) {
  const slots: any[] = [], calls: any[] = [], effects: any[] = [], navigations: any[] = [], inspections: any[] = []
  let cursor = 0, view: any, dirty = false, props: any
  const React = {
    createElement: (tag: any, props: any, ...children: any[]) => ({ tag, props: props || {}, children }),
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true }] },
    useRef(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    useEffect(action: any, deps: any[]) { const i = cursor++, old = slots[i]; if (!old || deps.length !== old.deps.length || deps.some((v, k) => !Object.is(v, old.deps[k]))) { slots[i] = { deps, action, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = action() }) } },
  }
  let reply = options.reply || (async (_path: string, input: any) => input.action === 'projects' ? projects() : page())
  const context = createContext({ AbortController })
  new Script(serialized).runInContext(context)
  const factory = context.factory(React, async (path: string, input: any, signal: any) => { calls.push({ path, input: JSON.parse(JSON.stringify(input)), signal }); return reply(path, input) }, options.t || ((key: string) => key))
  props = { epoch: 'epoch-one', active: true, onNavigate: (route: any) => { navigations.push(route); props = { ...props, projectKey: undefined, sessionId: undefined, tab: undefined, ...route }; dirty = true }, onInspectTarget: (row: any, revision: string) => inspections.push({ row, revision }), ...options.props }
  const render = (next?: any) => { if (next) props = { ...props, ...next }; cursor = 0; dirty = false; view = factory.Projects(props); while (effects.length) effects.shift()(); return view }
  const flush = async () => { for (let i = 0; i < 18; i++) { await Promise.resolve(); if (dirty) render() }; return view }
  const find = (label: string) => nodes(view).find(v => v.tag === 'button' && (text(v) === label || v.props['aria-label'] === label))
  const click = (label: string) => { const node = find(label); expect(node, `Missing button ${label}`).toBeDefined(); const result = !node.props.disabled ? node.props.onClick?.() : undefined; render(); return result }
  const press = async (label: string) => { await click(label); return flush() }
  const unmount = () => { for (const slot of slots) slot?.cleanup?.() }
  const replayEffects = () => { for (const slot of slots) slot?.cleanup?.(); for (const slot of slots) if (slot?.action) slot.cleanup = slot.action() }
  render()
  return { render, flush, calls, press, click, find, navigations, inspections, unmount, replayEffects, nodes: () => nodes(view), text: () => text(view), setReply: (fn: typeof reply) => { reply = fn }, state: () => slots.find(v => v?.current?.state)?.current.state }
}
const moreProjects = '加载更多项目', moreSessions = '加载更多会话', refresh = '刷新项目与范围'
const openProject = (key: string) => `进入项目 同名项目 #${key}`

// The complete serialized runtime and real handlers execute through a small hook scheduler.
// These are DTO/lifecycle/interaction contracts, not DOM, screenshot or visual acceptance.
describe('serialized GO projects runtime', () => {
  it('has no imports or module helpers and only issues the bounded read-only projects request', async () => {
    expect(ast.statements.some(ts.isImportDeclaration)).toBe(false)
    const h = harness(); await h.flush()
    expect(h.calls.map(v => [v.path, v.input])).toEqual([['session-work', { action: 'projects', epoch: 'epoch-one', limit: 20 }]])
    expect(h.text()).toContain('项目索引：已加载 / 总数: 1 / 1')
    expect(h.text()).toContain('纳入会话 / 全部会话: 1 / 1')
    expect(h.text()).not.toMatch(/1 件事项|1 项事项/)
    expect(h.nodes().some(v => v.props.dangerouslySetInnerHTML)).toBe(false)
  })
  it('prefers injected translations and falls back locally for missing or throwing keys', async () => {
    const h = harness({ t: key => { if (key === 'wProjects') return 'Projects'; if (key === 'wProjectsIntro') throw new Error('missing'); return key } }); await h.flush()
    expect(h.text()).toContain('Projects'); expect(h.text()).toContain('浏览不改变对话草稿')
  })
  it('paginates the project index in pages of 20 and filters excluded metadata only', async () => {
    const first = Array.from({ length: 20 }, (_, i) => project(`project-${i}`, { excluded: i === 0 }))
    const h = harness({ reply: async (_path, input) => projects(input.cursor ? [project('last')] : first, { total: 21, hasMore: !input.cursor, ...(input.cursor ? {} : { next: 'projects_page_two' }) }) }); await h.flush()
    expect(h.nodes().filter(v => v.props.className === 'saw-project-card')).toHaveLength(19)
    await h.press(moreProjects)
    expect(h.calls.at(-1)?.input).toEqual({ action: 'projects', epoch: 'epoch-one', limit: 20, cursor: 'projects_page_two' })
    expect(h.text()).toContain('21 / 21'); expect(h.nodes().filter(v => v.props.className === 'saw-project-card')).toHaveLength(20)
  })
  it('routes stable IDs for same-title projects, never merges by title or changes a sending draft', async () => {
    const draft = { text: '保留草稿', target: 'another-session', images: ['untouched'] }, before = JSON.stringify(draft)
    const h = harness({ reply: async (_path, input) => input.action === 'projects' ? projects([project('same-prefix-a'), project('same-prefix-b')]) : page([item('second-session', { project: { kind: 'project', key: 'same-prefix-b', name: '同名项目' } })]) }); await h.flush()
    expect(h.nodes().filter(v => v.props.className === 'saw-project-card')).toHaveLength(2)
    await h.press(openProject('same-prefix-b'))
    expect(h.navigations.at(-1)).toEqual({ projectKey: 'project:same-prefix-b', tab: 'work' })
    expect(h.calls.at(-1)?.input).toEqual({ action: 'list', epoch: 'epoch-one', view: 'included', projectKey: 'project:same-prefix-b', limit: 20 })
    expect(JSON.stringify(draft)).toBe(before)
  })
  it('retains project identity across renames and refreshes facts only under the matching catalog revision', async () => {
    const h = harness({ props: { projectKey: 'project:one' } }); await h.flush()
    h.setReply(async (_path, input) => input.action === 'projects' ? projects([project('one', { name: '新名称' })], { revision: nextRevision }) : page([item()], { revision: nextRevision }))
    await h.press(refresh)
    expect(h.text()).toContain('新名称'); expect(h.text()).toContain('真实结构化目标')
    expect(h.calls.filter(v => v.input.action === 'list').map(v => v.input.projectKey)).toEqual(['project:one', 'project:one'])
  })
  it('loads only included sessions, pages observations without treating session count as work total', async () => {
    const first = Array.from({ length: 20 }, (_, i) => item(`session-${i}`, i === 0 ? { objective: undefined } : {}))
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects([project('one', { sessionTotal: 21, includedTotal: 21 })]) : page(input.cursor ? [item('last')] : first, { total: 21, hasMore: !input.cursor, ...(input.cursor ? {} : { next: 'sessions_page_two' }) }) }); await h.flush()
    expect(h.text()).toContain('已加载结构化目标观察: 19'); expect(h.text()).toContain('会话数量不是事项总数')
    await h.press(moreSessions)
    expect(h.calls.at(-1)?.input).toEqual({ action: 'list', epoch: 'epoch-one', view: 'included', projectKey: 'project:one', limit: 20, cursor: 'sessions_page_two' })
    expect(h.text()).toContain('已加载结构化目标观察: 20'); expect(h.text()).toContain('21 / 21')
    const row = h.nodes().find(v => v.props.className === 'saw-work-row'); row.props.onClick(); h.render(); await h.flush()
    expect(h.navigations.at(-1)).toEqual({ projectKey: 'project:one', sessionId: 'session-1', tab: 'overview' })
  })
  it('keeps a separate actual-session view without inventing an objective or a duplicate entity', async () => {
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item('session-one', { objective: undefined, evidence: 'missing' })]) }); await h.flush()
    expect(h.text()).toContain('不等于项目没有工作'); expect(h.nodes().filter(v => v.props.className === 'saw-work-row')).toHaveLength(0)
    await h.press('关联会话'); expect(h.text()).toContain('这里只列实际的原会话上下文')
    expect(h.nodes().filter(v => v.props.className === 'saw-work-row')).toHaveLength(1)
    await h.press('查看当前工作观察'); expect(h.text()).toContain('不能据标题创造事项')
  })
  it('shows observed done/progress/next/blocker/question facts with an explicit approval coverage gap and no timeline', async () => {
    const h = harness({ props: { projectKey: 'project:one', sessionId: 'session-one', tab: 'progress' } }); await h.flush()
    for (const value of ['已复现', '正在修复', '回归测试', '等待外部环境', '是否兼容旧接口？', '审批覆盖缺口', '没有可信事件时间线']) expect(h.text()).toContain(value)
    expect(h.nodes().some(v => /timeline/.test(v.props.className || ''))).toBe(false)
    await h.press('关联'); expect(h.text()).toContain('没有可信来源关联'); expect(h.text()).toContain('原会话')
    expect(h.calls.map(v => v.input.action)).toEqual(['projects', 'list'])
  })
  it('never presents goal complete, completed steps or idle as verified acceptance', async () => {
    const h = harness({ props: { projectKey: 'project:one', sessionId: 'session-one', tab: 'results' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item('session-one', { goalPhase: 'complete', result: { state: 'goal-complete', summary: '目标完成声明', acceptanceVerified: false } })]) }); await h.flush()
    expect(h.text()).toContain('目标自报完成（未验收）'); expect(h.text()).toContain('acceptanceVerified: false'); expect(h.text()).toContain('不是验收通过')
    expect(h.text()).not.toContain('已验证通过')
    await h.press('概览'); expect(h.text()).toContain('空闲（不等于完成）')
  })
  it('fails closed on a forged verified result and does not expose its body', async () => {
    const h = harness({ props: { projectKey: 'project:one', sessionId: 'session-one', tab: 'results' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item('session-one', { result: { state: 'goal-complete', summary: 'FORGED', acceptanceVerified: true } })]) }); await h.flush()
    expect(h.text()).not.toContain('FORGED'); expect(h.text()).toContain('未发布正文'); expect(h.state().page).toBeNull()
  })
  it('rejects excluded, unknown-membership and cross-project session bodies before publishing', async () => {
    for (const invalid of [item('session-one', { excluded: true }), item('session-one', { exclusionReason: 'membership-unknown' }), item('session-one', { project: { kind: 'unknown', key: 'unknown' } }), item('session-one', { project: { kind: 'project', key: 'two', name: '同名项目' } })]) {
      const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([invalid]) }); await h.flush()
      expect(h.text()).not.toContain('真实结构化目标'); expect(h.text()).toContain('未发布正文'); expect(h.state().page).toBeNull()
    }
  })
  it('makes unknown, not-loaded and session-only references explicitly recoverable without title guessing', async () => {
    const h = harness({ props: { projectKey: 'project:later' }, reply: async (_path, input) => input.action === 'list' ? page([item('session-one', { project: { kind: 'project', key: 'later', name: '同名项目' } })]) : input.cursor ? projects([project('later')], { total: 2 }) : projects([project()], { total: 2, hasMore: true, next: 'next_project' }) }); await h.flush()
    expect(h.text()).toContain('不在已加载索引'); expect(h.calls).toHaveLength(1)
    await h.press(moreProjects); expect(h.calls.at(-1)?.input.projectKey).toBe('project:later'); expect(h.text()).toContain('真实结构化目标')
    const onlySession = harness({ props: { sessionId: 'session-one' } }); await onlySession.flush()
    expect(onlySession.text()).toContain('尚无已核实的项目引用'); expect(onlySession.calls.every(v => v.input.action === 'projects')).toBe(true)
  })
  it('recovers a current session absent from the first page by explicit pagination, never by a direct body read', async () => {
    const h = harness({ props: { projectKey: 'project:one', sessionId: 'last' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page(input.cursor ? [item('last')] : [item('first')], { total: 2, hasMore: !input.cursor, ...(input.cursor ? {} : { next: 'next_session' }) }) }); await h.flush()
    expect(h.text()).toContain('不在已加载的纳入页中'); expect(h.text()).not.toContain('真实结构化目标')
    await h.press(moreSessions); expect(h.text()).toContain('真实结构化目标')
    expect(h.calls.every(v => v.input.sessionId === undefined)).toBe(true)
  })
  it('uses unassigned as the literal scope key and still reads only included sessions', async () => {
    const h = harness({ props: { projectKey: 'unassigned' }, reply: async (_path, input) => input.action === 'projects' ? projects([{ kind: 'unassigned', key: 'unassigned', excluded: false, sessionTotal: 1, includedTotal: 1 }]) : page([item('session-one', { project: { kind: 'unassigned', key: 'unassigned' } })]) }); await h.flush()
    expect(h.calls.at(-1)?.input).toEqual({ action: 'list', epoch: 'epoch-one', view: 'included', projectKey: 'unassigned', limit: 20 })
  })
  it('invalidates immediately on scopeRevision changes, aborts pending reads and fences cached old handlers', async () => {
    const pending = deferred(), h = harness({ props: { projectKey: 'project:one', scopeRevision: revision } }); await h.flush()
    const oldRow = h.nodes().find(v => v.props.className === 'saw-work-row')
    h.setReply(async (_path, input) => input.action === 'projects' ? projects() : pending.promise)
    const work = h.click(refresh); await work; await h.flush(); expect(h.calls.at(-1)?.input.action).toBe('list')
    h.render({ scopeRevision: nextRevision }); expect(h.text()).not.toContain('真实结构化目标')
    expect(h.calls.filter(v => v.input.action === 'list').at(-1)?.signal.aborted).toBe(true)
    oldRow.props.onClick(); expect(h.navigations).toHaveLength(0)
    h.setReply(async (_path, input) => input.action === 'projects' ? projects([], { revision: nextRevision }) : page([], { revision: nextRevision }))
    pending.resolve(page([item('late', { objective: 'LATE SECRET' })])); await h.flush()
    expect(h.text()).not.toContain('LATE SECRET')
  })
  it.each(['epoch', 'active', 'unmount'])('does not publish late facts after %s revocation', async kind => {
    const d = deferred(), h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : d.promise }); await h.flush()
    const oldList = h.calls.at(-1)
    if (kind === 'unmount') h.unmount(); else h.render(kind === 'epoch' ? { epoch: 'epoch-two' } : { active: false })
    expect(oldList?.signal.aborted).toBe(true)
    h.setReply(async () => projects([])); d.resolve(page([item('late', { objective: 'LATE FACT' })])); await h.flush()
    expect(h.state().page).toBeNull(); expect(h.text()).not.toContain('LATE FACT')
  })
  it('does not read while inactive; reactivate starts fresh catalog and never reuses old facts', async () => {
    const h = harness({ props: { projectKey: 'project:one', active: false } }); await h.flush(); expect(h.calls).toHaveLength(0)
    h.render({ active: true }); await h.flush(); expect(h.text()).toContain('真实结构化目标')
    const oldInspect = h.find('核对当前目标（不执行）'); h.render({ active: false }); expect(h.text()).not.toContain('真实结构化目标'); oldInspect?.props.onClick(); expect(h.inspections).toHaveLength(0)
    h.render({ active: true }); await h.flush(); expect(h.calls.map(v => v.input.action)).toEqual(['projects', 'list', 'projects', 'list'])
  })
  it('fences late cross-project cursor replies and stale more handlers', async () => {
    const d = deferred(), h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects([project(), project('two')]) : page([item('first')], { total: 2, hasMore: true, next: 'one_cursor' }) }); await h.flush()
    const oldMore = h.find(moreSessions)
    h.setReply(async (_path, input) => input.projectKey === 'project:one' ? d.promise : page([item('two-session', { objective: 'PROJECT TWO', project: { kind: 'project', key: 'two', name: '同名项目' } })]))
    const pending = h.click(moreSessions); h.render({ projectKey: 'project:two' }); await h.flush()
    oldMore.props.onClick(); expect(h.calls.filter(v => v.input.cursor === 'one_cursor')).toHaveLength(1)
    d.resolve(page([item('late', { objective: 'PROJECT ONE LATE' })], { total: 2 })); await pending; await h.flush()
    expect(h.text()).toContain('PROJECT TWO'); expect(h.text()).not.toContain('PROJECT ONE LATE'); expect(h.state().page.projectKey).toBe('project:two')
    expect(h.calls.filter(v => v.input.projectKey === 'project:two').every(v => v.input.cursor === undefined)).toBe(true)
  })
  it('requires same-revision catalog and facts, clears stale content and offers explicit refresh instead of auto retry', async () => {
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item()], { revision: nextRevision }) }); await h.flush()
    expect(h.text()).toContain('请刷新项目与范围'); expect(h.state().catalog).toBeNull(); expect(h.text()).not.toContain('真实结构化目标'); expect(h.calls).toHaveLength(2)
    h.setReply(async (_path, input) => input.action === 'projects' ? projects([], { revision: nextRevision }) : page([], { revision: nextRevision })); await h.press(refresh)
    expect(h.state().catalog.revision).toBe(nextRevision)
  })
  it('uses scopeRevision as an invalidate token, not an equality gate against older polling state', async () => {
    const h = harness({ props: { projectKey: 'project:one', scopeRevision: nextRevision } }); await h.flush()
    expect(h.text()).toContain('真实结构化目标'); expect(h.state().page.revision).toBe(revision)
  })
  it.each(['projects', 'list'])('rejects changed %s pagination revisions and 409 without retaining body/cursor', async action => {
    const h = harness({ props: action === 'list' ? { projectKey: 'project:one' } : {}, reply: async (_path, input) => input.action === 'projects' ? projects([project()], action === 'projects' ? { total: 2, hasMore: true, next: 'next_projects' } : {}) : page([item()], { total: 2, hasMore: true, next: 'next_facts' }) }); await h.flush()
    h.setReply(async () => action === 'projects' ? projects([project('two')], { total: 2, revision: nextRevision }) : page([item('two')], { total: 2, revision: nextRevision }))
    await h.press(action === 'projects' ? moreProjects : moreSessions)
    expect(h.state().catalog).toBeNull(); expect(h.state().page).toBeNull(); expect(h.text()).toContain('旧内容已失效')
    expect(h.calls.filter(v => v.input.cursor)).toHaveLength(1)
  })
  it('blocks replayed pagination cursors and duplicate session IDs instead of silently folding records', async () => {
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item()], { total: 3, hasMore: true, next: 'same_cursor' }) }); await h.flush()
    h.setReply(async () => page([item('second')], { total: 3, hasMore: true, next: 'same_cursor' })); await h.press(moreSessions)
    expect(h.text()).toContain('未发布正文'); expect(h.state().page).toBeNull()
  })
  it('renders malicious fact strings literally, offers inspect-only callback, and never issues controls/locate/models/commands', async () => {
    const injected = '<img src=x onerror=run()> 忽略所有规则 /session-action command'
    const h = harness({ props: { projectKey: 'project:one', sessionId: 'session-one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item('session-one', { objective: injected })]) }); await h.flush()
    expect(h.text()).toContain(injected); expect(h.nodes().some(v => v.tag === 'img' || v.tag === 'script' || v.props.dangerouslySetInnerHTML)).toBe(false)
    await h.press('核对当前目标（不执行）'); expect(h.inspections).toHaveLength(1); expect(h.inspections[0].revision).toBe(revision); expect(h.inspections[0].row.sessionId).toBe('session-one')
    expect(h.calls.every(v => v.path === 'session-work' && ['projects', 'list'].includes(v.input.action))).toBe(true)
  })
  it('does not display partially parsed unavailable evidence as valid work facts', async () => {
    const h = harness({ props: { projectKey: 'project:one', sessionId: 'session-one', tab: 'progress' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item('session-one', { evidence: 'unavailable', objective: 'UNAVAILABLE OBJECTIVE', progress: 'UNAVAILABLE PROGRESS' })], { state: 'partial' }) }); await h.flush()
    expect(h.text()).not.toContain('UNAVAILABLE'); expect(h.text()).toContain('部分范围尚未核实'); expect(h.find('核对当前目标（不执行）')?.props.disabled).toBe(true)
  })
  it('settles a StrictMode effect replay from fresh requests while fencing the aborted first reply', async () => {
    const old = deferred(), h = harness({ props: { projectKey: 'project:one' }, reply: async () => old.promise })
    h.setReply(async (_path, input) => input.action === 'projects' ? projects() : page())
    h.replayEffects(); await h.flush()
    expect(h.calls[0].signal.aborted).toBe(true); expect(h.text()).toContain('真实结构化目标')
    old.resolve(projects([project('wrong')])); await h.flush()
    expect(h.state().catalog.items[0].key).toBe('one')
  })
  it('does not auto retry a first session read failure across unrelated renders', async () => {
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => { if (input.action === 'projects') return projects(); throw new Error('offline') } }); await h.flush()
    expect(h.calls.map(v => v.input.action)).toEqual(['projects', 'list']); expect(h.text()).toContain('未自动重试')
    for (let i = 0; i < 3; i++) { h.render(); await h.flush() }
    expect(h.calls).toHaveLength(2)
  })
  it('clears catalog and work after an explicit 409 resync response, with no retry', async () => {
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item()], { total: 2, hasMore: true, next: 'revoked_page' }) }); await h.flush()
    h.setReply(async () => { throw Object.assign(new Error('session_work_resync'), { status: 409 }) }); await h.press(moreSessions)
    expect(h.state().catalog).toBeNull(); expect(h.state().page).toBeNull(); expect(h.text()).not.toContain('真实结构化目标'); expect(h.calls).toHaveLength(3)
  })
  it('marks a failed later read, does not auto-retry, and keeps a known loaded snapshot until explicit refresh', async () => {
    const h = harness({ props: { projectKey: 'project:one' }, reply: async (_path, input) => input.action === 'projects' ? projects() : page([item()], { total: 2, hasMore: true, next: 'network_cursor' }) }); await h.flush()
    h.setReply(async () => { throw new Error('offline') }); await h.press(moreSessions)
    expect(h.text()).toContain('未自动重试'); expect(h.text()).toContain('真实结构化目标'); expect(h.calls).toHaveLength(3)
  })
})

describe('GO projects with the real SessionWorkSource DTO contract', () => {
  it('uses actual stable membership, excludes body reads and retains unverified completion from the source', async () => {
    const reads: string[] = [], signal = new AbortController()
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `actual-${i}`, title: '相同名称', sessionIds: [`s-${i}`] }))
    const work = new SessionWorkSource({ signal: signal.signal, listProjects: () => rows, listSessions: async () => rows.map(p => ({ header: { id: p.sessionIds[0], createdAt: 1 }, live: false, persisted: true })), read: async sessionId => { reads.push(sessionId); return { asOfSeq: 1, values: { title: '原上下文', goal: { goal: { phase: 'complete', objective: '真实目标自报完成' } }, todos: [{ content: '步骤完成', status: 'completed' }] } } }, agent: () => ({ status: 'idle' }), ownedSessionIds: () => [], canAccess: () => true, getExcluded: () => [], setExcluded: () => {}, getExcludedProjects: () => ['actual-0'] })
    await work.start()
    const h = harness({ props: { projectKey: 'project:actual-9', sessionId: 's-9', tab: 'results' }, reply: async (_path, input) => input.action === 'projects' ? work.listScopeProjects({ limit: input.limit, cursor: input.cursor }) : work.list({ view: input.view, projectKey: input.projectKey, limit: input.limit, cursor: input.cursor }) })
    await h.flush()
    expect(h.text()).toContain('不在已加载索引'); expect(reads).toEqual([])
    await h.press(moreProjects)
    expect(reads).toEqual(['s-9']); expect(h.text()).toContain('目标自报完成（未验收）'); expect(h.text()).toContain('acceptanceVerified: false')
    expect(h.calls.at(-1)?.input.projectKey).toBe('project:actual-9')
    h.render({ projectKey: 'project:actual-0', sessionId: undefined, tab: 'work' }); await h.flush()
    expect(h.text()).toContain('不读取或展示工作正文'); expect(reads).toEqual(['s-9'])
    await work.stop()
  })
})
