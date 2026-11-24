import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import { TextEncoder } from 'node:util'
import ts from 'typescript'

const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any>): any {
  let initializer = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) initializer = node.initializer.getText(tree); node.forEachChild(visit) }
  visit(tree)
  if (!initializer) throw new Error(`Missing ${name}`)
  const context = createContext(globals)
  new Script(ts.transpileModule(`globalThis.actual = (${initializer})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  return context.actual
}
const array = (value: any) => Array.isArray(value) ? value : []
const project = (key = 'project-one', excluded = false) => ({ kind: 'project', key, name: 'Same name', excluded, sessionTotal: 0, includedTotal: 0 })
const session = (id = 'session-one', key = 'project-one', excluded = false) => ({ sessionId: id, project: { kind: 'project', key }, excluded, title: 'Work', evidence: 'structured', objective: 'Do the work' })
const page = (items: any[], revision = 'r1', extra: any = {}) => ({ state: 'ready', revision, sampledAt: 100, total: items.length, items, hasMore: false, ...extra })
function harness() {
  const calls: any[] = [], events: any[] = [], g: any = {
    array, tr: (key: string) => key, scopeMutation: null, epochRef: { current: 'epoch' }, alive: { current: true }, systemRef: { current: 'scope' },
    scopeProjectsRef: { current: null }, scopeProjectRef: { current: null }, scopePagesRef: { current: {} }, scopeViewRef: { current: 'included' }, scopeBusyRef: { current: null }, scopeVersion: { current: 0 }, scopeMutationRef: { current: null }, sessionWorkPagesRef: { current: {} }, sessionWorkGeneration: { current: 0 }, sessionWorkBusyRef: { current: false },
    call: async (path: string, input: any) => { calls.push({ path, input }); return page([]) }, poke: { current: () => events.push('preview') },
  }
  for (const key of ['ScopeProjects', 'ScopeProject', 'ScopePages', 'ScopeView', 'ScopeBusy', 'ScopeError', 'ScopeReceipt', 'ScopeMutation', 'SessionWorkPages', 'SessionWorkBusy', 'SessionWorkError', 'Notice']) g[`set${key}`] = (value: any) => { g[key[0]!.toLowerCase() + key.slice(1)] = value; events.push([key, value]) }
  for (const name of ['scopeProjectKey', 'scopeProjectName', 'scopeProjectReference', 'resetScope', 'readScopeProjects', 'readScopeSessions', 'readSessionWork', 'openScopeProject', 'backScopeProjects', 'chooseScopeView', 'changeScopeIncluded']) g[name] = closure(name, g)
  return { g, calls, events }
}
function selected(g: any, excluded = false, view = 'included') {
  const p = project('project-one', excluded), row = session('session-one', p.key, view === 'excluded')
  g.scopeProjectsRef.current = page([p]); g.scopeProjectRef.current = p; g.scopeViewRef.current = view
  g.scopePagesRef.current = { [view]: { ...page([row]), projectKey: 'project:project-one' } }
  return { p, row }
}
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children })
const button = (title: string, onClick: () => void, disabled = false, props: any = {}) => h('button', { onClick, disabled, ...props }, title)
function nodes(value: any): any[] { return value && typeof value === 'object' ? [value, ...array(value.children).flatMap(nodes)] : [] }

// Actual closure/data/interaction contracts only: no React/DOM emulation or visual-verification claim.
function locateHarness() {
  const { g, calls, events } = harness()
  Object.assign(g, { TextEncoder, systemRef: { current: 'locate' }, locateTextRef: { current: 'shipping' }, locateResultRef: { current: null }, locateVersion: { current: 0 }, locateBusyRef: { current: null } })
  for (const key of ['LocateText', 'LocateResult', 'LocateBusy', 'LocateError']) g[`set${key}`] = (value: any) => { g[key[0]!.toLowerCase() + key.slice(1)] = value; events.push([key, value]) }
  for (const name of ['resetLocate', 'editLocateText', 'stageLocateEvidence', 'readLocate']) g[name] = closure(name, g)
  return { g, calls, events }
}
const lookup = (status: string, candidates: any[] = [], extra: any = {}) => ({ status, candidates, revision: 'r1', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', ...extra })

describe('bounded scope target lookup UI closures', () => {
  it('asks the locate stage across included scope without a project filter, send, execution, or composer changes', async () => {
    const { g, calls } = locateHarness(), draft = { draft: 'Keep me', target: { id: 'do-not-change' } }, row = session()
    g.composerRef = { current: draft }; g.updateComposer = () => { throw new Error('must not alter composer') }
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return { version: 1, status: 'located', stage: null, intent: { action: 'continue', confidence: 0.9 }, receipt: null, locate: lookup('located', [row], { target: row, coverage: 'complete' }) } }
    await g.readLocate()
    expect(calls).toEqual([{ path: 'stage-locate', input: { epoch: 'epoch', text: 'shipping' } }]); expect(g.locateResult.status).toBe('located'); expect(g.composerRef.current).toBe(draft)
  })

  it('falls back to the literal bounded chain only when the locate stage capability is unavailable', async () => {
    const { g, calls } = locateHarness(), row = session()
    g.call = async (path: string, input: any) => {
      calls.push({ path, input })
      if (path === 'stage-locate') throw Object.assign(new Error('stage unavailable'), { status: 503 })
      return lookup('located', [row], { target: row, coverage: 'complete' })
    }
    await g.readLocate()
    expect(calls).toEqual([{ path: 'stage-locate', input: { epoch: 'epoch', text: 'shipping' } }, { path: 'session-locate', input: { epoch: 'epoch', text: 'shipping' } }])
    expect(g.locateResult.status).toBe('located')
  })

  it('rechecks only explicit candidates from a current clarification, binding the original revision', async () => {
    const { g, calls } = locateHarness(), row = session(); g.locateResultRef.current = lookup('clarify', [row])
    g.call = async (path: string, input: any) => { calls.push({ path, input }); throw Object.assign(new Error('stale'), { status: 409 }) }
    await g.readLocate({ ...row }); expect(calls).toEqual([])
    await g.readLocate(row)
    expect(calls).toEqual([{ path: 'session-locate', input: { epoch: 'epoch', text: 'shipping', sessionId: row.sessionId, revision: 'r1' } }]); expect(g.locateResultRef.current).toBeNull(); expect(g.locateError).toBe('LocateChanged')
  })

  it('ignores late results after navigation, editing, or epoch changes and never retries', async () => {
    const { g, calls } = locateHarness(); let resolve: any
    g.call = (path: string, input: any) => { calls.push({ path, input }); return new Promise(r => { resolve = r }) }
    const pending = g.readLocate(); g.editLocateText('different'); g.systemRef.current = 'settings'; g.epochRef.current = 'new-epoch'
    resolve({ version: 1, status: 'no_match', stage: null, intent: null, receipt: null, locate: lookup('no_match', [], { coverage: 'complete' }) }); await pending
    expect(calls).toHaveLength(1); expect(g.locateResultRef.current).toBeNull(); expect(g.locateTextRef.current).toBe('different')
  })

  it.each([
    lookup('located', [session()], { target: session('different') }),
    lookup('located', [session()], { target: session(), coverage: 'partial' }),
    lookup('located', [session()], { target: session(), controlAvailable: true }),
    lookup('clarify', [{ ...session(), project: { kind: 'unknown', key: 'unknown' } }]),
  ])('rejects contradictory or unknown target receipts %j', async result => {
    const { g } = locateHarness(); g.call = async () => result
    await g.readLocate(); expect(g.locateResultRef.current).toBeNull(); expect(g.locateError).toBe('LocateFailed')
  })

  it('distinguishes same-title candidates with literal field-labelled work excerpts, never HTML', () => {
    const { g } = locateHarness(), dangerous = '<img src=x onerror=execute()>', first = { ...session('one'), matchField: 'objective', matchText: 'Ship checkout' }, second = { ...session('two'), matchField: 'progress', matchText: dangerous }
    Object.assign(g, { h, button, React: { Fragment: 'fragment' }, scopeHeadingRef: { current: null }, locateText: 'ship', locateBusy: false, locateError: '', text: String, sessionSourceTitle: (r: any) => r.title, openSystem() {}, locateResult: lookup('clarify', [first, second]) })
    const view = closure('locateView', g)(), elements = nodes(view)
    expect(elements.some(node => node.tag === 'strong' && node.children.includes('Goal: '))).toBe(true)
    expect(elements.some(node => node.tag === 'strong' && node.children.includes('ScopeProgress: '))).toBe(true)
    expect(elements.some(node => node.tag === 'p' && node.children.includes('Ship checkout'))).toBe(true)
    expect(elements.some(node => node.tag === 'p' && node.children.includes(dangerous))).toBe(true)
    expect(elements.some(node => node.tag === 'img' || node.props?.dangerouslySetInnerHTML)).toBe(false)
  })

  it('shows partial/blocked and no-match honestly, and offers recheck only for clarification', () => {
    const { g } = locateHarness(), row = session()
    Object.assign(g, { h, button, React: { Fragment: 'fragment' }, scopeHeadingRef: { current: null }, locateText: 'shipping', locateBusy: false, locateError: '', text: (v: any) => v === undefined ? 'Unknown' : String(v), sessionSourceTitle: (r: any) => r.title, openSystem() {} })
    const render = closure('locateView', g)
    for (const status of ['blocked', 'no_match', 'located', 'clarify']) {
      g.locateResult = lookup(status, status === 'no_match' ? [] : [row], { coverage: status === 'blocked' ? 'partial' : 'complete', target: row })
      const view = render(), text = JSON.stringify(view)
      expect(text).toContain('LocateOnly'); expect(text).not.toContain('onSubmit'); expect(text).not.toContain('SendInput')
      expect(text.includes('LocateRecheck')).toBe(status === 'clarify')
      if (status === 'blocked') expect(text).toContain('LocatePartial')
      if (status === 'no_match') expect(text).toContain('LocateNoMatch')
    }
  })
})

describe('hierarchical management scope UI closures', () => {
  it('reads the project catalog including empty projects and never scans conversation pages', async () => {
    const { g, calls } = harness(), p = project()
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return page([p], 'r1', { hasMore: true, next: 'project-cursor', total: 21 }) }
    await g.readScopeProjects()
    expect(g.scopeProjectsRef.current.items).toEqual([p]); expect(p.sessionTotal).toBe(0)
    expect(calls).toEqual([{ path: 'session-work', input: { action: 'projects', epoch: 'epoch', limit: 20 } }])
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return page([project('two')], 'r2') }
    await g.readScopeProjects(true)
    expect(calls[1].input).toEqual({ action: 'projects', epoch: 'epoch', limit: 20, cursor: 'project-cursor' })
    expect(g.scopeProjectsRef.current.items).toEqual([p]); expect(g.scopeError).toBe('ScopeChanged')
  })

  it('requests only the selected project/view and rejects mixed-project or cross-revision pages', async () => {
    const { g, calls } = harness(), { row } = selected(g)
    g.scopePagesRef.current.included = { ...page([row], 'r1', { hasMore: true, next: 'bound-cursor' }), projectKey: 'project:project-one' }
    const old = g.scopePagesRef.current.included
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return page([session('other')], 'r2') }
    await g.readScopeSessions('included', true)
    expect(calls[0].input).toEqual({ action: 'list', epoch: 'epoch', projectKey: 'project:project-one', view: 'included', limit: 20, cursor: 'bound-cursor' })
    expect(g.scopePagesRef.current.included).toBe(old); expect(g.scopeError).toBe('ScopeChanged')
    g.call = async () => page([session('wrong', 'another-project')])
    await g.readScopeSessions('included')
    expect(g.scopePagesRef.current.included).toBe(old); expect(g.scopeError).toBe('ScopeReadFailed')
    g.scopeViewRef.current = 'excluded'; g.call = async (path: string, input: any) => { calls.push({ path, input }); return page([session('hidden', 'project-one', true)]) }
    await g.readScopeSessions('excluded')
    expect(calls.at(-1).input).toEqual({ action: 'list', epoch: 'epoch', projectKey: 'project:project-one', view: 'excluded', limit: 20 })
    expect(g.scopePagesRef.current.excluded.items[0].sessionId).toBe('hidden')
  })

  it('never reuses a cursor from another project and never locates or reads unknown membership', async () => {
    const { g, calls } = harness(); selected(g)
    g.scopePagesRef.current.included = { ...page([], 'r1', { hasMore: true, next: 'other' }), projectKey: 'project:another' }
    await g.readScopeSessions('included', true)
    const unknown = { kind: 'unknown', key: 'unknown' }; g.scopeProjectsRef.current = page([unknown]); g.scopeProjectRef.current = null
    g.openScopeProject(unknown)
    expect(g.scopeProjectRef.current).toBeNull()
    g.scopeProjectRef.current = unknown; await g.readScopeSessions()
    expect(calls).toEqual([])
  })

  it('ignores late reads after epoch/navigation changes without touching composer draft or target', async () => {
    const { g } = harness(); selected(g)
    const draft = { draft: 'Keep this unsent text', target: { id: 'unchanged-target' } }; g.composerRef = { current: draft }
    g.updateComposer = () => { throw new Error('Navigation must not edit draft') }
    let resolve: any; g.call = () => new Promise(r => { resolve = r })
    const pending = g.readScopeSessions('included'); g.resetScope(); g.epochRef.current = 'new-epoch'
    resolve(page([session('late')]))
    await pending
    expect(g.scopePagesRef.current).toEqual({}); expect(g.composerRef.current).toBe(draft); expect(g.scopeBusyRef.current).toBeNull()
  })

  it.each([
    { projectId: 'wrong', included: false, revision: 'r2', stopped: false },
    { projectId: 'project-one', included: true, revision: 'r2', stopped: false },
    { projectId: 'project-one', included: false, stopped: false },
    { projectId: 'project-one', included: false, revision: '', stopped: false },
    { projectId: 'project-one', included: false, revision: 'r2' },
    { projectId: 'project-one', included: false, revision: 'r2', stopped: true },
  ])('retains snapshots without refresh or retry for inexact project receipt %j', async receipt => {
    const { g, calls, events } = harness(), p = project(), old = page([p]); g.scopeProjectsRef.current = old
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return receipt }
    await g.changeScopeIncluded('project', p, false, 'r1')
    expect(calls).toHaveLength(1); expect(g.scopeProjectsRef.current).toBe(old); expect(g.scopeReceipt).toBeNull(); expect(g.scopeError).toBe('ScopeSaveFailed')
    expect(events).not.toContain('preview')
  })

  it('preserves snapshots and does not retry failures or 409s', async () => {
    for (const status of [undefined, 409]) {
      const { g, calls } = harness(), { row } = selected(g), old = g.scopePagesRef.current
      g.call = async (path: string, input: any) => { calls.push({ path, input }); throw Object.assign(new Error('network/conflict'), { status }) }
      await g.changeScopeIncluded('session', row, false, 'r1')
      expect(calls).toHaveLength(1); expect(g.scopePagesRef.current).toBe(old); expect(g.scopeError).toBe(status === 409 ? 'ScopeChanged' : 'ScopeSaveFailed')
    }
  })

  it('requires a session revision in the exact receipt and never bypasses project exclusion', async () => {
    const { g, calls } = harness(), { row } = selected(g)
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return { sessionId: input.sessionId, included: input.included } }
    await g.changeScopeIncluded('session', row, false, 'r1')
    expect(g.scopeError).toBe('ScopeSaveFailed'); expect(calls).toHaveLength(1)
    const blocked = selected(g, true, 'excluded'); await g.changeScopeIncluded('session', blocked.row, true, 'r1')
    expect(calls).toHaveLength(1)
    g.scopeProjectRef.current.excluded = false; g.scopeProjectsRef.current.revision = 'stale'
    await g.changeScopeIncluded('session', blocked.row, true, 'r1'); expect(calls).toHaveLength(1)
  })

  it('refreshes only after exact receipt, then retains the selected project and active tab', async () => {
    const { g, calls, events } = harness(), { row } = selected(g, false, 'excluded')
    g.call = async (path: string, input: any) => {
      calls.push({ path, input })
      if (input.action === 'set-included') { expect(g.scopePagesRef.current.excluded.items).toContain(row); return { sessionId: row.sessionId, included: true, revision: 'r2' } }
      if (input.action === 'projects') return page([project()], 'r2')
      return page([], 'r2')
    }
    await g.changeScopeIncluded('session', row, true, 'r1')
    expect(calls.map(call => call.input.action)).toEqual(['set-included', 'projects', 'list'])
    expect(calls[2].input).toEqual({ action: 'list', epoch: 'epoch', projectKey: 'project:project-one', view: 'excluded', limit: 20 })
    expect(g.scopeProjectRef.current.key).toBe('project-one'); expect(g.scopeReceipt).toEqual({ kind: 'session', id: row.sessionId, included: true, revision: 'r2' }); expect(events).toContain('preview')
  })

  it.each(['confirmed', 'unknown'])('retains %s mutation evidence across navigation/epoch changes without applying it to a new page', async status => {
    const { g, calls, events } = harness(), { row } = selected(g)
    let resolve: any, reject: any
    g.call = (path: string, input: any) => { calls.push({ path, input }); return new Promise((yes, no) => { resolve = yes; reject = no }) }
    const pending = g.changeScopeIncluded('session', row, false, 'r1')
    expect(g.scopeMutationRef.current).toMatchObject({ epoch: 'epoch', kind: 'session', id: row.sessionId, included: false, status: 'pending' })
    g.resetScope(); g.systemRef.current = 'settings'; g.epochRef.current = 'new-epoch'
    const newer = page([project('newer')], 'new'); g.scopeProjectsRef.current = newer
    if (status === 'confirmed') resolve({ sessionId: row.sessionId, included: false, revision: 'r2' }); else reject(new Error('uncertain network outcome'))
    await pending
    expect(g.scopeMutationRef.current).toMatchObject({ epoch: 'epoch', id: row.sessionId, status })
    expect(g.scopeProjectsRef.current).toBe(newer); expect(calls).toHaveLength(1); expect(events).not.toContain('preview')
    expect(g.scopeReceipt).toBeNull()
  })

  it('invalidates cached Sources work after exact confirmation even when navigation left scope', async () => {
    const { g, calls, events } = harness(), { row } = selected(g)
    g.sessionWorkPagesRef.current = { included: page([row]) }; let resolve: any
    g.call = (path: string, input: any) => { calls.push({ path, input }); return new Promise(yes => { resolve = yes }) }
    const pending = g.changeScopeIncluded('session', row, false, 'r1'); g.resetScope(); g.systemRef.current = 'sources'
    resolve({ sessionId: row.sessionId, included: false, revision: 'r2' }); await pending
    expect(g.scopeMutationRef.current.status).toBe('confirmed'); expect(g.sessionWorkPagesRef.current).toEqual({}); expect(g.sessionWorkPages).toEqual({})
    expect(g.sessionWorkGeneration.current).toBe(1); expect(events).toContain('preview'); expect(calls).toHaveLength(1)
  })

  it('fences a Sources read started before scope exclusion so late work cannot repopulate the cache', async () => {
    const { g, calls } = harness(), { row } = selected(g); let confirm: any, resolveRead: any
    g.call = (path: string, input: any) => { calls.push({ path, input }); return new Promise(yes => { if (input.action === 'list') resolveRead = yes; else confirm = yes }) }
    const mutation = g.changeScopeIncluded('session', row, false, 'r1'); g.resetScope(); g.systemRef.current = 'sources'
    const read = g.readSessionWork('included'); confirm({ sessionId: row.sessionId, included: false, revision: 'r2' }); await mutation
    resolveRead(page([row], 'r1')); await read
    expect(g.sessionWorkGeneration.current).toBe(1); expect(g.sessionWorkPagesRef.current).toEqual({}); expect(g.sessionWorkPages).toEqual({})
    expect(calls.map(item => item.input.action)).toEqual(['set-included', 'list'])
  })

  it('keeps a new epoch Sources cache intact when an old scope mutation is exactly confirmed', async () => {
    const { g, events } = harness(), { row } = selected(g); let resolve: any
    g.call = () => new Promise(yes => { resolve = yes })
    const mutation = g.changeScopeIncluded('session', row, false, 'r1'); g.resetScope(); g.epochRef.current = 'new-epoch'; g.systemRef.current = 'sources'
    const newer = { included: page([session('new-session')], 'new') }; g.sessionWorkPagesRef.current = newer; g.sessionWorkGeneration.current = 7
    resolve({ sessionId: row.sessionId, included: false, revision: 'r2' }); await mutation
    expect(g.scopeMutationRef.current).toMatchObject({ epoch: 'epoch', status: 'confirmed' }); expect(g.sessionWorkPagesRef.current).toBe(newer); expect(g.sessionWorkGeneration.current).toBe(7); expect(events).not.toContain('preview')
  })

  it('shows pending, confirmed, and unknown original-target evidence globally with an old-epoch warning and no replay button', () => {
    const { g } = harness(); Object.assign(g, { h, text: String, epochRef: { current: 'new-epoch' } })
    const render = closure('scopeMutationBanner', g)
    for (const status of ['pending', 'confirmed', 'unknown']) {
      g.scopeMutation = { epoch: 'original-epoch', kind: 'session', id: 'original-target', included: false, revision: 'r1', status }
      const banner = render(), content = JSON.stringify(banner)
      expect(content).toContain(status === 'pending' ? 'ScopeMutationPending' : status === 'confirmed' ? 'ScopeMutationConfirmed' : 'ScopeMutationUnknown')
      expect(content).toContain('ScopeMutationOldEpoch'); expect(content).toContain('original-epoch'); expect(content).toContain('original-target')
      expect(nodes(banner).some(node => node.tag === 'button')).toBe(false)
    }
    expect(source).toContain('!system ? scopeMutationBanner() : null')
    expect(source).toContain('scopeMutationBanner(), systemError ?')
  })

  it('does not permit a second scope mutation while the first is pending after navigation', async () => {
    const { g, calls } = harness(), { row } = selected(g); let resolve: any
    g.call = (path: string, input: any) => { calls.push({ path, input }); return new Promise(yes => { resolve = yes }) }
    const pending = g.changeScopeIncluded('session', row, false, 'r1'); g.resetScope(); const next = selected(g)
    await g.changeScopeIncluded('session', next.row, false, 'r1'); expect(calls).toHaveLength(1)
    g.systemRef.current = 'settings'; resolve({ sessionId: row.sessionId, included: false, revision: 'r2' }); await pending
  })

  it('restores a second-page project after confirmed session save with bounded metadata pagination and current tab', async () => {
    const { g, calls } = harness(), { p, row } = selected(g, false, 'excluded')
    const first = Array.from({ length: 20 }, (_, i) => project(`first-${i}`)); g.scopeProjectsRef.current = page([...first, p])
    g.call = async (path: string, input: any) => {
      calls.push({ path, input })
      if (input.action === 'set-included') return { sessionId: row.sessionId, included: true, revision: 'r2' }
      if (input.action === 'projects') return input.cursor ? page([project(p.key)], 'r2') : page(first, 'r2', { hasMore: true, next: 'page-two' })
      return page([], 'r2')
    }
    await g.changeScopeIncluded('session', row, true, 'r1')
    expect(calls.map(call => call.input.action)).toEqual(['set-included', 'projects', 'projects', 'list'])
    expect(calls[2].input.cursor).toBe('page-two'); expect(calls[3].input.view).toBe('excluded'); expect(g.scopeProjectRef.current.key).toBe(p.key)
  })

  it('stops second-page restoration when metadata revision changes and never mixes pages or reads session content', async () => {
    const { g, calls } = harness(), { p, row } = selected(g), first = Array.from({ length: 20 }, (_, i) => project(`first-${i}`))
    g.scopeProjectsRef.current = page([...first, p])
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return input.action === 'set-included' ? { sessionId: row.sessionId, included: false, revision: 'r2' } : input.cursor ? page([p], 'r3') : page(first, 'r2', { hasMore: true, next: 'changed-page' }) }
    await g.changeScopeIncluded('session', row, false, 'r1')
    expect(calls).toHaveLength(3); expect(g.scopeProjectRef.current).toBeNull(); expect(g.scopeProjectsRef.current.revision).toBe('r2'); expect(g.scopeProjectsRef.current.items).toEqual(first); expect(g.scopeError).toBe('ScopeChanged')
  })

  it('does not scan beyond the originally loaded catalog boundary if the selected project is missing', async () => {
    const { g, calls } = harness(), { p, row } = selected(g), first = Array.from({ length: 20 }, (_, i) => project(`first-${i}`)), second = Array.from({ length: 20 }, (_, i) => project(`second-${i}`))
    g.scopeProjectsRef.current = page([...first, p])
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return input.action === 'set-included' ? { sessionId: row.sessionId, included: false, revision: 'r2' } : input.cursor ? page(second, 'r2', { hasMore: true, next: 'must-not-load' }) : page(first, 'r2', { hasMore: true, next: 'page-two' }) }
    await g.changeScopeIncluded('session', row, false, 'r1')
    expect(calls).toHaveLength(3); expect(g.scopeProjectRef.current).toBeNull(); expect(g.scopeError).toBe('ScopeProjectNotFound')
  })

  it('renders only the current level, includes empty projects, disambiguates names, and leaves unknown noninteractive', () => {
    const { g } = harness(), one = project('abcdefgh-111'), two = project('abcdefgh-222'), unknown = { kind: 'unknown', key: 'unknown', sessionTotal: 1, includedTotal: 0 }
    g.scopeProjects = g.scopeProjectsRef.current = page([one, two, unknown]); g.scopeProject = null; g.scopePages = {}; g.scopeView = 'included'; g.scopeBusy = ''; g.scopeError = ''; g.scopeReceipt = null; g.scopeHeadingRef = { current: null }
    Object.assign(g, { h, React: { Fragment: 'fragment' }, button, text: String, time: () => 'snapshot', openSystem() {}, scopeSessionCard: (row: any) => h('article', null, `SESSION:${row.sessionId}`) })
    const render = closure('scopeManagementView', g), list = render(), listText = JSON.stringify(list)
    expect(listText).toContain('abcdefgh-1'); expect(listText).toContain('abcdefgh-2'); expect(listText).toContain('ScopeUnknownBlocked'); expect(listText).not.toContain('SESSION:')
    const unknownCard = nodes(list).find(node => node.props?.key === 'unknown')
    expect(nodes(unknownCard).filter(node => node.tag === 'button')).toHaveLength(0)
    g.scopeProject = one; g.scopePages = { included: page([session('one', one.key)]) }
    const inside = JSON.stringify(render())
    expect(inside).toContain('SESSION:one'); expect(inside).toContain('ScopeBackProjects'); expect(inside).not.toContain(two.key); expect(inside).not.toContain('ScopeMoreProjects')
  })

  it('does not render excluded work bodies, and visibly disables child restoration under an excluded project', () => {
    const { g } = harness(); g.scopeProjects = page([], 'r1'); g.scopeBusy = ''
    Object.assign(g, { h, React: { Fragment: 'fragment' }, button, sessionSourceTitle: (row: any) => row.title })
    const render = closure('scopeSessionCard', g), card = render({ ...session('hidden', 'project-one', true), progress: 'secret-progress', decision: 'secret-question' }, page([], 'r1'), project('project-one', true))
    const body = JSON.stringify(card)
    expect(body).not.toContain('Do the work'); expect(body).not.toContain('secret-progress'); expect(body).not.toContain('secret-question'); expect(body).toContain('ScopeParentExcluded')
    expect(nodes(card).find(node => node.tag === 'button').props.disabled).toBe(true)
  })

  it('exposes a real settings entry without changing existing Sources closures or installing a poll', () => {
    const { g } = harness(), opened: string[] = []
    Object.assign(g, { h, button, t: (key: string) => key, openSystem: (tab: string) => opened.push(tab) })
    const entry = closure('scopeSettingsEntry', g)()
    nodes(entry).find(node => node.tag === 'button').props.onClick()
    expect(opened).toEqual(['scope'])
    expect(source).toContain("if (!tab || tab === 'scope' || tab === 'locate' || systemBusy.current) return")
    expect(source).toContain("system === 'scope' ? 'ScopeManagement'")
    for (const language of ['zh', 'en']) {
      const locale = JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).panel
      expect(locale.wScopeExcludeWarning).toBeTruthy(); expect(locale.wScopeRestoreWarning).toBeTruthy(); expect(locale.wScopeManagement).toBeTruthy()
    }
  })
})
