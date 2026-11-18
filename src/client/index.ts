/** Browser factory is bundled by scripts/build-client.mjs; React stays host-owned. */
export function createClientPlugin(React: any, dictionaries: Record<string, Record<string, unknown>>, channelDefinitions: readonly unknown[]) {
  const h = React.createElement
  const NS = 'superagent'
  const pages = ['overview', 'tickets', 'threads', 'sources', 'approvals', 'health', 'settings'] as const
  return {
    inject: ['slots', 'locale', 'layout', 'uiConversation'],
    apply(ctx: any) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries))
      const t = ctx.locale.bind(NS)
      for (const definition of channelDefinitions) ctx.effect(() => ctx.uiConversation.events.register(definition))
      function ChannelNotice({ node }: any) {
        return h('section', { role: 'status', 'aria-label': t('channelNotice'), style: { color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 12, margin: '8px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, h('strong', null, t('channelNotice')), ...(node.data.messages ?? []).map((message: any) => h('p', { key: message.id, style: { margin: '8px 0 0' } }, message.text)))
      }
      ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'superagent-channel-notice', locale: NS }, ChannelNotice))
      let selected: string = 'overview'
      const css = `.sa-panel{height:100%;overflow:auto;box-sizing:border-box;padding:calc(var(--dsh-frame-top-clearance,0px) + 24px) 24px 24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}.sa-panel h1{font-size:22px;margin:0 0 8px}.sa-panel h2{font-size:17px;margin:0 0 12px}.sa-sub{color:var(--dsw-alias-label-secondary);margin:0 0 24px}.sa-tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px;margin-bottom:20px}.sa-btn{font:inherit;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 12px}.sa-btn[aria-selected=true]{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.sa-btn:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.sa-btn:disabled{cursor:default;opacity:.5}.sa-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:16px;margin-bottom:12px}.sa-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sa-error{color:var(--dsw-alias-state-error-primary)}.sa-meta{color:var(--dsw-alias-label-secondary);font-size:13px}.sa-dialog{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;max-width:560px;width:calc(100% - 48px)}.sa-dialog textarea{box-sizing:border-box;width:100%;min-height:80px;font:inherit;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:12px 0;padding:8px}.sa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.sa-value{font-size:22px;font-weight:600}.sa-list{margin:0;padding-left:20px}.sa-detail{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}.sa-fields{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,3fr);gap:8px 16px;margin:12px 0 0}.sa-fields dt{color:var(--dsw-alias-label-secondary)}.sa-fields dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.sa-panel h2,.sa-panel h3,.sa-panel strong{overflow-wrap:anywhere}.sa-group{margin-bottom:24px}.sa-group h3{font-size:15px;margin:0 0 12px}.sa-switch{font:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:3px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);cursor:default}.sa-switch[aria-checked=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.sa-readonly{margin:0 0 16px}.sa-pager{justify-content:space-between;margin:16px 0}@media(max-width:520px){.sa-panel{padding-left:16px;padding-right:16px}.sa-fields{grid-template-columns:minmax(0,1fr)}.sa-fields dd{margin-bottom:8px}}`

      async function request(path: string, body = {}, signal?: AbortSignal) {
        const timeout = new AbortController()
        const timer = setTimeout(() => timeout.abort(), 15000)
        const abort = () => timeout.abort()
        signal?.addEventListener('abort', abort, { once: true })
        try {
          const response = await fetch(new URL(`/api/superagent/${path.replace(/^\/+/, '')}`, document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: timeout.signal })
          const text = await response.text()
          let value: any
          try { value = text ? JSON.parse(text) : {} } catch { const error: any = new Error(t('invalidResponse')); error.status = response.status; throw error }
          if (!response.ok || !value?.ok) {
            const error: any = new Error(value?.message || value?.error?.message || value?.error?.detail || t('requestFailed'))
            error.code = value?.code || value?.error?.code
            error.status = response.status
            throw error
          }
          return value.data
        } catch (e: any) {
          if (e?.name === 'AbortError') { throw new Error(t('requestTimeout')) }
          throw e
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        }
      }
      function Icon() {
        return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'M12 3 3 7v10l9 4 9-4V7L12 3Zm0 0v18M3 7l9 4 9-4M7 5l10 4' }))
      }
      const text = (value: unknown, fallback = '—') => typeof value === 'string' && value ? value : fallback
      const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
      const formatTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : '—'
      const boolean = (value: unknown) => value === true ? t('yes') : value === false ? t('no') : t('unknown')
      const healthState = (value: unknown) => value === true ? t('healthy') : value === false ? t('unhealthy') : t('unknown')
      const serialized = (value: unknown): string => value === undefined || value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : typeof value === 'number' ? number(value) : String(value)
      const fields = (entries: Array<[string, any]>) => h('dl', { className: 'sa-fields' }, ...entries.map(([label, value]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value))))
      const records = (value: unknown) => Array.isArray(value) ? value : null
      const recordStatus = (value: unknown) => h('p', { className: 'sa-meta' }, records(value) ? t('empty') : t('unknown'))
      const readonly = () => h('p', { className: 'sa-meta sa-readonly' }, t('readonly'))
      const threadGroups = (items: any[]) => {
        const groups = new Map<string, any[]>()
        for (const item of items) {
          const source = text(item.source, t('unknown'))
          const group = groups.get(source) ?? []
          group.push(item); groups.set(source, group)
        }
        return [...groups].map(([source, rows]) => h('section', { className: 'sa-group', key: source, 'aria-label': `${t('source')}: ${source}` }, h('h2', null, `${t('source')}: ${source}`), ...rows.map((item: any, index: number) => h('article', { className: 'sa-card', key: item.key ?? index }, h('h3', null, text(item.key)), fields([
          [t('lastInboundAt'), formatTime(item.lastAt)], [t('createdAt'), formatTime(item.createdAt)],
          [t('messageCount'), number(item.messageCount)], [t('hasSubscription'), boolean(item.hasSubscription)], [t('subscriptionCount'), number(item.subscriptionCount)],
          [t('evalState'), text(item.eval?.state, t('unknown'))], [t('evaluationId'), text(item.eval?.id ?? item.evaluating)], [t('paused'), boolean(item.paused)], [t('sequence'), number(item.seq)],
        ])))))
      }
      const settingsValue = (entry: any) => entry.redacted === true || /^(stateDir|dbPath|lockPath|workRoot)$/.test(entry.key) ? '[REDACTED_PATH]' : serialized(entry.value)
      const origins: Record<string, string> = { patch: 'originPatch', environment: 'originEnvironment', default: 'originDefault', derived: 'originDerived', unavailable: 'originUnavailable' }
      const sourceCard = (item: any, index: number) => h('article', { className: 'sa-card', key: item.id ?? index }, h('h2', null, text(item.id)), fields([
        [t('kind'), text(item.kind)], [t('attended'), boolean(item.attended)], [t('health'), healthState(item.ok)], [t('lastEventAt'), formatTime(item.lastAt)],
        [t('paused'), typeof item.paused === 'boolean' ? h('button', { type: 'button', className: 'sa-switch', role: 'switch', 'aria-checked': item.paused, 'aria-label': `${t('paused')}: ${text(item.id)}`, disabled: true }, boolean(item.paused)) : t('unknown')],
      ]))
      const decisionCard = (item: any, index: number) => {
        const metrics = item.metrics ?? {}
        return h('article', { className: 'sa-card', key: `${item.at ?? 'unknown'}:${index}` }, h('h3', null, text(item.action)), fields([
          [t('at'), formatTime(item.at)], [t('rule'), text(item.rule)], [t('outcome'), text(item.outcome)], [t('assignmentId'), text(item.assignmentId)],
          [t('metricsAt'), formatTime(metrics.at)], [t('lastProgressAt'), formatTime(metrics.lastProgressAt)], [t('stallMs'), number(metrics.stallMs)], [t('durationMs'), number(metrics.durationMs)],
          [t('repeatedCalls'), number(metrics.repeatedCalls)], [t('usage'), number(metrics.usage)], [t('steps'), number(metrics.steps)], [t('waitingMs'), number(metrics.waitingMs)],
        ]))
      }
      function Page() {
        const [page, setPage] = React.useState(selected)
        const [data, setData] = React.useState(null as any)
        const [detail, setDetail] = React.useState(null as any)
        const [error, setError] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [refresh, setRefresh] = React.useState(0)
        const [threadCursors, setThreadCursors] = React.useState(['0'] as string[])
        const threadCursor = threadCursors[threadCursors.length - 1]
        const [confirmation, setConfirmation] = React.useState(null as any)
        const [reason, setReason] = React.useState('')
        const dialog = React.useRef(null as HTMLDialogElement | null)
        const previousFocus = React.useRef(null as HTMLElement | null)
        React.useEffect(() => {
          let disposed = false
          let timer: ReturnType<typeof setTimeout> | undefined
          const controller = new AbortController()
          let failures = 0
          setData(null); setDetail(null); setError('')
          const load = async () => {
            try {
              const value = await request(page === 'sources' ? 'health' : page, page === 'threads' ? { cursor: threadCursor } : {}, controller.signal)
              if (disposed) return
              failures = 0; setData(value); setError('')
              timer = setTimeout(load, 5000)
            } catch (e: any) {
              if (disposed || controller.signal.aborted) return
              setError(e.message || t('requestFailed'))
              if (!(e.status >= 400 && e.status < 500)) timer = setTimeout(load, Math.min(60000, 5000 * 2 ** failures++))
            }
          }
          void load()
          return () => { disposed = true; controller.abort(); clearTimeout(timer) }
        }, [page, refresh, threadCursor])
        React.useEffect(() => {
          if (confirmation && dialog.current) {
            previousFocus.current = document.activeElement as HTMLElement
            dialog.current.showModal()
            dialog.current.querySelector('textarea,button')?.focus()
          }
          return () => { if (confirmation) previousFocus.current?.focus() }
        }, [confirmation])
        const close = () => { dialog.current?.close(); setConfirmation(null); setReason('') }
        const actionNeedsReason = confirmation?.kind === 'approval' || confirmation?.action === 'stop'
        const act = async () => {
          if ((actionNeedsReason && !reason.trim()) || busy) return
          setBusy(true)
          try {
            await request(confirmation.kind === 'approval' ? 'approval' : 'ticket-action', { id: confirmation.item.id, ...(confirmation.kind === 'approval' ? { decision: confirmation.action, reason: reason.trim() } : { action: confirmation.action, ...(reason.trim() ? { reason: reason.trim() } : {}) }) })
            close(); setRefresh((n: number) => n + 1)
          } catch (e: any) { setError(e.message || t('requestFailed')) } finally { setBusy(false) }
        }
        const button = (label: string, action: () => void, disabled = false, extra: any = {}) => h('button', { type: 'button', className: 'sa-btn', onClick: action, disabled, ...extra }, label)
        const allowed = (row: any, action: string) => row?.allowed?.[action] === true || Array.isArray(row?.allowed) && row.allowed.includes(action)
        const openTicket = async (item: any) => {
          try { setDetail(await request('ticket', { id: item.id })) } catch (e: any) { setError(e.message || t('requestFailed')) }
        }
        const safeImpact = (item: any) => {
          const impact = item?.impact
          if (!impact || typeof impact !== 'object') return null
          return h('div', { className: 'sa-detail' }, h('strong', null, t('impact')), h('p', { className: 'sa-meta' }, [impact.ticketId && `${t('ticketId')}: ${impact.ticketId}`, impact.kind && `${t('kind')}: ${impact.kind}`].filter(Boolean).join(' · ')), Array.isArray(impact.targets) && impact.targets.length ? h('p', { className: 'sa-meta' }, `${t('targets')}: ${impact.targets.join(', ')}`) : null, impact.description ? h('p', null, impact.description) : null)
        }
        const ticketDetail = (detail: any) => {
          const item = detail?.ticket ?? detail ?? {}
          const assignments = detail?.assignments ?? item.assignments
          const approvals = detail?.approvals
          const timeline = detail?.timeline
          return h('div', { className: 'sa-detail' }, item.summary ? h('p', null, item.summary) : null, item.title ? h('p', { className: 'sa-meta' }, item.title) : null, item.state ? h('p', { className: 'sa-meta' }, `${t('state')}: ${item.state}`) : null, assignments ? h('p', { className: 'sa-meta' }, `${t('assignments')}: ${Array.isArray(assignments) ? assignments.map((entry: any) => typeof entry === 'string' ? entry : entry.id ?? entry.assignmentId ?? entry.state ?? '').filter(Boolean).join(', ') || '—' : assignments}`) : null, approvals ? h('p', { className: 'sa-meta' }, `${t('approvals')}: ${Array.isArray(approvals) ? approvals.map((entry: any) => typeof entry === 'string' ? entry : entry.summary ?? entry.state ?? entry.id ?? '').filter(Boolean).join(', ') || '—' : approvals}`) : null, timeline ? h('div', null, h('strong', null, t('timeline')), Array.isArray(timeline) ? h('ul', { className: 'sa-list' }, timeline.slice(0, 12).map((entry: any, index: number) => h('li', { key: entry.id ?? index }, typeof entry === 'string' ? entry : [entry.at && formatTime(entry.at), entry.action ?? entry.event ?? entry.state, entry.actor].filter(Boolean).join(' · ') || JSON.stringify(entry)))) : h('p', { className: 'sa-meta' }, String(timeline))) : null)
        }
        const approvalDetail = (item: any) => h('div', { className: 'sa-detail' }, item.summary ? h('p', null, item.summary) : null, safeImpact(item))
        const list = () => {
          const items = records(data?.items)
          if (!items?.length) return h('div', { className: 'sa-card' }, recordStatus(data?.items))
          return items.map((item: any) => h('article', { className: 'sa-card', key: item.id ?? item.key },
            h('div', { className: 'sa-row' }, h('strong', null, item.title ?? item.summary ?? item.id ?? item.key), h('span', { className: 'sa-meta' }, text(item.state))),
            h('p', { className: 'sa-meta' }, [item.kind, item.requestedBy, item.requested_by, item.id].filter(Boolean).join(' · ')),
            page === 'tickets' ? h('div', { className: 'sa-row' }, button(t('details'), () => { void openTicket(item) }), ...['stop', 'resume'].map(action => button(t(action), () => setConfirmation({ kind: 'ticket', action, item }), !allowed(item, action)))) : page === 'approvals' ? h('div', { className: 'sa-row' }, button(t('details'), () => setDetail(item)), ...['approve', 'deny'].map(action => button(t(action), () => setConfirmation({ kind: 'approval', action, item }), !allowed(item, action)))) : null,
            page === 'approvals' ? approvalDetail(item) : null))
        }
        let content: any
        if (!data) content = h('p', null, t('loading'))
        else if (['tickets', 'approvals'].includes(page)) content = h('div', null, list(), detail ? h('div', { className: 'sa-card' }, h('h2', null, t('details')), page === 'approvals' ? approvalDetail(detail) : ticketDetail(detail)) : null)
        else if (page === 'threads') {
          const items = records(data.items)
          const next = typeof data.next === 'string' && /^\d{1,9}$/.test(data.next) && data.next !== threadCursor ? data.next : null
          content = h('div', null, readonly(), h('p', { className: 'sa-meta' }, t('threadCountsHelp')), items?.length ? threadGroups(items) : h('div', { className: 'sa-card' }, recordStatus(data.items)), h('div', { className: 'sa-row sa-pager', 'aria-label': t('pagination') }, button(t('previousPage'), () => { setData(null); setThreadCursors((values: string[]) => values.slice(0, -1)) }, threadCursors.length <= 1), button(t('nextPage'), () => { if (next) { setData(null); setThreadCursors((values: string[]) => [...values, next]) } }, !next)))
        }
        else if (page === 'overview') {
          const counts = data.counts ?? {}
          const health = data.health ?? {}
          const activities = records(data.activities)
          content = h('div', null, h('div', { className: 'sa-grid' },
            h('div', { className: 'sa-card' }, h('h2', null, t('tickets')), h('div', { className: 'sa-value' }, number(counts.tickets?.open ?? counts.tickets?.total)), h('p', { className: 'sa-meta' }, `${t('open')} / ${t('total')}: ${number(counts.tickets?.open)} / ${number(counts.tickets?.total)}`)),
            h('div', { className: 'sa-card' }, h('h2', null, t('approvals')), h('div', { className: 'sa-value' }, number(counts.approvals?.pending ?? counts.approvals?.total)), h('p', { className: 'sa-meta' }, `${t('pending')} / ${t('total')}: ${number(counts.approvals?.pending)} / ${number(counts.approvals?.total)}`))),
            h('div', { className: 'sa-card' }, h('h2', null, t('activities')), activities?.length ? h('ul', { className: 'sa-list' }, activities.slice(0, 8).map((row: any, i: number) => h('li', { key: row.id ?? i }, `${text(row.action)} · ${text(row.actor)}${row.ticketId ? ` · ${row.ticketId}` : ''} · ${formatTime(row.at)}`))) : recordStatus(data.activities)),
            h('div', { className: 'sa-card' }, h('h2', null, t('health')), h('p', null, healthState(health.ok)), h('p', { className: 'sa-meta' }, `${t('sources')}: ${Array.isArray(health.sources) ? health.sources.length : '—'}`)))
        } else if (page === 'settings') {
          const entries = records(data.effective)
          content = h('div', null, readonly(), entries?.length ? entries.map((entry: any, index: number) => h('article', { className: 'sa-card', key: entry.key ?? index }, h('h2', null, text(entry.key)), fields([
            [t('value'), settingsValue(entry)], [t('origin'), t(origins[entry.origin] ?? 'unknown')], [t('originDetail'), text(entry.originDetail)],
          ]))) : h('div', { className: 'sa-card' }, recordStatus(data.effective)))
        } else if (page === 'sources') {
          const sources = records(data.sources)
          content = h('div', null, readonly(), h('p', { className: 'sa-meta' }, t('pausedReadonlyHelp')), sources?.length ? sources.map(sourceCard) : h('div', { className: 'sa-card' }, recordStatus(data.sources)))
        } else if (page === 'health') {
          const decisions = records(data.watchdog?.decisions)
          const errors = records(data.recentErrors)
          content = h('div', null, readonly(), h('div', { className: 'sa-grid' },
            h('section', { className: 'sa-card' }, h('h2', null, t('runtime')), fields([[t('health'), healthState(data.ok)], [t('runtime'), serialized(data.runtime)]])),
            h('section', { className: 'sa-card' }, h('h2', null, t('database')), fields([[t('dbVersion'), number(data.db?.version)], [t('dbSizeBytes'), number(data.db?.sizeBytes)]])),
            h('section', { className: 'sa-card' }, h('h2', null, t('outbox')), fields([[t('pending'), number(data.outbox?.pending)], [t('dropped'), number(data.outbox?.dropped)]]))),
            h('section', { className: 'sa-group' }, h('h2', null, t('watchdog')), h('p', { className: 'sa-meta' }, `${t('lastWatchdogAt')}: ${formatTime(data.watchdog?.lastAt)}`), h('p', { className: 'sa-meta' }, t('watchdogHelp')), decisions?.length ? decisions.slice(0, 20).map(decisionCard) : h('div', { className: 'sa-card' }, recordStatus(data.watchdog?.decisions))),
            h('section', { className: 'sa-group' }, h('h2', null, t('recentErrors')), errors?.length ? errors.map((item: any, index: number) => h('article', { className: 'sa-card', key: `${item.at ?? 'unknown'}:${index}` }, fields([[t('at'), formatTime(item.at)], [t('action'), text(item.action)], [t('code'), text(item.code)]]))) : h('div', { className: 'sa-card' }, recordStatus(data.recentErrors))))
        }
        return h('section', { className: 'sa-panel', 'aria-label': t('title') }, h('style', null, css), h('h1', null, t('title')), h('p', { className: 'sa-sub' }, t('subtitle')),
          h('nav', { className: 'sa-tabs', 'aria-label': t('navigation') }, ...pages.map(key => h('button', { type: 'button', key, className: 'sa-btn', 'aria-current': page === key ? 'page' : undefined, 'aria-selected': page === key, onClick: () => { if (key !== page) { setData(null); setDetail(null); setError(''); selected = key; setPage(key) }; ctx.layout?.selectPanel?.('superagent') } }, t(key)))),
          error ? h('div', { role: 'alert', className: 'sa-card sa-error' }, error, ' ', button(t('retry'), () => setRefresh((n: number) => n + 1))) : null,
          content,
          confirmation ? h('dialog', { ref: dialog, className: 'sa-dialog', 'aria-labelledby': 'sa-dialog-title', onCancel: (event: any) => { event.preventDefault(); close() } }, h('h2', { id: 'sa-dialog-title' }, t('confirm')), h('button', { type: 'button', className: 'sa-btn', 'aria-label': t('close'), onClick: close }, '×'), h('p', null, confirmation.item.summary ?? confirmation.item.title), safeImpact(confirmation.item), h('label', null, actionNeedsReason ? t('reasonRequired') : t('reasonOptional'), h('textarea', { value: reason, onChange: (e: any) => setReason(e.target.value), required: actionNeedsReason, 'aria-required': actionNeedsReason })), h('div', { className: 'sa-row' }, button(t('confirm'), () => { void act() }, busy || (actionNeedsReason && !reason.trim())), button(t('cancel'), close, busy))) : null)
      }
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'superagent', order: 100, label: () => t('title'), locale: NS }, Icon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'superagent', inject: () => ({}), locale: NS }, Page))
    },
  }
}
