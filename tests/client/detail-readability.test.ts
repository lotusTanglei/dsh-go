import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

// Exercise the actual pure const initializers, not a React/DOM rendering surrogate.
const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: 'displayTitle' | 'reportSummary') {
  const initializers: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer
      && ts.isVariableDeclarationList(node.parent) && node.parent.flags & ts.NodeFlags.Const) initializers.push(node.initializer.getText(tree))
    node.forEachChild(visit)
  }
  visit(tree)
  if (initializers.length !== 1) throw new Error(`Expected one actual pure const initializer: ${name}`)
  const context = createContext({ array: (value: any) => Array.isArray(value) ? value : [], tr: (key: string) => key })
  const js = ts.transpileModule(`globalThis.actual = (${initializers[0]})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText
  new Script(js).runInContext(context)
  return { actual: context.actual as (value: any) => any, context }
}
const { actual: displayTitle } = closure('displayTitle')
const { actual: reportSummary } = closure('reportSummary')

// Exact harmless goal from the screenshot fixture (probes/final-runtime.cjs), data only.
const fixtureGoal = 'Harmless acceptance fixture 2. No file reads, writes, shell, channels, approvals or human questions. Complete by calling structured_output with state ready, done [fixture completed], todo [], changedPaths [], acceptance [{id:A1,result:passed,evidence:fixture}], risks [], needHuman [].'

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const expectedAcceptance = () => [{ id: 'A1', check: 'First exact check' }, { id: 'A2', check: 'Second exact check' }]
const passed = (id: string, evidence = `Evidence for ${id}`) => ({ id, result: 'passed', evidence })
const validReport = () => ({ state: 'ready', done: ['Implemented'], todo: [], risks: [], needHuman: [], acceptance: [passed('A1'), passed('A2')] })
function detailWith(report: any = validReport(), acceptance: any = expectedAcceptance()): any {
  return { ticket: { id: 'ticket-1', state: 'running', currentAssignment: 'current' }, brief: { acceptance },
    assignments: [{ id: 'current', state: 'ended', startedAt: 100, report }] }
}

describe('actual displayTitle initializer (literal display label only)', () => {
  it('shortens the full screenshot goal to its exact first sentence', () => {
    expect(displayTitle(fixtureGoal)).toBe('Harmless acceptance fixture 2.')
    expect(fixtureGoal).toContain('No file reads, writes, shell, channels, approvals or human questions.')
  })

  it.each(['A short unchanged title', 'Already concise.', '简短原句。', 'What happened? Later detail', 'Ready! Next sentence'])('retains the original short sentence: %s', value => {
    const expected = value === 'What happened? Later detail' ? 'What happened?' : value === 'Ready! Next sentence' ? 'Ready!' : value
    expect(displayTitle(value)).toBe(expected)
  })

  it('bounds long Chinese without punctuation by code points', () => {
    const value = '这是一个没有句号也没有空格的中文原始任务标题'.repeat(5)
    expect(displayTitle(value)).toBe(`${Array.from(value).slice(0, 64).join('')}…`)
    expect(Array.from(displayTitle(value))).toHaveLength(65)
  })

  it('bounds a long English token without relying on word boundaries', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz'.repeat(5)
    expect(displayTitle(value)).toBe(`${value.slice(0, 64)}…`)
  })

  it('never splits an emoji surrogate pair at the code-point boundary', () => {
    const value = `${'a'.repeat(63)}😀${'z'.repeat(10)}`
    expect(displayTitle(value)).toBe(`${'a'.repeat(63)}😀…`)
    expect(Array.from(displayTitle('😀'.repeat(65)))).toEqual([...Array(64).fill('😀'), '…'])
    expect(displayTitle(value).isWellFormed()).toBe(true)
  })

  it.each(['\n', '\r', '\r\n'])('uses only the first literal line (%j)', newline => {
    expect(displayTitle(`  First literal line${newline}Do not append the second line.  `)).toBe('First literal line')
  })

  it.each([
    ['Visit https://example.com/path before continuing. Hidden follow-up.', 'Visit https://example.com/path before continuing.'],
    ['https://example.com/a.b?q=1.2', 'https://example.com/a.b?q=1.2'],
    ['Use version 1.2.3 safely. More detail.', 'Use version 1.2.3 safely.'],
  ])('does not mistake internal URL/version dots for a sentence: %s', (value, expected) => {
    expect(displayTitle(value)).toBe(expected)
  })

  it.each([undefined, null, '', ' \n\t ', {}, [], 42].map(value => ({ value })))('labels empty or non-string input Untitled: $value', ({ value }) => {
    expect(displayTitle(value)).toBe('Untitled')
  })

  it('does not coerce an object into title text', () => {
    expect(displayTitle({ toString() { throw new Error('must not coerce') } })).toBe('Untitled')
  })

  it('leaves two distinct full goals intact even when their display prefixes collide', () => {
    const prefix = '同前缀的原始目标没有句号'.repeat(7)
    const input = freeze([{ title: `${prefix}甲`, brief: { goal: `${prefix}甲` } }, { title: `${prefix}乙`, brief: { goal: `${prefix}乙` } }])
    const before = structuredClone(input)
    expect(displayTitle(input[0]!.title)).toBe(displayTitle(input[1]!.title))
    expect(input[0]!.title).not.toBe(input[1]!.title)
    expect(input).toEqual(before)
    expect(input[0]!.brief.goal).toBe(`${prefix}甲`)
    expect(input[1]!.brief.goal).toBe(`${prefix}乙`)
  })
})

describe('actual reportSummary initializer: attempt selection, not status promotion', () => {
  it('selects currentAssignment ahead of a newer ready report', () => {
    const detail = detailWith({ ...validReport(), state: 'needs-human', done: ['Current attempt'] })
    detail.assignments.push({ id: 'old-ready', startedAt: 999, state: 'ended', report: validReport() })
    const summary = reportSummary(detail)
    expect(summary.selected).toBe(detail.assignments[0])
    expect(summary.report).toBe(detail.assignments[0].report)
    expect(summary.done).toEqual(['Current attempt'])
  })

  it('does not fall back to an old report when the declared current assignment is missing', () => {
    const detail = detailWith()
    detail.ticket.currentAssignment = 'missing-current'
    const summary = reportSummary(detail)
    expect(summary.selected).toBeUndefined()
    expect(summary.report).toBeNull()
    expect(summary.done).toBeNull()
    expect(summary.ambiguous).toBe(true)
  })

  it('does not replace a current attempt without a report with an older ready report', () => {
    const detail = detailWith()
    const old = { ...detail.assignments[0], id: 'old', startedAt: 50 }
    delete detail.assignments[0].report
    detail.assignments.push(old)
    const summary = reportSummary(detail)
    expect(summary.selected).toBe(detail.assignments[0])
    expect(summary.report).toBeNull()
    expect(summary.done).toBeNull()
  })

  it('selects the newest attempt even when only the older attempt has a report', () => {
    const detail = detailWith()
    delete detail.ticket.currentAssignment
    const newest = { id: 'newest', startedAt: 200, state: 'running' }
    detail.assignments.push(newest)
    const summary = reportSummary(detail)
    expect(summary.selected).toBe(newest)
    expect(summary.report).toBeNull()
    expect(summary.done).toBeNull()
  })

  it('orders by valid attempt start time independently of array order or old end time', () => {
    const old = { id: 'old', startedAt: 100, endedAt: 999, report: { ...validReport(), done: ['Old'] } }
    const middle = { id: 'middle', startedAt: 200, endedAt: 800, report: validReport() }
    const newest = { id: 'newest', startedAt: 300, report: { ...validReport(), done: ['Newest'] } }
    for (const assignments of [[old, middle, newest], [newest, old, middle], [middle, newest, old]]) {
      const detail = detailWith()
      delete detail.ticket.currentAssignment
      detail.assignments = freeze(assignments)
      const before = [...assignments]
      const summary = reportSummary(detail)
      expect(summary.selected).toBe(newest)
      expect(summary.done).toEqual(['Newest'])
      expect(detail.assignments).toEqual(before)
    }
  })

  it('does not break tied latest timestamps by array order or report readiness', () => {
    const ready = { id: 'ready', startedAt: 300, report: validReport() }
    const running = { id: 'running', startedAt: 300 }
    for (const assignments of [[ready, running], [running, ready]]) {
      const detail = detailWith()
      delete detail.ticket.currentAssignment
      detail.assignments = assignments
      const summary = reportSummary(detail)
      expect(summary.selected).toBeUndefined()
      expect(summary.report).toBeNull()
      expect(summary.ambiguous).toBe(true)
    }
  })

  it.each([undefined, null, 0, -1, NaN, Infinity, '400'])('does not guess the latest attempt if a start timestamp is invalid: %j', startedAt => {
    const detail = detailWith()
    delete detail.ticket.currentAssignment
    detail.assignments.push({ id: 'undated', startedAt, endedAt: 500, report: validReport() })
    const summary = reportSummary(detail)
    expect(summary.selected).toBeUndefined()
    expect(summary.report).toBeNull()
    expect(summary.ambiguous).toBe(true)
  })

  it('can select a single legacy attempt without any dates', () => {
    const detail = detailWith()
    delete detail.ticket.currentAssignment
    delete detail.assignments[0].startedAt
    const summary = reportSummary(detail)
    expect(summary.selected).toBe(detail.assignments[0])
    expect(summary.report).toBe(detail.assignments[0].report)
    expect(summary.malformedAcceptance).toBe(false)
  })

  it.each(['failed', 'stopped'])('does not mutate or promote an ended %s ticket based on a ready passing report', outcome => {
    const detail = detailWith()
    detail.ticket = { ...detail.ticket, state: 'ended', outcome, stoppedByHuman: outcome === 'stopped', ended: { outcome, by: 'human', at: 500 } }
    const before = structuredClone(detail)
    freeze(detail)
    const summary = reportSummary(detail)
    expect(summary.report.state).toBe('ready')
    expect(summary.malformedAcceptance).toBe(false)
    expect(detail).toEqual(before)
    expect(detail.ticket.state).toBe('ended')
    expect(detail.ticket.outcome).toBe(outcome)
  })

  it.each([undefined, null, {}, { assignments: [] }])('handles absent attempts without inventing a report: %j', detail => {
    const summary = reportSummary(detail)
    expect(summary.selected).toBeUndefined()
    expect(summary.report).toBeNull()
    expect(summary.done).toBeNull()
  })
})

describe('actual reportSummary initializer: exact acceptance and literal report fields', () => {
  it('matches exact acceptance IDs, retaining expected checks, reported evidence and all valid results', () => {
    const expected = [...expectedAcceptance(), { id: 'A3', check: 'Third exact check' }]
    const report = { ...validReport(), acceptance: [
      { id: 'A3', result: 'not-run', evidence: 'Not run for stated reason' },
      { id: 'A1', check: 'Untrusted replacement check', result: 'passed', evidence: '  Exact observed evidence  ' },
      { id: 'A2', result: 'failed', evidence: 'Observed failure' },
    ] }
    const detail = freeze(detailWith(report, expected)), before = structuredClone(detail)
    const summary = reportSummary(detail)
    expect(summary.acceptance).toEqual([
      { id: 'A1', check: 'First exact check', result: 'passed', evidence: '  Exact observed evidence  ' },
      { id: 'A2', check: 'Second exact check', result: 'failed', evidence: 'Observed failure' },
      { id: 'A3', check: 'Third exact check', result: 'not-run', evidence: 'Not run for stated reason' },
    ])
    expect(summary.malformedAcceptance).toBe(false)
    expect(summary.passed).toBe(1)
    expect(summary.total).toBe(3)
    expect(detail).toEqual(before)
  })

  it.each([
    { name: 'missing expected row', acceptance: [passed('A1')], unknown: 'A2' },
    { name: 'duplicate reported ID', acceptance: [passed('A1'), passed('A1'), passed('A2')], unknown: 'A1' },
    { name: 'unknown ID instead of expected ID', acceptance: [passed('A1'), passed('A9')], unknown: 'A2' },
    { name: 'case-mismatched ID', acceptance: [passed('a1'), passed('A2')], unknown: 'A1' },
    { name: 'whitespace-mismatched ID', acceptance: [passed(' A1 '), passed('A2')], unknown: 'A1' },
    { name: 'numeric ID', acceptance: [passed('A1'), { id: 2, result: 'passed', evidence: 'Numeric ID' }], unknown: 'A2' },
    { name: 'null row', acceptance: [passed('A1'), null], unknown: 'A2' },
    { name: 'primitive row', acceptance: [passed('A1'), 'A2 passed'], unknown: 'A2' },
    { name: 'malformed result', acceptance: [passed('A1'), { ...passed('A2'), result: 'ready' }], unknown: 'A2' },
    { name: 'missing result', acceptance: [passed('A1'), { id: 'A2', evidence: 'Evidence' }], unknown: 'A2' },
    { name: 'missing evidence', acceptance: [passed('A1'), { id: 'A2', result: 'passed' }], unknown: 'A2' },
    { name: 'blank evidence', acceptance: [passed('A1'), passed('A2', ' \n ')], unknown: 'A2' },
    { name: 'object evidence', acceptance: [passed('A1'), { ...passed('A2'), evidence: { proof: 'not text' } }], unknown: 'A2' },
    { name: 'null evidence', acceptance: [passed('A1'), { ...passed('A2'), evidence: null }], unknown: 'A2' },
  ])('marks $name malformed instead of treating it as a complete pass', ({ acceptance, unknown }) => {
    const summary = reportSummary(detailWith({ ...validReport(), acceptance }))
    expect(summary.malformedAcceptance).toBe(true)
    expect(summary.acceptance.find((row: any) => row.id === unknown)?.result).toBe('unknown')
    // Do not infer render behavior or require a particular count for partially valid records.
  })

  it('marks an additional unknown row malformed even when all expected rows pass', () => {
    const summary = reportSummary(detailWith({ ...validReport(), acceptance: [passed('A1'), passed('A2'), passed('EXTRA')] }))
    expect(summary.malformedAcceptance).toBe(true)
    expect(summary.acceptance.map((row: any) => row.id)).toEqual(['A1', 'A2'])
  })

  it('marks duplicate expected IDs malformed and does not call their rows passed', () => {
    const summary = reportSummary(detailWith(validReport(), [{ id: 'A1', check: 'First' }, { id: 'A1', check: 'Duplicate' }]))
    expect(summary.malformedAcceptance).toBe(true)
    expect(summary.acceptance.every((row: any) => row.result === 'unknown')).toBe(true)
  })

  it.each([undefined, null, '[]', {}, [{ check: 'No ID' }], [{ id: '', check: 'Blank ID' }], [{ id: ' ', check: 'Whitespace ID' }]].map(acceptance => ({ acceptance })))('marks malformed expected acceptance explicitly: $acceptance', ({ acceptance }) => {
    const detail = detailWith()
    detail.brief.acceptance = acceptance
    expect(reportSummary(detail).malformedAcceptance).toBe(true)
  })

  it.each([undefined, null, '[]', {}, []].map(acceptance => ({ acceptance })))('marks absent, malformed or missing reported acceptance explicitly: $acceptance', ({ acceptance }) => {
    expect(reportSummary(detailWith({ ...validReport(), acceptance })).malformedAcceptance).toBe(true)
  })

  it('retains valid done/todo/risks/needHuman text verbatim', () => {
    const fields = { done: ['  Literal completion  '], todo: ['Unfinished step'], risks: ['Observed risk'], needHuman: ['Confirm this exact question?'] }
    const report = { ...validReport(), ...fields }
    const summary = reportSummary(detailWith(report))
    for (const key of ['done', 'todo', 'risks', 'needHuman'] as const) expect(summary[key]).toEqual(fields[key])
  })

  it('distinguishes deliberately empty field arrays from unavailable text fields', () => {
    const fields = { done: [], todo: [], risks: [], needHuman: [] }
    const summary = reportSummary(detailWith({ ...validReport(), ...fields }))
    for (const key of Object.keys(fields)) expect(summary[key]).toEqual([])
  })

  it('filters empty string entries without hiding valid todo, risks or needHuman text or changing the report', () => {
    const report = freeze({ ...validReport(), done: ['', '  '], todo: ['', 'Next step'], risks: [' ', '重要风险'], needHuman: ['', 'Ask the owner'] })
    const before = structuredClone(report)
    const summary = reportSummary(detailWith(report))
    expect(summary.done).toEqual([])
    expect(summary.todo).toEqual(['Next step'])
    expect(summary.risks).toEqual(['重要风险'])
    expect(summary.needHuman).toEqual(['Ask the owner'])
    expect(report).toEqual(before)
  })

  it.each([undefined, null, '', 'not an array', {}, [42], ['valid', null]].map(value => ({ value })))('returns null for malformed string-list fields, not a false empty list: $value', ({ value }) => {
    const summary = reportSummary(detailWith({ ...validReport(), done: value, todo: value, risks: value, needHuman: value }))
    for (const key of ['done', 'todo', 'risks', 'needHuman']) expect(summary[key]).toBeNull()
  })

  it('does not JSON-parse or execute hostile report text or string-list values', () => {
    const { actual, context } = closure('reportSummary')
    new Script('globalThis.parseCalls = 0; globalThis.executed = false; JSON.parse = () => { globalThis.parseCalls++; throw new Error("must not parse report text") }').runInContext(context)
    const payload = 'globalThis.executed = true; ({ state: "ready", acceptance: [] })'
    const json = JSON.stringify(validReport())
    for (const raw of [payload, json, [], null]) {
      const summary = actual(detailWith(raw))
      expect(summary.report).toBeNull()
      expect(summary.malformedAcceptance).toBe(true)
    }
    const report = { ...validReport(), done: [payload], todo: [json], risks: ['<script>globalThis.executed = true</script>'], needHuman: ['{"approval":"not granted"}'] }
    const summary = actual(detailWith(report))
    for (const key of ['done', 'todo', 'risks', 'needHuman'] as const) expect(summary[key]).toEqual(report[key])
    expect(context.parseCalls).toBe(0)
    expect(context.executed).toBe(false)
  })
})
