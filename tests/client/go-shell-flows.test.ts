import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'
import { createWorkspacePage } from '../../src/client/workspace.js'

// Actual factory/handler contracts only. No DOM, browser, layout or visual proof.
const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any>): any {
  let init = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) init = node.initializer.getText(tree); node.forEachChild(visit) }; visit(tree)
  if (!init) throw new Error(`Missing ${name}`)
  const g = createContext(globals); new Script(ts.transpileModule(`globalThis.actual=(${init})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(g); return g.actual
}
const array = (v: any) => Array.isArray(v) ? v : []
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props: props || {}, children })
const nodes = (v: any): any[] => Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' ? [v, ...array(v.children).flatMap(nodes)] : []
const routeGlobals: any = { URLSearchParams, routeSystem: ['settings', 'scope', 'stage-models', 'settings-runtime', 'health', 'locate', 'images', 'decisions'] }
routeGlobals.routeId = closure('routeId', routeGlobals)
routeGlobals.parseViewRoute = closure('parseViewRoute', routeGlobals)
routeGlobals.viewRouteHash = closure('viewRouteHash', routeGlobals)
const scope = 'a'.repeat(64), fact = 'b'.repeat(64)
const row = { sessionId: 'session-one', excluded: false, evidence: 'structured', factRevision: fact, project: { kind: 'project', key: 'one', name: 'Same name' } }

describe('Go original-design shell navigation and single-item interaction contracts', () => {
  it('round-trips namespaced routes and opaque stable identities without turning them into commands', () => {
    for (const route of [{ view: 'overview' }, { view: 'decisions-home' }, { view: 'board' }, { view: 'ticket', id: 'ticket:one/a', tab: 'results' }, { view: 'projects', projectKey: 'project:one/a:@', sessionId: 'session:one/a', tab: 'relations' }, { view: 'projects', projectKey: 'unassigned', tab: 'sessions' }, { view: 'images' }]) expect(routeGlobals.parseViewRoute(routeGlobals.viewRouteHash(route))).toEqual(route)
    for (const hash of ['', '#host/panel', '#go/unknown', '#go/ticket?id=https%3A%2F%2Fevil', '#go/projects?project=bad&session=one', '#go/projects?session=one', '#go/projects?project=project%3Aone&session=https%3A%2F%2Fevil', '#go/projects?project=project%3Aone&project=project%3Atwo', '#go/chat?actor=one', '#go/' + 'x'.repeat(1800)]) expect(routeGlobals.parseViewRoute(hash)).toEqual({ view: 'overview' })
    expect(routeGlobals.parseViewRoute('#go/projects?project=project%3Aone&tab=results')).toEqual({ view: 'projects', projectKey: 'project:one' })
  })
  it('publishes only one view route and keeps browser hash synchronization idempotent', () => {
    const routes: any[] = [], menus: any[] = [], location = { hash: '#go/overview' }
    const g: any = { ...routeGlobals, navigationGeneration: { current: 0 }, viewRouteRef: { current: { view: 'overview' } }, routeWriting: { current: false }, setViewRoute: (v: any) => routes.push(v), setMenuOpen: (v: any) => menus.push(v), window: { location } }
    const sync = closure('syncViewRoute', g)
    sync({ view: 'chat' }); expect(location.hash).toBe('#go/chat'); expect(g.viewRouteRef.current.view).toBe('chat'); expect(menus).toEqual([false])
    expect(g.navigationGeneration.current).toBe(1); sync({ view: 'chat' }); expect(g.navigationGeneration.current).toBe(1)
    g.routeWriting.current = true; sync({ view: 'projects' }); expect(location.hash).toBe('#go/chat'); expect(routes).toHaveLength(3); expect(g.navigationGeneration.current).toBe(2)
  })
  it('runs the actual initial Workspace factory without captured imports and starts in overview, not Kanban', () => {
    const slots: any[] = []; let cursor = 0
    const React = { Fragment: 'fragment', createElement: h, useRef(v: any) { const i = cursor++; return slots[i] ||= { current: v } }, useState(v: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] }, useEffect() {}, useLayoutEffect() {} }
    const calls: any[] = [], factory = () => ({ StageModels: () => null, Decisions: () => null, Projects: () => null })
    const Page = createWorkspacePage(React, async (...args) => { calls.push(args) }, (v: string) => v, '', () => ({ ready: false, idle: false, actionTotal: null, actions: [], recordTotal: null, records: [], moreActions: false, moreRecords: false }), factory, factory, factory)
    const render = () => { cursor = 0; return Page() }, initial = render(), all = nodes(initial)
    expect(initial.props.className).toBe('saw-frame'); expect(all.find(v => v.props.className === 'saw-overview-host').props.hidden).toBe(false)
    expect(all.find(v => v.props.className === 'saw-workspace').props.hidden).toBe(true)
    const sidebar = all.find(v => v.props.className === 'saw-sidebar'), chat = nodes(sidebar).find(v => v.tag === 'button' && v.props.key === 'chat')
    chat.props.onClick(); const after = nodes(render()); expect(after.find(v => v.props.className === 'saw-overview-host').props.hidden).toBe(true); expect(after.find(v => v.props.className === 'saw-workspace').props.hidden).toBe(false); expect(calls).toEqual([])
  })
  it('renders only the explicitly selected inbox body, never every approval or answer form', () => {
    const rendered: string[] = [], selected: string[] = [], g: any = { h, React: { Fragment: 'fragment' }, array, tr: (v: string) => v, displayTitle: (v: string) => v, systemData: { 'decisions-home': { items: [{ id: 'approval-one', summary: 'First' }, { id: 'approval-two', summary: 'Second' }] } }, sessionWorkPages: { included: { items: [] } }, pendingPlans: [{ planId: 'plan-one', brief: { goal: 'Plan' } }], inboxSelection: '', sessionWorkError: '', sessionWorkBusy: '', systemBusy: { current: false }, inboxBusy: { current: false }, button: (label: string, click: any) => h('button', { onClick: click }, label), setInboxSelection: (id: string) => selected.push(id), approvalView: (v: any) => { rendered.push(v.id); return h('article', null, v.id) }, admissionView: (v: any) => { rendered.push(v.planId); return h('article', null, v.planId) } }
    const view = closure('inboxView', g)
    const first = view(); expect(rendered).toEqual([]); expect(first.props['data-selected']).toBe(false)
    nodes(first).find(v => v.props.key === 'approval:approval-two').props.onClick(); expect(selected).toEqual(['approval:approval-two'])
    g.inboxSelection = selected[0]; expect(view().props['data-selected']).toBe(true); expect(rendered).toEqual(['approval-two'])
  })
  it('revalidates exact project, scope and fact before opening target questions without retargeting drafts', async () => {
    const calls: any[] = [], bindings: any[] = [], opened: string[] = [], route = { view: 'projects', projectKey: 'project:one' }
    const g: any = { ...routeGlobals, navigationGeneration: { current: 0 }, sessionWorkGeneration: { current: 0 }, inboxBusy: { current: false }, epochRef: { current: 'epoch' }, alive: { current: true }, viewRouteRef: { current: route }, decisionLocationEpoch: { current: '' }, scopeProjectKey: (p: any) => `project:${p.key}`, setSystemError() {}, setNotice() {}, structuredClone, setDecisionLocation: (v: any) => bindings.push(v), openSystem: (v: string) => opened.push(v), tr: (v: string) => v, call: async (path: string, input: any) => { calls.push({ path, input }); return { status: 'located', revision: scope, target: row, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' } } }
    const inspect = closure('inspectSessionQuestions', g)
    await inspect(row, scope); expect(opened).toEqual(['decisions']); expect(bindings[0].target.sessionId).toBe(row.sessionId); expect(calls[0]).toEqual({ path: 'session-locate', input: { epoch: 'epoch', text: row.sessionId, sessionId: row.sessionId, revision: scope } })
    await inspect({ ...row, excluded: true }, scope); await inspect({ ...row, factRevision: undefined }, scope); expect(calls).toHaveLength(1)
    g.call = async () => ({ status: 'located', revision: scope, target: { ...row, factRevision: 'c'.repeat(64) }, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' }); await inspect(row, scope); expect(opened).toHaveLength(1)
    let resolve!: (value: any) => void; g.call = () => new Promise(r => { resolve = r }); const pending = inspect(row, scope); g.viewRouteRef.current = { view: 'projects', projectKey: 'project:two' }; resolve({ status: 'located', revision: scope, target: row, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' }); await pending; expect(opened).toHaveLength(1)
    g.viewRouteRef.current = route; const oldScope = inspect(row, scope); g.sessionWorkGeneration.current++; resolve({ status: 'located', revision: scope, target: row, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' }); await oldScope; expect(opened).toHaveLength(1)
    const oldNavigation = inspect(row, scope); g.navigationGeneration.current += 2; resolve({ status: 'located', revision: scope, target: row, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' }); await oldNavigation; expect(opened).toHaveLength(1)
    expect(source).toContain("setDecisionLocation(null)\n            resetScope(); resetLocate()")
  })
  it('keeps occupied drafts, recreate origins and image attachments out of explicit ticket retargeting', () => {
    for (const state of [{ draft: 'unsent words' }, { pending: { requestId: 'pending' } }, { target: { id: 'original' } }, { origin: { id: 'source' } }, { images: [{ id: 'image' }] }, { hashing: true }]) {
      const updates: any[] = [], notices: string[] = [], initial = { draft: '', pending: null, target: null, origin: null, ...state }
      const g: any = { array, composerRef: { current: initial }, epochRef: { current: 'epoch' }, draftEpochRef: { current: 'epoch' }, imageBusyRef: { current: (state as any).hashing || null }, imageDraftsRef: { current: { epoch: { items: (state as any).images || [] } } }, tr: (v: string) => v, setNotice: (v: string) => notices.push(v), updateComposer: (v: any) => updates.push(v) }
      closure('supplement', g)({ id: 'another-ticket' }); expect(updates).toEqual([]); expect(notices).toEqual(['ResolveDraftFirst']); expect(g.composerRef.current).toBe(initial)
    }
  })
  it('refuses to send a new text command while an image is attached or still hashing', async () => {
    for (const hashing of [false, true]) {
      const notices: string[] = [], g: any = { array, tr: (v: string) => v, sendBusy: { current: false }, epochRef: { current: 'epoch' }, composerRef: { current: { pending: null } }, imageDraftsRef: { current: { epoch: { items: hashing ? [] : [{ id: 'image' }] } } }, imageBusyRef: { current: hashing ? {} : null }, setNotice: (v: string) => notices.push(v) }
      await closure('submit', g)(); expect(notices).toEqual(['GoImageSendBlocked']); expect(g.composerRef.current.pending).toBeNull()
    }
  })
})
