import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// AST/CSS contracts only: no React/DOM surrogate, layout measurement or visual proof.
const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const styles = readFileSync('src/client/workspace-style.ts', 'utf8')
const nodes = (root: ts.Node): ts.Node[] => {
  const result: ts.Node[] = []
  const visit = (node: ts.Node) => { result.push(node); node.forEachChild(visit) }
  visit(root); return result
}
const all = nodes(tree)
const initial = (name: string) => {
  const matches = all.filter(ts.isVariableDeclaration).filter(node => ts.isIdentifier(node.name) && node.name.text === name)
  expect(matches, name).toHaveLength(1)
  return matches[0]!.initializer!
}
const prop = (node: ts.CallExpression, name: string) => {
  const props = node.arguments[1]
  if (!props || !ts.isObjectLiteralExpression(props)) return undefined
  return props.properties.filter(ts.isPropertyAssignment).find(entry => (ts.isIdentifier(entry.name) || ts.isStringLiteralLike(entry.name)) && entry.name.text === name)?.initializer
}
const element = (className: string, root: ts.Node = tree) => {
  const matches = nodes(root).filter(ts.isCallExpression).filter(node => {
    const value = prop(node, 'className')
    return ts.isIdentifier(node.expression) && node.expression.text === 'h' && value && ts.isStringLiteralLike(value) && value.text.split(/\s+/).includes(className)
  })
  expect(matches, className).toHaveLength(1)
  return matches[0]!
}
const calls = (root: ts.Node, name: string) => nodes(root).filter(ts.isCallExpression).filter(node => ts.isIdentifier(node.expression) && node.expression.text === name)
const contains = (parent: ts.Node, child: ts.Node) => child.getStart(tree) >= parent.getStart(tree) && child.end <= parent.end
const css = styles.slice(styles.indexOf('`') + 1, styles.lastIndexOf('`')).replace(/\/\*[\s\S]*?\*\//g, '')
const baseCss = css.slice(0, css.indexOf('@container'))
const rule = (selector: string, chunk = css) => [...chunk.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1]!.trim().split(',').includes(selector)).map(match => match[2]).join(';')
const container = (width: number, name = '') => {
  const start = css.indexOf(name ? `@container ${name} (max-width:${width}px)` : `@container(max-width:${width}px)`)
  expect(start, `container ${name} ${width}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 1, end = open + 1
  while (end < css.length && depth) { if (css[end] === '{') depth++; if (css[end] === '}') depth--; end++ }
  expect(depth).toBe(0)
  return css.slice(open + 1, end - 1)
}

describe('workspace redesign source layout contracts (not visual acceptance)', () => {
  it('uses a fixed sidebar and main topbar with breadcrumbs, global chat and visible safety disclosures', () => {
    const frame = element('saw-frame'), shell = element('saw'), sidebar = element('saw-sidebar')
    const main = element('saw-main'), header = element('saw-top'), body = element('saw-main-body')
    expect(contains(frame, shell)).toBe(true)
    for (const child of [sidebar, main]) expect(contains(shell, child)).toBe(true)
    expect(contains(sidebar, element('saw-brand'))).toBe(true)
    expect(contains(sidebar, element('saw-project-index'))).toBe(true)
    expect(contains(sidebar, element('saw-sidebar-bottom'))).toBe(true)
    expect(calls(sidebar, 'primaryNavigation')).toHaveLength(1)
    for (const child of [header, body]) expect(contains(main, child)).toBe(true)
    for (const name of ['saw-breadcrumbs', 'saw-top-actions']) expect(contains(header, element(name))).toBe(true)
    expect(header.getText(tree)).toContain("className: 'saw-btn saw-menu-toggle'")
    expect(header.getText(tree)).toContain("'aria-controls': 'saw-navigation'")
    expect(header.getText(tree)).toContain("navigatePrimary('chat')")
    expect(header.getText(tree)).toContain("error ? tr('Disconnected') : workspace ? tr('Connected') : tr('Connecting')")
    const boundary = element('saw-boundary')
    expect(boundary.arguments[0]!.getText(tree)).toBe("'details'")
    expect(contains(body, boundary)).toBe(true)
    expect(boundary.getText(tree)).toContain("workerExecution === false ? 'PlanningOnly' : 'ExecutionUnknown'")
    for (const name of ['saw-brand', 'saw-boundary', 'saw-search', 'saw-scope-details']) expect(contains(header, element(name))).toBe(false)
  })

  it('limits overview to one next decision and compact project summaries, with registry and chat separate', () => {
    const overview = initial('overviewView'), next = element('saw-next-action'), grid = element('saw-overview-grid')
    expect(overview.getText(tree)).toContain('const next = desk.actions[0]')
    expect(calls(overview, 'decisionView')).toHaveLength(1)
    expect(calls(next, 'decisionView')[0]!.arguments[0]!.getText(tree)).toBe('next')
    expect(contains(grid, next)).toBe(true)
    expect(contains(grid, element('saw-brief-card'))).toBe(true)
    expect(contains(overview, element('saw-project-preview-grid'))).toBe(true)
    expect(contains(grid, element('saw-project-preview-grid'))).toBe(false)
    for (const name of ['workDecisions', 'sessionWorkPreview']) expect(calls(overview, name)).toHaveLength(0)
    for (const name of ['saw-ledger', 'saw-registry-list', 'saw-workspace', 'saw-chat']) expect(contains(overview, element(name))).toBe(false)
    expect(overview.getText(tree)).toContain("sessionCoverage !== 'ready'")
    expect(overview.getText(tree)).toContain("group.kind === 'unknown'")
    expect(overview.getText(tree)).toContain('showAllTasks')
    expect(initial('showAllTasks').getText(tree)).toContain("navigatePrimary('board')")
    const chat = initial('briefingView')
    for (const name of ['workDecisions', 'sessionWorkPreview']) expect(calls(chat, name)).toHaveLength(0)
    expect(chat.getText(tree)).toContain('desk.records.map(recordView)')
    expect(chat.getText(tree)).not.toContain("openSystem('sources')")
    expect(contains(element('saw-work-scroll'), element('saw-ledger'))).toBe(true)
    expect(initial('sessionWorkSources').getText(tree).match(/sessionProjectGroups\(/g)).toHaveLength(2)
    expect(initial('sessionProjectGroups').getText(tree)).toContain("h('h4', null, group.name)")
    expect(initial('sessionWorkCard').getText(tree)).toContain("h('h5', null, structured")
  })

  it('collapses only a completely known empty board and preserves unknown-scope wording', () => {
    const expression = initial('boardEmpty').getText(tree)
    for (const seam of ['!!board', '!error', '!boardError', 'columns.every', 'page.total === 0', 'Array.isArray(page.items)', 'page.items.length === 0', 'page.hasMore === false']) expect(expression).toContain(seam)
    // Execute the actual pure predicate, not a rewritten copy or a UI renderer.
    const js = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
    const emptyBoard = new Function('board', 'error', 'boardError', 'columns', `return ${js}`) as (board: any, error: string, boardError: string, columns: string[]) => boolean
    const columns = ['pending', 'running', 'waiting', 'ended']
    const complete = () => ({ columns: Object.fromEntries(columns.map(column => [column, { total: 0, items: [], hasMore: false }])) })
    const cases: Array<[string, any, string, string, boolean]> = [
      ['unknown coverage, complete returned zero snapshot', complete(), '', '', true],
      ['known ledger coverage', { ...complete(), scope: { kind: 'superagent-ledger', otherSessions: 'not-included' } }, '', '', true],
      ['no board', null, '', '', false], ['unread board', {}, '', '', false],
      ['partial columns', { columns: { pending: { total: 0, items: [], hasMore: false } } }, '', '', false],
      ['workspace error, stale zero snapshot', complete(), 'disconnected', '', false],
      ['board error, stale zero snapshot', complete(), '', 'resync', false],
    ]
    for (const [name, patch] of [['positive server total', { total: 1 }], ['loaded item', { items: [{ id: 'task' }] }], ['more pages', { hasMore: true }], ['unknown pagination', { hasMore: undefined }], ['malformed items', { items: null }]] as const) {
      const board = complete(); Object.assign(board.columns.pending!, patch); cases.push([name, board, '', '', false])
    }
    for (const [name, board, error, boardError, expected] of cases) expect(emptyBoard(board, error, boardError, columns), name).toBe(expected)
    const empty = element('saw-board-empty')
    expect(ts.isConditionalExpression(empty.parent)).toBe(true)
    if (ts.isConditionalExpression(empty.parent)) {
      expect(empty.parent.condition.getText(tree)).toBe('boardEmpty')
      expect(empty.parent.whenTrue).toBe(empty)
      expect(contains(empty.parent.whenFalse, element('saw-registry-list'))).toBe(true)
    }
    const labels = nodes(empty).filter(ts.isConditionalExpression).filter(node => node.condition.getText(tree) === '!boardScopeKnown')
    expect(labels.map(node => node.whenTrue.getText(tree))).toEqual(["'WorkNoReturned'", "'WorkScopePending'"])
    for (const label of labels) {
      expect(ts.isConditionalExpression(label.whenFalse)).toBe(true)
      if (ts.isConditionalExpression(label.whenFalse)) expect(label.whenFalse.condition.getText(tree)).toBe('query || outcome')
    }
    expect(element('saw-registry-list').getText(tree)).toContain("page ? page.total : '—'")
  })

  it('bounds current view scrolling while keeping chat and system mounted but hidden when inactive', () => {
    expect(rule('.saw-frame', baseCss)).toContain('container-type:inline-size')
    for (const seam of ['display:grid', 'grid-template-columns:214px minmax(0,1fr)', 'grid-template-rows:minmax(0,1fr)', 'overflow:hidden']) expect(rule('.saw', baseCss)).toContain(seam)
    for (const selector of ['.saw-main', '.saw-main-body']) {
      expect(rule(selector, baseCss)).toContain('display:flex')
      expect(rule(selector, baseCss)).toContain('min-height:0')
    }
    expect(rule('.saw-main-body', baseCss)).toContain('flex:1')
    expect(rule('.saw-workspace')).toContain('display:flex')
    expect(rule('.saw-workspace')).not.toContain('grid-template-columns')
    for (const seam of ['width:100%', 'flex:1', 'max-width:930px']) expect(rule('.saw-chat')).toContain(seam)
    for (const selector of ['.saw-view-scroll', '.saw-work-scroll', '.saw-messages', '.saw-system-scroll', '.saw-detail-scroll']) {
      expect(rule(selector), selector).toContain('overflow:auto')
      expect(rule(selector), selector).toContain('min-height:0')
    }
    expect(rule('.saw-composer')).toContain('overflow:auto')
    expect(rule('.saw-system')).toContain('position:relative')
    expect(rule('.saw-system')).not.toContain('position:absolute')
    expect(rule('.saw [hidden]')).toContain('display:none!important')
    expect(prop(element('saw-overview-host'), 'hidden')?.getText(tree)).toBe("!!system || mobileTab !== 'overview'")
    expect(prop(element('saw-projects-host'), 'hidden')?.getText(tree)).toBe("!!system || mobileTab !== 'projects'")
    expect(prop(element('saw-workspace'), 'hidden')?.getText(tree)).toBe("!!system && !chatSubmode || !['board', 'chat'].includes(mobileTab)")
    expect(prop(element('saw-primary-panel'), 'hidden')?.getText(tree)).toBe('!system || chatSubmode')
    expect(prop(element('saw-primary-panel'), 'role')?.getText(tree)).toBe("'region'")
    // The persistent chat/system nodes are not gated by a primary-view conditional.
    expect(ts.isConditionalExpression(element('saw-workspace').parent)).toBe(false)
    expect(ts.isConditionalExpression(element('saw-chat').parent)).toBe(false)
    expect(contains(element('saw-main-body'), element('saw-primary-panel'))).toBe(true)
  })

  it('keeps one vertical navigation and selected content through tablet, rail and phone drawer widths', () => {
    expect(rule('.saw-primary-nav', baseCss)).toContain('display:flex')
    expect(rule('.saw-primary-nav', baseCss)).toContain('flex-direction:column')
    const navigation = initial('primaryNavigation')
    const entries = nodes(navigation).filter(ts.isArrayLiteralExpression).find(node => node.elements.length === 5 && node.elements.every(ts.isArrayLiteralExpression))
    expect(entries).toBeDefined()
    expect(entries!.elements.map(node => (node as ts.ArrayLiteralExpression).elements[0]!.getText(tree))).toEqual(["'overview'", "'projects'", "'decisions-home'", "'chat'", "'settings'"])
    expect(navigation.getText(tree)).toContain("'aria-label': tr(label!)")
    expect(prop(element('saw-mobile-tabs'), 'aria-label')?.getText(tree)).toBe("tr('WorkspaceView')")
    expect(rule('.saw-workspace[data-mobile-tab=board] .saw-chat')).toContain('display:none')
    expect(rule('.saw-workspace[data-mobile-tab=chat] .saw-board-region')).toContain('display:none')
    for (const [width, columns] of [[1050, '180px minmax(0,1fr)'], [820, '70px minmax(0,1fr)'], [620, 'minmax(0,1fr)']] as const) expect(rule('.saw', container(width, 'saw-frame'))).toContain(`grid-template-columns:${columns}`)
    expect(rule('.saw-workspace', container(1050))).not.toContain('grid-template-columns')
    expect(rule('.saw-columns', container(820))).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(rule('.saw-columns', container(440))).toMatch(/grid-template-columns:(?:minmax\(0,1fr\)|1fr)/)
    const mobile = container(620)
    expect(rule('.saw-sidebar', mobile)).toContain('display:none')
    expect(rule('.saw[data-menu-open=true] .saw-sidebar', mobile)).toContain('display:flex')
    expect(rule('.saw[data-menu-open=true] .saw-menu-backdrop', mobile)).toContain('display:block')
    expect(prop(element('saw'), 'data-menu-open')?.getText(tree)).toBe('menuOpen')
    expect(source).toContain("'data-mobile-tab': mobileTab")
  })

  it('switches phone inbox to the selected detail only and preserves the unselected list', () => {
    const inbox = element('saw-inbox-layout'), detail = element('saw-decision-detail')
    expect(prop(inbox, 'data-selected')?.getText(tree)).toBe('!!selected')
    expect(contains(inbox, element('saw-inbox-list'))).toBe(true)
    expect(contains(inbox, detail)).toBe(true)
    expect(initial('inboxView').getText(tree)).toContain('choices.find(row => row.id === inboxSelection)')
    expect(detail.getText(tree)).toContain("setInboxSelection('')")
    const mobile = container(620)
    expect(rule('.saw-inbox-layout', mobile)).toContain('grid-template-columns:minmax(0,1fr)')
    expect(rule('.saw-inbox-layout[data-selected=true]>.saw-inbox-list', mobile)).toContain('display:none')
    expect(rule('.saw-inbox-list', mobile)).not.toContain('display:none')
  })

  it('uses an ordinary main-region work detail while preserving transient review isolation and focus return', () => {
    const detail = element('saw-work-detail')
    expect(contains(element('saw-board-region'), detail)).toBe(true)
    expect(contains(element('saw-work-scroll'), detail)).toBe(false)
    expect(detail.arguments[0]!.getText(tree)).toBe("'section'")
    expect(prop(detail, 'role')?.getText(tree)).toBe("'region'")
    expect(prop(detail, 'aria-modal')).toBeUndefined()
    expect(rule('.saw-work-detail', baseCss)).toContain('position:relative')
    expect(rule('.saw-work-detail', baseCss)).not.toContain('position:absolute')
    expect(prop(detail, 'aria-labelledby')?.getText(tree)).toBe("'saw-detail-title'")
    expect(prop(element('saw-work-scroll'), 'hidden')?.getText(tree)).toBe('!!detailId')
    expect(prop(element('saw-board-head'), 'hidden')?.getText(tree)).toBe('!!detailId')
    expect(contains(detail, element('saw-detail-scroll'))).toBe(true)
    expect(contains(detail, element('saw-detail-tabs', detail))).toBe(true)
    expect(detail.getText(tree)).toContain("e.key === 'Escape' && !confirmation")
    expect(prop(element('saw-composer'), 'inert')?.getText(tree)).toBe('planReview || replyOpen ? true : undefined')
    expect(prop(element('saw-messages'), 'inert')?.getText(tree)).toBe('planReview || replyOpen ? true : undefined')
    expect(initial('openTaskRecord').getText(tree)).toContain("setMobileTab('board')")
    expect(initial('supplement').getText(tree)).toContain("navigatePrimary('chat')")
    expect(initial('navigatePrimary').getText(tree)).toContain("closeSystem(); if (tab === 'board') { detailIdRef.current = ''; setDetailId('') }; setMobileTab(tab); setCollapsed(false)")
    expect(source).toContain('detailFocus.current?.isConnected')
    const focusEffect = all.filter(ts.isCallExpression).find(node => node.expression.getText(tree) === 'React.useEffect' && node.arguments[1]?.getText(tree) === '[mobileTab, collapsed, system]')
    expect(focusEffect).toBeDefined()
    for (const seam of ["mobileTab === 'chat'", '!system', '!collapsed', '!planReview', '!replyOpen', '!inputRef.current.disabled', 'inputRef.current.focus()']) expect(focusEffect!.getText(tree)).toContain(seam)
  })

  it('does not submit during Chinese composition or Shift+Enter and submits only plain Enter', () => {
    const input = all.filter(ts.isCallExpression).filter(node => node.arguments[0]?.getText(tree) === "'textarea'" && prop(node, 'id')?.getText(tree) === "'saw-draft'")
    expect(input).toHaveLength(1)
    const callback = prop(input[0]!, 'onKeyDown')!
    const js = ts.transpileModule(`const handler = ${callback.getText(tree)}; handler`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
    const invoke = new Function('submit', `${js.replace(/handler;\s*$/, 'return handler;')}`) as (submit: () => void) => (event: any) => void
    let sent = 0, prevented = 0
    const handle = invoke(() => { sent++ })
    for (const event of [{ key: 'a' }, { key: 'Enter', shiftKey: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', nativeEvent: { isComposing: true } }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', nativeEvent: { keyCode: 229 } }]) handle({ ...event, preventDefault: () => { prevented++ } })
    expect(sent).toBe(0)
    expect(prevented).toBe(0)
    handle({ key: 'Enter', preventDefault: () => { prevented++ } })
    expect(sent).toBe(1)
    expect(prevented).toBe(1)
    expect(prop(input[0]!, 'aria-describedby')?.getText(tree)).toBe("'saw-input-help'")
  })

  it('retains explicit scope, review navigation and native approval confirmation', () => {
    const disclosure = element('saw-scope-details')
    expect(contains(element('saw-ledger'), disclosure)).toBe(true)
    expect(disclosure.getText(tree)).toContain("!boardScopeKnown ? 'CountsScopeUnknown'")
    expect(initial('decisionView').getText(tree)).not.toMatch(/askConfirm\(|call\(/)
    const approvalDialog = all.filter(ts.isCallExpression).filter(node => prop(node, 'ref')?.getText(tree) === 'dialogRef')
    expect(approvalDialog).toHaveLength(1)
    expect(approvalDialog[0]!.arguments[0]!.getText(tree)).toBe("'dialog'")
    expect(prop(approvalDialog[0]!, 'className')?.getText(tree)).toBe("'saw-confirm'")
    for (const seam of ['item.impact?.reviewable === true', '!!item.fingerprint', 'valueView(item.impact?.details)']) expect(initial('approvalView').getText(tree)).toContain(seam)
    expect(source).toContain('dialogRef.current.showModal()')
    expect(initial('perform').getText(tree)).toContain('reason: reason.trim()')
  })
})
