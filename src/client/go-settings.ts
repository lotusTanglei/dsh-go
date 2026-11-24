/** Serialized into the client factory: no imports or module-scope runtime dependencies. */
export function createGoSettings(React: any, request: (path: string, body: any, signal?: AbortSignal) => Promise<any>, t: any) {
  const h = React.createElement
  const copy: Record<string, string> = {
    Refresh: '刷新核实', Back: '返回列表', Saved: 'Host 已确认保存', Blocked: '已阻止', Unknown: '未知', Loading: '正在处理，请稍候…',
    Failed: '请求失败，请刷新核实；未自动重试。', MutationStatus: '核实原请求状态', MutationClose: '封存缺记录 ID，不重做', MutationClosed: 'Host 已永久封存原 ID；请刷新并显式载入最新配置后再编辑。', MutationRejected: 'Host 已明确拒绝，原请求与拒绝证据已保留；未视为保存成功。', MutationRecorded: 'Host 已记录原请求，结果尚未确定；保持锁定，只能核实状态。',
    MutationHistory: '配置变更回执记录', UnknownMutation: '上次变更结果未知。原请求已保留，禁止改写或重新提交；请核实原请求状态。', ResetForm: '载入 Host 最新配置（替换当前表单）', OldEpoch: '旧工作区草稿，只读保留；不能复用旧授权。', ModelsIntro: '这里只配置未来阶段的模型路由，不进行真实模型调用或测试。既有会话保留原模型，不支持覆盖既有会话。', Provider: '外发服务商',
    Model: '模型', Effort: '推理强度', EffortDefault: '采用模型默认值', Inherit: '继承默认路由', Override: '单阶段覆盖', Effective: 'Host 当前有效路由',
    Unsaved: '编辑值尚未保存，不是当前生效路由。', Version: 'Host 配置版本', Capabilities: '能力证据', Vision: '图像', Tools: '工具', Structured: '结构化输出',
    ModelsTitle: '阶段模型', Default: '默认路由', Known: '已知支持', NotSupported: '已知不支持',
    Context: '上下文上限', SaveModels: '保存阶段模型配置', NoCatalog: 'Host 未提供可选模型目录，无法保存新配置。', InspectPending: '正在核实所选模型的推理强度，完成前不能保存。', InspectFailed: '所选模型元数据核实失败，请刷新重查；未运行模型。', Locate: '定位',
    Understand: '理解', Plan: '计划', Execute: '执行', Summarize: '总结', Verify: '验收',
  }
  const tr = (key: string): string => { const id = `wGo${key}`; try { const value = typeof t === 'function' ? t(id) : null; if (typeof value === 'string' && value && value !== id) return value } catch {} return copy[key] || key }
  const array = (v: any): any[] => Array.isArray(v) ? v : []
  const clone = (v: any) => JSON.parse(JSON.stringify(v))
  const button = (key: string, click: any, disabled = false, props: any = {}) => h('button', { type: 'button', className: 'saw-btn', onClick: click, disabled, ...props }, tr(key))
  const pre = (v: any) => h('pre', { className: 'saw-pre', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  const field = (label: string, control: any) => h('label', { className: 'saw-field' }, h('span', null, tr(label)), control)
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
  return { StageModels }
}
