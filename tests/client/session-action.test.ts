import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { createContext, Script } from 'node:vm'
import { TextEncoder } from 'node:util'
import ts from 'typescript'

const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function initializer(name: string) {
  let value = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) value = node.initializer.getText(tree); node.forEachChild(visit) }
  visit(tree)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
function closure(name: string, globals: Record<string, any>): any {
  const context = createContext(globals)
  new Script(ts.transpileModule(`globalThis.actual = (${initializer(name)})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  return context.actual
}
const scope = 'a'.repeat(64), fact = 'b'.repeat(64), grant = 'c'.repeat(64)
const array = (value: any) => Array.isArray(value) ? value : []
const row = (sessionId = 'session-one', projectKey = 'project-one', factRevision = fact) => ({ sessionId, project: { kind: 'project', key: projectKey, name: 'Same project name' }, factRevision, title: 'Same session title' })
const located = (target = row(), revision = scope, extra: any = {}) => ({ status: 'located', target, candidates: [target], revision, coverage: 'complete', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', ...extra })
const digest = (input: any) => createHash('sha256').update(JSON.stringify([input.epoch, input.requestId, input.actionId, input.operation, input.text, input.target.sessionId, input.target.scopeRevision, input.target.factRevision])).digest('hex')
function receipt(input: any, extra: any = {}) {
  return { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, operation: input.operation, target: { ...input.target, project: { kind: 'project', key: 'project-one' } }, digest: digest(input), messageId: `go:${input.actionId}`, seq: 2, at: 100, updatedAt: 101, state: 'blocked', code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', durable: true, accepted: false, executed: false, completed: false, disposition: 'not-dispatched', ...extra }
}
function closed(input: any, extra: any = {}) {
  return { version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, operation: input.operation, target: { ...input.target }, digest: digest(input), seq: 1, at: 120, updatedAt: 120, state: 'closed', bindingVerified: false, durable: true, accepted: false, executed: null, completed: null, disposition: 'closed-before-dispatch', code: 'session_action_id_closed', ...extra }
}
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children })
const button = (title: string, onClick: () => void, disabled = false) => h('button', { type: 'button', onClick, disabled }, title)
function nodes(value: any): any[] { return value && typeof value === 'object' ? [value, ...array(value.children).flatMap(nodes)] : [] }
function harness() {
  const calls: any[] = [], events: any[] = [], draft = { draft: 'Main draft must not change', target: { id: 'main-target' }, pending: { requestId: 'main-request' } }
  let id = 0
  const g: any = {
    array, TextEncoder, crypto: webcrypto, h, button, React: { Fragment: 'fragment' }, text: String, time: String,
    tr: (key: string) => key, mintId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    alive: { current: true }, epochRef: { current: 'epoch-one' }, systemRef: { current: 'locate' },
    locateResultRef: { current: located() }, locateVersion: { current: 0 }, locateBusyRef: { current: null },
    sessionActionsRef: { current: {} }, sessionActions: {}, sessionActionComposing: { current: false }, sessionActionFocus: { current: '' },
    scopeProjectKey: (p: any) => p?.kind === 'project' && p.key ? `project:${p.key}` : p?.kind === 'unassigned' ? 'unassigned' : '',
    scopeProjectName: (p: any) => p?.name || p?.key, sessionSourceTitle: (value: any) => value.title,
    composerRef: { current: draft }, updateComposer: () => { throw new Error('Action must not change main composer') },
    setSessionActions: (value: any) => { g.sessionActions = value; events.push(value) },
    setLocateResult: () => {}, setLocateBusy: () => {}, setLocateError: () => {},
    call: async (path: string, input: any) => { calls.push({ path, input }); return receipt(input) },
  }
  for (const name of ['sessionActionKey', 'currentSessionAction', 'saveSessionAction', 'editSessionAction', 'newSessionActionDraft', 'sessionActionDigest', 'validSessionActionReceipt', 'validSessionActionClosure', 'closeSessionAction', 'checkSessionAction', 'sessionActionStatus', 'sessionActionEvidence', 'sessionActionView', 'resetLocate']) g[name] = closure(name, g)
  const edit = (text = '  本次人类文字\r\nKeep Unicode 🧭 exactly  ', operation = 'continue') => {
    const target = g.currentSessionAction(); g.editSessionAction(target.key, 'text', text); g.editSessionAction(target.key, 'operation', operation); return target.key
  }
  return { g, calls, events, draft, edit, minted: () => id }
}

// Execute actual extracted closures and interaction contracts, not a DOM/screenshot emulation.
describe('G2 independent blocked text action UI contracts', () => {
  it('isolates drafts by epoch, session, project, scope and fact revision without rebinding or copying the main draft', () => {
    const { g, edit, draft } = harness(), key = edit('Original target text', 'steer')
    const variants = [located(row('other')), located(row('session-one', 'other-project')), located(row(), 'd'.repeat(64)), located(row('session-one', 'project-one', 'e'.repeat(64)))]
    for (const value of variants) {
      g.locateResultRef.current = value
      const next = g.currentSessionAction(); expect(next.key).not.toBe(key); expect(g.sessionActionsRef.current[next.key]).toBeUndefined()
      g.editSessionAction(key, 'text', 'must not overwrite old target')
      g.editSessionAction(next.key, 'text', `only ${next.key}`)
      expect(g.sessionActionsRef.current[key].text).toBe('Original target text')
    }
    g.locateResultRef.current = located(); g.epochRef.current = 'epoch-two'
    const newer = g.currentSessionAction(); expect(g.sessionActionsRef.current[newer.key]).toBeUndefined()
    g.epochRef.current = 'epoch-one'
    expect(g.currentSessionAction().key).toBe(key); expect(g.sessionActionsRef.current[key].operation).toBe('steer')
    expect(g.composerRef.current).toBe(draft); expect(draft.draft).toBe('Main draft must not change')
  })

  it('retains original drafts through resetLocate and navigation, editing only the currently located exact target', async () => {
    const { g, edit, calls } = harness(), key = edit('Keep while navigating')
    g.resetLocate(); g.systemRef.current = 'settings'
    g.editSessionAction(key, 'text', 'ignored'); await g.checkSessionAction(key)
    expect(calls).toEqual([]); expect(g.sessionActionsRef.current[key].text).toBe('Keep while navigating')
    g.systemRef.current = 'locate'; g.locateResultRef.current = located()
    expect(g.currentSessionAction().key).toBe(key); expect(g.sessionActionsRef.current[key].text).toBe('Keep while navigating')
  })

  it.each(['continue', 'supplement', 'steer'])('posts only one exact %s prepare, verifies digest, retains original text, and never alters main composer', async operation => {
    const { g, edit, calls, draft } = harness(), text = '  保留原字节 🧭\r\nnot a copied old instruction  ', key = edit(text, operation)
    await g.checkSessionAction(key)
    expect(calls).toEqual([{ path: 'session-action', input: { action: 'prepare', epoch: 'epoch-one', requestId: '00000000-0000-4000-8000-000000000001', actionId: '00000000-0000-4000-8000-000000000002', operation, text, target: { sessionId: 'session-one', scopeRevision: scope, factRevision: fact } } }])
    const saved = g.sessionActionsRef.current[key]
    const { action: _action, ...pending } = calls[0].input
    expect(saved).toMatchObject({ text, operation, status: 'blocked', pending, receipt: { state: 'blocked', code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', durable: true, accepted: false, executed: false, completed: false, seq: 2 } })
    expect(saved.receipt.digest).toBe(digest(calls[0].input)); expect(g.composerRef.current).toBe(draft)
    g.editSessionAction(key, 'text', 'cannot mutate submitted text'); await g.checkSessionAction(key)
    expect(calls).toHaveLength(1); expect(saved.text).toBe(text)
  })

  it('starts a new local draft only by an explicit blocked-action click, retaining original evidence and minting new IDs only on a later check', async () => {
    const { g, edit, calls, minted, draft } = harness(), key = edit('Original blocked text', 'supplement')
    await g.checkSessionAction(key)
    const original = g.sessionActionsRef.current[key], originalId = original.pending.actionId
    const newDraftButton = nodes(g.sessionActionView()).find(node => node.tag === 'button' && node.children.includes('SessionActionNewDraft'))
    expect(newDraftButton).toBeDefined(); expect(nodes(g.sessionActionView()).find(node => node.tag === 'textarea').props.disabled).toBe(true)
    newDraftButton.props.onClick()
    const fresh = g.sessionActionsRef.current[key], history = Object.values(g.sessionActionsRef.current).find((value: any) => value.history) as any
    expect(calls).toHaveLength(1); expect(minted()).toBe(2)
    expect(fresh).toMatchObject({ text: 'Original blocked text', operation: 'supplement', status: 'draft', pending: null, receipt: null })
    expect(fresh.digest).toBeUndefined(); expect(fresh.requestId).toBeUndefined(); expect(fresh.actionId).toBeUndefined()
    expect(history).toMatchObject({ history: true, status: 'blocked', pending: original.pending, receipt: original.receipt })
    expect(history.key).toContain(originalId)
    const retained = nodes(g.sessionActionView()).find(node => node.props?.key === history.key)
    expect(JSON.stringify(retained)).toContain(originalId); expect(nodes(retained).some(node => ['textarea', 'input', 'select', 'button'].includes(node.tag))).toBe(false)
    expect(nodes(g.sessionActionView()).find(node => node.tag === 'textarea').props.disabled).toBe(false)
    g.newSessionActionDraft(history.key); g.editSessionAction(history.key, 'text', 'cannot change history')
    expect(g.sessionActionsRef.current[history.key]).toBe(history)
    g.editSessionAction(key, 'text', 'New direct request'); await g.checkSessionAction(key)
    expect(calls).toHaveLength(2); expect(minted()).toBe(4)
    expect(calls[1].input).toMatchObject({ action: 'prepare', text: 'New direct request', operation: 'supplement' })
    expect(calls[1].input.actionId).not.toBe(originalId); expect(calls[1].input.requestId).not.toBe(original.pending.requestId)
    expect(g.sessionActionsRef.current[history.key]).toBe(history); expect(g.composerRef.current).toBe(draft)
    expect(initializer('newSessionActionDraft')).not.toMatch(/mintId|call\(|updateComposer/)
  })

  it.each(['unknown', 'recorded', 'dispatch_unknown', 'accepted', 'pending'])('never resets a %s action or exposes a new-draft bypass', async state => {
    const { g, edit, calls, minted } = harness(), key = edit()
    await g.checkSessionAction(key)
    const original = g.sessionActionsRef.current[key]
    g.saveSessionAction(key, { ...original, status: state, receipt: state === 'unknown' || state === 'pending' ? null : { ...original.receipt, state } })
    const saved = g.sessionActionsRef.current[key]
    expect(nodes(g.sessionActionView()).some(node => node.tag === 'button' && node.children.includes('SessionActionNewDraft'))).toBe(false)
    g.newSessionActionDraft(key)
    expect(g.sessionActionsRef.current[key]).toBe(saved); expect(calls).toHaveLength(1); expect(minted()).toBe(2)
  })

  it('does not create a draft from an old target, epoch, or contradictory blocked receipt', async () => {
    const { g, edit, calls } = harness(), key = edit(); await g.checkSessionAction(key)
    const original = g.sessionActionsRef.current[key]
    g.locateResultRef.current = located(row('other-target')); g.newSessionActionDraft(key)
    g.locateResultRef.current = located(); g.epochRef.current = 'new-epoch'; g.newSessionActionDraft(key)
    expect(g.sessionActionsRef.current[key]).toBe(original)
    g.epochRef.current = 'epoch-one'; g.saveSessionAction(key, { ...original, receipt: { ...original.receipt, accepted: true } })
    const invalid = g.sessionActionsRef.current[key]; g.newSessionActionDraft(key)
    expect(g.sessionActionsRef.current[key]).toBe(invalid); expect(calls).toHaveLength(1)
  })

  it.each([
    { status: 'clarify' }, { status: 'blocked' }, { coverage: 'partial' }, { controlAvailable: true },
    { executionReason: 'enabled' }, { coverage: undefined }, { revision: 'bad' }, { target: row('one', 'project-one', 'bad') }, { target: { ...row(), project: { kind: 'unknown', key: 'unknown' } } },
    { target: row('session-one', 'different-project') }, { target: row('session-one', 'project-one', 'f'.repeat(64)) },
  ])('offers no current editable target for unverified location %j', extra => {
    const { g } = harness(); g.locateResultRef.current = located(row(), scope, extra)
    expect(g.currentSessionAction()).toBeNull()
  })

  it.each([
    ['epoch', 'wrong'], ['requestId', 'wrong'], ['actionId', 'wrong'], ['operation', 'steer'],
    ['target.sessionId', 'wrong'], ['target.scopeRevision', 'd'.repeat(64)], ['target.factRevision', 'd'.repeat(64)], ['target.project.kind', 'unassigned'], ['target.project.key', 'wrong'],
    ['digest', 'd'.repeat(64)], ['messageId', 'wrong'], ['seq', 1], ['seq', 3], ['seq', 2.1], ['at', -1], ['updatedAt', 99],
    ['durable', false], ['accepted', true], ['executed', true], ['executed', null], ['completed', true], ['completed', null],
    ['state', 'success'], ['disposition', 'target-durable-receipt'], ['version', 2],
  ])('keeps a contradictory %s receipt unknown with original IDs and no retry', async (path, value) => {
    const { g, calls, edit } = harness(), key = edit()
    g.call = async (route: string, input: any) => {
      calls.push({ path: route, input }); const result: any = receipt(input), keys = String(path).split('.')
      let target = result; for (const key of keys.slice(0, -1)) target = target[key]
      target[keys.at(-1)!] = value; return result
    }
    await g.checkSessionAction(key); const saved = g.sessionActionsRef.current[key]
    expect(saved.status).toBe('unknown'); expect(saved.receipt).toBeUndefined(); expect(saved.pending.actionId).toBe(calls[0].input.actionId)
    await g.checkSessionAction(key); expect(calls).toHaveLength(1)
  })

  it('accepts an omitted optional version but rejects arbitrary, partial, missing-flag, or forged payloads', async () => {
    for (const result of [null, {}, { accepted: true }, [], 'ok']) {
      const { g, edit } = harness(), key = edit(); g.call = async () => result; await g.checkSessionAction(key)
      expect(g.sessionActionsRef.current[key].status).toBe('unknown')
    }
    for (const field of ['epoch', 'target', 'digest', 'seq', 'durable', 'accepted', 'executed', 'completed', 'disposition']) {
      const { g, edit } = harness(), key = edit(); g.call = async (_path: string, input: any) => { const result: any = receipt(input); delete result[field]; return result }; await g.checkSessionAction(key)
      expect(g.sessionActionsRef.current[key].status).toBe('unknown')
    }
    const { g, edit } = harness(), key = edit(); g.call = async (_path: string, input: any) => { const result: any = receipt(input); delete result.version; return result }; await g.checkSessionAction(key)
    expect(g.sessionActionsRef.current[key].status).toBe('blocked')
  })

  it('handles uncertain prepare and status 404 without resending, new IDs, input loss, or treating not-found as no-delivery proof', async () => {
    const { g, calls, edit, minted } = harness(), key = edit('Unknown original')
    g.call = async (path: string, input: any) => { calls.push({ path, input }); throw Object.assign(new Error('lost reply'), { status: input.action === 'status' ? 404 : undefined }) }
    await g.checkSessionAction(key); const original = g.sessionActionsRef.current[key].pending
    await g.checkSessionAction(key); await g.checkSessionAction(key, true); await g.checkSessionAction(key)
    expect(calls).toEqual([{ path: 'session-action', input: { action: 'prepare', ...original } }, { path: 'session-action', input: { action: 'status', epoch: original.epoch, actionId: original.actionId } }])
    expect(minted()).toBe(2); expect(g.sessionActionsRef.current[key]).toMatchObject({ status: 'unknown', pending: original, text: 'Unknown original', error: 'SessionActionNotFound' })
    const content = JSON.stringify(g.sessionActionView()), buttons = nodes(g.sessionActionView()).filter(node => node.tag === 'button')
    expect(content).toContain('SessionActionStatus'); expect(content).toContain('SessionActionClose')
    expect(buttons.map(node => node.children[0])).toEqual(['SessionActionCheck', 'SessionActionStatus', 'SessionActionClose'])
    expect(buttons.find(node => node.children.includes('SessionActionCheck')).props.disabled).toBe(true)
    expect(calls.map(value => value.input.action)).not.toContain('close')
  })

  it('closes only after an explicit click with the exact original payload, then requires a separate new-draft click and keeps closure history', async () => {
    const { g, calls, edit, minted } = harness(), key = edit('Original unknown request', 'steer')
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (input.action !== 'close') throw new Error('lost'); return closed(input) }
    await g.checkSessionAction(key); const original = g.sessionActionsRef.current[key].pending
    let closing: any; const closeAction = g.closeSessionAction
    g.closeSessionAction = (key: string) => { closing = closeAction(key); return closing }
    const closeButton = nodes(g.sessionActionView()).find(node => node.tag === 'button' && node.children.includes('SessionActionClose'))
    expect(closeButton).toBeDefined(); closeButton.props.onClick(); await closing
    expect(calls).toEqual([{ path: 'session-action', input: { action: 'prepare', ...original } }, { path: 'session-action', input: { action: 'close', ...original } }])
    const saved = g.sessionActionsRef.current[key]
    expect(saved).toMatchObject({ status: 'closed', closeRequested: true, pending: original, receipt: { state: 'closed', bindingVerified: false, durable: true, executed: null, completed: null } })
    expect(minted()).toBe(2); expect(nodes(g.sessionActionView()).find(node => node.tag === 'textarea').props.disabled).toBe(true)
    expect(JSON.stringify(g.sessionActionEvidence(saved))).not.toContain('undefined')
    expect(nodes(g.sessionActionView()).find(node => node.props?.role === 'status').children).toContain('SessionActionClosed')
    g.newSessionActionDraft(key)
    expect(g.sessionActionsRef.current[key]).toMatchObject({ text: 'Original unknown request', operation: 'steer', pending: null, receipt: null, status: 'draft' })
    const history = Object.values(g.sessionActionsRef.current).find((value: any) => value.history) as any
    expect(history.receipt.state).toBe('closed'); expect(history.pending).toBe(original)
    expect(calls).toHaveLength(2); expect(minted()).toBe(2)
    let focused = 0; nodes(g.sessionActionView()).find(node => node.tag === 'textarea').props.ref({ focus: () => focused++ })
    expect(focused).toBe(1); expect(g.sessionActionFocus.current).toBe('')
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return receipt(input) }
    await g.checkSessionAction(key)
    expect(calls).toHaveLength(3); expect(calls[2].input.actionId).not.toBe(original.actionId); expect(minted()).toBe(4)
  })

  it.each([
    ['epoch', 'other'], ['requestId', 'other'], ['actionId', 'other'], ['operation', 'steer'],
    ['target.sessionId', 'other'], ['target.scopeRevision', 'e'.repeat(64)], ['target.factRevision', 'e'.repeat(64)], ['target.project', { kind: 'project', key: 'project-one' }],
    ['digest', 'e'.repeat(64)], ['seq', 2], ['at', -1], ['updatedAt', 121], ['state', 'blocked'], ['bindingVerified', true], ['durable', false], ['accepted', true], ['executed', false], ['completed', false], ['disposition', 'not-dispatched'], ['code', 'other'], ['version', 2],
    ['messageId', 'go:invented'], ['controlRevision', grant], ['grantRevision', grant], ['extra', true],
  ])('rejects contradictory closure field %s and keeps the original action unresolved', async (path, value) => {
    const { g, edit, calls } = harness(), key = edit()
    g.call = async (route: string, input: any) => {
      calls.push({ path: route, input }); if (input.action === 'prepare') throw new Error('unknown')
      const result: any = closed(input), keys = String(path).split('.'); let target = result
      for (const key of keys.slice(0, -1)) target = target[key]
      target[keys.at(-1)!] = value; return result
    }
    await g.checkSessionAction(key); await g.closeSessionAction(key)
    expect(g.sessionActionsRef.current[key].status).toBe('unknown'); expect(g.sessionActionsRef.current[key].receipt).toBeUndefined()
    const original = g.sessionActionsRef.current[key]; g.newSessionActionDraft(key)
    expect(g.sessionActionsRef.current[key]).toBe(original)
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'close'])
  })

  it('rejects missing closure fields and unsolicited closed payloads without explicit closure intent', async () => {
    for (const field of Object.keys(closed({ epoch: 'e', requestId: 'r', actionId: 'a', operation: 'continue', text: 'x', target: { sessionId: 's', scopeRevision: scope, factRevision: fact } }))) {
      const { g, edit } = harness(), key = edit()
      g.call = async (_path: string, input: any) => { if (input.action === 'prepare') throw new Error('unknown'); const value: any = closed(input); delete value[field]; return value }
      await g.checkSessionAction(key); await g.closeSessionAction(key)
      expect(g.sessionActionsRef.current[key].status).toBe('unknown')
    }
    const { g, edit } = harness(), key = edit()
    g.call = async (_path: string, input: any) => closed(g.sessionActionsRef.current[key].pending)
    await g.checkSessionAction(key); await g.checkSessionAction(key, true)
    expect(g.sessionActionsRef.current[key].status).toBe('unknown'); expect(g.sessionActionsRef.current[key].closeRequested).toBeUndefined()
  })

  it('recovers a lost explicit close receipt through status only without another prepare or automatic closure retry', async () => {
    const { g, calls, edit } = harness(), key = edit()
    g.call = async (path: string, input: any) => { calls.push({ path, input }); if (input.action !== 'status') throw new Error('lost'); return closed(g.sessionActionsRef.current[key].pending) }
    await g.checkSessionAction(key); await g.closeSessionAction(key)
    expect(g.sessionActionsRef.current[key]).toMatchObject({ status: 'unknown', closeRequested: true, error: 'SessionActionCloseUnknown' })
    await g.checkSessionAction(key, true)
    expect(g.sessionActionsRef.current[key].status).toBe('closed')
    expect(calls.map(value => value.input.action)).toEqual(['prepare', 'close', 'status'])
  })

  it('does not accept closure over existing exact dispatch_unknown evidence and accepts only the original normal receipt from close', async () => {
    const { g, calls, edit } = harness(), key = edit()
    const normal = () => receipt(g.sessionActionsRef.current[key].pending, { state: 'dispatch_unknown', code: 'session_action_reconcile_required', executed: null, completed: null, disposition: 'reconcile-only', controlRevision: grant, grantRevision: grant })
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return normal() }
    await g.checkSessionAction(key); const prior = g.sessionActionsRef.current[key].receipt
    await g.closeSessionAction(key); expect(calls).toHaveLength(1)
    expect(nodes(g.sessionActionView()).some(node => node.tag === 'button' && node.children.includes('SessionActionClose'))).toBe(false)
    g.saveSessionAction(key, { ...g.sessionActionsRef.current[key], status: 'unknown' })
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return closed(input) }
    await g.closeSessionAction(key)
    expect(g.sessionActionsRef.current[key]).toMatchObject({ status: 'unknown', receipt: prior })
    g.call = async (path: string, input: any) => { calls.push({ path, input }); return normal() }
    await g.closeSessionAction(key)
    expect(g.sessionActionsRef.current[key]).toMatchObject({ status: 'dispatch_unknown', receipt: prior })
    expect(nodes(g.sessionActionView()).some(node => node.tag === 'button' && node.children.includes('SessionActionNewDraft'))).toBe(false)
  })

  it('keeps old-epoch unknown recovery unavailable and fences new actions, with no cross-epoch close request', async () => {
    const { g, edit, calls } = harness(), key = edit()
    g.call = async (path: string, input: any) => { calls.push({ path, input }); throw new Error('unknown') }
    await g.checkSessionAction(key); g.epochRef.current = 'epoch-two'
    g.locateResultRef.current = located(row('new-target')); const newer = edit('New target')
    await g.closeSessionAction(key); await g.checkSessionAction(newer)
    expect(calls).toHaveLength(1)
    const evidence = g.sessionActionEvidence(g.sessionActionsRef.current[key])
    expect(JSON.stringify(evidence)).toContain('SessionActionOldUnknown')
    expect(nodes(evidence).some(node => node.tag === 'button' && node.children.includes('SessionActionClose'))).toBe(false)
    expect(nodes(g.sessionActionView()).find(node => node.tag === 'button' && node.children.includes('SessionActionCheck')).props.disabled).toBe(true)
  })

  it('keeps the check button present and disabled while pending, with a persistent visible status contract', async () => {
    const { g, edit } = harness(), key = edit(); let resolve: any, start: any
    const requested = new Promise<void>(yes => { start = yes })
    g.call = (_path: string, input: any) => { start(); return new Promise(yes => { resolve = () => yes(receipt(input)) }) }
    const running = g.checkSessionAction(key); await requested
    let elements = nodes(g.sessionActionView())
    expect(elements.find(node => node.tag === 'button' && node.children.includes('SessionActionCheck')).props.disabled).toBe(true)
    expect(elements.find(node => node.props?.role === 'status').children).toContain('SessionActionPending')
    resolve(); await running
    elements = nodes(g.sessionActionView())
    expect(elements.find(node => node.tag === 'button' && node.children.includes('SessionActionCheck')).props.disabled).toBe(true)
    expect(elements.find(node => node.props?.role === 'status').children).toContain('SessionActionBlocked')
    expect(initializer('sessionActionView')).toContain("role: 'status'")
    g.newSessionActionDraft(key)
    let focused = 0; nodes(g.sessionActionView()).find(node => node.tag === 'textarea').props.ref({ focus: () => focused++ }); expect(focused).toBe(1)
  })

  it('does not bypass an unresolved original action by switching target or epoch', async () => {
    const { g, edit, calls, minted } = harness(), original = edit()
    g.call = async (path: string, input: any) => { calls.push({ path, input }); throw new Error('unknown') }
    await g.checkSessionAction(original)
    g.locateResultRef.current = located(row('new-target')); const other = edit('Another target')
    await g.checkSessionAction(other); g.epochRef.current = 'new-epoch'; const newer = edit('New epoch')
    await g.checkSessionAction(newer); await g.checkSessionAction(original, true)
    expect(calls).toHaveLength(1); expect(minted()).toBe(2); expect(g.sessionActionsRef.current[other].text).toBe('Another target')
  })

  it.each(['blocked', 'unknown'])('retains a late %s result under the original target without covering the new target or epoch', async outcome => {
    const { g, calls, edit, draft } = harness(), old = edit('Original action')
    let resolve: any, reject: any, sent: any, started: any
    const requested = new Promise<void>(yes => { started = yes })
    g.call = (path: string, input: any) => { calls.push({ path, input }); sent = input; started(); return new Promise((yes, no) => { resolve = yes; reject = no }) }
    const pending = g.checkSessionAction(old)
    await requested
    g.resetLocate(); g.epochRef.current = 'new-epoch'; g.locateResultRef.current = located(row('new-target')); const newer = edit('New target draft')
    const untouched = g.sessionActionsRef.current[newer]
    if (outcome === 'blocked') resolve(receipt(sent)); else reject(new Error('reply lost'))
    await pending
    expect(g.sessionActionsRef.current[old]).toMatchObject({ epoch: 'epoch-one', text: 'Original action', status: outcome, pending: { actionId: sent.actionId } })
    expect(g.sessionActionsRef.current[newer]).toBe(untouched); expect(g.currentSessionAction().key).toBe(newer); expect(g.composerRef.current).toBe(draft)
    expect(JSON.stringify(g.sessionActionView())).toContain('SessionActionOldEpoch'); expect(calls).toHaveLength(1)
  })

  it('fences navigation during digest preparation before making a Host request', async () => {
    const { g, edit, calls } = harness(), key = edit(); let resolve: any
    g.sessionActionDigest = () => new Promise(yes => { resolve = yes })
    const pending = g.checkSessionAction(key); g.resetLocate(); g.systemRef.current = 'settings'; resolve('d'.repeat(64)); await pending
    expect(calls).toEqual([]); expect(g.sessionActionsRef.current[key]).toMatchObject({ pending: null, status: 'draft' })
  })

  it('uses status only to reconcile exact recorded and dispatch_unknown evidence, with null execution facts for uncertain delivery', async () => {
    for (const state of ['recorded', 'dispatch_unknown']) {
      const { g, edit, calls, minted } = harness(), key = edit()
      g.call = async (path: string, input: any) => {
        calls.push({ path, input })
        const pending = g.sessionActionsRef.current[key].pending
        if (input.action === 'prepare') return receipt(pending, state === 'recorded' ? { state, seq: 1, code: undefined } : { state, code: 'session_action_reconcile_required', executed: null, completed: null, disposition: 'reconcile-only', controlRevision: grant, grantRevision: grant })
        return receipt(pending, state === 'recorded' ? {} : { state: 'accepted', seq: 3, code: undefined, accepted: true, executed: null, completed: null, disposition: 'target-durable-receipt', controlRevision: grant, grantRevision: grant, updatedAt: 102 })
      }
      await g.checkSessionAction(key); expect(g.sessionActionsRef.current[key].status).toBe(state)
      await g.checkSessionAction(key, true)
      expect(calls.map(value => value.input.action)).toEqual(['prepare', 'status']); expect(minted()).toBe(2)
      expect(g.sessionActionsRef.current[key].status).toBe(state === 'recorded' ? 'blocked' : 'accepted')
      const content = JSON.stringify(g.sessionActionEvidence(g.sessionActionsRef.current[key]))
      expect(content).toContain(state === 'recorded' ? 'SessionActionBlocked' : 'SessionActionAccepted')
      if (state === 'dispatch_unknown') expect(content).toContain('true / true / Unknown / Unknown')
    }
  })

  it('rejects status rollback, same-sequence contradiction, changing original time, and false certainty for unknown delivery', async () => {
    const changes = [{ seq: 1 }, { updatedAt: 102 }, { at: 99 }, { executed: false, completed: false }, { state: 'accepted', seq: 3, accepted: false }]
    for (const change of changes) {
      const { g, edit } = harness(), key = edit()
      g.call = async (_path: string, input: any) => receipt(g.sessionActionsRef.current[key].pending, { state: 'dispatch_unknown', executed: null, completed: null, disposition: 'reconcile-only', controlRevision: grant, grantRevision: grant, ...(input.action === 'status' ? change : {}) })
      await g.checkSessionAction(key); const previous = g.sessionActionsRef.current[key].receipt
      await g.checkSessionAction(key, true)
      expect(g.sessionActionsRef.current[key].status).toBe('unknown'); expect(g.sessionActionsRef.current[key].receipt).toBe(previous)
    }
  })

  it('renders a separate progressive text check, only current target editable, literal evidence, no send/stop/approval or Enter-to-send', async () => {
    const { g, edit } = harness(), malicious = '<img src=x onerror=execute()>', key = edit(malicious)
    const view = g.sessionActionView(), elements = nodes(view), textarea = elements.find(node => node.tag === 'textarea')
    expect(elements.some(node => node.tag === 'details' && nodes(node).some(child => child.tag === 'summary' && child.children.includes('SessionActionTitle')))).toBe(true)
    expect(textarea.props.value).toBe(malicious); expect(textarea.props.onKeyDown).toBeUndefined()
    expect(elements.some(node => ['form', 'img'].includes(node.tag) || node.props?.dangerouslySetInnerHTML)).toBe(false)
    expect(elements.filter(node => node.tag === 'button').map(node => node.children[0])).toEqual(['SessionActionCheck'])
    expect(elements.filter(node => node.tag === 'option').map(node => node.props.value)).toEqual(['continue', 'supplement', 'steer'])
    g.locateResultRef.current = located(row('other')); edit('Other target')
    const other = g.sessionActionView(), oldEvidence = nodes(other).find(node => node.tag === 'details' && node.props?.key === key)
    expect(JSON.stringify(oldEvidence)).toContain(malicious); expect(nodes(oldEvidence).some(node => ['textarea', 'input', 'select'].includes(node.tag))).toBe(false)
    expect(JSON.stringify(other)).toContain('SessionActionRetained')
    for (const name of ['editSessionAction', 'checkSessionAction', 'saveSessionAction', 'sessionActionView']) expect(initializer(name)).not.toMatch(/updateComposer|composerRef|command-status|call\('command'/)
    expect(source).toContain("system === 'locate' ? locateView(sessionActionView, imageLocateEntry) : imageDraftView()")
    expect(source).toContain("className: 'saw-chat-context'")
    expect(source).toContain("if (system === 'locate' || system === 'images') return null")
  })

  it('guards composition-triggered action and Escape locally without changing global shell behavior', async () => {
    const { g, edit, calls } = harness(); edit()
    const view = g.sessionActionView(), textarea = nodes(view).find(node => node.tag === 'textarea'), action = nodes(view).find(node => node.tag === 'button')
    textarea.props.onCompositionStart(); action.props.onClick(); await Promise.resolve(); expect(calls).toEqual([])
    let stopped = 0
    view.props.onKeyDown({ key: 'Escape', stopPropagation: () => stopped++ }); expect(stopped).toBe(1)
    textarea.props.onCompositionEnd(); view.props.onKeyDown({ key: 'Escape', stopPropagation: () => stopped++ }); expect(stopped).toBe(1)
    view.props.onKeyDown({ key: 'Escape', nativeEvent: { keyCode: 229 }, stopPropagation: () => stopped++ }); expect(stopped).toBe(2)
    expect(source).toContain("e.key === 'Escape' && !confirmation")
  })

  it('validates text byte limits/NUL before requesting and supplies matching bilingual boundaries', async () => {
    const { g, calls, edit } = harness()
    for (const text of ['abc\0def', '界'.repeat(6000)]) { const key = edit(text); await g.checkSessionAction(key); expect(g.sessionActionsRef.current[key].error).toBe('TextLimit') }
    expect(calls).toEqual([])
    const languages = ['zh', 'en'].map(language => JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).panel)
    const keys = Object.keys(languages[0]).filter(key => key.startsWith('wSessionAction'))
    expect(keys.length).toBeGreaterThan(20)
    for (const key of keys) for (const locale of languages) expect(locale[key]).toBeTruthy()
    expect(languages[0].wSessionActionBoundary).toContain('不代表 R1 已完成'); expect(languages[1].wSessionActionBoundary).toContain('does not complete R1')
    expect(languages[0].wSessionActionNotFound).toContain('不证明'); expect(languages[1].wSessionActionNotFound).toContain('does not prove')
  })
})
