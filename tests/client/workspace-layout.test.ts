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
const element = (className: string) => {
  const matches = all.filter(ts.isCallExpression).filter(node => {
    const value = prop(node, 'className')
    return ts.isIdentifier(node.expression) && node.expression.text === 'h' && value && ts.isStringLiteralLike(value) && value.text.split(/\s+/).includes(className)
  })
  expect(matches, className).toHaveLength(1)
  return matches[0]!
}
const calls = (root: ts.Node, name: string) => nodes(root).filter(ts.isCallExpression).filter(node => ts.isIdentifier(node.expression) && node.expression.text === name)
const contains = (parent: ts.Node, child: ts.Node) => child.getStart(tree) >= parent.getStart(tree) && child.end <= parent.end
const css = styles.slice(styles.indexOf('`') + 1, styles.lastIndexOf('`')).replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string, chunk = css) => [...chunk.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1]!.trim().split(',').includes(selector)).map(match => match[2]).join(';')
const container = (width: number) => {
  const start = css.indexOf(`@container(max-width:${width}px)`)
  expect(start, `container ${width}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 1, end = open + 1
  while (end < css.length && depth) { if (css[end] === '{') depth++; if (css[end] === '}') depth--; end++ }
  expect(depth).toBe(0)
  return css.slice(open + 1, end - 1)
}

describe('workspace redesign source layout contracts (not visual acceptance)', () => {
  it('keeps header compact while retaining planning and connection disclosures', () => {
    const header = element('saw-top')
    for (const name of ['saw-brand', 'saw-boundary', 'saw-top-actions']) expect(contains(header, element(name))).toBe(true)
    expect(element('saw-boundary').arguments[0]!.getText(tree)).toBe("'details'")
    expect(header.getText(tree)).toContain("workerExecution === false ? 'PlanningOnly' : 'ExecutionUnknown'")
    expect(contains(header, element('saw-search'))).toBe(false)
    expect(contains(header, element('saw-scope-details'))).toBe(false)
  })

  it('owns decisions and source previews in main work, without repeating them in chat', () => {
    const main = element('saw-work-scroll'), chat = initial('briefingView')
    for (const name of ['workDecisions', 'sessionWorkPreview']) {
      expect(calls(main, name)).toHaveLength(1)
      expect(calls(chat, name)).toHaveLength(0)
    }
    expect(initial('workDecisions').getText(tree)).toContain('desk.actions.map(decisionView)')
    expect(chat.getText(tree)).toContain('desk.records.map(recordView)')
    expect(chat.getText(tree)).not.toContain("openSystem('sources')")
    expect(contains(main, element('saw-ledger'))).toBe(true)
    expect(initial('sessionWorkPreview').getText(tree)).toContain('sessionProjectGroups(')
    expect(initial('sessionWorkSources').getText(tree).match(/sessionProjectGroups\(/g)).toHaveLength(2)
    expect(initial('sessionProjectGroups').getText(tree)).toContain("h('h4', null, group.name)")
    expect(initial('sessionWorkCard').getText(tree)).toContain("h('h5', null, structured")
    expect(initial('sessionWorkPreview').getText(tree)).toContain("tr('ProjectPreviewHint')")
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
      expect(contains(empty.parent.whenFalse, element('saw-columns'))).toBe(true)
    }
    const labels = nodes(empty).filter(ts.isConditionalExpression).filter(node => node.condition.getText(tree) === '!boardScopeKnown')
    expect(labels.map(node => node.whenTrue.getText(tree))).toEqual(["'WorkNoReturned'", "'WorkScopePending'"])
    for (const label of labels) {
      expect(ts.isConditionalExpression(label.whenFalse)).toBe(true)
      if (ts.isConditionalExpression(label.whenFalse)) expect(label.whenFalse.condition.getText(tree)).toBe('query || outcome')
    }
    expect(element('saw-columns').getText(tree)).toContain("page ? page.total : '—'")
  })

  it('assigns desktop work before a bounded chat rail with independent main scrolling', () => {
    expect(rule('.saw-workspace')).toMatch(/grid-template-columns:minmax\(0,1fr\)\s+(?:[12]\d\d|3[0-5]\d)px(?:;|$)/)
    expect(rule('.saw-workspace')).toMatch(/grid-template-areas:["']work chat["']/)
    expect(rule('.saw-board-region')).toContain('grid-area:work')
    expect(rule('.saw-chat')).toContain('grid-area:chat')
    expect(rule('.saw-work-scroll')).toContain('overflow:auto')
    expect(rule('.saw-work-scroll')).toContain('min-height:0')
    expect(rule('.saw-composer')).toContain('overflow:auto')
  })

  it('switches full work/chat panes at 1050px and wraps columns on smaller containers', () => {
    const tablet = container(1050)
    expect(rule('.saw-mobile-tabs', tablet)).toContain('display:flex')
    expect(rule('.saw-workspace[data-mobile-tab=board] .saw-chat', tablet)).toContain('display:none')
    expect(rule('.saw-workspace[data-mobile-tab=chat] .saw-board-region', tablet)).toContain('display:none')
    expect(rule('.saw-columns', container(720))).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(rule('.saw-columns', container(440))).toMatch(/grid-template-columns:(?:minmax\(0,1fr\)|1fr)/)
    expect(prop(element('saw-mobile-tabs'), 'aria-label')?.getText(tree)).toBe("tr('WorkspaceView')")
    expect(source).toContain("'data-mobile-tab': mobileTab")
  })

  it('keeps detail inside its positioning pane, not the new scrolling work content', () => {
    const detail = element('saw-detail')
    expect(contains(element('saw-board-region'), detail)).toBe(true)
    expect(contains(element('saw-work-scroll'), detail)).toBe(false)
    expect(prop(detail, 'aria-labelledby')?.getText(tree)).toBe("'saw-detail-title'")
    expect(prop(element('saw-composer'), 'inert')?.getText(tree)).toBe('planReview || replyOpen ? true : undefined')
    expect(prop(element('saw-messages'), 'inert')?.getText(tree)).toBe('planReview || replyOpen ? true : undefined')
    expect(initial('openTaskRecord').getText(tree)).toContain("setMobileTab('board')")
    expect(initial('supplement').getText(tree)).toContain("setMobileTab('chat')")
    expect(source).toContain('detailFocus.current?.isConnected')
    const focusEffect = all.filter(ts.isCallExpression).find(node => node.expression.getText(tree) === 'React.useEffect' && node.arguments[1]?.getText(tree) === '[mobileTab, collapsed]')
    expect(focusEffect).toBeDefined()
    for (const seam of ["mobileTab === 'chat'", '!collapsed', '!planReview', '!replyOpen', '!inputRef.current.disabled', 'inputRef.current.focus()']) expect(focusEffect!.getText(tree)).toContain(seam)
  })

  it('retains explicit scope, review navigation and native approval confirmation', () => {
    const disclosure = element('saw-scope-details')
    expect(contains(element('saw-ledger'), disclosure)).toBe(true)
    expect(disclosure.getText(tree)).toContain("!boardScopeKnown ? 'CountsScopeUnknown'")
    expect(initial('decisionView').getText(tree)).not.toMatch(/askConfirm\(|call\(/)
    expect(element('saw-confirm').arguments[0]!.getText(tree)).toBe("'dialog'")
    for (const seam of ['item.impact?.reviewable === true', '!!item.fingerprint', 'valueView(item.impact?.details)']) expect(initial('approvalView').getText(tree)).toContain(seam)
    expect(source).toContain('dialogRef.current.showModal()')
    expect(initial('perform').getText(tree)).toContain('reason: reason.trim()')
  })
})
