import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const index = readFileSync('src/client/index.ts', 'utf8')
const workspace = readFileSync('src/client/workspace.ts', 'utf8')
const styles = readFileSync('src/client/workspace-style.ts', 'utf8')
const en = JSON.parse(readFileSync('locale/en.json', 'utf8')).panel as Record<string, string>
const zh = JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel as Record<string, string>
const parse = (name: string, content: string) => ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const entryTree = parse('index.ts', index)
const tree = parse('workspace.ts', workspace)
const walk = (node: ts.Node, visit: (node: ts.Node) => void) => { visit(node); node.forEachChild(child => walk(child, visit)) }
const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node
const variable = (name: string) => {
  const matches: ts.Expression[] = []
  walk(tree, node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) matches.push(node.initializer) })
  expect(matches, name).toHaveLength(1)
  return matches[0]!
}
const section = (name: string) => variable(name).getText(tree)
const contains = (content: string, seams: string[]) => { for (const seam of seams) expect(content, seam).toContain(seam) }

// Resolve only expressions that actually feed a translation function. Do not
// turn all source strings (CSS classes, routes, ids, intent values) into keys.
const literalChoices = (expression: ts.Expression): string[] => {
  const node = unwrap(expression)
  if (ts.isStringLiteralLike(node)) return [node.text]
  if (ts.isConditionalExpression(node)) return [...literalChoices(node.whenTrue), ...literalChoices(node.whenFalse)]
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return [...literalChoices(node.left), ...literalChoices(node.right)]
  if (ts.isElementAccessExpression(node)) {
    const object = unwrap(node.expression)
    if (ts.isObjectLiteralExpression(object)) return object.properties.flatMap(property => ts.isPropertyAssignment(property) ? literalChoices(property.initializer) : [])
  }
  return []
}
const translationKeys = () => {
  const keys = new Set<string>()
  for (const [syntax, fn, prefix] of [[entryTree, 't', ''], [tree, 'tr', 'w']] as const) {
    walk(syntax, node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === fn && node.arguments[0]) {
        for (const key of literalChoices(node.arguments[0])) keys.add(prefix + key)
      }
    })
  }
  // stateName delegates through names; label and settings groups do likewise.
  // Enumerate these semantic dictionaries, not unrelated object/string values.
  for (const name of ['names', 'fieldNames', 'groupNames']) {
    const object = unwrap(variable(name))
    expect(ts.isObjectLiteralExpression(object), name).toBe(true)
    if (ts.isObjectLiteralExpression(object)) for (const property of object.properties) {
      if (ts.isPropertyAssignment(property)) for (const key of literalChoices(property.initializer)) keys.add(`w${key}`)
    }
  }
  walk(tree, node => {
    if (!ts.isCallExpression(node) || !node.arguments[0]) return
    // fields([[label, value], ...]) calls tr(label) internally.
    const isFields = ts.isIdentifier(node.expression) && node.expression.text === 'fields'
    // The health drawer maps [[label, value], ...] directly through tr(key).
    const isTranslatedTupleMap = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && /\btr\(key\)/.test(node.arguments[0].getText(tree))
    const rows = isFields ? unwrap(node.arguments[0]) : isTranslatedTupleMap && ts.isPropertyAccessExpression(node.expression) ? unwrap(node.expression.expression) : undefined
    if (rows && ts.isArrayLiteralExpression(rows)) for (const entry of rows.elements) {
      if (ts.isArrayLiteralExpression(entry) && entry.elements[0] && ts.isStringLiteralLike(entry.elements[0])) keys.add(`w${entry.elements[0].text}`)
    }
  })
  return keys
}

// Source wiring and safety contracts only. No DOM/React emulation, screenshots,
// visual acceptance, or proof of backend authorization/execution is claimed.
describe('KANBAN-WORKSPACE-DESIGN v1 source contracts (not visual proof)', () => {
  it('uses one Workspace main panel instead of the superseded seven-page top navigation', () => {
    contains(index, ["import { createWorkspacePage } from './workspace.js'", "import { workspaceStyles } from './workspace-style.js'", 'workspaceFactory = createWorkspacePage', 'styleFactory = workspaceStyles', 'workspaceFactory(React, request, t, styleFactory(), deskFactory)', "name: 'main', key: 'superagent'", '}, Page)'])
    expect(index).not.toMatch(/\bconst pages\b|\bsetPage\b|\bselected\b|h\(['"]nav['"]|sa-tabs/)
    expect([...index.matchAll(/name:\s*['"]main['"]/g)]).toHaveLength(1)
    contains(workspace, ["['pending', 'running', 'waiting', 'ended']", "tr('Workspace')", "tr('DeskTitle')", "tr('Board')", 'saw-workspace'])
  })

  it('wires workspace commands, receipts, admission, conversation, and board without arbitrary actor/session targeting', () => {
    const routes = new Set<string>()
    walk(tree, node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'call' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) routes.add(node.arguments[0].text)
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const key = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : ''
        expect(key).not.toMatch(/^(?:sessionId|sessionID|mainSessionId|actor|workerId|threadKey|assignmentId|agentOptions)$/)
      }
    })
    for (const route of ['workspace', 'conversation', 'command', 'command-status', 'board', 'ticket']) expect(routes.has(route), route).toBe(true)
    contains(section('perform'), ["value.kind === 'admission' ? 'admission'", "value.kind === 'approval' ? 'approval' : 'ticket-action'", 'epoch: value.epoch', 'requestId: value.item.requestId', 'planId: value.item.planId', 'fingerprint: value.item.fingerprint', 'decision: value.decision'])
    contains(index, ["credentials: 'same-origin'", 'new URL(`/api/superagent/', "response.status === 401 ? t('webAuthRequired')", "error.code = response.status === 401 ? 'web_auth_required'", "signal?.removeEventListener('abort', abort)", 'if (signal?.aborted) timeout.abort()'])
    expect(index).not.toMatch(/new Error\(value\?\.(?:message|error)/)
  })

  it('retains epoch-scoped immutable request recovery and same-request retries', () => {
    contains(section('storageKey'), ['superagent.workspace.v1:', 'encodeURIComponent(epoch)'])
    contains(section('readComposer'), ['sessionStorage.getItem', 'pending.epoch === epoch', "typeof pending.requestId === 'string'", 'pending: validPending ? pending : null'])
    const submit = section('submit')
    contains(submit, ['const existing = saved.pending', 'const epoch = existing?.epoch || draftEpochRef.current', 'if (!existing && epoch !== epochRef.current) return', 'requestId: mintId()', "saved.target ? 'ticket-input' : saved.intent", "call('command-status', { epoch, requestId: payload.requestId }", "e?.code !== 'command_not_found'", 'requestId: payload.requestId', 'text: payload.text', "call('command', exact, controller)", 'epochRef.current !== epoch', 'historyRef.current !== epoch', 'new TextEncoder().encode(saved.draft).length > 16384'])
    expect(submit.match(/mintId\(\)/g)).toHaveLength(1)
    contains(section('applyReceipt'), ['current.pending?.requestId === payload.requestId', "matches && (receipt.accepted === true || ['canceled', 'rejected'].includes(receipt.stage))", "receipt.accepted === true && current.draft === payload.text ? { draft: '', origin: null }"])
    contains(workspace, ['sendController.current?.abort()', "setNotice(tr('EpochChanged'))", 'const oldDraft = !!draftEpoch && draftEpoch !== workspace?.epoch', 'disabled: sending || !!pendingRequest || archive || oldDraft || !workspace', 'disabled: sending || archive || oldDraft || !composer.draft.trim()', "button(tr('CheckStatus'), () => { void submit(true) }", "button(tr('RetrySameRequest'), () => { void submit(false) }", 'pendingRequest.epoch !== workspace?.epoch || archive', 'e.nativeEvent?.isComposing', 'e.isComposing', 'e.nativeEvent?.keyCode === 229', 'e.keyCode === 229', "e.key !== 'Enter' || e.shiftKey"])
  })

  it('never treats one status 404 as proof that an in-flight command can be replaced with a new request id', () => {
    const submit = section('submit')
    contains(submit, ["if (!payload) payload = { epoch, requestId: mintId()", "updateComposer({ pending: payload, receipt: { stage: 'not-found', accepted: false } }, epoch)", "if (checkOnly) { setNotice(tr('NotFoundNotice')); return }", "const exact = { epoch: payload.epoch, requestId: payload.requestId", "call('command', exact, controller)"])
    expect(submit).not.toMatch(/pending:\s*null|requestId:\s*(?:crypto\.|globalThis\.)/)
    expect(workspace).not.toMatch(/notFoundConfirmed|tr\(['"]EditUnsentDraft['"]\)|updateComposer\(\{\s*pending:\s*null/)
  })

  it('changes the input target only through explicit supplement/cancel controls, never opening a card', () => {
    const open = section('openDetail')
    contains(open, ['setDetailId(item.id)', 'readDetail(item.id)'])
    expect(open).not.toMatch(/updateComposer|saveComposer|target\s*:|supplement\(/)
    contains(section('supplement'), ['composerRef.current.pending', 'draftEpochRef.current !== epochRef.current', 'updateComposer({ target: { id: item.id', "setMobileTab('chat')", 'inputRef.current?.focus()'])
    contains(workspace, ["className: 'saw-chip'", "tr('SupplementTo')", 'composer.target.title', "button('×', () => updateComposer({ target: null })", "'aria-label': tr('CancelTarget')", "button(tr('Supplement'), () => supplement(card)", "button(tr('Supplement'), () => supplement(item)"])
  })

  it('reads stable conversation cursors, merges by id/seq, and preserves visible history on cursor errors', () => {
    contains(section('merge'), ['new Map(old.map(item => [String(item.id), item]))', 'rows.set(String(item.id)', '[...rows.values()].sort(order)'])
    contains(section('messageOrder'), ['Number(a.seq) - Number(b.seq)', 'String(a.id).localeCompare(String(b.id))'])
    contains(section('readConversation'), ["call('conversation', { epoch, limit: 30", "mode === 'before' ? { before }", '{ after: current.nextAfter }', 'i < 4', "['invalid_cursor', 'epoch_mismatch']", 'nextAfter: undefined'])
    contains(section('setConversationPage'), ['merge(old.items, array(page.items), messageOrder)', 'nextAfter: page.nextAfter', 'nextBefore: page.nextBefore', 'hasMore: page.hasMore'])
    contains(workspace, ["e?.code === 'web_auth_required' ? tr('WebAuthRequired')", 'workspace?.archiveEpochs', 'currentMessages.nextBefore', 'readConversation(historyEpoch, currentMessages.nextBefore)', 'anchor.top + node.scrollHeight - anchor.height', 'tr(\'ArchiveReadonly\')', 'message.text'])
    expect(section('readConversation')).not.toMatch(/setConversation\(\s*\{\s*\}\s*\)|conversations\.current\s*=\s*\{\s*\}/)
  })

  it('defaults to ledger tasks and decisions, keeping raw history and technical receipts behind explicit controls', () => {
    contains(workspace, ["React.useState('briefing')", 'setActivityView(view)', "activityView === 'briefing' ? briefingView()", "tr('DeskTitle')", "'BackToDesk' : 'HistoryShort'", "React.useState('chat')"])
    expect(workspace).not.toMatch(/saw-activity-tabs|tr\('BriefingVersion'\)|tr\('BriefingScope'\)|tr\('BriefingRecordHint'\)|tr\('NoStructuredDecisions'\)/)
    contains(section('briefingView'), ['desk.actions.map(decisionView)', 'desk.records.map(recordView)', 'desk.moreActions', 'desk.moreRecords', 'desk.ready && desk.actionTotal === 0 && !error && !newReplies', '(desk.actionTotal ?? 0) > 0', "tr(desk.idle ? 'ReadyForTask' : 'NothingToDecide')", "tr('StartPlanning')", "tr('PlanningSteps')", "tr('RecordsStale')"])
    expect(section('briefingView')).not.toMatch(/currentMessages|message\.text|askConfirm\(/)
    contains(section('decisionView'), ["entry.kind === 'plan'", 'openPlan(data)', "entry.kind === 'approval' ? 'approvals' : 'overview'", "'ReadAndAnswer'", "'ReviewPlan'"])
    expect(section('decisionView')).not.toMatch(/askConfirm|call\(/)
    contains(workspace, ['reviewingPlan ? admissionView(reviewingPlan)', "className: 'saw-inspector'", "rows: 2", "composer.intent === 'new-task' ? 'GeneratePlan' : 'Send'", "tr('PlanMode')", "tr('AskMode')", "workerExecution === false ? 'PlanningOnly' : 'ExecutionUnknown'"])
    contains(section('showAllTasks'), ["changeFilter('', '')", "setMobileTab('board')"])
    contains(section('desk'), ['deskState(workspace, Date.now(), !!error)'])
    contains(section('chooseActivity'), ["view === 'briefing'", 'historyRef.current = epochRef.current', 'setHistoryEpoch(epochRef.current)', 'readConversation(epochRef.current)'])
    expect(section('chooseActivity')).not.toMatch(/updateComposer|saveComposer|target:|setNewReplies/)
    contains(section('setConversationPage'), ['page.latestAssistant', 'Number.isSafeInteger(next.latestAssistant?.lastSeq)', 'replyReadThrough.current[epoch]', '!replyBaselineReady.current[epoch]', 'sessionStorage.getItem', 'readThrough = replySeq'])
    contains(section('readLatestReply'), ['replyReadThrough.current[epoch] = reply.lastSeq', 'sessionStorage.setItem', 'setNewReplies(0)'])
    contains(section('replyToCoordinator'), ['composerRef.current.pending', 'composerRef.current.target', 'composerRef.current.draft.trim()', "intent: 'message'"])
    contains(workspace, ['latestAssistant.text', "className: 'saw-message-technical'", "h('summary', null, tr('TechnicalDetails'))", "activityViewRef.current === 'history' && autoScroll.current"])
    contains(workspace, ['await readConversation(epoch)', 'if (historyRef.current && historyRef.current !== epoch) await readConversation(historyRef.current)', 'inspectorOpener.current.focus()', 'inspectorReturnToInput.current', '!inputRef.current.disabled', 'historyButtonRef.current?.focus()', "`${collapsed ? '›' : '‹'}${newReplies ? ' •' : ''}`"])
    contains(section('recordView'), ['record.anomaly', 'record.disabledReason', 'stateName(result ? record.outcome : record.state)', "result ? 'results' : 'overview'"])
    contains(styles, ['.saw-head-actions', '.saw-compose-footer', 'height:76px;min-height:60px', '@media(max-height:650px)', '.saw-messages{flex:1;min-height:0;', '.saw-inspector-scroll{flex:1;min-height:0;overflow:auto'])
  })

  it('keeps per-column cursors, server totals, and revision checks when paging beyond 100 cards', () => {
    const refresh = section('readBoard')
    contains(refresh, ['for (const column of columns)', 'loaded.current[column]', 'while (page?.hasMore && page.cursor && items.length < target)', 'cursor: page.cursor', 'limit: Math.min(100, Math.max(1, target - items.length))', 'more.revision !== fresh.revision', "conflict.code = 'board_resync_required'", 'items = merge(items', 'nextColumns[column] = { ...page, items }'])
    const more = section('loadMoreBoard')
    contains(more, ['!page?.hasMore || !page.cursor', "call('board', { ...filter, column, cursor: page.cursor, limit: 20 })", 'data.revision !== old.revision', 'merge(array(page.items), array(more.items)', 'loaded.current[column] = items.length'])
    expect(refresh + more).not.toMatch(/\.slice\(0,\s*100\)|Math\.min\(100,\s*(?:Number\()?loaded/)
    contains(workspace, ["'aria-label': tr(boardScopeKnown ? 'ServerTotal' : 'ServerTotalUnknownScope')", "page ? page.total : '—'", "tr('FilteredCounts') : tr('AllCounts')", 'board?.snapshotAt', 'page?.hasMore ? button', 'void loadMoreBoard(column)'])
  })

  it('makes the missing cross-conversation coverage visible without fabricating tasks or hiding it in diagnostics', () => {
    contains(section('boardScopeKnown'), ["board?.scope?.kind === 'superagent-ledger'", "board.scope.otherSessions === 'not-included'"])
    // Execute the actual coverage predicate without rendering or emulating a DOM.
    const recognizes = new Function('board', `return (${section('boardScopeKnown')})`) as (board: unknown) => boolean
    for (const old of [undefined, null, {}, { columns: {} }, { scope: { kind: 'all-sessions', otherSessions: 'not-included' } }, { scope: { kind: 'superagent-ledger' } }]) expect(recognizes(old)).toBe(false)
    expect(recognizes({ scope: { kind: 'superagent-ledger', otherSessions: 'not-included' } })).toBe(true)
    const top = workspace.slice(workspace.indexOf("h('header', { className: 'saw-top' }"), workspace.indexOf("h('details', { className: 'saw-boundary' }"))
    expect(top).toContain("className: 'saw-coverage'") // not hidden with the mobile board
    contains(workspace, ["className: 'saw-coverage'", "tr(boardScopeKnown ? 'OtherSessionsNotIncluded' : 'BoardScopeUnknown')", "!boardScopeKnown ? tr('CountsScopeUnknown')", "!boardScopeKnown ? 'CoveragePendingHint' : desk.idle ? 'DescribeOutcome' : 'ProgressOnBoard'", "!boardScopeKnown ? 'EmptyColumnUnknownScope'", "board?.filtered ? 'EmptyFilteredColumn' : 'EmptyColumn'", "'NoLoadedTasks'"])
    expect(section('briefingView')).not.toContain('text(desk.recordTotal)') // plans are not Ticket counts
    expect(zh.wAllCounts).toBe('超管已登记任务')
    expect(zh.wFilteredCounts).toContain('已登记任务')
    expect(zh.wOtherSessionsNotIncluded).toBe('未汇总其他会话')
    expect(zh.wDescribeOutcome).toContain('其他会话尚未汇总')
    expect(zh.wNothingToDecide).toContain('已登记任务')
    expect(en.wAllCounts).toBe('Coordinator-registered tasks')
    expect(en.wOtherSessionsNotIncluded).toBe('Other conversations not included')
    expect(en.wEmptyFilteredColumn).toContain('filter')
  })

  it('uses ticket-scoped timelineCursor and complete report/delivery projections rather than a recent global slice', () => {
    const detail = section('readDetail')
    contains(detail, ["call('ticket', { id, limit: 30", '{ timelineCursor: old.timelineCursor }', 'merge(array(old.timeline), array(first.timeline), timelineOrder)', "call('ticket', { id, timelineCursor: cursor, limit: 100 })", 'cursor = page.timelineCursor', 'timelineCursor: cursor'])
    contains(workspace, ['array(detail.timeline).map', "detail.timelineCursor ? button(tr('OlderEvents')", 'readDetail(detailId, true)', 'briefView(detail.brief)', 'array(detail.assignments).map', 'valueView(assignment.report)', 'valueView(detail.delivery)', "tr('NoReadAck')"])
    expect(detail).not.toMatch(/call\(['"](?:overview|health)['"]|\.slice\(/)
  })

  it('shows full impact details/reason/fingerprint and requires reviewable scope plus explicit reasons for decisions', () => {
    contains(section('approvalView'), ["item.state === 'pending'", 'item.expiresAt <= Date.now()', 'item.allowed?.approve === true', 'item.impact?.reviewable === true', '!!item.fingerprint', 'valueView(item.impact?.details)', 'item.impact?.description', 'item.impact?.reason', 'text(item.fingerprint)', 'item.reason', 'item.decidedBy', 'item.decidedAt', '!canApprove', 'item.allowed?.deny !== true'])
    expect(section('approvalView')).not.toMatch(/\.slice\(|\.substring\(/)
    contains(section('completeBrief'), ["typeof brief.goal === 'string'", "typeof brief.scope?.repo === 'string'", 'Array.isArray(brief.scope?.subdirs)', "['allowWrite', 'denyWrite', 'acceptance', 'blockers', 'outOfScope']", "!JSON.stringify(brief).includes('[REDACTED')"])
    contains(section('admissionView'), ['briefView(plan.brief)', '!completeBrief(plan)', 'plan.expiresAt <= Date.now()', '!plan.fingerprint', 'plan.epoch !== epochRef.current'])
    contains(section('perform'), ["!['admission', 'revision', 'request'].includes(value.kind) && !reason.trim()", 'value.epoch !== epochRef.current', '!completeBrief(value.item)', 'fingerprint: value.item.fingerprint', 'reason: reason.trim()', "e?.status === 409 ? tr('DecisionConflict')", 'poke.current()'])
    contains(workspace, ['valueView(confirmation.item.impact?.details)', "tr('ReasonRequired')", 'required: true', "'aria-required': true", 'dialogRef.current.showModal()', 'confirmationFocus.current.focus()'])
  })

  it('loads every plan page and exposes explicit non-executing revisions with lossless owner-relative scope labels', () => {
    contains(workspace, ['while (planCursor)', "call('workspace', { cursor: planCursor, limit: 100 })", 'planCursors.has(planCursor)', 'page.epoch !== data.epoch', 'new Map(plans.map(plan => [plan.planId, plan]))'])
    contains(section('admissionView'), ["scopeIdentity === 'host-owner-home-relative'", "tr('HomeRelativeScope')", "askConfirm('revision', plan, 'revise')"])
    contains(section('perform'), ["value.kind === 'revision' ? 'admission-revise'", 'requestId: value.item.requestId', 'fingerprint: value.item.fingerprint', 'patch: { goal: revisionGoal.trim(), firstAction: revisionFirstAction.trim() }'])
    contains(workspace, ["tr('RevisionHint')", 'setRevisionGoal(e.target.value)', 'setRevisionFirstAction(e.target.value)'])
  })

  it('separates canceling uncertain routing from task stop and recreates stopped work only as an explicit new draft', () => {
    contains(section('perform'), ["value.kind === 'request' ? 'command-cancel'", 'requestId: value.item.payload.requestId, seq: value.item.seq', "if (value.kind === 'request') applyReceipt(value.epoch, value.item.payload, result)"])
    contains(workspace, ["latest?.stage === 'unknown' && latest.accepted === false", "tr('CancelUnknownHint')", "askConfirm('request', { payload: pendingRequest, seq: latest.seq }, 'cancel')"])
    const recreate = section('recreate')
    contains(recreate, ['composerRef.current.draft.trim()', "item.state !== 'ended' || item.stoppedByHuman !== true", "intent: 'new-task', target: null, origin: { id: item.id", "tr('ResolveDraftFirst')"])
    expect(recreate).not.toMatch(/call\(|submit\(/)
    contains(section('submit'), ['recreateFrom: saved.origin.id', 'recreateFrom: payload.recreateFrom'])
    contains(workspace, ["button(tr('RecreateTask'), () => recreate(item)", "fields([['RecreatedFrom', text(item.originTicket)]])"])
  })

  it('always presents the production boundary, never synthesizes Worker execution or task success', () => {
    contains(workspace, ["h('details', { className: 'saw-boundary' }", "workerExecution === false ? 'PlanningOnly' : 'ExecutionUnknown'", "tr('BoundaryBody')", 'workspace?.model?.available === false', 'workspace.capabilities?.send !== true', "tr('ModelUnavailable')", "tr('SendUnavailable')", "tr('StaleData')", 'card.lastProgressAt', 'card.budget?.steps', 'card.budget?.usage', 'card.acceptance.passed', "tr('Stopping')", "tr('Unknown')"])
    expect(index + workspace).not.toMatch(/new Worker\s*\(|\b(?:mock|fake|demo|sample)(?:Tasks|Tickets|Workers|Messages|Data)\b|Math\.random\s*\(|setBoard\(\s*\{\s*columns|setWorkspace\(\s*\{/i)
    const perform = section('perform')
    contains(perform, ["value.kind === 'stop' && result.state === 'ended'", "result.state === 'ended' ? tr('StoppedNotice') : tr('Stopping')"])
    const failedAction = perform.slice(perform.indexOf('} catch (e: any)'))
    contains(failedAction, ["if (value.kind === 'stop') setStopping", 'delete next[value.item.id]', 'setActionError(', 'messageOf(e)', 'poke.current()'])
    expect(failedAction).not.toMatch(/status\s*>=\s*400|setNotice\(tr\(['"]StoppedNotice['"]\)/)
    contains(workspace, ['alive.current = false; clearTimeout(timer)', "document.removeEventListener('visibilitychange', visible)", 'for (const controller of controllers.current) controller.abort()'])
  })

  it('renders untrusted data as React text, keeps read-only system diagnostics and never replaces the host root', () => {
    expect(index + workspace).not.toMatch(/dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|DOMParser|document\.body|createRoot\s*\(|ReactDOM|name:\s*['"]root['"]|key:\s*['"]conversation['"]/)
    contains(section('valueView'), ["if (typeof value !== 'object') return String(value)", 'Object.entries(value).map', "h('dd', null, valueView(item, depth + 1))"])
    contains(section('systemContent'), ["tr('Readonly')", 'data.sources', 'data.effective', "'[REDACTED_PATH]'", 'entry.origin', 'entry.originDetail', 'data.runtime', 'data.db', 'data.workers', 'data.watchdog', 'data.outbox', 'data.recentErrors'])
    expect(section('systemContent')).not.toMatch(/onChange|askConfirm|call\(/)
    expect(section('systemContent')).not.toMatch(/role:\s*['"]switch['"]|\.slice\(/)
    contains(section('systemContent'), ["source.ok === true ? tr('Healthy') : source.ok === false ? tr('Unhealthy') : tr('Unknown')", "source.paused === true ? tr('Yes') : source.paused === false ? tr('No') : tr('Unknown')"])
    contains(section('text'), ["value === undefined || value === null || value === '' ? tr('Unknown')"])
    contains(section('time'), ["Number.isFinite(value)", ": tr('Unknown')"])
    expect(styles).not.toMatch(/(?:^|[}\n])\s*(?:body|html|:root|#root)\s*[{,]/)
  })

  it('covers literal and semantic dynamic translations without forcing obsolete pages or unrelated source strings', () => {
    const keys = translationKeys()
    for (const key of ['title', 'channelNotice', 'wWebAuthRequired', 'wWorkspace', 'wRetrySameRequest', 'wPending', 'wCleanTree', 'wBudgets', 'wFingerprint', 'wOverview', 'wTimeline', 'wResults', 'wDatabase', 'wBoundaryBody']) expect(keys.has(key), key).toBe(true)
    for (const nonKey of ['wcommand-status', 'wsaw-draft', 'wstateDir', 'wticket-input', 'w/api/superagent/']) expect(keys.has(nonKey), nonKey).toBe(false)
    for (const key of keys) {
      expect(typeof en[key], `en:${key}`).toBe('string')
      expect(en[key]?.trim().length, `en:${key}`).toBeGreaterThan(0)
      expect(typeof zh[key], `zh:${key}`).toBe('string')
      expect(zh[key]?.trim().length, `zh:${key}`).toBeGreaterThan(0)
    }
    // Existing locale keys are intentionally retained; they do not require their
    // superseded seven-page implementation to survive. New keys may be added.
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
