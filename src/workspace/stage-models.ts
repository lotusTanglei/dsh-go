import { createHash } from 'node:crypto'
import type { Store } from '../store/index.js'
import { encodeJson } from '../store/codec.js'

export const STAGES = Object.freeze(['locate', 'understand', 'plan', 'execute', 'summarize', 'verify'] as const)
export type Stage = typeof STAGES[number]
export interface StageModelSelection { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
export type StageModelChoice = { readonly mode: 'inherit' } | { readonly mode: 'override'; readonly selection: StageModelSelection }
export interface StageModelConfig { readonly revision: number; readonly default: StageModelSelection; readonly stages: Readonly<Record<Stage, StageModelChoice>> }
export interface StageRequirements { readonly vision?: boolean; readonly tools?: boolean; readonly structured?: boolean; readonly minContextTokens?: number }
export type CapabilityState = 'supported' | 'unsupported' | 'unknown'
/** The installed rc.5 shape; toolUpdate is deliberately NOT a tool-support flag. */
export interface StageModelInfo {
  readonly provider: string; readonly id: string; readonly name: string
  readonly inputModalities?: readonly string[]
  readonly context?: { readonly contextWindow: number }
  readonly defaultMaxTokens?: number
  readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[]; readonly defaultEffort?: string }
}
export interface StageCatalogPort {
  listProviders(): readonly { readonly id: string; readonly name: string }[]
  listModels(provider: string): Promise<readonly { readonly provider: string; readonly id: string; readonly name: string }[]>
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<StageModelInfo>
}
export interface StageCapabilityProof {
  readonly vision: CapabilityState; readonly tools: CapabilityState; readonly structured: CapabilityState
  readonly contextWindow: number | null
  /** Captured capability/default facts, not authorization for the eventual prepared controls. */
  readonly inputModalities: readonly string[] | null; readonly defaultMaxTokens: number | null
  readonly reasoningEfforts: readonly string[]; readonly defaultEffort: string | null
  readonly modelInfoEvidence: 'dsh.resolveModelInfo'
  readonly hostEvidence: readonly string[]
}
export interface StageRouteSnapshot extends StageModelSelection {
  readonly stage: Stage; readonly configVersion: number; readonly mode: 'inherit' | 'override'
  readonly configured: StageModelSelection; readonly requirements: StageRequirements
  readonly capabilityProof: StageCapabilityProof
}
export interface StageBlocked { readonly state: 'blocked'; readonly code: string; readonly configVersion: number }
export type StageResolution = { readonly state: 'ready'; readonly snapshot: StageRouteSnapshot } & StageModelSelection & { readonly configVersion: number; readonly capabilityProof: StageCapabilityProof } | StageBlocked
export interface StageModelSettings {
  readonly config: StageModelConfig | null; readonly configVersion: number
  readonly stages: Readonly<Record<Stage, StageResolution>>
  readonly existingSessionModelPolicy: 'preserve'; readonly existingSessionOverride: 'unsupported'
}
export type StageJson = null | boolean | number | string | readonly StageJson[] | { readonly [key: string]: StageJson }
export interface StageRunContext {
  readonly requestId: string; readonly inputRevision: string; readonly scopeRevision: string
  readonly sourceRevisions: readonly { readonly sourceId: string; readonly revision: string }[]
  readonly dataCategories: readonly string[]
}
export interface StageBoundContext extends StageRunContext { readonly inputDigest: string }
export interface StageFence { fence(): void }
export type StageAuthorization = { readonly allowed: true; readonly authorizationRevision: string; fence(): void } | { readonly allowed: false; readonly code: string }
export interface StageCallConfig extends StageModelSelection { readonly maxTokens?: number; readonly temperature?: number; readonly stop?: readonly string[] }
export interface StageCallRequest {
  readonly snapshot: StageRouteSnapshot; readonly input: StageJson; readonly context: StageBoundContext
  readonly authorizationRevision: string; readonly signal?: AbortSignal
  /** Must be called at every asynchronous boundary inside the Host adapter and immediately before dispatch. */
  checkpoint(): void
}
/** Fixed disclosure: rc.5 has no final provider-dispatch permit, so the claimed window is explicit. */
export interface StageDispatchDisclosure {
  readonly atomicProviderDispatch: false
  readonly window: 'authorization-to-provider-io'
  readonly reason: 'dsh-llm-stream-middleware-may-await'
  readonly providerDispatchPermit: 'unavailable'
}
export const STAGE_DISPATCH_DISCLOSURE: StageDispatchDisclosure = Object.freeze({
  atomicProviderDispatch: false, window: 'authorization-to-provider-io',
  reason: 'dsh-llm-stream-middleware-may-await', providerDispatchPermit: 'unavailable',
})
export interface StageCallReceipt {
  readonly callId: string; readonly config: StageCallConfig; readonly configVersion: number
  readonly stage: Stage; readonly mode: 'inherit' | 'override'
  readonly capabilityProof: StageCapabilityProof; readonly disclosure: StageDispatchDisclosure
  readonly inputDigest: string; readonly inputRevision: string; readonly scopeRevision: string
  readonly sourceRevisions: StageRunContext['sourceRevisions']; readonly authorizationRevision: string
}
export interface StageCallOutcome { readonly output: StageJson; readonly receipt: StageCallReceipt }
export interface StageCallPort { run(request: StageCallRequest): Promise<StageCallOutcome> }
export interface StageModelPorts {
  readonly catalog?: StageCatalogPort
  /** Extra Host-owned attestation, NOT a fabricated DSH model-info API. Missing evidence stays unknown. */
  readonly capabilities?: (selection: StageModelSelection, info: StageModelInfo) => Promise<{
    readonly tools?: boolean; readonly structured?: boolean; readonly evidenceRefs: readonly string[]; fence(): void
  }>
  /** Authenticated Host checks current input, scope, sources and categories, never browser/model assertions. */
  readonly bind?: (context: StageBoundContext, signal?: AbortSignal) => Promise<StageFence>
  readonly authorize?: (snapshot: StageRouteSnapshot, context: StageBoundContext, signal?: AbortSignal) => Promise<StageAuthorization>
  readonly call?: StageCallPort
}
export type StageRunResult = { readonly state: 'completed'; readonly snapshot: StageRouteSnapshot; readonly output: StageJson; readonly receipt: StageCallReceipt } | StageBlocked

const KEY = 'stage-models:v1'
// Revision-addressed sidecar: preserve existing config and old in-flight baselines without a schema migration.
const baselineKey = (revision: number) => `stage-models:baseline:v1:${revision}`
interface StageSavedBaseline {
  readonly configRevision: number
  readonly routes: readonly { readonly selection: StageModelSelection; readonly proof: StageCapabilityProof }[]
}
class StageModelError extends Error { constructor(readonly code: string) { super(code) } }
function fail(code: string): never { throw new StageModelError(code) }
/** Host adapters may reject with one of this contract's fixed codes instead of a generic fallback. */
export function stageFailure(code: string): never { throw new StageModelError(code) }
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v)
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(k => typeof k !== 'string' || !keys.includes(k) || !Object.getOwnPropertyDescriptor(value, k)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, k)!))) fail('stage_models_schema_invalid')
  return value as Record<string, unknown>
}
function selection(value: unknown): StageModelSelection {
  const v = object(value, ['provider', 'model', 'reasoningEffort'])
  if (!text(v.provider) || !text(v.model) || ('reasoningEffort' in v && !text(v.reasoningEffort))) fail('stage_models_schema_invalid')
  return { provider: v.provider, model: v.model, ...v.reasoningEffort === undefined ? {} : { reasoningEffort: v.reasoningEffort as string } }
}
export function parseStageModelConfig(value: unknown): StageModelConfig {
  const v = object(value, ['revision', 'default', 'stages'])
  if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0) fail('stage_models_schema_invalid')
  const s = object(v.stages, STAGES), stages = {} as Record<Stage, StageModelChoice>
  for (const stage of STAGES) {
    const c = object(s[stage], ['mode', 'selection'])
    if (c.mode === 'inherit' && !('selection' in c)) stages[stage] = { mode: 'inherit' }
    else if (c.mode === 'override') stages[stage] = { mode: 'override', selection: selection(c.selection) }
    else fail('stage_models_schema_invalid')
  }
  return freeze({ revision: Number(v.revision), default: selection(v.default), stages })
}
function requirements(value: unknown): StageRequirements {
  const v = object(value, ['vision', 'tools', 'structured', 'minContextTokens'])
  for (const k of ['vision', 'tools', 'structured']) if (k in v && typeof v[k] !== 'boolean') fail('stage_models_requirements_invalid')
  if ('minContextTokens' in v && (!Number.isSafeInteger(v.minContextTokens) || Number(v.minContextTokens) <= 0)) fail('stage_models_requirements_invalid')
  return freeze({ ...v }) as StageRequirements
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
  return value
}
function code(error: unknown, fallback: string): string { return error instanceof StageModelError ? error.code : fallback }
const blocked = (error: unknown, version: number, fallback = 'stage_models_unavailable'): StageBlocked => freeze({ state: 'blocked', code: code(error, fallback), configVersion: version })
function modelInfo(value: StageModelInfo, route: StageModelSelection): StageModelInfo {
  if (!value || value.provider !== route.provider || value.id !== route.model || !text(value.name)) fail('stage_models_info_invalid')
  if (value.inputModalities !== undefined && (!Array.isArray(value.inputModalities) || !value.inputModalities.every(text) || new Set(value.inputModalities).size !== value.inputModalities.length)) fail('stage_models_info_invalid')
  if (value.context !== undefined && (!Number.isSafeInteger(value.context.contextWindow) || value.context.contextWindow <= 0)) fail('stage_models_info_invalid')
  if (value.defaultMaxTokens !== undefined && (!Number.isSafeInteger(value.defaultMaxTokens) || value.defaultMaxTokens <= 0)) fail('stage_models_info_invalid')
  if (value.reasoning !== undefined) {
    const r = value.reasoning
    if (!Array.isArray(r.efforts) || !r.efforts.length || !r.efforts.every(e => text(e.id) && text(e.name)) || new Set(r.efforts.map(e => e.id)).size !== r.efforts.length || (r.defaultEffort !== undefined && !r.efforts.some(e => e.id === r.defaultEffort))) fail('stage_models_info_invalid')
  }
  if (route.reasoningEffort !== undefined && !value.reasoning?.efforts.some(e => e.id === route.reasoningEffort)) fail('stage_models_reasoning_unsupported')
  return freeze(structuredClone(value))
}
function checkRequirements(proof: StageCapabilityProof, req: StageRequirements) {
  for (const key of ['vision', 'tools', 'structured'] as const) if (req[key] && proof[key] !== 'supported') fail(`stage_models_${key}_${proof[key]}`)
  if (req.minContextTokens !== undefined && (proof.contextWindow === null || proof.contextWindow < req.minContextTokens)) fail(proof.contextWindow === null ? 'stage_models_context_unknown' : 'stage_models_context_incompatible')
}
function canonicalJson(input: unknown, depth = 0): StageJson {
  if (depth > 32) fail('stage_models_input_invalid')
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return input
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (Array.isArray(input)) {
    if (Reflect.ownKeys(input).length !== input.length + 1 || !Object.keys(input).every((key, i) => key === String(i) && 'value' in Object.getOwnPropertyDescriptor(input, key)!)) fail('stage_models_input_invalid')
    return input.map(v => canonicalJson(v, depth + 1))
  }
  if (!input || typeof input !== 'object') fail('stage_models_input_invalid')
  const obj = object(input, Object.keys(input)), out: Record<string, StageJson> = Object.create(null)
  for (const k of Object.keys(obj).sort()) out[k] = canonicalJson(obj[k], depth + 1)
  return out
}
function bindContext(input: unknown, payload: StageJson): StageBoundContext {
  const v = object(input, ['requestId', 'inputRevision', 'scopeRevision', 'sourceRevisions', 'dataCategories'])
  if (!text(v.requestId) || !text(v.inputRevision) || !text(v.scopeRevision) || !Array.isArray(v.sourceRevisions) || v.sourceRevisions.length > 100 || !Array.isArray(v.dataCategories) || !v.dataCategories.length || v.dataCategories.length > 100 || !v.dataCategories.every(text) || new Set(v.dataCategories).size !== v.dataCategories.length) fail('stage_models_context_invalid')
  const refs = v.sourceRevisions.map(ref => { const r = object(ref, ['sourceId', 'revision']); if (!text(r.sourceId) || !text(r.revision)) fail('stage_models_context_invalid'); return { sourceId: r.sourceId, revision: r.revision } })
  if (new Set(refs.map(r => r.sourceId)).size !== refs.length) fail('stage_models_context_invalid')
  const json = JSON.stringify(payload)
  if (Buffer.byteLength(json) > 4 * 1024 * 1024) fail('stage_models_input_invalid')
  return freeze({ requestId: v.requestId, inputRevision: v.inputRevision, scopeRevision: v.scopeRevision, sourceRevisions: refs, dataCategories: [...v.dataCategories], inputDigest: createHash('sha256').update(json).digest('hex') })
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonicalJson(a)) === JSON.stringify(canonicalJson(b))

/** Host only: the browser may submit strict config, never inject these ports. */
export function createStageModels(store: Store, ports: StageModelPorts) {
  function read(): StageModelConfig | null {
    const value = store.repos.kv.get(KEY)?.v
    if (value === undefined) return null
    const config = parseStageModelConfig(value)
    if (!config.revision) fail('stage_models_persisted_invalid')
    return config
  }
  function readBaseline(config: StageModelConfig): StageSavedBaseline {
    const value = store.repos.kv.get(baselineKey(config.revision))?.v
    if (value === undefined) fail('stage_models_baseline_missing')
    try {
      const saved = object(value, ['configRevision', 'routes'])
      if (saved.configRevision !== config.revision || !Array.isArray(saved.routes) || !saved.routes.length || saved.routes.length > STAGES.length + 1) fail('stage_models_baseline_invalid')
      const routes = saved.routes.map(raw => {
        const entry = object(raw, ['selection', 'proof']), route = selection(entry.selection)
        const proof = object(entry.proof, ['vision', 'tools', 'structured', 'contextWindow', 'inputModalities', 'defaultMaxTokens', 'reasoningEfforts', 'defaultEffort', 'modelInfoEvidence', 'hostEvidence'])
        for (const key of ['vision', 'tools', 'structured']) if (!['supported', 'unsupported', 'unknown'].includes(String(proof[key]))) fail('stage_models_baseline_invalid')
        for (const key of ['contextWindow', 'defaultMaxTokens']) if (proof[key] !== null && (!Number.isSafeInteger(proof[key]) || Number(proof[key]) <= 0)) fail('stage_models_baseline_invalid')
        if (proof.inputModalities !== null && (!Array.isArray(proof.inputModalities) || !proof.inputModalities.every(text))) fail('stage_models_baseline_invalid')
        if (!Array.isArray(proof.reasoningEfforts) || !proof.reasoningEfforts.every(text) || (proof.defaultEffort !== null && (!text(proof.defaultEffort) || !proof.reasoningEfforts.includes(proof.defaultEffort)))) fail('stage_models_baseline_invalid')
        if (proof.modelInfoEvidence !== 'dsh.resolveModelInfo' || !Array.isArray(proof.hostEvidence) || !proof.hostEvidence.every(text)) fail('stage_models_baseline_invalid')
        return { selection: route, proof: proof as unknown as StageCapabilityProof }
      })
      return freeze({ configRevision: config.revision, routes })
    } catch { return fail('stage_models_baseline_invalid') }
  }
  function baselineRoute(baseline: StageSavedBaseline, route: StageModelSelection): StageCapabilityProof {
    const entries = baseline.routes.filter(entry => same(entry.selection, route))
    if (entries.length !== 1) fail('stage_models_baseline_invalid')
    return entries[0]!.proof
  }
  async function inspect(route: StageModelSelection, req: StageRequirements, signal?: AbortSignal, checkpoint: () => void = () => {}, validateEffort = true) {
    checkpoint(); signal?.throwIfAborted()
    const catalog = ports.catalog
    if (!catalog) fail('stage_models_catalog_unavailable')
    const providers = catalog.listProviders()
    if (!Array.isArray(providers) || !providers.some(p => p.id === route.provider)) fail('stage_models_provider_unavailable')
    const models = await catalog.listModels(route.provider)
    checkpoint(); signal?.throwIfAborted()
    if (!Array.isArray(models) || !models.some(m => m.provider === route.provider && m.id === route.model)) fail('stage_models_model_unavailable')
    const info = modelInfo(await catalog.resolveModelInfo(route.provider, route.model, signal), validateEffort ? route : { provider: route.provider, model: route.model })
    checkpoint(); signal?.throwIfAborted()
    const attested = ports.capabilities ? await ports.capabilities(route, info) : undefined
    checkpoint(); signal?.throwIfAborted()
    if (attested && (!Array.isArray(attested.evidenceRefs) || !attested.evidenceRefs.length || !attested.evidenceRefs.every(text) || typeof attested.fence !== 'function' || (attested.tools !== undefined && typeof attested.tools !== 'boolean') || (attested.structured !== undefined && typeof attested.structured !== 'boolean'))) fail('stage_models_capability_evidence_invalid')
    attested?.fence()
    const state = (v: boolean | undefined): CapabilityState => v === undefined ? 'unknown' : v ? 'supported' : 'unsupported'
    const proof: StageCapabilityProof = freeze({ vision: info.inputModalities === undefined ? 'unknown' : info.inputModalities.includes('image') ? 'supported' : 'unsupported', tools: state(attested?.tools), structured: state(attested?.structured), contextWindow: info.context?.contextWindow ?? null, inputModalities: info.inputModalities ?? null, defaultMaxTokens: info.defaultMaxTokens ?? null, reasoningEfforts: info.reasoning?.efforts.map(e => e.id) ?? [], defaultEffort: info.reasoning?.defaultEffort ?? null, modelInfoEvidence: 'dsh.resolveModelInfo', hostEvidence: [...attested?.evidenceRefs ?? []] })
    checkRequirements(proof, req)
    return { info, proof, fence: () => attested?.fence() }
  }
  async function resolveConfig(config: StageModelConfig | null, stage: Stage, req: StageRequirements, signal?: AbortSignal, checkpoint?: () => void, savedBaseline?: StageSavedBaseline): Promise<{ snapshot: StageRouteSnapshot; fence(): void }> {
    if (!STAGES.includes(stage)) fail('stage_models_stage_invalid')
    if (!config) fail('stage_models_not_configured')
    const baseline = savedBaseline ?? readBaseline(config)
    if (baseline.configRevision !== config.revision) fail('stage_models_baseline_invalid')
    const choice = config.stages[stage], configured = choice.mode === 'inherit' ? config.default : choice.selection
    const expected = baselineRoute(baseline, configured)
    // Compare current defaults/capabilities before interpreting a selected effort or requirements.
    const checked = await inspect(configured, {}, signal, checkpoint, false)
    if (!same(checked.proof, expected)) fail('stage_models_capability_changed')
    if (configured.reasoningEffort !== undefined && !checked.info.reasoning?.efforts.some(e => e.id === configured.reasoningEffort)) fail('stage_models_capability_changed')
    checkRequirements(checked.proof, req)
    const effort = configured.reasoningEffort ?? checked.info.reasoning?.defaultEffort
    const snapshot: StageRouteSnapshot = freeze({ stage, configVersion: config.revision, mode: choice.mode, configured, provider: configured.provider, model: configured.model, ...effort === undefined ? {} : { reasoningEffort: effort }, requirements: req, capabilityProof: checked.proof })
    return { snapshot, fence: checked.fence }
  }
  async function describe(config: StageModelConfig | null, baseline?: StageSavedBaseline): Promise<StageModelSettings> {
    const stages = {} as Record<Stage, StageResolution>
    for (const stage of STAGES) {
      try { const { snapshot } = await resolveConfig(config, stage, {}, undefined, undefined, baseline); stages[stage] = ready(snapshot) }
      catch (error) { stages[stage] = blocked(error, config?.revision ?? 0) }
    }
    return freeze({ config, configVersion: config?.revision ?? 0, stages, existingSessionModelPolicy: 'preserve', existingSessionOverride: 'unsupported' })
  }
  function ready(snapshot: StageRouteSnapshot): StageResolution { return freeze({ state: 'ready', snapshot, provider: snapshot.provider, model: snapshot.model, ...snapshot.reasoningEffort === undefined ? {} : { reasoningEffort: snapshot.reasoningEffort }, configVersion: snapshot.configVersion, capabilityProof: snapshot.capabilityProof }) }
  return {
    async settings(): Promise<StageModelSettings> { return describe(read()) },
    async save(input: unknown, checkpoint: () => void = () => {}, onCommit: (value: StageModelSettings) => void = () => {}): Promise<StageModelSettings> {
      checkpoint()
      const config = parseStageModelConfig(input)
      if (config.revision === Number.MAX_SAFE_INTEGER) fail('stage_models_revision_exhausted')
      // No lock held across provider metadata I/O. CAS is checked again inside the write transaction.
      if ((read()?.revision ?? 0) !== config.revision) fail('stage_models_revision_conflict')
      const checks: Array<{ fence(): void }> = []
      const routes: Array<StageSavedBaseline['routes'][number]> = []
      for (const route of [config.default, ...STAGES.flatMap(stage => config.stages[stage].mode === 'override' ? [config.stages[stage].selection] : [])]) {
        if (routes.some(entry => same(entry.selection, route))) continue
        const checked = await inspect(route, {}, undefined, checkpoint)
        checks.push(checked)
        routes.push({ selection: route, proof: checked.proof })
      }
      const saved = freeze({ ...config, revision: config.revision + 1 })
      const baseline: StageSavedBaseline = freeze({ configRevision: saved.revision, routes })
      const description = await describe(saved, baseline)
      if (Object.values(description.stages).some(stage => stage.state === 'blocked')) fail('stage_models_capability_changed')
      checkpoint()
      store.transaction(() => {
        checkpoint()
        if ((read()?.revision ?? 0) !== config.revision) fail('stage_models_revision_conflict')
        for (const check of checks) check.fence()
        store.repos.kv.insertOrIgnore({ k: KEY, v: saved })
        store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(saved, false), KEY)
        store.repos.kv.insertOrIgnore({ k: baselineKey(saved.revision), v: baseline })
        store.db.prepare('UPDATE kv SET v=? WHERE k=?').run(encodeJson(baseline, false), baselineKey(saved.revision))
        onCommit(description)
      })
      checkpoint(); return description
    },
    async resolve(stage: Stage, rawRequirements: StageRequirements = {}): Promise<StageResolution> {
      let version = 0
      try { const config = read(); version = config?.revision ?? 0; const { snapshot } = await resolveConfig(config, stage, requirements(rawRequirements)); return ready(snapshot) }
      catch (error) { return blocked(error, version) }
    },
    async runStage(stage: Stage, rawRequirements: StageRequirements, request: { readonly input: StageJson; readonly context: StageRunContext; readonly signal?: AbortSignal }): Promise<StageRunResult> {
      let version = 0
      try {
        const config = read(); version = config?.revision ?? 0
        const input = freeze(canonicalJson(request.input)), context = bindContext(request.context, input), req = requirements(rawRequirements)
        const signal = request.signal
        const abort = () => { if (signal?.aborted) fail('stage_models_aborted') }
        abort()
        if (!ports.bind) fail('stage_models_binding_unavailable')
        const bound = await ports.bind(context, signal)
        abort()
        const fence = () => { abort(); try { bound.fence() } catch { fail('stage_models_binding_stale') } }
        fence()
        const resolved = await resolveConfig(config, stage, req, signal, fence)
        fence(); resolved.fence()
        if (!ports.authorize) fail('stage_models_authorization_unavailable')
        const rawAuth = await ports.authorize(resolved.snapshot, context, signal)
        const auth = rawAuth?.allowed === true ? Object.freeze({ allowed: true as const, authorizationRevision: rawAuth.authorizationRevision, fence: typeof rawAuth.fence === 'function' ? rawAuth.fence.bind(rawAuth) : undefined }) : Object.freeze({ allowed: false as const })
        fence(); resolved.fence()
        if (!auth.allowed) fail('stage_models_authorization_denied')
        if (!text(auth.authorizationRevision) || typeof auth.fence !== 'function') fail('stage_models_authorization_invalid')
        const authorizationRevision = auth.authorizationRevision, authorizationFence = auth.fence
        const checkpoint = () => { fence(); resolved.fence(); try { authorizationFence() } catch { fail('stage_models_authorization_stale') } }
        checkpoint()
        if (!ports.call) fail('stage_models_call_unavailable')
        const rawOutcome = await ports.call.run(Object.freeze({ snapshot: resolved.snapshot, input, context, authorizationRevision, signal, checkpoint }))
        const outcome = { receipt: structuredClone(rawOutcome.receipt), output: canonicalJson(rawOutcome.output) }
        checkpoint()
        const receipt = outcome.receipt, s = resolved.snapshot
        if (!text(receipt.callId) || receipt.config.provider !== s.provider || receipt.config.model !== s.model || receipt.config.reasoningEffort !== s.reasoningEffort || receipt.configVersion !== version || receipt.stage !== s.stage || receipt.mode !== s.mode || receipt.inputDigest !== context.inputDigest || receipt.inputRevision !== context.inputRevision || receipt.scopeRevision !== context.scopeRevision || !same(receipt.sourceRevisions, context.sourceRevisions) || receipt.authorizationRevision !== auth.authorizationRevision || !same(receipt.capabilityProof, s.capabilityProof) || !same(receipt.disclosure, STAGE_DISPATCH_DISCLOSURE)) fail('stage_models_receipt_mismatch')
        return freeze({ state: 'completed', snapshot: s, output: canonicalJson(outcome.output), receipt: structuredClone(receipt) })
      } catch (error) { return blocked(error, version, request.signal?.aborted ? 'stage_models_aborted' : 'stage_models_call_failed') }
    },
  }
}

/** Structural rc.5 prepareCall contract. No dependency installation or Agent selection required. */
export interface DshStageLlm {
  prepareCall(config: StageCallConfig, signal: AbortSignal | undefined, configure: (controls: Omit<StageCallConfig, 'provider' | 'model'>, info: StageModelInfo) => Omit<StageCallConfig, 'provider' | 'model'>): Promise<{
    readonly config: StageCallConfig; readonly inputModalities?: readonly string[]; readonly context?: { readonly contextWindow: number }
    stream(options: Readonly<Record<string, unknown>>): AsyncIterable<unknown>
  }>
}
export interface DshStageCallHooks {
  /** Persist exact model-visible input, prepared config and version before returning. Host owns privacy/lifecycle. */
  record(request: StageCallRequest, config: StageCallConfig): Promise<{ readonly callId: string; readonly options: Readonly<Record<string, unknown>> }>
  /** Consume one attempt (no retry); terminal errors must reject, not produce successful output. */
  consume(chunks: AsyncIterable<unknown>, request: StageCallRequest): Promise<StageJson>
}
/**
 * One captured adapter generation with local checkpointed iteration, not an atomic authorization permit.
 * rc.5 llm/stream middleware may await after our last checkpoint and before provider dispatch.
 * Production must not inject this port without a Host-owned atomic permit at final provider I/O.
 * Prepared defaults (including maxTokens) are recorded in the receipt, not claimed as full-controls authorization.
 */
export function createDshStageCallPort(llm: DshStageLlm, hooks: DshStageCallHooks): StageCallPort {
  return {
    async run(request) {
      request.checkpoint()
      const s = request.snapshot
      const proposed: StageCallConfig = { provider: s.provider, model: s.model, ...s.reasoningEffort === undefined ? {} : { reasoningEffort: s.reasoningEffort } }
      let configured = false
      const prepared = await llm.prepareCall(proposed, request.signal, (controls, raw) => {
        request.checkpoint()
        const info = modelInfo(raw, proposed), p = s.capabilityProof
        const vision = info.inputModalities === undefined ? 'unknown' : info.inputModalities.includes('image') ? 'supported' : 'unsupported'
        if (vision !== p.vision || (info.context?.contextWindow ?? null) !== p.contextWindow || !same(info.inputModalities ?? null, p.inputModalities) || (info.defaultMaxTokens ?? null) !== p.defaultMaxTokens || !same(info.reasoning?.efforts.map(e => e.id) ?? [], p.reasoningEfforts) || (info.reasoning?.defaultEffort ?? null) !== p.defaultEffort) fail('stage_models_prepared_capability_changed')
        configured = true
        return controls
      })
      request.checkpoint()
      if (!configured || prepared.config.provider !== s.provider || prepared.config.model !== s.model || prepared.config.reasoningEffort !== s.reasoningEffort) fail('stage_models_prepared_route_changed')
      const recorded = await hooks.record(request, prepared.config)
      request.checkpoint()
      if (!text(recorded.callId)) fail('stage_models_record_invalid')
      // Strip even omitted controls: a spread alone would retain an injected effort/maxTokens.
      const { provider: _provider, model: _model, reasoningEffort: _effort, temperature: _temperature, maxTokens: _maxTokens, stop: _stop, signal: _signal, ...body } = recorded.options
      const detachedBody = freeze(canonicalJson(body)) as Readonly<Record<string, unknown>>
      let finished = false, drained = false, streamFailure: unknown
      async function* fenced() {
        let iterator: AsyncIterator<unknown> | undefined
        try {
          // consume may await before requesting the first item: do not even construct its stream until rechecked.
          request.checkpoint()
          const stream = prepared.stream(Object.freeze({ ...detachedBody, ...prepared.config, signal: request.signal }))
          request.checkpoint()
          iterator = stream[Symbol.asyncIterator]()
          for (;;) {
            request.checkpoint()
            const item = await iterator.next()
            request.checkpoint()
            if (item.done) { drained = true; break }
            const chunk = item.value
            if (finished || !chunk || typeof chunk !== 'object') fail('stage_models_stream_invalid')
            const value = chunk as { type?: string; reason?: { kind?: string } }
            if (value.type === 'finish') {
              if (value.reason?.kind === 'error' || value.reason?.kind === 'aborted') fail('stage_models_call_failed')
              // Unknown, truncated, and tool-call continuations are not successful final stage output.
              if (value.reason?.kind !== 'stop') fail('stage_models_stream_incomplete')
              finished = true
            }
            yield chunk
          }
        } catch (error) { streamFailure = error; throw error }
        finally {
          if (!drained && iterator?.return) {
            try { await iterator.return() } catch (error) { if (streamFailure === undefined) { streamFailure = error; throw error } }
          }
        }
      }
      const output = await hooks.consume(fenced(), request)
      request.checkpoint()
      if (streamFailure) throw streamFailure
      if (!finished || !drained) fail('stage_models_stream_incomplete')
      return { output, receipt: { callId: recorded.callId, config: prepared.config, configVersion: s.configVersion, stage: s.stage, mode: s.mode, capabilityProof: s.capabilityProof, disclosure: STAGE_DISPATCH_DISCLOSURE, inputDigest: request.context.inputDigest, inputRevision: request.context.inputRevision, scopeRevision: request.context.scopeRevision, sourceRevisions: request.context.sourceRevisions, authorizationRevision: request.authorizationRevision } }
    },
  }
}
