/** Serialized into the client factory: no imports or module-scope runtime dependencies. */
export function createGoSettings(React: any, request: (path: string, body: any, signal?: AbortSignal) => Promise<any>, t: any) {
  const h = React.createElement
  const copy: Record<string, string> = {
    LocalTitle: '本地来源', LocalIntro: '只读取 Host 已授权目录中的一个明确文件。先保存配置，再手动扫描和审阅；不会自动执行来源内容。',
    Refresh: '刷新核实', Add: '添加来源', Back: '返回列表', Configure: '配置来源', Root: '授权目录', NoRoots: '尚无授权目录。请先由 Host 管理员授权；这里不能输入任意绝对路径。',
    Id: '来源 ID', Path: '目录内相对文件路径', Kind: '文件类型', IdColumn: 'CSV 稳定 ID 列名（必填）', Save: '保存配置', Saved: 'Host 已确认保存', Scan: '手动扫描', Preview: '查看快照', Remove: '移除配置', RemoveConfirm: '确认移除配置（不删除原文件）',
    Support: '支持范围', Supported: '支持', Unsupported: '不支持 / 已阻止', SupportBody: '支持 Markdown、TXT、CSV（必须指定唯一且非空的 ID 列）。Office、PDF、腾讯普通文档 / 表格不支持；企微文档不由此入口处理。Markdown 只预览授权目录内校验通过的 PNG / JPEG / GIF / WebP 原图。',
    Empty: '暂无配置。', Revision: '配置版本', Snapshot: '快照版本', State: '状态', Ready: '可审阅', Blocked: '已阻止', Unscanned: '未扫描', Unknown: '未知', Loading: '正在处理，请稍候…', Failed: '请求失败，请刷新核实；未自动重试。', Invalid: 'Host 回执缺失或不匹配，不能视为成功。',
    MutationStatus: '核实原请求状态', MutationClose: '封存缺记录 ID，不重做', MutationClosed: 'Host 已永久封存原 ID；请刷新并显式载入最新配置后再编辑。', MutationRejected: 'Host 已明确拒绝，原请求与拒绝证据已保留；未视为保存成功。', MutationRecorded: 'Host 已记录原请求，结果尚未确定；保持锁定，只能核实状态。', MutationHistory: '配置变更回执记录', UnknownMutation: '上次变更结果未知。原请求已保留，禁止改写或重新提交；请核实原请求状态。', Confirmed: '已核实', Detail: '快照审阅', Raw: '原文（外部不可信材料，仅纯文本展示）', Item: '选择条目', Images: '原图', OpenImage: '读取并预览原图', ImageUnseen: '尚未成功显示原图', ImageLoaded: '原图已在本机显示（不代表模型已看图）', ImageBlocked: '原图无法显示，不能确认已审阅', ImageFailed: '原图校验或显示失败', Reviewed: '我已审阅所选原文和已显示原图，仅承接为独立草稿', Claim: '承接为独立草稿', RetryClaim: '用原 requestId 核实承接', ClaimUnknown: '承接结果未知。不会自动重发或换新 ID；仅可显式使用原请求核实。', Draft: '独立草稿', DraftText: '草稿文字', Origin: '原始来源', ResetForm: '载入 Host 最新配置（替换当前表单）', Drafts: '保留的独立草稿', DraftOnly: '仅本地独立草稿材料；未授权执行、未写入主输入框、未发送。切换页面不会覆盖其他草稿。', OldEpoch: '旧工作区草稿，只读保留；不能复用旧授权。', NoItems: '快照没有可选条目。', Stale: '快照已失效或被阻止，请返回后重新扫描。',
    PlanDraft: '带出处交给 Go（只生成待审阅计划）', PlanDraftImagesBlocked: '含图计划桥尚未支持，不省图', PlanDraftOccupied: '主对话已有草稿或已切页，原稿保留', PlanDraftReady: '已填入主对话待审阅计划草稿，未发送、未授权执行；独立原稿保留。', PlanDraftUnavailable: '主对话尚未提供待审阅计划入口；独立原稿保留。', PlanDraftInvalid: '出处回执缺失或不匹配，未填稿；原稿保留，可手动重试。', PlanDraftFailed: '出处读取失败，未填稿；原稿保留，可手动重试。', PlanDraftIntro: '承接时仅保留独立草稿，未授权执行、未写入主输入框、未发送。只有显式交给 Go 并被接收后才填入待审阅计划草稿，仍须人工审阅后发送；原稿始终保留。',
    ModelsTitle: '阶段模型', ModelsIntro: '这里只配置未来阶段的模型路由，不进行真实模型调用或测试。既有会话保留原模型，不支持覆盖既有会话。', Default: '默认路由', Provider: '外发服务商', Model: '模型', Effort: '推理强度', EffortDefault: '采用模型默认值', Inherit: '继承默认路由', Override: '单阶段覆盖', Effective: 'Host 当前有效路由', Unsaved: '编辑值尚未保存，不是当前生效路由。', Version: 'Host 配置版本', Capabilities: '能力证据', Vision: '图像', Tools: '工具', Structured: '结构化输出', Context: '上下文上限', Known: '已知支持', NotSupported: '已知不支持', SaveModels: '保存阶段模型配置', NoCatalog: 'Host 未提供可选模型目录，无法保存新配置。', NoConfig: '尚未配置默认模型。', InspectPending: '正在核实所选模型的推理强度，完成前不能保存。', InspectFailed: '所选模型元数据核实失败，请刷新重查；未运行模型。', Locate: '定位', Understand: '理解', Plan: '计划', Execute: '执行', Summarize: '总结', Verify: '验收',
  }
  const tr = (key: string): string => { const id = `wGo${key}`; try { const value = typeof t === 'function' ? t(id) : null; if (typeof value === 'string' && value && value !== id) return value } catch {} return copy[key] || key }
  const array = (v: any): any[] => Array.isArray(v) ? v : []
  const hash = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  const token = (v: any) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)
  const clone = (v: any) => JSON.parse(JSON.stringify(v))
  const button = (key: string, click: any, disabled = false, props: any = {}) => h('button', { type: 'button', className: 'saw-btn', onClick: click, disabled, ...props }, tr(key))
  const pre = (v: any) => h('pre', { className: 'saw-pre', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  const field = (label: string, control: any) => h('label', { className: 'saw-field' }, h('span', null, tr(label)), control)
  const status = (v: string) => tr(v === 'ready' ? 'Ready' : v === 'blocked' ? 'Blocked' : v === 'unscanned' ? 'Unscanned' : 'Unknown')
  const mint = () => globalThis.crypto.randomUUID()
  // Ref-owned operation identity fences synchronous double clicks, stale handlers and late replies.
  function usePanel(epoch: string, initial: (prior?: any) => any, active: boolean) {
    const [, repaint] = React.useState(0)
    const ref = React.useRef(null as any)
    if (!ref.current) ref.current = { epoch, active, generation: 0, alive: true, busy: null, state: initial(), urls: new Set<string>() }
    const p = ref.current
    if (p.epoch !== epoch) {
      p.busy?.controller.abort(); for (const url of p.urls) URL.revokeObjectURL(url); p.urls.clear()
      p.epoch = epoch; p.generation++; p.busy = null; p.state = initial(p.state)
    }
    if (p.active !== active) {
      p.active = active; p.generation++; p.busy?.controller.abort(); p.busy = null
      if (!active) { for (const url of p.urls) URL.revokeObjectURL(url); p.urls.clear(); p.state.images = {}; p.state.reviewed = false; if (p.state.pending?.status === 'pending') p.state.pending.status = 'unknown'; for (const claim of Object.values(p.state.claims || {}) as any[]) if (claim.status === 'pending') claim.status = 'unknown' }
    }
    const generation = p.generation
    const current = () => p.alive && p.active && p.epoch === epoch && p.generation === generation
    const change = (update: any) => { if (current()) { update(p.state); repaint((v: number) => v + 1) } }
    React.useEffect(() => { p.alive = true; return () => { p.alive = false; p.busy?.controller.abort(); p.busy = null; for (const url of p.urls) URL.revokeObjectURL(url); p.urls.clear() } }, [epoch])
    const run = async (name: string, action: (signal: AbortSignal, valid: () => boolean) => Promise<void>) => {
      if (!current() || !epoch || p.busy) return
      const op = { name, controller: new AbortController() }; p.busy = op; change((s: any) => { s.error = ''; s.notice = '' })
      const valid = () => current() && p.busy === op && !op.controller.signal.aborted
      try { await action(op.controller.signal, valid) } catch { if (valid()) change((s: any) => { s.error = tr('Failed') }) }
      finally { if (p.busy === op) { p.busy = null; if (current()) repaint((v: number) => v + 1) } }
    }
    return { p, s: p.state, change, run, current }
  }
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
  const mutationPayload = (input: any) => Object.fromEntries(Object.entries(input).filter(([key]) => !['action', 'epoch', 'requestId'].includes(key)))
  const mutationDigest = async (pending: any) => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical([pending.input.epoch, pending.input.requestId, pending.kind, mutationPayload(pending.input)])))))] .map(v => v.toString(16).padStart(2, '0')).join('')
  function useMutation(panel: any, epoch: string, apply: (value: any, input: any) => void) {
    const { p, s, change, run, current } = panel
    const settle = async (result: any, pending: any, valid: () => boolean) => {
      const m = result?.mutation, digest = await mutationDigest(pending)
      if (!valid() || s.pending !== pending) return
      const prior = pending.receipt
      const only = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k))
      if (!only(result, ['mutation', 'value']) || !only(m, ['version', 'epoch', 'requestId', 'kind', 'digest', 'state', 'at', 'updatedAt', 'code']) || m.version !== 1 || m.epoch !== pending.input.epoch || m.requestId !== pending.input.requestId || m.kind !== pending.kind || m.digest !== digest || !['recorded', 'settled', 'rejected', 'closed'].includes(m.state) || !Number.isSafeInteger(m.at) || m.at < 0 || !Number.isSafeInteger(m.updatedAt) || m.updatedAt < m.at || prior && (m.at !== prior.at || m.updatedAt < prior.updatedAt || prior.state === 'recorded' && m.state === 'closed')) throw new Error('invalid')
      if (m.state === 'settled' ? !Object.hasOwn(result, 'value') || Object.hasOwn(m, 'code') : Object.hasOwn(result, 'value') || (m.state === 'recorded' ? m.updatedAt !== m.at || Object.hasOwn(m, 'code') : m.state === 'closed' ? m.updatedAt !== m.at || m.code !== 'config_mutation_id_closed' : typeof m.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(m.code))) throw new Error('invalid')
      if (m.state === 'settled') apply(result.value, pending.input)
      change(() => {
        pending.receipt = clone(m)
        if (m.state === 'recorded') { pending.status = 'recorded'; s.notice = tr('MutationRecorded'); return }
        s.history = [...s.history, { input: clone(pending.input), mutation: clone(m) }]; s.pending = null
        if (m.state === 'rejected') { s.error = `${tr('MutationRejected')} (${m.code})`; s.notice = '' }
        else if (m.state === 'closed') { s.needsReset = true; s.notice = tr('MutationClosed') }
        else s.notice = tr('Saved')
      })
    }
    const send = (path: string, kind: string, raw: any) => {
      if (!current() || p.busy || s.pending || s.needsReset) return
      const input = { ...clone(raw), requestId: mint() }, pending = { input, kind, status: 'pending' }
      return run(kind, async (signal: AbortSignal, valid: () => boolean) => {
        change(() => { s.pending = pending })
        try { const result = await request(path, input, signal); await settle(result, pending, valid) }
        catch { if (valid() && s.pending === pending) change(() => { pending.status = 'unknown'; s.error = tr('UnknownMutation') }) }
      })
    }
    const check = (close = false) => {
      const pending = s.pending
      if (!current() || p.busy || !pending || pending.input.epoch !== epoch || close && pending.status === 'recorded') return
      const body = close ? { action: 'close', epoch, requestId: pending.input.requestId, kind: pending.kind, payload: mutationPayload(pending.input) } : { action: 'status', epoch, requestId: pending.input.requestId }
      return run('mutation-status', async (signal: AbortSignal, valid: () => boolean) => {
        try { const result = await request('config-mutation', body, signal); await settle(result, pending, valid) }
        catch { if (valid() && s.pending === pending) change(() => { if (pending.status !== 'recorded') pending.status = 'unknown'; s.error = tr('UnknownMutation') }) }
      })
    }
    const view = () => h('div', null, s.pending && h('aside', { role: 'status' }, tr(s.pending.status === 'recorded' ? 'MutationRecorded' : s.pending.status === 'unknown' ? 'UnknownMutation' : 'Loading'), pre(s.pending), button('MutationStatus', () => check(), !!p.busy), button('MutationClose', () => check(true), !!p.busy || s.pending.status === 'recorded')), s.history.length > 0 && h('details', null, h('summary', null, tr('MutationHistory')), ...s.history.map((row: any, index: number) => h('div', { key: `${index}:${row.input?.requestId}` }, pre(row)))))
    return { send, check, view }
  }
  const validSource = (v: any) => v && token(v.id) && token(v.rootId) && typeof v.relativePath === 'string' && ['md', 'txt', 'csv'].includes(v.kind) && hash(v.revision) && (v.kind !== 'csv' || typeof v.csv?.idColumn === 'string')
  const matchesSource = (row: any, input: any) => validSource(row) && ['id', 'rootId', 'relativePath', 'kind'].every(k => row[k] === input[k]) && (input.kind !== 'csv' || row.csv?.idColumn === input.csv?.idColumn)
  const sourceInitial = (old?: any) => ({ data: null, view: 'list', navigation: 0, form: null, source: null, detail: null, selected: '', reviewed: false, images: {}, pending: null, needsReset: false, history: [...(old?.history || []), ...(old?.pending ? [{ input: clone(old.pending.input), status: 'old-epoch-unknown' }] : [])], error: '', notice: '', draftId: '', drafts: old?.drafts || [], claims: old?.claims || {} })

  type LocalDocumentOrigin = { kind: 'local-document'; itemKey: string; revision: string; evidenceDigest: string; configVersion: string }
  function LocalSources(props: { epoch: string; located?: any; active?: boolean; onPlanDraft?: (value: { epoch: string; draftId: string; documentOrigin: LocalDocumentOrigin }) => boolean }) {
    const epoch = props.epoch, active = props.active !== false, panel = usePanel(epoch, sourceInitial, active), { p, s, change, run, current } = panel
    const planCallback = React.useRef(props.onPlanDraft)
    planCallback.current = props.onPlanDraft
    const heading = React.useRef(null as any)
    React.useEffect(() => { if (active) heading.current?.focus() }, [active, s.view, s.draftId])
    const revokeImages = () => { for (const url of p.urls) URL.revokeObjectURL(url); p.urls.clear(); s.images = {}; s.reviewed = false }
    const navigate = (view: string) => change(() => { if (view !== 'detail') revokeImages(); s.navigation++; s.view = view; s.error = ''; s.notice = ''; s.removeConfirm = false })
    const refresh = () => run('list', async (signal, valid) => {
      const data = await request('local-sources', { action: 'list', epoch }, signal)
      if (!valid()) return
      if (!Array.isArray(data?.roots) || !data.roots.every((r: any) => token(r.id) && typeof r.name === 'string') || !Array.isArray(data.sources) || !data.sources.every(validSource)) throw new Error('invalid')
      change(() => {
        s.data = data
        if (s.source) { const row = data.sources.find((r: any) => r.id === s.source.id); if (!row || row.revision !== s.source.revision || row.snapshotId !== s.source.snapshotId || row.state !== s.source.state) { s.detail = null; s.selected = ''; revokeImages() }; s.source = row || null }
      })
    })
    React.useEffect(() => { if (active) void refresh() }, [epoch, active])
    const configure = (source?: any) => {
      if (p.busy || !current() || s.pending) return
      change(() => { s.source = source || null; s.form = source ? clone(source) : { id: '', rootId: s.data?.roots[0]?.id || '', relativePath: '', kind: 'md', csv: { idColumn: '' } }; s.detail = null }); navigate('config')
    }
    const edit = (key: string, value: string) => { if (p.busy || s.pending) return; change(() => { s.form = { ...s.form, [key]: value }; s.notice = '' }) }
    const mutation = useMutation(panel, epoch, (value, input) => {
      const latest = s.data?.sources.find((row: any) => row.id === input.id)
      const retainLatest = () => change(() => { s.needsReset = true; s.detail = null; s.selected = ''; revokeImages() })
      if (input.action === 'configure') {
        if (!matchesSource(value, input) || value.revision === input.expectedRevision) throw new Error('invalid')
        if (latest ? latest.revision !== input.expectedRevision && latest.revision !== value.revision : input.expectedRevision !== null) { retainLatest(); return }
        change(() => { const row = latest?.revision === value.revision ? latest : value; s.source = row; s.form = clone(row); s.data.sources = [...s.data.sources.filter((r: any) => r.id !== value.id), row]; s.detail = null; revokeImages() })
      } else if (input.action === 'remove') {
        if (value?.removed !== true || value.id !== input.id || value.revision !== input.expectedRevision) throw new Error('invalid')
        if (latest && latest.revision !== input.expectedRevision) { retainLatest(); return }
        change(() => { s.data.sources = s.data.sources.filter((r: any) => r.id !== input.id); s.source = null }); navigate('list')
      } else {
        if (value?.sourceId !== input.id || value.configRevision !== input.expectedRevision || !hash(value.snapshotId) || value.revision !== value.snapshotId || !['ready', 'blocked'].includes(value.state)) throw new Error('invalid')
        if (!latest || latest.revision !== input.expectedRevision || (latest.snapshotId ?? null) !== input.expectedSnapshot && latest.snapshotId !== value.snapshotId) { retainLatest(); return }
        change(() => { const row = s.data.sources.find((r: any) => r.id === input.id); if (row?.revision === input.expectedRevision) { s.source = { ...row, snapshotId: value.snapshotId, state: value.state, reason: value.reason }; s.data.sources = s.data.sources.map((r: any) => r.id === input.id ? s.source : r) } })
      }
    })
    const save = () => {
      if (!current() || p.busy || s.pending || s.needsReset || !s.form || !s.data?.roots.some((r: any) => r.id === s.form.rootId)) return
      const f = s.form
      if (!token(f.id) || !f.relativePath || !['md', 'txt', 'csv'].includes(f.kind) || f.kind === 'csv' && !f.csv?.idColumn?.trim()) { change(() => { s.error = tr('Invalid') }); return }
      return mutation.send('local-sources', 'local-configure', { action: 'configure', epoch, id: f.id, rootId: f.rootId, relativePath: f.relativePath, kind: f.kind, ...(f.kind === 'csv' ? { csv: { idColumn: f.csv.idColumn } } : {}), expectedRevision: s.form.revision ?? null })
    }
    const remove = () => { if (!s.source || !s.removeConfirm) return; return mutation.send('local-sources', 'local-remove', { action: 'remove', epoch, id: s.source.id, expectedRevision: s.source.revision }) }
    const scan = () => {
      if (!current() || p.busy || s.pending || s.needsReset || !s.source) return
      revokeImages(); change(() => { s.detail = null; s.selected = '' })
      return mutation.send('local-sources', 'local-scan', { action: 'scan', epoch, id: s.source.id, expectedRevision: s.source.revision, expectedSnapshot: s.source.snapshotId ?? null })
    }
    const resetSourceForm = () => {
      if (!current() || p.busy || s.pending || !s.data) return
      change(() => { const row = s.data.sources.find((r: any) => r.id === s.form?.id); s.source = row || null; s.form = row ? clone(row) : { ...(s.form || {}), revision: undefined }; s.needsReset = false; s.error = ''; s.notice = '' })
    }
    const detail = () => {
      if (!current() || p.busy || s.pending || !s.source?.snapshotId) return
      const row = s.source, navigation = s.navigation
      return run('detail', async (signal, valid) => {
        const result = await request('local-sources', { action: 'detail', epoch, id: row.id, expectedRevision: row.revision, snapshotId: row.snapshotId }, signal)
        if (!valid() || s.navigation !== navigation) return
        if (result?.kind !== 'snapshot' || result.sourceId !== row.id || result.snapshotId !== row.snapshotId || result.revision !== row.snapshotId || !matchesSource(result.config, row) || result.config.revision !== row.revision || typeof result.text !== 'string' || !Array.isArray(result.items) || !result.items.every((i: any) => hash(i.itemId) && typeof i.text === 'string') || !Array.isArray(result.images) || result.trust !== 'external-untrusted' || result.authorization !== 'not-granted') throw new Error('invalid')
        change(() => { revokeImages(); s.detail = result; s.selected = ''; s.view = 'detail' })
      })
    }
    const openImage = (image: any) => {
      if (!current() || p.busy || !s.detail || image.state !== 'available' || !hash(image.digest)) return
      const d = s.detail, row = s.source
      return run('image', async (signal, valid) => {
        try {
          const result = await request('local-sources', { action: 'detail', epoch, id: row.id, expectedRevision: row.revision, snapshotId: d.snapshotId, imageDigest: image.digest }, signal)
          if (!valid() || s.detail !== d || s.view !== 'detail') return
          if (result?.kind !== 'image' || result.digest !== image.digest || result.mediaType !== image.mediaType || result.imageSeen !== false || typeof result.encoded !== 'string' || result.encoded.length > 7 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.encoded)) throw new Error('invalid')
          const raw = atob(result.encoded), bytes = Uint8Array.from(raw, c => c.charCodeAt(0)), ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b))
          const media = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && ascii(12, 16) === 'IHDR' ? 'image/png' : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217 ? 'image/jpeg' : bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) ? 'image/gif' : bytes.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp' : ''
          if (!media || media !== result.mediaType || bytes.length > 5 * 1024 * 1024 || bytes.length !== image.size) throw new Error('invalid')
          const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
          if (!valid() || s.detail !== d || s.view !== 'detail') return
          if (digest !== result.digest) throw new Error('invalid')
          const url = URL.createObjectURL(new Blob([bytes], { type: media })); p.urls.add(url)
          change(() => { const previous = s.images[image.digest]; if (previous?.url) { URL.revokeObjectURL(previous.url); p.urls.delete(previous.url) }; s.images = { ...s.images, [image.digest]: { url, loaded: false } }; s.reviewed = false })
        } catch { if (valid() && s.detail === d) change(() => { s.error = tr('ImageFailed'); s.reviewed = false }) }
      })
    }
    const imageReady = () => s.detail && s.detail.images.every((i: any) => i.state === 'available' && s.images[i.digest]?.loaded === true)
    const bindingKey = () => s.detail && `${epoch}:${s.detail.sourceId}:${s.selected}`
    const claim = (retry = false) => {
      if (!current() || p.busy || s.pending || !s.detail?.current || !s.selected || !s.reviewed || !imageReady()) return
      const key = bindingKey(), prior = s.claims[key], d = s.detail, navigation = s.navigation, item = d.items.find((i: any) => i.itemId === s.selected)
      if (!item || prior && (!retry || prior.status !== 'unknown' || prior.input.snapshotId !== d.snapshotId || prior.input.expectedRevision !== d.config.revision) || retry && !prior || prior?.input.epoch !== undefined && prior.input.epoch !== epoch) return
      const input = prior?.input || { action: 'claim', epoch, id: d.sourceId, expectedRevision: d.config.revision, snapshotId: d.snapshotId, itemId: item.itemId, requestId: mint(), humanReview: 'reviewed-for-draft' }
      return run('claim', async (signal, valid) => {
        change(() => { s.claims[key] = { input, status: 'pending' } })
        try {
          const result = await request('local-sources', input, signal)
          if (!valid()) return
          const o = result?.origin
          if (typeof result?.draftId !== 'string' || !result.draftId.startsWith('local-draft:') || result.requestId !== input.requestId || result.text !== item.text || o?.kind !== 'local' || o.sourceId !== input.id || o.itemId !== input.itemId || o.snapshotId !== input.snapshotId || o.revision !== input.snapshotId || o.configRevision !== input.expectedRevision || result.trust !== 'external-untrusted' || result.authorization !== 'not-granted' || result.humanReview !== 'reviewed-for-draft' || !Array.isArray(result.images) || JSON.stringify(result.images) !== JSON.stringify(d.images)) throw new Error('invalid')
          change(() => { s.claims[key] = { input, status: 'claimed', receipt: result }; if (!s.drafts.some((v: any) => v.receipt.draftId === result.draftId)) s.drafts.push({ epoch, receipt: result }); if (s.navigation === navigation && s.view === 'detail') { s.draftId = result.draftId; s.view = 'draft'; revokeImages() } })
        } catch { if (valid()) change(() => { s.claims[key] = { input, status: 'unknown' }; s.error = tr('ClaimUnknown') }) }
      })
    }
    const planClaim = (draft: any) => {
      const receipt = draft?.receipt, origin = receipt?.origin
      if (!draft || draft.epoch !== epoch || !/^local-draft:[a-f0-9]{64}$/.test(receipt?.draftId) || !token(receipt.requestId) || origin?.kind !== 'local' || !token(origin.sourceId) || !hash(origin.itemId) || !hash(origin.snapshotId) || origin.revision !== origin.snapshotId || !hash(origin.configRevision) || receipt.trust !== 'external-untrusted' || receipt.authorization !== 'not-granted' || receipt.humanReview !== 'reviewed-for-draft' || !Array.isArray(receipt.images) || receipt.images.length !== 0) return null
      return (Object.values(s.claims) as any[]).find(claim => claim.status === 'claimed' && claim.receipt === receipt && claim.input.action === 'claim' && claim.input.epoch === epoch && claim.input.requestId === receipt.requestId && claim.input.id === origin.sourceId && claim.input.itemId === origin.itemId && claim.input.snapshotId === origin.snapshotId && claim.input.expectedRevision === origin.configRevision) || null
    }
    const planDraft = (draft: any, navigation: number) => {
      const draftId = draft?.receipt.draftId, claim = planClaim(draft)
      if (!current() || p.busy || s.view !== 'draft' || s.navigation !== navigation || s.draftId !== draftId || !s.drafts.includes(draft) || !claim || typeof planCallback.current !== 'function') return
      const receipt = draft.receipt, origin = receipt.origin
      const input = { action: 'plan-origin', epoch, id: origin.sourceId, expectedRevision: origin.configRevision, snapshotId: origin.snapshotId, itemId: origin.itemId, requestId: receipt.requestId }
      return run('plan-origin', async (signal, valid) => {
        const live = () => valid() && s.navigation === navigation && s.view === 'draft' && s.draftId === draftId && s.drafts.includes(draft) && draft.receipt === receipt && receipt.draftId === draftId && receipt.requestId === input.requestId && origin.sourceId === input.id && origin.configRevision === input.expectedRevision && origin.snapshotId === input.snapshotId && origin.itemId === input.itemId && planClaim(draft) === claim && typeof planCallback.current === 'function'
        try {
          const result = await request('local-sources', input, signal)
          if (!live()) return
          const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['local-plan-origin-v1', epoch, receipt.draftId, receipt.requestId, origin.sourceId, origin.itemId, origin.snapshotId, origin.configRevision]))))].map(v => v.toString(16).padStart(2, '0')).join('')
          if (!live()) return
          const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
          const o = result?.documentOrigin
          if (!exact(result, ['documentOrigin', 'draftId', 'trust', 'authorization', 'planningOnly']) || !exact(o, ['kind', 'itemKey', 'revision', 'evidenceDigest', 'configVersion']) || result.draftId !== receipt.draftId || result.trust !== 'external-untrusted' || result.authorization !== 'not-granted' || result.planningOnly !== true || o.kind !== 'local-document' || o.itemKey !== origin.itemId || o.revision !== origin.snapshotId || o.configVersion !== origin.configRevision || o.evidenceDigest !== digest) { change(() => { s.error = tr('PlanDraftInvalid') }); return }
          const accepted = planCallback.current!({ epoch, draftId, documentOrigin: clone(o) }) === true
          if (live()) change(() => { if (accepted) s.notice = tr('PlanDraftReady'); else s.error = tr('PlanDraftOccupied') })
        } catch { if (live()) change(() => { s.error = tr('PlanDraftFailed') }) }
      })
    }
    const busy = !!p.busy, locked = busy || !!s.pending || s.needsReset
    const header = h('header', { className: 'saw-heading' }, h('h3', { ref: heading, tabIndex: -1 }, tr(s.view === 'list' ? 'LocalTitle' : s.view === 'config' ? 'Configure' : s.view === 'detail' ? 'Detail' : 'Draft')), h('div', { className: 'saw-actions' }, s.view !== 'list' && button('Back', () => navigate('list')), button('Refresh', refresh, busy || !epoch)))
    let body: any
    if (s.view === 'list') body = h('div', null, h('p', null, tr('LocalIntro')), !s.data?.roots.length && h('p', { role: 'note' }, tr('NoRoots')), button('Add', () => configure(), locked || !s.data?.roots.length), h('ul', { className: 'saw-list' }, ...array(s.data?.sources).map(row => h('li', { key: row.id }, h('strong', null, row.id), h('p', null, `${row.relativePath} · ${status(row.state)}`), button('Configure', () => configure(row), locked)))), s.data && !s.data.sources.length && h('p', null, tr('Empty')), h('details', null, h('summary', null, tr('Support')), h('p', null, tr('SupportBody')), ...array(s.data?.support).map(row => h('p', { key: row.kind }, `${row.kind}: ${tr(row.state === 'supported' ? 'Supported' : 'Unsupported')}`))), s.drafts.length > 0 && h('section', null, h('h4', null, tr('Drafts')), ...s.drafts.map((v: any) => button('Draft', () => change(() => { s.navigation++; s.draftId = v.receipt.draftId; s.view = 'draft' }), false, { key: v.receipt.draftId, 'aria-label': `${tr('Draft')} ${v.receipt.origin.sourceId} ${v.receipt.draftId}` }))))
    if (s.view === 'config') body = h('div', null,
      button('ResetForm', resetSourceForm, busy || !!s.pending || !s.data),
      h('form', { onSubmit: (e: any) => { e.preventDefault(); return save() } },
        field('Id', h('input', { className: 'saw-input', value: s.form?.id || '', required: true, disabled: locked || !!s.source, onChange: (e: any) => edit('id', e.target.value) })),
        field('Root', h('select', { className: 'saw-input', value: s.form?.rootId || '', disabled: locked, onChange: (e: any) => edit('rootId', e.target.value) }, ...array(s.data?.roots).map(r => h('option', { key: r.id, value: r.id }, `${r.name} (${r.id})`)))),
        field('Path', h('input', { className: 'saw-input', value: s.form?.relativePath || '', required: true, disabled: locked, placeholder: 'notes/example.md', onChange: (e: any) => edit('relativePath', e.target.value) })),
        field('Kind', h('select', { className: 'saw-input', value: s.form?.kind || 'md', disabled: locked, onChange: (e: any) => edit('kind', e.target.value) }, ...['md', 'txt', 'csv'].map(v => h('option', { key: v, value: v }, v)))),
        s.form?.kind === 'csv' && field('IdColumn', h('input', { className: 'saw-input', value: s.form.csv?.idColumn || '', required: true, disabled: locked, onChange: (e: any) => edit('csv', { idColumn: e.target.value } as any) })),
        h('button', { className: 'saw-btn', type: 'submit', disabled: locked || !s.data?.roots.length }, tr('Save'))),
      s.source && h('section', null, h('p', null, `${tr('Revision')}: ${s.source.revision}`), h('p', null, `${tr('State')}: ${status(s.source.state)}${s.source.reason ? ` (${s.source.reason})` : ''}`), h('p', null, `${tr('Snapshot')}: ${s.source.snapshotId || tr('Unscanned')}`), button('Scan', scan, locked), button('Preview', detail, locked || !s.source.snapshotId), field('RemoveConfirm', h('input', { type: 'checkbox', checked: !!s.removeConfirm, disabled: locked, onChange: (e: any) => change(() => { s.removeConfirm = e.target.checked }) })), button('Remove', remove, locked || !s.removeConfirm)))
    if (s.view === 'detail' && s.detail) {
      const d = s.detail, pending = s.claims[bindingKey()]
      body = h('div', null, !d.current && h('p', { role: 'alert' }, tr('Stale')), h('p', null, `${tr('Snapshot')}: ${d.snapshotId}`), h('h4', null, tr('Raw')), pre(d.text),
        field('Item', h('select', { className: 'saw-input', value: s.selected, disabled: busy, onChange: (e: any) => change(() => { s.selected = e.target.value; s.reviewed = false }) }, h('option', { value: '' }, tr('Item')), ...d.items.map((i: any) => h('option', { key: i.itemId, value: i.itemId }, `${i.location?.relativePath || d.config.relativePath}${i.location?.row ? ` : ${i.location.row}` : ''}${i.location?.rowId ? ` (${i.location.rowId})` : ''}`)))), !d.items.length && h('p', null, tr('NoItems')), s.selected && pre(d.items.find((i: any) => i.itemId === s.selected)?.text || ''),
        d.images.length > 0 && h('section', null, h('h4', null, tr('Images')), ...d.images.map((image: any, index: number) => {
          const view = s.images[image.digest]
          return h('figure', { key: `${index}:${image.digest || image.reference}` }, h('figcaption', null, image.relativePath || image.reference, ' — ', tr(image.state !== 'available' ? 'ImageBlocked' : view?.loaded ? 'ImageLoaded' : 'ImageUnseen')), image.reason && h('p', null, image.reason), image.state === 'available' && button('OpenImage', () => openImage(image), busy), view?.url && h('img', { src: view.url, alt: image.relativePath || image.reference, style: { maxWidth: '100%' }, onLoad: (e: any) => { if (e.currentTarget.naturalWidth > 0 && current() && s.detail === d && s.images[image.digest] === view) change(() => { view.loaded = true }) }, onError: () => { if (current() && s.detail === d && s.images[image.digest] === view) change(() => { view.loaded = false; s.reviewed = false; s.error = tr('ImageFailed') }) } }))
        })),
        field('Reviewed', h('input', { type: 'checkbox', checked: s.reviewed, disabled: busy || !d.current || !s.selected || !imageReady(), onChange: (e: any) => { if (!p.busy && imageReady()) change(() => { s.reviewed = e.target.checked }) } })),
        pending?.status === 'unknown' && h('p', { role: 'alert' }, tr('ClaimUnknown'), pre(pending.input)),
        button(pending?.status === 'unknown' ? 'RetryClaim' : 'Claim', () => claim(pending?.status === 'unknown'), locked || !s.reviewed || !d.current || !s.selected || !imageReady() || pending?.status === 'claimed'), h('p', null, tr('DraftOnly')))
    }
    if (s.view === 'draft') {
      const draft = s.drafts.find((v: any) => v.receipt.draftId === s.draftId)
      const navigation = s.navigation, hasImages = !Array.isArray(draft?.receipt.images) || draft.receipt.images.length > 0
      body = draft && h('div', null, h('p', null, tr('PlanDraftIntro')), draft.epoch !== epoch && h('p', { role: 'note' }, tr('OldEpoch')), h('h4', null, tr('DraftText')), pre(draft.receipt.text), h('h4', null, tr('Origin')), pre(draft.receipt.origin), h('p', null, draft.receipt.draftId), button('PlanDraft', () => planDraft(draft, navigation), busy || !epoch || !planClaim(draft) || typeof props.onPlanDraft !== 'function'), hasImages && h('p', { role: 'note' }, tr('PlanDraftImagesBlocked')), typeof props.onPlanDraft !== 'function' && h('p', { role: 'note' }, tr('PlanDraftUnavailable')))
    }
    return h('section', { className: 'saw-section', 'aria-busy': busy, onKeyDown: (e: any) => { if (e.key === 'Escape' && s.view !== 'list') { e.preventDefault(); e.stopPropagation(); navigate('list') } } }, header, busy && h('p', { role: 'status' }, tr('Loading')), s.error && h('p', { role: 'alert' }, s.error), s.notice && h('p', { role: 'status' }, s.notice), mutation.view(), body)
  }

  const stages = ['locate', 'understand', 'plan', 'execute', 'summarize', 'verify']
  const stageNames: Record<string, string> = { locate: 'Locate', understand: 'Understand', plan: 'Plan', execute: 'Execute', summarize: 'Summarize', verify: 'Verify' }
  const validSelection = (r: any) => r && typeof r.provider === 'string' && !!r.provider && typeof r.model === 'string' && !!r.model && (r.reasoningEffort === undefined || typeof r.reasoningEffort === 'string' && !!r.reasoningEffort)
  const validConfig = (c: any) => c && Number.isSafeInteger(c.revision) && c.revision >= 0 && validSelection(c.default) && stages.every(k => c.stages?.[k]?.mode === 'inherit' || c.stages?.[k]?.mode === 'override' && validSelection(c.stages[k].selection))
  const validSettings = (v: any) => v && Number.isSafeInteger(v.configVersion) && v.configVersion >= 0 && (v.config === null && v.configVersion === 0 || validConfig(v.config) && v.config.revision === v.configVersion) && v.existingSessionModelPolicy === 'preserve' && v.existingSessionOverride === 'unsupported' && stages.every(k => {
    const route = v.stages?.[k]
    if (!route || route.configVersion !== v.configVersion) return false
    if (route.state === 'blocked') return typeof route.code === 'string' && !!route.code
    if (route.state !== 'ready' || !v.config) return false
    const configured = v.config.stages[k].mode === 'override' ? v.config.stages[k].selection : v.config.default
    const proof = route.capabilityProof
    return validSelection(route) && route.provider === configured.provider && route.model === configured.model && (configured.reasoningEffort === undefined || route.reasoningEffort === configured.reasoningEffort) && proof && ['vision', 'tools', 'structured'].every(key => ['supported', 'unsupported', 'unknown'].includes(proof[key])) && (proof.contextWindow === null || Number.isSafeInteger(proof.contextWindow) && proof.contextWindow > 0)
  })
  const sameConfig = (a: any, b: any) => validConfig(a) && validConfig(b) && JSON.stringify(canonical([a.default, ...stages.map(k => a.stages[k])])) === JSON.stringify(canonical([b.default, ...stages.map(k => b.stages[k])]))
  const modelInitial = (old?: any) => ({ settings: null, selectedStage: null, catalog: [], metadata: {}, metadataBusy: false, form: null, pending: null, needsReset: false, history: [...(old?.history || []), ...(old?.pending ? [{ input: clone(old.pending.input), status: 'old-epoch-unknown' }] : [])], error: '', notice: '', prior: old?.pending ? { epoch: old.pending.input.epoch, config: old.pending.input.config } : old?.prior })

  function StageModels(props: { epoch: string; active?: boolean }) {
    const epoch = props.epoch, active = props.active !== false, panel = usePanel(epoch, modelInitial, active), { p, s, change, run, current } = panel
    const formRevision = React.useRef(0)
    const heading = React.useRef(null as any)
    React.useEffect(() => { if (active) heading.current?.focus() }, [active, s.selectedStage])
    const chooseStage = (stage: string | null) => { if (stage !== null && stage !== 'default' && !stages.includes(stage)) return; change(() => { s.selectedStage = stage }) }
    const selectionKey = (route: any) => JSON.stringify([route.provider, route.model])
    const selectedRoutes = s.form ? [s.form.default, ...stages.filter(k => s.form.stages[k].mode === 'override').map(k => s.form.stages[k].selection)].filter((r: any) => r.provider && r.model) : []
    const selectionSignature = JSON.stringify(selectedRoutes.map(selectionKey).sort())
    const catalogValid = (catalog: any) => Array.isArray(catalog) && catalog.every((provider: any) => typeof provider.id === 'string' && typeof provider.name === 'string' && Array.isArray(provider.models) && provider.models.every((model: any) => typeof model.id === 'string' && typeof model.name === 'string' && (model.reasoningEfforts === undefined || Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.every((e: any) => typeof e.id === 'string' && typeof e.name === 'string'))))
    const blank = () => ({ revision: s.settings?.configVersion || 0, default: { provider: '', model: '' }, stages: Object.fromEntries(stages.map(k => [k, { mode: 'inherit' }])) })
    const refresh = () => {
      const editVersion = formRevision.current
      return run('settings', async (signal, valid) => {
        const result = await request('stage-models', { action: 'settings', epoch }, signal)
        if (!valid()) return
        if (!validSettings(result) || !catalogValid(result.catalog)) throw new Error('invalid')
        change(() => {
          s.settings = result; s.catalog = result.catalog
          if (!s.form && !s.pending && formRevision.current === editVersion) s.form = result.config ? clone(result.config) : blank()
        })
      })
    }
    React.useEffect(() => { if (active) void refresh() }, [epoch, active])
    React.useEffect(() => {
      if (!active) return
      const controller = new AbortController(), generation = p.generation
      const routes = [...new Map(selectedRoutes.map((r: any) => [selectionKey(r), r])).values()] as any[]
      const missing = routes.filter(r => !s.metadata[selectionKey(r)])
      if (!missing.length) { change(() => { s.metadataBusy = false }); return () => controller.abort() }
      change(() => { s.metadataBusy = true })
      void Promise.all(missing.map(async route => {
        try {
          const result = await request('stage-models', { action: 'inspect', epoch, provider: route.provider, model: route.model }, controller.signal)
          if (controller.signal.aborted || !current() || p.generation !== generation) return
          if (result?.provider !== route.provider || result.model !== route.model || !Array.isArray(result.reasoningEfforts) || !result.reasoningEfforts.every((e: any) => typeof e.id === 'string' && e.id && typeof e.name === 'string') || result.defaultEffort !== undefined && !result.reasoningEfforts.some((e: any) => e.id === result.defaultEffort)) throw new Error('invalid')
          change(() => { s.metadata = { ...s.metadata, [selectionKey(route)]: result } })
        } catch { if (!controller.signal.aborted && current()) change(() => { s.error = tr('InspectFailed') }) }
      })).finally(() => { if (!controller.signal.aborted && current()) change(() => { s.metadataBusy = false }) })
      return () => controller.abort()
    }, [epoch, active, selectionSignature, s.catalog])
    const update = (fn: any) => { if (!current() || p.busy || s.pending) return; change(() => { formRevision.current++; const next = clone(s.form); fn(next); s.form = next; s.notice = '' }) }
    const selectionAllowed = (r: any) => validSelection(r) && !!s.metadata[selectionKey(r)] && s.catalog.some((provider: any) => provider.id === r.provider && provider.models.some((model: any) => model.id === r.model && (r.reasoningEffort === undefined || array(s.metadata[selectionKey(r)].reasoningEfforts).some(e => e.id === r.reasoningEffort))))
    const mutation = useMutation(panel, epoch, (value, input) => {
      if (!validSettings(value) || value.configVersion !== input.config.revision + 1 || !sameConfig(value.config, input.config)) throw new Error('invalid')
      if (s.settings && s.settings.configVersion > value.configVersion) { change(() => { s.needsReset = true }); return }
      change(() => { s.settings = value; if (catalogValid(value.catalog)) s.catalog = value.catalog; s.form = clone(value.config) })
    })
    const save = () => {
      if (!current() || p.busy || s.pending || s.needsReset || !s.settings || !validConfig(s.form) || s.form.revision !== s.settings.configVersion || !selectionAllowed(s.form.default) || stages.some(k => s.form.stages[k].mode === 'override' && !selectionAllowed(s.form.stages[k].selection))) return
      return mutation.send('stage-models', 'stage-save', { action: 'save', epoch, config: clone(s.form) })
    }
    const disabled = !!p.busy || !!s.pending
    const selectRoute = (route: any, apply: any) => {
      const provider = s.catalog.find((v: any) => v.id === route.provider), models = array(provider?.models), model = models.find(v => v.id === route.model), metadata = s.metadata[selectionKey(route)], efforts = array(metadata?.reasoningEfforts)
      const missing = (items: any[], id: string) => id && !items.some(v => v.id === id) ? h('option', { value: id }, `${id} (${tr('Unknown')})`) : null
      return h('div', { className: 'saw-fields' },
        field('Provider', h('select', { className: 'saw-input', value: route.provider, disabled, onChange: (e: any) => apply({ provider: e.target.value, model: '' }) }, h('option', { value: '' }, tr('Provider')), missing(s.catalog, route.provider), ...s.catalog.map((v: any) => h('option', { key: v.id, value: v.id }, `${v.name} (${v.id})`)))),
        field('Model', h('select', { className: 'saw-input', value: route.model, disabled: disabled || !provider, onChange: (e: any) => apply({ provider: route.provider, model: e.target.value }) }, h('option', { value: '' }, tr('Model')), missing(models, route.model), ...models.map(v => h('option', { key: v.id, value: v.id }, `${v.name} (${v.id})`)))),
        field('Effort', h('select', { className: 'saw-input', value: route.reasoningEffort || '', disabled: disabled || !model || !metadata, onChange: (e: any) => apply({ provider: route.provider, model: route.model, ...(e.target.value ? { reasoningEffort: e.target.value } : {}) }) }, h('option', { value: '' }, tr('EffortDefault')), missing(efforts, route.reasoningEffort), ...efforts.map(v => h('option', { key: v.id, value: v.id }, v.name)))))
    }
    const capability = (v: any) => tr(v === 'supported' ? 'Known' : v === 'unsupported' ? 'NotSupported' : 'Unknown')
    const effective = (stage: string) => {
      const route = s.settings?.stages[stage], proof = route?.capabilityProof
      return h('aside', null, h('h5', null, tr('Effective')), !route || route.state !== 'ready' ? h('p', null, `${tr('Blocked')}: ${route?.code || tr('Unknown')}`) : h('div', null, h('p', null, `${tr('Provider')}: ${route.provider} · ${tr('Model')}: ${route.model} · ${tr('Effort')}: ${route.reasoningEffort || tr('EffortDefault')}`), h('p', null, `${tr('Version')}: ${route.configVersion}`), h('p', null, `${tr('Capabilities')} — ${tr('Vision')}: ${capability(proof?.vision)}; ${tr('Tools')}: ${capability(proof?.tools)}; ${tr('Structured')}: ${capability(proof?.structured)}; ${tr('Context')}: ${proof?.contextWindow ?? tr('Unknown')}`)))
    }
    const resetForm = () => { if (!current() || disabled || !s.settings) return; change(() => { formRevision.current++; s.form = s.settings.config ? clone(s.settings.config) : blank(); s.needsReset = false; s.notice = ''; s.error = '' }) }
    const canSave = !disabled && !s.needsReset && s.settings && validConfig(s.form) && s.form.revision === s.settings.configVersion && selectionAllowed(s.form.default) && stages.every(k => s.form.stages[k].mode === 'inherit' || selectionAllowed(s.form.stages[k].selection))
    const selected = s.selectedStage
    const routeSummary = (stage: string) => {
      const route = stage === 'default' ? s.settings?.config?.default : s.settings?.stages[stage]
      return route && (stage === 'default' || route.state === 'ready') ? `${route.provider} / ${route.model} · ${tr('Version')}: ${stage === 'default' ? s.settings.configVersion : route.configVersion}` : `${tr('Blocked')}: ${route?.code || tr('Unknown')} · ${tr('Version')}: ${s.settings?.configVersion ?? tr('Unknown')}`
    }
    const editor = selected === 'default' && s.form ? selectRoute(s.form.default, (value: any) => update((form: any) => { form.default = value })) : selected && s.form ? h('div', null,
      field('Override', h('select', { className: 'saw-input', value: s.form.stages[selected].mode, disabled, onChange: (e: any) => update((form: any) => { form.stages[selected] = e.target.value === 'override' ? { mode: 'override', selection: clone(form.default) } : { mode: 'inherit' } }) }, h('option', { value: 'inherit' }, tr('Inherit')), h('option', { value: 'override' }, tr('Override')))),
      s.form.stages[selected].mode === 'override' && selectRoute(s.form.stages[selected].selection, (value: any) => update((form: any) => { form.stages[selected] = { mode: 'override', selection: value } })), effective(selected)) : null
    return h('section', { className: 'saw-section', 'aria-busy': !!p.busy, onKeyDown: (e: any) => { if (e.key === 'Escape' && selected) { e.preventDefault(); e.stopPropagation(); chooseStage(null) } } },
      h('header', { className: 'saw-heading' }, h('h3', { ref: heading, tabIndex: -1 }, tr(selected === 'default' ? 'Default' : selected ? stageNames[selected]! : 'ModelsTitle')), selected && button('Back', () => chooseStage(null)), button('Refresh', refresh, !!p.busy || !epoch)),
      h('p', null, tr('ModelsIntro')), s.metadataBusy && h('p', { role: 'status' }, tr('InspectPending')), p.busy && h('p', { role: 'status' }, tr('Loading')), s.error && h('p', { role: 'alert' }, s.error), s.notice && h('p', { role: 'status' }, s.notice), mutation.view(), s.prior && h('aside', null, tr('OldEpoch'), pre(s.prior)), s.settings && h('p', null, `${tr('Version')}: ${s.settings.configVersion}`), s.settings && button('ResetForm', resetForm, disabled), !s.catalog.length && h('p', null, tr('NoCatalog')),
      !selected ? h('ul', { className: 'saw-list' }, ...['default', ...stages].map(stage => h('li', { key: stage }, button(stage === 'default' ? 'Default' : stageNames[stage]!, () => chooseStage(stage), !s.form), h('p', null, `${tr('Effective')}: ${routeSummary(stage)}`)))) : s.form && h('form', { onSubmit: (e: any) => { e.preventDefault(); return save() } }, h('p', null, tr('Unsaved')), h('fieldset', { disabled }, h('legend', null, tr(selected === 'default' ? 'Default' : stageNames[selected]!)), editor), h('button', { type: 'submit', className: 'saw-btn', disabled: !canSave }, tr('SaveModels'))))
  }
  return { LocalSources, StageModels }
}
