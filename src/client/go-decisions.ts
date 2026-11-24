/** Serialized client factory: every runtime helper is local, no Host/client package imports. */
export function createGoDecisions(React: any, request: (path: string, body?: any, signal?: any) => Promise<any>, t: any) {
  const h = React.createElement
  const array = (value: any): any[] => Array.isArray(value) ? value : []
  const hashValid = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
  const idValid = (value: any) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(value) && !value.includes('://')
  const plain = (value: any) => value && typeof value === 'object' && !Array.isArray(value)
  const labels: Record<string, string> = {
    Close: '封存未确认的原记录ID（不停止会话）', CloseConfirm: '再次确认：仅封存原ID，不投递答案', CloseBoundary: '仅当原ID尚无记录时封存；不停止、撤销或批准任何操作。保留原题、答案与回执证据，不换ID、不重新核对。', CloseUnknown: '封存回执未确认；保留原ID与封存请求，只能手动查询原操作状态，不视为已封存。', Closed: '原记录ID已持久封存，未投递；不代表停止、撤销或批准',
    Title: '业务问题', Boundary: '业务回答不是操作批准。仅核对并记录答案，不发送；生产执行安全闸仍关闭。', Locate: '请先明确定位一个当前受管会话，才能读取它的原问题。', Read: '读取当前目标问题', Loading: '正在核对…', Failed: '未确认结果，请手动查询原操作状态；不会自动重试或重新投递。', Changed: '目标或题目版本已变化，请重新读取；旧草稿仅保留为证据，不用于当前问题。', Empty: '当前投影没有活动问题；不能据此断言所有类型的问题均已覆盖。', Partial: '问题投影不完整，不能核对答案。', Cold: '会话不是完整 live 投影；这里只显示原题，不能核对答案。', Open: '此问题尚在原 waterfall 中，必须回原会话处理，不能在此代答。', Blocked: '生产回答能力未验证，答案核对只会保留真实阻断回执。', Calls: '问题组', Details: '查看原问题与答案草稿', Back: '返回问题列表', Original: '不可信原问题', Suggested: '建议选项（不是批准）', Custom: '自行说明 / 另一种方案', Conditions: '补充条件', CancelConditions: '取消补充（保留草稿、不提交隐藏内容）', Skip: '明确跳过此题（不代表同意）', Choose: '请为每题选择建议、自行说明或明确跳过。', Check: '核对答案（不发送）', Status: '查询原操作状态（不重投）', Unknown: '回执未确认；原请求与答案保留，只能查询同一 action，不能换ID或重投。', OldEpoch: '这是旧 epoch 的未决操作，此处不能恢复或查询；请人工核实原会话。', History: '原操作与只读证据', Receipt: '原始精确回执', Pending: '等待精确回执', Recorded: '已持久记录，尚未投递', Rejected: '生产闸已阻止投递', Accepted: '目标持久受理已确认，不代表完成、已读或批准', DispatchUnknown: '投递结果未知，仅允许对账', NewDraft: '显式新建空白答案草稿（保留原回执）', NoCopy: '新草稿不继承旧答案或旧批准；必须重新选择并核对。', Unresolved: '仍有原操作结果未定，不能新建或核对另一答案。', Limit: '答案文本超出字节限制或含空字符，未发送请求。', Target: '精确处理目标', Snapshot: '问题快照', Version: '版本', NotFound: '未找到原回执，不证明没有记录或投递；保留原ID，不自动重发。', Invalid: 'Host响应不完整或相互矛盾，未作为成功回执。', Selections: '已选择的原建议', Answer: '原始答案', Skipped: '明确跳过', NoSummary: '没有原始答案', Cancel: '返回',
  }
  const tr = (key: string) => { const id = `wGoDecision${key}`, value = typeof t === 'function' ? t(id) : id; return typeof value === 'string' && value !== id ? value : labels[key] || key }
  const button = (title: string, onClick: () => void, disabled = false, extra: any = {}) => h('button', { type: 'button', className: 'saw-btn', onClick, disabled, ...extra }, title)
  const bytes = (text: string) => new TextEncoder().encode(text).length
  const digestValue = async (value: any) => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(value => value.toString(16).padStart(2, '0')).join('')
  const mint = () => { if (!globalThis.crypto?.randomUUID) throw new Error('secure_uuid_unavailable'); return globalThis.crypto.randomUUID() }
  const bindingKey = (epoch: string, target: any) => JSON.stringify([epoch, target.sessionId, target.scopeRevision, target.factRevision, target.project.kind, target.project.key])
  const locatedBinding = (epoch: any, located: any) => {
    const target = located?.target, project = target?.project
    if (!idValid(epoch) || located?.status !== 'located' || located.coverage !== 'complete' || located.controlAvailable !== false || located.executionReason !== 'SA_EXECUTION_BOUNDARY_UNVERIFIED' || !idValid(target?.sessionId) || !hashValid(located.revision) || !hashValid(target.factRevision) || !['project', 'unassigned'].includes(project?.kind) || !idValid(project.key) || project.kind === 'unassigned' && project.key !== 'unassigned' || !array(located.candidates).some(row => row.sessionId === target.sessionId && row.factRevision === target.factRevision && row.project?.kind === project.kind && row.project?.key === project.key)) return null
    const binding = { sessionId: target.sessionId, scopeRevision: located.revision, factRevision: target.factRevision, project: { kind: project.kind, key: project.key } }
    return { epoch, target: binding, key: bindingKey(epoch, binding), title: typeof target.title === 'string' ? target.title : '未命名会话' }
  }
  const sameTarget = (left: any, right: any) => left && right && ['sessionId', 'scopeRevision', 'factRevision'].every(key => left[key] === right[key]) && left.project?.kind === right.project?.kind && left.project?.key === right.project?.key
  const validQuestion = (question: any) => plain(question) && typeof question.id === 'string' && question.id.length <= 512 && !!question.id.trim() && !question.id.includes('\0') && typeof question.question === 'string' && !!question.question.trim() && !question.question.includes('\0') && bytes(question.question) <= 16384 && (question.detail === undefined || typeof question.detail === 'string' && bytes(question.detail) <= 16384) && (question.header === undefined || typeof question.header === 'string' && bytes(question.header) <= 512) && (question.multiSelect === undefined || typeof question.multiSelect === 'boolean') && (question.options === undefined || Array.isArray(question.options) && question.options.length <= 64 && new Set(question.options.map((option: any) => option?.label)).size === question.options.length && question.options.every((option: any) => plain(option) && typeof option.label === 'string' && !!option.label.trim() && !option.label.includes('\0') && bytes(option.label) <= 2048 && (option.description === undefined || typeof option.description === 'string' && bytes(option.description) <= 16384)))
  const validList = (list: any, current: any) => plain(list) && sameTarget(list.target, current.target) && ['live', 'cold', 'unavailable'].includes(list.availability) && typeof list.complete === 'boolean' && Number.isSafeInteger(list.asOfSeq) && list.asOfSeq >= -1 && hashValid(list.snapshotRevision) && list.canAnswer === false && list.approval === false && list.code === 'session_decision_execution_unverified' && Array.isArray(list.calls) && list.calls.length <= 64 && new Set(list.calls.map((call: any) => call?.callId)).size === list.calls.length && list.calls.reduce((n: number, call: any) => n + array(call?.questions).length, 0) <= 64 && list.calls.every((call: any) => plain(call) && idValid(call.callId) && ['open', 'continued'].includes(call.state) && call.canAnswer === false && Array.isArray(call.questions) && call.questions.length > 0 && new Set(call.questions.map((q: any) => q?.id)).size === call.questions.length && call.questions.every(validQuestion)) && bytes(JSON.stringify(list.calls)) <= 262144
  const listDigest = (target: any, list: any) => digestValue([target.sessionId, target.project.kind, target.project.key, target.scopeRevision, target.factRevision, list.availability, list.complete, list.asOfSeq, list.calls.map((call: any) => [call.callId, call.state, call.questions.map((q: any) => [q.id, q.question, q.detail ?? null, q.header ?? null, q.options?.map((o: any) => [o.label, o.description ?? null]) ?? null, q.multiSelect ?? null])])])
  const canonicalAnswers = (answers: any[]) => answers.map(answer => [answer.id, answer.selected, answer.custom === undefined ? null : answer.custom, answer.skip === true])
  const inputDigest = (input: any) => digestValue([input.epoch, input.requestId, input.actionId, input.target.sessionId, input.target.scopeRevision, input.target.factRevision, input.callId, input.snapshot.asOfSeq, input.snapshot.revision, canonicalAnswers(input.answers)])
  const answerSummary = async (answers: any[]) => ({ digest: await digestValue(canonicalAnswers(answers)), questions: answers.length, selections: answers.reduce((n, answer) => n + answer.selected.length, 0), customBytes: answers.reduce((n, answer) => n + bytes(answer.custom || ''), 0), skipped: answers.filter(answer => answer.skip === true).length })
  const callKey = (current: any, list: any, call: any) => JSON.stringify([current.key, list.snapshotRevision, list.asOfSeq, call.callId])
  const emptyAnswer = () => ({ mode: '', selected: [] as string[], custom: '', conditions: {} as any, adding: {} as any })
  const compileAnswers = (call: any, form: any) => {
    const answers = []
    for (const question of call.questions) {
      const value = form && Object.hasOwn(form, question.id) ? form[question.id] : emptyAnswer(), selected = array(value.selected)
      if (value.mode === 'skip') { answers.push({ id: question.id, selected: [], skip: true }); continue }
      if (value.mode === 'custom') { if (typeof value.custom !== 'string' || !value.custom.trim()) return null; answers.push({ id: question.id, selected: [], custom: value.custom }); continue }
      if (value.mode !== 'options' || !selected.length || question.multiSelect !== true && selected.length !== 1 || new Set(selected).size !== selected.length || selected.some(label => !array(question.options).some(option => option.label === label))) return null
      const key = JSON.stringify(selected), custom = value.adding?.[key] ? value.conditions?.[key] : undefined
      answers.push({ id: question.id, selected: [...selected], ...(typeof custom === 'string' && custom.trim() ? { custom } : {}) })
    }
    if (answers.some(answer => answer.custom !== undefined && (bytes(answer.custom) > 16384 || answer.custom.includes('\0'))) || bytes(JSON.stringify(answers)) > 65536) return null
    return answers
  }
  const validReceipt = (receipt: any, entry: any) => {
    const input = entry.pending, previous = entry.receipt, summary = entry.summary
    if (previous?.state === 'closed') return false
    if (!input || !plain(receipt) || receipt.version !== 1 || ['epoch', 'requestId', 'actionId', 'callId'].some(key => receipt[key] !== input[key]) || !sameTarget(receipt.target, entry.target) || receipt.snapshot?.asOfSeq !== input.snapshot.asOfSeq || receipt.snapshot?.revision !== input.snapshot.revision || receipt.digest !== entry.digest || !hashValid(receipt.digest) || !plain(receipt.answerSummary) || ['digest', 'questions', 'selections', 'customBytes', 'skipped'].some(key => receipt.answerSummary[key] !== summary?.[key]) || receipt.durable !== true || receipt.approval !== false || !['recorded', 'blocked', 'dispatch_unknown', 'accepted'].includes(receipt.state) || receipt.seq !== ({ recorded: 1, blocked: 2, dispatch_unknown: 2, accepted: 3 } as any)[receipt.state] || receipt.accepted !== (receipt.state === 'accepted') || receipt.executed !== (['recorded', 'blocked'].includes(receipt.state) ? false : null) || receipt.completed !== (['recorded', 'blocked'].includes(receipt.state) ? false : null) || receipt.disposition !== (receipt.state === 'accepted' ? 'target-durable-receipt' : receipt.state === 'dispatch_unknown' ? 'reconcile-only' : 'not-dispatched') || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || !Number.isSafeInteger(receipt.updatedAt) || receipt.updatedAt < receipt.at || receipt.code !== undefined && (typeof receipt.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(receipt.code)) || ['dispatch_unknown', 'accepted'].includes(receipt.state) && (!hashValid(receipt.controlRevision) || !hashValid(receipt.grantRevision))) return false
    const allowed = ['version', 'epoch', 'requestId', 'actionId', 'target', 'callId', 'snapshot', 'digest', 'answerSummary', 'seq', 'at', 'updatedAt', 'state', 'code', 'controlRevision', 'grantRevision', 'durable', 'accepted', 'executed', 'completed', 'approval', 'disposition']
    if (Object.keys(receipt).some(key => !allowed.includes(key)) || Object.keys(receipt.target).some(key => !['sessionId', 'scopeRevision', 'factRevision', 'project'].includes(key)) || Object.keys(receipt.snapshot).some(key => !['asOfSeq', 'revision'].includes(key)) || Object.keys(receipt.answerSummary).some(key => !['digest', 'questions', 'selections', 'customBytes', 'skipped'].includes(key))) return false
    if (previous && (receipt.seq < previous.seq || receipt.at !== previous.at || receipt.updatedAt < previous.updatedAt || receipt.seq === previous.seq && ['state', 'code', 'updatedAt', 'controlRevision', 'grantRevision'].some(key => receipt[key] !== previous[key]) || ['blocked', 'accepted'].includes(previous.state) && receipt.state !== previous.state || previous.state === 'dispatch_unknown' && !['dispatch_unknown', 'accepted'].includes(receipt.state))) return false
    return true
  }

  const validClosure = (receipt: any, entry: any) => {
    const input = entry.pending, previous = entry.receipt
    const exact = (value: any, keys: string[]) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) && Object.getOwnPropertySymbols(value).length === 0
    const keys = ['version', 'epoch', 'requestId', 'actionId', 'target', 'callId', 'snapshot', 'digest', 'seq', 'at', 'updatedAt', 'state', 'bindingVerified', 'durable', 'accepted', 'executed', 'completed', 'approval', 'disposition', 'code']
    if (entry.closeRequested !== true || !input || previous && previous.state !== 'closed' || !exact(receipt, keys) || receipt.version !== 1 || ['epoch', 'requestId', 'actionId', 'callId'].some(key => receipt[key] !== input[key]) || !exact(receipt.target, ['sessionId', 'scopeRevision', 'factRevision']) || ['sessionId', 'scopeRevision', 'factRevision'].some(key => receipt.target[key] !== input.target[key]) || !exact(receipt.snapshot, ['asOfSeq', 'revision']) || receipt.snapshot.asOfSeq !== input.snapshot.asOfSeq || receipt.snapshot.revision !== input.snapshot.revision || !hashValid(receipt.digest) || receipt.digest !== entry.digest || receipt.seq !== 1 || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || receipt.at > Date.now() || receipt.updatedAt !== receipt.at || receipt.state !== 'closed' || receipt.bindingVerified !== false || receipt.durable !== true || receipt.accepted !== false || receipt.executed !== null || receipt.completed !== null || receipt.approval !== false || receipt.disposition !== 'closed-before-dispatch' || receipt.code !== 'session_decision_id_closed') return false
    return !previous || receipt.at === previous.at && receipt.updatedAt === previous.updatedAt
  }

  function Decisions(props: { epoch: string; active: boolean; located: any }) {
    const [lists, setLists] = React.useState({} as any), listsRef = React.useRef({} as any)
    const [entries, setEntries] = React.useState({} as any), entriesRef = React.useRef({} as any)
    const [selected, setSelected] = React.useState(''), selectedRef = React.useRef('')
    const [history, setHistory] = React.useState('')
    const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
    const busyRef = React.useRef(null as any), mounted = React.useRef(false), generation = React.useRef(0), composing = React.useRef(false)
    const heading = React.useRef(null as HTMLElement | null), opener = React.useRef(null as HTMLElement | null)
    const viewRef = React.useRef({ epoch: props.epoch, active: props.active, current: locatedBinding(props.epoch, props.located) } as any)
    const controllers = React.useRef(new Set<AbortController>())
    const current = locatedBinding(props.epoch, props.located), currentKey = current?.key || ''
    viewRef.current = { epoch: props.epoch, active: props.active, current }
    const saveEntry = (key: string, value: any) => { entriesRef.current = { ...entriesRef.current, [key]: value }; if (mounted.current) setEntries(entriesRef.current) }
    const call = async (input: any) => { const controller = new AbortController(); controllers.current.add(controller); try { return await request('session-decision', input, controller.signal) } finally { controllers.current.delete(controller) } }
    const activeEntry = () => {
      const view = viewRef.current, list = listsRef.current[view.current?.key], call = array(list?.calls).find(row => callKey(view.current, list, row) === selectedRef.current)
      if (!view.active || !view.current || !list || !call) return null
      return { current: view.current, list, call, key: callKey(view.current, list, call) }
    }
    const unresolved = () => Object.values(entriesRef.current).some((entry: any) => entry.pending && !['blocked', 'accepted', 'closed'].includes(entry.status))
    const canClose = (entry: any) => !!entry?.pending && entry.status === 'unknown' && !entry.receipt && !entry.closeRequested && !entry.busy && entry.epoch === viewRef.current.epoch && entry.pending.epoch === entry.epoch
    const readQuestions = async () => {
      const view = viewRef.current, start = view.current, version = generation.current
      if (!mounted.current || !view.active || !start || busyRef.current) return
      const operation = {}; busyRef.current = operation; setBusy(true); setError(''); selectedRef.current = ''; setSelected(''); setHistory('')
      try {
        const list = await call({ action: 'list', epoch: start.epoch, target: { sessionId: start.target.sessionId, scopeRevision: start.target.scopeRevision, factRevision: start.target.factRevision } })
        if (!mounted.current || generation.current !== version || !viewRef.current.active || viewRef.current.current?.key !== start.key) return
        if (!validList(list, start) || await listDigest(start.target, list) !== list.snapshotRevision) throw new Error('invalid_question_list')
        if (!mounted.current || generation.current !== version || !viewRef.current.active || viewRef.current.current?.key !== start.key) return
        listsRef.current = { ...listsRef.current, [start.key]: list }; setLists(listsRef.current)
      } catch { if (mounted.current && generation.current === version) setError(tr('Changed')) }
      finally { if (busyRef.current === operation) { busyRef.current = null; if (mounted.current) setBusy(false) } }
    }
    const openCall = (callId: string) => {
      const start = viewRef.current.current, list = listsRef.current[start?.key], call = array(list?.calls).find(row => row.callId === callId)
      if (!viewRef.current.active || !start || !call || busyRef.current) return
      const key = callKey(start, list, call); opener.current = typeof document === 'undefined' ? null : document.activeElement as HTMLElement
      selectedRef.current = key; setSelected(key); setHistory(''); setError('')
      if (!entriesRef.current[key]) saveEntry(key, { epoch: start.epoch, target: start.target, title: start.title, call, snapshot: { asOfSeq: list.asOfSeq, revision: list.snapshotRevision }, form: {}, status: 'draft' })
    }
    const editAnswer = (questionId: string, action: string, value: any) => {
      const active = activeEntry(), entry = active && entriesRef.current[active.key]
      if (!active || !entry || entry.pending || entry.busy || active.list.availability !== 'live' || !active.list.complete || active.call.state !== 'continued') return
      const question = active.call.questions.find((row: any) => row.id === questionId); if (!question) return
      const old = Object.hasOwn(entry.form, questionId) ? entry.form[questionId] : emptyAnswer(), next = { ...old, selected: [...old.selected], conditions: { ...old.conditions }, adding: { ...old.adding } }
      if (action === 'mode' && ['', 'custom', 'skip'].includes(value)) next.mode = value
      else if (action === 'option' && array(question.options).some(option => option.label === value)) { next.mode = 'options'; next.selected = question.multiSelect ? next.selected.includes(value) ? next.selected.filter((label: string) => label !== value) : [...next.selected, value] : [value] }
      else if (action === 'custom' && typeof value === 'string') next.custom = value
      else if (action === 'adding' && typeof value === 'boolean' && next.mode === 'options') next.adding[JSON.stringify(next.selected)] = value
      else if (action === 'conditions' && typeof value === 'string' && next.mode === 'options') next.conditions[JSON.stringify(next.selected)] = value
      else return
      saveEntry(active.key, { ...entry, form: { ...entry.form, [questionId]: next }, error: '' })
    }
    const checkAnswers = async () => {
      const active = activeEntry(), entry = active && entriesRef.current[active.key]
      if (!mounted.current || composing.current || !active || !entry || entry.pending || busyRef.current || unresolved() || active.list.availability !== 'live' || !active.list.complete || active.call.state !== 'continued') return
      const answers = compileAnswers(active.call, entry.form); if (!answers) { setError(tr('Choose')); return }
      let input: any; try { input = { epoch: active.current.epoch, requestId: mint(), actionId: mint(), target: { sessionId: entry.target.sessionId, scopeRevision: entry.target.scopeRevision, factRevision: entry.target.factRevision }, callId: active.call.callId, snapshot: { ...entry.snapshot }, answers } } catch { setError(tr('Failed')); return }
      const operation = {}, version = generation.current; busyRef.current = operation; setBusy(true); setError(''); saveEntry(active.key, { ...entry, busy: true })
      let sent = false
      try {
        const digest = await inputDigest(input), summary = await answerSummary(answers)
        if (!mounted.current || composing.current || generation.current !== version || activeEntry()?.key !== active.key) { saveEntry(active.key, { ...entry, busy: false }); return }
        const pending = { ...entry, busy: true, status: 'pending', pending: input, digest, summary }; saveEntry(active.key, pending); sent = true
        const receipt = await call({ action: 'prepare', ...input })
        if (!validReceipt(receipt, pending)) throw new Error('invalid_decision_receipt')
        saveEntry(active.key, { ...pending, busy: false, status: receipt.state, receipt, error: '' })
      } catch { const stored = entriesRef.current[active.key]; saveEntry(active.key, { ...stored, busy: false, status: sent ? 'unknown' : 'draft', error: tr(sent ? 'Unknown' : 'Failed') }) }
      finally { if (busyRef.current === operation) { busyRef.current = null; if (mounted.current) setBusy(false) } }
    }
    const checkStatus = async (key: string) => {
      const entry = entriesRef.current[key], view = viewRef.current
      if (!mounted.current || !view.active || composing.current || !entry?.pending || entry.epoch !== view.epoch || entry.pending.epoch !== view.epoch || busyRef.current || ['blocked', 'accepted', 'closed'].includes(entry.receipt?.state) || ['blocked', 'accepted', 'closed'].includes(entry.status)) return
      const operation = {}, pending = { ...entry, busy: true, closeConfirm: false }; busyRef.current = operation; setBusy(true); saveEntry(key, pending)
      try { const receipt = await call({ action: 'status', epoch: entry.epoch, actionId: entry.pending.actionId }); if (!(receipt?.state === 'closed' ? validClosure(receipt, pending) : validReceipt(receipt, pending))) throw new Error('invalid_decision_receipt'); saveEntry(key, { ...pending, busy: false, status: receipt.state, receipt, error: '' }) }
      catch (cause: any) { saveEntry(key, { ...pending, busy: false, status: 'unknown', error: tr(cause?.status === 404 ? 'NotFound' : entry.closeRequested ? 'CloseUnknown' : 'Unknown') }) }
      finally { if (busyRef.current === operation) { busyRef.current = null; if (mounted.current) setBusy(false) } }
    }
    const confirmClose = (key: string, confirm: boolean) => {
      const entry = entriesRef.current[key]
      if (!mounted.current || !viewRef.current.active || composing.current || busyRef.current || !canClose(entry)) return
      saveEntry(key, { ...entry, closeConfirm: confirm })
    }
    const closeDecision = async (key: string) => {
      const entry = entriesRef.current[key]
      if (!mounted.current || !viewRef.current.active || composing.current || busyRef.current || !canClose(entry) || entry.closeConfirm !== true) return
      const operation = {}, pending = { ...entry, busy: true, closeConfirm: false, closeRequested: true, error: '' }; busyRef.current = operation; setBusy(true); saveEntry(key, pending)
      try {
        const receipt = await call({ action: 'close', ...entry.pending })
        if (!(receipt?.state === 'closed' ? validClosure(receipt, pending) : validReceipt(receipt, pending))) throw new Error('invalid_decision_closure')
        saveEntry(key, { ...pending, busy: false, status: receipt.state, receipt, error: '' })
      } catch { saveEntry(key, { ...pending, busy: false, status: 'unknown', error: tr('CloseUnknown') }) }
      finally { if (busyRef.current === operation) { busyRef.current = null; if (mounted.current) setBusy(false) } }
    }
    const newDraft = () => {
      const active = activeEntry(), entry = active && entriesRef.current[active.key]
      if (!mounted.current || !active || composing.current || busyRef.current || !['blocked', 'closed'].includes(entry?.status) || entry.receipt?.state !== entry.status || !(entry.status === 'closed' ? validClosure(entry.receipt, entry) : validReceipt(entry.receipt, entry))) return
      const historyKey = `history:${entry.pending.actionId}`; entriesRef.current = { ...entriesRef.current, [historyKey]: { ...entry, history: true }, [active.key]: { epoch: entry.epoch, target: entry.target, title: entry.title, call: active.call, snapshot: { ...entry.snapshot }, form: {}, status: 'draft' } }; setEntries(entriesRef.current); setError(tr('NoCopy'))
    }
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const controller of controllers.current) controller.abort(); controllers.current.clear() } }, [])
    React.useEffect(() => { generation.current++; composing.current = false; selectedRef.current = ''; setSelected(''); setHistory(''); setError(''); for (const [key, entry] of Object.entries(entriesRef.current) as any) if (entry.closeConfirm) saveEntry(key, { ...entry, closeConfirm: false }) }, [props.epoch, props.active, currentKey])
    React.useEffect(() => { if (props.active && (selected || history)) heading.current?.focus(); return () => { if (opener.current?.isConnected) opener.current.focus() } }, [props.active, selected, history])
    if (!props.active) return null
    const list = current && lists[current.key], selectedCall = array(list?.calls).find(row => current && callKey(current, list, row) === selected), entry = entries[selected], evidence = history ? entries[history] : null
    const canEdit = !!selectedCall && list?.availability === 'live' && list.complete && selectedCall.state === 'continued' && !entry?.pending && !busy
    const statusText = (value: string) => tr(({ pending: 'Pending', unknown: 'Unknown', recorded: 'Recorded', blocked: 'Rejected', dispatch_unknown: 'DispatchUnknown', accepted: 'Accepted', closed: 'Closed' } as any)[value] || 'Failed')
    const evidenceView = (value: any) => value ? h('section', { className: 'saw-box' }, h('h4', null, statusText(value.status)), h('p', { className: 'saw-meta' }, `${value.title} · ${value.target.sessionId} · ${value.pending?.callId || value.call.callId}`), value.epoch !== props.epoch ? h('p', { className: 'saw-error' }, tr('OldEpoch')) : null,
      h('p', { className: 'saw-meta' }, tr('Boundary')), value.error ? h('p', { className: 'saw-error', role: 'alert' }, value.error) : null,
      ...array(value.pending?.answers).map(answer => h('section', { className: 'saw-box', key: answer.id }, h('h4', null, value.call.questions.find((q: any) => q.id === answer.id)?.question || answer.id), answer.skip ? h('p', null, tr('Skipped')) : h(React.Fragment, null, ...answer.selected.map((label: string, i: number) => h('p', { className: 'saw-pre', key: i }, label)), answer.custom ? h('p', { className: 'saw-pre' }, answer.custom) : null))),
      value.receipt ? h('details', null, h('summary', null, tr('Receipt')), h('pre', { className: 'saw-pre' }, JSON.stringify(value.receipt, null, 2))) : null,
      value.pending && !['blocked', 'accepted', 'closed'].includes(value.status) ? button(tr('Status'), () => { void checkStatus(history || selected) }, busy || value.epoch !== props.epoch) : null,
      canClose(value) ? value.closeConfirm ? h('div', { role: 'group', 'aria-label': tr('Close') }, h('p', { className: 'saw-error' }, tr('CloseBoundary')), button(tr('CloseConfirm'), () => { void closeDecision(history || selected) }, busy), button(tr('Cancel'), () => confirmClose(history || selected, false), busy)) : button(tr('Close'), () => confirmClose(history || selected, true), busy) : null) : null
    return h('section', { className: 'saw-session-work', 'aria-label': tr('Title') }, h('h3', { ref: heading, tabIndex: -1 }, tr('Title')), h('p', { className: 'saw-error' }, tr('Boundary')),
      error ? h('p', { className: 'saw-error', role: 'alert' }, error) : null, busy ? h('p', { role: 'status' }, tr('Loading')) : null,
      evidence ? h(React.Fragment, null, button(tr('Back'), () => setHistory('')), evidenceView(evidence)) : selectedCall ? h(React.Fragment, null,
        button(tr('Back'), () => { selectedRef.current = ''; setSelected('') }, busy), h('p', { className: 'saw-meta' }, `${tr('Target')}: ${current!.title} · ${current!.target.sessionId}`), h('p', { className: 'saw-meta' }, `${tr('Snapshot')}: ${list.asOfSeq} · ${list.snapshotRevision}`),
        !list.complete ? h('p', { className: 'saw-error' }, tr('Partial')) : list.availability !== 'live' ? h('p', { className: 'saw-error' }, tr('Cold')) : selectedCall.state !== 'continued' ? h('p', { className: 'saw-error' }, tr('Open')) : h('p', { className: 'saw-meta' }, tr('Blocked')),
        ...selectedCall.questions.map((question: any) => { const answer = entry?.form && Object.hasOwn(entry.form, question.id) ? entry.form[question.id] : emptyAnswer(), optionsKey = JSON.stringify(answer.selected), adding = answer.mode === 'options' && answer.adding[optionsKey]; return h('fieldset', { className: 'saw-box', key: question.id, disabled: !canEdit }, h('legend', null, question.header || tr('Original')), h('p', { className: 'saw-pre' }, question.question), question.detail ? h('p', { className: 'saw-pre' }, question.detail) : null,
          ...array(question.options).map((option: any, index: number) => h('label', { className: 'saw-setting', key: index }, h('input', { type: question.multiSelect ? 'checkbox' : 'radio', name: `go-decision:${selected}:${question.id}`, checked: answer.mode === 'options' && answer.selected.includes(option.label), onChange: () => editAnswer(question.id, 'option', option.label) }), option.label, option.description ? h('p', { className: 'saw-meta' }, option.description) : null)),
          h('label', null, h('input', { type: 'radio', name: `go-decision:${selected}:${question.id}`, checked: answer.mode === 'custom', onChange: () => editAnswer(question.id, 'mode', 'custom') }), tr('Custom')),
          h('label', null, h('input', { type: 'radio', name: `go-decision:${selected}:${question.id}`, checked: answer.mode === 'skip', onChange: () => editAnswer(question.id, 'mode', 'skip') }), tr('Skip')),
          answer.mode === 'options' && answer.selected.length ? button(tr(adding ? 'CancelConditions' : 'Conditions'), () => editAnswer(question.id, 'adding', !adding), !canEdit) : null,
          answer.mode === 'custom' || adding ? h('textarea', { rows: 3, maxLength: 16384, value: answer.mode === 'custom' ? answer.custom : answer.conditions[optionsKey] || '', required: answer.mode === 'custom', disabled: !canEdit, onChange: (event: any) => editAnswer(question.id, answer.mode === 'custom' ? 'custom' : 'conditions', event.target.value), onCompositionStart: () => { composing.current = true }, onCompositionEnd: () => { composing.current = false }, onBlur: () => { composing.current = false }, 'aria-label': tr(answer.mode === 'custom' ? 'Custom' : 'Conditions') }) : null) }),
        button(tr('Check'), () => { void checkAnswers() }, !canEdit || !compileAnswers(selectedCall, entry?.form) || unresolved()), !compileAnswers(selectedCall, entry?.form) ? h('p', { className: 'saw-meta' }, tr('Choose')) : null,
        entry?.pending ? evidenceView(entry) : null, ['blocked', 'closed'].includes(entry?.status) ? button(tr('NewDraft'), newDraft, busy) : null) : h(React.Fragment, null,
        current ? h(React.Fragment, null, h('p', { className: 'saw-meta' }, `${tr('Target')}: ${current!.title} · ${current!.target.sessionId}`), button(tr('Read'), () => { void readQuestions() }, busy), list && !list.complete ? h('p', { className: 'saw-error' }, tr('Partial')) : null, list && list.availability !== 'live' ? h('p', { className: 'saw-meta' }, tr('Cold')) : null,
          ...array(list?.calls).map(row => h('article', { className: 'saw-box', key: row.callId }, h('h4', null, row.questions[0]?.header || row.questions[0]?.question || row.callId), h('p', { className: 'saw-meta' }, `${row.questions.length} · ${row.state}`), button(tr('Details'), () => openCall(row.callId), busy))), list && !list.calls.length ? h('p', null, tr('Empty')) : null) : h('p', null, tr('Locate')),
        unresolved() ? h('p', { className: 'saw-error' }, tr('Unresolved')) : null,
        Object.keys(entries).length ? h('section', null, h('h4', null, tr('History')), ...Object.entries(entries).filter(([, value]: any) => value.pending).map(([key, value]: any) => button(`${value.title} · ${statusText(value.status)}`, () => setHistory(key), busy, { key }))) : null))
  }
  return { Decisions }
}
