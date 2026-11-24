/** Serialized into the client runtime: all helpers stay inside the factory, with no imports. */
export function createGoProjects(React: any, request: (path: string, body: any, signal?: AbortSignal) => Promise<any>, t: any) {
  const h = React.createElement
  const strings: Record<string, string> = {
    Projects: '项目', Intro: '从可信 Host 项目索引查看当前工作观察与原会话；浏览不改变对话草稿或发送目标。',
    Refresh: '刷新项目与范围', MoreProjects: '加载更多项目', MoreSessions: '加载更多会话', BackProjects: '返回项目集合', BackWork: '返回项目工作', OpenProject: '进入项目', OpenObservation: '查看当前工作观察', OpenSession: '查看原会话上下文', Inspect: '核对当前目标（不执行）',
    Work: '事项观察', Sessions: '关联会话', Sources: '任务来源', Overview: '概览', Progress: '进展', Relations: '关联', Results: '结果',
    Untitled: '未命名项目', UntitledSession: '未提供会话标题', Unassigned: '未归属', Unknown: '归属暂不可用',
    Loading: '正在读取已纳入范围…', Failed: '读取失败；已加载内容仅为上次观察，可能过期。未自动重试，可显式刷新项目与范围。', Changed: '范围或项目事实版本已变化，旧内容已失效；请刷新项目与范围。', Invalid: 'Host 数据不完整或与当前项目不一致；未发布正文，请刷新核实。',
    Partial: '部分范围尚未核实；已加载内容不代表全部项目或工作。', Empty: '当前已加载范围没有可展示的项目。',
    NotLoadedProject: '当前项目不在已加载索引中。它可能在下一页、已删除或无权访问；不能按标题猜归属。',
    UnknownProject: '项目归属未知，禁止读取工作正文。请刷新可信项目索引；不能按名称或目录猜归属。',
    Excluded: '该项目已排除；不读取或展示工作正文。排除不代表停止原会话，恢复请到设置的管理范围操作，再刷新核实。',
    MissingProject: '当前会话尚无已核实的项目引用。请返回项目索引核对归属；不会跨项目搜正文或按标题匹配。',
    NotLoadedSession: '当前会话不在已加载的纳入页中。可继续分页或刷新核实；也可能已移动、排除、删除或无权访问。',
    ObservationIntro: '这里是有结构化目标的当前工作观察，不另建 Ticket，也不假定一个会话永远只处理一个事项。会话数量不是事项总数。',
    ObservationEmpty: '已加载会话中暂无可用的结构化目标观察；不等于项目没有工作。可查看会话上下文或继续分页。',
    SessionIntro: '这里只列实际的原会话上下文，不复制成额外事项实体。运行状态不等于业务结果。',
    SessionEmpty: '已加载页没有纳入的原会话。', NoObjective: '该会话尚无可信的结构化目标观察。可核对原会话上下文，不能据标题创造事项。',
    SourceGap: '当前 API 没有可信的项目—任务来源关联，不能把所有来源归属于此项目，也不能据此断言项目没有来源。', SourceSettings: '前往任务来源配置',
    CurrentObservation: '当前工作观察（来源：原会话结构化事实）', Objective: '结构化目标', Done: '已报告完成步骤（不是验收证明）', Current: '当前进展', Next: '下一步', Blocker: '阻塞', Decision: '原会话问题观察（不是操作审批）',
    MissingFact: '暂未取得可靠事实', NoTimeline: '仅展示当前事实快照；没有可信事件时间线，不编造历史或完成证明。',
    ApprovalGap: '审批覆盖缺口：普通会话的通用工具审批 / 旧阻塞问题没有完整可信投影；这里不能批准或声称全部处理。',
    ResultGap: '结果尚未验收；acceptanceVerified: false。目标自报 complete、已完成步骤或 idle 都不是验收通过。', NoResult: '尚无结果事实；不能推断已完成。', GoalComplete: '目标自报完成（未验收）', Unverified: '有结果摘要（未核实）',
    RelationGap: '仅有 Host 项目成员关系与原会话引用；没有可信来源关联或额外事项 / 子任务 lineage，不按标题合并。',
    OriginalSession: '原会话', ProjectRelation: 'Host 项目归属', Runtime: '会话运行状态', Running: '运行中（不等于完成）', Idle: '空闲（不等于完成）', Unavailable: '不可用', UnknownState: '未知',
    Observed: '观察时间', Revision: '范围事实版本', FactRevision: '会话事实版本', StableId: '稳定标识', CatalogCount: '项目索引：已加载 / 总数', IncludedCount: '纳入会话 / 全部会话', SessionCount: '会话页：已加载 / 纳入总数', ObservationCount: '已加载结构化目标观察',
    Inactive: '当前视图已停用，不读取或保留工作正文。', NoEpoch: '工作区尚未就绪，暂不读取。',
  }
  const tr = (key: string): string => { const id = `w${key === 'Projects' ? 'Projects' : `Projects${key}`}`; try { const value = typeof t === 'function' ? t(id) : null; if (typeof value === 'string' && value && value !== id) return value } catch {} return strings[key] || key }
  const id = (v: any) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(v) && !v.includes('://')
  const hash = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  const count = (v: any) => Number.isSafeInteger(v) && v >= 0
  const cursorValid = (v: any) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(v)
  const array = (v: any): any[] => Array.isArray(v) ? v : []
  const scopeProjectKey = (row: any): string => row?.kind === 'project' && id(row.key) ? `project:${row.key}` : ['unassigned', 'unknown'].includes(row?.kind) && row.key === row.kind ? row.kind : ''
  const projectName = (row: any) => row?.kind === 'project' ? typeof row.name === 'string' && row.name.trim() && row.name.trim() !== row.key && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(row.name.trim()) ? row.name : tr('Untitled') : tr(row?.kind === 'unassigned' ? 'Unassigned' : 'Unknown')
  const sessionName = (row: any) => typeof row?.title === 'string' && row.title.trim() ? row.title : tr('UntitledSession')
  const text = (v: any) => typeof v === 'string' && v.trim() ? v : tr('MissingFact')
  const runtime = (v: any) => tr(v === 'running' ? 'Running' : v === 'idle' ? 'Idle' : v === 'unavailable' ? 'Unavailable' : 'UnknownState')
  const objective = (row: any) => row?.evidence === 'structured' && typeof row.objective === 'string' && !!row.objective.trim()
  const button = (label: string, onClick: any, disabled = false, extra: any = {}) => h('button', { type: 'button', className: 'saw-btn', disabled, onClick, ...extra }, tr(label))
  const fact = (label: string, value: any) => h('div', { className: 'saw-work-fact' }, h('h4', null, tr(label)), h('p', null, text(value)))
  const initial = () => ({ catalog: null as any, page: null as any, busy: null as any, attempted: null as any, error: '', stale: false, sequence: 0 })
  function Projects(props: { epoch: string; active: boolean; scopeRevision?: string; projectKey?: string; sessionId?: string; tab?: string; onNavigate: (view: { projectKey?: string; sessionId?: string; tab?: string }) => void; onInspectTarget?: (row: any, revision: string) => void; onSources?: () => void }) {
    const [, repaint] = React.useState(0)
    const ref = React.useRef(null as any)
    const projectKey = props.projectKey || '', sessionId = props.sessionId || ''
    const target = JSON.stringify([projectKey, sessionId, props.tab || ''])
    if (!ref.current) ref.current = { epoch: props.epoch, active: props.active, scope: props.scopeRevision, target, generation: 0, alive: true, state: initial() }
    const p = ref.current
    // Render-time revocation prevents even a single frame of old-scope正文 and kills old closures.
    if (p.epoch !== props.epoch || p.active !== props.active || p.scope !== props.scopeRevision) {
      p.state.busy?.controller.abort(); p.generation++; p.state = initial()
      p.epoch = props.epoch; p.active = props.active; p.scope = props.scopeRevision; p.target = target
    } else if (p.target !== target) {
      p.state.busy?.controller.abort(); p.state.busy = null; p.generation++; p.target = target; p.state.error = ''
      if (p.state.page?.projectKey !== projectKey) p.state.page = null
    }
    const s = p.state, generation = p.generation, epoch = props.epoch
    const current = () => p.alive && p.active && !!epoch && p.epoch === epoch && p.generation === generation && p.state === s && p.target === target
    const change = (update: () => void) => { if (current()) { update(); repaint((v: number) => v + 1) } }
    React.useEffect(() => { p.alive = true; return () => { p.alive = false; p.state.busy?.controller.abort(); p.state.busy = null } }, [])
    const failClosed = (message: string) => { s.catalog = null; s.page = null; s.stale = true; s.error = tr(message) }
    const run = async (kind: string, action: (signal: AbortSignal, valid: () => boolean) => Promise<void>) => {
      if (!current() || s.busy) return
      const op = { kind, controller: new AbortController() }; s.busy = op; change(() => { s.error = '' })
      const valid = () => current() && s.busy === op && !op.controller.signal.aborted
      try { await action(op.controller.signal, valid) }
      catch (error: any) { if (valid()) change(() => { if (error?.status === 409 || error?.message === 'changed') failClosed('Changed'); else if (error?.message === 'invalid') failClosed('Invalid'); else s.error = tr('Failed') }) }
      finally { if (s.busy === op) { s.busy = null; if (current()) repaint((v: number) => v + 1) } }
    }
    const validatePage = (data: any, prior: any, more: boolean) => {
      if (!data || !['ready', 'partial'].includes(data.state) || !hash(data.revision) || !count(data.sampledAt) || !Array.isArray(data.items) || data.items.length > 20 || !count(data.total) || typeof data.hasMore !== 'boolean' || data.hasMore && (!cursorValid(data.next) || more && data.next === prior?.next) || !data.hasMore && data.next !== undefined) throw new Error('invalid')
      if (more && (!prior || data.revision !== prior.revision || data.total !== prior.total)) throw new Error('changed')
    }
    const readProjects = (more = false) => {
      const old = s.catalog, cursor = more ? old?.next : undefined
      if (!current() || s.busy || more && (!old?.hasMore || !cursorValid(cursor))) return
      // A full refresh invalidates facts before the network boundary, not on its reply.
      if (!more) { s.catalog = null; s.page = null; s.attempted = null; s.stale = false; s.sequence++; repaint((v: number) => v + 1) }
      return run('projects', async (signal, valid) => {
        const data = await request('session-work', { action: 'projects', epoch, limit: 20, ...(cursor ? { cursor } : {}) }, signal)
        if (!valid()) return
        validatePage(data, old, more)
        if (data.items.some((row: any) => !scopeProjectKey(row) || typeof row.excluded !== 'boolean' || !count(row.sessionTotal) || !count(row.includedTotal) || row.includedTotal > row.sessionTotal || row.kind === 'project' && typeof row.name !== 'string') || new Set(data.items.map(scopeProjectKey)).size !== data.items.length) throw new Error('invalid')
        const prior = more ? old.items : []
        if (data.items.some((row: any) => prior.some((other: any) => scopeProjectKey(other) === scopeProjectKey(row))) || prior.length + data.items.length > data.total || data.hasMore && (!data.items.length || prior.length + data.items.length >= data.total) || !data.hasMore && prior.length + data.items.length !== data.total) throw new Error('invalid')
        change(() => { s.catalog = { ...data, items: [...prior, ...data.items] }; s.stale = false })
      })
    }
    const selectedProject = () => array(s.catalog?.items).find(row => scopeProjectKey(row) === projectKey)
    const readSessions = (more = false) => {
      const project = selectedProject(), catalog = s.catalog, old = s.page, cursor = more ? old?.next : undefined
      if (!current() || s.busy || s.stale || !catalog || !projectKey || !project || project.excluded || project.kind === 'unknown' || more && (!old?.hasMore || old.projectKey !== projectKey || old.revision !== catalog.revision || !cursorValid(cursor))) return
      s.attempted = JSON.stringify([target, catalog.revision, s.sequence])
      return run('sessions', async (signal, valid) => {
        const data = await request('session-work', { action: 'list', epoch, view: 'included', projectKey, limit: 20, ...(cursor ? { cursor } : {}) }, signal)
        if (!valid() || s.catalog !== catalog || selectedProject() !== project) return
        if (data?.state === 'unavailable') throw new Error('unavailable')
        validatePage(data, old, more)
        if (data.revision !== catalog.revision) throw new Error('changed')
        if (data.scope !== 'current-host' || data.defaultIncluded !== true || data.items.some((row: any) => !id(row?.sessionId) || scopeProjectKey(row.project) !== projectKey || row.excluded !== false || row.exclusionReason !== undefined || typeof row.title !== 'string' || !['structured', 'missing', 'unavailable'].includes(row.evidence) || !['running', 'idle', 'unavailable', 'unknown'].includes(row.runtime) || !count(row.observedAt) || row.approvalCoverage !== 'unavailable' || row.factRevision !== undefined && !hash(row.factRevision) || row.done !== undefined && (!Array.isArray(row.done) || !row.done.every((v: any) => typeof v === 'string')) || row.result !== undefined && (!['goal-complete', 'unverified'].includes(row.result?.state) || row.result.acceptanceVerified !== false)) || new Set(data.items.map((row: any) => row.sessionId)).size !== data.items.length) throw new Error('invalid')
        const prior = more ? old.items : []
        if (data.items.some((row: any) => prior.some((other: any) => other.sessionId === row.sessionId)) || prior.length + data.items.length > data.total || data.hasMore && (!data.items.length || prior.length + data.items.length >= data.total) || !data.hasMore && prior.length + data.items.length !== data.total) throw new Error('invalid')
        change(() => { s.page = { ...data, projectKey, items: [...prior, ...data.items] } })
      })
    }
    const project = selectedProject()
    const tab = sessionId ? ['overview', 'progress', 'relations', 'results'].includes(props.tab || '') ? props.tab! : 'overview' : ['work', 'sessions', 'sources'].includes(props.tab || '') ? props.tab! : 'work'
    React.useEffect(() => { if (current() && !s.catalog && !s.stale && !s.busy) void readProjects() }, [epoch, props.active, props.scopeRevision, target])
    React.useEffect(() => { if (current() && project && !project.excluded && project.kind !== 'unknown' && tab !== 'sources' && !s.page && !s.stale && !s.busy && s.attempted !== JSON.stringify([target, s.catalog.revision, s.sequence])) void readSessions() }, [epoch, props.active, props.scopeRevision, target, s.catalog, s.sequence, s.busy])
    const navigate = (view: any) => { if (current()) props.onNavigate(view) }
    const safeRow = (row: any) => current() && !s.stale && s.catalog?.revision === s.page?.revision && s.page?.projectKey === projectKey && selectedProject() && !selectedProject().excluded && selectedProject().kind !== 'unknown' && s.page.items.includes(row) && row.excluded === false && scopeProjectKey(row.project) === projectKey
    const inspect = (row: any) => { if (safeRow(row) && row.evidence !== 'unavailable' && hash(row.factRevision)) props.onInspectTarget?.(row, s.page.revision) }
    const reference = (row: any) => {
      const raw = String(row.key), all = array(s.catalog?.items); let length = Math.min(8, raw.length)
      while (length < raw.length && all.some(other => other.key !== raw && String(other.key).startsWith(raw.slice(0, length)))) length++
      return raw.slice(0, length)
    }
    const identity = (row: any) => h('details', null, h('summary', null, tr('StableId')), h('code', null, row?.sessionId || scopeProjectKey(row)))
    const timestamp = (value: any) => { try { return new Date(value).toISOString() } catch { return tr('UnknownState') } }
    const observed = (row: any) => h('p', { className: 'saw-meta' }, `${tr('Observed')}: ${timestamp(row.observedAt)}`)
    const tabs = (kind: string, entries: string[]) => h('nav', { className: `saw-${kind}-tabs`, 'aria-label': tr(kind === 'work' ? 'CurrentObservation' : 'Projects') }, ...entries.map(value => button(value[0]!.toUpperCase() + value.slice(1), () => navigate({ projectKey, ...(sessionId ? { sessionId } : {}), tab: value }), false, { key: value, 'aria-current': value === tab ? 'page' : undefined })))
    const busy = !!s.busy
    const header = h('header', { className: 'saw-heading' }, h('h2', { tabIndex: -1 }, project ? projectName(project) : tr('Projects')), h('div', { className: 'saw-actions' }, (projectKey || sessionId) && button('BackProjects', () => navigate({})), button('Refresh', () => readProjects(), busy || !props.active || !epoch)))
    let body: any
    if (!props.active || !epoch) body = h('p', { role: 'status' }, tr(props.active ? 'NoEpoch' : 'Inactive'))
    else if (!projectKey && sessionId) body = h('aside', { role: 'status' }, tr('MissingProject'))
    else if (!projectKey) body = h('div', null, h('p', null, tr('Intro')), s.catalog && h('p', null, `${tr('CatalogCount')}: ${s.catalog.items.length} / ${s.catalog.total}`), h('div', { className: 'saw-project-collection' }, ...array(s.catalog?.items).filter(row => !row.excluded).map(row => h('article', { className: 'saw-project-card', key: scopeProjectKey(row) }, h('h3', null, projectName(row)), h('small', null, `#${reference(row)}`), h('p', null, `${tr('IncludedCount')}: ${row.includedTotal} / ${row.sessionTotal}`), identity(row), row.kind === 'unknown' && h('p', null, tr('UnknownProject')), button('OpenProject', () => navigate({ projectKey: scopeProjectKey(row), tab: 'work' }), false, { 'aria-label': `${tr('OpenProject')} ${projectName(row)} #${reference(row)}` })))), s.catalog && !s.catalog.items.some((row: any) => !row.excluded) && h('p', null, tr('Empty')), s.catalog?.hasMore && button('MoreProjects', () => readProjects(true), busy))
    else if (!project) body = h('aside', { role: 'status' }, tr(projectKey === 'unknown' ? 'UnknownProject' : 'NotLoadedProject'), s.catalog?.hasMore && button('MoreProjects', () => readProjects(true), busy))
    else if (project.excluded || project.kind === 'unknown') body = h('aside', { role: 'status' }, tr(project.excluded ? 'Excluded' : 'UnknownProject'))
    else {
      const page = s.page?.projectKey === projectKey && s.page?.revision === s.catalog?.revision ? s.page : null
      const rows = array(page?.items), rawRow = rows.find(value => value.sessionId === sessionId), row = rawRow && rawRow.evidence === 'unavailable' ? { sessionId: rawRow.sessionId, title: rawRow.title, project: rawRow.project, runtime: rawRow.runtime, observedAt: rawRow.observedAt, evidence: rawRow.evidence } : rawRow, observations = rows.filter(objective)
      const coverage = h('div', { className: 'saw-meta' }, page && h('p', null, `${tr('SessionCount')}: ${rows.length} / ${page.total}`), tab === 'work' && h('p', null, `${tr('ObservationCount')}: ${observations.length}`), page?.hasMore && button('MoreSessions', () => readSessions(true), busy), h('details', null, h('summary', null, tr('Revision')), h('code', null, page?.revision || s.catalog.revision)))
      if (sessionId) {
        body = h('div', { className: 'saw-work-detail' }, button('BackWork', () => navigate({ projectKey, tab: 'work' })), !row ? h('aside', { role: 'status' }, tr('NotLoadedSession')) : h('div', null, h('h3', null, objective(row) ? row.objective : sessionName(row)), h('p', null, tr('CurrentObservation')), tabs('work', ['overview', 'progress', 'relations', 'results']), !objective(row) && h('p', { role: 'note' }, tr('NoObjective')),
          tab === 'overview' && h('section', { className: 'saw-work-summary' }, fact('Objective', objective(row) ? row.objective : null), fact('Current', row.progress), fact('Next', row.nextAction), fact('Blocker', row.blocker), h('p', null, `${tr('Runtime')}: ${runtime(row.runtime)}`)),
          tab === 'progress' && h('section', { className: 'saw-work-summary' }, h('p', null, tr('NoTimeline')), h('h4', null, tr('Done')), row.evidence === 'structured' && array(row.done).length ? h('ul', null, ...row.done.map((done: string, i: number) => h('li', { key: i }, done))) : h('p', null, tr('MissingFact')), fact('Current', row.progress), fact('Next', row.nextAction), fact('Blocker', row.blocker), fact('Decision', row.decision)),
          tab === 'relations' && h('section', { className: 'saw-work-summary' }, fact('ProjectRelation', projectName(project)), fact('OriginalSession', sessionName(row)), identity(row), h('p', null, tr('RelationGap')), button('OpenSession', () => navigate({ projectKey, tab: 'sessions' }))),
          tab === 'results' && h('section', { className: 'saw-work-summary' }, h('p', { role: 'note' }, tr('ResultGap')), row.evidence === 'structured' && row.result ? h('div', null, h('h4', null, tr(row.result.state === 'goal-complete' ? 'GoalComplete' : 'Unverified')), h('p', null, text(row.result.summary))) : h('p', null, tr('NoResult'))),
          observed(row), h('p', { role: 'note' }, tr('ApprovalGap')), identity(row), row.factRevision && h('details', null, h('summary', null, tr('FactRevision')), h('code', null, row.factRevision)), props.onInspectTarget && button('Inspect', () => inspect(row), row.evidence === 'unavailable' || !hash(row.factRevision))), coverage)
      } else body = h('div', null, tabs('project', ['work', 'sessions', 'sources']), tab === 'sources' ? h('section', { className: 'saw-work-summary' }, h('p', null, tr('SourceGap')), props.onSources && button('SourceSettings', () => { if (current()) props.onSources?.() })) : h('div', null, h('p', null, tr(tab === 'work' ? 'ObservationIntro' : 'SessionIntro')), h('div', { className: 'saw-work-list' }, ...(tab === 'work' ? observations : rows).map(value => tab === 'work' ? h('button', { type: 'button', className: 'saw-work-row', key: value.sessionId, onClick: () => { if (safeRow(value)) navigate({ projectKey, sessionId: value.sessionId, tab: 'overview' }) } }, h('strong', null, value.objective), h('p', null, text(value.progress)), h('span', null, runtime(value.runtime)), observed(value)) : h('article', { className: 'saw-work-row', key: value.sessionId }, h('h3', null, sessionName(value)), h('small', null, `#${value.sessionId.slice(0, 8)}`), h('p', null, `${tr('Runtime')}: ${runtime(value.runtime)}`), observed(value), identity(value), button('OpenObservation', () => { if (safeRow(value)) navigate({ projectKey, sessionId: value.sessionId, tab: 'overview' }) }), props.onInspectTarget && button('Inspect', () => inspect(value), value.evidence === 'unavailable' || !hash(value.factRevision))))), page && !(tab === 'work' ? observations : rows).length && h('p', null, tr(tab === 'work' ? 'ObservationEmpty' : 'SessionEmpty')), coverage))
    }
    return h('section', { className: 'saw-section saw-projects', 'aria-busy': busy, onKeyDown: (event: any) => { if (event.key === 'Escape' && (projectKey || sessionId) && current()) { event.preventDefault(); event.stopPropagation(); navigate(sessionId && projectKey ? { projectKey, tab: 'work' } : {}) } } }, header, busy && h('p', { role: 'status' }, tr('Loading')), s.error && h('p', { role: 'alert' }, s.error), (s.catalog?.state === 'partial' || s.page?.state === 'partial') && h('p', { role: 'note' }, tr('Partial')), body)
  }
  return { Projects }
}
