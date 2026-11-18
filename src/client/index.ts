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
      const css = `.sa-panel{height:100%;overflow:auto;box-sizing:border-box;padding:calc(var(--dsh-frame-top-clearance,0px) + 24px) 24px 24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}.sa-panel h1{font-size:22px;margin:0 0 8px}.sa-panel h2{font-size:17px;margin:0 0 12px}.sa-sub{color:var(--dsw-alias-label-secondary);margin:0 0 24px}.sa-tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px;margin-bottom:20px}.sa-btn{font:inherit;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 12px}.sa-btn[aria-selected=true]{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.sa-btn:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.sa-btn:disabled{cursor:default;opacity:.5}.sa-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:16px;margin-bottom:12px}.sa-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sa-error{color:var(--dsw-alias-state-error-primary)}.sa-meta{color:var(--dsw-alias-label-secondary);font-size:13px}.sa-dialog{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;max-width:560px;width:calc(100% - 48px)}.sa-dialog textarea{box-sizing:border-box;width:100%;min-height:80px;font:inherit;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:12px 0;padding:8px}.sa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.sa-value{font-size:22px;font-weight:600}.sa-list{margin:0;padding-left:20px}.sa-detail{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}`

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
      const formatTime = (value: unknown) => typeof value === 'number' ? new Date(value).toLocaleString() : ''
      const text = (value: unknown, fallback = '—') => typeof value === 'string' && value ? value : fallback
      function Page() {
        const [page, setPage] = React.useState(selected)
        const [data, setData] = React.useState(null as any)
        const [detail, setDetail] = React.useState(null as any)
        const [error, setError] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [refresh, setRefresh] = React.useState(0)
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
              const value = await request(page === 'sources' ? 'health' : page, {}, controller.signal)
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
        }, [page, refresh])
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
          const items = data?.items ?? []
          if (!items.length) return h('div', { className: 'sa-card' }, t('empty'))
          return items.map((item: any) => h('article', { className: 'sa-card', key: item.id ?? item.key },
            h('div', { className: 'sa-row' }, h('strong', null, item.title ?? item.summary ?? item.id ?? item.key), h('span', { className: 'sa-meta' }, text(item.state))),
            h('p', { className: 'sa-meta' }, [item.kind, item.requestedBy, item.requested_by, item.id].filter(Boolean).join(' · ')),
            page === 'tickets' ? h('div', { className: 'sa-row' }, button(t('details'), () => { void openTicket(item) }), ...['stop', 'resume'].map(action => button(t(action), () => setConfirmation({ kind: 'ticket', action, item }), !allowed(item, action)))) : page === 'approvals' ? h('div', { className: 'sa-row' }, button(t('details'), () => setDetail(item)), ...['approve', 'deny'].map(action => button(t(action), () => setConfirmation({ kind: 'approval', action, item }), !allowed(item, action)))) : null,
            page === 'approvals' ? approvalDetail(item) : null))
        }
        let content: any
        if (!data) content = h('p', null, t('loading'))
        else if (['tickets', 'approvals', 'threads'].includes(page)) content = h('div', null, list(), detail ? h('div', { className: 'sa-card' }, h('h2', null, t('details')), page === 'approvals' ? approvalDetail(detail) : ticketDetail(detail)) : null)
        else if (page === 'overview') {
          const counts = data.counts ?? {}
          const health = data.health ?? {}
          const activities = Array.isArray(data.activities) ? data.activities : []
          content = h('div', null, h('div', { className: 'sa-grid' }, h('div', { className: 'sa-card' }, h('h2', null, t('tickets')), h('div', { className: 'sa-value' }, counts.tickets?.open ?? counts.tickets?.total ?? 0), h('p', { className: 'sa-meta' }, `${t('open')} / ${t('total')}: ${counts.tickets?.open ?? 0} / ${counts.tickets?.total ?? 0}`)), h('div', { className: 'sa-card' }, h('h2', null, t('approvals')), h('div', { className: 'sa-value' }, counts.approvals?.pending ?? counts.approvals?.total ?? 0), h('p', { className: 'sa-meta' }, `${t('pending')} / ${t('total')}: ${counts.approvals?.pending ?? 0} / ${counts.approvals?.total ?? 0}`))), h('div', { className: 'sa-card' }, h('h2', null, t('activities')), activities.length ? h('ul', { className: 'sa-list' }, activities.slice(0, 8).map((row: any, i: number) => h('li', { key: row.id ?? i }, `${text(row.action)} · ${text(row.actor)}${row.ticketId ? ` · ${row.ticketId}` : ''}${row.at ? ` · ${formatTime(row.at)}` : ''}`))) : h('p', { className: 'sa-meta' }, t('empty'))), h('div', { className: 'sa-card' }, h('h2', null, t('health')), h('p', null, health.ok === false ? t('unhealthy') : t('healthy')), health.sources ? h('p', { className: 'sa-meta' }, `${t('sources')}: ${Array.isArray(health.sources) ? health.sources.length : 0}`) : null))
        } else if (page === 'settings') {
          const entries = (data.effective ?? []).map((entry: any) => [entry.key, `${String(entry.value)} · ${entry.origin}`])
          content = h('div', { className: 'sa-card' },
            h('h2', null, t('settings')),
            entries.length
              ? h('dl', null, entries.map(([key, value]: [string, unknown]) => h('div', { key }, h('dt', { className: 'sa-meta' }, key), h('dd', null, typeof value === 'object' ? JSON.stringify(value) : String(value)))))
              : h('p', { className: 'sa-meta' }, t('empty'))
          )
        } else content = h('div', { className: 'sa-card' }, h('h2', null, t('readonly')), h('p', null, t('placeholder')))
        return h('section', { className: 'sa-panel', 'aria-label': t('title') }, h('style', null, css), h('h1', null, t('title')), h('p', { className: 'sa-sub' }, t('subtitle')),
          h('nav', { className: 'sa-tabs', 'aria-label': t('navigation') }, ...pages.map(key => h('button', { type: 'button', key, className: 'sa-btn', 'aria-current': page === key ? 'page' : undefined, 'aria-selected': page === key, onClick: () => { selected = key; setPage(key); ctx.layout?.selectPanel?.('superagent') } }, t(key)))),
          error ? h('div', { role: 'alert', className: 'sa-card sa-error' }, error, ' ', button(t('retry'), () => setRefresh((n: number) => n + 1))) : null,
          content,
          confirmation ? h('dialog', { ref: dialog, className: 'sa-dialog', 'aria-labelledby': 'sa-dialog-title', onCancel: (event: any) => { event.preventDefault(); close() } }, h('h2', { id: 'sa-dialog-title' }, t('confirm')), h('button', { type: 'button', className: 'sa-btn', 'aria-label': t('close'), onClick: close }, '×'), h('p', null, confirmation.item.summary ?? confirmation.item.title), safeImpact(confirmation.item), h('label', null, actionNeedsReason ? t('reasonRequired') : t('reasonOptional'), h('textarea', { value: reason, onChange: (e: any) => setReason(e.target.value), required: actionNeedsReason, 'aria-required': actionNeedsReason })), h('div', { className: 'sa-row' }, button(t('confirm'), () => { void act() }, busy || (actionNeedsReason && !reason.trim())), button(t('cancel'), close, busy))) : null)
      }
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'superagent', order: 100, label: () => t('title'), locale: NS }, Icon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'superagent', inject: () => ({}), locale: NS }, Page))
    },
  }
}
