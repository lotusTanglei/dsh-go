import { deriveDeskState } from './desk-model.js'
import { createGoSettings } from './go-settings.js'
import { createGoDecisions } from './go-decisions.js'
import { createGoProjects } from './go-projects.js'

/** Serialized by the client builder. Every runtime helper is local or explicitly supplied. */
export function createWorkspacePage(React: any, request: (path: string, body?: any, signal?: any) => Promise<any>, t: any, css: string, deskState = deriveDeskState, settingsFactory = createGoSettings, decisionsFactory = createGoDecisions, projectsFactory = createGoProjects) {
  const h = React.createElement
  const goSettings = settingsFactory(React, request, t), goDecisions = decisionsFactory(React, request, t), goProjects = projectsFactory(React, request, t)
  const columns = ['pending', 'running', 'waiting', 'ended']
  const tr = (key: string) => t(`w${key}`)
  const array = (value: any): any[] => Array.isArray(value) ? value : []
  const text = (value: any) => value === undefined || value === null || value === '' ? tr('Unknown') : String(value)
  const time = (value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString() : tr('Unknown')
  const routeId = (value: any) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(value) && !value.includes('://')
  const routeSystem = ['settings', 'scope', 'stage-models', 'settings-runtime', 'health', 'locate', 'images', 'decisions']
  const parseViewRoute = (hash: string) => {
    const fallback = { view: 'overview' }
    if (typeof hash !== 'string' || !hash.startsWith('#go/') || hash.length > 1800) return fallback
    try {
      const [path, query = ''] = hash.slice(4).split('?'), params = new URLSearchParams(query), view = path === 'inbox' ? 'decisions-home' : path === 'works' ? 'board' : path
      if ([...params.keys()].some(key => !['id', 'project', 'session', 'tab'].includes(key) || params.getAll(key).length !== 1)) return fallback
      if (!['overview', 'projects', 'chat', 'decisions-home', 'board', 'ticket', ...routeSystem].includes(view!)) return fallback
      const id = params.get('id'), projectKey = params.get('project'), sessionId = params.get('session'), tab = params.get('tab')
      if (view === 'ticket') return id && routeId(id) ? { view, id, tab: ['overview', 'timeline', 'approvals', 'results'].includes(tab || '') ? tab! : 'overview' } : fallback
      if (view === 'projects') {
        const projectValid = !!projectKey && (['unassigned', 'unknown'].includes(projectKey) || projectKey.startsWith('project:') && routeId(projectKey.slice(8)))
        if (projectKey && !projectValid || sessionId && (!projectValid || !routeId(sessionId))) return fallback
        return { view, ...(projectValid ? { projectKey } : {}), ...(sessionId ? { sessionId } : {}), ...(tab && (sessionId ? ['overview', 'progress', 'relations', 'results'] : ['work', 'sessions']).includes(tab) ? { tab } : {}) }
      }
      return { view }
    } catch { return fallback }
  }
  const viewRouteHash = (route: any) => {
    const view = route.view === 'decisions-home' ? 'inbox' : route.view === 'board' ? 'works' : route.view
    const params = new URLSearchParams()
    if (route.view === 'ticket' && routeId(route.id)) params.set('id', route.id)
    if (route.view === 'projects' && route.projectKey) { params.set('project', route.projectKey); if (route.sessionId) params.set('session', route.sessionId) }
    if (route.tab) params.set('tab', route.tab)
    return `#go/${view}${params.size ? `?${params}` : ''}`
  }
  const names: Record<string, string> = { open: 'Pending', pending: 'Pending', running: 'Running', waiting: 'Waiting', waiting_human: 'Waiting', ended: 'Ended', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', dropped: 'Dropped', unknown: 'Unknown', received: 'Received', queued: 'Queued', claimed: 'Claimed', admitted: 'Admitted', processing: 'Processing', published: 'Published', canceled: 'Canceled', rejected: 'Rejected', approved: 'Approved', denied: 'Denied', expired: 'Expired', superseded: 'Superseded', consumed: 'Consumed', user: 'You', assistant: 'Title', notice: 'Notice' }
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
  const blankComposer = () => ({ draft: '', intent: 'new-task', target: null, origin: null, pending: null, receipt: null })
  const readComposer = (epoch: string) => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(epoch)) || 'null')
      if (!saved || typeof saved.draft !== 'string') return blankComposer()
      const pending = saved.pending
      const validPending = pending && pending.epoch === epoch && typeof pending.requestId === 'string' && typeof pending.text === 'string' && ['message', 'new-task', 'ticket-input'].includes(pending.intent) && (pending.intent !== 'ticket-input' || typeof pending.ticketId === 'string')
      return { draft: saved.draft, intent: saved.intent === 'new-task' ? 'new-task' : 'message', target: saved.target && typeof saved.target.id === 'string' ? saved.target : null, origin: saved.origin && typeof saved.origin.id === 'string' ? saved.origin : null, pending: validPending ? pending : null, receipt: saved.receipt || null }
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
    const [mobileTab, setMobileTab] = React.useState('overview')
    const [viewRoute, setViewRoute] = React.useState({ view: 'overview' } as any)
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [inboxSelection, setInboxSelection] = React.useState('')
    const inboxBusy = React.useRef(false)
    const viewRouteRef = React.useRef({ view: 'overview' } as any)
    const routeHandler = React.useRef(null as null | ((route: any) => void))
    const routeWriting = React.useRef(false)
    const navigationGeneration = React.useRef(0)
    const mainHeadingRef = React.useRef(null as HTMLElement | null)
    const [collapsed, setCollapsed] = React.useState(false)
    const [activityView, setActivityView] = React.useState('history')
    const [newReplies, setNewReplies] = React.useState(0)
    const [replyOpen, setReplyOpen] = React.useState(false)
    const [planReview, setPlanReview] = React.useState('')
    const planFocus = React.useRef(null as HTMLElement | null)
    const inspectorOpener = React.useRef(null as HTMLElement | null)
    const inspectorReturnToInput = React.useRef(false)
    const historyButtonRef = React.useRef(null as HTMLButtonElement | null)
    const activityViewRef = React.useRef('history')
    const replyWatermarks = React.useRef({} as Record<string, number>)
    const replyReadThrough = React.useRef({} as Record<string, number>)
    const replyBaselineReady = React.useRef({} as Record<string, boolean>)
    const replyFocus = React.useRef(null as HTMLElement | null)
    const lastActivityView = React.useRef('history')
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
    const [goPanels, setGoPanels] = React.useState({} as Record<string, boolean>)
    const [decisionLocation, setDecisionLocation] = React.useState(null as any)
    const decisionLocationEpoch = React.useRef('')
    const [systemData, setSystemData] = React.useState({} as any)
    const [systemError, setSystemError] = React.useState('')
    const [sessionWorkPages, setSessionWorkPages] = React.useState({} as any)
    const [sessionWorkBusy, setSessionWorkBusy] = React.useState('')
    const [sessionWorkError, setSessionWorkError] = React.useState('')
    const [excludedOpen, setExcludedOpen] = React.useState(false)
    const sessionWorkPagesRef = React.useRef({} as any)
    const sessionWorkGeneration = React.useRef(0)
    const sessionWorkBusyRef = React.useRef(false)
    const excludedOpenRef = React.useRef(false)
    // Management scope is deliberately independent of the conversation composer.
    const [scopeProjects, setScopeProjects] = React.useState(null as any)
    const [scopeProject, setScopeProject] = React.useState(null as any)
    const [scopePages, setScopePages] = React.useState({} as any)
    const [scopeView, setScopeView] = React.useState('included')
    const [scopeBusy, setScopeBusy] = React.useState('')
    const [scopeError, setScopeError] = React.useState('')
    const [scopeReceipt, setScopeReceipt] = React.useState(null as any)
    // Mutation evidence outlives navigation/epoch resets; it never grants authority over a new page.
    const [scopeMutation, setScopeMutation] = React.useState(null as any)
    const scopeMutationRef = React.useRef(null as any)
    const scopeProjectsRef = React.useRef(null as any)
    const scopeProjectRef = React.useRef(null as any)
    const scopePagesRef = React.useRef({} as any)
    const scopeViewRef = React.useRef('included')
    const scopeBusyRef = React.useRef(null as any)
    const scopeVersion = React.useRef(0)
    const scopeHeadingRef = React.useRef(null as HTMLElement | null)
    const [locateText, setLocateText] = React.useState('')
    const [locateResult, setLocateResult] = React.useState(null as any)
    const [locateBusy, setLocateBusy] = React.useState(false)
    const [locateError, setLocateError] = React.useState('')
    const locateTextRef = React.useRef('')
    const locateResultRef = React.useRef(null as any)
    const locateVersion = React.useRef(0)
    const locateBusyRef = React.useRef(null as any)
    // Text and evidence stay component-local, bound to the original epoch + exact target versions.
    // Locate navigation never resets this map or writes to the main composer.
    const [sessionActions, setSessionActions] = React.useState({} as any)
    const sessionActionsRef = React.useRef({} as any)
    const sessionActionComposing = React.useRef(false)
    const sessionActionFocus = React.useRef('')
    // Pre-delivery confirmations are local evidence bound to the exact located target.
    // They never send, dispatch, wake a model or modify the main composer.
    const [deliveries, setDeliveries] = React.useState({} as any)
    const deliveriesRef = React.useRef({} as any)
    const deliveryBusyRef = React.useRef(null as any)
    const [imageDrafts, setImageDrafts] = React.useState({} as any)
    const imageDraftsRef = React.useRef({} as any)
    const imageScopeRef = React.useRef('')
    const imageGeneration = React.useRef(0)
    const imageBusyRef = React.useRef(null as any)
    const [imageBusy, setImageBusy] = React.useState('')
    const [imageError, setImageError] = React.useState('')
    const [imageViewer, setImageViewer] = React.useState(null as any)
    const imageViewerRef = React.useRef(null as HTMLDialogElement | null)
    const imageURLs = React.useRef(new Set<string>())
    const imageRevokeQueue = React.useRef(new Set<string>())
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
      const tab = systemRef.current, epoch = epochRef.current
      if (['images', 'stage-models', 'decisions'].includes(tab)) return
      if (!tab || tab === 'scope' || tab === 'locate' || systemBusy.current) return
      systemBusy.current = true
      const route = tab === 'settings' || tab === 'settings-runtime' ? 'settings' : tab === 'todo' || tab === 'decisions-home' ? 'approvals' : 'health'
      try {
        const old = systemDataRef.current[tab]
        let data = await call(route, tab === 'todo' || tab === 'decisions-home' ? { state: 'pending', limit: 20, ...(more && old?.next ? { cursor: old.next } : {}) } : {})
        if (tab === 'todo' || tab === 'decisions-home') {
          let items = more ? merge(array(old?.items), array(data.items), (a, b) => String(a.id).localeCompare(String(b.id))) : array(data.items)
          while (!more && data.next && items.length < approvalsLoaded.current) {
            const page = await call('approvals', { state: 'pending', limit: Math.min(100, approvalsLoaded.current - items.length), cursor: data.next })
            if (page.next === data.next) break
            items = merge(items, array(page.items), (a, b) => String(a.id).localeCompare(String(b.id))); data = page
          }
          data = { ...data, items }
          if (more) approvalsLoaded.current = items.length
        }
        if (!alive.current || epochRef.current !== epoch || systemRef.current !== tab) return
        systemDataRef.current = { ...systemDataRef.current, [tab]: data }
        setSystemData(systemDataRef.current); setSystemError('')
      } catch (e: any) { if (alive.current && epochRef.current === epoch && systemRef.current === tab) { setSystemError(e?.status === 409 ? tr('DecisionConflict') : messageOf(e)); if (e?.status === 409) poke.current() } }
      finally { systemBusy.current = false }
    }
    // Passive local projections only. The workspace poll supplies preview; full pages are explicit.
    const readSessionWork = async (view = 'included', more = false) => {
      const epoch = epochRef.current, generation = sessionWorkGeneration.current
      if (!epoch || sessionWorkBusyRef.current) return
      const old = sessionWorkPagesRef.current[view], cursor = more ? old?.next : undefined
      if (more && (!old?.hasMore || typeof cursor !== 'string')) return
      sessionWorkBusyRef.current = true; setSessionWorkBusy(view); setSessionWorkError('')
      try {
        const data = await call('session-work', { action: 'list', epoch, view, limit: 20, ...(cursor ? { cursor } : {}) })
        if (!alive.current || epochRef.current !== epoch || sessionWorkGeneration.current !== generation) return
        if (more && data.revision !== old.revision) { const changed: any = new Error(); changed.status = 409; throw changed }
        const page = more ? { ...data, items: [...new Map([...array(old.items), ...array(data.items)].map(row => [row.sessionId, row])).values()] } : data
        sessionWorkPagesRef.current = { ...sessionWorkPagesRef.current, [view]: page }; setSessionWorkPages(sessionWorkPagesRef.current)
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch && sessionWorkGeneration.current === generation) { if (e?.status === 409) { sessionWorkPagesRef.current = {}; setSessionWorkPages({}) }; setSessionWorkError(tr(e?.status === 409 ? 'SessionWorkChanged' : 'SessionWorkReadFailed')) }
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
        sessionWorkGeneration.current++; sessionWorkPagesRef.current = {}; setSessionWorkPages({}); poke.current()
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
    const scopeProjectKey = (row: any) => row?.kind === 'project' && typeof row.key === 'string' && row.key ? `project:${row.key}` : row?.kind === 'unassigned' || row?.kind === 'unknown' ? row.kind : ''
    const scopeProjectName = (row: any) => row?.kind === 'project' ? typeof row.name === 'string' && row.name.trim() && row.name.trim() !== row.key && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(row.name.trim()) ? row.name : tr('ProjectUntitled') : tr(row?.kind === 'unassigned' ? 'ProjectUnassigned' : 'ProjectUnknown')
    const scopeProjectReference = (row: any) => {
      const id = String(row.key), others = array(scopeProjectsRef.current?.items)
      let length = Math.min(8, id.length)
      while (length < id.length && others.some(other => other.kind === 'project' && other.key !== id && String(other.key).startsWith(id.slice(0, length)))) length++
      return id.slice(0, length)
    }
    const resetScope = () => {
      scopeVersion.current++; scopeBusyRef.current = null; setScopeBusy('')
      scopeProjectsRef.current = null; scopeProjectRef.current = null; scopePagesRef.current = {}; scopeViewRef.current = 'included'
      setScopeProjects(null); setScopeProject(null); setScopePages({}); setScopeView('included'); setScopeError(''); setScopeReceipt(null)
    }
    const readScopeProjects = async (more = false) => {
      const epoch = epochRef.current, version = scopeVersion.current, old = scopeProjectsRef.current
      if (!epoch || scopeBusyRef.current || systemRef.current !== 'scope' || scopeProjectRef.current) return
      const cursor = more ? old?.next : undefined
      if (more && (!old?.hasMore || typeof cursor !== 'string' || !cursor)) return
      const operation = {}; scopeBusyRef.current = operation; setScopeBusy('projects'); setScopeError('')
      try {
        const data = await call('session-work', { action: 'projects', epoch, limit: 20, ...(cursor ? { cursor } : {}) })
        if (!alive.current || epochRef.current !== epoch || scopeVersion.current !== version || systemRef.current !== 'scope' || scopeProjectRef.current) return
        if (!data || !['ready', 'partial'].includes(data.state) || typeof data.revision !== 'string' || !data.revision || !Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || data.items.some((row: any) => !scopeProjectKey(row) || typeof row.excluded !== 'boolean') || data.hasMore && (typeof data.next !== 'string' || !data.next || data.next === cursor)) throw new Error('invalid_scope_page')
        if (more && data.revision !== old.revision) { const changed: any = new Error(); changed.status = 409; throw changed }
        const next = more ? { ...data, items: [...new Map([...array(old.items), ...data.items].map(row => [scopeProjectKey(row), row])).values()] } : data
        scopeProjectsRef.current = next; setScopeProjects(next); return next
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch && scopeVersion.current === version && systemRef.current === 'scope') setScopeError(tr(e?.status === 409 ? 'ScopeChanged' : 'ScopeReadFailed'))
      } finally { if (scopeBusyRef.current === operation) { scopeBusyRef.current = null; if (alive.current) setScopeBusy('') } }
    }
    const readScopeSessions = async (view = scopeViewRef.current, more = false) => {
      const epoch = epochRef.current, version = scopeVersion.current, project = scopeProjectRef.current, projectKey = scopeProjectKey(project)
      if (!epoch || scopeBusyRef.current || systemRef.current !== 'scope' || !projectKey || project.kind === 'unknown' || !['included', 'excluded'].includes(view)) return
      const old = scopePagesRef.current[view], cursor = more ? old?.next : undefined
      if (more && (!old?.hasMore || old.projectKey !== projectKey || typeof cursor !== 'string' || !cursor)) return
      const operation = {}; scopeBusyRef.current = operation; setScopeBusy(view); setScopeError('')
      try {
        const data = await call('session-work', { action: 'list', epoch, projectKey, view, limit: 20, ...(cursor ? { cursor } : {}) })
        if (!alive.current || epochRef.current !== epoch || scopeVersion.current !== version || systemRef.current !== 'scope' || scopeProjectKey(scopeProjectRef.current) !== projectKey || scopeViewRef.current !== view) return
        if (data?.state === 'unavailable') throw new Error('scope_unavailable')
        if (!data || !['ready', 'partial'].includes(data.state) || typeof data.revision !== 'string' || !data.revision || !Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || data.items.some((row: any) => typeof row?.sessionId !== 'string' || !row.sessionId || scopeProjectKey(row.project) !== projectKey || row.excluded !== (view === 'excluded')) || data.hasMore && (typeof data.next !== 'string' || !data.next || data.next === cursor)) throw new Error('invalid_scope_page')
        if (more && data.revision !== old.revision) { const changed: any = new Error(); changed.status = 409; throw changed }
        const next = { ...data, projectKey, items: more ? [...new Map([...array(old.items), ...data.items].map(row => [row.sessionId, row])).values()] : data.items }
        scopePagesRef.current = { ...scopePagesRef.current, [view]: next }; setScopePages(scopePagesRef.current)
        // A fresh session page can reveal a changed parent policy: require a new project snapshot.
        if (scopeProjectsRef.current?.revision !== data.revision) setScopeError(tr('ScopeChanged'))
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch && scopeVersion.current === version && systemRef.current === 'scope') setScopeError(tr(e?.status === 409 ? 'ScopeChanged' : 'ScopeReadFailed'))
      } finally { if (scopeBusyRef.current === operation) { scopeBusyRef.current = null; if (alive.current) setScopeBusy('') } }
    }
    const openScopeProject = (row: any) => {
      if (scopeBusyRef.current || !scopeProjectKey(row) || row.kind === 'unknown' || !array(scopeProjectsRef.current?.items).includes(row)) return
      scopeVersion.current++; scopeProjectRef.current = row; setScopeProject(row); scopePagesRef.current = {}; setScopePages({}); scopeViewRef.current = 'included'; setScopeView('included'); setScopeError(''); setScopeReceipt(null)
      void readScopeSessions('included')
    }
    const backScopeProjects = () => {
      if (scopeBusyRef.current) return
      scopeVersion.current++; scopeProjectRef.current = null; setScopeProject(null); scopePagesRef.current = {}; setScopePages({}); setScopeError('')
      void readScopeProjects()
    }
    const chooseScopeView = (view: string) => {
      if (scopeBusyRef.current || !['included', 'excluded'].includes(view) || scopeViewRef.current === view) return
      scopeVersion.current++; scopeViewRef.current = view; setScopeView(view); setScopeError('')
      void readScopeSessions(view)
    }
    const changeScopeIncluded = async (kind: string, row: any, included: boolean, revision: any) => {
      const epoch = epochRef.current, version = scopeVersion.current, project = scopeProjectRef.current, projectKey = scopeProjectKey(project)
      if (!epoch || scopeBusyRef.current || scopeMutationRef.current?.status === 'pending' || systemRef.current !== 'scope' || typeof included !== 'boolean' || typeof revision !== 'string' || !revision || !['project', 'session'].includes(kind)) return
      const catalog = scopeProjectsRef.current, page = scopePagesRef.current[scopeViewRef.current]
      if (kind === 'project' ? row?.kind !== 'project' || catalog?.revision !== revision || !array(catalog?.items).includes(row) : !projectKey || project.kind === 'unknown' || project.excluded && included || catalog?.revision !== revision || page?.revision !== revision || page.projectKey !== projectKey || !array(page.items).includes(row) || scopeProjectKey(row.project) !== projectKey || included && row.exclusionReason === 'membership-unknown') return
      const idKey = kind === 'project' ? 'projectId' : 'sessionId', id = kind === 'project' ? row.key : row.sessionId
      if (typeof id !== 'string' || !id) return
      const loadedProjects = array(catalog?.items).length, view = scopeViewRef.current
      const mutation = { epoch, kind, id, included, revision, status: 'pending' }
      scopeMutationRef.current = mutation; setScopeMutation(mutation)
      const operation = {}; scopeBusyRef.current = operation; setScopeBusy(id); setScopeError(''); setScopeReceipt(null)
      let savedRevision = ''
      const sameView = () => alive.current && epochRef.current === epoch && scopeVersion.current === version && systemRef.current === 'scope'
      try {
        const receipt = await call('session-work', { action: kind === 'project' ? 'set-project-included' : 'set-included', epoch, [idKey]: id, included, revision })
        if (!alive.current) return
        if (!receipt || receipt[idKey] !== id || receipt.included !== included || typeof receipt.revision !== 'string' || !receipt.revision || kind === 'project' && receipt.stopped !== false) throw new Error('unconfirmed_scope_change')
        // Keep the exact old operation's evidence even if its page/epoch has gone away.
        scopeMutationRef.current = { ...mutation, status: 'confirmed', receiptRevision: receipt.revision }; setScopeMutation(scopeMutationRef.current)
        // A confirmed policy change revokes cached/read-in-flight session-work pages across navigation,
        // but an old epoch receipt must never invalidate the new epoch's cache.
        if (epochRef.current === epoch) { sessionWorkGeneration.current++; sessionWorkPagesRef.current = {}; setSessionWorkPages({}); poke.current() }
        if (!sameView()) return
        savedRevision = receipt.revision; setScopeReceipt({ kind, id, included, revision: receipt.revision }); setNotice(tr(included ? kind === 'project' ? 'ScopeRestored' : 'ScopeSessionRestored' : 'ScopeExcluded'))
        // Drop content only after the exact receipt. Never replay uncertain mutations.
        scopeProjectsRef.current = null; setScopeProjects(null); scopeProjectRef.current = null; setScopeProject(null); scopePagesRef.current = {}; setScopePages({})
      } catch (e: any) {
        if (alive.current) { scopeMutationRef.current = { ...mutation, status: 'unknown' }; setScopeMutation(scopeMutationRef.current) }
        if (sameView()) setScopeError(tr(e?.status === 409 ? 'ScopeChanged' : 'ScopeSaveFailed'))
      } finally { if (scopeBusyRef.current === operation) { scopeBusyRef.current = null; if (alive.current) setScopeBusy('') } }
      if (savedRevision && sameView()) {
        let refreshed = await readScopeProjects()
        if (!refreshed || !sameView()) return
        if (refreshed.revision !== savedRevision) { setScopeError(tr('ScopeChanged')); return }
        // Revisit at most the previously loaded catalog window, not an unbounded new scan.
        const maxPages = Math.max(1, Math.ceil(loadedProjects / 20))
        for (let pages = 1; projectKey && pages < maxPages && refreshed.hasMore && array(refreshed.items).length < loadedProjects && !array(refreshed.items).some(entry => scopeProjectKey(entry) === projectKey); pages++) {
          const before = array(refreshed.items).length
          refreshed = await readScopeProjects(true)
          if (!refreshed || !sameView()) return
          if (refreshed.revision !== savedRevision) { setScopeError(tr('ScopeChanged')); return }
          if (array(refreshed.items).length <= before) { setScopeError(tr('ScopeChanged')); return }
        }
        if (projectKey && sameView() && !scopeProjectRef.current) {
          const current = array(refreshed.items).find(entry => scopeProjectKey(entry) === projectKey)
          if (current && current.kind !== 'unknown') { scopeProjectRef.current = current; setScopeProject(current); scopeViewRef.current = view; setScopeView(view); await readScopeSessions(view) }
          else setScopeError(tr('ScopeProjectNotFound'))
        }
      }
    }
    const resetLocate = () => {
      locateVersion.current++; locateResultRef.current = null; locateBusyRef.current = null
      setLocateResult(null); setLocateBusy(false); setLocateError('')
    }
    const editLocateText = (value: string) => {
      locateTextRef.current = value; setLocateText(value); resetLocate()
    }
    /**
     * The locate stage only translates a colloquial request into a strict retrieval intent; the
     * bounded locate evidence chain still owns the target. A low-confidence or unreadable intent
     * becomes an explicit clarification question, never a silent literal-search substitution.
     */
    const stageLocateEvidence = (value: any) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !['located', 'clarify', 'no_match', 'blocked'].includes(value.status)) return { fallback: true as const }
      if (value.locate && typeof value.locate === 'object' && !Array.isArray(value.locate)) return { result: value.locate }
      if (value.status === 'clarify') {
        const code = typeof value.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value.code) ? value.code : undefined
        return { result: { status: 'clarify', controlAvailable: false, executionReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', candidates: [], candidateTotal: 0, ...(code === undefined ? {} : { code }) } }
      }
      return { fallback: true as const }
    }
    const readLocate = async (candidate?: any) => {
      const epoch = epochRef.current, query = locateTextRef.current, version = locateVersion.current, old = locateResultRef.current
      if (!epoch || locateBusyRef.current || systemRef.current !== 'locate' || !query.trim()) return
      if (new TextEncoder().encode(query).length > 16_384 || query.includes('\0')) { setLocateError(tr('TextLimit')); return }
      if (candidate && (old?.status !== 'clarify' || typeof old.revision !== 'string' || !old.revision || !array(old.candidates).includes(candidate) || !scopeProjectKey(candidate.project) || candidate.project.kind === 'unknown')) return
      const operation = {}; locateBusyRef.current = operation; setLocateBusy(true); setLocateError(''); locateResultRef.current = null; setLocateResult(null)
      try {
        let result: any
        if (candidate) result = await call('session-locate', { epoch, text: query, sessionId: candidate.sessionId, revision: old.revision })
        else {
          // The model-backed stage is primary; only a stage capability outage falls back to the
          // literal chain. Intent clarifications stay clarifications and never fall through.
          let stage: any = null
          try { stage = await call('stage-locate', { epoch, text: query }) }
          catch (error: any) { if (error?.status !== 503) throw error }
          const outcome = stage ? stageLocateEvidence(stage) : { fallback: true as const }
          result = 'result' in outcome ? outcome.result : await call('session-locate', { epoch, text: query })
        }
        if (!alive.current || epochRef.current !== epoch || systemRef.current !== 'locate' || locateVersion.current !== version || locateTextRef.current !== query) return
        if (!result || !['located', 'clarify', 'no_match', 'blocked'].includes(result.status) || result.controlAvailable !== false || typeof result.executionReason !== 'string' || !result.executionReason || !Array.isArray(result.candidates) || result.candidates.some((row: any) => typeof row?.sessionId !== 'string' || !row.sessionId || !scopeProjectKey(row.project) || row.project.kind === 'unknown')
          || result.status === 'located' && (typeof result.revision !== 'string' || !result.revision)
          || result.status === 'clarify' && result.candidates.length > 0 && (typeof result.revision !== 'string' || !result.revision)
          || result.status === 'located' && (!result.target || !result.candidates.some((row: any) => row.sessionId === result.target.sessionId) || candidate && result.target.sessionId !== candidate.sessionId || !scopeProjectKey(result.target.project) || result.target.project.kind === 'unknown' || result.coverage === 'partial')) throw new Error('invalid_locate_receipt')
        locateResultRef.current = result; setLocateResult(result)
      } catch (e: any) {
        if (alive.current && epochRef.current === epoch && systemRef.current === 'locate' && locateVersion.current === version) setLocateError(tr(e?.status === 409 ? 'LocateChanged' : 'LocateFailed'))
      } finally { if (locateBusyRef.current === operation) { locateBusyRef.current = null; if (alive.current) setLocateBusy(false) } }
    }
    const sessionActionKey = (epoch: string, target: any) => JSON.stringify([epoch, target.sessionId, target.scopeRevision, target.factRevision, target.project.kind, target.project.key])
    const currentSessionAction = () => {
      const result = locateResultRef.current, target = result?.target, epoch = epochRef.current
      if (!epoch || systemRef.current !== 'locate' || result?.status !== 'located' || result.controlAvailable !== false || result.executionReason !== 'SA_EXECUTION_BOUNDARY_UNVERIFIED' || result.coverage !== 'complete' || !array(result.candidates).some(row => row.sessionId === target?.sessionId && row.factRevision === target?.factRevision && row.project?.kind === target?.project?.kind && row.project?.key === target?.project?.key) || !scopeProjectKey(target?.project) || target.project.kind === 'unknown' || typeof target?.sessionId !== 'string' || !target.sessionId || !/^[a-f0-9]{64}$/.test(result.revision) || !/^[a-f0-9]{64}$/.test(target.factRevision)) return null
      const binding = { sessionId: target.sessionId, scopeRevision: result.revision, factRevision: target.factRevision, project: { kind: target.project.kind, key: target.project.key } }
      return { key: sessionActionKey(epoch, binding), epoch, target: binding, title: sessionSourceTitle(target), projectName: scopeProjectName(target.project) }
    }
    const saveSessionAction = (key: string, value: any) => {
      sessionActionsRef.current = { ...sessionActionsRef.current, [key]: value }
      if (alive.current) setSessionActions(sessionActionsRef.current)
    }
    const editSessionAction = (key: string, field: string, value: string) => {
      const current = currentSessionAction()
      if (!current || current.key !== key || !['text', 'operation'].includes(field) || field === 'operation' && !['continue', 'supplement', 'steer'].includes(value)) return
      const old = sessionActionsRef.current[key]
      if (old?.pending) return
      saveSessionAction(key, { ...current, operation: 'continue', text: '', ...old, [field]: value, error: '' })
    }
    const newSessionActionDraft = (key: string) => {
      const current = currentSessionAction(), old = sessionActionsRef.current[key]
      if (!alive.current || sessionActionComposing.current || !current || current.key !== key || old?.busy || !['blocked', 'closed'].includes(old?.status) || old.receipt?.state !== old.status || !(old.status === 'closed' ? validSessionActionClosure(old.receipt, old) : validSessionActionReceipt(old.receipt, old))) return
      const historyKey = JSON.stringify(['session-action-history', old.epoch, old.pending.actionId])
      const history = { ...old, key: historyKey, history: true }
      const draft = { ...current, operation: old.operation, text: old.pending.text, status: 'draft', pending: null, receipt: null, error: '' }
      // One explicit local transition: retain immutable original evidence; mint no IDs or Host request.
      sessionActionsRef.current = { ...sessionActionsRef.current, [historyKey]: history, [key]: draft }
      sessionActionFocus.current = key
      setSessionActions(sessionActionsRef.current)
    }
    const sessionActionDigest = async (input: any) => {
      const bytes = new TextEncoder().encode(JSON.stringify([input.epoch, input.requestId, input.actionId, input.operation, input.text, input.target.sessionId, input.target.scopeRevision, input.target.factRevision]))
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
    }
    const validSessionActionReceipt = (receipt: any, entry: any) => {
      const input = entry.pending, previous = entry.receipt, hash = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      if (!input || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.version !== undefined && receipt.version !== 1 || !['epoch', 'requestId', 'actionId', 'operation'].every(key => receipt[key] === input[key]) || !['sessionId', 'scopeRevision', 'factRevision'].every(key => receipt.target?.[key] === input.target[key]) || receipt.target?.project?.kind !== entry.target.project.kind || receipt.target?.project?.key !== entry.target.project.key || !hash(receipt.digest) || receipt.digest !== entry.digest || receipt.messageId !== `go:${input.actionId}` || !Number.isSafeInteger(receipt.seq) || receipt.seq < 1 || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || !Number.isSafeInteger(receipt.updatedAt) || receipt.updatedAt < receipt.at || receipt.durable !== true || receipt.executed !== (['recorded', 'blocked'].includes(receipt.state) ? false : null) || receipt.completed !== (['recorded', 'blocked'].includes(receipt.state) ? false : null) || !['recorded', 'blocked', 'dispatch_unknown', 'accepted'].includes(receipt.state) || receipt.accepted !== (receipt.state === 'accepted') || receipt.disposition !== (receipt.state === 'accepted' ? 'target-durable-receipt' : receipt.state === 'dispatch_unknown' ? 'reconcile-only' : 'not-dispatched') || receipt.code !== undefined && (typeof receipt.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(receipt.code))) return false
      if (receipt.seq !== (receipt.state === 'recorded' ? 1 : receipt.state === 'accepted' ? 3 : 2) || ['dispatch_unknown', 'accepted'].includes(receipt.state) && (!hash(receipt.controlRevision) || !hash(receipt.grantRevision))) return false
      // A same-sequence receipt cannot change facts; terminal evidence cannot roll back.
      if (previous && (receipt.seq < previous.seq || receipt.at !== previous.at || receipt.updatedAt < previous.updatedAt || receipt.seq === previous.seq && ['state', 'code', 'digest', 'messageId', 'updatedAt', 'controlRevision', 'grantRevision'].some(key => receipt[key] !== previous[key]) || ['blocked', 'accepted'].includes(previous.state) && (receipt.state !== previous.state || receipt.seq !== previous.seq) || previous.state === 'dispatch_unknown' && !['dispatch_unknown', 'accepted'].includes(receipt.state))) return false
      return true
    }
    const validSessionActionClosure = (receipt: any, entry: any) => {
      const input = entry.pending, previous = entry.receipt
      const keys = ['version', 'epoch', 'requestId', 'actionId', 'operation', 'target', 'digest', 'seq', 'at', 'updatedAt', 'state', 'bindingVerified', 'durable', 'accepted', 'executed', 'completed', 'disposition', 'code']
      if (!entry.closeRequested || !input || previous && previous.state !== 'closed' || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.keys(receipt).some(key => !keys.includes(key)) || Object.getOwnPropertySymbols(receipt).length || receipt.version !== 1 || !['epoch', 'requestId', 'actionId', 'operation'].every(key => receipt[key] === input[key]) || !receipt.target || typeof receipt.target !== 'object' || Array.isArray(receipt.target) || Object.keys(receipt.target).length !== 3 || Object.getOwnPropertySymbols(receipt.target).length || !['sessionId', 'scopeRevision', 'factRevision'].every(key => receipt.target[key] === input.target[key]) || typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest) || receipt.digest !== entry.digest || receipt.seq !== 1 || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || receipt.updatedAt !== receipt.at || receipt.state !== 'closed' || receipt.bindingVerified !== false || receipt.durable !== true || receipt.accepted !== false || receipt.executed !== null || receipt.completed !== null || receipt.disposition !== 'closed-before-dispatch' || receipt.code !== 'session_action_id_closed') return false
      return !previous || receipt.at === previous.at && receipt.digest === previous.digest
    }
    const closeSessionAction = async (key: string) => {
      const old = sessionActionsRef.current[key]
      if (!alive.current || sessionActionComposing.current || !old?.pending || old.busy || old.status !== 'unknown' || old.epoch !== epochRef.current) return
      const payload = old.pending, entry = { ...old, busy: {}, status: 'pending', error: '', closeRequested: true }
      saveSessionAction(key, entry)
      try {
        const receipt = await call('session-action', { action: 'close', ...payload })
        const valid = receipt?.state === 'closed' ? validSessionActionClosure(receipt, entry) : validSessionActionReceipt(receipt, entry)
        if (!valid) throw new Error('invalid_session_action_closure')
        saveSessionAction(key, { ...entry, busy: null, receipt, status: receipt.state, error: '' })
      } catch {
        saveSessionAction(key, { ...entry, busy: null, status: 'unknown', error: tr('SessionActionCloseUnknown') })
      }
    }
    const checkSessionAction = async (key: string, statusOnly = false) => {
      const current = currentSessionAction(), old = sessionActionsRef.current[key]
      if (!alive.current || old?.busy || sessionActionComposing.current) return
      if (statusOnly) { if (!old?.pending || old.epoch !== epochRef.current || old.receipt && ['blocked', 'accepted', 'closed'].includes(old.receipt.state)) return }
      else if (!current || current.key !== key || old?.pending || !old?.text?.trim() || !['continue', 'supplement', 'steer'].includes(old.operation) || Object.values(sessionActionsRef.current).some((entry: any) => entry.pending && (!entry.receipt || ['recorded', 'dispatch_unknown'].includes(entry.receipt.state)))) return
      if (!statusOnly && (new TextEncoder().encode(old.text).length > 16_384 || old.text.includes('\0'))) { saveSessionAction(key, { ...old, error: tr('TextLimit') }); return }
      if (!statusOnly && !current) return
      const payload = statusOnly ? old.pending : { epoch: current!.epoch, requestId: mintId(), actionId: mintId(), operation: old.operation, text: old.text, target: { sessionId: current!.target.sessionId, scopeRevision: current!.target.scopeRevision, factRevision: current!.target.factRevision } }
      const operation = {}, entry = { ...old, ...(statusOnly ? {} : current), pending: payload, busy: operation, error: '', status: 'pending' }
      saveSessionAction(key, entry)
      let requested = false
      try {
        const digest = statusOnly ? entry.digest : await sessionActionDigest(payload)
        const prepared = { ...entry, digest }
        saveSessionAction(key, prepared)
        // Hashing is async: a new prepare still requires the exact currently located binding.
        if (!statusOnly && currentSessionAction()?.key !== key || statusOnly && epochRef.current !== payload.epoch || !alive.current) {
          saveSessionAction(key, { ...prepared, busy: null, pending: statusOnly ? payload : null, status: statusOnly ? 'unknown' : 'draft' }); return
        }
        requested = true
        const receipt = await call('session-action', statusOnly ? { action: 'status', epoch: payload.epoch, actionId: payload.actionId } : { action: 'prepare', ...payload })
        if (!(receipt?.state === 'closed' ? validSessionActionClosure(receipt, prepared) : validSessionActionReceipt(receipt, prepared))) throw new Error('invalid_session_action_receipt')
        // Preserve original evidence after navigation, but never apply it to the new target/epoch.
        saveSessionAction(key, { ...prepared, busy: null, receipt, status: receipt.state, error: '' })
      } catch (e: any) {
        const saved = sessionActionsRef.current[key]
        saveSessionAction(key, { ...saved, busy: null, pending: requested || statusOnly ? payload : null, status: requested || statusOnly ? 'unknown' : 'draft', error: tr(statusOnly && e?.status === 404 ? 'SessionActionNotFound' : requested || statusOnly ? 'SessionActionUnknown' : 'SessionActionUnavailable') })
      }
    }
    const saveImageDraft = (epoch: string, next: any) => { imageDraftsRef.current = { ...imageDraftsRef.current, [epoch]: next }; if (alive.current) setImageDrafts(imageDraftsRef.current) }
    const imageDraft = (create = false) => {
      const epoch = epochRef.current
      let draft = imageDraftsRef.current[epoch]
      if (!draft && create && epoch) { draft = { epoch, draftId: mintId(), items: [], selected: '', target: null }; saveImageDraft(epoch, draft) }
      return draft
    }
    const closeImageViewer = () => { imageViewerRef.current?.close(); setImageViewer(null) }
    const retireImageURLs = (urls: any[]) => {
      closeImageViewer()
      for (const url of urls) if (typeof url === 'string' && imageURLs.current.has(url)) imageRevokeQueue.current.add(url)
    }
    const fenceImageScope = (revision: any, epoch = epochRef.current) => {
      const next = typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision) ? revision : ''
      if (next === imageScopeRef.current && Object.values(imageDraftsRef.current).every((draft: any) => draft.epoch === epoch || !array(draft.items).some(row => row.src || row.payload))) return
      imageScopeRef.current = next; imageGeneration.current++; retireImageURLs([...imageURLs.current])
      for (const draft of Object.values(imageDraftsRef.current) as any[]) saveImageDraft(draft.epoch, { ...draft, target: null, items: array(draft.items).map(row => ({ ...row, src: '', payload: null, originalVerified: false, stale: true, status: row.status === 'uploading' ? 'upload-unknown' : row.status === 'bind-pending' ? 'bind-unknown' : row.status === 'release-pending' ? 'release-unknown' : row.status })) })
    }
    const imageHash = async (bytes: Uint8Array) => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as any))].map(value => value.toString(16).padStart(2, '0')).join('')
    const inspectDraftPNG = (bytes: Uint8Array, mediaType: string) => {
      if (mediaType !== 'image/png' || bytes.length < 57 || bytes.length > 8 * 1024 * 1024 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, i) => bytes[i] !== value)) throw new Error('unsupported_png')
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20)
      if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR' || !width || !height || width > 8192 || height > 8192 || width * height > 8_000_000 || bytes[24] !== 8 || ![0, 2, 4, 6].includes(bytes[25]!) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw new Error('unsupported_png')
      let offset = 8, count = 0, ended = false
      while (offset + 12 <= bytes.length) { const size = view.getUint32(offset), type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)), end = offset + size + 12; if (++count > 2048 || end > bytes.length || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('unsupported_png'); if (type === 'IEND') { ended = size === 0 && end === bytes.length; break } offset = end }
      if (!ended) throw new Error('unsupported_png')
      return { width, height }
    }
    const validImageRecord = (row: any, draft: any) => !!row && row.epoch === draft.epoch && row.draftId === draft.draftId && typeof row.imageId === 'string' && row.imageId === row.uploadId && /^[0-9a-f-]{36}$/i.test(row.imageId) && typeof row.digest === 'string' && /^[a-f0-9]{64}$/.test(row.digest) && typeof row.scopeRevision === 'string' && /^[a-f0-9]{64}$/.test(row.scopeRevision) && row.mediaType === 'image/png' && row.original === true && row.uploadedNotSent === true && ['staged', 'bound'].includes(row.state) && Number.isSafeInteger(row.seq) && row.seq > 0 && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= 8 * 1024 * 1024 && Number.isSafeInteger(row.width) && Number.isSafeInteger(row.height) && row.width > 0 && row.height > 0 && row.width <= 8192 && row.height <= 8192 && row.width * row.height <= 8_000_000
    const imageReference = (row: any) => ({ imageId: row.imageId, digest: row.digest, seq: row.seq })
    const addDraftImages = async (files: any) => {
      if (!alive.current || imageBusyRef.current) return
      let draft: any
      try { draft = imageDraft(true) } catch { setImageError(tr('SecureIdUnavailable')); return }
      if (!draft) return
      const incoming = Array.from(files || []) as any[]
      if (!incoming.length) return
      if (incoming.length + array(draft.items).length > 5) { setImageError(tr('ImageLimit')); return }
      const generation = imageGeneration.current, epoch = draft.epoch, operation = {}; imageBusyRef.current = operation; setImageBusy('local'); setImageError('')
      try {
        for (const file of incoming) {
          if (typeof file?.arrayBuffer !== 'function' || file.type !== 'image/png' || file.size > 8 * 1024 * 1024) throw new Error('unsupported_png')
          const bytes = new Uint8Array(await file.arrayBuffer()), dimensions = inspectDraftPNG(bytes, file.type), digest = await imageHash(bytes)
          if (!alive.current || epochRef.current !== epoch || imageGeneration.current !== generation) return
          const uploadId = mintId(); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
          const payload = { epoch, draftId: draft.draftId, uploadId, digest, mediaType: 'image/png', encoded: btoa(binary) }
          const src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); imageURLs.current.add(src)
          draft = imageDraftsRef.current[epoch]; saveImageDraft(epoch, { ...draft, items: [...draft.items, { id: uploadId, payload, digest, ...dimensions, size: bytes.length, src, status: 'local' }], selected: uploadId })
        }
      } catch { if (alive.current) setImageError(tr('ImageUnsupported')) }
      finally { if (imageBusyRef.current === operation) { imageBusyRef.current = null; if (alive.current) setImageBusy('') } }
    }
    const pasteDraftImages = (event: any) => {
      const files = array(Array.from(event.clipboardData?.items || [])).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean)
      if (!files.length || event.target?.disabled) return
      event.preventDefault()
      const pasted = event.clipboardData?.getData?.('text/plain')
      if (pasted && event.target?.id === 'saw-draft' && !composerRef.current.pending) {
        const value = composerRef.current.draft, start = event.target.selectionStart ?? value.length, end = event.target.selectionEnd ?? start
        updateComposer({ draft: value.slice(0, start) + pasted + value.slice(end) })
      }
      void addDraftImages(files)
    }
    const readDraftImages = async () => {
      const draft = imageDraft()
      if (!draft || imageBusyRef.current || draft.epoch !== epochRef.current) return
      const generation = imageGeneration.current, operation = {}; imageBusyRef.current = operation; setImageBusy('list'); setImageError('')
      try {
        const result = await call('images', { action: 'list', epoch: draft.epoch, draftId: draft.draftId })
        if (!alive.current || epochRef.current !== draft.epoch || imageGeneration.current !== generation) return
        if (!result || typeof result.scopeRevision !== 'string' || !/^[a-f0-9]{64}$/.test(result.scopeRevision) || !Array.isArray(result.items) || result.items.length > 5 || result.items.some((row: any) => !validImageRecord(row, draft)) || new Set(result.items.map((row: any) => row.imageId)).size !== result.items.length) throw new Error('invalid_image_list')
        if (result.scopeRevision !== imageScopeRef.current) fenceImageScope(result.scopeRevision)
        const current = imageDraftsRef.current[draft.epoch], seen = new Set(result.items.map((row: any) => row.imageId))
        const removed = array(current.items).filter(row => !seen.has(row.id) && row.status === 'release-unknown')
        const items = array(current.items).filter(row => !removed.includes(row)).map(row => {
          const receipt = result.items.find((entry: any) => entry.imageId === row.id)
          if (!receipt) return row // Absence is not proof that an uncertain upload never committed.
          if (receipt.digest !== row.digest || row.receipt && receipt.seq < row.receipt.seq) throw new Error('image_identity_changed')
          return { ...row, receipt, status: receipt.state, stale: receipt.stale === true || receipt.scopeRevision !== result.scopeRevision }
        })
        for (const receipt of result.items) if (!items.some(row => row.id === receipt.imageId)) items.push({ id: receipt.imageId, digest: receipt.digest, receipt, status: receipt.state, stale: receipt.stale === true || receipt.scopeRevision !== result.scopeRevision })
        if (items.length > 5) throw new Error('image_quota_changed')
        if (removed.length) retireImageURLs(removed.map(row => row.src))
        saveImageDraft(draft.epoch, { ...current, items, selected: items.some(row => row.id === current.selected) ? current.selected : '' })
      } catch { if (alive.current && imageGeneration.current === generation) setImageError(tr('ImageReadFailed')) }
      finally { if (imageBusyRef.current === operation) { imageBusyRef.current = null; if (alive.current) setImageBusy('') } }
    }
    const uploadDraftImage = async (id: string) => {
      const draft = imageDraft(), row = array(draft?.items).find(entry => entry.id === id)
      if (!draft || !row?.payload || row.stale || !['local', 'upload-unknown'].includes(row.status) || imageBusyRef.current || draft.epoch !== epochRef.current) return
      const generation = imageGeneration.current, operation = {}, payload = row.payload
      imageBusyRef.current = operation; setImageBusy(id); setImageError(''); saveImageDraft(draft.epoch, { ...draft, items: draft.items.map((entry: any) => entry.id === id ? { ...entry, status: 'uploading' } : entry) })
      try {
        const receipt = await call('images', { action: 'upload', ...payload })
        if (!alive.current || epochRef.current !== draft.epoch || imageGeneration.current !== generation) return
        if (!validImageRecord(receipt, draft) || receipt.imageId !== payload.uploadId || receipt.digest !== payload.digest || receipt.state !== 'staged' || receipt.seq !== 1 || imageScopeRef.current && receipt.scopeRevision !== imageScopeRef.current) throw new Error('invalid_image_receipt')
        const current = imageDraftsRef.current[draft.epoch]; saveImageDraft(draft.epoch, { ...current, items: current.items.map((entry: any) => entry.id === id ? { ...entry, receipt, status: 'staged' } : entry) })
      } catch { if (alive.current && imageGeneration.current === generation) { const current = imageDraftsRef.current[draft.epoch]; saveImageDraft(draft.epoch, { ...current, items: current.items.map((entry: any) => entry.id === id ? { ...entry, status: 'upload-unknown' } : entry) }); setImageError(tr('ImageUploadUnknown')) } }
      finally { if (imageBusyRef.current === operation) { imageBusyRef.current = null; if (alive.current) setImageBusy('') } }
    }
    const openDraftOriginal = async (id: string) => {
      const draft = imageDraft(), row = array(draft?.items).find(entry => entry.id === id)
      if (!draft || !row?.receipt || row.stale || imageBusyRef.current) return
      const generation = imageGeneration.current, operation = {}; imageBusyRef.current = operation; setImageBusy(id); setImageError('')
      try {
        const result = await call('images', { action: 'original', epoch: draft.epoch, reference: imageReference(row.receipt) })
        if (!result || result.mediaType !== 'image/png' || result.digest !== row.digest || typeof result.encoded !== 'string' || result.encoded.length > 11184812 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.encoded)) throw new Error('invalid_image_original')
        const binary = atob(result.encoded), bytes = Uint8Array.from(binary, value => value.charCodeAt(0)); inspectDraftPNG(bytes, result.mediaType)
        if (await imageHash(bytes) !== result.digest) throw new Error('image_digest_mismatch')
        if (!alive.current || epochRef.current !== draft.epoch || imageGeneration.current !== generation || !imageDraftsRef.current[draft.epoch]?.items.some((entry: any) => entry.id === id && entry.receipt?.seq === row.receipt.seq)) return
        const src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); imageURLs.current.add(src); retireImageURLs([row.src])
        const current = imageDraftsRef.current[draft.epoch]; saveImageDraft(draft.epoch, { ...current, items: current.items.map((entry: any) => entry.id === id ? { ...entry, src, originalVerified: true } : entry) })
      } catch { if (alive.current && imageGeneration.current === generation) { retireImageURLs([row.src]); const current = imageDraftsRef.current[draft.epoch]; saveImageDraft(draft.epoch, { ...current, items: current.items.map((entry: any) => entry.id === id ? { ...entry, src: '', payload: null, originalVerified: false, stale: true } : entry) }); setImageError(tr('ImageOriginalFailed')) } }
      finally { if (imageBusyRef.current === operation) { imageBusyRef.current = null; if (alive.current) setImageBusy('') } }
    }
    const chooseImageTarget = () => {
      const current = currentSessionAction()
      if (!current) return
      const draft = imageDraft(true); if (!draft) return
      saveImageDraft(draft.epoch, { ...draft, target: { ...current.target, project: { ...current.target.project } }, targetTitle: current.title }); openSystem('images')
    }
    const changeDraftImage = async (id: string, action: string) => {
      const draft = imageDraft(), row = array(draft?.items).find(entry => entry.id === id)
      if (!draft || !row || imageBusyRef.current || !['bind', 'release'].includes(action) || ['uploading', 'upload-unknown', 'bind-unknown', 'release-unknown'].includes(row.status)) return
      if (!row.receipt) { if (action !== 'release') return; retireImageURLs([row.src]); saveImageDraft(draft.epoch, { ...draft, selected: '', items: draft.items.filter((entry: any) => entry.id !== id) }); return }
      const target = draft.target
      if (action === 'bind' && (row.stale || !target || target.scopeRevision !== imageScopeRef.current || row.receipt.scopeRevision !== target.scopeRevision || !/^[a-f0-9]{64}$/.test(target.factRevision))) return
      const generation = imageGeneration.current, operation = {}; imageBusyRef.current = operation; setImageBusy(id); setImageError('')
      saveImageDraft(draft.epoch, { ...draft, items: draft.items.map((entry: any) => entry.id === id ? { ...entry, status: `${action}-pending` } : entry) })
      try {
        const result = await call('images', { action, epoch: draft.epoch, reference: imageReference(row.receipt), ...(action === 'bind' ? { target: { sessionId: target.sessionId, scopeRevision: target.scopeRevision, factRevision: target.factRevision } } : {}) })
        if (!alive.current || epochRef.current !== draft.epoch || imageGeneration.current !== generation) return
        const current = imageDraftsRef.current[draft.epoch]
        if (action === 'release') {
          if (result?.imageId !== row.receipt.imageId || result.state !== 'released' || result.seq !== row.receipt.seq + 1 || result.bytesRetained !== true || result.thirdPartyErasureGuaranteed !== false) throw new Error('invalid_image_release')
          retireImageURLs([row.src]); saveImageDraft(draft.epoch, { ...current, selected: '', items: current.items.filter((entry: any) => entry.id !== id) })
        } else {
          if (!validImageRecord(result, draft) || result.imageId !== row.receipt.imageId || result.digest !== row.digest || result.state !== 'bound' || result.seq !== row.receipt.seq + 1 || ['sessionId', 'scopeRevision', 'factRevision'].some(key => result.target?.[key] !== target[key]) || result.target?.project?.kind !== target.project.kind || result.target?.project?.key !== target.project.key) throw new Error('invalid_image_bind')
          saveImageDraft(draft.epoch, { ...current, items: current.items.map((entry: any) => entry.id === id ? { ...entry, receipt: result, status: 'bound' } : entry) })
        }
      } catch { if (alive.current && imageGeneration.current === generation) { const current = imageDraftsRef.current[draft.epoch]; saveImageDraft(draft.epoch, { ...current, items: current.items.map((entry: any) => entry.id === id ? { ...entry, status: `${action}-unknown` } : entry) }); setImageError(tr('ImageChangeUnknown')) } }
      finally { if (imageBusyRef.current === operation) { imageBusyRef.current = null; if (alive.current) setImageBusy('') } }
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
            sessionWorkGeneration.current++; sessionWorkPagesRef.current = {}; setSessionWorkPages({}); setSessionWorkError(''); excludedOpenRef.current = false; setExcludedOpen(false)
            resetScope(); resetLocate(); setInboxSelection(''); systemDataRef.current = {}; setSystemData({}); decisionLocationEpoch.current = ''; setDecisionLocation(null)
            const composerEpoch = prior || epoch
            const nextComposer = composerCache.current[composerEpoch] || readComposer(composerEpoch)
            composerCache.current[composerEpoch] = nextComposer; composerRef.current = nextComposer; setComposer(nextComposer)
            draftEpochRef.current = composerEpoch; setDraftEpoch(composerEpoch)
            historyRef.current = epoch; setHistoryEpoch(epoch); setNewReplies(0); setReplyOpen(false); setPlanReview('')
            if (prior) { setNotice(tr('EpochChanged')); dialogRef.current?.close(); setConfirmation(null) }
          }
          if (workspaceRef.current?.epoch === epoch && workspaceRef.current?.sessionWork?.revision !== data.sessionWork?.revision) {
            sessionWorkGeneration.current++; sessionWorkPagesRef.current = {}; setSessionWorkPages({}); setInboxSelection(''); decisionLocationEpoch.current = ''; setDecisionLocation(null)
            resetScope(); resetLocate()
          }
          fenceImageScope(data.sessionWork?.revision, epoch)
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
    React.useEffect(() => {
      for (const url of imageRevokeQueue.current) { URL.revokeObjectURL(url); imageURLs.current.delete(url) }
      imageRevokeQueue.current.clear()
    }, [imageDrafts, imageViewer])
    React.useEffect(() => () => { imageViewerRef.current?.close(); for (const url of imageURLs.current) URL.revokeObjectURL(url); imageURLs.current.clear() }, [])
    React.useEffect(() => { if (imageViewer) imageViewerRef.current?.showModal() }, [imageViewer])
    React.useLayoutEffect(() => {
      if (system || mobileTab !== 'chat') return
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
    }, [conversation, historyEpoch, activityView, mobileTab, system])
    // Pane visibility commits before focusing: a hidden tablet composer cannot receive focus.
    React.useEffect(() => {
      if (!system && mobileTab === 'chat' && !collapsed && !planReview && !replyOpen && inputRef.current && !inputRef.current.disabled) inputRef.current.focus()
    }, [mobileTab, collapsed, system])
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
      if (!system || ['locate', 'images'].includes(system)) return
      systemCloseRef.current?.focus()
      return () => { if (systemFocus.current?.isConnected) systemFocus.current.focus() }
    }, [!!system])
    React.useEffect(() => { if (system === 'scope' || system === 'locate') scopeHeadingRef.current?.focus() }, [system, scopeProject, scopeView])
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
      saveComposer(epoch, { ...current, receipt, ...(matches && (receipt.accepted === true || ['canceled', 'rejected'].includes(receipt.stage)) ? { pending: null, ...(receipt.accepted === true && current.draft === payload.text ? { draft: '', origin: null } : {}) } : {}) })
      if (alive.current && epoch === draftEpochRef.current) setNotice(receipt.accepted === true ? tr('AcceptedNotice') : tr('UnknownNotice'))
    }
    const submit = async (checkOnly = false) => {
      if (sendBusy.current || !epochRef.current) return
      if (!checkOnly && !composerRef.current.pending && (imageBusyRef.current || array(imageDraftsRef.current[epochRef.current]?.items).length)) { setNotice(tr('GoImageSendBlocked')); return }
      const saved = composerRef.current
      const existing = saved.pending
      const epoch = existing?.epoch || draftEpochRef.current
      if (!existing && epoch !== epochRef.current) return
      if (!existing && (checkOnly || !saved.draft.trim() || workspaceRef.current?.capabilities?.send !== true || historyRef.current !== epoch)) return
      if (!existing && (new TextEncoder().encode(saved.draft).length > 16384 || saved.draft.includes('\0'))) { setNotice(tr('TextLimit')); return }
      let payload: any = existing
      try {
        if (!payload) payload = { epoch, requestId: mintId(), intent: saved.target ? 'ticket-input' : saved.intent, text: saved.draft, ...(saved.target ? { ticketId: saved.target.id } : saved.origin && saved.origin.source !== 'session' ? { recreateFrom: saved.origin.id } : {}) }
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
        const exact = { epoch: payload.epoch, requestId: payload.requestId, intent: payload.intent, text: payload.text, ...(payload.ticketId ? { ticketId: payload.ticketId } : {}), ...(payload.recreateFrom ? { recreateFrom: payload.recreateFrom } : {}) }
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
    const syncViewRoute = (route: any) => {
      if (viewRouteHash(route) !== viewRouteHash(viewRouteRef.current)) navigationGeneration.current++
      viewRouteRef.current = route; setViewRoute(route); setMenuOpen(false)
      if (!routeWriting.current && typeof window !== 'undefined' && window.location.hash !== viewRouteHash(route)) window.location.hash = viewRouteHash(route)
    }
    const openDetail = (item: any) => {
      syncViewRoute({ view: 'ticket', id: item.id, tab: 'overview' })
      detailFocus.current = document.activeElement as HTMLElement
      if (detailIdRef.current !== item.id) { detailRef.current = null; setDetail(null) }
      detailIdRef.current = item.id; setDetailId(item.id); setDetailTab('overview'); setDetailError('')
      void readDetail(item.id)
    }
    const closeDetail = () => { detailIdRef.current = ''; setDetailId(''); syncViewRoute({ view: 'board' }) }
    const chooseDetailTab = (tab: string) => { if (!['overview', 'timeline', 'approvals', 'results'].includes(tab)) return; setDetailTab(tab); syncViewRoute({ view: 'ticket', id: detailIdRef.current, tab }) }
    const openSystem = (tab: string) => {
      if (!routeSystem.includes(tab) && tab !== 'todo' && tab !== 'decisions-home') return
      syncViewRoute({ view: tab === 'todo' ? 'decisions-home' : tab })
      if (tab === 'todo') tab = 'decisions-home'
      if (['locate', 'images'].includes(tab)) setMobileTab('chat')
      if (!systemRef.current) systemFocus.current = document.activeElement as HTMLElement
      if (tab === 'decisions' && locateResultRef.current?.status === 'located') { decisionLocationEpoch.current = epochRef.current; setDecisionLocation(structuredClone(locateResultRef.current)) }
      if (systemRef.current !== tab) { closeImageViewer() }
      if (systemRef.current !== tab && (systemRef.current === 'scope' || tab === 'scope')) resetScope()
      if (systemRef.current !== tab && (systemRef.current === 'locate' || tab === 'locate')) resetLocate()
      systemRef.current = tab; setSystem(tab); setSystemError('')
      if (['stage-models', 'decisions'].includes(tab)) setGoPanels((old: any) => ({ ...old, [tab]: true }))
      if (tab === 'scope') void readScopeProjects()
      else void readSystem()
      if (tab === 'decisions-home' && !sessionWorkPagesRef.current.included) void readSessionWork('included')
    }
    const closeSystem = () => { if (systemRef.current === 'scope') resetScope(); if (systemRef.current === 'locate') resetLocate(); systemRef.current = ''; setSystem(''); closeImageViewer() }
    const navigatePrimary = (tab: string) => {
      if (!['overview', 'projects', 'board', 'chat', 'decisions-home', 'settings'].includes(tab)) return
      if (['overview', 'projects', 'board', 'chat'].includes(tab)) { systemFocus.current = null; closeSystem(); if (tab === 'board') { detailIdRef.current = ''; setDetailId('') }; setMobileTab(tab); setCollapsed(false); syncViewRoute({ view: tab }) }
      else openSystem(tab)
    }
    const backSystem = () => {
      if (['locate', 'images'].includes(systemRef.current)) navigatePrimary('chat')
      else if (systemRef.current === 'decisions') openSystem('decisions-home')
      else if (systemRef.current !== 'settings') openSystem('settings')
      else navigatePrimary('overview')
    }
    const navigateProject = (selection: any = {}) => {
      const route = parseViewRoute(viewRouteHash({ ...selection, view: 'projects' }))
      if (route.view !== 'projects') return
      systemFocus.current = null; closeSystem(); setMobileTab('projects'); syncViewRoute(route)
    }
    const primaryTab = system ? ['decisions', 'decisions-home'].includes(system) ? 'decisions-home' : ['locate', 'images'].includes(system) ? 'chat' : 'settings' : ['board', 'ticket'].includes(viewRoute.view) ? 'projects' : mobileTab
    const primaryNavigation = () => h('nav', { className: 'saw-mobile-tabs saw-primary-nav', 'aria-label': tr('WorkspaceView') }, ...[['overview', 'GoOverview', '⌂'], ['projects', 'GoProjects', '▦'], ['decisions-home', 'YourDecisions', '◇'], ['chat', 'DeskTitle', '↗'], ['settings', 'Settings', '⚙']].map(([tab, label, icon]) => h('button', { type: 'button', className: 'saw-btn', onClick: () => navigatePrimary(tab!), key: tab, title: tr(label!), 'aria-label': tr(label!), 'aria-pressed': primaryTab === tab, 'aria-current': primaryTab === tab ? 'page' : undefined }, h('span', { className: 'saw-nav-icon', 'aria-hidden': true }, icon), h('span', { className: 'saw-nav-text' }, `${tr(label!)}${tab === 'chat' && newReplies ? ' •' : ''}`))))
    routeHandler.current = (route: any) => {
      if (route.view === 'projects') navigateProject(route)
      else if (route.view === 'ticket') { systemFocus.current = null; closeSystem(); setMobileTab('board'); openDetail({ id: route.id }); setDetailTab(route.tab || 'overview'); syncViewRoute(route) }
      else if (routeSystem.includes(route.view) || route.view === 'decisions-home') openSystem(route.view)
      else navigatePrimary(route.view)
    }
    React.useEffect(() => {
      const receive = () => { const hash = window.location.hash; if (hash && !hash.startsWith('#go/')) return; const route = parseViewRoute(hash); if (viewRouteHash(route) === viewRouteHash(viewRouteRef.current)) return; routeWriting.current = true; try { routeHandler.current?.(route) } finally { routeWriting.current = false } }
      window.addEventListener('hashchange', receive); receive()
      return () => window.removeEventListener('hashchange', receive)
    }, [])
    React.useEffect(() => { mainHeadingRef.current?.focus() }, [viewRoute.view])
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
      if (composerRef.current.pending || composerRef.current.draft.trim() || composerRef.current.target || composerRef.current.origin || imageBusyRef.current || array(imageDraftsRef.current[epochRef.current]?.items).length || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      updateComposer({ target: { id: item.id, title: item.title || tr('Untitled') }, origin: null }); navigatePrimary('chat')
      inputRef.current?.focus()
    }
    const recreate = (item: any) => {
      if (composerRef.current.pending || composerRef.current.draft.trim() || composerRef.current.target || composerRef.current.origin || imageBusyRef.current || array(imageDraftsRef.current[epochRef.current]?.items).length || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      if (item.state !== 'ended' || item.stoppedByHuman !== true || !detailRef.current?.brief?.goal) return
      updateComposer({ draft: detailRef.current.brief.goal, intent: 'new-task', target: null, origin: { id: item.id, title: item.title || tr('Untitled'), source: 'ticket' } })
      navigatePrimary('chat'); inputRef.current?.focus()
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
      setPlanReview(''); navigatePrimary('chat'); chooseActivity('history'); setReplyOpen(true); readLatestReply()
    }
    const startTask = () => {
      navigatePrimary('chat'); chooseActivity('history')
      if (composerRef.current.pending || composerRef.current.draft.trim() || composerRef.current.target || composerRef.current.origin || imageBusyRef.current || array(imageDraftsRef.current[epochRef.current]?.items).length || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); inputRef.current?.focus(); return }
      updateComposer({ intent: 'new-task', origin: null }); inputRef.current?.focus()
    }
    const replyToCoordinator = () => {
      if (composerRef.current.pending || composerRef.current.target || composerRef.current.draft.trim() || composerRef.current.origin || imageBusyRef.current || array(imageDraftsRef.current[epochRef.current]?.items).length || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      navigatePrimary('chat'); chooseActivity('history'); updateComposer({ intent: 'message', origin: null }); inputRef.current?.focus()
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
      closeSystem(); setMobileTab('board'); openDetail({ id: record.ticketId || record.id }); chooseDetailTab(tab)
    }
    const showAllTasks = () => { navigatePrimary('board'); changeFilter('', ''); setNotice(tr('AllTasksUnfiltered')) }
    const openPlan = (plan: any) => { setInboxSelection(`plan:${plan.planId}`); openSystem('decisions-home') }
    const decisionView = (entry: any) => {
      const data = entry.data, plan = entry.kind === 'plan'
      return h('article', { className: 'saw-decision', key: entry.id },
        h('small', { className: 'saw-meta' }, tr(plan ? 'PlanNeedsReview' : entry.kind === 'approval' ? 'OperationNeedsReview' : entry.kind === 'question' ? 'QuestionForYou' : 'TaskNeedsReview')),
        h('h4', { title: plan ? data.brief?.goal : data.title }, displayTitle(plan ? data.brief?.goal : data.title)),
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
          humanPending ? h(React.Fragment, null, h('p', null, tr(item?.anomaly ? 'StateConflict' : item?.pendingApprovals > 0 ? 'ApprovalStillPending' : 'InformationNeeded')), item?.attention ? valueView(item.attention) : null, item?.pendingApprovals > 0 ? button(tr('ReviewApproval'), () => chooseDetailTab('approvals')) : null) : null,
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
    const groupSessionWork = (rows: any) => {
      const groups = new Map<string, { key: string; kind: string; name: string; items: any[] }>(), seen = new Set<string>()
      for (const row of array(rows)) {
        if (typeof row?.sessionId !== 'string' || seen.has(row.sessionId)) continue
        seen.add(row.sessionId)
        const project = row.project, known = project?.kind === 'project' && typeof project.key === 'string' && !!project.key
        const kind = known ? 'project' : project?.kind === 'unassigned' ? 'unassigned' : 'unknown'
        const key = known ? `project:${project.key}` : kind
        if (!groups.has(key)) groups.set(key, { key, kind, name: known ? typeof project.name === 'string' && project.name.trim() ? project.name : tr('ProjectUntitled') : tr(kind === 'unassigned' ? 'ProjectUnassigned' : 'ProjectUnknown'), items: [] })
        groups.get(key)!.items.push(row)
      }
      return [...groups.values()]
    }
    const sessionWorkCard = (row: any, manage = false, revision?: string) => {
      const structured = row.evidence === 'structured', summary = structured && (row.objective || row.progress || row.nextAction || row.blocker || row.decision || array(row.done).length || row.result)
      return h('article', { className: 'saw-session-work-card', key: row.sessionId },
        row.excluded ? h(React.Fragment, null, h('h5', null, sessionSourceTitle(row)), h('small', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${String(row.sessionId).slice(-8)}`)) : h(React.Fragment, null,
          h('h5', null, structured && row.objective ? manage ? row.objective : displayTitle(row.objective) : tr(summary ? 'SessionWorkKnownWork' : 'SessionWorkNoSummary')),
          h('p', { className: 'saw-meta saw-session-source' }, `${tr('SessionWorkFrom')}: ${sessionSourceTitle(row)}${manage ? ` · ${tr('SessionWorkReference')}: …${String(row.sessionId).slice(-8)}` : ''}`),
          summary ? h(React.Fragment, null,
            array(row.done).length ? h('details', null, h('summary', null, tr('GoDone')), ...array(row.done).slice(0, 3).map((done: string, index: number) => h('p', { className: 'saw-pre', key: index }, done))) : null,
            row.progress ? h('p', { className: 'saw-session-line', title: row.progress }, `${tr('GoDoing')}: ${row.progress}`) : null,
            row.result?.acceptanceVerified === false ? h('p', { className: 'saw-meta', role: 'status' }, tr(row.result.state === 'goal-complete' ? 'GoResultUnverified' : 'GoResultEvidence')) : null,
            row.nextAction && (manage || !row.progress) ? h('p', { className: 'saw-session-line' }, `${tr('SessionWorkNext')}: ${row.nextAction}`) : null,
            row.blocker ? h('p', { className: 'saw-session-line' }, `${tr('SessionWorkBlocker')}: ${row.blocker}`) : null,
            row.decision ? h('div', { className: 'saw-session-decision' }, h('strong', null, tr('SessionWorkDecision')), h('p', { className: manage ? 'saw-pre' : 'saw-line-clamp', title: row.decision }, row.decision), h('small', null, tr('SessionWorkAnswerAtSource'))) : null) : null,
          h('details', { className: 'saw-session-facts' }, h('summary', null, tr('WorkObservationDetails')),
            structured && row.goalPhase ? h('span', null, `${tr('SessionWorkGoalPhase')}: ${tr(row.goalPhase === 'active' ? 'SessionWorkGoalActive' : row.goalPhase === 'paused' ? 'SessionWorkGoalPaused' : row.goalPhase === 'complete' ? 'SessionWorkGoalCompleted' : row.goalPhase === 'blocked' ? 'SessionWorkGoalBlocked' : 'Unknown')}`) : null,
            h('span', null, tr(row.runtime === 'running' ? 'SessionWorkRuntimeRunning' : row.runtime === 'idle' ? 'SessionWorkRuntimeIdle' : row.runtime === 'unavailable' ? 'SessionWorkRuntimeUnavailable' : 'SessionWorkRuntimeUnknown')),
            row.approvalCoverage === 'unavailable' ? h('p', { className: 'saw-meta' }, tr('GoApprovalCoverageMissing')) : null,
            h('span', null, `${tr('Snapshot')}: ${time(row.observedAt)}`))),
        manage ? h('details', { className: 'saw-session-facts' }, h('summary', null, tr('SessionIdentity')), h('code', { className: 'saw-fingerprint' }, row.sessionId)) : null,
        manage ? button(tr(row.excluded ? 'SessionWorkRestore' : 'SessionWorkExclude'), () => { void setSessionIncluded(row, row.excluded === true, revision) }, !!sessionWorkBusy || !revision, { className: 'saw-btn saw-text-btn' }) : null)
    }
    const sessionProjectGroups = (rows: any, manage = false, revision?: string, preview = false) => {
      const groups = groupSessionWork(rows)
      const reference = (key: string) => {
        const id = key.slice('project:'.length)
        let length = Math.min(8, id.length)
        while (length < id.length && groups.some(group => group.key !== key && group.kind === 'project' && group.key.slice('project:'.length).startsWith(id.slice(0, length)))) length++
        return id.slice(0, length)
      }
      return (preview ? groups.slice(0, 3) : groups).map(group => h('section', { className: 'saw-project-group', key: group.key },
        h('header', { className: 'saw-project-head' }, h('h4', null, group.name), group.kind === 'project' && groups.filter(other => other.kind === 'project' && other.name === group.name).length > 1 ? h('small', { className: 'saw-meta' }, `${tr('ProjectReference')}: ${reference(group.key)}`) : null,
          !preview ? h('small', { className: 'saw-meta' }, `${tr('ProjectLoadedSessions')}: ${group.items.length}`) : null),
        h('div', { className: 'saw-session-grid' }, ...(preview ? group.items.slice(0, 1) : group.items).map(row => sessionWorkCard(row, manage, revision)))))
    }
    const scopeSessionCard = (row: any, page: any, project: any) => {
      const excluded = row.excluded === true
      const currentRevision = !!page?.revision && page.revision === scopeProjects?.revision
      const canRestore = project.excluded !== true && row.exclusionReason !== 'membership-unknown'
      return h('article', { className: 'saw-session-work-card', key: row.sessionId },
        h('h4', null, sessionSourceTitle(row)), h('small', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${String(row.sessionId).slice(-8)}`),
        !excluded && row.evidence === 'structured' ? h(React.Fragment, null,
          row.objective ? h('p', { className: 'saw-pre' }, row.objective) : h('p', { className: 'saw-meta' }, tr('SessionWorkNoSummary')),
          ...['progress', 'nextAction', 'blocker', 'decision'].filter(key => row[key]).map(key => h('p', { key, className: 'saw-pre' }, `${tr(({ progress: 'ScopeProgress', nextAction: 'SessionWorkNext', blocker: 'SessionWorkBlocker', decision: 'SessionWorkDecision' } as any)[key])}: ${row[key]}`))) : !excluded ? h('p', { className: 'saw-meta' }, tr('SessionWorkNoSummary')) : null,
        h('details', { className: 'saw-session-facts' }, h('summary', null, tr('SessionIdentity')), h('code', { className: 'saw-fingerprint' }, row.sessionId)),
        excluded && !canRestore ? h('p', { className: 'saw-error' }, tr(project.excluded ? 'ScopeParentExcluded' : 'ScopeUnknownBlocked')) : null,
        button(tr(excluded ? 'SessionWorkRestore' : 'ScopeExcludeSession'), () => { void changeScopeIncluded('session', row, excluded, page.revision) }, !!scopeBusy || scopeMutation?.status === 'pending' || !currentRevision || excluded && !canRestore))
    }
    const scopeManagementView = () => {
      const selected = scopeProject, page = scopePages[scopeView], projects = array(scopeProjects?.items)
      const status = (data: any) => !data ? h('p', { className: 'saw-meta' }, tr(scopeBusy ? 'Loading' : 'ScopeNotLoaded')) : h(React.Fragment, null,
        data.state !== 'ready' ? h('p', { className: 'saw-error', role: 'status' }, tr(data.state === 'partial' ? 'ScopePartial' : 'SessionWorkUnavailable')) : null,
        h('p', { className: 'saw-meta' }, `${tr('Snapshot')}: ${time(data.sampledAt)} · ${tr(selected ? 'ScopeSessionTotal' : 'ScopeProjectTotal')}: ${text(data.total)}`))
      return h('section', { className: 'saw-session-work', 'aria-label': tr('ScopeManagement') },
        h('nav', { className: 'saw-row', 'aria-label': tr('ScopeBreadcrumb') }, button(tr('Settings'), () => openSystem('settings')), h('span', null, '›'), selected ? button(tr('ScopeManagement'), backScopeProjects, !!scopeBusy) : h('strong', { 'aria-current': 'page' }, tr('ScopeManagement')), selected ? h(React.Fragment, null, h('span', null, '›'), h('strong', { 'aria-current': 'page' }, scopeProjectName(selected))) : null),
        h('h3', { ref: scopeHeadingRef, tabIndex: -1 }, selected ? scopeProjectName(selected) : tr('ScopeManagement')),
        h('p', { className: 'saw-meta' }, tr('ScopeDefault')), h('p', { className: 'saw-meta' }, tr('ScopeExcludeWarning')), h('p', { className: 'saw-meta' }, tr('ScopeRestoreWarning')),
        scopeReceipt ? h('section', { className: 'saw-box', role: 'status' }, h('strong', null, tr(scopeReceipt.included ? scopeReceipt.kind === 'project' ? 'ScopeRestored' : 'ScopeSessionRestored' : 'ScopeExcluded')), h('p', { className: 'saw-meta' }, `${tr(scopeReceipt.kind === 'project' ? 'ProjectReference' : 'SessionIdentity')}: ${scopeReceipt.id}`), h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('Version')}: ${scopeReceipt.revision}`)) : null,
        scopeError ? h('p', { className: 'saw-error', role: 'alert' }, scopeError) : null,
        h('div', { className: 'saw-row' }, selected ? button(tr('ScopeBackProjects'), backScopeProjects, !!scopeBusy) : null, button(tr('ScopeRefresh'), () => { if (selected) backScopeProjects(); else void readScopeProjects() }, !!scopeBusy), scopeBusy ? h('span', { role: 'status' }, tr('Loading')) : null),
        !selected ? h(React.Fragment, null, status(scopeProjects),
          ...projects.map(row => h('article', { className: 'saw-box', key: scopeProjectKey(row) }, h('h4', null, scopeProjectName(row)),
            row.kind === 'project' ? h('small', { className: 'saw-meta' }, `${tr('ProjectReference')}: ${scopeProjectReference(row)}`) : null,
            h('p', { className: 'saw-meta' }, `${tr('ScopeSessionTotal')}: ${text(row.sessionTotal)} · ${tr('ScopeIncludedTotal')}: ${text(row.includedTotal)}`),
            h('span', { className: 'saw-badge' }, tr(row.kind === 'unknown' ? 'ScopeUnavailable' : row.excluded ? 'ScopeProjectExcluded' : 'ScopeProjectIncluded')),
            row.kind === 'unknown' ? h('p', { className: 'saw-error' }, tr('ScopeUnknownBlocked')) : h('div', { className: 'saw-row' }, button(tr('ScopeOpenProject'), () => openScopeProject(row), !!scopeBusy), row.kind === 'project' ? button(tr(row.excluded ? 'ScopeRestoreProject' : 'ScopeExcludeProject'), () => { void changeScopeIncluded('project', row, row.excluded === true, scopeProjects.revision) }, !!scopeBusy || scopeMutation?.status === 'pending' || !scopeProjects?.revision) : null))),
          scopeProjects?.state === 'ready' && scopeProjects.total === 0 ? h('p', { className: 'saw-meta' }, tr('ScopeNoProjects')) : null,
          scopeProjects?.hasMore && scopeProjects.next ? button(tr('ScopeMoreProjects'), () => { void readScopeProjects(true) }, !!scopeBusy) : null) : h(React.Fragment, null,
          selected.kind === 'project' ? h('p', { className: 'saw-meta' }, `${tr('ProjectReference')}: ${scopeProjectReference(selected)}`) : null,
          selected.excluded ? h('p', { className: 'saw-error' }, tr('ScopeParentExcluded')) : null,
          h('nav', { className: 'saw-detail-tabs', 'aria-label': tr('ScopeSessionViews') }, ...['included', 'excluded'].map(view => button(tr(view === 'included' ? 'ScopeIncluded' : 'SessionWorkExcludedList'), () => chooseScopeView(view), !!scopeBusy, { key: view, 'aria-pressed': scopeView === view }))),
          status(page), ...array(page?.items).map(row => scopeSessionCard(row, page, selected)),
          page?.state === 'ready' && page.total === 0 ? h('p', { className: 'saw-meta' }, tr(scopeView === 'included' ? 'ScopeNoIncluded' : 'ScopeNoExcluded')) : null,
          page?.hasMore && page.next ? button(tr('SessionWorkLoadMore'), () => { void readScopeSessions(scopeView, true) }, !!scopeBusy) : null))
    }
    const workDecisions = () => (desk.actions.length || (desk.actionTotal ?? 0) > 0) ? h('section', { className: 'saw-briefing-group', 'aria-label': tr('YourDecisions') },
      h('div', { className: 'saw-group-head' }, h('h3', null, tr('YourDecisions')), h('span', { className: 'saw-count' }, text(desk.actionTotal))),
      h('div', { className: 'saw-decision-grid' }, ...desk.actions.map(decisionView)),
      desk.moreActions ? h('div', { className: 'saw-row' }, button(tr('MorePlansApprovals'), () => openSystem('todo')), button(tr('MoreQuestions'), showAllTasks)) : null) : null
    const boardEmpty = !!board && !error && !boardError && columns.every(column => {
      const page = board.columns?.[column]
      return page && page.total === 0 && Array.isArray(page.items) && page.items.length === 0 && page.hasMore === false
    })
    const briefingView = () => h(React.Fragment, null,
      newReplies && latestAssistant ? h('article', { className: 'saw-new-reply' }, h('strong', null, tr('CoordinatorReplied')), h('p', { className: 'saw-line-clamp' }, latestAssistant.text), button(tr('ReadAndReply'), openReply)) : null,
      h('div', { className: 'saw-chat-intro' }, h('h3', null, tr('ChatIntro')), h('p', null, tr('ChatIntroHint'))),
      (desk.records.length || (desk.recordTotal ?? 0) > 0) ? h('details', { className: 'saw-recent saw-recent-details' }, h('summary', null, tr('RecentActivity')), desk.moreRecords ? button(tr('AllTasks'), showAllTasks) : null, ...desk.records.map(recordView), pendingPlans.some(plan => plan.state === 'approved' && plan.expiresAt > Date.now()) && desk.moreRecords ? button(tr('MorePlansApprovals'), () => openSystem('todo')) : null) : null)
    const scopeMutationBanner = () => scopeMutation ? h('div', { className: `saw-banner${scopeMutation.status === 'unknown' ? ' saw-error' : ''}`, role: 'status', 'aria-live': 'polite' },
      h('strong', null, tr(scopeMutation.status === 'pending' ? 'ScopeMutationPending' : scopeMutation.status === 'confirmed' ? 'ScopeMutationConfirmed' : 'ScopeMutationUnknown')),
      h('p', { className: 'saw-meta' }, `${tr(scopeMutation.kind === 'project' ? 'ProjectReference' : 'SessionIdentity')}: ${scopeMutation.id} · ${tr(scopeMutation.included ? 'ScopeIncluded' : 'SessionWorkExcludedList')}`),
      scopeMutation.epoch !== epochRef.current ? h('p', { className: 'saw-error' }, `${tr('ScopeMutationOldEpoch')}: ${scopeMutation.epoch}`) : null,
      h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('Version')}: ${scopeMutation.receiptRevision || scopeMutation.revision}`),
      h('p', { className: 'saw-meta' }, tr(scopeMutation.status === 'unknown' ? 'ScopeSaveFailed' : scopeMutation.included ? 'ScopeRestoreWarning' : 'ScopeExcludeWarning'))) : null
    const sessionActionStatus = (entry: any) => tr(({ draft: 'SessionActionDraft', pending: 'SessionActionPending', recorded: 'SessionActionRecorded', blocked: 'SessionActionBlocked', closed: 'SessionActionClosed', dispatch_unknown: 'SessionActionUnknown', unknown: 'SessionActionUnknown', accepted: 'SessionActionAccepted' } as any)[entry?.busy ? 'pending' : entry?.status] || 'SessionActionDraft')
    const sessionActionEvidence = (entry: any, original = false) => {
      const receipt = entry.receipt, state = entry.busy ? 'pending' : entry.status, unknown = state === 'unknown' || state === 'dispatch_unknown'
      return h('details', { className: 'saw-box', key: entry.key }, h('summary', null, `${tr(original ? 'SessionActionOriginal' : 'SessionActionEvidence')} · ${entry.title} · ${sessionActionStatus(entry)}`),
        h('p', { className: unknown ? 'saw-error' : 'saw-meta' }, sessionActionStatus(entry)),
        h('p', { className: 'saw-meta' }, `${tr('Project')}: ${entry.projectName} · ${entry.target.project.key}`),
        h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionIdentity')}: ${entry.target.sessionId}`),
        h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionScopeRevision')}: ${entry.target.scopeRevision}`),
        h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('LocateFactRevision')}: ${entry.target.factRevision}`),
        h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionEpoch')}: ${entry.epoch}`),
        entry.epoch !== epochRef.current ? h('p', { className: 'saw-error' }, tr('SessionActionOldEpoch')) : null,
        entry.epoch !== epochRef.current && unknown ? h('p', { className: 'saw-error' }, tr('SessionActionOldUnknown')) : null,
        h('p', { className: 'saw-meta' }, tr(({ continue: 'SessionActionContinue', supplement: 'SessionActionSupplement', steer: 'SessionActionSteer' } as any)[entry.operation])),
        h('p', { className: 'saw-meta' }, tr('SessionActionOriginalText')), h('p', { className: 'saw-pre' }, entry.pending?.text ?? entry.text),
        entry.pending ? h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionIds')}: ${entry.pending.requestId} · ${entry.pending.actionId}`) : null,
        receipt ? h(React.Fragment, null,
          h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionDigest')}: ${receipt.digest}`),
          h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionReceipt')}: ${receipt.state} · ${receipt.seq}${receipt.state === 'closed' ? '' : ` · ${receipt.messageId}`}`),
          receipt.state === 'closed' ? h('p', { className: 'saw-meta' }, tr('SessionActionClosureBinding')) : null,
          h('p', { className: 'saw-meta' }, `${tr('Time')}: ${time(receipt.at)} · ${tr('SessionActionUpdated')}: ${time(receipt.updatedAt)}`),
          h('p', { className: 'saw-meta' }, `${tr('SessionActionFlags')}: ${String(receipt.durable)} / ${String(receipt.accepted)} / ${receipt.executed === null ? tr('Unknown') : String(receipt.executed)} / ${receipt.completed === null ? tr('Unknown') : String(receipt.completed)}`),
          receipt.code ? h('p', { className: 'saw-error' }, `${tr('Code')}: ${receipt.code}`) : null) : null,
        entry.error ? h('p', { className: 'saw-error', role: 'alert' }, entry.error) : null,
        entry.pending && (unknown || receipt?.state === 'recorded') ? button(tr('SessionActionStatus'), () => { void checkSessionAction(entry.key, true) }, !!entry.busy || entry.epoch !== epochRef.current) : null,
        entry.status === 'unknown' && entry.epoch === epochRef.current ? h(React.Fragment, null, h('p', { className: 'saw-meta' }, tr('SessionActionCloseHint')), button(tr('SessionActionClose'), () => { void closeSessionAction(entry.key) }, !!entry.busy)) : null)
    }
    const sessionActionView = () => {
      const current = currentSessionAction(), entry = current ? sessionActions[current.key] : null
      const old = Object.values(sessionActions).filter((value: any) => value.key !== current?.key) as any[]
      const unresolved = Object.values(sessionActions).some((value: any) => value.pending && (!value.receipt || ['recorded', 'dispatch_unknown'].includes(value.receipt.state)))
      return h('section', { className: 'saw-session-work', 'aria-label': tr('SessionActionTitle'), onKeyDown: (e: any) => { if (e.key === 'Escape' && (sessionActionComposing.current || e.nativeEvent?.isComposing || e.isComposing || e.nativeEvent?.keyCode === 229 || e.keyCode === 229)) e.stopPropagation() } },
        current ? h('p', { className: 'saw-meta', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, sessionActionStatus(entry)) : null,
        current ? h('details', { className: 'saw-box', key: current.key }, h('summary', null, tr('SessionActionTitle')),
          h('p', { className: 'saw-error' }, tr('SessionActionBoundary')), h('code', { className: 'saw-fingerprint' }, 'SA_EXECUTION_BOUNDARY_UNVERIFIED'),
          h('h4', null, current.title), h('p', { className: 'saw-meta' }, `${tr('Project')}: ${current.projectName} · ${current.target.project.key}`),
          h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionIdentity')}: ${current.target.sessionId}`),
          h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionScopeRevision')}: ${current.target.scopeRevision}`),
          h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('LocateFactRevision')}: ${current.target.factRevision}`),
          h('p', { className: 'saw-meta' }, tr('SessionActionTextHint')),
          h('label', { className: 'saw-setting' }, tr('Operation'), h('select', { value: entry?.operation || 'continue', disabled: !!entry?.pending, onChange: (e: any) => editSessionAction(current.key, 'operation', e.target.value) }, ...['continue', 'supplement', 'steer'].map(value => h('option', { key: value, value }, tr(({ continue: 'SessionActionContinue', supplement: 'SessionActionSupplement', steer: 'SessionActionSteer' } as any)[value]))))),
          h('label', { className: 'saw-setting' }, tr('SessionActionText'), h('textarea', { ref: (node: HTMLTextAreaElement | null) => { if (node && sessionActionFocus.current === current.key && !entry?.pending) { sessionActionFocus.current = ''; node.focus() } }, value: entry?.text || '', rows: 4, maxLength: 16384, disabled: !!entry?.pending, onChange: (e: any) => editSessionAction(current.key, 'text', e.target.value), onCompositionStart: () => { sessionActionComposing.current = true }, onCompositionEnd: () => { sessionActionComposing.current = false }, onBlur: () => { sessionActionComposing.current = false } })),
          button(tr('SessionActionCheck'), () => { void checkSessionAction(current.key) }, !!entry?.pending || unresolved || !entry?.text?.trim()),
          entry?.error && !entry.pending ? h('p', { className: 'saw-error', role: 'alert' }, entry.error) : null,
          entry?.pending ? sessionActionEvidence(entry) : null,
          ['blocked', 'closed'].includes(entry?.status) && entry.receipt?.state === entry.status ? button(tr('SessionActionNewDraft'), () => newSessionActionDraft(current.key), !!entry.busy) : null,
          unresolved && !entry?.pending ? h('p', { className: 'saw-error' }, tr('SessionActionUnresolved')) : null) : null,
        old.length ? h('details', { className: 'saw-box' }, h('summary', null, `${tr('SessionActionRetained')} · ${old.length}`), h('p', { className: 'saw-meta' }, tr('SessionActionRetainedHint')), ...old.map(value => sessionActionEvidence(value, true))) : null)
    }
    const deliveryKey = (epoch: string, target: any) => JSON.stringify(['delivery', epoch, target.sessionId, target.scopeRevision, target.factRevision, target.project.kind, target.project.key])
    const currentDelivery = () => {
      const current = currentSessionAction()
      if (!current) return null
      const target = locateResultRef.current?.target
      // A requirement summary for the explicit new-task entry, never a delivery body.
      const requirement = target?.matchField === 'objective' && typeof target.matchText === 'string' && target.matchText.trim() ? target.matchText.trim() : current.title
      return { key: deliveryKey(current.epoch, current.target), epoch: current.epoch, target: current.target, title: current.title, requirement, projectName: current.projectName }
    }
    const deliveryDraftText = (key: string) => {
      const entry = sessionActionsRef.current?.[key]
      return entry && typeof entry.text === 'string' ? entry.text : ''
    }
    const deliveryStopReason = (key: string) => {
      const entry = deliveriesRef.current?.[key]
      return entry && typeof entry.stopReason === 'string' ? entry.stopReason : ''
    }
    const deliveryOperation = (key: string) => {
      const own = deliveriesRef.current?.[key]?.operation
      if (['continue', 'supplement', 'steer', 'stop'].includes(own)) return own
      const shared = sessionActionsRef.current?.[key]?.operation
      return ['continue', 'supplement', 'steer'].includes(shared) ? shared : 'continue'
    }
    const selectDeliveryOperation = (key: string, value: string) => {
      const current = currentDelivery(), entry = deliveriesRef.current?.[key]
      if (!alive.current || !current || current.key !== key || entry?.busy || entry?.pending || entry?.status && entry.status !== 'draft' || !['continue', 'supplement', 'steer', 'stop'].includes(value)) return
      saveDelivery(key, { ...(entry || { ...current, text: '', busy: null, receipt: null, pending: null, status: 'draft', error: '' }), operation: value, error: '' })
    }
    const editDeliveryStopReason = (key: string, value: string) => {
      const current = currentDelivery(), entry = deliveriesRef.current?.[key]
      if (!alive.current || !current || current.key !== key || entry?.busy || entry?.pending || entry?.status && entry.status !== 'draft' || typeof value !== 'string' || value.includes('\0')) return
      saveDelivery(key, { ...(entry || { ...current, operation: 'stop', text: '', busy: null, receipt: null, pending: null, status: 'draft', error: '' }), operation: 'stop', stopReason: value, error: '' })
    }
    const deliveryImageRefs = () => {
      const current = currentDelivery(), draft = current ? imageDraftsRef.current?.[current.epoch] : null, target = draft?.target
      if (!current || !draft || !target || target.sessionId !== current.target.sessionId || target.scopeRevision !== current.target.scopeRevision
        || target.factRevision !== current.target.factRevision || target.project?.kind !== current.target.project.kind || target.project?.key !== current.target.project.key) return []
      return array(draft.items).filter((row: any) => row?.status === 'bound' && row.stale !== true && row.receipt && row.receipt.state === 'bound'
        && typeof row.receipt.imageId === 'string' && typeof row.receipt.digest === 'string' && /^[a-f0-9]{64}$/.test(row.receipt.digest)
        && Number.isSafeInteger(row.receipt.seq) && row.receipt.seq > 0 && row.receipt.digest === row.digest).slice(0, 5)
        .map((row: any) => ({ imageId: row.receipt.imageId, digest: row.receipt.digest, seq: row.receipt.seq }))
    }
    const deliveryPayload = (entry: any, requestId: string, confirmationId: string) => {
      const target = entry.target, operation = deliveryOperation(entry.key)
      const payload = { epoch: entry.epoch, requestId, confirmationId, operation,
        text: operation === 'stop' ? deliveryStopReason(entry.key) : deliveryDraftText(entry.key),
        target: { sessionId: target.sessionId, scopeRevision: target.scopeRevision, factRevision: target.factRevision },
        images: operation === 'stop' ? [] : deliveryImageRefs() }
      return payload
    }
    const deliveryDigest = async (payload: any) => {
      const bytes = new TextEncoder().encode(JSON.stringify([payload.epoch, payload.requestId, payload.confirmationId, payload.operation, payload.text,
        payload.target.sessionId, payload.target.scopeRevision, payload.target.factRevision, array(payload.images).map((row: any) => [row.imageId, row.digest, row.seq])]))
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
    }
    const saveDelivery = (key: string, value: any) => {
      deliveriesRef.current = { ...deliveriesRef.current, [key]: value }
      if (alive.current) setDeliveries(deliveriesRef.current)
    }
    const validDeliveryReceipt = (receipt: any, entry: any) => {
      const input = entry?.pending, previous = entry?.receipt, hash = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      if (!input || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.getOwnPropertySymbols(receipt).length
        || Object.keys(receipt).some(key => !['version', 'epoch', 'requestId', 'confirmationId', 'operation', 'target', 'digest', 'bodyBytes', 'images', 'seq', 'at', 'updatedAt', 'state', 'humanConfirmed', 'delivered', 'accepted', 'executed', 'completed', 'disposition', 'durable', 'code'].includes(key))
        || receipt.version !== 1 || !['epoch', 'requestId', 'confirmationId', 'operation'].every(key => receipt[key] === input[key])
        || !receipt.target || typeof receipt.target !== 'object' || Array.isArray(receipt.target) || Object.keys(receipt.target).length !== 4
        || ['sessionId', 'scopeRevision', 'factRevision'].some(key => receipt.target[key] !== input.target[key])
        || receipt.target.project?.kind !== entry.target.project.kind || receipt.target.project?.key !== entry.target.project.key
        || !hash(receipt.digest) || receipt.digest !== entry.digest || receipt.bodyBytes !== new TextEncoder().encode(input.text).length
        || !Array.isArray(receipt.images) || receipt.images.length !== array(input.images).length
        || receipt.images.some((row: any, index: number) => !row || Object.keys(row).length !== 3 || row.imageId !== input.images[index]?.imageId || row.digest !== input.images[index]?.digest || row.seq !== input.images[index]?.seq)
        || !['prepared', 'confirmed', 'canceled'].includes(receipt.state) || receipt.seq !== (receipt.state === 'prepared' ? 1 : 2)
        || receipt.humanConfirmed !== (receipt.state === 'confirmed') || receipt.delivered !== false || receipt.accepted !== false || receipt.executed !== false || receipt.completed !== false
        || receipt.disposition !== (receipt.state === 'confirmed' ? 'confirmed-pending-delivery' : receipt.state === 'canceled' ? 'canceled' : 'not-confirmed')
        || receipt.durable !== true || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || !Number.isSafeInteger(receipt.updatedAt) || receipt.updatedAt < receipt.at
        || receipt.code !== undefined && (typeof receipt.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(receipt.code))) return false
      // A higher sequence cannot rewrite facts; terminal confirmations cannot roll back.
      if (previous && (receipt.seq < previous.seq || receipt.at !== previous.at || receipt.updatedAt < previous.updatedAt
        || receipt.seq === previous.seq && ['state', 'code', 'digest', 'bodyBytes', 'updatedAt', 'images', 'target'].some(key => JSON.stringify(receipt[key]) !== JSON.stringify(previous[key]))
        || ['confirmed', 'canceled'].includes(previous.state) && (receipt.state !== previous.state || receipt.seq !== previous.seq))) return false
      return true
    }
    const deliveryStatusName = (entry: any) => tr(({ draft: 'DeliveryDraft', pending: 'DeliveryPreparing', prepared: 'DeliveryPrepared', unknown: 'DeliveryUnknown', confirmed: 'DeliveryConfirmed', canceled: 'DeliveryDraft' } as any)[entry?.busy ? 'pending' : entry?.status] || 'DeliveryDraft')
    const deliveryOperationName = (value: string) => tr(({ continue: 'SessionActionContinue', supplement: 'SessionActionSupplement', steer: 'SessionActionSteer', stop: 'SessionActionStop' } as any)[value] || 'SessionActionContinue')
    const deliverySummary = (value: string) => {
      const line = value.split(/[\r\n]/, 1)[0]!.trim(), points = Array.from(line)
      return points.length > 90 ? `${points.slice(0, 90).join('').trimEnd()}…` : line
    }
    const prepareDelivery = async () => {
      const current = currentDelivery(), old = current ? deliveriesRef.current[current.key] : null
      if (!alive.current || deliveryBusyRef.current || !current || old?.busy || ['pending', 'prepared', 'confirmed'].includes(old?.status) || old?.status === 'unknown' && old?.pending) return
      const operation = deliveryOperation(current.key), stop = operation === 'stop'
      const bodyText = stop ? deliveryStopReason(current.key) : deliveryDraftText(current.key)
      const images = stop ? [] : deliveryImageRefs()
      const base = { key: current.key, epoch: current.epoch, target: current.target, title: current.title, projectName: current.projectName, requirement: current.requirement,
        operation, text: bodyText, ...(stop ? { stopReason: bodyText } : {}), images, busy: null, receipt: null, error: '' }
      // A stop carries no delivered body; its optional reason is still bounded and digest-bound.
      const limit = stop ? 2000 : 16_384
      if (new TextEncoder().encode(bodyText).length > limit || bodyText.includes('\0') || !stop && !bodyText.trim()) { saveDelivery(current.key, { ...base, pending: null, status: 'draft', error: tr(!stop && !bodyText.trim() ? 'DeliveryTextRequired' : 'TextLimit') }); return }
      let payload: any
      try { payload = deliveryPayload(current, mintId(), mintId()) } catch { saveDelivery(current.key, { ...base, pending: null, status: 'draft', error: tr('DeliveryUnavailable') }); return }
      const operationBusy = {}; deliveryBusyRef.current = operationBusy
      const entry = { ...base, pending: payload, busy: operationBusy, status: 'pending' }
      saveDelivery(current.key, entry)
      let requested = false
      try {
        const digest = await deliveryDigest(payload)
        const preparedEntry = { ...entry, digest }
        saveDelivery(current.key, preparedEntry)
        // Hashing is async: a new prepare still requires the exact currently located binding.
        if (!alive.current || currentDelivery()?.key !== current.key) { saveDelivery(current.key, { ...preparedEntry, busy: null, pending: null, status: 'draft' }); return }
        requested = true
        const receipt = await call('delivery', { action: 'prepare', ...payload })
        if (!validDeliveryReceipt(receipt, preparedEntry)) throw new Error('invalid_delivery_receipt')
        saveDelivery(current.key, { ...preparedEntry, busy: null, receipt, status: receipt.state, error: '' })
      } catch (e: any) {
        const saved = deliveriesRef.current[current.key] || entry
        if (requested && e?.status === 409) saveDelivery(current.key, { ...saved, busy: null, pending: null, status: 'draft', error: tr('DeliveryChanged') })
        else saveDelivery(current.key, { ...saved, busy: null, pending: requested ? payload : null, status: requested ? 'unknown' : 'draft', error: tr(requested ? 'DeliveryUnknown' : 'DeliveryUnavailable') })
      } finally { if (deliveryBusyRef.current === operationBusy) deliveryBusyRef.current = null }
    }
    const confirmDelivery = async (key: string) => {
      const entry = deliveriesRef.current[key], current = currentDelivery()
      if (!alive.current || deliveryBusyRef.current || !entry?.pending || entry.busy || entry.status !== 'prepared' || !current || current.key !== key || entry.epoch !== epochRef.current) return
      const payload = deliveryPayload(current, entry.pending.requestId, entry.pending.confirmationId)
      const operationBusy = {}; deliveryBusyRef.current = operationBusy
      saveDelivery(key, { ...entry, busy: operationBusy })
      try {
        const digest = await deliveryDigest(payload)
        if (!alive.current || currentDelivery()?.key !== key) { saveDelivery(key, { ...entry, busy: null }); return }
        // Any body/reason/image/target change invalidates the local prepared object before any confirm request.
        if (digest !== entry.digest) { saveDelivery(key, { ...entry, busy: null, pending: null, receipt: null, digest: undefined, status: 'draft', error: tr('DeliveryContentChanged') }); return }
        const receipt = await call('delivery', { action: 'confirm', ...payload })
        if (!validDeliveryReceipt(receipt, entry) || receipt.state !== 'confirmed') throw new Error('invalid_delivery_confirmation')
        saveDelivery(key, { ...entry, busy: null, receipt, status: 'confirmed', error: '' })
      } catch (e: any) {
        if (e?.status === 409) saveDelivery(key, { ...entry, busy: null, pending: null, receipt: null, digest: undefined, status: 'draft', error: tr('DeliveryChanged') })
        else saveDelivery(key, { ...entry, busy: null, status: 'unknown', error: tr('DeliveryConfirmUnknown') })
      } finally { if (deliveryBusyRef.current === operationBusy) deliveryBusyRef.current = null }
    }
    const validDeliveryDispatchReceipt = (receipt: any, entry: any) => {
      const input = entry?.pending, previous = entry?.dispatch, hash = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      const uuid = (value: any) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      const evidence = receipt?.stopEvidence, evidenceValid = evidence === 'turn-aborted' || evidence === 'cancel-accepted'
      const keys = ['version', 'epoch', 'requestId', 'confirmationId', 'dispatchId', 'messageId', 'operation', 'target', 'digest', 'bodyBytes', 'images', 'seq', 'at', 'updatedAt', 'state', 'code', 'durable', 'humanConfirmed', 'delivered', 'accepted', 'interrupted', 'executed', 'completed', 'disposition', 'stopEvidence']
      if (!input || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.getOwnPropertySymbols(receipt).length
        || Object.keys(receipt).some(key => !keys.includes(key))
        || receipt.version !== 1 || !['epoch', 'requestId', 'confirmationId', 'operation'].every(key => receipt[key] === input[key])
        || !receipt.target || typeof receipt.target !== 'object' || Array.isArray(receipt.target) || Object.keys(receipt.target).length !== 4
        || ['sessionId', 'scopeRevision', 'factRevision'].some(key => receipt.target[key] !== input.target[key])
        || receipt.target.project?.kind !== entry.target.project.kind || receipt.target.project?.key !== entry.target.project.key
        || !hash(receipt.digest) || receipt.digest !== entry.digest || !uuid(receipt.dispatchId)
        || receipt.bodyBytes !== new TextEncoder().encode(entry.text).length
        || !Array.isArray(receipt.images) || receipt.images.length !== array(input.images).length
        || receipt.images.some((row: any, index: number) => !row || Object.keys(row).length !== 3 || row.imageId !== input.images[index]?.imageId || row.digest !== input.images[index]?.digest || row.seq !== input.images[index]?.seq)
        || !['accepted', 'interrupted', 'dispatch_unknown', 'blocked'].includes(receipt.state)
        || ![2, 3].includes(receipt.seq) || receipt.state !== 'accepted' && receipt.state !== 'interrupted' && receipt.seq !== 2
        || receipt.accepted !== (receipt.state === 'accepted') || receipt.delivered !== (receipt.state === 'accepted')
        || receipt.interrupted !== (receipt.state === 'interrupted')
        || receipt.executed !== (receipt.state === 'blocked' ? false : null) || receipt.completed !== (receipt.state === 'blocked' ? false : null)
        || receipt.disposition !== (receipt.state === 'accepted' ? 'target-durable-receipt' : receipt.state === 'interrupted' ? 'stop-interrupted' : receipt.state === 'blocked' ? 'not-dispatched' : 'reconcile-only')
        || receipt.durable !== true || receipt.humanConfirmed !== true
        || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || !Number.isSafeInteger(receipt.updatedAt) || receipt.updatedAt < receipt.at
        || receipt.code !== undefined && (typeof receipt.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(receipt.code))) return false
      // A stop never claims a message identity and needs explicit evidence; a text delivery keeps its message ref.
      if (input.operation === 'stop') {
        if (receipt.messageId !== undefined || receipt.state === 'accepted' || (receipt.state === 'interrupted') !== evidenceValid || receipt.state === 'interrupted' && !evidenceValid) return false
        if (receipt.state !== 'interrupted' && receipt.stopEvidence !== undefined) return false
      } else if (receipt.messageId !== `go:${receipt.dispatchId}` || receipt.interrupted || receipt.stopEvidence !== undefined) return false
      // A higher sequence cannot rewrite facts; terminal dispatch outcomes cannot roll back.
      if (previous) {
        if (receipt.seq < previous.seq || receipt.at !== previous.at || receipt.updatedAt < previous.updatedAt) return false
        if (receipt.seq === previous.seq && ['state', 'code', 'updatedAt', 'digest', 'dispatchId', 'messageId'].some(key => receipt[key] !== previous[key])) return false
        if (previous.state === 'accepted' && receipt.state !== 'accepted') return false
        if (previous.state === 'interrupted' && receipt.state !== 'interrupted') return false
        if (previous.state === 'blocked' && receipt.state !== 'blocked') return false
        if (previous.state === 'dispatch_unknown' && !['dispatch_unknown', 'accepted', 'interrupted'].includes(receipt.state)) return false
      }
      return true
    }
    /** Dispatch the exact human-confirmed object once; later draft edits never ride along silently. */
    const dispatchDelivery = async (key: string) => {
      const entry = deliveriesRef.current[key], current = currentDelivery()
      if (!alive.current || deliveryBusyRef.current || !entry?.pending || entry.busy || entry.status !== 'confirmed' || !entry.receipt || entry.receipt.state !== 'confirmed'
        || entry.dispatch && entry.dispatch.state !== 'dispatch_unknown'
        || !current || current.key !== key || entry.epoch !== epochRef.current) return
      const payload = { epoch: entry.epoch, requestId: entry.pending.requestId, confirmationId: entry.pending.confirmationId, operation: entry.pending.operation,
        text: entry.text, target: { ...entry.pending.target }, images: array(entry.pending.images).map((row: any) => ({ ...row })) }
      const operationBusy = {}; deliveryBusyRef.current = operationBusy
      saveDelivery(key, { ...entry, busy: operationBusy, error: '' })
      try {
        const digest = await deliveryDigest(payload)
        if (!alive.current || currentDelivery()?.key !== key) { saveDelivery(key, { ...entry, busy: null }); return }
        if (digest !== entry.digest) { saveDelivery(key, { ...entry, busy: null, error: tr('DeliveryDispatchChanged') }); return }
        const receipt = await call('delivery', { action: 'dispatch', ...payload })
        if (!validDeliveryDispatchReceipt(receipt, entry)) throw new Error('invalid_delivery_dispatch_receipt')
        const error = receipt.state === 'blocked' ? tr(entry.operation === 'stop' ? (receipt.code === 'delivery_target_cold' ? 'DeliveryStopTargetCold' : 'DeliveryStopBlocked') : (receipt.code === 'delivery_target_cold' ? 'DeliveryTargetCold' : 'DeliveryDispatchBlocked')) : ''
        saveDelivery(key, { ...entry, busy: null, dispatch: receipt, dispatchStatus: receipt.state, error })
      } catch (e: any) {
        if (e?.status === 409) saveDelivery(key, { ...entry, busy: null, error: tr('DeliveryDispatchChanged') })
        else saveDelivery(key, { ...entry, busy: null, dispatchStatus: entry.dispatch?.state === 'accepted' ? 'accepted' : 'dispatch_unknown', error: tr(entry.operation === 'stop' ? 'DeliveryStopUnknown' : 'DeliveryDispatchUnknown') })
      } finally { if (deliveryBusyRef.current === operationBusy) deliveryBusyRef.current = null }
    }
    const cancelDelivery = async (key: string) => {
      const entry = deliveriesRef.current[key]
      if (!alive.current || !entry || entry.busy) return
      const clear = () => saveDelivery(key, { ...entry, busy: null, pending: null, receipt: null, digest: undefined, status: 'draft', error: '' })
      if (!entry.pending || entry.status === 'confirmed') { if (entry.status === 'confirmed') return; clear(); return }
      const operationBusy = {}; deliveryBusyRef.current = operationBusy
      saveDelivery(key, { ...entry, busy: operationBusy })
      try {
        // Tombstone the prepared id when possible; cancelling itself never sends or dispatches.
        const receipt = await call('delivery', { action: 'cancel', epoch: entry.epoch, confirmationId: entry.pending.confirmationId })
        if (receipt?.state !== 'canceled' || !validDeliveryReceipt(receipt, entry)) { clear(); return }
      } catch (e: any) {
        // Already confirmed elsewhere: never hide that behind a local draft.
        if (e?.code === 'delivery_confirmation_confirmed') { saveDelivery(key, { ...entry, busy: null, error: tr('DeliveryCancelConfirmed') }); if (deliveryBusyRef.current === operationBusy) deliveryBusyRef.current = null; return }
        /* the local draft is retained regardless of the cancel receipt */
      }
      clear()
      if (deliveryBusyRef.current === operationBusy) deliveryBusyRef.current = null
    }
    const checkDeliveryStatus = async (key: string) => {
      const entry = deliveriesRef.current[key]
      if (!alive.current || !entry?.pending || entry.busy || entry.epoch !== epochRef.current) return
      const operationBusy = {}; deliveryBusyRef.current = operationBusy
      saveDelivery(key, { ...entry, busy: operationBusy, error: '' })
      try {
        const receipt = await call('delivery', { action: 'status', epoch: entry.epoch, confirmationId: entry.pending.confirmationId })
        if (!validDeliveryReceipt(receipt, { ...entry, receipt: null })) throw new Error('invalid_delivery_status')
        if (receipt.state === 'confirmed') saveDelivery(key, { ...entry, busy: null, receipt, status: 'confirmed', error: '' })
        else if (receipt.state === 'prepared') saveDelivery(key, { ...entry, busy: null, receipt, status: 'prepared', error: '' })
        else saveDelivery(key, { ...entry, busy: null, pending: null, receipt: null, digest: undefined, status: 'draft', error: '' })
      } catch (e: any) {
        // A 404 for this exact preparation means no prepared record exists; it never proves delivery.
        if (e?.status === 404) saveDelivery(key, { ...entry, busy: null, pending: null, receipt: null, digest: undefined, status: 'draft', error: tr('DeliveryNotFound') })
        else saveDelivery(key, { ...entry, busy: null, error: tr('DeliveryErrorUnknown') })
      }
      finally { if (deliveryBusyRef.current === operationBusy) deliveryBusyRef.current = null }
    }
    const prepareAgainDelivery = (key: string) => {
      const entry = deliveriesRef.current?.[key], current = currentDelivery()
      if (!alive.current || !entry || entry.busy || !current || current.key !== key || entry.epoch !== epochRef.current || entry.dispatch?.state !== 'blocked') return
      // A blocked dispatch is terminal for its exact IDs. A fresh human confirmation (new IDs) is the
      // only retry; the old fence stays as immutable evidence and is never replayed.
      saveDelivery(key, { ...entry, pending: null, receipt: null, digest: undefined, dispatch: undefined, dispatchStatus: undefined, status: 'draft', error: '' })
    }
    const recreateFromStoppedDelivery = (key: string) => {
      const current = currentDelivery()
      if (composerRef.current.pending || composerRef.current.draft.trim() || composerRef.current.target || composerRef.current.origin || imageBusyRef.current || array(imageDraftsRef.current[epochRef.current]?.items).length || draftEpochRef.current !== epochRef.current) { setNotice(tr('ResolveDraftFirst')); return }
      if (!alive.current || !current || current.key !== key) return
      const requirement = typeof current.requirement === 'string' && current.requirement.trim() ? current.requirement.trim() : typeof current.title === 'string' ? current.title.trim() : ''
      if (!requirement) { setNotice(tr('DeliveryStopRecreateUnavailable')); return }
      // The requirement summary is copied into a fresh new-task draft. The stopped conversation is
      // never resumed, and a session origin is never sent as a ticket recreateFrom.
      updateComposer({ draft: requirement, intent: 'new-task', target: null, origin: { id: current.target.sessionId, title: requirement, source: 'session' } })
      navigatePrimary('chat'); inputRef.current?.focus()
    }
    const deliveryConfirmationView = () => {
      const current = currentDelivery(), entry = current ? deliveries[current.key] : null
      const operation = current ? deliveryOperation(current.key) : 'continue', stop = operation === 'stop'
      const bodyText = current ? (stop ? deliveryStopReason(current.key) : deliveryDraftText(current.key)) : ''
      const images = current && !stop ? deliveryImageRefs() : []
      const busy = !!entry?.busy, dispatch = entry?.dispatch
      const body = bodyText.trim() ? new TextEncoder().encode(bodyText).length : 0
      return h('section', { className: 'saw-box saw-delivery', 'aria-label': tr('DeliveryTitle') },
        h('h3', null, tr('DeliveryTitle')),
        h('p', { className: 'saw-meta' }, tr('DeliveryHint')),
        !current ? h('p', { className: 'saw-meta' }, tr('DeliveryNoTarget')) : h(React.Fragment, null,
          h('p', { className: 'saw-meta' }, `${tr('Project')}: ${current.projectName} · ${current.target.project.key}`),
          h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionIdentity')}: ${current.target.sessionId}`),
          h('label', { className: 'saw-setting' }, tr('Operation'), h('select', { value: operation, disabled: busy || !!entry?.pending || entry?.status && entry.status !== 'draft', onChange: (e: any) => selectDeliveryOperation(current.key, e.target.value) },
            ...['continue', 'supplement', 'steer', 'stop'].map(value => h('option', { key: value, value }, tr(({ continue: 'SessionActionContinue', supplement: 'SessionActionSupplement', steer: 'SessionActionSteer', stop: 'SessionActionStop' } as any)[value]))))),
          stop ? h('p', { className: 'saw-error' }, tr('DeliveryStopHint')) : null,
          entry?.busy || entry?.status === 'pending' ? h('p', { className: 'saw-meta', role: 'status', 'aria-live': 'polite' }, tr('DeliveryPreparing')) : null,
          entry?.status === 'prepared' && entry.receipt ? (stop ? h('section', { className: 'saw-delivery-summary', role: 'status', 'aria-label': tr('DeliveryStopConfirmSummary') },
            h('h4', null, tr('DeliveryStopConfirmSummary')),
            h('p', null, `${tr('Project')}: ${current.projectName} · ${current.title}`),
            h('p', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${String(current.target.sessionId).slice(-8)} · ${tr('Operation')}: ${tr('SessionActionStop')}`),
            entry.receipt.bodyBytes ? h('p', { className: 'saw-pre' }, deliverySummary(entry.text)) : h('p', { className: 'saw-meta' }, tr('DeliveryStopNoReason')),
            h('p', { className: 'saw-meta' }, tr('DeliveryStopConfirmHint')),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('DeliveryDigest')}: ${entry.receipt.digest}`),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionScopeRevision')}: ${entry.receipt.target.scopeRevision}`),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('LocateFactRevision')}: ${entry.receipt.target.factRevision}`),
            h('div', { className: 'saw-row' }, button(tr('DeliveryStopConfirm'), () => { void confirmDelivery(current.key) }, busy, { className: 'saw-btn saw-action-primary' }),
              button(tr('DeliveryCancel'), () => { void cancelDelivery(current.key) }, busy))) : h('section', { className: 'saw-delivery-summary', role: 'status', 'aria-label': tr('DeliveryConfirmSummary') },
            h('h4', null, tr('DeliveryConfirmSummary')),
            h('p', null, `${tr('Project')}: ${current.projectName} · ${current.title}`),
            h('p', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${String(current.target.sessionId).slice(-8)} · ${tr('Operation')}: ${deliveryOperationName(entry.receipt.operation)}`),
            h('p', { className: 'saw-meta' }, tr('DeliveryBodySummary')), h('p', { className: 'saw-pre' }, deliverySummary(entry.text)),
            h('p', { className: 'saw-meta' }, `${tr('DeliveryBodyBytes')}: ${entry.receipt.bodyBytes} · ${tr('DeliveryImages')}: ${array(entry.receipt.images).length}`),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('DeliveryDigest')}: ${entry.receipt.digest}`),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('SessionActionScopeRevision')}: ${entry.receipt.target.scopeRevision}`),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('LocateFactRevision')}: ${entry.receipt.target.factRevision}`),
            h('p', { className: 'saw-meta' }, tr('DeliveryConfirmHint')),
            h('div', { className: 'saw-row' }, button(tr('DeliveryConfirm'), () => { void confirmDelivery(current.key) }, busy, { className: 'saw-btn saw-action-primary' }),
              button(tr('DeliveryCancel'), () => { void cancelDelivery(current.key) }, busy)),
            h('p', { className: 'saw-meta' }, tr('DeliveryPrepared')))) : null,
          entry?.status === 'confirmed' && entry.receipt ? h('section', { className: 'saw-delivery-summary', role: 'status', 'aria-label': tr('DeliveryConfirmed') },
            h('strong', null, tr('DeliveryConfirmed')),
            h('p', { className: 'saw-meta' }, tr('DeliveryConfirmedHint')),
            h('p', { className: 'saw-meta' }, `${tr('DeliveryHandoff')}: ${entry.receipt.disposition}`),
            h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('DeliveryDigest')}: ${entry.receipt.digest}`),
            h('p', { className: 'saw-meta' }, `${tr('Time')}: ${time(entry.receipt.updatedAt)}`),
            entry.busy ? h('p', { className: 'saw-meta', role: 'status', 'aria-live': 'polite' }, tr(stop ? 'DeliveryStopDispatching' : 'DeliveryDispatching')) : null,
            !dispatch ? button(tr(stop ? 'DeliveryStopDispatch' : 'DeliveryDispatch'), () => { void dispatchDelivery(current.key) }, busy, { className: 'saw-btn saw-action-primary' }) : null,
            dispatch ? h('section', { className: 'saw-delivery-summary', role: 'status', 'aria-label': tr('DeliveryDispatchState') },
              h('strong', null, tr(dispatch.state === 'accepted' ? 'DeliveryAccepted' : dispatch.state === 'interrupted' ? 'DeliveryStopInterrupted' : dispatch.state === 'blocked' ? (stop ? 'DeliveryStopBlocked' : 'DeliveryDispatchBlocked') : (stop ? 'DeliveryStopUnknown' : 'DeliveryDispatchUnknown'))),
              dispatch.state === 'accepted' ? h(React.Fragment, null,
                h('p', { className: 'saw-meta' }, tr('DeliveryAcceptedHint')),
                h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('DeliveryDispatchId')}: ${dispatch.dispatchId}`),
                h('p', { className: 'saw-meta' }, `${tr('Time')}: ${time(dispatch.updatedAt)}`)) : null,
              dispatch.state === 'interrupted' ? h(React.Fragment, null,
                h('p', { className: 'saw-meta' }, tr('DeliveryStopInterruptedHint')),
                h('p', { className: 'saw-meta' }, `${tr('DeliveryStopEvidence')}: ${tr(dispatch.stopEvidence === 'turn-aborted' ? 'DeliveryStopEvidenceTurn' : 'DeliveryStopEvidenceCancel')}`),
                h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('DeliveryDispatchId')}: ${dispatch.dispatchId}`),
                h('p', { className: 'saw-meta' }, `${tr('Time')}: ${time(dispatch.updatedAt)}`),
                h('p', { className: 'saw-meta' }, tr('DeliveryStopRecreateHint')),
                button(tr('RecreateTask'), () => recreateFromStoppedDelivery(current.key), busy)) : null,
              dispatch.state === 'dispatch_unknown' ? h(React.Fragment, null,
                h('p', { className: 'saw-error' }, tr(stop ? 'DeliveryStopUnknown' : 'DeliveryDispatchUnknown')),
                button(tr('DeliveryQueryDispatch'), () => { void dispatchDelivery(current.key) }, busy)) : null,
              dispatch.state === 'blocked' ? h(React.Fragment, null,
                h('p', { className: 'saw-error' }, tr(stop ? (dispatch.code === 'delivery_target_cold' ? 'DeliveryStopTargetCold' : 'DeliveryStopBlocked') : (dispatch.code === 'delivery_target_cold' ? 'DeliveryTargetCold' : 'DeliveryDispatchBlocked'))),
                h('p', { className: 'saw-meta' }, tr(stop ? 'DeliveryStopBlockedHint' : 'DeliveryDispatchBlockedHint')),
                dispatch.code ? h('p', { className: 'saw-meta' }, `${tr('Code')}: ${dispatch.code}`) : null,
                button(tr('DeliveryPrepareAgain'), () => prepareAgainDelivery(current.key), busy)) : null) : null,
            !dispatch && entry.dispatchStatus === 'dispatch_unknown' ? h('div', { className: 'saw-row' },
              h('p', { className: 'saw-error' }, tr(stop ? 'DeliveryStopUnknown' : 'DeliveryDispatchUnknown')),
              button(tr('DeliveryQueryDispatch'), () => { void dispatchDelivery(current.key) }, busy)) : null,
            !dispatch && entry.dispatchStatus === 'blocked' ? h('p', { className: 'saw-error' }, entry.error || tr(stop ? 'DeliveryStopBlocked' : 'DeliveryDispatchBlocked')) : null,
            !dispatch && entry.dispatchStatus !== 'dispatch_unknown' && entry.dispatchStatus !== 'blocked' ? entry.error ? h('p', { className: 'saw-error', role: 'alert' }, entry.error) : null : null) : null,
          entry?.status === 'unknown' ? h('div', { className: 'saw-row' },
            h('p', { className: 'saw-error' }, entry.error || tr(stop ? 'DeliveryStopUnknown' : 'DeliveryErrorUnknown')),
            button(tr('DeliveryQueryStatus'), () => { void checkDeliveryStatus(current.key) }, busy)) : null,
          !entry || entry.status === 'draft' ? (stop ? h(React.Fragment, null,
            h('p', { className: 'saw-meta' }, tr('DeliveryStopReasonHint')),
            h('label', { className: 'saw-setting' }, tr('DeliveryStopReason'), h('textarea', { value: deliveryStopReason(current.key), rows: 3, maxLength: 2000, disabled: busy, onChange: (e: any) => editDeliveryStopReason(current.key, e.target.value) })),
            h('p', { className: 'saw-meta' }, `${tr('DeliveryStopReasonBytes')}: ${body}`),
            h('p', { className: 'saw-meta' }, entry?.error || deliveryStatusName(entry)),
            button(tr('DeliveryStopPrepare'), () => { void prepareDelivery() }, busy, { className: 'saw-btn saw-action-primary' })) : h(React.Fragment, null,
            h('p', { className: 'saw-meta' }, tr('DeliveryBodySummary')),
            bodyText.trim() ? h('p', { className: 'saw-pre' }, deliverySummary(bodyText)) : h('p', { className: 'saw-meta' }, tr('DeliveryTextRequired')),
            h('p', { className: 'saw-meta' }, `${tr('DeliveryBodyBytes')}: ${body} · ${tr('DeliveryImages')}: ${images.length}`),
            h('p', { className: 'saw-meta' }, entry?.error || deliveryStatusName(entry)),
            button(tr('DeliveryPrepare'), () => { void prepareDelivery() }, busy || !bodyText.trim(), { className: 'saw-btn saw-action-primary' }))) : null))
    }
    const locateView = (actions?: () => any, images?: () => any) => {
      const result = locateResult
      return h('section', { className: 'saw-session-work', 'aria-label': tr('LocateTitle') },
        h('nav', { className: 'saw-row', 'aria-label': tr('ScopeBreadcrumb') }, button(tr('Settings'), () => openSystem('settings')), h('span', null, '›'), button(tr('ScopeManagement'), () => openSystem('scope')), h('span', null, '›'), h('strong', { 'aria-current': 'page' }, tr('LocateTitle'))),
        h('h3', { ref: scopeHeadingRef, tabIndex: -1 }, tr('LocateTitle')), h('p', { className: 'saw-meta' }, tr('LocateHint')), h('p', { className: 'saw-error' }, tr('LocateOnly')),
        h('label', { className: 'saw-setting' }, tr('LocateQuery'), h('input', { type: 'text', value: locateText, maxLength: 16384, disabled: locateBusy, onChange: (e: any) => editLocateText(e.target.value), placeholder: tr('LocatePlaceholder') })),
        button(tr(locateBusy ? 'Loading' : 'LocateCheck'), () => { void readLocate() }, locateBusy || !locateText.trim()),
        locateError ? h('p', { className: 'saw-error', role: 'alert' }, locateError) : null,
        result ? h('section', { className: 'saw-box' }, h('h4', { role: 'status' }, tr(({ located: 'LocateLocated', clarify: 'LocateClarify', no_match: 'LocateNoMatch', blocked: 'LocateBlocked' } as any)[result.status])),
          result.coverage === 'partial' ? h('p', { className: 'saw-error' }, tr('LocatePartial')) : null,
          result.status === 'clarify' && /^stage_locate_(?:intent|project)_/.test(String(result.code || '')) ? h('p', { className: 'saw-error' }, tr('LocateIntentClarify')) : null,
          h('p', { className: 'saw-meta' }, `${tr('LocateSearched')}: ${text(result.searched)} · ${tr('LocateCandidateTotal')}: ${text(result.candidateTotal ?? (result.status === 'located' ? 1 : result.status === 'no_match' ? 0 : undefined))}`),
          result.code ? h('p', { className: 'saw-meta' }, `${tr('Code')}: ${result.code}`) : null,
          h('p', { className: 'saw-error' }, `${tr('LocateOnly')} · ${result.executionReason}`),
          ...array(result.candidates).map(row => h('article', { className: 'saw-box', key: row.sessionId }, h('h4', null, sessionSourceTitle(row)), h('p', { className: 'saw-meta' }, `${scopeProjectName(row.project)}${row.project.kind === 'project' ? ` · ${tr('ProjectReference')}: ${String(row.project.key).slice(0, 12)}` : ''}`),
            h('p', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${String(row.sessionId).slice(-8)} · ${tr(row.evidence === 'structured' ? 'LocateStructured' : 'SessionWorkNoSummary')}`),
            ['objective', 'progress', 'nextAction', 'title'].includes(row.matchField) && typeof row.matchText === 'string' && row.matchText.trim() ? h('p', { className: 'saw-pre' }, h('strong', null, `${tr(({ objective: 'Goal', progress: 'ScopeProgress', nextAction: 'SessionWorkNext', title: 'LocateMatchTitle' } as any)[row.matchField])}: `), row.matchText) : h('p', { className: 'saw-meta' }, tr('LocateMatchUnavailable')),
            h('details', { className: 'saw-session-facts' }, h('summary', null, tr('SessionIdentity')), h('code', { className: 'saw-fingerprint' }, row.sessionId), h('p', { className: 'saw-meta saw-fingerprint' }, `${tr('LocateFactRevision')}: ${text(row.factRevision)}`)),
            result.status === 'clarify' ? button(tr('LocateRecheck'), () => { void readLocate(row) }, locateBusy || !result.revision) : null))) : null,
        images ? images() : null,
        actions ? actions() : null)
    }
    const selectDraftImage = (id: string) => { const draft = imageDraft(); if (draft && draft.items.some((row: any) => row.id === id)) { closeImageViewer(); saveImageDraft(draft.epoch, { ...draft, selected: id }) } }
    const imageDraftView = () => {
      const draft = imageDrafts[epochRef.current], rows = array(draft?.items), selected = rows.find(row => row.id === draft?.selected)
      const statusName = (row: any) => tr(({ local: 'ImageLocal', uploading: 'ImageUploading', staged: 'ImageStaged', bound: 'ImageBound', 'upload-unknown': 'ImageUploadUnknown', 'bind-unknown': 'ImageChangeUnknown', 'release-unknown': 'ImageChangeUnknown' } as any)[row.status] || 'Unknown')
      return h('section', { className: 'saw-session-work', 'aria-label': tr('ImageDraftTitle'), onPaste: pasteDraftImages },
        h('nav', { className: 'saw-row', 'aria-label': tr('ScopeBreadcrumb') }, button(tr('Settings'), () => openSystem('settings')), h('span', null, '›'), button(tr('LocateTitle'), () => openSystem('locate')), h('span', null, '›'), h('strong', { 'aria-current': 'page' }, tr('ImageDraftTitle'))),
        h('h3', null, tr('ImageDraftTitle')), h('p', { className: 'saw-meta' }, tr('ImageDraftHint')), h('p', { className: 'saw-error' }, tr('ImageCapabilityBlocked')),
        h('label', { className: 'saw-setting' }, tr('ImagePick'), h('input', { type: 'file', accept: 'image/png', multiple: true, disabled: !!imageBusy || rows.length >= 5, onChange: (event: any) => { const files = Array.from(event.target.files || []); event.target.value = ''; void addDraftImages(files) } })),
        h('p', { className: 'saw-meta' }, tr('ImageFormatLimit')),
        h('div', { className: 'saw-row' }, button(tr('ImageReconcile'), () => { void readDraftImages() }, !draft || !!imageBusy), imageBusy ? h('span', { role: 'status' }, tr('Loading')) : null),
        imageError ? h('p', { className: 'saw-error', role: 'alert' }, imageError) : null,
        draft?.target ? h('section', { className: 'saw-box' }, h('h4', null, tr('ImageTarget')), h('p', null, draft.targetTitle), h('p', { className: 'saw-meta' }, `${tr('SessionWorkReference')}: …${draft.target.sessionId.slice(-8)}`), h('details', null, h('summary', null, tr('TechnicalDetails')), h('p', { className: 'saw-fingerprint' }, `${draft.target.sessionId} · ${draft.target.scopeRevision} · ${draft.target.factRevision}`)), h('p', { className: 'saw-meta' }, tr('ImageBindingOnly'))) : h('p', { className: 'saw-meta' }, tr('ImageNoTarget')),
        !selected ? h(React.Fragment, null, h('p', { className: 'saw-meta' }, `${tr('ImageCount')}: ${rows.length} / 5`), h('div', { className: 'saw-row', 'aria-label': tr('ImageThumbnails') }, ...rows.map((row, index) => h('button', { type: 'button', className: 'saw-btn', key: row.id, onClick: () => selectDraftImage(row.id), 'aria-label': `${tr('ImageDetails')} ${index + 1}` }, row.src ? h('img', { src: row.src, alt: `${tr('ImagePreview')} ${index + 1}`, style: { width: '72px', height: '72px', objectFit: 'contain' } }) : h('span', null, `${tr('ImageDetails')} ${index + 1}`), h('span', null, statusName(row)))))) : h('article', { className: 'saw-box' },
          button(tr('ImageBackThumbnails'), () => { closeImageViewer(); saveImageDraft(draft.epoch, { ...draft, selected: '' }) }), h('h4', null, tr('ImageDetails')), h('p', { role: 'status', className: 'saw-meta' }, statusName(selected)),
          selected.stale ? h('p', { className: 'saw-error' }, tr('ImageStale')) : null,
          selected.src ? h('figure', { className: 'saw-image-figure' }, h('img', { src: selected.src, alt: tr('ImagePreview'), style: { maxWidth: '100%', maxHeight: '280px', objectFit: 'contain' } }), h('figcaption', null, tr(selected.originalVerified ? 'ImageOriginalVerified' : 'ImagePreviewOnly'))) : h('p', { className: 'saw-meta' }, tr('ImageNoPreview')),
          h('p', { className: 'saw-meta' }, `${selected.receipt?.width || selected.width || '?'} × ${selected.receipt?.height || selected.height || '?'} · ${selected.receipt?.size || selected.size || '?'} B`),
          h('div', { className: 'saw-row' }, !selected.receipt && selected.payload ? button(tr(selected.status === 'upload-unknown' ? 'ImageRetrySame' : 'ImageUpload'), () => { void uploadDraftImage(selected.id) }, !!imageBusy || selected.stale) : null,
            selected.receipt ? button(tr('ImageLoadOriginal'), () => { void openDraftOriginal(selected.id) }, !!imageBusy || selected.stale) : null,
            selected.src ? button(tr('ImageEnlarge'), () => setImageViewer({ src: selected.src }), !!imageBusy) : null,
            selected.receipt ? button(tr('ImageBind'), () => { void changeDraftImage(selected.id, 'bind') }, !!imageBusy || selected.stale || !draft.target || !['staged', 'bound'].includes(selected.status)) : null,
            button(tr(selected.receipt ? 'ImageRelease' : 'ImageRemoveLocal'), () => { void changeDraftImage(selected.id, 'release') }, !!imageBusy || ['upload-unknown', 'bind-unknown', 'release-unknown'].includes(selected.status))),
          h('p', { className: 'saw-meta' }, tr('ImageReleaseHint')), h('details', null, h('summary', null, tr('TechnicalDetails')), h('code', { className: 'saw-fingerprint' }, `${selected.id} · ${selected.digest}`))),
        imageViewer ? h('dialog', { className: 'saw-confirm saw-image-viewer', ref: imageViewerRef, 'aria-label': tr('ImageEnlarge'), onKeyDown: (event: any) => { if (event.key === 'Escape') event.stopPropagation() }, onCancel: (event: any) => { event.preventDefault(); closeImageViewer() } }, button(tr('ImageClosePreview'), closeImageViewer), h('img', { src: imageViewer.src, alt: tr('ImagePreview'), style: { maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' } }), h('p', { className: 'saw-meta' }, tr('ImagePreviewOnly'))) : null)
    }
    const imageLocateEntry = () => h('div', { className: 'saw-row' }, button(tr('ImageDraftTitle'), () => openSystem('images')), currentSessionAction() ? h(React.Fragment, null, button(tr('ImageChooseTarget'), chooseImageTarget), button(tr('GoTargetQuestions'), () => openSystem('decisions'))) : null)
    const scopeSettingsEntry = () => h('section', { className: 'saw-box' }, h('h3', null, tr('ScopeManagement')), h('p', { className: 'saw-meta' }, tr('ScopeEntryHint')), button(tr('ScopeManagement'), () => openSystem('scope'), false, { className: 'saw-btn saw-action-primary' }))
    const overviewView = () => {
      const next = desk.actions[0], groups = groupSessionWork(array(sessionWork?.items).filter(row => row.excluded !== true))
      return h('section', { className: 'saw-view-scroll saw-overview', 'aria-label': tr('GoOverview') },
        h('header', { className: 'saw-page-heading' }, h('div', null, h('p', { className: 'saw-eyebrow' }, 'GO WORKSPACE'), h('h1', null, tr('GoOverview')), h('p', { className: 'saw-meta' }, tr('GoOverviewIntro')))),
        h('div', { className: 'saw-overview-grid' }, h('section', { className: 'saw-next-action' }, h('h2', null, tr('GoNextDecision')), next ? decisionView(next) : h('p', null, tr(desk.ready && !error ? 'GoNoKnownDecision' : 'WorkDecisionsUnknown')), button(tr('YourDecisions'), () => navigatePrimary('decisions-home'))), h('section', { className: 'saw-brief-card' }, h('h2', null, tr('DeskTitle')), h('p', null, tr('GoConversationIntro')), button(tr('DeskTitle'), () => navigatePrimary('chat'), false, { className: 'saw-btn saw-action-primary' }))),
        h('section', { className: 'saw-project-preview' }, h('div', { className: 'saw-group-head' }, h('h2', null, tr('GoProjects')), button(tr('GoAllProjects'), () => navigatePrimary('projects'))),
          h('p', { className: 'saw-meta' }, tr('ProjectPreviewHint')), sessionCoverage !== 'ready' ? h('p', { className: 'saw-source-state', role: 'status' }, tr(sessionCoverage === 'partial' ? 'WorkPartialShort' : 'WorkUnavailableShort')) : null,
          h('div', { className: 'saw-project-preview-grid' }, ...groups.map(group => h('button', { type: 'button', className: 'saw-project-card', key: group.key, disabled: group.kind === 'unknown', onClick: () => navigateProject({ projectKey: group.key, tab: 'work' }) }, h('strong', null, group.name), h('span', { className: 'saw-meta' }, `${tr('ProjectLoadedSessions')}: ${group.items.length}`)))), !groups.length ? h('p', { className: 'saw-meta' }, tr('GoNoProjectPreview')) : null),
        h('div', { className: 'saw-row' }, button(tr('GoOpenWorkList'), showAllTasks), h('small', { className: 'saw-meta' }, tr('GoRegisteredWorkHint'))))
    }
    const inspectSessionQuestions = async (row: any, revision: string) => {
      if (inboxBusy.current || !epochRef.current || row.excluded !== false || row.project?.kind === 'unknown' || !scopeProjectKey(row.project) || !['structured', 'missing'].includes(row.evidence) || !routeId(row.sessionId) || !/^[a-f0-9]{64}$/.test(row.factRevision) || !/^[a-f0-9]{64}$/.test(revision)) return
      const epoch = epochRef.current, route = viewRouteHash(viewRouteRef.current), generation = sessionWorkGeneration.current, navigation = navigationGeneration.current; inboxBusy.current = true; setSystemError('')
      try {
        const result = await call('session-locate', { epoch, text: row.sessionId, sessionId: row.sessionId, revision })
        if (!alive.current || epochRef.current !== epoch || sessionWorkGeneration.current !== generation || navigationGeneration.current !== navigation || viewRouteHash(viewRouteRef.current) !== route || !['decisions-home', 'projects'].includes(viewRouteRef.current.view)) return
        if (result?.status !== 'located' || result.revision !== revision || result.target?.factRevision !== row.factRevision || result.target?.sessionId !== row.sessionId || result.target?.project?.kind !== row.project.kind || result.target?.project?.key !== row.project.key || result.coverage !== 'complete' || result.controlAvailable !== false || result.executionReason !== 'SA_EXECUTION_BOUNDARY_UNVERIFIED') throw new Error('target_changed')
        openSystem('decisions'); decisionLocationEpoch.current = epoch; setDecisionLocation(structuredClone(result))
      } catch { if (alive.current && epochRef.current === epoch && sessionWorkGeneration.current === generation && navigationGeneration.current === navigation && viewRouteHash(viewRouteRef.current) === route) { setSystemError(tr('LocateChanged')); setNotice(tr('LocateChanged')) } }
      finally { inboxBusy.current = false }
    }
    const inboxView = () => {
      const approvals = array(systemData['decisions-home']?.items), page = sessionWorkPages.included
      const choices = [...pendingPlans.map(plan => ({ id: `plan:${plan.planId}`, kind: 'plan', data: plan, title: plan.brief?.goal || tr('Untitled') })), ...approvals.map(data => ({ id: `approval:${data.id}`, kind: 'approval', data, title: data.summary || tr('Approval') })), ...array(page?.items).filter(row => !row.excluded && row.decision && row.project?.kind !== 'unknown').map(data => ({ id: `session:${data.sessionId}`, kind: 'session', data, title: data.decision }))]
      const selected = choices.find(row => row.id === inboxSelection)
      return h('section', { className: 'saw-inbox-layout', 'data-selected': !!selected }, h('div', { className: 'saw-inbox-list' }, h('h3', null, tr('YourDecisions')), h('p', { className: 'saw-meta' }, tr('GoDecisionCoverage')), h('p', { className: 'saw-meta' }, tr('GoApprovalCoverageMissing')), sessionWorkError ? h('p', { className: 'saw-error', role: 'alert' }, sessionWorkError) : null, button(tr('Refresh'), () => { void readSystem(); void readSessionWork('included') }, !!sessionWorkBusy),
        ...choices.map(row => h('button', { type: 'button', className: 'saw-inbox-item', key: row.id, onClick: () => setInboxSelection(row.id), 'aria-pressed': inboxSelection === row.id }, h('small', null, tr(row.kind === 'plan' ? 'PlanNeedsReview' : row.kind === 'approval' ? 'OperationNeedsReview' : 'QuestionForYou')), h('strong', null, displayTitle(row.title)))), !choices.length ? h('p', null, tr('GoNoKnownDecision')) : null,
        systemData['decisions-home']?.next ? button(tr('MoreApprovals'), () => { void readSystem(true) }, systemBusy.current) : null,
        page?.hasMore ? button(tr('SessionWorkLoadMore'), () => { void readSessionWork('included', true) }, !!sessionWorkBusy) : null,
        button(tr('GoBusinessQuestions'), () => openSystem('decisions')), button(tr('LocateTitle'), () => openSystem('locate'))),
        h('section', { className: 'saw-decision-detail' }, selected ? h(React.Fragment, null, button(tr('GoBackToDecisions'), () => setInboxSelection('')), selected.kind === 'plan' ? admissionView(selected.data) : selected.kind === 'approval' ? approvalView(selected.data) : h(React.Fragment, null, h('h3', null, selected.data.decision), h('p', { className: 'saw-meta' }, `${tr('Project')}: ${scopeProjectName(selected.data.project)} · ${tr('SessionWorkFrom')}: ${sessionSourceTitle(selected.data)}`), h('p', null, selected.data.objective || tr('SessionWorkNoSummary')), button(tr('GoReadExactQuestions'), () => { void inspectSessionQuestions(selected.data, page.revision) }, inboxBusy.current))) : h('p', { className: 'saw-empty' }, tr('GoChooseDecision'))))
    }
    const systemContent = () => {
      if (system === 'scope') return scopeManagementView()
      if (system === 'locate' || system === 'images') return null // These contexts live inside the persistent conversation, not a second page.
      if (system === 'decisions-home') return inboxView()
      if (['stage-models', 'decisions'].includes(system)) return null
      const data = systemData[system] || (system === 'settings' ? {} : null)
      if (!data) return h('p', null, tr('Loading'))
      if (system === 'todo') return h(React.Fragment, null, h('h3', null, tr('Admission')), ...pendingPlans.map(plan => admissionView(plan)), !pendingPlans.length ? h('p', null, tr('NoPlans')) : null, h('h3', null, tr('InformationNeeded')), h('p', { className: 'saw-meta' }, tr('QuestionsOnBoard')), button(tr('AllTasks'), showAllTasks), h('h3', null, tr('Approvals')), h('p', { className: 'saw-meta' }, tr('ApprovalWindow')), ...array(data.items).map(approvalView), !array(data.items).length ? h('p', null, tr('NoApprovals')) : null, data.next ? button(tr('MoreApprovals'), () => { void readSystem(true) }, systemBusy.current) : null)
      if (system === 'settings') return h('section', { className: 'saw-settings-home' }, scopeSettingsEntry(), h('section', { className: 'saw-box' }, h('h3', null, tr('GoStageModels')), h('p', { className: 'saw-meta' }, tr('GoStageModelsHint')), button(tr('GoStageModels'), () => openSystem('stage-models'))), h('details', null, h('summary', null, tr('TechnicalDetails')), button(tr('Runtime'), () => openSystem('settings-runtime')), button(tr('Health'), () => openSystem('health'))))
      if (system === 'settings-runtime') {
        const groups: Record<string, any[]> = {}
        const groupFor = (key: string) => /stateDir|dbPath|lockPath|workRoot/.test(key) ? 'storage' : /watchdog|stall|repeat|waitingHuman/.test(key) ? 'supervision' : /approval|confirm/.test(key) ? 'approvals' : /^max|queueLimit/.test(key) ? 'budgets' : /roleTools|routerReadScope|sources|acceptMode|bots/.test(key) ? 'permissions' : 'runtime'
        for (const entry of array(data.effective)) (groups[groupFor(String(entry.key))] ||= []).push(entry)
        const groupNames: Record<string, string> = { runtime: 'Runtime', budgets: 'Budgets', budget: 'Budgets', watchdog: 'Supervision', supervision: 'Supervision', approvals: 'Approvals', approval: 'Approvals', storage: 'Storage', policy: 'Permissions', permissions: 'Permissions', other: 'Other' }
        return h(React.Fragment, null, scopeSettingsEntry(), h('p', null, tr('Readonly')), ...Object.entries(groups).map(([group, entries]) => h('section', { key: group, className: 'saw-box' }, h('h3', null, tr(groupNames[group] || 'Other')), ...entries.map((entry: any) => h('div', { key: entry.key, className: 'saw-setting' }, h('h4', null, entry.key), valueView(entry.redacted || /^(stateDir|dbPath|lockPath|workRoot)$/.test(entry.key) ? '[REDACTED_PATH]' : entry.value), h('p', { className: 'saw-meta' }, `${tr('Origin')}: ${text(entry.origin)}${entry.originDetail ? ` · ${entry.originDetail}` : ''}`))))))
      }
      return h(React.Fragment, null, h('p', null, tr('Readonly')), ...[['Runtime', data.runtime], ['Database', data.db], ['Workers', data.workers], ['Supervision', data.watchdog], ['Outbox', data.outbox], ['RecentErrors', data.recentErrors]].map(([key, value]) => h('section', { key, className: 'saw-box' }, h('h3', null, tr(key)), valueView(value))))
    }
    const chatSubmode = ['locate', 'images'].includes(system)
    const pageTitle = tr(system ? ({ 'decisions-home': 'YourDecisions', decisions: 'GoBusinessQuestions', settings: 'Settings', scope: 'ScopeManagement', 'stage-models': 'GoStageModels', locate: 'LocateTitle', images: 'ImageDraftTitle' } as any)[system] || 'System' : viewRoute.view === 'ticket' ? 'TaskDetails' : ({ overview: 'GoOverview', projects: 'GoProjects', board: 'GoRegisteredWork', chat: 'DeskTitle' } as any)[mobileTab] || 'GoOverview')
    return h('section', { className: 'saw-frame' }, h('section', { className: 'saw', 'data-menu-open': menuOpen, 'aria-label': tr('Workspace') }, h('style', null, css),
      h('aside', { className: 'saw-sidebar', id: 'saw-navigation', 'aria-label': tr('WorkspaceView') }, h('div', { className: 'saw-brand' }, h('span', { className: 'saw-brand-symbol', 'aria-hidden': true }, 'G'), h('strong', { className: 'saw-nav-text' }, 'Go')), primaryNavigation(), h('div', { className: 'saw-nav-heading saw-nav-text' }, tr('GoProjectIndex')), h('div', { className: 'saw-project-index' }, ...groupSessionWork(array(sessionWork?.items).filter(row => !row.excluded && row.project?.kind !== 'unknown')).slice(0, 5).map(group => h('button', { type: 'button', className: 'saw-pinned-project', key: group.key, title: group.name, onClick: () => navigateProject({ projectKey: group.key, tab: 'work' }) }, h('i', { 'aria-hidden': true }), h('span', { className: 'saw-nav-text' }, group.name)))), h('div', { className: 'saw-sidebar-bottom' }, button(tr('Health'), () => openSystem('health')), h('p', { className: 'saw-sidebar-note saw-nav-text' }, tr('GoShellBoundary')))),
      menuOpen ? h('button', { type: 'button', className: 'saw-menu-backdrop', 'aria-label': tr('GoCloseNavigation'), onClick: () => setMenuOpen(false) }) : null,
      h('main', { className: 'saw-main' }, h('header', { className: 'saw-top' }, button('☰', () => setMenuOpen(!menuOpen), false, { className: 'saw-btn saw-menu-toggle', 'aria-label': tr('GoOpenNavigation'), 'aria-expanded': menuOpen, 'aria-controls': 'saw-navigation' }), h('nav', { className: 'saw-breadcrumbs', 'aria-label': tr('ScopeBreadcrumb') }, button(tr('GoOverview'), () => navigatePrimary('overview')), h('span', { 'aria-hidden': true }, '›'), h('strong', { ref: mainHeadingRef, tabIndex: -1, 'aria-current': 'page' }, pageTitle)),
        h('div', { className: 'saw-top-actions' }, h('span', { className: `saw-connection${error ? ' saw-connection-error' : ''}`, title: `${tr('LastSync')}: ${time(lastSync)}` }, h('i', { 'aria-hidden': true }), error ? tr('Disconnected') : workspace ? tr('Connected') : tr('Connecting')), button('↻', () => poke.current(), false, { 'aria-label': tr('Sync'), title: tr('Sync'), className: 'saw-btn saw-icon-btn' }), button(tr('DeskTitle'), () => navigatePrimary('chat'), false, { className: 'saw-btn saw-action-primary' }))),
      h('div', { className: 'saw-main-body' }, h('details', { className: 'saw-boundary' }, h('summary', null, h('span', { className: 'saw-safety-dot', 'aria-hidden': true }), tr(workspace?.capabilities?.workerExecution === false ? 'PlanningOnly' : 'ExecutionUnknown')), h('p', null, tr('BoundaryBody'))),
      workspace?.model?.available === false ? h('div', { className: 'saw-banner' }, tr('ModelUnavailable')) : null,
            error ? h('div', { className: 'saw-error saw-banner', role: 'alert' }, error, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => poke.current())) : null,
      storageError ? h('div', { className: 'saw-error saw-banner' }, tr('StorageUnavailable')) : null,
      !system ? scopeMutationBanner() : null,
      h('div', { className: 'saw-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, notice),
      h('div', { hidden: !!system || mobileTab !== 'overview', className: 'saw-overview-host' }, overviewView()),
      h('div', { hidden: !!system || mobileTab !== 'projects', className: 'saw-projects-host' }, h(goProjects.Projects, { epoch: workspace?.epoch || '', active: !system && mobileTab === 'projects', scopeRevision: sessionWork?.revision, projectKey: viewRoute.projectKey, sessionId: viewRoute.sessionId, tab: viewRoute.tab, onNavigate: navigateProject, onInspectTarget: inspectSessionQuestions })),
      h('div', { className: 'saw-workspace', hidden: !!system && !chatSubmode || !['board', 'chat'].includes(mobileTab), 'data-mobile-tab': mobileTab, 'data-review-open': !!planReview || replyOpen },
        h('section', { className: 'saw-board-region', 'aria-label': tr('Board') },
          h('div', { className: 'saw-board-head', hidden: !!detailId }, h('h2', null, tr('GoRegisteredWork')),
            h('label', { className: 'saw-search' }, h('span', { className: 'saw-sr' }, tr('Search')), h('input', { type: 'search', value: query, maxLength: 200, placeholder: tr('Search'), onChange: (e: any) => changeFilter(e.target.value, outcome) })),
            h('label', null, h('span', { className: 'saw-sr' }, tr('OutcomeFilter')), h('select', { value: outcome, onChange: (e: any) => changeFilter(query, e.target.value), 'aria-label': tr('OutcomeFilter') }, h('option', { value: '' }, tr('AllOutcomes')), ...['completed', 'failed', 'stopped', 'dropped'].map(key => h('option', { value: key, key }, stateName(key))))),
            button(tr('NewTaskAction'), startTask, !!pendingRequest || !!composer.target || oldDraft, { className: 'saw-btn saw-action-primary' })),
          h('div', { className: 'saw-work-scroll', hidden: !!detailId },
          h('p', { className: 'saw-meta' }, tr('GoRegisteredWorkHint')),
          h('section', { className: 'saw-ledger' },
          h('div', { className: 'saw-ledger-head' }, h('h3', null, tr('Board')), h('details', { className: 'saw-scope-details' }, h('summary', { className: 'saw-coverage' }, tr(!boardScopeKnown ? 'CountsScopeUnknown' : board?.filtered ? 'FilteredCounts' : 'AllCounts')), h('p', null, tr(sessionCoverage === 'ready' ? 'SessionWorkCoverageReady' : sessionCoverage === 'partial' ? 'SessionWorkCoveragePartial' : 'SessionWorkCoverageUnavailable')), h('p', null, tr('SessionWorkReadonly')), h('p', null, `${tr('Snapshot')}: ${time(board?.snapshotAt)}`))),
          boardError ? h('div', { className: 'saw-error saw-banner' }, boardError, ' ', tr('StaleData')) : null,
          boardEmpty ? h('div', { className: 'saw-board-empty' }, h('span', { className: 'saw-empty-mark', 'aria-hidden': true }, '≡'), h('h4', null, tr(!boardScopeKnown ? 'WorkNoReturned' : query || outcome ? 'WorkNoMatch' : 'WorkNoTasks')), h('p', null, tr(!boardScopeKnown ? 'WorkScopePending' : query || outcome ? 'WorkFilterHint' : 'WorkStartHint')), query || outcome ? button(tr('ClearFilters'), showAllTasks) : button(tr('NewTaskAction'), startTask, !!pendingRequest || !!composer.target || oldDraft), h('div', { className: 'saw-flow-labels', 'aria-label': tr('Board') }, ...columns.map(column => h('span', { key: column }, stateName(column))))) :
          h('div', { className: 'saw-registry-list' }, ...columns.map(column => {
            const page = board?.columns?.[column]
            return h('section', { className: 'saw-column', key: column, 'aria-label': stateName(column) }, h('header', { className: 'saw-column-head' }, h('h3', null, stateName(column)), h('span', { className: 'saw-count', 'aria-label': tr(boardScopeKnown ? 'ServerTotal' : 'ServerTotalUnknownScope') }, page ? page.total : '—')),
              h('div', { className: 'saw-column-scroll' }, !page ? h('p', { className: 'saw-meta' }, tr('Loading')) : !array(page.items).length ? h('p', { className: 'saw-meta' }, tr(page.total === 0 ? !boardScopeKnown ? 'EmptyColumnUnknownScope' : board?.filtered ? 'EmptyFilteredColumn' : 'EmptyColumn' : 'NoLoadedTasks')) : null,
                ...array(page?.items).map((card: any) => h('article', { className: 'saw-card', key: card.id }, h('button', { type: 'button', className: 'saw-card-open', onClick: () => openDetail(card), 'aria-label': `${tr('OpenTask')}: ${card.title || tr('Untitled')}` }, h('span', { className: 'saw-badge' }, stopping[card.id] ? tr('Stopping') : stateName(card.state === 'ended' ? card.outcome : card.state)), h('span', { className: 'saw-card-title' }, displayTitle(card.title)), card.progress ? h('span', { className: 'saw-card-line' }, card.progress) : null,
                  card.pendingApprovals ? h('span', { className: 'saw-card-line' }, `${tr('Approvals')}: ${card.pendingApprovals}`) : null,
                  card.anomaly ? h('span', { className: 'saw-error saw-card-line' }, tr('StateConflict')) : null,
                  card.disabledReason ? h('span', { className: 'saw-meta saw-card-line' }, tr('ExecutionBlocked')) : null,
                  h('span', { className: 'saw-meta saw-card-line' }, `${tr('LastProgress')}: ${time(card.lastProgressAt)}`), typeof card.acceptance?.passed === 'number' ? h('span', { className: 'saw-meta saw-card-line' }, `${tr('Acceptance')}: ${card.acceptance.passed}/${text(card.acceptance.total)}`) : null),
                  card.attention ? h('p', { className: 'saw-attention' }, tr('InformationNeeded')) : null,
                  card.allowed?.input === true ? button(tr('Supplement'), () => supplement(card), !!pendingRequest) : null)),
                page?.hasMore ? button(paging === column ? tr('Loading') : tr('MoreTasks'), () => { void loadMoreBoard(column) }, !!paging) : null))
          })))),
          detailId ? h('section', { className: 'saw-work-detail', role: 'region', 'aria-labelledby': 'saw-detail-title', onKeyDown: (e: any) => { if (e.key === 'Escape' && !confirmation) { e.stopPropagation(); closeDetail() } } }, h('header', { className: 'saw-detail-head' }, h('h2', { id: 'saw-detail-title' }, item ? displayTitle(item.title) : tr('TaskDetails')), button('×', closeDetail, false, { ref: detailCloseRef, 'aria-label': tr('CloseDetails') })),
            detailError ? h('div', { className: 'saw-error saw-banner' }, detailError, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => { void readDetail(detailId) })) : null,
            !detail ? h('p', null, tr('Loading')) : h(React.Fragment, null,
              h('nav', { className: 'saw-detail-tabs', 'aria-label': tr('TaskSections') }, ...['overview', 'timeline', 'approvals', 'results'].map(tab => button(tr(({ overview: 'Overview', timeline: 'GoProgress', approvals: 'GoRelationsAndDecisions', results: 'Results' } as any)[tab]), () => chooseDetailTab(tab), false, { key: tab, 'aria-pressed': detailTab === tab }))),
              h('div', { className: 'saw-detail-scroll' },
                h('details', { className: 'saw-original-request', key: `${detailId}:request` }, h('summary', null, tr('OriginalTaskText')), h('p', { className: 'saw-pre' }, item.title || tr('Untitled'))),
                detailTab === 'overview' ? h(React.Fragment, null, fields([['State', stopping[item.id] ? tr('Stopping') : stateName(item.state === 'ended' ? item.outcome : item.state)], ['LastProgress', time(item.lastProgressAt)], ['Steps', text(item.budget?.steps)], ['Tokens', text(item.budget?.usage)]]), item.anomaly ? h('p', { className: 'saw-error' }, tr('StateConflict')) : null, item.attention ? valueView(item.attention) : null, briefView(detail.brief), item.originTicket ? fields([['RecreatedFrom', text(item.originTicket)]]) : null, h('details', null, h('summary', null, tr('TechnicalDetails')), fields([['TaskId', h('code', { className: 'saw-fingerprint' }, text(item.id))]]), button(tr('CopyId'), () => { if (navigator.clipboard) void navigator.clipboard.writeText(String(item.id)).then(() => setNotice(tr('Copied')), () => setNotice(tr('CopyFailed'))); else setNotice(tr('CopyFailed')) }))) : null,
                detailTab === 'timeline' ? h(React.Fragment, null, h('p', { className: 'saw-meta' }, tr('TaskTimelineHint')), h('ol', { className: 'saw-timeline' }, ...array(detail.timeline).map((event: any) => h('li', { key: event.id }, h('time', null, time(event.at)), h('strong', null, text(event.action)), h('small', null, text(event.actor))))), !array(detail.timeline).length ? h('p', null, tr('NoEvents')) : null, detail.timelineCursor ? button(tr('OlderEvents'), () => { void readDetail(detailId, true) }, detailBusy.current) : null) : null,
                detailTab === 'approvals' ? h(React.Fragment, null, ...array(detail.approvals).map(approvalView), !array(detail.approvals).length ? h('p', null, tr('NoApprovals')) : null, detail.approvalsNext ? button(tr('MoreApprovals'), () => { detailApprovalsLoaded.current[detailId] = array(detail.approvals).length + 30; void readDetail(detailId) }, detailBusy.current) : null) : null,
                detailTab === 'results' ? resultView() : null),
              h('footer', { className: 'saw-detail-actions' }, item.state === 'ended' && item.stoppedByHuman === true ? button(tr('RecreateTask'), () => recreate(item), !!pendingRequest || !!composer.draft.trim()) : null, item.allowed?.input === true ? button(tr('Supplement'), () => supplement(item), !!pendingRequest) : null, item.allowed?.stop === true ? button(stopping[item.id] ? tr('Stopping') : tr('StopTask'), () => askConfirm('stop', item, 'stop'), !!stopping[item.id]) : null))) : null),
        h('section', { className: 'saw-chat', 'aria-label': tr('DeskTitle') }, h('div', { className: 'saw-section-head' }, h('h2', null, tr(activityView === 'history' ? 'DialogueHistory' : 'DeskTitle')), h('div', { className: 'saw-head-actions' }, button(`${tr(activityView === 'history' ? 'BackToDesk' : 'HistoryShort')}${newReplies ? ' •' : ''}`, () => chooseActivity(activityView === 'history' ? 'briefing' : 'history'), false, { className: 'saw-btn saw-text-btn', ref: historyButtonRef }), button(tr('LocateTitle'), () => openSystem('locate'), !!planReview || replyOpen, { className: 'saw-btn saw-text-btn' }), button(tr('ImageDraftTitle'), () => openSystem('images'), !!planReview || replyOpen, { className: 'saw-btn saw-text-btn' }))),
          h('div', { className: 'saw-chat-inner' },
            activityView === 'history' && array(workspace?.archiveEpochs).length ? h('label', { className: 'saw-history-selector' }, tr('HistoryGroup'), h('select', { value: historyEpoch, disabled: !!planReview || replyOpen, onChange: (e: any) => { const epoch = e.target.value; historyRef.current = epoch; setHistoryEpoch(epoch); autoScroll.current = true; setHistoryError(''); void readConversation(epoch) } }, h('option', { value: workspace.epoch }, tr('CurrentConversation')), ...array(workspace.archiveEpochs).map((row: any, index: number) => h('option', { value: row.epoch, key: row.epoch }, `${tr('ArchivedConversation')} ${index + 1} · ${time(row.createdAt)}`)))) : null,
          archive ? h('p', { className: 'saw-banner' }, tr('ArchiveReadonly')) : null,
          historyError ? h('p', { className: 'saw-error' }, historyError, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => { void readConversation(historyEpoch) })) : null,
          h('div', { className: 'saw-messages', inert: planReview || replyOpen ? true : undefined, ref: messagesRef, onScroll: (e: any) => { const node = e.currentTarget; autoScroll.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80 }, 'aria-label': tr(activityView === 'briefing' ? 'DeskTitle' : 'ConversationHistory') },
            chatSubmode ? h('section', { className: 'saw-chat-context' }, button(tr('GoBackToConversation'), () => navigatePrimary('chat')), system === 'locate' ? locateView(sessionActionView, imageLocateEntry) : imageDraftView(), system === 'locate' ? deliveryConfirmationView() : null) : null,
            activityView === 'briefing' ? briefingView() : h(React.Fragment, null,
            latestAssistant ? button(tr('ReadLatestReply'), openReply, false, { className: 'saw-btn saw-text-btn' }) : null,
            h('details', { className: 'saw-history-info' }, h('summary', null, tr('HistoryInfo')), h('p', { className: 'saw-meta' }, tr('HistoryRecordHint'))),
            currentMessages?.hasMore && currentMessages.nextBefore ? button(tr('OlderMessages'), () => { const node = messagesRef.current; if (node) historyAnchor.current = { epoch: historyEpoch, top: node.scrollTop, height: node.scrollHeight }; void readConversation(historyEpoch, currentMessages.nextBefore) }, historyBusy.current) : null,
            !currentMessages ? h('p', { className: 'saw-meta' }, historyError ? tr('HistoryUnavailable') : tr('Connecting')) : !array(currentMessages.items).length ? h('div', { className: 'saw-empty' }, h('h3', null, tr('StartHere')), h('p', null, tr('StartHint'))) : null,
            ...array(currentMessages?.items).map((message: any) => h('article', { className: `saw-message saw-message-${message.kind}`, key: message.id }, h('div', { className: 'saw-message-head' }, h('strong', null, stateName(message.kind)), h('time', null, time(message.at))), h('p', { className: 'saw-pre' }, message.text), message.stage ? h('details', { className: 'saw-message-technical' }, h('summary', null, tr('TechnicalDetails')), h('small', { className: 'saw-meta' }, `${tr('DeliveryStage')}: ${stateName(message.stage)}`)) : null)),
            !archive && pendingPlans.length ? h('section', { className: 'saw-plan-references' }, h('h3', null, tr('GoPlansForReview')), ...pendingPlans.map(plan => button(displayTitle(plan.brief?.goal || tr('Untitled')), () => openPlan(plan), false, { key: plan.planId }))) : null)),
          planReview ? h('section', { className: 'saw-inspector', role: 'dialog', 'aria-modal': false, 'aria-label': tr('ReviewPlan'), onKeyDown: (e: any) => { if (e.key === 'Escape' && !confirmation) { e.stopPropagation(); setPlanReview('') } } }, h('header', { className: 'saw-detail-head' }, h('h3', null, tr('ReviewPlan')), button('×', () => setPlanReview(''), false, { ref: planFocus, 'aria-label': tr('CloseDetails') })), h('div', { className: 'saw-inspector-scroll' }, reviewingPlan ? admissionView(reviewingPlan) : h('p', null, tr('PlanChanged')))) : null,
          replyOpen && latestAssistant ? h('section', { className: 'saw-inspector', role: 'dialog', 'aria-modal': false, 'aria-label': tr('CoordinatorReplied'), onKeyDown: (e: any) => { if (e.key === 'Escape') { e.stopPropagation(); setReplyOpen(false) } } }, h('header', { className: 'saw-detail-head' }, h('h3', null, tr('CoordinatorReplied')), button('×', () => setReplyOpen(false), false, { ref: replyFocus, 'aria-label': tr('CloseDetails') })), h('div', { className: 'saw-inspector-scroll' }, h('p', { className: 'saw-pre' }, latestAssistant.text), h('small', { className: 'saw-meta' }, time(latestAssistant.at))), h('footer', { className: 'saw-detail-actions' }, button(tr('Reply'), () => { inspectorReturnToInput.current = true; setReplyOpen(false); replyToCoordinator() }, !!pendingRequest || !!composer.target || !!composer.draft.trim() || oldDraft, { title: tr('ReplyKeepsDraft') }))) : null,
          h('form', { className: 'saw-composer', onPaste: pasteDraftImages, inert: planReview || replyOpen ? true : undefined, onSubmit: (e: any) => { e.preventDefault(); void submit() } },
             workspace && workspace.capabilities?.send !== true ? h('p', { className: 'saw-meta', role: 'status' }, tr('SendUnavailable')) : null,
            array(workspace?.archiveEpochs).length ? h('label', { className: 'saw-history-selector' }, tr('DraftGroup'), h('select', { value: draftEpoch, disabled: sending, onChange: (e: any) => chooseDraftEpoch(e.target.value) }, h('option', { value: workspace.epoch }, tr('CurrentDraft')), ...array(workspace.archiveEpochs).map((row: any, index: number) => h('option', { value: row.epoch, key: row.epoch }, `${tr('ArchivedDraft')} ${index + 1}`)))) : null,
            oldDraft ? h('p', { className: 'saw-banner' }, tr('OldDraftHint')) : null,
            h('div', { className: 'saw-row saw-compose-attachments' }, h('label', { className: 'saw-btn' }, tr('ImagePick'), h('input', { type: 'file', className: 'saw-sr', accept: 'image/png', multiple: true, disabled: sending || !!pendingRequest || archive || oldDraft || !!imageBusy, onChange: (event: any) => { const files = Array.from(event.target.files || []); event.target.value = ''; void addDraftImages(files) } })), ...array(imageDrafts[epochRef.current]?.items).map((row, index) => h('button', { type: 'button', className: 'saw-attachment', key: row.id, onClick: () => { selectDraftImage(row.id); openSystem('images') }, 'aria-label': `${tr('ImageDetails')} ${index + 1}` }, row.src ? h('img', { src: row.src, alt: `${tr('ImagePreview')} ${index + 1}`, style: { width: '48px', height: '48px', objectFit: 'contain' } }) : h('span', null, `${tr('ImageDetails')} ${index + 1}`), h('small', null, row.status)))),
            array(imageDrafts[epochRef.current]?.items).length ? h('p', { className: 'saw-error', role: 'status' }, tr('GoImageSendBlocked')) : null,
            imageError ? h('p', { className: 'saw-error', role: 'alert' }, imageError) : null,
            composer.target ? h('div', { className: 'saw-chip' }, `${tr('SupplementTo')}: ${composer.target.title}`, button('×', () => updateComposer({ target: null }), sending || !!pendingRequest, { 'aria-label': tr('CancelTarget') })) : h('div', { className: 'saw-compose-modes', role: 'group', 'aria-label': tr('MessageIntent') }, button(tr('PlanMode'), () => updateComposer({ intent: 'new-task', origin: null }), sending || !!pendingRequest || archive || oldDraft, { 'aria-pressed': composer.intent === 'new-task' }), button(tr('AskMode'), () => updateComposer({ intent: 'message', origin: null }), sending || !!pendingRequest || archive || oldDraft, { 'aria-pressed': composer.intent === 'message' })),
            composer.origin ? h('div', { className: 'saw-chip' }, `${tr('RecreatedFrom')}: ${composer.origin.title}`, button('×', () => updateComposer({ origin: null }), sending || !!pendingRequest, { 'aria-label': tr('CancelOrigin') })) : null,
            h('label', { className: 'saw-sr', htmlFor: 'saw-draft' }, tr('InputLabel')), h('textarea', { id: 'saw-draft', ref: inputRef, value: composer.draft, placeholder: tr(composer.target ? 'InputForTask' : composer.intent === 'new-task' ? 'InputForPlan' : 'InputForQuestion'), rows: 2, disabled: sending || !!pendingRequest || archive || oldDraft || !workspace, onChange: (e: any) => updateComposer({ draft: e.target.value }), onKeyDown: (e: any) => { if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing || e.isComposing || e.nativeEvent?.keyCode === 229 || e.keyCode === 229) return; e.preventDefault(); void submit() }, 'aria-describedby': 'saw-input-help' }),
            h('div', { className: 'saw-compose-footer' }, h('small', { id: 'saw-input-help', className: 'saw-meta' }, tr('KeyboardHint')),
            pendingRequest ? h('div', { className: 'saw-request' }, h('p', null, tr('PendingRequest')), h('details', null, h('summary', null, tr('RequestDetails')), h('code', { className: 'saw-fingerprint' }, pendingRequest.requestId)), h('div', { className: 'saw-row' }, button(tr('CheckStatus'), () => { void submit(true) }, sending), button(tr('RetrySameRequest'), () => { void submit(false) }, sending || pendingRequest.epoch !== workspace?.epoch || archive), latest?.stage === 'unknown' && latest.accepted === false && Number.isSafeInteger(latest.seq) ? button(tr('CancelUnknownRequest'), () => askConfirm('request', { payload: pendingRequest, seq: latest.seq }, 'cancel'), sending || pendingRequest.epoch !== workspace?.epoch || archive) : null)) : h('button', { type: 'submit', className: 'saw-btn saw-send', disabled: sending || archive || oldDraft || !composer.draft.trim() || !!imageBusy || array(imageDrafts[epochRef.current]?.items).length > 0 || workspace?.capabilities?.send !== true }, sending ? tr('Sending') : tr(composer.target ? 'SendInput' : composer.intent === 'new-task' ? 'GeneratePlan' : 'Send'))),
            latest ? h('details', { className: 'saw-receipt' }, h('summary', null, tr('RequestDetails')), h('p', { className: 'saw-meta' }, `${latest.accepted === true ? tr('Accepted') : tr('Unknown')}: ${stateName(latest.stage)}${latest.code ? ` · ${latest.code}` : ''}`)) : null,
            notice ? h('p', { className: 'saw-meta' }, notice) : null)))),
      (system || Object.keys(goPanels).length) ? h('section', { className: 'saw-system saw-primary-panel', hidden: !system || chatSubmode, role: 'region', 'aria-labelledby': 'saw-primary-title', onKeyDown: (e: any) => { if (e.key === 'Escape' && !confirmation) { e.stopPropagation(); backSystem() } } }, h('header', { className: 'saw-detail-head' }, h('h2', { id: 'saw-primary-title' }, tr(system === 'todo' ? 'Todo' : system === 'settings' ? 'Settings' : system === 'decisions-home' ? 'YourDecisions' : system === 'scope' ? 'ScopeManagement' : system === 'locate' ? 'LocateTitle' : system === 'images' ? 'ImageDraftTitle' : system === 'stage-models' ? 'GoStageModels' : system === 'decisions' ? 'GoBusinessQuestions' : 'System')), button(tr('BackToDesk'), backSystem, false, { ref: systemCloseRef, 'aria-label': tr('CloseSystem') })), scopeMutationBanner(), systemError ? h('div', { className: 'saw-error saw-banner' }, systemError, ' ', tr('StaleData'), ' ', button(tr('Retry'), () => { void readSystem() })) : null, h('div', { className: 'saw-system-scroll' }, systemContent(),
        goPanels['stage-models'] ? h('div', { hidden: system !== 'stage-models' }, h(goSettings.StageModels, { epoch: workspace?.epoch || '', active: system === 'stage-models' })) : null,
        goPanels.decisions ? h('div', { hidden: system !== 'decisions' }, h(goDecisions.Decisions, { epoch: workspace?.epoch || '', active: system === 'decisions', located: decisionLocationEpoch.current === workspace?.epoch ? decisionLocation : null })) : null)) : null),
      h('footer', { className: 'saw-page-footer' }, h('span', null, tr('GoShellBoundary')), h('span', null, `${tr('LastSync')}: ${time(lastSync)}`))),
      confirmation ? h('dialog', { ref: dialogRef, className: 'saw-confirm', 'aria-labelledby': 'saw-confirm-title', onCancel: (e: any) => { e.preventDefault(); closeConfirm() } }, h('h2', { id: 'saw-confirm-title' }, tr('ConfirmAction')), h('p', null, tr(confirmation.kind === 'request' ? 'CancelUnknownRequest' : confirmation.kind === 'revision' ? 'RevisePlan' : confirmation.kind === 'stop' ? 'StopConfirm' : confirmation.decision === 'approve' ? 'ApproveConfirm' : 'RejectConfirm')), h('div', { className: 'saw-confirm-body' }, confirmation.kind === 'request' ? h('p', null, tr('CancelUnknownHint')) : confirmation.kind === 'revision' ? h(React.Fragment, null, h('p', null, tr('RevisionHint')), h('label', null, tr('Goal'), h('textarea', { value: revisionGoal, required: true, maxLength: 8000, onChange: (e: any) => setRevisionGoal(e.target.value) })), h('label', null, tr('FirstAction'), h('textarea', { value: revisionFirstAction, required: true, maxLength: 4000, onChange: (e: any) => setRevisionFirstAction(e.target.value) }))) : confirmation.kind === 'admission' ? admissionView(confirmation.item, true) : confirmation.kind === 'approval' ? h(React.Fragment, null, h('h3', null, confirmation.item.summary || tr('Approval')), fields([['Kind', text(confirmation.item.kind)], ['Fingerprint', h('code', { className: 'saw-fingerprint' }, text(confirmation.item.fingerprint))], ['Expiry', time(confirmation.item.expiresAt)]]), valueView(confirmation.item.impact?.details)) : h('p', null, confirmation.item.title)), !['admission', 'revision', 'request'].includes(confirmation.kind) ? h('label', { className: 'saw-reason' }, tr('ReasonRequired'), h('textarea', { rows: 3, value: reason, required: true, maxLength: 2000, onChange: (e: any) => setReason(e.target.value), 'aria-required': true })) : null, actionError ? h('p', { className: 'saw-error', role: 'alert' }, actionError) : null, h('div', { className: 'saw-row' }, button(tr('Cancel'), closeConfirm, acting), button(acting ? tr('Saving') : tr('Confirm'), () => { void perform() }, acting || (confirmation.kind === 'revision' ? !revisionGoal.trim() || !revisionFirstAction.trim() : !['admission', 'request'].includes(confirmation.kind) && !reason.trim())))) : null))
  }
}
