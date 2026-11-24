import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

// Execute actual navigation closures; no DOM, layout measurement or visual claim.
const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any>): any {
  let initializer = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) initializer = node.initializer.getText(tree); node.forEachChild(visit) }
  visit(tree)
  if (!initializer) throw new Error(`Missing ${name}`)
  const context = createContext(globals)
  new Script(ts.transpileModule(`globalThis.actual=(${initializer})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  return context.actual
}
function historyLayout(globals: Record<string, any>): () => void {
  let callback = ''
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'React.useLayoutEffect' && node.arguments[0]?.getText(tree).includes('historyAnchor.current')) callback = node.arguments[0].getText(tree); node.forEachChild(visit) }
  visit(tree)
  if (!callback) throw new Error('Missing actual history layout effect')
  const context = createContext(globals)
  new Script(ts.transpileModule(`globalThis.actual=(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  return context.actual as () => void
}
const array = (v: any) => Array.isArray(v) ? v : []
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children })
const nodes = (v: any): any[] => v && typeof v === 'object' ? [v, ...array(v.children).flatMap(nodes)] : []

describe('peer primary-view navigation without hidden sends or draft retargeting', () => {
  it('does not consume history anchors or move a hidden dialogue, then restores on explicit re-entry', () => {
    const node = { scrollTop: 320, scrollHeight: 0 }, g: any = { mobileTab: 'board', system: '', messagesRef: { current: node }, activityView: 'history', lastActivityView: { current: 'history' }, briefingScroll: { current: 0 }, historyAnchor: { current: { epoch: 'current', top: 320, height: 1200 } }, historyEpoch: 'current', activityViewRef: { current: 'history' }, autoScroll: { current: true } }
    const layout = historyLayout(g)
    layout(); expect(node.scrollTop).toBe(320); expect(g.historyAnchor.current).not.toBeNull()
    g.mobileTab = 'chat'; g.system = 'settings'; layout(); expect(node.scrollTop).toBe(320); expect(g.historyAnchor.current).not.toBeNull()
    g.system = ''; node.scrollHeight = 1500; layout(); expect(node.scrollTop).toBe(620); expect(g.historyAnchor.current).toBeNull()
    g.autoScroll.current = false; node.scrollTop = 110; node.scrollHeight = 1800; layout(); expect(node.scrollTop).toBe(110)
    g.autoScroll.current = true; layout(); expect(node.scrollTop).toBe(1800)
  })
  it('changes only navigation and preserves independent draft, pending request, image target and local material', () => {
    const calls: any[] = []
    const retained = { composer: { draft: 'Keep exact text', target: { id: 'original' }, pending: { requestId: 'original-request' } }, imageDraft: { target: { sessionId: 'original-image-target' }, items: [{ digest: 'a'.repeat(64) }] }, materialDraft: { text: 'Untrusted material', authorization: 'not-granted' } }
    const before = JSON.stringify(retained), systemFocus = { current: { id: 'old-settings-opener' } as any }
    const navigate = closure('navigatePrimary', { ...retained, detailIdRef: { current: '' }, setDetailId: () => {}, systemFocus, syncViewRoute: (route: any) => calls.push(['route', route]), closeSystem: () => { expect(systemFocus.current).toBeNull(); calls.push('close') }, setMobileTab: (value: any) => calls.push(['view', value]), setCollapsed: (value: any) => calls.push(['collapsed', value]), openSystem: (value: any) => calls.push(['system', value]) })
    for (const tab of ['chat', 'board', 'decisions-home', 'settings']) navigate(tab)
    expect(calls).toEqual(['close', ['view', 'chat'], ['collapsed', false], ['route', { view: 'chat' }], 'close', ['view', 'board'], ['collapsed', false], ['route', { view: 'board' }], ['system', 'decisions-home'], ['system', 'settings']])
    navigate('forged-session-id'); expect(calls).toHaveLength(10)
    expect(JSON.stringify(retained)).toBe(before)
  })
  it('keeps global dialogue discoverable and its unread mark without acknowledging or sending on navigation', () => {
    const choices: string[] = []
    const view = closure('primaryNavigation', { h, tr: (key: string) => key, newReplies: 2, primaryTab: 'chat', button: (label: string, click: any, disabled: boolean, props: any) => h('button', { ...props, disabled, onClick: click }, label), navigatePrimary: (tab: string) => choices.push(tab) })()
    const buttons = nodes(view).filter(row => row.tag === 'button')
    expect(view.props['aria-label']).toBe('WorkspaceView'); expect(buttons).toHaveLength(5)
    const dialogue = buttons.find(row => row.props.key === 'chat')!
    expect(dialogue.children[1].children[0]).toBe('DeskTitle •'); expect(dialogue.children[0].props['aria-hidden']).toBe(true); expect(dialogue.props['aria-current']).toBe('page')
    dialogue.props.onClick(); buttons.find(row => row.props.key === 'settings')!.props.onClick()
    expect(choices).toEqual(['chat', 'settings'])
  })
  it('opens only an explicitly selected setting category and keeps all substantive forms out of the home', () => {
    const opened: string[] = [], g: any = { h, tr: (key: string) => key, button: (label: string, click: any) => h('button', { onClick: click }, label), openSystem: (tab: string) => opened.push(tab) }
    const scope = closure('scopeSettingsEntry', g)()
    expect(nodes(scope).filter(row => row.tag === 'button')).toHaveLength(1)
    nodes(scope).find(row => row.tag === 'button').props.onClick()
    expect(opened).toEqual(['scope'])
    expect(nodes(scope).some(row => ['input', 'textarea', 'select', 'form'].includes(row.tag))).toBe(false)
  })
})
