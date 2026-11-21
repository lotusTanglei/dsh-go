import { deriveDeskState } from './desk-model.js'

/** Serialized by the client builder. Every runtime helper is local or explicitly supplied. */
export function createWorkspacePage(React: any, request: (path: string, body?: any, signal?: any) => Promise<any>, t: any, css: string, deskState = deriveDeskState) {
  const h = React.createElement
  const columns = ['pending', 'running', 'waiting', 'ended']
  const tr = (key: string) => t(`w${key}`)
  const array = (value: any): any[] => Array.isArray(value) ? value : []
  const text = (value: any) => value === undefined || value === null || value === '' ? tr('Unknown') : String(value)
  const time = (value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString() : tr('Unknown')
  const names: Record<string, string> = { open: 'Pending', pending: 'Pending', running: 'Running', waiting: 'Waiting', waiting_human: 'Waiting', ended: 'Ended', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', dropped: 'Dropped', unknown: 'Unknown', candidate: 'DocumentCandidate', blocked: 'DocumentBlocked', linked: 'DocumentLinked', received: 'Received', queued: 'Queued', claimed: 'Claimed', admitted: 'Admitted', processing: 'Processing', published: 'Published', canceled: 'Canceled', rejected: 'Rejected', approved: 'Approved', denied: 'Denied', expired: 'Expired', superseded: 'Superseded', consumed: 'Consumed', user: 'You', assistant: 'Title', notice: 'Notice' }
  const stateName = (value: any) => names[value] ? tr(names[value]) : text(value)
  const fieldNames: Record<string, string> = { goal: 'Goal', scope: 'Scope', repo: 'Project', subdirs: 'Subdirs', base: 'Base', ref: 'Ref', requireCleanTree: 'CleanTree', allowWrite: 'AllowWrite', denyWrite: 'DenyWrite', runtime: 'Runtime', acceptance: 'Acceptance', outOfScope: 'OutOfScope', blockers: 'Blockers', firstAction: 'FirstAction', approvalsRequired: 'ApprovalsRequired', done: 'Done', changedPaths: 'ChangedFiles', changedFiles: 'ChangedFiles', risks: 'Risks', needHuman: 'NeedHuman', result: 'Result', check: 'Check', evidence: 'Evidence', reason: 'Reason', description: 'Description', repository: 'Project', branch: 'Branch', commit: 'Commit', pr: 'PullRequest', recipient: 'Recipient', body: 'Body', subject: 'Subject', amount: 'Amount', currency: 'Currency', purpose: 'Purpose', operation: 'Operation', impact: 'Impact', state: 'State', ok: 'Health', paused: 'Paused', available: 'Available', active: 'Active', workers: 'Workers', maxWorkers: 'WorkerLimit', pending: 'Pending', dropped: 'Dropped', attempts: 'Attempts', nextAt: 'NextRetry', error: 'Error', version: 'Version', sizeBytes: 'SizeBytes', lastAt: 'LastEvent', lastProgressAt: 'LastProgress', startedAt: 'Started', endedAt: 'EndedAt', steps: 'Steps', usage: 'Tokens', tokens: 'Tokens', durationMs: 'Duration', at: 'Time', rule: 'Rule', action: 'Action', outcome: 'Outcome', decisions: 'Decisions', metrics: 'Metrics', repeatedCalls: 'RepeatedCalls', stallMs: 'Stall', waitingMs: 'WaitingMs', code: 'Code', count: 'Count', kind: 'Kind', attended: 'Attended', current: 'Current', limit: 'Limit' }
  const label = (key: string) => fieldNames[key] ? tr(fieldNames[key]) : key
  const button = (title: string, onClick: () => void, disabled = false, props: any = {}) => h('button', { type: 'button', className: 'saw-btn', disabled, onClick, ...props }, title)
  const merge = (old: any[], incoming: any[], order: (a: any, b: any) => number) => {
    const rows = new Map(old.map(item => [String(item.id), item]))
    for (const item of incoming) if (item && item.id !== undefined) rows.set(String(item.id), { ...rows.get(String(item.id)), ...item })
    return [...rows.values()].sort(order)
  }
  const messageOrder = (a: any, b: any) => Number(a.seq) - Number(b.seq) || String(a.id).localeCompare(String(b.id))
  const timelineOrder = (a: any, b: any) => Number(b.id) - Number(a.id)
  const valueView = (value: any, depth = 0): any => {
    if (value === undefined || value === null) return tr('Unknown')
    if (typeof value === 'boolean') return tr(value ? 'Yes' : 'No')
    if (typeof value !== 'object') return String(value)
    if (depth > 12) return tr('Unknown')
    if (Array.isArray(value)) return value.length ? h('ul', { className: 'saw-list' }, ...value.map((item, i) => h('li', { key: i }, valueView(item, depth + 1)))) : tr('None')
    return Object.keys(value).length ? h('dl', { className: 'saw-fields' }, ...Object.entries(value).map(([key, item]) => h(React.Fragment, { key }, h('dt', null, label(key)), h('dd', null, valueView(item, depth + 1))))) : tr('None')
  }
  const fields = (entries: Array<[string, any]>) => h('dl', { className: 'saw-fields' }, ...entries.map(([key, value]) => h(React.Fragment, { key }, h('dt', null, tr(key)), h('dd', null, value))))
  const briefView = (brief: any) => brief ? h('div', { className: 'saw-brief' }, ...['goal', 'scope', 'base', 'allowWrite', 'denyWrite', 'runtime', 'acceptance', 'blockers', 'outOfScope', 'firstAction', 'approvalsRequired'].map(key => h('section', { key }, h('h4', null, label(key)), valueView(brief[key])))) : h('p', null, tr('BriefMissing'))
  const displayTitle = (value: unknown) => {
    const full = typeof value === 'string' ? value.trim() : ''
    if (!full) return tr('Untitled')
    // A label, not an AI rewrite: keep the first literal line/sentence and a bounded prefix.
    const line = full.split(/[\r\n]/, 1)[0]!.trim()
    const sentence = line.match(/^(.+?[。！？]|.+?[.!?](?=\s|$))/u)?.[0] || line
    const points = Array.from(sentence)
    return points.length > 64 ? `${points.slice(0, 64).join('').trimEnd()}…` : sentence
  }
  const reportSummary = (detail: any) => {
    const assignments = array(detail?.assignments)
    const current = detail?.ticket?.currentAssignment
    const stamp = (row: any) => typeof row?.startedAt === 'number' && Number.isFinite(row.startedAt) && row.startedAt > 0 ? row.startedAt : 0
    const ordered = [...assignments].sort((a, b) => stamp(b) - stamp(a))
    const selected = typeof current === 'string' ? assignments.find(row => row?.id === current) : ordered.length === 1 || ordered.length > 1 && ordered.every(row => stamp(row) > 0) && stamp(ordered[0]) > stamp(ordered[1]) ? ordered[0] : undefined
    const report = selected?.report && typeof selected.report === 'object' && !Array.isArray(selected.report) ? selected.report : null
    const strings = (value: any): string[] | null => Array.isArray(value) && value.every(item => typeof item === 'string') ? value.filter(item => item.trim()) : null
    const expected = array(detail?.brief?.acceptance)
    const expectedIds = expected.map(row => typeof row?.id === 'string' && row.id.trim() ? row.id : null)
    const validExpected = Array.isArray(detail?.brief?.acceptance) && expectedIds.every(Boolean) && new Set(expectedIds).size === expectedIds.length
    const reported = array(report?.acceptance)
    const acceptance = expected.map((criterion: any) => {
      const matches = reported.filter(row => row && typeof row === 'object' && row.id === criterion?.id)
      const entry = matches.length === 1 ? matches[0] : undefined
      const known = validExpected && entry && ['passed', 'failed', 'not-run'].includes(entry.result) && typeof entry.evidence === 'string' && !!entry.evidence.trim()
      return { id: criterion?.id, check: typeof criterion?.check === 'string' ? criterion.check : '', result: known ? entry.result : 'unknown', evidence: typeof entry?.evidence === 'string' ? entry.evidence : '' }
    })
    const malformedAcceptance = !report || !Array.isArray(report.acceptance) || !validExpected || reported.length !== expected.length || reported.some(row => !row || typeof row !== 'object' || !expectedIds.includes(row.id)) || acceptance.some(row => row.result === 'unknown')
    return { selected, report, ambiguous: assignments.length > 0 && !selected, acceptance, malformedAcceptance,
      passed: acceptance.filter(row => row.result === 'passed').length, total: expected.length,
      done: strings(report?.done), todo: strings(report?.todo), risks: strings(report?.risks), needHuman: strings(report?.needHuman) }
  }
  const storageKey = (epoch: string) => `superagent.workspace.v1:${encodeURIComponent(epoch)}`
  const validDocumentOrigin = (value: any) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 5 && value.kind === 'wecom-document' && ['itemKey', 'revision', 'evidenceDigest', 'configVersion'].every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key]))
  const validDocumentLink = (value: any) => typeof value === 'string' && /^https:\/\/doc\.weixin\.qq\.com\/sheet\/[A-Za-z0-9_-]+\?tab=[A-Za-z0-9_-]+$/.test(value)
  const documentInstruction = '请为所选外部文档条目生成待审阅计划；先调用 task_source_context 读取不可信来源证据。尚未授权执行。'
  const blankComposer = () => ({ draft: '', intent: 'new-task', target: null, origin: null, documentOrigin: null, pending: null, receipt: null })
  const readComposer = (epoch: string) => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(epoch)) || 'null')
      if (!saved || typeof saved.draft !== 'string') return blankComposer()
      const pending = saved.pending
      const validPending = pending && pending.epoch === epoch && typeof pending.requestId === 'string' && typeof pending.text === 'string' && ['message', 'new-task', 'ticket-input'].includes(pending.intent) && (pending.intent !== 'ticket-input' || typeof pending.ticketId === 'string') && (pending.documentOrigin === undefined || pending.intent === 'new-task' && !pending.ticketId && !pending.recreateFrom && validDocumentOrigin(pending.documentOrigin))
      return { draft: saved.draft, intent: saved.intent === 'new-task' ? 'new-task' : 'message', target: saved.target && typeof saved.target.id === 'string' ? saved.target : null, origin: saved.origin && typeof saved.origin.id === 'string' ? saved.origin : null, documentOrigin: saved.intent === 'new-task' && !saved.target && !saved.origin && validDocumentOrigin(saved.documentOrigin) ? saved.documentOrigin : null, pending: validPending ? pending : null, receipt: saved.receipt || null }
    } catch { return blankComposer() }
  }
  const completeBrief = (plan: any) => {
    const brief = plan?.brief
    return plan?.reviewable !== false && brief && typeof brief.goal === 'string' && typeof brief.scope?.repo === 'string' && Array.isArray(brief.scope?.subdirs) && ['allowWrite', 'denyWrite', 'acceptance', 'blockers', 'outOfScope'].every(key => Array.isArray(brief[key])) && !JSON.stringify(brief).includes('[REDACTED')
  }
  const mintId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128
    const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return function WorkspacePage() {
    const [workspace, setWorkspace] = React.useState(null as any)
    const [board, setBoard] = React.useState(null as any)
    const [conversation, setConversation] = React.useState({} as any)
    const [composer, setComposer] = React.useState(blankComposer())
    const [historyEpoch, setHistoryEpoch] = React.useState('')
    const [draftEpoch, setDraftEpoch] = React.useState('')
    const [mobileTab, setMobileTab] = React.useState('chat')
    const [collapsed, setCollapsed] = React.useState(false)
    const [activityView, setActivityView] = React.useState('briefing')
    const [newReplies, setNewReplies] = React.useState(0)
    const [replyOpen, setReplyOpen] = React.useState(false)
    const [planReview, setPlanReview] = React.useState('')
    const planFocus = React.useRef(null as HTMLElement | null)
    const inspectorOpener = React.useRef(null as HTMLElement | null)
    const inspectorReturnToInput = React.useRef(false)
    const historyButtonRef = React.useRef(null as HTMLButtonElement | null)
    const activityViewRef = React.useRef('briefing')
    const replyWatermarks = React.useRef({} as Record<string, number>)
    const replyReadThrough = React.useRef({} as Record<string, number>)
    const replyBaselineReady = React.useRef({} as Record<string, boolean>)
    const replyFocus = React.useRef(null as HTMLElement | null)
    const lastActivityView = React.useRef('briefing')
    const briefingScroll = React.useRef(0)
    const [query, setQuery] = React.useState('')
    const [outcome, setOutcome] = React.useState('')
    const [error, setError] = React.useState('')
    const [boardError, setBoardError] = React.useState('')
    const [historyError, setHistoryError] = React.useState('')
    const [notice, setNotice] = React.useState('')
    const [storageError, setStorageError] = React.useState(false)
    const [lastSync, setLastSync] = React.useState(0)
    const [sending, setSending] = React.useState(false)
    const [paging, setPaging] = React.useState('')
    const [detailId, setDetailId] = React.useState('')
    const [detail, setDetail] = React.useState(null as any)
    const [detailTab, setDetailTab] = React.useState('overview')
    const [detailError, setDetailError] = React.useState('')
    const [system, setSystem] = React.useState('')
    const [systemData, setSystemData] = React.useState({} as any)
    const [systemError, setSystemError] = React.useState('')
    const [sessionWorkPages, setSessionWorkPages] = React.useState({} as any)
    const [sessionWorkBusy, setSessionWorkBusy] = React.useState('')
    const [sessionWorkError, setSessionWorkError] = React.useState('')
    const [excludedOpen, setExcludedOpen] = React.useState(false)
    const sessionWorkPagesRef = React.useRef({} as any)
    const sessionWorkBusyRef = React.useRef(false)
    const excludedOpenRef = React.useRef(false)
    const [documents, setDocuments] = React.useState(null as any)
    const [documentBusy, setDocumentBusy] = React.useState('')
    const [documentError, setDocumentError] = React.useState('')
    const [documentScanResult, setDocumentScanResult] = React.useState(null as any)
    const [documentDetail, setDocumentDetail] = React.useState(null as any)
    const [documentImages, setDocumentImages] = React.useState({} as any)
    const [documentReviewed, setDocumentReviewed] = React.useState(false)
    const documentBusyRef = React.useRef(false)
    const documentDetailRef = React.useRef(null as any)
    const documentEvidenceVersion = React.useRef(0)
    const documentImagesRef = React.useRef({} as any)
    const documentReviewedRef = React.useRef(false)
    const [confirmation, setConfirmation] = React.useState(null as any)
    const [reason, setReason] = React.useState('')
    const [revisionGoal, setRevisionGoal] = React.useState('')
    const [revisionFirstAction, setRevisionFirstAction] = React.useState('')
    const [acting, setActing] = React.useState(false)
    const [actionError, setActionError] = React.useState('')
    const [stopping, setStopping] = React.useState({} as any)
    const alive = React.useRef(false)
    const epochRef = React.useRef('')
    const workspaceRef = React.useRef(null as any)
    const historyRef = React.useRef('')
    const conversations = React.useRef({} as any)
    const composerCache = React.useRef({} as any)
    const composerRef = React.useRef(blankComposer())
    const draftEpochRef = React.useRef('')
    const boardRef = React.useRef(null as any)
    const filterRef = React.useRef({ query: '', outcome: '' })
    const loaded = React.useRef({ pending: 20, running: 20, waiting: 20, ended: 20 } as any)
    const boardBusy = React.useRef(false)
    const historyBusy = React.useRef(false)
    const detailBusy = React.useRef(false)
    const detailRef = React.useRef(null as any)
    const detailIdRef = React.useRef('')
    const systemRef = React.useRef('')
    const systemDataRef = React.useRef({} as any)
    const systemBusy = React.useRef(false)
    const approvalsLoaded = React.useRef(20)
    const detailApprovalsLoaded = React.useRef({} as Record<string, number>)
    const controllers = React.useRef(new Set<AbortController>())
    const sendController = React.useRef(null as AbortController | null)
    const sendBusy = React.useRef(false)
    const actionBusy = React.useRef(false)
    const poke = React.useRef(() => {})
    const dialogRef = React.useRef(null as HTMLDialogElement | null)
    const detailCloseRef = React.useRef(null as HTMLElement | null)
    const systemCloseRef = React.useRef(null as HTMLElement | null)
    const detailFocus = React.useRef(null as HTMLElement | null)
    const systemFocus = React.useRef(null as HTMLElement | null)
    const confirmationFocus = React.useRef(null as HTMLElement | null)
    const inputRef = React.useRef(null as HTMLTextAreaElement | null)
    const messagesRef = React.useRef(null as HTMLElement | null)
    const historyAnchor = React.useRef(null as any)
    const autoScroll = React.useRef(true)
    const messageOf = (e: any) => e?.code === 'web_auth_required' ? tr('WebAuthRequired') : `${tr('RequestFailed')}${e?.code ? ` (${String(e.code)})` : ''}`
    const saveComposer = (epoch: string, next: any) => {
      composerCache.current[epoch] = next
      try { sessionStorage.setItem(storageKey(epoch), JSON.stringify(next)) } catch { if (alive.current) setStorageError(true) }
      if (epoch === draftEpochRef.current) { composerRef.current = next; if (alive.current) setComposer(next) }
    }
    const updateComposer = (patch: any, epoch = draftEpochRef.current) => {
      if (!epoch) return
      const next = { ...(composerCache.current[epoch] || readComposer(epoch)), ...patch }
      if (next.intent !== 'new-task' || next.target || next.origin) next.documentOrigin = null
      saveComposer(epoch, next)
    }
    const call = async (path: string, body: any = {}, own?: AbortController) => {
      const controller = own || new AbortController()
      controllers.current.add(controller)
      try {
        if (controller.signal.aborted || !alive.current) { const aborted = new Error('aborted'); aborted.name = 'AbortError'; throw aborted }
        const result = await request(path, body, controller.signal)
        if (controller.signal.aborted || !alive.current) { const aborted = new Error('aborted'); aborted.name = 'AbortError'; throw aborted }
        return result
      } finally { controllers.current.delete(controller) }
    }
    const setConversationPage = (epoch: string, page: any, mode: string) => {
      const old = conversations.current[epoch] || { items: [] }
      const next = { ...old, items: merge(old.items, array(page.items), messageOrder), ...(mode !== 'before' ? { nextAfter: page.nextAfter, deltaMore: mode === 'after' && page.hasMore } : {}), ...(mode !== 'after' ? { nextBefore: page.nextBefore, hasMore: page.hasMore } : {}), error: '' }
      next.latestAssistant = page.latestAssistant || old.latestAssistant
      const replySeq = Number.isSafeInteger(next.latestAssistant?.lastSeq) ? next.latestAssistant.lastSeq : -1
      if (mode !== 'before') {
        if (!replyBaselineReady.current[epoch]) {
          // Baseline even an empty first read, so the first subsequent reply is not swallowed.
          let readThrough = replySeq
          try { const saved = sessionStorage.getItem(`superagent.reply-read.v1:${encodeURIComponent(epoch)}`); if (saved !== null && Number.isSafeInteger(Number(saved))) readThrough = Number(saved) } catch {}
          replyReadThrough.current[epoch] = readThrough; replyBaselineReady.current[epoch] = true
          try { sessionStorage.setItem(`superagent.reply-read.v1:${encodeURIComponent(epoch)}`, String(readThrough)) } catch {}
        }
        if (epoch === epochRef.current) setNewReplies(replySeq > (replyReadThrough.current[epoch] ?? replySeq) ? 1 : 0)
        replyWatermarks.current[epoch] = replySeq
      }
      conversations.current = { ...conversations.current, [epoch]: next }
      setConversation(conversations.current)
    }
    const readConversation = async (epoch: string, before?: string) => {
      if (!epoch || historyBusy.current) return
      historyBusy.current = true
      const old = conversations.current[epoch]
      let mode = before ? 'before' : old?.nextAfter ? 'after' : 'recent'
      try {
        // Bound each tick. Remaining deltas keep their cursor for the next tick.
        for (let i = 0; i < 4; i++) {
          const current = conversations.current[epoch]
          const page = await call('conversation', { epoch, limit: 30, ...(mode === 'before' ? { before } : mode === 'after' ? { after: current.nextAfter } : {}) })
          if (!alive.current) return
          setConversationPage(epoch, page, mode)
          if (historyRef.current === epoch) setHistoryError('')
          if (mode !== 'after' || !page.hasMore) break
        }
      } catch (e: any) {
        if (!alive.current) return
        if (historyRef.current === epoch) setHistoryError(messageOf(e))
        if (!before && ['invalid_cursor', 'epoch_mismatch'].includes(e?.code)) {
          // Keep displayed history; replace only the read watermark on the next tick.
          conversations.current[epoch] = { ...(conversations.current[epoch] || { items: [] }), nextAfter: undefined }
        }
      } finally { historyBusy.current = false }
    }
    const readBoard = async () => {
      if (boardBusy.current) return
      boardBusy.current = true
      const filter = { ...filterRef.current }
      try {
        const fresh = await call('board', { ...filter, limit: 20 })
        const nextColumns = { ...fresh.columns }
        for (const column of columns) {
          let page = nextColumns[column]
          let items = array(page?.items)
          const target = Math.max(20, Number(loaded.current[column]) || 20)
          while (page?.hasMore && page.cursor && items.length < target) {
            const more = await call('board', { ...filter, column, cursor: page.cursor, limit: Math.min(100, Math.max(1, target - items.length)) })
            if (more.revision !== fresh.revision) { const conflict: any = new Error(); conflict.code = 'board_resync_required'; conflict.status = 409; throw conflict }
            page = more.columns[column]
            items = merge(items, array(page?.items), (a, b) => Number(b.createdAt) - Number(a.createdAt) || String(a.id).localeCompare(String(b.id)))
          }
          nextColumns[column] = { ...page, items }
        }
        if (!alive.current || JSON.stringify(filter) !== JSON.stringify(filterRef.current)) return
        const next = { ...fresh, columns: nextColumns }
        boardRef.current = next; setBoard(next); setBoardError('')
        setStopping((previous: any) => Object.fromEntries(Object.entries(previous).filter(([id]) => !columns.some(column => array(next.columns[column]?.items).some((item: any) => item.id === id && item.state === 'ended')))))
      } catch (e: any) { if (alive.current) { setBoardError(e?.status === 409 ? tr('BoardResync') : messageOf(e)); } }
      finally { boardBusy.current = false }
    }
    const readDetail = async (id: string, more = false) => {
      if (!id || detailBusy.current) return
      detailBusy.current = true
      try {
        const old = detailRef.current?.ticket?.id === id ? detailRef.current : null
        const first = await call('ticket', { id, limit: 30, ...(more && old?.timelineCursor ? { timelineCursor: old.timelineCursor } : {}) })
        let next = first
        if (more && old) next = { ...old, timeline: merge(array(old.timeline), array(first.timeline), timelineOrder), timelineCursor: first.timelineCursor }
        else if (old) {
          let timeline = array(first.timeline), cursor = first.timelineCursor
          while (cursor && timeline.length < array(old.timeline).length) {
            const page = await call('ticket', { id, timelineCursor: cursor, limit: 100 })
            timeline = merge(timeline, array(page.timeline), timelineOrder); cursor = page.timelineCursor
          }
          next = { ...first, timeline, timelineCursor: cursor }
        }
        let approvals = array(next.approvals), approvalCursor = next.approvalsNext
        const desired = detailApprovalsLoaded.current[id] || 30
        while (approvalCursor && approvals.length < desired) {
          const page = await call('approvals', { ticketId: id, cursor: approvalCursor, limit: Math.min(100, desired - approvals.length) })
          approvals = merge(approvals, array(page.items), (a, b) => String(a.id).localeCompare(String(b.id)))
          approvalCursor = page.next
        }
        next = { ...next, approvals, approvalsNext: approvalCursor }
        if (!alive.current || detailIdRef.current !== id) return
        detailRef.current = next; setDetail(next); setDetailError('')
        if (next.ticket?.state === 'ended') setStopping((items: any) => { const result = { ...items }; delete result[id]; return result })
      } catch (e: any) { if (alive.current && detailIdRef.current === id) setDetailError(messageOf(e)) }
      finally { detailBusy.current = false }
    }
    const readSystem = async (more = false) => {
      const tab = systemRef.current
      if (!tab || systemBusy.current) return
      systemBusy.current = true
      const route = tab === 'settings' ? 'settings' : tab === 'todo' ? 'approvals' : 'health'
      try {
        const old = systemDataRef.current[tab]
        let data = await call(route, tab === 'todo' ? { state: 'pending', limit: 20, ...(more && old?.next ? { cursor: old.next } : {}) } : {})
        if (tab === 'todo') {
          let items = more ? merge(array(old?.items), array(data.items), (a, b) => String(a.id).localeCompare(String(b.id))) : array(data.items)
          while (!more && data.next && items.length < approvalsLoaded.current) {
            const page = await call('approvals', { state: 'pending', limit: Math.min(100, approvalsLoaded.current - items.length), cursor: data.next })
            if (page.next === data.next) break
            items = merge(items, array(page.items), (a, b) => String(a.id).localeCompare(String(b.id))); data = page
          }
          data = { ...data, items }
          if (more) approvalsLoaded.current = items.length
        }
        if (!alive.current || systemRef.current !== tab) return
        systemDataRef.current = { ...systemDataRef.current, [tab]: data }
        setSystemData(systemDataRef.current); setSystemError('')
      } catch (e: any) { if (alive.current && systemRef.current === tab) { setSystemError(e?.status === 409 ? tr('DecisionConflict') : messageOf(e)); if (e?.status === 409) poke.current() } }
      finally { systemBusy.current = false }
    }
    // Passive local projections only. The workspace poll supplies preview; full pages are explicit.
    const readSessionWork = async (view = 'included', more = false) => {
      const epoch = epochRef.current
      if (!epoch || sessionWorkBusyRef.current) return
      const old = sessionWorkPagesRef.current[view], cursor = more ? old?.next : undefined
      if (more && (!old?.hasMore || typeof cursor !== 'string')) return
      sessionWorkBusyRef.current = true; setSessionWorkBusy(view); setSessionWorkError('')
      try {
        const data = await call('session-work', { action: 'list', epoch, view, limit: 20, ...(cursor ? { cursor } : {}) })
        if (!alive.current || epochRef.current !== epoch) return
        if (more && data.revision !== old.revision) { const changed: any = new Error(); changed.status = 409; throw changed }
        const page = more ? { ...data, items: [...new Map([...array(old.items), ...array(data.items)].map(row => [row.sessionId, row])).values()] } : data
        sessionWorkPagesRef.current = { ...sessionWorkPagesRef.current, [view]: page }; setSessionWorkPages(sessionWorkPagesRef.current)
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch) setSessionWorkError(tr(e?.status === 409 ? 'SessionWorkChanged' : 'SessionWorkReadFailed'))
      } finally { sessionWorkBusyRef.current = false; if (alive.current) setSessionWorkBusy('') }
    }
    const setSessionIncluded = async (row: any, included: boolean, revision: any) => {
      const epoch = epochRef.current
      if (!epoch || sessionWorkBusyRef.current || typeof revision !== 'string' || !revision) return
      sessionWorkBusyRef.current = true; setSessionWorkBusy(row.sessionId); setSessionWorkError('')
      let saved = false
      try {
        const receipt = await call('session-work', { action: 'set-included', epoch, sessionId: row.sessionId, included, revision })
        if (!alive.current || epochRef.current !== epoch) return
        if (receipt?.sessionId !== row.sessionId || receipt?.included !== included) throw new Error('unconfirmed_membership')
        saved = true; setNotice(tr(included ? 'SessionWorkRestored' : 'SessionWorkExcluded'))
        // Never optimistically hide a row or retry a mutation after an uncertain outcome.
        sessionWorkPagesRef.current = {}; setSessionWorkPages({}); poke.current()
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch) setSessionWorkError(tr(e?.status === 409 ? 'SessionWorkChanged' : 'SessionWorkSaveFailed'))
      } finally { sessionWorkBusyRef.current = false; if (alive.current) setSessionWorkBusy('') }
      if (saved && alive.current && epochRef.current === epoch) {
        await readSessionWork('included')
        if (excludedOpenRef.current) await readSessionWork('excluded')
      }
    }
    const toggleExcluded = (event: any) => {
      const open = event.currentTarget.open === true
      excludedOpenRef.current = open; setExcludedOpen(open)
      if (open && !sessionWorkPagesRef.current.excluded) void readSessionWork('excluded')
    }
    const resetDocumentEvidence = () => {
      documentEvidenceVersion.current++
      documentDetailRef.current = null; documentImagesRef.current = {}; documentReviewedRef.current = false
      setDocumentDetail(null); setDocumentImages({}); setDocumentReviewed(false)
    }
    // Only explicit UI events call these functions. Never part of readSystem/tick/effects.
    const readDocuments = async (sourceId?: string, more = false) => {
      if (documentBusyRef.current || !epochRef.current || !array(workspaceRef.current?.documentSources).length) return
      const epoch = epochRef.current
      const cursor = more ? documents?.cursor : undefined
      if (more && (!documents?.hasMore || typeof cursor !== 'string')) return
      documentBusyRef.current = true; setDocumentBusy(sourceId || 'list'); setDocumentError(''); resetDocumentEvidence()
      try {
        if (sourceId) {
          const result = await call('document-source', { action: 'scan', epoch, sourceId })
          if (epochRef.current !== epoch) return
          setDocumentScanResult(result)
        }
        const result = await call('document-source', { action: 'list', epoch, ...(cursor ? { cursor } : {}) })
        if (epochRef.current === epoch) setDocuments(more ? { ...result, items: [...new Map([...array(documents?.items), ...array(result.items)].map(row => [row.itemKey, row])).values()] } : result)
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch) setDocumentError(sourceId ? tr('DocumentReadUncertain') : messageOf(e))
      } finally { documentBusyRef.current = false; if (alive.current) setDocumentBusy('') }
    }
    const openDocument = async (entry: any) => {
      if (documentBusyRef.current || !epochRef.current) return
      const epoch = epochRef.current
      documentBusyRef.current = true; setDocumentBusy(entry.itemKey); setDocumentError(''); resetDocumentEvidence()
      const evidenceVersion = documentEvidenceVersion.current
      try {
        const result = await call('document-source', { action: 'detail', epoch, itemKey: entry.itemKey, revision: entry.revision })
        if (epochRef.current !== epoch || documentEvidenceVersion.current !== evidenceVersion || !validDocumentOrigin(result?.documentOrigin) || result.documentOrigin.itemKey !== entry.itemKey || result.documentOrigin.revision !== entry.revision) return
        const next = { ...result, epoch }
        documentDetailRef.current = next; setDocumentDetail(next)
      } catch (e: any) { if (alive.current && epochRef.current === epoch) setDocumentError(messageOf(e)) }
      finally { documentBusyRef.current = false; if (alive.current) setDocumentBusy('') }
    }
    const loadDocumentImages = async () => {
      const detail = documentDetailRef.current, epoch = epochRef.current
      if (!detail || detail.epoch !== epoch || documentBusyRef.current) return
      documentBusyRef.current = true; setDocumentBusy('images'); setDocumentError('')
      documentReviewedRef.current = false; setDocumentReviewed(false); documentImagesRef.current = {}; setDocumentImages({})
      try {
        for (const image of array(detail.screenshots)) {
          const result = await call('document-image', { epoch, itemKey: detail.documentOrigin.itemKey, revision: detail.documentOrigin.revision, digest: image.digest })
          if (epochRef.current !== epoch || documentDetailRef.current !== detail) return
          if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(result?.mediaType) || result.mediaType !== image.mediaType || typeof result.encoded !== 'string' || result.encoded.length > 11184812 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.encoded) || !result.encoded) throw new Error('invalid_image')
          const next = { ...documentImagesRef.current, [image.digest]: { src: `data:${result.mediaType};base64,${result.encoded}`, loaded: false } }
          documentImagesRef.current = next; setDocumentImages(next)
        }
      } catch (e: any) { if (alive.current && epochRef.current === epoch) setDocumentError(tr('DocumentImagesFailed')) }
      finally { documentBusyRef.current = false; if (alive.current) setDocumentBusy('') }
    }
    const documentImageRendered = (detail: any, digest: string, loaded: boolean) => {
      if (documentDetailRef.current !== detail || detail.epoch !== epochRef.current || !documentImagesRef.current[digest]) return
      const next = { ...documentImagesRef.current, [digest]: { ...documentImagesRef.current[digest], loaded } }
      documentImagesRef.current = next; setDocumentImages(next)
      if (!loaded) { documentReviewedRef.current = false; setDocumentReviewed(false); setDocumentError(tr('DocumentImagesFailed')) }
    }
    const documentCanPlan = (entry: any, detail: any) => entry?.state === 'candidate' && entry.eligible === true && detail?.eligible === true && detail.epoch === epochRef.current && validDocumentOrigin(entry.documentOrigin) && validDocumentOrigin(detail.documentOrigin) && ['itemKey', 'revision', 'evidenceDigest', 'configVersion'].every(key => entry.documentOrigin[key] === detail.documentOrigin[key]) && array(detail.screenshots).every(image => documentImagesRef.current[image.digest]?.loaded === true) && documentReviewedRef.current
    const documentCanReview = (entry: any, detail: any) => entry?.state === 'blocked' && entry.reviewable === true && entry.eligible === false && detail?.reviewable === true && detail.eligible === false && detail.epoch === epochRef.current && validDocumentLink(detail.documentLink) && validDocumentOrigin(entry.documentOrigin) && validDocumentOrigin(detail.documentOrigin) && ['itemKey', 'revision', 'evidenceDigest', 'configVersion'].every(key => entry.documentOrigin[key] === detail.documentOrigin[key]) && array(detail.screenshots).every(image => documentImagesRef.current[image.digest]?.loaded === true) && documentReviewedRef.current
    const reviewDocument = async (entry: any) => {
      const detail = documentDetailRef.current, epoch = epochRef.current, saved = composerRef.current
      if (documentBusyRef.current || !documentCanReview(entry, detail)) return
      if (saved.pending || saved.draft.trim() || saved.target || saved.origin || saved.documentOrigin || draftEpochRef.current !== epoch || historyRef.current !== epoch) { setNotice(tr('ResolveDraftFirst')); return }
      documentBusyRef.current = true; setDocumentBusy('review'); setDocumentError('')
      const origin = detail.documentOrigin
      try {
        const result = await call('document-source', { action: 'review', epoch, itemKey: origin.itemKey, revision: origin.revision, evidenceDigest: origin.evidenceDigest, decision: 'reviewed-not-struck' })
        if (epochRef.current !== epoch || documentDetailRef.current !== detail || result?.eligible !== true || result?.reviewable !== false || result?.state !== 'candidate' || !validDocumentOrigin(result.documentOrigin) || !['itemKey', 'revision', 'evidenceDigest', 'configVersion'].every(key => result.documentOrigin[key] === origin[key])) return
        const next = { ...detail, eligible: true, reviewable: false }
        documentDetailRef.current = next; setDocumentDetail(next)
        setDocuments((previous: any) => previous ? { ...previous, items: array(previous.items).map(row => row.itemKey === origin.itemKey && row.revision === origin.revision ? { ...row, eligible: true, reviewable: false, state: 'candidate' } : row) } : previous)
        // Owner attestation is not a machine strike determination or execution authorization.
        setNotice(tr('DocumentReviewSaved'))
      } catch (e: any) { if (alive.current && epochRef.current === epoch) setDocumentError(tr('DocumentReviewUncertain')) }
      finally { documentBusyRef.current = false; if (alive.current) setDocumentBusy('') }
    }
    const prepareDocumentPlan = (entry: any) => {
      const detail = documentDetailRef.current, saved = composerRef.current
      if (!documentCanPlan(entry, detail)) return
      if (saved.pending || saved.draft.trim() || saved.target || saved.origin || saved.documentOrigin || draftEpochRef.current !== epochRef.current || historyRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      updateComposer({ draft: documentInstruction, intent: 'new-task', target: null, origin: null, documentOrigin: detail.documentOrigin })
      closeSystem(); setMobileTab('chat'); setCollapsed(false); setNotice(tr('DocumentPlanDraft')); inputRef.current?.focus()
    }
    React.useEffect(() => {
      alive.current = true
      let timer: ReturnType<typeof setTimeout> | undefined
      let inFlight = false, again = false, failures = 0
      const tick = async () => {
        if (!alive.current) return
        if (inFlight) { again = true; return }
        clearTimeout(timer); inFlight = true
        try {
          const data = await call('workspace')
          let planCursor = data.admissionsNext
          const plans = array(data.admissions)
          const planCursors = new Set<string>()
          while (planCursor) {
            if (planCursors.has(planCursor)) throw new Error('admission_resync_required')
            planCursors.add(planCursor)
            const page = await call('workspace', { cursor: planCursor, limit: 100 })
            if (page.epoch !== data.epoch) throw new Error('epoch_mismatch')
            plans.push(...array(page.admissions)); planCursor = page.admissionsNext
          }
          data.admissions = [...new Map(plans.map(plan => [plan.planId, plan])).values()]
          if (!alive.current) return
          const epoch = typeof data.epoch === 'string' ? data.epoch : ''
          if (!epoch) throw new Error('invalid_workspace')
          if (epoch !== epochRef.current) {
            const prior = epochRef.current
            sendController.current?.abort()
            sendController.current = null
            epochRef.current = epoch
            sessionWorkPagesRef.current = {}; setSessionWorkPages({}); setSessionWorkError(''); excludedOpenRef.current = false; setExcludedOpen(false)
            setDocuments(null); setDocumentScanResult(null); setDocumentError(''); resetDocumentEvidence()
            const composerEpoch = prior || epoch
            const nextComposer = composerCache.current[composerEpoch] || readComposer(composerEpoch)
            composerCache.current[composerEpoch] = nextComposer; composerRef.current = nextComposer; setComposer(nextComposer)
            draftEpochRef.current = composerEpoch; setDraftEpoch(composerEpoch)
            historyRef.current = epoch; setHistoryEpoch(epoch); setNewReplies(0); setReplyOpen(false); setPlanReview('')
            if (prior) { setNotice(tr('EpochChanged')); dialogRef.current?.close(); setConfirmation(null) }
          }
          workspaceRef.current = data; setWorkspace(data); setError('')
          await readConversation(epoch)
          if (historyRef.current && historyRef.current !== epoch) await readConversation(historyRef.current)
          await readBoard()
          await readDetail(detailIdRef.current)
          await readSystem()
          if (!alive.current) return
          setLastSync(Date.now()); failures = 0
        } catch (e: any) { if (alive.current) { setError(messageOf(e)); failures++ } }
        finally {
          inFlight = false
          if (alive.current) {
            const delay = again ? 0 : document.visibilityState === 'hidden' ? 30000 : Math.min(60000, 5000 * 2 ** Math.min(failures, 3))
            again = false; timer = setTimeout(tick, delay)
          }
        }
      }
      poke.current = () => { clearTimeout(timer); void tick() }
      const visible = () => { if (document.visibilityState === 'visible') poke.current() }
      document.addEventListener('visibilitychange', visible)
      void tick()
      return () => {
        alive.current = false; clearTimeout(timer)
        document.removeEventListener('visibilitychange', visible)
        for (const controller of controllers.current) controller.abort()
        controllers.current.clear(); sendController.current?.abort()
        poke.current = () => {}
      }
    }, [])
    React.useLayoutEffect(() => {
      const node = messagesRef.current
      if (!node) return
      if (lastActivityView.current !== activityView) {
        node.scrollTop = activityView === 'briefing' ? briefingScroll.current : node.scrollHeight
        lastActivityView.current = activityView; historyAnchor.current = null
        return
      }
      const anchor = historyAnchor.current
      if (activityView === 'history' && anchor && anchor.epoch === historyEpoch) { node.scrollTop = anchor.top + node.scrollHeight - anchor.height; historyAnchor.current = null }
      else if (activityViewRef.current === 'history' && autoScroll.current) node.scrollTop = node.scrollHeight
    }, [conversation, historyEpoch, activityView])
    React.useEffect(() => { if (replyOpen) replyFocus.current?.focus() }, [replyOpen])
    React.useEffect(() => { if (planReview) planFocus.current?.focus() }, [planReview])
    React.useEffect(() => {
      if (!replyOpen && !planReview) return
      return () => {
        if (inspectorReturnToInput.current) { inspectorReturnToInput.current = false; inputRef.current?.focus() }
        else if (inspectorOpener.current?.isConnected) inspectorOpener.current.focus()
        else if (inputRef.current && !inputRef.current.disabled) inputRef.current.focus()
        else historyButtonRef.current?.focus()
      }
    }, [!!replyOpen || !!planReview])
    React.useEffect(() => {
      if (!detailId) return
      detailCloseRef.current?.focus()
      return () => { if (detailFocus.current?.isConnected) detailFocus.current.focus() }
    }, [detailId])
    React.useEffect(() => {
      if (!system) return
      systemCloseRef.current?.focus()
      return () => { if (systemFocus.current?.isConnected) systemFocus.current.focus() }
    }, [!!system])
    React.useEffect(() => {
      if (!confirmation || !dialogRef.current) return
      confirmationFocus.current = document.activeElement as HTMLElement
      dialogRef.current.showModal()
      dialogRef.current.querySelector('textarea,button')?.focus()
      return () => { if (confirmationFocus.current?.isConnected) confirmationFocus.current.focus() }
    }, [confirmation])
    const applyReceipt = (epoch: string, payload: any, receipt: any) => {
      const current = composerCache.current[epoch] || readComposer(epoch)
      // An older response must not erase a different/newer draft or request.
      const matches = current.pending?.requestId === payload.requestId
      saveComposer(epoch, { ...current, receipt, ...(matches && (receipt.accepted === true || ['canceled', 'rejected'].includes(receipt.stage)) ? { pending: null, ...(receipt.accepted === true && current.draft === payload.text ? { draft: '', origin: null, documentOrigin: null } : {}) } : {}) })
      if (alive.current && epoch === draftEpochRef.current) setNotice(receipt.accepted === true ? tr('AcceptedNotice') : tr('UnknownNotice'))
    }
    const submit = async (checkOnly = false) => {
      if (sendBusy.current || !epochRef.current) return
      const saved = composerRef.current
      if (saved.documentOrigin && (!validDocumentOrigin(saved.documentOrigin) || saved.intent !== 'new-task' || saved.target || saved.origin)) { setNotice(tr('ResolveDraftFirst')); return }
      const existing = saved.pending
      const epoch = existing?.epoch || draftEpochRef.current
      if (!existing && epoch !== epochRef.current) return
      if (!existing && (checkOnly || !saved.draft.trim() || workspaceRef.current?.capabilities?.send !== true || historyRef.current !== epoch)) return
      if (!existing && (new TextEncoder().encode(saved.draft).length > 16384 || saved.draft.includes('\0'))) { setNotice(tr('TextLimit')); return }
      let payload: any = existing
      try {
        if (!payload) payload = { epoch, requestId: mintId(), intent: saved.target ? 'ticket-input' : saved.intent, text: saved.draft, ...(saved.target ? { ticketId: saved.target.id } : saved.origin ? { recreateFrom: saved.origin.id } : saved.intent === 'new-task' && validDocumentOrigin(saved.documentOrigin) ? { documentOrigin: saved.documentOrigin } : {}) }
      } catch { setNotice(tr('SecureIdUnavailable')); return }
      // A send may race the first history read; its first real reply must still be discoverable.
      if (!replyBaselineReady.current[epoch]) {
        const baseline = conversations.current[epoch]?.latestAssistant?.lastSeq ?? -1
        replyReadThrough.current[epoch] = baseline; replyBaselineReady.current[epoch] = true
        try { sessionStorage.setItem(`superagent.reply-read.v1:${encodeURIComponent(epoch)}`, String(baseline)) } catch {}
      }
      const controller = new AbortController()
      sendController.current = controller; sendBusy.current = true; setSending(true)
      updateComposer({ pending: payload }, epoch)
      try {
        if (existing) {
          try {
            const receipt = await call('command-status', { epoch, requestId: payload.requestId }, controller)
            applyReceipt(epoch, payload, receipt)
            if (receipt.accepted === true || checkOnly || ['canceled', 'rejected'].includes(receipt.stage)) return
          } catch (e: any) {
            if (controller.signal.aborted || !alive.current) return
            if (e?.code !== 'command_not_found') throw e
            updateComposer({ pending: payload, receipt: { stage: 'not-found', accepted: false } }, epoch)
            if (checkOnly) { setNotice(tr('NotFoundNotice')); return }
          }
        }
        if (controller.signal.aborted || epochRef.current !== epoch || historyRef.current !== epoch) return
        // Never send the local recovery metadata; replay exactly the immutable command.
        const exact = { epoch: payload.epoch, requestId: payload.requestId, intent: payload.intent, text: payload.text, ...(payload.ticketId ? { ticketId: payload.ticketId } : {}), ...(payload.recreateFrom ? { recreateFrom: payload.recreateFrom } : {}), ...(payload.intent === 'new-task' && !payload.ticketId && !payload.recreateFrom && validDocumentOrigin(payload.documentOrigin) ? { documentOrigin: payload.documentOrigin } : {}) }
        const receipt = await call('command', exact, controller)
        applyReceipt(epoch, payload, receipt)
        if (alive.current && epochRef.current === epoch) poke.current()
      } catch (e: any) {
        if (!alive.current || controller.signal.aborted) return
        updateComposer({ receipt: { stage: 'unknown', accepted: false, code: e?.code } }, epoch)
        setNotice(e?.code === 'epoch_mismatch' ? tr('EpochChanged') : tr('UnknownNotice'))
        if (e?.status === 409) poke.current()
      } finally {
        sendBusy.current = false
        if (sendController.current === controller) sendController.current = null
        if (alive.current) setSending(false)
      }
    }
    const loadMoreBoard = async (column: string) => {
      if (boardBusy.current || paging) return
      const old = boardRef.current, page = old?.columns?.[column]
      if (!page?.hasMore || !page.cursor) return
      boardBusy.current = true; setPaging(column)
      const filter = { ...filterRef.current }
      try {
        const data = await call('board', { ...filter, column, cursor: page.cursor, limit: 20 })
        if (data.revision !== old.revision) { const conflict: any = new Error(); conflict.status = 409; throw conflict }
        if (!alive.current || JSON.stringify(filter) !== JSON.stringify(filterRef.current)) return
        const more = data.columns[column]
        const items = merge(array(page.items), array(more.items), (a, b) => Number(b.createdAt) - Number(a.createdAt) || String(a.id).localeCompare(String(b.id)))
        const next = { ...old, columns: { ...old.columns, [column]: { ...more, items } } }
        loaded.current[column] = items.length; boardRef.current = next; setBoard(next); setBoardError('')
      } catch (e: any) { if (alive.current) { setBoardError(e?.status === 409 ? tr('BoardResync') : messageOf(e)); poke.current() } }
      finally { boardBusy.current = false; if (alive.current) setPaging('') }
    }
    const changeFilter = (q: string, o: string) => {
      setQuery(q); setOutcome(o); filterRef.current = { query: q, outcome: o }
      loaded.current = { pending: 20, running: 20, waiting: 20, ended: 20 }
      setBoardError(tr('FilterRefreshing')); poke.current()
    }
    const openDetail = (item: any) => {
      detailFocus.current = document.activeElement as HTMLElement
      if (detailIdRef.current !== item.id) { detailRef.current = null; setDetail(null) }
      detailIdRef.current = item.id; setDetailId(item.id); setDetailTab('overview'); setDetailError('')
      void readDetail(item.id)
    }
    const closeDetail = () => { detailIdRef.current = ''; setDetailId('') }
    const openSystem = (tab: string) => {
      if (!systemRef.current) systemFocus.current = document.activeElement as HTMLElement
      if (systemRef.current !== tab) resetDocumentEvidence()
      systemRef.current = tab; setSystem(tab); setSystemError(''); void readSystem()
      if (tab === 'sources' && !sessionWorkPagesRef.current.included) void readSessionWork('included')
    }
    const closeSystem = () => { systemRef.current = ''; setSystem(''); resetDocumentEvidence() }
    const askConfirm = (kind: string, item: any, decision: string) => { setActionError(''); setReason(''); setRevisionGoal(item.brief?.goal || ''); setRevisionFirstAction(item.brief?.firstAction || ''); setConfirmation({ kind, item, decision, epoch: epochRef.current }) }
    const closeConfirm = () => { if (actionBusy.current) return; dialogRef.current?.close(); setConfirmation(null); setActionError(''); setReason('') }
    const perform = async () => {
      const value = confirmation
      if (!value || actionBusy.current || (!['admission', 'revision', 'request'].includes(value.kind) && !reason.trim())) return
      if (value.kind === 'revision' && (!revisionGoal.trim() || !revisionFirstAction.trim())) return
      if (value.epoch !== epochRef.current) { setActionError(tr('EpochChanged')); return }
      if (value.kind === 'admission' && value.decision === 'approve' && !completeBrief(value.item)) { setActionError(tr('ScopeHidden')); return }
      actionBusy.current = true; setActing(true); setActionError('')
      if (value.kind === 'stop') setStopping((old: any) => ({ ...old, [value.item.id]: true }))
      try {
        const route = value.kind === 'request' ? 'command-cancel' : value.kind === 'revision' ? 'admission-revise' : value.kind === 'admission' ? 'admission' : value.kind === 'approval' ? 'approval' : 'ticket-action'
        const body = value.kind === 'request' ? { epoch: value.epoch, requestId: value.item.payload.requestId, seq: value.item.seq } : value.kind === 'revision' ? { epoch: value.epoch, requestId: value.item.requestId, planId: value.item.planId, fingerprint: value.item.fingerprint, patch: { goal: revisionGoal.trim(), firstAction: revisionFirstAction.trim() } } : value.kind === 'admission' ? { epoch: value.epoch, requestId: value.item.requestId, planId: value.item.planId, fingerprint: value.item.fingerprint, decision: value.decision } : value.kind === 'approval' ? { id: value.item.id, fingerprint: value.item.fingerprint, decision: value.decision, reason: reason.trim() } : { id: value.item.id, action: 'stop', reason: reason.trim() }
        const result = await call(route, body)
        if (!alive.current) return
        if (value.kind === 'request') applyReceipt(value.epoch, value.item.payload, result)
        if (value.kind === 'stop' && result.state === 'ended') setStopping((old: any) => { const next = { ...old }; delete next[value.item.id]; return next })
        setNotice(value.kind === 'request' ? tr('RequestCanceled') : value.kind === 'stop' ? result.state === 'ended' ? tr('StoppedNotice') : tr('Stopping') : tr('DecisionSaved'))
        dialogRef.current?.close(); setConfirmation(null); setReason(''); poke.current()
      } catch (e: any) {
        if (!alive.current) return
        setActionError(e?.status === 409 ? tr('DecisionConflict') : messageOf(e))
        // Preserve uncertainty in the notice, but do not permanently disable retry.
        if (value.kind === 'stop') setStopping((old: any) => { const next = { ...old }; delete next[value.item.id]; return next })
        poke.current()
      } finally { actionBusy.current = false; if (alive.current) setActing(false) }
    }
    const supplement = (item: any) => {
      if (composerRef.current.pending || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveRequestFirst')); return }
      updateComposer({ target: { id: item.id, title: item.title || tr('Untitled') }, origin: null, documentOrigin: null }); setMobileTab('chat'); setCollapsed(false)
      inputRef.current?.focus()
    }
    const recreate = (item: any) => {
      if (composerRef.current.pending || composerRef.current.draft.trim() || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      if (item.state !== 'ended' || item.stoppedByHuman !== true || !detailRef.current?.brief?.goal) return
      updateComposer({ draft: detailRef.current.brief.goal, intent: 'new-task', target: null, origin: { id: item.id, title: item.title || tr('Untitled') } })
      setMobileTab('chat'); setCollapsed(false); inputRef.current?.focus()
    }
    const approvalView = (item: any) => {
      const pending = item.state === 'pending'
      const expired = typeof item.expiresAt === 'number' && item.expiresAt <= Date.now()
      const canApprove = pending && !expired && item.allowed?.approve === true && item.impact?.reviewable === true && !!item.fingerprint
      return h('article', { className: 'saw-box', key: item.id }, h('h4', null, item.summary || tr('Approval')), fields([
        ['Kind', text(item.kind)], ['State', stateName(item.state)], ['RequestedBy', text(item.requestedBy)], ['Created', time(item.createdAt)], ['Expiry', time(item.expiresAt)], ['Fingerprint', h('code', { className: 'saw-fingerprint' }, text(item.fingerprint))],
      ]), h('h4', null, tr('Impact')), valueView(item.impact?.details), item.impact?.description ? h('p', { className: 'saw-pre' }, item.impact.description) : null,
      item.impact?.reason ? h('p', { className: 'saw-error' }, `${tr('NotReviewable')}: ${item.impact.reason}`) : null,
      item.reason ? fields([['Reason', item.reason], ['DecidedBy', text(item.decidedBy)], ['DecidedAt', time(item.decidedAt)]]) : null,
      pending ? h('div', { className: 'saw-row' }, button(tr('Approve'), () => askConfirm('approval', item, 'approve'), !canApprove, { title: !canApprove ? tr('CannotApprove') : undefined }), button(tr('Reject'), () => askConfirm('approval', item, 'deny'), expired || item.allowed?.deny !== true || !item.fingerprint)) : null)
    }
    const admissionView = (plan: any, confirm = false) => h('article', { className: 'saw-box', key: plan.planId }, h('h3', null, tr('Admission')), h('p', { className: 'saw-meta' }, tr('AdmissionHint')), fields([
      ['State', stateName(plan.expiresAt <= Date.now() ? 'expired' : plan.state)], ['Fingerprint', h('code', { className: 'saw-fingerprint' }, text(plan.fingerprint))], ['Expiry', time(plan.expiresAt)], ['PolicyVersion', text(plan.policyVersion)],
    ]), briefView(plan.brief), plan.originTicket ? fields([['RecreatedFrom', text(plan.originTicket)]]) : null, plan.scopeIdentity === 'host-owner-home-relative' ? h('p', { className: 'saw-meta' }, tr('HomeRelativeScope')) : null, !completeBrief(plan) ? h('p', { className: 'saw-error' }, tr('ScopeHidden')) : null, plan.blockedReason ? h('p', { className: 'saw-error' }, plan.blockedReason) : null,
    !confirm && plan.state === 'pending' ? h('div', { className: 'saw-row' }, button(tr('ApprovePlan'), () => askConfirm('admission', plan, 'approve'), plan.epoch !== epochRef.current || plan.expiresAt <= Date.now() || !plan.fingerprint || !completeBrief(plan)), button(tr('RejectPlan'), () => askConfirm('admission', plan, 'reject'), plan.epoch !== epochRef.current || plan.expiresAt <= Date.now() || !plan.fingerprint), button(tr('RevisePlan'), () => askConfirm('revision', plan, 'revise'), plan.epoch !== epochRef.current || plan.expiresAt <= Date.now() || !plan.fingerprint || !completeBrief(plan))) : null)
    const chooseActivity = (view: string) => {
      if (activityViewRef.current === 'briefing' && messagesRef.current) briefingScroll.current = messagesRef.current.scrollTop
      activityViewRef.current = view; setActivityView(view)
      if (view === 'history') { autoScroll.current = true }
      // Returning to the brief uses the current interaction context, never moves an old draft/request.
      if (view === 'briefing' && epochRef.current && historyRef.current !== epochRef.current) {
        historyRef.current = epochRef.current; setHistoryEpoch(epochRef.current); setHistoryError('')
        void readConversation(epochRef.current)
      }
    }
    const readLatestReply = () => {
      const epoch = epochRef.current, reply = conversations.current[epoch]?.latestAssistant
      if (!reply || !Number.isSafeInteger(reply.lastSeq)) return
      replyReadThrough.current[epoch] = reply.lastSeq; setNewReplies(0)
      try { sessionStorage.setItem(`superagent.reply-read.v1:${encodeURIComponent(epoch)}`, String(reply.lastSeq)) } catch {}
    }
    const openReply = () => {
      inspectorOpener.current = document.activeElement as HTMLElement
      setPlanReview(''); chooseActivity('briefing'); setMobileTab('chat'); setCollapsed(false); setReplyOpen(true); readLatestReply()
    }
    const startTask = () => {
      chooseActivity('briefing'); setMobileTab('chat'); setCollapsed(false)
      if (composerRef.current.pending || composerRef.current.target || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); inputRef.current?.focus(); return }
      updateComposer({ intent: 'new-task', origin: null, documentOrigin: null }); inputRef.current?.focus()
    }
    const replyToCoordinator = () => {
      if (composerRef.current.pending || composerRef.current.target || composerRef.current.draft.trim() || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      chooseActivity('briefing'); setMobileTab('chat'); setCollapsed(false); updateComposer({ intent: 'message', origin: null, documentOrigin: null }); inputRef.current?.focus()
    }
    const chooseDraftEpoch = (epoch: string) => {
      if (sendBusy.current) return
      draftEpochRef.current = epoch; setDraftEpoch(epoch)
      const next = composerCache.current[epoch] || readComposer(epoch)
      composerCache.current[epoch] = next; composerRef.current = next; setComposer(next)
    }
    const oldDraft = !!draftEpoch && draftEpoch !== workspace?.epoch
    const archive = !!historyEpoch && historyEpoch !== workspace?.epoch
    const currentMessages = conversation[historyEpoch]
    const pendingPlans = array(workspace?.admissions).filter(plan => plan.state === 'pending' || plan.state === 'approved')
    const desk = deskState(workspace, Date.now(), !!error)
    const todoCount = desk.actionTotal
    const boardScopeKnown = board?.scope?.kind === 'superagent-ledger' && board.scope.otherSessions === 'not-included'
    const sessionWork = workspace?.sessionWork
    const sessionCoverage = !error && sessionWork?.scope === 'current-host' && ['ready', 'partial'].includes(sessionWork?.state) ? sessionWork.state : 'unavailable'
    const latest = composer.receipt
    const pendingRequest = composer.pending
    const item = detail?.ticket
    const reviewingPlan = pendingPlans.find(plan => plan.planId === planReview)
    const latestAssistant = conversation[workspace?.epoch]?.latestAssistant
    const openTaskRecord = (record: any, tab = 'overview') => {
      closeSystem(); setMobileTab('board'); openDetail({ id: record.ticketId || record.id }); setDetailTab(tab)
    }
    const showAllTasks = () => { closeSystem(); changeFilter('', ''); setMobileTab('board'); setNotice(tr('AllTasksUnfiltered')) }
    const openPlan = (plan: any) => { inspectorOpener.current = document.activeElement as HTMLElement; setReplyOpen(false); closeSystem(); setPlanReview(plan.planId); setMobileTab('chat'); setCollapsed(false); chooseActivity('briefing') }
    const decisionView = (entry: any) => {
      const data = entry.data, plan = entry.kind === 'plan'
      return h('article', { className: 'saw-decision', key: entry.id },
        h('small', { className: 'saw-meta' }, tr(plan ? 'PlanNeedsReview' : entry.kind === 'approval' ? 'OperationNeedsReview' : entry.kind === 'question' ? 'QuestionForYou' : 'TaskNeedsReview')),
        h('h4', null, plan ? data.brief?.goal || tr('Untitled') : data.title || tr('Untitled')),
        h('p', { className: 'saw-line-clamp' }, plan ? data.brief?.firstAction || tr('ReviewPlanHint') : entry.kind === 'anomaly' ? tr('StateConflict') : data.summary || tr('InformationNeeded')),
        button(tr(plan ? 'ReviewPlan' : entry.kind === 'question' ? 'ReadAndAnswer' : entry.kind === 'approval' ? 'ReviewApproval' : 'OpenTask'), () => plan ? openPlan(data) : data.ticketId ? openTaskRecord(data, entry.kind === 'approval' ? 'approvals' : 'overview') : openSystem('todo'), false, { className: 'saw-btn saw-action-primary' }))
    }
    const recordView = (entry: any) => {
      const record = entry.data, confirmed = entry.kind === 'confirmed-plan', result = entry.kind === 'result'
      return h('button', { type: 'button', className: 'saw-record-row', key: entry.id, onClick: () => confirmed ? openPlan(record) : openTaskRecord(record, result ? 'results' : 'overview') },
        h('span', { className: 'saw-record-heading' }, h('strong', null, displayTitle(confirmed ? record.brief?.goal : record.title)), h('span', { className: 'saw-badge' }, confirmed ? tr('ConfirmedPlan') : record.anomaly ? tr('NeedsReview') : record.disabledReason ? tr('ExecutionOff') : stateName(result ? record.outcome : record.state))),
        h('span', { className: 'saw-record-summary' }, confirmed ? tr('PlanApprovedBlocked') : record.progress || record.nextAction || tr(result ? 'ResultDetails' : 'TaskDetails')))
    }
    const resultView = () => {
      const summary = reportSummary(detail)
      const humanPending = !!item?.attention || item?.pendingApprovals > 0 || item?.anomaly || item?.state === 'waiting_human'
      const listSection = (heading: string, values: string[] | null, empty: string) => h('section', { className: 'saw-result-section' }, h('h3', null, tr(heading)), values?.length ? h('ul', { className: 'saw-list' }, ...values.map((value, i) => h('li', { key: i }, value))) : h('p', { className: 'saw-meta' }, tr(values === null ? 'SummaryUnavailable' : empty)))
      return h(React.Fragment, null,
        h('div', { className: 'saw-result-status' }, h('span', { className: 'saw-badge' }, stateName(item?.state === 'ended' ? item.outcome : item?.state)), h('span', { className: 'saw-meta' }, tr('RecordedResultOnly'))),
        summary.ambiguous ? h('p', { className: 'saw-error' }, tr('LatestAttemptUnknown')) : null,
        !summary.report ? h('p', { className: 'saw-meta' }, tr('NoCurrentReport')) : h(React.Fragment, null,
          listSection('ReportedWork', summary.done, 'NoWorkReported'),
          h('section', { className: 'saw-result-section' }, h('div', { className: 'saw-group-head' }, h('h3', null, tr('ReportedChecks')), h('span', { className: 'saw-meta' }, summary.malformedAcceptance ? tr('ChecksNeedReview') : `${summary.passed} / ${summary.total} ${tr('ReportedPass')}`)),
            summary.malformedAcceptance ? h('p', { className: 'saw-error' }, tr('ChecksIncomplete')) : null,
            !summary.acceptance.length ? h('p', { className: 'saw-meta' }, tr('NoChecksDefined')) : h('ul', { className: 'saw-checks' }, ...summary.acceptance.map((check: any, i: number) => h('li', { key: i }, h('div', { className: 'saw-check-heading' }, h('strong', null, check.check || text(check.id)), h('span', { className: 'saw-badge' }, tr(check.result === 'passed' ? 'CheckPassed' : check.result === 'failed' ? 'CheckFailed' : check.result === 'not-run' ? 'CheckNotRun' : 'Unknown'))), check.evidence ? h('p', { className: 'saw-pre' }, check.evidence) : h('p', { className: 'saw-meta' }, tr('EvidenceUnavailable'))))))),
        h('section', { className: 'saw-result-section' }, h('h3', null, tr('NeedsYourAttention')),
          humanPending ? h(React.Fragment, null, h('p', null, tr(item?.anomaly ? 'StateConflict' : item?.pendingApprovals > 0 ? 'ApprovalStillPending' : 'InformationNeeded')), item?.attention ? valueView(item.attention) : null, item?.pendingApprovals > 0 ? button(tr('ReviewApproval'), () => setDetailTab('approvals')) : null) : null,
          summary.needHuman?.length ? h('ul', { className: 'saw-list' }, ...summary.needHuman.map((value, i) => h('li', { key: i }, value))) : !humanPending ? h('p', { className: 'saw-meta' }, tr(summary.needHuman === null ? 'SummaryUnavailable' : 'NoHumanRequestReported')) : null),
        summary.report && (summary.risks === null || summary.risks.length) ? listSection('ReportedRisks', summary.risks, 'None') : null,
        summary.report && (summary.todo === null || summary.todo.length) ? listSection('ReportedNextSteps', summary.todo, 'None') : null,
        h('details', { className: 'saw-result-technical', key: `${detailId}:attempts` }, h('summary', null, `${tr('AttemptsAndReports')} · ${array(detail.assignments).length}`),
          ...array(detail.assignments).map((assignment: any, index: number) => h('article', { className: 'saw-box', key: assignment.id || index }, h('h3', null, `${tr('Attempt')} ${index + 1}`), fields([['State', stateName(assignment.state)], ['Started', time(assignment.startedAt)], ['EndedAt', time(assignment.endedAt)], ['LastProgress', time(assignment.lastProgressAt)], ['Steps', text(assignment.steps)], ['Tokens', text(assignment.usage)]]), assignment.report ? h('details', null, h('summary', null, tr('OriginalReport')), valueView(assignment.report)) : h('p', null, tr('NoReport'))))),
        h('details', { className: 'saw-result-technical', key: `${detailId}:delivery` }, h('summary', null, tr('Delivery')), valueView(detail.delivery), h('p', { className: 'saw-meta' }, tr('NoReadAck'))))
    }
    const sessionSourceTitle = (row: any) => {
      const value = typeof row.title === 'string' ? row.title.trim() : ''
      return !value || value === row.sessionId || /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(value) ? tr('SessionWorkUntitled') : displayTitle(value)
    }
    const sessionWorkCard = (row: any, manage = false, revision?: string) => {
      const structured = row.evidence === 'structured', summary = structured && (row.objective || row.progress || row.nextAction || row.blocker || row.decision)
      return h('article', { className: 'saw-session-work-card', key: row.sessionId },
        row.excluded ? h(React.Fragment, null, h('h4', null, sessionSourceTitle(row)), h('small', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${String(row.sessionId).slice(-8)}`)) : h(React.Fragment, null,
          h('h4', null, structured && row.objective ? displayTitle(row.objective) : tr(summary ? 'SessionWorkKnownWork' : 'SessionWorkNoSummary')),
          h('p', { className: 'saw-meta saw-session-source' }, `${tr('SessionWorkFrom')}: ${sessionSourceTitle(row)}`),
          summary ? h(React.Fragment, null,
            row.progress ? h('p', { className: 'saw-session-line' }, row.progress) : null,
            row.nextAction ? h('p', { className: 'saw-session-line' }, `${tr('SessionWorkNext')}: ${row.nextAction}`) : null,
            row.blocker ? h('p', { className: 'saw-session-line' }, `${tr('SessionWorkBlocker')}: ${row.blocker}`) : null,
            row.decision ? h('div', { className: 'saw-session-decision' }, h('strong', null, tr('SessionWorkDecision')), h('p', null, row.decision), h('small', null, tr('SessionWorkAnswerAtSource'))) : null) : null,
          h('div', { className: 'saw-session-facts' },
            structured && row.goalPhase ? h('span', null, `${tr('SessionWorkGoalPhase')}: ${tr(row.goalPhase === 'active' ? 'SessionWorkGoalActive' : row.goalPhase === 'paused' ? 'SessionWorkGoalPaused' : row.goalPhase === 'complete' ? 'SessionWorkGoalCompleted' : row.goalPhase === 'blocked' ? 'SessionWorkGoalBlocked' : 'Unknown')}`) : null,
            h('span', null, tr(row.runtime === 'running' ? 'SessionWorkRuntimeRunning' : row.runtime === 'idle' ? 'SessionWorkRuntimeIdle' : row.runtime === 'unavailable' ? 'SessionWorkRuntimeUnavailable' : 'SessionWorkRuntimeUnknown')),
            h('span', null, `${tr('Snapshot')}: ${time(row.observedAt)}`))),
        manage ? button(tr(row.excluded ? 'SessionWorkRestore' : 'SessionWorkExclude'), () => { void setSessionIncluded(row, row.excluded === true, revision) }, !!sessionWorkBusy || !revision, { className: 'saw-btn saw-text-btn' }) : null)
    }
    const sessionWorkPreview = () => h('section', { className: 'saw-session-work', 'aria-label': tr('SessionWorkTitle') },
      h('div', { className: 'saw-group-head' }, h('h3', null, tr('SessionWorkTitle')), button(tr('SessionWorkMore'), () => openSystem('sources'))),
      h('p', { className: 'saw-meta' }, tr('SessionWorkReadonly')),
      sessionCoverage !== 'ready' ? h('p', { className: 'saw-meta' }, tr(sessionCoverage === 'partial' ? 'SessionWorkPartial' : 'SessionWorkUnavailable')) : null,
      ...array(sessionWork?.items).filter(row => row.excluded !== true).slice(0, 6).map(row => sessionWorkCard(row)),
      sessionCoverage === 'ready' && sessionWork.total === 0 && !array(sessionWork.items).length ? h('p', { className: 'saw-meta' }, tr('SessionWorkEmpty')) : null)
    const sessionWorkSources = () => {
      const included = sessionWorkPages.included, excluded = sessionWorkPages.excluded
      const excludedTotal = included?.excludedTotal ?? sessionWork?.excludedTotal
      return h('section', { className: 'saw-session-work saw-session-sources', 'aria-label': tr('SessionWorkSources') },
        h('h3', null, tr('SessionWorkSources')), h('p', { className: 'saw-meta' }, tr('SessionWorkDefault')), h('p', { className: 'saw-meta' }, tr('SessionWorkReadonly')),
        h('div', { className: 'saw-row' }, button(tr('SessionWorkRefresh'), () => { void (async () => { await readSessionWork('included'); if (excludedOpenRef.current) await readSessionWork('excluded') })() }, !!sessionWorkBusy), sessionWorkBusy ? h('span', { role: 'status', className: 'saw-meta' }, tr('Loading')) : null),
        sessionWorkError ? h('p', { className: 'saw-error', role: 'alert' }, sessionWorkError) : null,
        included?.state !== 'ready' ? h('p', { className: 'saw-meta' }, tr(included?.state === 'partial' ? 'SessionWorkPartial' : 'SessionWorkUnavailable')) : null,
        included ? h('p', { className: 'saw-meta' }, `${tr('SessionWorkIncludedCount')}: ${text(included.total)} · ${tr('Snapshot')}: ${time(included.sampledAt)}`) : null,
        ...array(included?.items).filter(row => row.excluded !== true).map(row => sessionWorkCard(row, true, included.revision)),
        included?.state === 'ready' && included.total === 0 ? h('p', { className: 'saw-meta' }, tr('SessionWorkEmpty')) : null,
        included?.hasMore && included.next ? button(tr('SessionWorkLoadMore'), () => { void readSessionWork('included', true) }, !!sessionWorkBusy) : null,
        h('details', { className: 'saw-session-excluded', open: excludedOpen, onToggle: toggleExcluded }, h('summary', null, `${tr('SessionWorkExcludedList')} · ${text(excludedTotal)}`),
          h('p', { className: 'saw-meta' }, tr('SessionWorkExcludedHint')),
          excludedOpen ? h(React.Fragment, null,
            !excluded ? button(tr('SessionWorkLoadExcluded'), () => { void readSessionWork('excluded') }, !!sessionWorkBusy) : null,
            excluded && excluded.state !== 'ready' ? h('p', { className: 'saw-meta' }, tr(excluded.state === 'partial' ? 'SessionWorkPartial' : 'SessionWorkUnavailable')) : null,
            ...array(excluded?.items).map(row => sessionWorkCard({ ...row, excluded: true }, true, excluded.revision)),
            excluded?.state === 'ready' && excluded.total === 0 ? h('p', { className: 'saw-meta' }, tr('SessionWorkNoExcluded')) : null,
            excluded?.hasMore && excluded.next ? button(tr('SessionWorkLoadMore'), () => { void readSessionWork('excluded', true) }, !!sessionWorkBusy) : null) : null))
    }
    const briefingView = () => h(React.Fragment, null,
      array(workspace?.documentSources).length ? button(tr('DocumentReadEntry'), () => openSystem('sources'), false, { className: 'saw-btn saw-text-btn' }) : null,
      !workspace ? h('p', { className: 'saw-meta' }, tr(error ? 'SyncFailed' : 'Loading')) : !desk.ready ? h('div', { className: 'saw-inline-state' }, h('p', null, tr('BriefingUnavailable')), button(tr('Retry'), () => poke.current())) : null,
      error && workspace ? h('p', { className: 'saw-meta' }, tr('RecordsStale')) : null,
      newReplies && latestAssistant ? h('article', { className: 'saw-new-reply' }, h('strong', null, tr('CoordinatorReplied')), h('p', { className: 'saw-line-clamp' }, latestAssistant.text), button(tr('ReadAndReply'), openReply)) : null,
      (desk.actions.length || (desk.actionTotal ?? 0) > 0) ? h('section', { className: 'saw-briefing-group', 'aria-label': tr('YourDecisions') }, h('div', { className: 'saw-group-head' }, h('h3', null, tr('YourDecisions')), h('span', { className: 'saw-count' }, text(desk.actionTotal))), ...desk.actions.map(decisionView), desk.moreActions ? h('div', { className: 'saw-row' }, button(tr('MorePlansApprovals'), () => openSystem('todo')), button(tr('MoreQuestions'), showAllTasks)) : null) : desk.ready && desk.actionTotal === 0 && !error && !newReplies ? h('div', { className: 'saw-idle' }, h('span', { className: 'saw-idle-icon', 'aria-hidden': true }, '+'), h('h3', null, tr('SessionWorkLedgerNoDecision')), h('p', null, tr(!boardScopeKnown ? 'CoveragePendingHint' : 'SessionWorkLedgerHint')), button(tr('StartPlanning'), startTask, !!pendingRequest || !!composer.target || oldDraft), h('small', { className: 'saw-meta' }, tr('PlanningSteps'))) : null,
      sessionWorkPreview(),
      (desk.records.length || (desk.recordTotal ?? 0) > 0) ? h('section', { className: 'saw-recent', 'aria-label': tr('RecentActivity') }, h('div', { className: 'saw-group-head' }, h('h3', null, tr('RecentActivity')), desk.moreRecords ? button(tr('AllTasks'), showAllTasks) : null), ...desk.records.map(recordView), pendingPlans.some(plan => plan.state === 'approved' && plan.expiresAt > Date.now()) && desk.moreRecords ? button(tr('MorePlansApprovals'), () => openSystem('todo')) : null) : null)
    const documentEvidenceView = (entry: any, detail: any) => {
      const allRendered = array(detail.screenshots).every(image => documentImages[image.digest]?.loaded === true)
      const canPlan = documentCanPlan(entry, detail)
      const reviewable = entry.reviewable === true && detail.reviewable === true && entry.state === 'blocked' && entry.eligible === false && detail.eligible === false
      const canReview = documentCanReview(entry, detail)
      const draftOccupied = !!pendingRequest || !!composer.draft.trim() || !!composer.target || !!composer.origin || !!composer.documentOrigin || oldDraft || archive
      return h('section', { className: 'saw-document-evidence' }, h('h4', null, tr('DocumentOriginal')), h('p', { className: 'saw-pre' }, detail.text),
        h('p', { className: 'saw-meta' }, `${text(detail.location?.sourceId)} · ${text(detail.location?.sheet)} · ${text(detail.location?.row)} · ${text(detail.location?.range)}`),
        ...array(detail.cells).map((cell: any, i: number) => h('div', { className: 'saw-document-cell', key: i }, h('strong', null, text(cell.column)), h('span', { className: 'saw-badge' }, tr(cell.strike === 'no' ? 'DocumentNotStruck' : cell.strike === 'yes' ? 'DocumentStruck' : 'DocumentStrikeUnknown')), h('p', { className: 'saw-pre' }, cell.text))),
        h('p', { className: 'saw-meta' }, tr('DocumentSnapshotWarning')), h('p', { className: 'saw-meta' }, `${tr('Snapshot')}: ${time(detail.at)}`),
        ...array(detail.warnings).map((warning: any, i: number) => h('p', { key: i, className: 'saw-error' }, text(warning))),
        reviewable ? h('div', { className: 'saw-banner' }, h('p', null, tr('DocumentUnknownReviewWarning')), validDocumentLink(detail.documentLink) ? h('a', { href: detail.documentLink, target: '_blank', rel: 'noopener noreferrer' }, tr('DocumentOpenOfficial')) : h('p', { className: 'saw-error' }, tr('DocumentOfficialUnavailable'))) : null,
        button(tr('DocumentLoadImages'), () => { void loadDocumentImages() }, !!documentBusy || !array(detail.screenshots).length),
        !array(detail.screenshots).length ? h('p', { className: 'saw-error' }, tr('DocumentNoImages')) : null,
        ...array(detail.screenshots).map((image: any, i: number) => h('figure', { key: `${detail.documentOrigin.revision}:${image.digest}:${i}`, className: 'saw-document-image' }, h('figcaption', null, `${tr('DocumentCell')}: ${text(image.cell)}`),
          documentImages[image.digest]?.src ? h('img', { src: documentImages[image.digest].src, alt: `${tr('DocumentCell')}: ${text(image.cell)}`, onLoad: () => documentImageRendered(detail, image.digest, true), onError: () => documentImageRendered(detail, image.digest, false) }) : h('p', { className: 'saw-meta' }, tr('DocumentImageNotLoaded')))),
        h('label', { className: 'saw-document-review' }, h('input', { type: 'checkbox', checked: documentReviewed, disabled: !allRendered || !!documentBusy, onChange: (e: any) => { documentReviewedRef.current = e.target.checked === true; setDocumentReviewed(e.target.checked === true) } }), tr(reviewable ? 'DocumentVerifyOriginalNotStruck' : 'DocumentReviewed')),
        reviewable ? button(tr('DocumentConfirmNotStruck'), () => { void reviewDocument(entry) }, !canReview || draftOccupied || !!documentBusy || workspace?.capabilities?.send !== true, { title: tr('DocumentPlanOnly') }) : null,
        h('p', { className: 'saw-meta' }, tr('DocumentReviewHint')), button(tr('DocumentGeneratePlan'), () => prepareDocumentPlan(entry), !canPlan || draftOccupied || !!documentBusy || workspace?.capabilities?.send !== true, { title: tr('DocumentPlanOnly') }),
        h('p', { className: 'saw-meta' }, tr('DocumentPlanOnly')))
    }
    const documentSourcesView = () => {
      const configured = array(workspace?.documentSources).map(source => ({ ...source, ...array(documents?.sources).find(row => row.id === source.id) }))
      if (!configured.length) return null
      return h('section', { className: 'saw-document-sources' }, h('h3', null, tr('DocumentSources')), h('p', { className: 'saw-meta' }, tr('DocumentConfigHint')),
        h('div', { className: 'saw-row' }, button(tr('DocumentLocalList'), () => { void readDocuments() }, !!documentBusy), documentBusy ? h('span', { role: 'status' }, tr('Loading')) : null),
        documentError ? h('p', { className: 'saw-error', role: 'alert' }, documentError) : null,
        ...configured.map((source: any) => h('article', { key: source.id, className: 'saw-box' }, h('h4', null, source.id), h('p', { className: 'saw-meta' }, `${text(source.sheet)} · ${text(source.range)}`), button(tr('DocumentReadOnce'), () => { void readDocuments(source.id) }, !!documentBusy))),
        documentScanResult ? h('section', { className: 'saw-box' }, h('p', null, `${text(documentScanResult.sourceId)} · ${time(documentScanResult.at)}`), fields([['DocumentRead', text(documentScanResult.read)], ['DocumentEligible', text(documentScanResult.eligible)], ['DocumentBlocked', text(documentScanResult.blocked)]]), valueView(documentScanResult.issues)) : null,
        documents?.hasMore === true || Number(documents?.total) > array(documents?.items).length ? h('div', { className: 'saw-row' }, h('p', { className: 'saw-meta' }, tr('DocumentListPartial')), documents?.hasMore && documents?.cursor ? button(tr('DocumentMoreCandidates'), () => { void readDocuments(undefined, true) }, !!documentBusy) : null) : null,
        documents && !array(documents.items).length ? h('p', { className: 'saw-meta' }, tr('DocumentNoCandidates')) : null,
        ...array(documents?.items).map((entry: any) => {
          const selected = documentDetail?.documentOrigin?.itemKey === entry.itemKey && documentDetail?.documentOrigin?.revision === entry.revision ? documentDetail : null
          const source = configured.find((row: any) => row.id === entry.sourceId)
          return h('article', { className: 'saw-box', key: entry.itemKey }, h('h4', null, displayTitle(entry.title)), h('p', { className: 'saw-meta' }, `${text(entry.sourceId)} · ${text(source?.sheet)} · ${text(source?.range)}`),
            h('span', { className: 'saw-badge' }, stateName(entry.state)), h('p', { className: 'saw-meta' }, `${tr('Snapshot')}: ${time(entry.at)} · ${tr('DocumentSnapshotWarning')}`),
            ...array(entry.warnings).map((warning: any, i: number) => h('p', { key: i, className: 'saw-error' }, text(warning))),
            button(tr(selected ? 'DocumentCloseOriginal' : 'DocumentOpenOriginal'), () => { if (selected) resetDocumentEvidence(); else void openDocument(entry) }, !!documentBusy), selected ? documentEvidenceView(entry, selected) : null)
        }))
    }
    const systemContent = () => {
      const data = systemData[system] || (system === 'sources' ? {} : null)
      if (!data) return h('p', null, tr('Loading'))
      if (system === 'todo') return h(React.Fragment, null, h('h3', null, tr('Admission')), ...pendingPlans.map(plan => admissionView(plan)), !pendingPlans.length ? h('p', null, tr('NoPlans')) : null, h('h3', null, tr('InformationNeeded')), h('p', { className: 'saw-meta' }, tr('QuestionsOnBoard')), button(tr('AllTasks'), showAllTasks), h('h3', null, tr('Approvals')), h('p', { className: 'saw-meta' }, tr('ApprovalWindow')), ...array(data.items).map(approvalView), !array(data.items).length ? h('p', null, tr('NoApprovals')) : null, data.next ? button(tr('MoreApprovals'), () => { void readSystem(true) }, systemBusy.current) : null)
      if (system === 'sources') return h(React.Fragment, null, sessionWorkSources(), documentSourcesView(), h('p', null, tr('Readonly')),  ...array(data.sources).map((source: any, i: number) => h('article', { className: 'saw-box', key: source.id || i }, h('h3', null, source.id || tr('Source')), fields([['Kind', text(source.kind)], ['Health', source.ok === true ? tr('Healthy') : source.ok === false ? tr('Unhealthy') : tr('Unknown')], ['LastEvent', time(source.lastAt)], ['Paused', source.paused === true ? tr('Yes') : source.paused === false ? tr('No') : tr('Unknown')], ['Attended', source.attended === true ? tr('Yes') : source.attended === false ? tr('No') : tr('Unknown')]]))), !array(data.sources).length ? h('p', null, tr('NoSources')) : null)
      if (system === 'settings') {
        const groups: Record<string, any[]> = {}
        const groupFor = (key: string) => /stateDir|dbPath|lockPath|workRoot/.test(key) ? 'storage' : /watchdog|stall|repeat|waitingHuman/.test(key) ? 'supervision' : /approval|confirm/.test(key) ? 'approvals' : /^max|queueLimit/.test(key) ? 'budgets' : /roleTools|routerReadScope|sources|acceptMode|bots/.test(key) ? 'permissions' : 'runtime'
        for (const entry of array(data.effective)) (groups[groupFor(String(entry.key))] ||= []).push(entry)
        const groupNames: Record<string, string> = { runtime: 'Runtime', budgets: 'Budgets', budget: 'Budgets', watchdog: 'Supervision', supervision: 'Supervision', approvals: 'Approvals', approval: 'Approvals', storage: 'Storage', policy: 'Permissions', permissions: 'Permissions', other: 'Other' }
        return h(React.Fragment, null, h('p', null, tr('Readonly')), ...Object.entries(groups).map(([group, entries]) => h('section', { key: group, className: 'saw-box' }, h('h3', null, tr(groupNames[group] || 'Other')), ...entries.map((entry: any) => h('div', { key: entry.key, className: 'saw-setting' }, h('h4', null, entry.key), valueView(entry.redacted || /^(stateDir|dbPath|lockPath|workRoot)$/.test(entry.key) ? '[REDACTED_PATH]' : entry.value), h('p', { className: 'saw-meta' }, `${tr('Origin')}: ${text(entry.origin)}${entry.originDetail ? ` · ${entry.originDetail}` : ''}`))))))
      }
      return h(React.Fragment, null, h('p', null, tr('Readonly')), ...[['Runtime', data.runtime], ['Database', data.db], ['Workers', data.workers], ['Supervision', data.watchdog], ['Outbox', data.outbox], ['RecentErrors', data.recentErrors]].map(([key, value]) => h('section', { key, className: 'saw-box' }, h('h3', null, tr(key)), valueView(value))))
    }
    return h('section', { className: 'saw', 'aria-label': tr('Workspace') }, h('style', null, css),
      h('header', { className: 'saw-top' }, h('h1', null, tr('Title')), h('div', { className: 'saw-connection' }, h('span', { title: `${tr('LastSync')}: ${time(lastSync)}` }, error ? tr('Disconnected') : workspace ? tr('Connected') : tr('Connecting'))), h('span', { className: 'saw-coverage' }, tr(sessionCoverage === 'ready' ? 'SessionWorkCoverageReady' : sessionCoverage === 'partial' ? 'SessionWorkCoveragePartial' : 'SessionWorkCoverageUnavailable')),
        h('label', { className: 'saw-search' }, h('span', { className: 'saw-sr' }, tr('Search')), h('input', { type: 'search', value: query, maxLength: 200, placeholder: tr('Search'), onChange: (e: any) => changeFilter(e.target.value, outcome) })),
        h('label', null, h('span', { className: 'saw-sr' }, tr('OutcomeFilter')), h('select', { value: outcome, onChange: (e: any) => changeFilter(query, e.target.value), 'aria-label': tr('OutcomeFilter') }, h('option', { value: '' }, tr('AllOutcomes')), ...['completed', 'failed', 'stopped', 'dropped'].map(key => h('option', { value: key, key }, stateName(key))))),
        button(`${tr('Todo')}${todoCount === null ? '' : ` · ${todoCount}`}`, () => openSystem('todo')), button(tr('Sync'), () => poke.current()), button(tr('System'), () => openSystem('health'))),
      h('details', { className: 'saw-boundary' }, h('summary', null, h('span', { className: 'saw-safety-dot', 'aria-hidden': true }), tr(workspace?.capabilities?.workerExecution === false ? 'PlanningOnly' : 'ExecutionUnknown')), h('p', null, tr('BoundaryBody'))),
      workspace?.model?.available === false ? h('div', { className: 'saw-banner' }, tr('ModelUnavailable')) : null,
      workspace && workspace.capabilities?.send !== true ? h('div', { className: 'saw-banner' }, tr('SendUnavailable')) : null,
      error ? h('div', { className: 'saw-error saw-banner', role: 'alert' }, error, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => poke.current())) : null,
      storageError ? h('div', { className: 'saw-error saw-banner' }, tr('StorageUnavailable')) : null,
      h('div', { className: 'saw-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, notice),
      h('nav', { className: 'saw-mobile-tabs', 'aria-label': tr('WorkspaceView') }, ...['board', 'chat'].map(tab => button(`${tr(tab === 'board' ? 'Board' : 'DeskTitle')}${tab === 'chat' && newReplies ? ' •' : ''}`, () => setMobileTab(tab), false, { key: tab, 'aria-pressed': mobileTab === tab }))),
      h('div', { className: `saw-workspace${collapsed ? ' saw-collapsed' : ''}`, 'data-mobile-tab': mobileTab },
        h('section', { className: 'saw-chat', 'aria-label': tr('DeskTitle') }, h('div', { className: 'saw-section-head' }, h('h2', null, tr(activityView === 'history' ? 'DialogueHistory' : 'DeskTitle')), h('div', { className: 'saw-head-actions' }, button(`${tr(activityView === 'history' ? 'BackToDesk' : 'HistoryShort')}${newReplies ? ' •' : ''}`, () => chooseActivity(activityView === 'history' ? 'briefing' : 'history'), false, { className: 'saw-btn saw-text-btn', ref: historyButtonRef }), button(`${collapsed ? '›' : '‹'}${newReplies ? ' •' : ''}`, () => setCollapsed(!collapsed), !!planReview || replyOpen, { className: 'saw-btn saw-collapse', 'aria-label': `${tr(collapsed ? 'ExpandChat' : 'CollapseChat')}${newReplies ? ` · ${tr('CoordinatorReplied')}` : ''}`, title: tr(collapsed ? 'ExpandChat' : 'CollapseChat') }))),
          h('div', { className: 'saw-chat-inner' },
            activityView === 'history' && array(workspace?.archiveEpochs).length ? h('label', { className: 'saw-history-selector' }, tr('HistoryGroup'), h('select', { value: historyEpoch, disabled: !!planReview || replyOpen, onChange: (e: any) => { const epoch = e.target.value; historyRef.current = epoch; setHistoryEpoch(epoch); autoScroll.current = true; setHistoryError(''); void readConversation(epoch) } }, h('option', { value: workspace.epoch }, tr('CurrentConversation')), ...array(workspace.archiveEpochs).map((row: any, index: number) => h('option', { value: row.epoch, key: row.epoch }, `${tr('ArchivedConversation')} ${index + 1} · ${time(row.createdAt)}`)))) : null,
          archive ? h('p', { className: 'saw-banner' }, tr('ArchiveReadonly')) : null,
          historyError ? h('p', { className: 'saw-error' }, historyError, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => { void readConversation(historyEpoch) })) : null,
          h('div', { className: 'saw-messages', inert: planReview || replyOpen ? true : undefined, ref: messagesRef, onScroll: (e: any) => { const node = e.currentTarget; autoScroll.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80 }, 'aria-label': tr(activityView === 'briefing' ? 'DeskTitle' : 'ConversationHistory') },
            activityView === 'briefing' ? briefingView() : h(React.Fragment, null,
            latestAssistant ? button(tr('ReadLatestReply'), openReply, false, { className: 'saw-btn saw-text-btn' }) : null,
            h('details', { className: 'saw-history-info' }, h('summary', null, tr('HistoryInfo')), h('p', { className: 'saw-meta' }, tr('HistoryRecordHint'))),
            currentMessages?.hasMore && currentMessages.nextBefore ? button(tr('OlderMessages'), () => { const node = messagesRef.current; if (node) historyAnchor.current = { epoch: historyEpoch, top: node.scrollTop, height: node.scrollHeight }; void readConversation(historyEpoch, currentMessages.nextBefore) }, historyBusy.current) : null,
            !currentMessages ? h('p', { className: 'saw-meta' }, historyError ? tr('HistoryUnavailable') : tr('Connecting')) : !array(currentMessages.items).length ? h('div', { className: 'saw-empty' }, h('h3', null, tr('StartHere')), h('p', null, tr('StartHint'))) : null,
            ...array(currentMessages?.items).map((message: any) => h('article', { className: `saw-message saw-message-${message.kind}`, key: message.id }, h('div', { className: 'saw-message-head' }, h('strong', null, stateName(message.kind)), h('time', null, time(message.at))), h('p', { className: 'saw-pre' }, message.text), message.stage ? h('details', { className: 'saw-message-technical' }, h('summary', null, tr('TechnicalDetails')), h('small', { className: 'saw-meta' }, `${tr('DeliveryStage')}: ${stateName(message.stage)}`)) : null)),
            !archive ? pendingPlans.map(plan => admissionView(plan)) : null)),
          planReview ? h('section', { className: 'saw-inspector', role: 'dialog', 'aria-modal': false, 'aria-label': tr('ReviewPlan'), onKeyDown: (e: any) => { if (e.key === 'Escape' && !confirmation) { e.stopPropagation(); setPlanReview('') } } }, h('header', { className: 'saw-detail-head' }, h('h3', null, tr('ReviewPlan')), button('×', () => setPlanReview(''), false, { ref: planFocus, 'aria-label': tr('CloseDetails') })), h('div', { className: 'saw-inspector-scroll' }, reviewingPlan ? admissionView(reviewingPlan) : h('p', null, tr('PlanChanged')))) : null,
          replyOpen && latestAssistant ? h('section', { className: 'saw-inspector', role: 'dialog', 'aria-modal': false, 'aria-label': tr('CoordinatorReplied'), onKeyDown: (e: any) => { if (e.key === 'Escape') { e.stopPropagation(); setReplyOpen(false) } } }, h('header', { className: 'saw-detail-head' }, h('h3', null, tr('CoordinatorReplied')), button('×', () => setReplyOpen(false), false, { ref: replyFocus, 'aria-label': tr('CloseDetails') })), h('div', { className: 'saw-inspector-scroll' }, h('p', { className: 'saw-pre' }, latestAssistant.text), h('small', { className: 'saw-meta' }, time(latestAssistant.at))), h('footer', { className: 'saw-detail-actions' }, button(tr('Reply'), () => { inspectorReturnToInput.current = true; setReplyOpen(false); replyToCoordinator() }, !!pendingRequest || !!composer.target || !!composer.draft.trim() || oldDraft, { title: tr('ReplyKeepsDraft') }))) : null,
          h('form', { className: 'saw-composer', inert: planReview || replyOpen ? true : undefined, onSubmit: (e: any) => { e.preventDefault(); void submit() } },
            array(workspace?.archiveEpochs).length ? h('label', { className: 'saw-history-selector' }, tr('DraftGroup'), h('select', { value: draftEpoch, disabled: sending, onChange: (e: any) => chooseDraftEpoch(e.target.value) }, h('option', { value: workspace.epoch }, tr('CurrentDraft')), ...array(workspace.archiveEpochs).map((row: any, index: number) => h('option', { value: row.epoch, key: row.epoch }, `${tr('ArchivedDraft')} ${index + 1}`)))) : null,
            oldDraft ? h('p', { className: 'saw-banner' }, tr('OldDraftHint')) : null,
            composer.target ? h('div', { className: 'saw-chip' }, `${tr('SupplementTo')}: ${composer.target.title}`, button('×', () => updateComposer({ target: null }), sending || !!pendingRequest, { 'aria-label': tr('CancelTarget') })) : h('div', { className: 'saw-compose-modes', role: 'group', 'aria-label': tr('MessageIntent') }, button(tr('PlanMode'), () => updateComposer({ intent: 'new-task', origin: null, documentOrigin: null }), sending || !!pendingRequest || archive || oldDraft, { 'aria-pressed': composer.intent === 'new-task' }), button(tr('AskMode'), () => updateComposer({ intent: 'message', origin: null, documentOrigin: null }), sending || !!pendingRequest || archive || oldDraft, { 'aria-pressed': composer.intent === 'message' })),
            composer.origin ? h('div', { className: 'saw-chip' }, `${tr('RecreatedFrom')}: ${composer.origin.title}`, button('×', () => updateComposer({ origin: null, documentOrigin: null }), sending || !!pendingRequest, { 'aria-label': tr('CancelOrigin') })) : null,
            composer.documentOrigin ? h('div', { className: 'saw-chip' }, tr('DocumentDraftOrigin'), button('×', () => updateComposer({ documentOrigin: null }), sending || !!pendingRequest, { 'aria-label': tr('CancelOrigin') })) : null,
            h('label', { className: 'saw-sr', htmlFor: 'saw-draft' }, tr('InputLabel')), h('textarea', { id: 'saw-draft', ref: inputRef, value: composer.draft, placeholder: tr(composer.target ? 'InputForTask' : composer.intent === 'new-task' ? 'InputForPlan' : 'InputForQuestion'), rows: 2, disabled: sending || !!pendingRequest || archive || oldDraft || !workspace, onChange: (e: any) => updateComposer({ draft: e.target.value }), onKeyDown: (e: any) => { if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing || e.isComposing || e.nativeEvent?.keyCode === 229 || e.keyCode === 229) return; e.preventDefault(); void submit() }, 'aria-describedby': 'saw-input-help' }),
            h('div', { className: 'saw-compose-footer' }, h('small', { id: 'saw-input-help', className: 'saw-meta' }, tr('KeyboardHint')),
            pendingRequest ? h('div', { className: 'saw-request' }, h('p', null, tr('PendingRequest')), h('details', null, h('summary', null, tr('RequestDetails')), h('code', { className: 'saw-fingerprint' }, pendingRequest.requestId)), h('div', { className: 'saw-row' }, button(tr('CheckStatus'), () => { void submit(true) }, sending), button(tr('RetrySameRequest'), () => { void submit(false) }, sending || pendingRequest.epoch !== workspace?.epoch || archive), latest?.stage === 'unknown' && latest.accepted === false && Number.isSafeInteger(latest.seq) ? button(tr('CancelUnknownRequest'), () => askConfirm('request', { payload: pendingRequest, seq: latest.seq }, 'cancel'), sending || pendingRequest.epoch !== workspace?.epoch || archive) : null)) : h('button', { type: 'submit', className: 'saw-btn saw-send', disabled: sending || archive || oldDraft || !composer.draft.trim() || workspace?.capabilities?.send !== true }, sending ? tr('Sending') : tr(composer.target ? 'SendInput' : composer.intent === 'new-task' ? 'GeneratePlan' : 'Send'))),
            latest ? h('details', { className: 'saw-receipt' }, h('summary', null, tr('RequestDetails')), h('p', { className: 'saw-meta' }, `${latest.accepted === true ? tr('Accepted') : tr('Unknown')}: ${stateName(latest.stage)}${latest.code ? ` · ${latest.code}` : ''}`)) : null,
            notice ? h('p', { className: 'saw-meta' }, notice) : null))),
        h('section', { className: 'saw-board-region', 'aria-label': tr('Board') }, h('div', { className: 'saw-board-head' }, h('h2', null, tr('Board')), h('span', { className: 'saw-meta' }, `${!boardScopeKnown ? tr('CountsScopeUnknown') : board?.filtered ? tr('FilteredCounts') : tr('AllCounts')} · ${tr('Snapshot')}: ${time(board?.snapshotAt)}`)),
          boardError ? h('div', { className: 'saw-error saw-banner' }, boardError, ' ', tr('StaleData')) : null,
          h('div', { className: 'saw-columns' }, ...columns.map(column => {
            const page = board?.columns?.[column]
            return h('section', { className: 'saw-column', key: column, 'aria-label': stateName(column) }, h('header', { className: 'saw-column-head' }, h('h3', null, stateName(column)), h('span', { className: 'saw-count', 'aria-label': tr(boardScopeKnown ? 'ServerTotal' : 'ServerTotalUnknownScope') }, page ? page.total : '—')),
              h('div', { className: 'saw-column-scroll' }, !page ? h('p', { className: 'saw-meta' }, tr('Loading')) : !array(page.items).length ? h('p', { className: 'saw-meta' }, tr(page.total === 0 ? !boardScopeKnown ? 'EmptyColumnUnknownScope' : board?.filtered ? 'EmptyFilteredColumn' : 'EmptyColumn' : 'NoLoadedTasks')) : null,
                ...array(page?.items).map((card: any) => h('article', { className: 'saw-card', key: card.id }, h('button', { type: 'button', className: 'saw-card-open', onClick: () => openDetail(card), 'aria-label': `${tr('OpenTask')}: ${card.title || tr('Untitled')}` }, h('span', { className: 'saw-badge' }, stopping[card.id] ? tr('Stopping') : stateName(card.state === 'ended' ? card.outcome : card.state)), h('span', { className: 'saw-card-title' }, displayTitle(card.title)), card.progress ? h('span', { className: 'saw-card-line' }, card.progress) : null,
                  card.pendingApprovals ? h('span', { className: 'saw-card-line' }, `${tr('Approvals')}: ${card.pendingApprovals}`) : null,
                  card.anomaly ? h('span', { className: 'saw-error saw-card-line' }, tr('StateConflict')) : null,
                  card.disabledReason ? h('span', { className: 'saw-meta saw-card-line' }, tr('ExecutionBlocked')) : null,
                  h('span', { className: 'saw-meta saw-card-line' }, `${tr('LastProgress')}: ${time(card.lastProgressAt)}`), h('span', { className: 'saw-meta saw-card-line' }, `${tr('Steps')}: ${text(card.budget?.steps)} · ${tr('Tokens')}: ${text(card.budget?.usage)}`), typeof card.acceptance?.passed === 'number' ? h('span', { className: 'saw-meta saw-card-line' }, `${tr('Acceptance')}: ${card.acceptance.passed}/${text(card.acceptance.total)}`) : null),
                  card.attention ? h('div', { className: 'saw-attention' }, valueView(card.attention)) : null,
                  card.allowed?.input === true ? button(tr('Supplement'), () => supplement(card), !!pendingRequest) : null)),
                page?.hasMore ? button(paging === column ? tr('Loading') : tr('MoreTasks'), () => { void loadMoreBoard(column) }, !!paging) : null))
          })),
          detailId ? h('aside', { className: 'saw-detail', role: 'dialog', 'aria-modal': false, 'aria-labelledby': 'saw-detail-title', onKeyDown: (e: any) => { if (e.key === 'Escape' && !confirmation) { e.stopPropagation(); closeDetail() } } }, h('header', { className: 'saw-detail-head' }, h('h2', { id: 'saw-detail-title' }, item ? displayTitle(item.title) : tr('TaskDetails')), button('×', closeDetail, false, { ref: detailCloseRef, 'aria-label': tr('CloseDetails') })),
            detailError ? h('div', { className: 'saw-error saw-banner' }, detailError, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => { void readDetail(detailId) })) : null,
            !detail ? h('p', null, tr('Loading')) : h(React.Fragment, null,
              h('nav', { className: 'saw-detail-tabs', 'aria-label': tr('TaskSections') }, ...['overview', 'timeline', 'approvals', 'results'].map(tab => button(tr(({ overview: 'Overview', timeline: 'Timeline', approvals: 'Approvals', results: 'Results' } as any)[tab]), () => setDetailTab(tab), false, { key: tab, 'aria-pressed': detailTab === tab }))),
              h('div', { className: 'saw-detail-scroll' },
                h('details', { className: 'saw-original-request', key: `${detailId}:request` }, h('summary', null, tr('OriginalTaskText')), h('p', { className: 'saw-pre' }, item.title || tr('Untitled'))),
                detailTab === 'overview' ? h(React.Fragment, null, fields([['State', stopping[item.id] ? tr('Stopping') : stateName(item.state === 'ended' ? item.outcome : item.state)], ['LastProgress', time(item.lastProgressAt)]]), item.anomaly ? h('p', { className: 'saw-error' }, tr('StateConflict')) : null, item.attention ? valueView(item.attention) : null, briefView(detail.brief), item.originTicket ? fields([['RecreatedFrom', text(item.originTicket)]]) : null, h('details', null, h('summary', null, tr('TechnicalDetails')), fields([['TaskId', h('code', { className: 'saw-fingerprint' }, text(item.id))]]), button(tr('CopyId'), () => { if (navigator.clipboard) void navigator.clipboard.writeText(String(item.id)).then(() => setNotice(tr('Copied')), () => setNotice(tr('CopyFailed'))); else setNotice(tr('CopyFailed')) }))) : null,
                detailTab === 'timeline' ? h(React.Fragment, null, h('p', { className: 'saw-meta' }, tr('TaskTimelineHint')), h('ol', { className: 'saw-timeline' }, ...array(detail.timeline).map((event: any) => h('li', { key: event.id }, h('time', null, time(event.at)), h('strong', null, text(event.action)), h('small', null, text(event.actor))))), !array(detail.timeline).length ? h('p', null, tr('NoEvents')) : null, detail.timelineCursor ? button(tr('OlderEvents'), () => { void readDetail(detailId, true) }, detailBusy.current) : null) : null,
                detailTab === 'approvals' ? h(React.Fragment, null, ...array(detail.approvals).map(approvalView), !array(detail.approvals).length ? h('p', null, tr('NoApprovals')) : null, detail.approvalsNext ? button(tr('MoreApprovals'), () => { detailApprovalsLoaded.current[detailId] = array(detail.approvals).length + 30; void readDetail(detailId) }, detailBusy.current) : null) : null,
                detailTab === 'results' ? resultView() : null),
              h('footer', { className: 'saw-detail-actions' }, item.state === 'ended' && item.stoppedByHuman === true ? button(tr('RecreateTask'), () => recreate(item), !!pendingRequest || !!composer.draft.trim()) : null, item.allowed?.input === true ? button(tr('Supplement'), () => supplement(item), !!pendingRequest) : null, item.allowed?.stop === true ? button(stopping[item.id] ? tr('Stopping') : tr('StopTask'), () => askConfirm('stop', item, 'stop'), !!stopping[item.id]) : null))) : null)),
      system ? h('aside', { className: 'saw-system', role: 'dialog', 'aria-modal': false, 'aria-label': tr('System'), onKeyDown: (e: any) => { if (e.key === 'Escape' && !confirmation) { e.stopPropagation(); closeSystem() } } }, h('header', { className: 'saw-detail-head' }, h('h2', null, tr(system === 'todo' ? 'Todo' : 'System')), button('×', closeSystem, false, { ref: systemCloseRef, 'aria-label': tr('CloseSystem') })), h('nav', { className: 'saw-detail-tabs', 'aria-label': tr('SystemSections') }, ...['todo', 'health', 'sources', 'settings'].map(tab => button(tr(({ todo: 'Todo', health: 'Health', sources: 'Sources', settings: 'Settings' } as any)[tab]), () => openSystem(tab), false, { key: tab, 'aria-pressed': system === tab }))), systemError ? h('div', { className: 'saw-error saw-banner' }, systemError, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => { void readSystem() })) : null, h('div', { className: 'saw-system-scroll' }, systemContent())) : null,
      confirmation ? h('dialog', { ref: dialogRef, className: 'saw-confirm', 'aria-labelledby': 'saw-confirm-title', onCancel: (e: any) => { e.preventDefault(); closeConfirm() } }, h('h2', { id: 'saw-confirm-title' }, tr('ConfirmAction')), h('p', null, tr(confirmation.kind === 'request' ? 'CancelUnknownRequest' : confirmation.kind === 'revision' ? 'RevisePlan' : confirmation.kind === 'stop' ? 'StopConfirm' : confirmation.decision === 'approve' ? 'ApproveConfirm' : 'RejectConfirm')), h('div', { className: 'saw-confirm-body' }, confirmation.kind === 'request' ? h('p', null, tr('CancelUnknownHint')) : confirmation.kind === 'revision' ? h(React.Fragment, null, h('p', null, tr('RevisionHint')), h('label', null, tr('Goal'), h('textarea', { value: revisionGoal, required: true, maxLength: 8000, onChange: (e: any) => setRevisionGoal(e.target.value) })), h('label', null, tr('FirstAction'), h('textarea', { value: revisionFirstAction, required: true, maxLength: 4000, onChange: (e: any) => setRevisionFirstAction(e.target.value) }))) : confirmation.kind === 'admission' ? admissionView(confirmation.item, true) : confirmation.kind === 'approval' ? h(React.Fragment, null, h('h3', null, confirmation.item.summary || tr('Approval')), fields([['Kind', text(confirmation.item.kind)], ['Fingerprint', h('code', { className: 'saw-fingerprint' }, text(confirmation.item.fingerprint))], ['Expiry', time(confirmation.item.expiresAt)]]), valueView(confirmation.item.impact?.details)) : h('p', null, confirmation.item.title)), !['admission', 'revision', 'request'].includes(confirmation.kind) ? h('label', { className: 'saw-reason' }, tr('ReasonRequired'), h('textarea', { rows: 3, value: reason, required: true, maxLength: 2000, onChange: (e: any) => setReason(e.target.value), 'aria-required': true })) : null, actionError ? h('p', { className: 'saw-error', role: 'alert' }, actionError) : null, h('div', { className: 'saw-row' }, button(tr('Cancel'), closeConfirm, acting), button(acting ? tr('Saving') : tr('Confirm'), () => { void perform() }, acting || (confirmation.kind === 'revision' ? !revisionGoal.trim() || !revisionFirstAction.trim() : !['admission', 'request'].includes(confirmation.kind) && !reason.trim())))) : null)
  }
}
