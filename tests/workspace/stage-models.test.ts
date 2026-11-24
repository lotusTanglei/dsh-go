import { afterEach, describe, expect, it } from 'vitest'
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeJson, openStore } from '../../src/store/index.js'
import {
  STAGES, createDshStageCallPort, createStageModels, parseStageModelConfig,
  type DshStageLlm, type StageCallConfig, type StageCallRequest, type StageJson,
  type StageModelConfig, type StageModelInfo, type StageModelPorts, type StageRunContext,
} from '../../src/workspace/stage-models.js'

const cleanups: Array<() => void> = []
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean() })
function database() {
  const root = realpathSync(tmpdir()), dir = resolve(mkdtempSync(join(root, 'stage-models-test-')))
  const identity = lstatSync(dir), dbPath = join(dir, 'state.sqlite')
  let store = openStore({ dbPath })
  cleanups.push(() => {
    store.close()
    const target = resolve(dir), current = lstatSync(target)
    if (!isAbsolute(target) || target !== dir || dirname(target) !== root || realpathSync(target) !== dir || !basename(target).startsWith('stage-models-test-') || !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe fixture cleanup')
    rmSync(target, { recursive: true, force: true })
  })
  return { get store() { return store }, reopen() { store.close(); store = openStore({ dbPath }); return store } }
}
function config(revision = 0, provider = 'fast', model = 'text'): StageModelConfig {
  return { revision, default: { provider, model }, stages: Object.fromEntries(STAGES.map(s => [s, { mode: 'inherit' }])) as StageModelConfig['stages'] }
}
function context(): StageRunContext {
  return { requestId: 'request-1', inputRevision: 'input-v1', scopeRevision: 'scope-v1', sourceRevisions: [{ sourceId: 'source-1', revision: 'source-v1' }], dataCategories: ['text'] }
}
const pause = () => { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve }); return { promise, done } }

/** Real per-call fake provider: checks actual prepared config at its stream boundary, never invokes DSH/provider I/O. */
function fixture() {
  const db = database(), captured: Array<{ config: StageCallConfig; request: StageCallRequest }> = []
  const calls: Array<{ config: StageCallConfig; options: Readonly<Record<string, unknown>> }> = []
  const records: Array<{ config: StageCallConfig; input: StageJson; version: number }> = []
  const infos = new Map<string, StageModelInfo>([
    ['fast/text', { provider: 'fast', id: 'text', name: 'Fake text', inputModalities: ['text'], context: { contextWindow: 8192 } }],
    ['strong/vision', { provider: 'strong', id: 'vision', name: 'Fake vision', inputModalities: ['text', 'image'], context: { contextWindow: 32768 }, reasoning: { efforts: [{ id: 'tiny', name: 'Tiny' }, { id: 'deep', name: 'Deep' }], defaultEffort: 'tiny' }, defaultMaxTokens: 800 }],
    ['fast/unknown', { provider: 'fast', id: 'unknown', name: 'Fake unknown' }],
  ])
  const state = {
    scope: 'scope-v1', source: 'source-v1', input: 'input-v1', grant: 'grant-v1', allow: true,
    listWait: undefined as (() => Promise<void>) | undefined,
    infoWait: undefined as (() => Promise<void>) | undefined,
    authorizeWait: undefined as (() => Promise<void>) | undefined,
    prepareWait: undefined as (() => Promise<void>) | undefined,
    recordWait: undefined as (() => Promise<void>) | undefined,
    consumeWait: undefined as (() => Promise<void>) | undefined,
    preConsumeWait: undefined as (() => Promise<void>) | undefined,
    preparedInfo: undefined as StageModelInfo | undefined,
    throwStream: false, mismatchConfig: false, nativeSelections: 0, terminal: 'stop', omitTerminal: false, skipConsume: false,
    attest: true, attestationRevision: 0,
  }
  const expected: StageCallConfig[] = []
  const assertionErrors: unknown[] = []
  const assert = (fn: () => void) => { try { fn() } catch (e) { assertionErrors.push(e); throw e } }
  cleanups.push(() => { expect(assertionErrors).toEqual([]); expect(state.nativeSelections).toBe(0) })
  const llm: DshStageLlm = {
    async prepareCall(proposed, signal, configure) {
      if (state.prepareWait) await state.prepareWait()
      signal?.throwIfAborted()
      const info = structuredClone(state.preparedInfo ?? infos.get(`${proposed.provider}/${proposed.model}`)!)
      const { provider, model, ...controls } = proposed
      const configured = configure(Object.freeze(controls), Object.freeze(info))
      const resolved = Object.freeze({ provider, model, ...configured, ...(configured.reasoningEffort === undefined && info.reasoning?.defaultEffort ? { reasoningEffort: info.reasoning.defaultEffort } : {}), ...(info.defaultMaxTokens ? { maxTokens: info.defaultMaxTokens } : {}) })
      let used = false
      return {
        config: state.mismatchConfig ? { ...resolved, model: 'wrong' } : resolved,
        inputModalities: info.inputModalities, context: info.context,
        stream(options) {
          assert(() => {
            expect(used).toBe(false)
            expect(options.provider).toBe(resolved.provider)
            expect(options.model).toBe(resolved.model)
            expect(options.reasoningEffort).toBe(resolved.reasoningEffort)
            expect(options.maxTokens).toBe(resolved.maxTokens)
            expect(records.length).toBeGreaterThan(calls.length)
            if (expected.length) expect(resolved).toMatchObject(expected.shift()!)
          })
          used = true; calls.push({ config: resolved, options })
          return (async function* () { if (state.throwStream) throw new Error('fake wire failed'); if (!state.omitTerminal) yield { type: 'finish', reason: { kind: state.terminal }, output: `${provider}/${model}/${resolved.reasoningEffort ?? 'provider-default'}` } })()
        },
      }
    },
  }
  const call = createDshStageCallPort(llm, {
    async record(request, callConfig) {
      if (state.recordWait) await state.recordWait()
      records.push({ config: callConfig, input: request.input, version: request.snapshot.configVersion })
      captured.push({ config: callConfig, request })
      // A malicious assembly cannot override actual config or abort at dispatch.
      return { callId: `fake-call-${records.length}`, options: { provider: 'evil', model: 'evil', reasoningEffort: 'evil', messages: [{ role: 'user', content: request.input }] } }
    },
    async consume(chunks) {
      if (state.preConsumeWait) await state.preConsumeWait()
      if (state.skipConsume) return 'forged success without consuming stream'
      let output: StageJson = null
      for await (const chunk of chunks) {
        if (state.consumeWait) await state.consumeWait()
        output = (chunk as { output: string }).output
      }
      return output
    },
  })
  const ports: StageModelPorts = {
    catalog: {
      listProviders: () => [{ id: 'fast', name: 'Fake fast' }, { id: 'strong', name: 'Fake strong' }],
      async listModels(provider) { if (state.listWait) await state.listWait(); return [...infos.values()].filter(i => i.provider === provider) },
      async resolveModelInfo(provider, model) { if (state.infoWait) await state.infoWait(); return structuredClone(infos.get(`${provider}/${model}`)!) },
    },
    async capabilities() {
      const revision = state.attestationRevision
      return { ...(state.attest ? { tools: true, structured: true } : {}), evidenceRefs: ['fake-host-tested-capabilities'], fence() { if (revision !== state.attestationRevision) throw new Error('attestation revoked') } }
    },
    async bind(c) {
      return { fence() { if (c.scopeRevision !== state.scope || c.inputRevision !== state.input || c.sourceRevisions[0]?.revision !== state.source) throw new Error('stale binding') } }
    },
    async authorize(snapshot, c) {
      assert(() => { expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(c.sourceRevisions)).toBe(true); expect(snapshot.provider).not.toBe('evil') })
      if (state.authorizeWait) await state.authorizeWait()
      if (!state.allow) return { allowed: false, code: 'fake-permission-denied' }
      const revision = state.grant
      return { allowed: true, authorizationRevision: revision, fence() { if (revision !== state.grant || !state.allow) throw new Error('grant revoked') } }
    },
    call,
  }
  let service = createStageModels(db.store, ports)
  return { db, ports, state, infos, calls, records, captured, expected, get service() { return service }, reopen() { service = createStageModels(db.reopen(), ports) }, run: (stage: 'locate' | 'understand' = 'locate', req = {}, signal?: AbortSignal) => service.runStage(stage, req, { input: { text: 'synthetic input' }, context: context(), signal }) }
}

describe('G5 Host stage models', () => {
  it('snapshots a denied authorization before binding fences can mutate it into an allowed permit', async () => {
    const f = fixture(); await f.service.save(config())
    const decision: any = { allowed: false, code: 'synthetic_denied' }; let mutate = false
    const service = createStageModels(f.db.store, { ...f.ports,
      bind: async () => ({ fence() { if (mutate) Object.assign(decision, { allowed: true, authorizationRevision: 'forged', fence() {} }) } }),
      authorize: async () => { mutate = true; return decision },
    })
    expect(await service.runStage('locate', {}, { input: { text: 'synthetic input' }, context: context() })).toMatchObject({ state: 'blocked', code: 'stage_models_authorization_denied' }); expect(f.calls).toHaveLength(0); expect(f.records).toHaveLength(0)
  })
  it('starts visibly unconfigured, never copies or mutates the global/Agent model', async () => {
    const f = fixture(), view = await f.service.settings()
    expect(view).toMatchObject({ config: null, configVersion: 0, existingSessionModelPolicy: 'preserve', existingSessionOverride: 'unsupported' })
    expect(Object.values(view.stages)).toHaveLength(6)
    expect(Object.values(view.stages).every(s => s.state === 'blocked')).toBe(true)
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_not_configured' })
    expect(f.calls).toEqual([])
  })

  it('saves default+override, discloses exact effort, and sends actual prepared route receipt', async () => {
    const f = fixture(), c = config()
    const saved = await f.service.save({ ...c, stages: { ...c.stages, understand: { mode: 'override', selection: { provider: 'strong', model: 'vision', reasoningEffort: 'deep' } } } })
    expect(saved.configVersion).toBe(1)
    expect(saved.stages.locate).toMatchObject({ provider: 'fast', model: 'text', configVersion: 1 })
    expect(saved.stages.understand).toMatchObject({ provider: 'strong', model: 'vision', reasoningEffort: 'deep' })
    f.expected.push({ provider: 'strong', model: 'vision', reasoningEffort: 'deep', maxTokens: 800 })
    const result = await f.run('understand', { vision: true, tools: true, structured: true, minContextTokens: 30000 })
    expect(result).toMatchObject({ state: 'completed', output: 'strong/vision/deep', receipt: { configVersion: 1, config: { provider: 'strong', model: 'vision', reasoningEffort: 'deep', maxTokens: 800 }, scopeRevision: 'scope-v1' } })
    expect(f.calls).toHaveLength(1) // six responsibilities, not six automatic calls
    expect(f.records[0]).toMatchObject({ version: 1, input: { text: 'synthetic input' } })
    if (result.state !== 'completed') throw new Error('expected completed')
    expect(Object.isFrozen(result.snapshot)).toBe(true)
    expect(Object.isFrozen(result.snapshot.capabilityProof.hostEvidence)).toBe(true)
    expect(Object.isFrozen(result.receipt)).toBe(true)
  })

  it('materializes only exact-model advertised default effort and rejects aliases/unknown efforts', async () => {
    const f = fixture()
    const saved = await f.service.save(config(0, 'strong', 'vision'))
    expect(saved.stages.plan).toMatchObject({ reasoningEffort: 'tiny' })
    expect(await f.run()).toMatchObject({ state: 'completed', output: 'strong/vision/tiny' })
    await expect(f.service.save({ ...config(1, 'strong', 'vision'), default: { provider: 'strong', model: 'vision', reasoningEffort: 'high' } })).rejects.toMatchObject({ code: 'stage_models_reasoning_unsupported' })
    await expect(f.service.save({ ...config(1), default: { provider: 'fast', model: 'text', reasoningEffort: 'tiny' } })).rejects.toMatchObject({ code: 'stage_models_reasoning_unsupported' })
    expect((await f.service.settings()).configVersion).toBe(1)
  })

  it.each(['defaultEffort', 'reasoningEfforts', 'contextWindow', 'inputModalities', 'defaultMaxTokens'] as const)('blocks saved %s drift without changing configVersion until explicitly saved again', async key => {
    const f = fixture(); await f.service.save(config(0, 'strong', 'vision'))
    const before = f.db.store.repos.kv.get('stage-models:v1')!.v
    const info = f.infos.get('strong/vision')!
    const changed: StageModelInfo = key === 'defaultEffort' ? { ...info, reasoning: { ...info.reasoning!, defaultEffort: 'deep' } }
      : key === 'reasoningEfforts' ? { ...info, reasoning: { efforts: [{ id: 'tiny', name: 'Tiny' }], defaultEffort: 'tiny' } }
      : key === 'contextWindow' ? { ...info, context: { contextWindow: 16000 } }
      : key === 'inputModalities' ? { ...info, inputModalities: ['text'] }
      : { ...info, defaultMaxTokens: 400 }
    f.infos.set('strong/vision', changed)
    f.reopen()
    const view = await f.service.settings()
    expect(view.configVersion).toBe(1)
    expect(Object.values(view.stages).every(stage => stage.state === 'blocked' && stage.code === 'stage_models_capability_changed')).toBe(true)
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_capability_changed', configVersion: 1 })
    expect(f.calls).toEqual([])
    expect(f.db.store.repos.kv.get('stage-models:v1')!.v).toEqual(before)
    const resaved = await f.service.save(config(1, 'strong', 'vision'))
    expect(resaved.stages.locate).toMatchObject({ state: 'ready', configVersion: 2, reasoningEffort: changed.reasoning!.defaultEffort })
    expect(f.db.store.repos.kv.get('stage-models:baseline:v1:1')).toBeDefined()
    expect(f.db.store.repos.kv.get('stage-models:baseline:v1:2')).toBeDefined()
  })

  it('never downgrades an explicit effort when provider removes it', async () => {
    const f = fixture(), c = { ...config(0, 'strong', 'vision'), default: { provider: 'strong', model: 'vision', reasoningEffort: 'deep' } }
    await f.service.save(c)
    f.infos.set('strong/vision', { ...f.infos.get('strong/vision')!, reasoning: { efforts: [{ id: 'tiny', name: 'Tiny' }], defaultEffort: 'tiny' } })
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_capability_changed', configVersion: 1 })
    await expect(f.service.save({ ...c, revision: 1 })).rejects.toMatchObject({ code: 'stage_models_reasoning_unsupported' })
    expect((await f.service.settings()).config?.default.reasoningEffort).toBe('deep')
    expect(f.calls).toEqual([])
  })

  it('preserves legacy config without baseline and blocks until explicit resave', async () => {
    const f = fixture(), old = config(1, 'strong', 'vision')
    f.db.store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run('stage-models:v1', encodeJson(old, false))
    f.reopen()
    expect((await f.service.settings()).stages.locate).toMatchObject({ state: 'blocked', code: 'stage_models_baseline_missing', configVersion: 1 })
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_baseline_missing' })
    expect(f.db.store.repos.kv.get('stage-models:v1')!.v).toEqual(old)
    expect(f.db.store.repos.kv.get('stage-models:baseline:v1:1')).toBeUndefined()
    expect(f.calls).toEqual([])
    expect((await f.service.save(old)).stages.locate).toMatchObject({ state: 'ready', configVersion: 2 })
  })

  it('rolls config and baseline back together when onCommit rejects', async () => {
    const f = fixture(); await f.service.save(config())
    const baseline = f.db.store.repos.kv.get('stage-models:baseline:v1:1')!.v
    await expect(f.service.save(config(1, 'strong', 'vision'), () => {}, () => { throw new Error('epoch changed in commit') })).rejects.toThrow('epoch changed in commit')
    expect((await f.service.settings()).config).toMatchObject({ revision: 1, default: { provider: 'fast', model: 'text' } })
    expect(f.db.store.repos.kv.get('stage-models:baseline:v1:1')!.v).toEqual(baseline)
    expect(f.db.store.repos.kv.get('stage-models:baseline:v1:2')).toBeUndefined()
  })

  it.each([
    { vision: true, code: 'stage_models_vision_unknown' },
    { tools: true, code: 'stage_models_tools_unknown' },
    { structured: true, code: 'stage_models_structured_unknown' },
    { minContextTokens: 1, code: 'stage_models_context_unknown' },
  ])('rejects unknown capabilities without fallback: %j', async ({ code, ...req }) => {
    const f = fixture(); f.state.attest = false
    await f.service.save(config(0, 'fast', 'unknown'))
    expect(await f.run('locate', req)).toMatchObject({ state: 'blocked', code })
    expect(f.calls).toEqual([])
  })

  it('rejects explicit negative vision and insufficient context, no silent model switch', async () => {
    const f = fixture(); await f.service.save(config())
    expect(await f.run('understand', { vision: true })).toMatchObject({ state: 'blocked', code: 'stage_models_vision_unsupported' })
    expect(await f.run('locate', { minContextTokens: 9000 })).toMatchObject({ state: 'blocked', code: 'stage_models_context_incompatible' })
    expect(f.calls).toEqual([])
  })

  it('requires Host catalog membership and exact model identity, not arbitrary route strings', async () => {
    const f = fixture()
    await expect(f.service.save(config(0, 'unknown', 'text'))).rejects.toMatchObject({ code: 'stage_models_provider_unavailable' })
    await expect(f.service.save(config(0, 'fast', 'not-in-catalog'))).rejects.toMatchObject({ code: 'stage_models_model_unavailable' })
    f.infos.set('fast/text', { provider: 'other', id: 'text', name: 'wrong' })
    // The listing itself no longer contains this provider; no request to an unlisted route.
    await expect(f.service.save(config())).rejects.toMatchObject({ code: 'stage_models_model_unavailable' })
    expect(f.db.store.repos.kv.get('stage-models:v1')).toBeUndefined()
  })

  it('strictly rejects extra, missing, malformed fields including existing-session override', () => {
    const c = config()
    for (const invalid of [
      { ...c, overrideExisting: true }, { ...c, revision: 0.1 }, { ...c, stages: { ...c.stages, other: { mode: 'inherit' } } },
      { ...c, stages: { ...c.stages, verify: undefined } }, { ...c, stages: { ...c.stages, execute: { mode: 'inherit', selection: c.default } } },
      { ...c, default: { ...c.default, reasoningEffort: undefined } }, { ...c, default: { provider: '', model: 'text' } },
      { ...c, stages: { ...c.stages, plan: { mode: 'fallback' } } },
    ]) expect(() => parseStageModelConfig(invalid)).toThrow()
  })

  it('CAS survives async races and restart, never overwrites the winning config', async () => {
    const f = fixture(), entered = pause(), release = pause()
    let waiting = false
    f.state.listWait = async () => { if (!waiting) { waiting = true; entered.done(); await release.promise } }
    const first = f.service.save(config())
    await entered.promise
    const second = await f.service.save(config(0, 'strong', 'vision'))
    expect(second.configVersion).toBe(1)
    release.done()
    await expect(first).rejects.toMatchObject({ code: 'stage_models_revision_conflict' })
    f.reopen()
    expect((await f.service.settings()).config).toMatchObject({ revision: 1, default: { provider: 'strong', model: 'vision' } })
    await expect(f.service.save(config())).rejects.toMatchObject({ code: 'stage_models_revision_conflict' })
  })

  it('pins inflight version and route while new configuration routes independent concurrent calls', async () => {
    const f = fixture(); await f.service.save(config())
    const entered = pause(), release = pause(); let waiting = false
    f.state.authorizeWait = async () => { if (!waiting) { waiting = true; entered.done(); await release.promise } }
    const first = f.run()
    await entered.promise
    await f.service.save(config(1, 'strong', 'vision'))
    expect(await f.run()).toMatchObject({ state: 'completed', snapshot: { provider: 'strong', model: 'vision', configVersion: 2 }, receipt: { configVersion: 2 } })
    release.done()
    expect(await first).toMatchObject({ state: 'completed', snapshot: { provider: 'fast', model: 'text', configVersion: 1 }, receipt: { configVersion: 1 } })
    expect(f.calls.map(c => c.config.provider)).toEqual(['strong', 'fast'])
  })

  it('model selection never grants permission; missing production gate/call stays blocked', async () => {
    const f = fixture(); await f.service.save(config())
    f.state.allow = false
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_authorization_denied' })
    expect(f.calls).toEqual([])
    const noGate = createStageModels(f.db.store, { catalog: f.ports.catalog, capabilities: f.ports.capabilities, bind: f.ports.bind, call: f.ports.call })
    expect(await noGate.runStage('locate', {}, { input: null, context: context() })).toMatchObject({ state: 'blocked', code: 'stage_models_authorization_unavailable' })
    const noCall = createStageModels(f.db.store, { ...f.ports, call: undefined }); f.state.allow = true
    expect(await noCall.runStage('locate', {}, { input: null, context: context() })).toMatchObject({ state: 'blocked', code: 'stage_models_call_unavailable' })
    expect(f.calls).toEqual([])
  })

  it.each(['listWait', 'infoWait', 'authorizeWait', 'prepareWait', 'recordWait'] as const)('rechecks scope after %s before external dispatch', async key => {
    const f = fixture(); await f.service.save(config())
    const entered = pause(), release = pause()
    f.state[key] = async () => { entered.done(); await release.promise }
    const running = f.run(); await entered.promise; f.state.scope = 'scope-v2'; release.done()
    expect(await running).toMatchObject({ state: 'blocked', code: 'stage_models_binding_stale' })
    expect(f.calls).toEqual([])
  })

  it.each(['input', 'source', 'grant'] as const)('rejects stale %s after async authorization', async key => {
    const f = fixture(); await f.service.save(config())
    const entered = pause(), release = pause()
    f.state.authorizeWait = async () => { entered.done(); await release.promise }
    const running = f.run(); await entered.promise; f.state[key] = `${key}-v2`; release.done()
    const result = await running
    if (key === 'grant') expect(result).toMatchObject({ state: 'completed' }) // authorization is freshly granted after await
    else { expect(result).toMatchObject({ state: 'blocked', code: 'stage_models_binding_stale' }); expect(f.calls).toEqual([]) }
  })

  it('revokes grants before dispatch and suppresses late output after external dispatch', async () => {
    const f = fixture(); await f.service.save(config())
    const entered = pause(), release = pause()
    f.state.recordWait = async () => { entered.done(); await release.promise }
    const running = f.run(); await entered.promise; f.state.grant = 'grant-v2'; release.done()
    expect(await running).toMatchObject({ state: 'blocked', code: 'stage_models_authorization_stale' }); expect(f.calls).toEqual([])
    f.state.recordWait = undefined
    const consumed = pause(), finish = pause()
    f.state.consumeWait = async () => { consumed.done(); await finish.promise }
    const late = f.run(); await consumed.promise; f.state.scope = 'scope-v2'; finish.done()
    expect(await late).toMatchObject({ state: 'blocked', code: 'stage_models_binding_stale' })
    expect(f.calls).toHaveLength(1) // external data cannot be retracted; output is withheld
  })

  it('rechecks revoked authorization after consume waits before its first iterator request', async () => {
    const f = fixture(); await f.service.save(config())
    const entered = pause(), release = pause()
    f.state.preConsumeWait = async () => { entered.done(); await release.promise }
    const running = f.run(); await entered.promise
    expect(f.records).toHaveLength(1)
    expect(f.calls).toEqual([])
    f.state.grant = 'grant-v2'; release.done()
    expect(await running).toMatchObject({ state: 'blocked', code: 'stage_models_authorization_stale' })
    expect(f.calls).toEqual([]) // No stream construction/dispatch; not a claim about DSH middleware's own awaits.
  })

  it('abort is checked before and after every async boundary, with no dispatch/no fallback', async () => {
    const f = fixture(); await f.service.save(config())
    const already = new AbortController(); already.abort()
    expect(await f.run('locate', {}, already.signal)).toMatchObject({ state: 'blocked', code: 'stage_models_aborted' })
    const entered = pause(), release = pause(), active = new AbortController()
    f.state.prepareWait = async () => { entered.done(); await release.promise }
    const pending = f.run('locate', {}, active.signal); await entered.promise; active.abort(); release.done()
    expect(await pending).toMatchObject({ state: 'blocked', code: 'stage_models_aborted' }); expect(f.calls).toEqual([])
  })

  it('rejects changed adapter generation metadata or route instead of mixing proof and dispatch', async () => {
    const f = fixture(); await f.service.save(config(0, 'strong', 'vision'))
    f.state.preparedInfo = { ...f.infos.get('strong/vision')!, inputModalities: ['text'] }
    expect(await f.run('understand', { vision: true })).toMatchObject({ state: 'blocked', code: 'stage_models_prepared_capability_changed' })
    f.state.preparedInfo = undefined; f.state.mismatchConfig = true
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_prepared_route_changed' })
    expect(f.calls).toEqual([])
  })

  it('failed provider attempt is visible blocked, no retry and no fallback to other stage/default', async () => {
    const f = fixture(); await f.service.save(config()); f.state.throwStream = true
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_call_failed', configVersion: 1 })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.config).toMatchObject({ provider: 'fast', model: 'text' })
  })

  it('does not trust a forged per-call receipt and does not leak input via blocked errors', async () => {
    const f = fixture(); await f.service.save(config())
    const original = f.ports.call!
    const bad = createStageModels(f.db.store, { ...f.ports, call: { async run(req) { const r = await original.run(req); return { ...r, receipt: { ...r.receipt, configVersion: 999 } } } } })
    expect(await bad.runStage('locate', {}, { input: 'sensitive fake body', context: context() })).toEqual({ state: 'blocked', code: 'stage_models_receipt_mismatch', configVersion: 1 })
  })

  it.each(['error', 'aborted', 'max-tokens', 'tool-calls', 'unknown'])('never treats terminal %s as a successful stage', async terminal => {
    const f = fixture(); await f.service.save(config()); f.state.terminal = terminal
    expect(await f.run()).toMatchObject({ state: 'blocked', code: ['error', 'aborted'].includes(terminal) ? 'stage_models_call_failed' : 'stage_models_stream_incomplete' })
    expect(f.calls).toHaveLength(1)
  })

  it('requires a terminal stream and actual consumption, not an output-only fake adapter', async () => {
    const f = fixture(); await f.service.save(config()); f.state.omitTerminal = true
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_stream_incomplete' })
    f.state.omitTerminal = false; f.state.skipConsume = true
    expect(await f.run()).toMatchObject({ state: 'blocked', code: 'stage_models_stream_incomplete' })
  })

  it('unknown tools/structured stay unknown without a separate Host attestation', async () => {
    const f = fixture(); await f.service.save(config())
    const noAttestation = createStageModels(f.db.store, { ...f.ports, capabilities: undefined })
    expect(await noAttestation.resolve('plan', { tools: true })).toMatchObject({ state: 'blocked', code: 'stage_models_capability_changed' })
    await noAttestation.save(config(1)) // Removing saved attestation requires explicit versioned confirmation too.
    expect(await noAttestation.resolve('plan', { tools: true })).toMatchObject({ state: 'blocked', code: 'stage_models_tools_unknown' })
    expect(await noAttestation.resolve('verify', { structured: true })).toMatchObject({ state: 'blocked', code: 'stage_models_structured_unknown' })
  })

  it('invalid persisted schema never resets to defaults or rewrites the corrupt record', async () => {
    const f = fixture(), raw = encodeJson({ ...config(1), overrideExisting: true }, false)
    f.db.store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run('stage-models:v1', raw)
    f.reopen()
    expect(await f.service.resolve('locate')).toMatchObject({ state: 'blocked', code: 'stage_models_schema_invalid' })
    expect(f.db.store.db.prepare('SELECT v FROM kv WHERE k=?').get('stage-models:v1')?.v).toBe(raw)
    expect(f.calls).toEqual([])
  })

  it('input/source canonical schema rejects non-JSON, sparse, accessor and extra-context fields', async () => {
    const f = fixture(); await f.service.save(config())
    const accessor = Object.defineProperty({}, 'text', { get() { throw new Error('must not execute getter') }, enumerable: true })
    for (const input of [NaN, [undefined], new Array(1), accessor]) {
      expect(await f.service.runStage('locate', {}, { input: input as StageJson, context: context() })).toMatchObject({ state: 'blocked' })
    }
    expect(await f.service.runStage('locate', {}, { input: null, context: { ...context(), actor: 'model-self-approved' } as StageRunContext })).toMatchObject({ state: 'blocked', code: 'stage_models_schema_invalid' })
    expect(f.calls).toEqual([])
  })

  it('captures detached input and sources before awaits, mutation cannot retarget the pending run', async () => {
    const f = fixture(); await f.service.save(config())
    const entered = pause(), release = pause()
    f.state.listWait = async () => { entered.done(); await release.promise }
    const input = { text: 'original' }, c = { ...context(), sourceRevisions: [{ sourceId: 'source-1', revision: 'source-v1' }] }
    const running = f.service.runStage('locate', {}, { input, context: c }); await entered.promise
    input.text = 'mutated'; c.sourceRevisions[0]!.revision = 'mutated'; release.done()
    expect(await running).toMatchObject({ state: 'completed', receipt: { sourceRevisions: [{ sourceId: 'source-1', revision: 'source-v1' }] } })
    expect(f.records[0]?.input).toEqual({ text: 'original' })
  })
})
