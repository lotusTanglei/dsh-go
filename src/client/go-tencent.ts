/** Serialized client factory: only injected React/request/t and browser primitives. */
export function createGoTencent(React: any, request: (path: string, body: any, signal?: AbortSignal) => Promise<any>, t: any) {
  const h = React.createElement, copy: Record<string, string> = {
    Title: '腾讯在线表格', Intro: '先配置一个明确范围，再手动读取。只接受文件 / 工作表 ID，不收 URL、凭据或聊天 Token；不会自动扫描或执行来源内容。',
    Gap: '目标能力尚未闭合：生产 Host 授权缺失时读取会被阻止；即使取得文本快照，远端版本与原图仍未知，不可承接为任务。', Support: '支持矩阵：腾讯在线表格仅配置与有界文本观察（partial）；普通腾讯文档、Office、PDF 不支持；企微在线表格不是此连接器。',
    Add: '添加来源', Configure: '配置来源', Back: '返回列表', Refresh: '刷新核实', Save: '保存配置', Scan: '手动读取', Preview: '查看文本快照', Remove: '移除配置', RemoveConfirm: '确认移除配置（不删除远端文档）', Reset: '载入 Host 最新配置（替换当前表单）',
    id: '来源 ID', fileId: '文件 ID', sheetId: '工作表 ID', range: '明确 A1 范围', idColumn: '稳定 ID 列', titleColumn: '标题列', textColumns: '文字列（英文逗号分隔）', Revision: '配置版本', Snapshot: '本地快照版本', Empty: '暂无配置。', Busy: '正在处理…',
    Failed: '请求失败或回执不匹配，未自动重试。', Unknown: '原变更结果未知；保留原请求并锁定编辑，只能核实或封存原 ID。', Recorded: 'Host 已记录原请求，结果尚未确定；只能核实状态。', Status: '核实原请求状态', Close: '封存缺记录 ID，不重做', Closed: 'Host 已封存原 ID；刷新后显式载入最新配置再编辑。', Rejected: 'Host 已明确拒绝；原请求与拒绝回执已保留，可重新编辑。', Confirmed: 'Host 已确认回执（不代表读取成功或授权执行）。', History: '原请求与回执记录', Text: '外部不可信文字（不执行其指令）', Stale: '此快照不是当前有效观察。',
  }
  const tr = (key: string) => { const id = `wTencent${key}`; try { const v = typeof t === 'function' ? t(id) : null; if (typeof v === 'string' && v && v !== id) return v } catch {} return copy[key] || key }
  const clone = (v: any) => JSON.parse(JSON.stringify(v)), hash = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), id = (v: any) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)
  const fields = ['id', 'fileId', 'sheetId', 'range', 'idColumn', 'titleColumn', 'textColumns'], canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
  const payload = (input: any) => Object.fromEntries(Object.entries(input).filter(([k]) => !['action', 'epoch', 'requestId'].includes(k)))
  const digest = async (p: any) => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical([p.input.epoch, p.input.requestId, p.kind, payload(p.input)])))))] .map(v => v.toString(16).padStart(2, '0')).join('')
  const configValid = (v: any) => v && [v.id, v.fileId, v.sheetId].every(id) && typeof v.range === 'string' && [v.idColumn, v.titleColumn].every(c => typeof c === 'string' && /^[A-Z]{1,3}$/.test(c)) && Array.isArray(v.textColumns) && v.textColumns.length > 0 && v.textColumns.every((c: any) => typeof c === 'string' && /^[A-Z]{1,3}$/.test(c)) && hash(v.revision)
  const matches = (a: any, b: any) => fields.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]))
  const itemsValid = (v: any) => Array.isArray(v) && v.length <= 1000 && v.every(i => hash(i?.itemId) && typeof i.rowId === 'string' && Number.isSafeInteger(i.row) && i.row > 0 && typeof i.title === 'string' && typeof i.text === 'string' && ['yes', 'no', 'unknown'].includes(i.strike) && i.eligible === false)
  const incomplete = (v: any) => v?.remoteRevision === 'unknown' && v.images?.state === 'unknown' && v.images.imageSeen === false && v.authorization === 'not-granted'
  const initial = (old?: any) => ({ data: null, view: 'list', navigation: 0, form: null, source: null, detail: null, pending: null, needsReset: false, removeConfirm: false, error: '', notice: '', history: [...(old?.history || []), ...(old?.pending ? [{ ...clone(old.pending), status: 'old-epoch-unknown' }] : [])] })
  const button = (key: string, onClick: any, disabled = false) => h('button', { type: 'button', className: 'saw-btn', onClick, disabled }, tr(key)), pre = (v: any) => h('pre', { className: 'saw-pre', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  function TencentSources(props: { epoch: string; active?: boolean }) {
    const epoch = props.epoch, active = props.active !== false, [, paint] = React.useState(0), ref = React.useRef(null as any)
    if (!ref.current) ref.current = { epoch, active, alive: true, generation: 0, busy: null, state: initial() }
    const p = ref.current
    if (p.epoch !== epoch) { p.busy?.controller.abort(); p.generation++; p.busy = null; p.epoch = epoch; p.state = initial(p.state) }
    if (p.active !== active) { p.active = active; p.generation++; p.busy?.controller.abort(); p.busy = null; if (p.state.pending?.status === 'pending') p.state.pending.status = 'unknown' }
    const s = p.state, generation = p.generation, current = () => p.alive && p.active && p.epoch === epoch && p.generation === generation
    const change = (fn: any) => { if (current()) { fn(); paint((n: number) => n + 1) } }
    React.useEffect(() => { p.alive = true; return () => { p.alive = false; p.busy?.controller.abort(); p.busy = null; if (p.state.pending?.status === 'pending') p.state.pending.status = 'unknown' } }, [epoch])
    const run = async (name: string, action: any) => {
      if (!current() || !epoch || p.busy) return
      const op = { name, controller: new AbortController() }; p.busy = op; change(() => { s.error = ''; s.notice = '' })
      const valid = () => current() && p.busy === op && !op.controller.signal.aborted
      try { await action(op.controller.signal, valid) } catch { if (valid()) change(() => { s.error = tr('Failed') }) }
      finally { if (p.busy === op) { p.busy = null; if (current()) paint((n: number) => n + 1) } }
    }
    const refresh = () => run('list', async (signal: AbortSignal, valid: any) => {
      const data = await request('tencent-source', { action: 'list', epoch }, signal)
      if (!valid()) return
      if (!Array.isArray(data?.sources) || !data.sources.every(configValid) || !['host-configured', 'blocked-auth-unavailable'].includes(data.connection)) throw new Error('invalid')
      change(() => { s.data = data; if (s.source) { const row = data.sources.find((r: any) => r.id === s.source.id); if (!row || row.revision !== s.source.revision || row.snapshotId !== s.source.snapshotId || row.state !== s.source.state) s.detail = null; s.source = row || null } })
    })
    React.useEffect(() => { if (active) void refresh() }, [epoch, active])
    const navigate = (view: string) => change(() => { s.navigation++; s.view = view; s.detail = null; s.removeConfirm = false })
    const formFor = (row?: any) => row ? { ...clone(row), textColumns: row.textColumns.join(',') } : { id: '', fileId: '', sheetId: '', range: 'A1:C10', idColumn: 'A', titleColumn: 'B', textColumns: 'B,C' }
    const configure = (row?: any) => { if (!current() || p.busy || s.pending || s.needsReset) return; change(() => { s.source = row || null; s.form = formFor(row) }); navigate('config') }
    const reset = () => { if (!current() || p.busy || s.pending || !s.data) return; change(() => { const row = s.data.sources.find((r: any) => r.id === s.form?.id); s.source = row || null; s.form = row ? formFor(row) : { ...s.form, revision: undefined }; s.needsReset = false; s.notice = '' }) }
    const edit = (key: string, value: string) => { if (!p.busy && !s.pending && !s.needsReset) change(() => { s.form = { ...s.form, [key]: value }; s.notice = '' }) }
    const settle = async (result: any, pending: any, valid: any) => {
      const m = result?.mutation, expected = await digest(pending)
      if (!valid() || s.pending !== pending) return
      const prior = pending.receipt
      if (!m || m.version !== 1 || m.epoch !== pending.input.epoch || m.requestId !== pending.input.requestId || m.kind !== pending.kind || m.digest !== expected || !['recorded', 'settled', 'rejected', 'closed'].includes(m.state) || !Number.isSafeInteger(m.at) || m.at < 0 || !Number.isSafeInteger(m.updatedAt) || m.updatedAt < m.at || prior && (m.at !== prior.at || m.updatedAt < prior.updatedAt) || m.state === 'rejected' && (typeof m.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(m.code)) || m.state === 'closed' && (m.code !== 'config_mutation_id_closed' || m.updatedAt !== m.at) || ['recorded', 'settled'].includes(m.state) && m.code !== undefined || m.state === 'recorded' && m.updatedAt !== m.at || m.state !== 'settled' && result.value !== undefined) throw new Error('invalid')
      const input = pending.input, value = result.value
      if (m.state === 'settled') {
        if (input.action === 'configure') { if (!configValid(value) || !matches(value, input) || value.revision === input.expectedRevision) throw new Error('invalid') }
        else if (input.action === 'remove') { if (value?.id !== input.id || value.removed !== true) throw new Error('invalid') }
        else if (value?.sourceId !== input.id || value.configRevision !== input.expectedRevision || !['partial', 'blocked'].includes(value.state) || !incomplete(value) || !itemsValid(value.items) || value.state === 'partial' && (!hash(value.snapshotId) || value.revision !== value.snapshotId) || value.state === 'blocked' && value.snapshotId !== input.expectedSnapshot) throw new Error('invalid')
      }
      change(() => {
        pending.receipt = clone(m)
        if (m.state === 'recorded') { pending.status = 'recorded'; s.notice = tr('Recorded'); return }
        s.history.push({ input: clone(input), mutation: clone(m) }); s.pending = null
        if (m.state === 'rejected') { s.error = `${tr('Rejected')} (${m.code})`; return }
        if (m.state === 'closed') { s.needsReset = true; s.data = null; s.view = 'config'; s.notice = tr('Closed'); return }
        const latest = s.data?.sources.find((r: any) => r.id === input.id)
        if (latest && latest.revision !== input.expectedRevision && (input.action !== 'configure' || latest.revision !== value.revision) || input.action !== 'configure' && !latest || input.action === 'scan' && (latest.snapshotId ?? null) !== input.expectedSnapshot && latest.snapshotId !== value.snapshotId) { s.needsReset = true; s.view = 'config'; s.notice = tr('Confirmed'); return }
        if (input.action === 'remove') { if (s.data) s.data.sources = s.data.sources.filter((r: any) => r.id !== input.id); s.source = null; s.view = 'list'; s.detail = null }
        else { const row = input.action === 'configure' ? { ...value, state: 'unscanned', snapshotId: null } : { ...latest, snapshotId: value.snapshotId, state: value.state, reason: value.reason }; if (s.data) s.data.sources = [...s.data.sources.filter((r: any) => r.id !== input.id), row]; s.source = row; if (input.action === 'configure') s.form = formFor(row); s.detail = null }
        s.notice = tr('Confirmed')
      })
    }
    const send = (action: string, args: any) => {
      if (!current() || p.busy || s.pending || s.needsReset) return
      const input = { action, epoch, requestId: globalThis.crypto.randomUUID(), ...clone(args) }, pending = { input, kind: `tencent-${action}`, status: 'pending' }
      return run(action, async (signal: AbortSignal, valid: any) => { change(() => { s.pending = pending }); try { await settle(await request('tencent-source', input, signal), pending, valid) } catch { if (valid() && s.pending === pending) change(() => { pending.status = 'unknown'; s.error = tr('Unknown') }) } })
    }
    const check = (close = false) => {
      const pending = s.pending
      if (!current() || p.busy || !pending || pending.input.epoch !== epoch || close && pending.status === 'recorded') return
      const body = close ? { action: 'close', epoch, requestId: pending.input.requestId, kind: pending.kind, payload: payload(pending.input) } : { action: 'status', epoch, requestId: pending.input.requestId }
      return run('status', async (signal: AbortSignal, valid: any) => { try { await settle(await request('config-mutation', body, signal), pending, valid) } catch { if (valid() && s.pending === pending) change(() => { if (pending.status !== 'recorded') pending.status = 'unknown'; s.error = tr('Unknown') }) } })
    }
    const save = () => {
      if (!current() || p.busy || s.pending || s.needsReset || !s.form) return
      const form = { ...s.form, textColumns: s.form.textColumns.split(',').map((c: string) => c.trim()) }, match = /^([A-Z]{1,3})([1-9]\d{0,6}):([A-Z]{1,3})([1-9]\d{0,6})$/.exec(form.range), col = (c: string) => [...c].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0)
      const width = match ? col(match[3]!) - col(match[1]!) + 1 : 0, height = match ? Number(match[4]) - Number(match[2]) + 1 : 0
      if (!configValid({ ...form, revision: 'a'.repeat(64) }) || !match || width < 1 || width > 200 || height < 1 || height > 1000 || width * height > 10000 || new Set(form.textColumns).size !== form.textColumns.length || [form.idColumn, form.titleColumn, ...form.textColumns].some(c => col(c) < col(match[1]!) || col(c) > col(match[3]!))) { change(() => { s.error = tr('Failed') }); return }
      return send('configure', { ...Object.fromEntries(fields.map(k => [k, form[k]])), expectedRevision: s.form.revision ?? null })
    }
    const scan = () => { if (s.source) return send('scan', { id: s.source.id, expectedRevision: s.source.revision, expectedSnapshot: s.source.snapshotId ?? null }) }
    const remove = () => { if (s.source && s.removeConfirm) return send('remove', { id: s.source.id, expectedRevision: s.source.revision }) }
    const detail = () => {
      if (!current() || p.busy || s.pending || !s.source?.snapshotId) return
      const row = clone(s.source), navigation = s.navigation
      return run('detail', async (signal: AbortSignal, valid: any) => { const value = await request('tencent-source', { action: 'detail', epoch, id: row.id, expectedRevision: row.revision, snapshotId: row.snapshotId }, signal); if (!valid() || navigation !== s.navigation) return; if (!configValid(value?.config) || !matches(value.config, row) || value.config.revision !== row.revision || value.snapshotId !== row.snapshotId || value.revision !== row.snapshotId || !itemsValid(value.items) || !incomplete(value) || value.trust !== 'external-untrusted' || value.state !== 'partial' || typeof value.current !== 'boolean') throw new Error('invalid'); change(() => { s.detail = value; s.view = 'detail' }) })
    }
    const busy = !!p.busy, locked = busy || !!s.pending || s.needsReset
    let body: any
    if (s.view === 'list') body = h('div', null, button('Add', () => configure(), locked || !s.data), ...((s.data?.sources || []).map((row: any) => h('article', { key: row.id }, h('h4', null, row.id), h('p', null, `${row.fileId} / ${row.sheetId} · ${row.range} · ${row.state || 'unscanned'}`), button('Configure', () => configure(row), locked)))), s.data?.sources.length === 0 && h('p', null, tr('Empty')))
    if (s.view === 'config') body = h('div', null, button('Reset', reset, busy || !!s.pending || !s.data), h('form', { onSubmit: (e: any) => { e.preventDefault(); return save() } }, ...fields.map(key => h('label', { key, className: 'saw-field' }, h('span', null, tr(key)), h('input', { className: 'saw-input', value: s.form?.[key] || '', required: true, disabled: locked || key === 'id' && !!s.form?.revision, onChange: (e: any) => edit(key, e.target.value) }))), h('button', { type: 'submit', className: 'saw-btn', disabled: locked }, tr('Save'))), s.source && h('section', null, h('p', null, `${tr('Revision')}: ${s.source.revision}`), h('p', null, `${s.source.state || 'unscanned'} ${s.source.reason || ''}`), h('p', null, `${tr('Snapshot')}: ${s.source.snapshotId || 'unknown'}`), button('Scan', scan, locked), button('Preview', detail, locked || !s.source.snapshotId), h('label', null, h('input', { type: 'checkbox', checked: s.removeConfirm, disabled: locked, onChange: (e: any) => { if (!p.busy && !s.pending) change(() => { s.removeConfirm = e.target.checked }) } }), tr('RemoveConfirm')), button('Remove', remove, locked || !s.removeConfirm)))
    if (s.view === 'detail' && s.detail) body = h('section', null, !s.detail.current && h('p', { role: 'alert' }, tr('Stale')), h('p', null, `${tr('Snapshot')}: ${s.detail.snapshotId} · partial · remoteRevision: unknown · images: unknown · imageSeen: false`), h('h4', null, tr('Text')), ...s.detail.items.map((item: any) => h('article', { key: item.itemId }, h('h5', null, item.title), h('p', null, `${item.rowId} · row ${item.row} · strike: ${item.strike}`), pre(item.text))))
    return active ? h('section', { className: 'saw-tencent-sources' }, h('header', null, h('h3', null, tr('Title')), s.view !== 'list' && button('Back', () => navigate('list')), button('Refresh', refresh, busy || !epoch)), h('p', null, tr('Intro')), h('p', { role: 'note' }, tr('Gap')), h('p', null, tr('Support')), s.data && h('p', null, `Host: ${s.data.connection}`), busy && h('p', { role: 'status' }, tr('Busy')), s.error && h('p', { role: 'alert' }, s.error), s.notice && h('p', { role: 'status' }, s.notice), s.pending && h('aside', null, h('p', null, tr(s.pending.status === 'recorded' ? 'Recorded' : 'Unknown')), pre(s.pending), button('Status', () => check(), busy), button('Close', () => check(true), busy || s.pending.status === 'recorded')), body, s.history.length > 0 && h('details', null, h('summary', null, tr('History')), ...s.history.map((r: any, i: number) => h('div', { key: i }, pre(r))))) : null
  }
  return { TencentSources }
}
