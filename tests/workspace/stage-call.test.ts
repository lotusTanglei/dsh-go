import { afterEach, describe, expect, it } from 'vitest'
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { openStore } from '../../src/store/index.js'
import {
  STAGES, createStageModels, type DshStageLlm, type StageCallConfig, type StageModelConfig,
  type StageModelInfo, type StageRunContext,
} from '../../src/workspace/stage-models.js'
import { createStageCallHost, type StageCallHost } from '../../src/workspace/stage-call.js'

const cleanups: Array<() => void> = []
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean() })
function database() {
  const root = realpathSync(tmpdir()), dir = resolve(mkdtempSync(join(root, 'stage-call-test-')))
  const identity = lstatSync(dir), dbPath = join(dir, 'state.sqlite')
  const store = openStore({ dbPath })
  cleanups.push(() => {
    store.close()
    const target = resolve(dir), current = lstatSync(target)
    if (!isAbsolute(target) || target !== dir || dirname(target) !== root || realpathSync(target) !== dir || !basename(target).startsWith('stage-call-test-') || !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe fixture cleanup')
    rmSync(target, { recursive: true, force: true })
  })
  return store
}
function config(revision = 0, provider = 'fast', model = 'text', override?: { provider: string; model: string; reasoningEffort?: string }): StageModelConfig {
  const stages = Object.fromEntries(STAGES.map(stage => [stage, { mode: 'inherit' }])) as StageModelConfig['stages']
  return { revision, default: { provider, model }, stages: override ? { ...stages, locate: { mode: 'override', selection: override } } : stages }
}
const context = (requestId: string): StageRunContext => ({ requestId, inputRevision: 'input-v1', scopeRevision: 'scope-v1', sourceRevisions: [], dataCategories: ['text'] })
const pause = () => { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve }); return { promise, done } }

/** Real prepared-handle fake: checks the actual dispatch options, never reaches a provider. */
function fakeLlm() {
  const infos = new Map<string, StageModelInfo>([
    ['fast/text', { provider: 'fast', id: 'text', name: 'Fake text', inputModalities: ['text'], context: { contextWindow: 8192 } }],
    ['fast/unknown', { provider: 'fast', id: 'unknown', name: 'Fake unknown' }],
    ['strong/vision', { provider: 'strong', id: 'vision', name: 'Fake vision', inputModalities: ['text', 'image'], context: { contextWindow: 32768 }, reasoning: { efforts: [{ id: 'tiny', name: 'Tiny' }, { id: 'deep', name: 'Deep' }], defaultEffort: 'tiny' }, defaultMaxTokens: 800 }],
  ])
  const state = {
    prepareWait: undefined as (() => Promise<void>) | undefined,
    prepareCalls: 0, streamCalls: 0, throwStream: false,
    script: undefined as string | undefined,
    dispatched: [] as StageCallConfig[],
    onStream: undefined as (() => void) | undefined,
  }
  const llm: DshStageLlm = {
    async prepareCall(proposed, signal, configure) {
      state.prepareCalls++
      if (state.prepareWait) await state.prepareWait()
      signal?.throwIfAborted()
      const info = structuredClone(infos.get(`${proposed.provider}/${proposed.model}`)!)
      const { provider, model, ...controls } = proposed
      const configured = configure(Object.freeze(controls), Object.freeze(info))
      const resolved = Object.freeze({ provider, model, ...configured, ...(configured.reasoningEffort === undefined && info.reasoning?.defaultEffort ? { reasoningEffort: info.reasoning.defaultEffort } : {}), ...(info.defaultMaxTokens ? { maxTokens: info.defaultMaxTokens } : {}) })
      let used = false
      return {
        config: resolved, inputModalities: info.inputModalities, context: info.context,
        stream(options) {
          if (used) throw new Error('prepared call streamed twice')
          used = true
          state.streamCalls++
          state.onStream?.()
          expect(options.provider).toBe(resolved.provider)
          expect(options.model).toBe(resolved.model)
          expect(options.reasoningEffort).toBe(resolved.reasoningEffort)
          state.dispatched.push(resolved)
          const text = state.script ?? JSON.stringify({ action: 'continue', confidence: 0.9, hints: { objective: 'callback' } })
          return (async function* () {
            if (state.throwStream) throw new Error('fake wire failed')
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
  }
  return { llm, infos, state }
}
function catalog(infos: Map<string, StageModelInfo>, hidden = new Set<string>()) {
  return {
    listProviders: () => [{ id: 'fast', name: 'Fake fast' }, { id: 'strong', name: 'Fake strong' }],
    async listModels(provider: string) { return [...infos.values()].filter(info => info.provider === provider && !hidden.has(`${info.provider}/${info.id}`)) },
    async resolveModelInfo(provider: string, model: string) { const info = infos.get(`${provider}/${model}`); if (!info || hidden.has(`${provider}/${model}`)) throw new Error('fake model unavailable'); return structuredClone(info) },
  }
}
const EPOCH = 'epoch-fixture'

function fixture() {
  const store = database(), llm = fakeLlm()
  const controller = new AbortController(), version = { epoch: EPOCH }, paused = { value: false }
  const host: StageCallHost = createStageCallHost({
    store, llm: llm.llm, catalog: catalog(llm.infos),
    requireEpoch(epoch) {
      if (paused.value) throw Object.assign(new Error('epoch_mismatch'), { code: 'epoch_mismatch', status: 409 })
      if (epoch !== version.epoch) throw Object.assign(new Error('epoch_mismatch'), { code: 'epoch_mismatch', status: 409 })
    },
    signal: controller.signal,
    paused: () => paused.value,
  })
  const models = () => createStageModels(store, host.ports)
  const permit = (requestId: string, dataCategories: readonly string[] = ['text']) => host.issue({ requestId, epoch: EPOCH, stage: 'locate', dataCategories, sourceRevisions: [] })
  const run = async (service: ReturnType<typeof models>, requestId = randomUUID(), input: unknown = { text: '继续星河项目的工作' }, dataCategories: readonly string[] = ['text']) => {
    const revoke = permit(requestId, dataCategories)
    try { return await service.runStage('locate', {}, { input: input as any, context: { ...context(requestId), dataCategories } }) }
    finally { revoke() }
  }
  return {
    store, llm, host, models, permit, run,
    setPaused(value: boolean) { paused.value = value },
    async configured() { const service = models(); await service.save(config()); return service },
  }
}

describe('host stage-call adapter: actual prepared route, independent send gate, durable pre-dispatch journal', () => {
  it('runs one prepared call and returns the actual route, capability evidence and no-atomic-dispatch window', async () => {
    const f = fixture(), service = await f.configured()
    const result = await f.run(service)
    expect(result.state).toBe('completed')
    if (result.state !== 'completed') return
    expect(result.receipt).toMatchObject({
      stage: 'locate', mode: 'inherit', configVersion: 1,
      config: { provider: 'fast', model: 'text' },
      disclosure: { atomicProviderDispatch: false, window: 'authorization-to-provider-io', reason: 'dsh-llm-stream-middleware-may-await', providerDispatchPermit: 'unavailable' },
    })
    expect(result.receipt.capabilityProof).toMatchObject({ vision: 'unsupported', tools: 'unknown', structured: 'unknown', contextWindow: 8192, modelInfoEvidence: 'dsh.resolveModelInfo' })
    expect(result.receipt.disclosure.atomicProviderDispatch).toBe(false)
    expect(Object.isFrozen(result.receipt.disclosure)).toBe(true)
    expect(f.llm.state.streamCalls).toBe(1)
    expect(f.llm.state.dispatched[0]).toMatchObject({ provider: 'fast', model: 'text' })
  })

  it('writes the exact model-visible payload and prepared config before the stream is dispatched', async () => {
    const f = fixture(), service = await f.configured()
    let journalRowsAtDispatch = -1
    f.llm.state.onStream = () => { journalRowsAtDispatch = f.store.repos.side_effect.all().filter(row => row.kind === 'stage-call-v1').length }
    const result = await f.run(service)
    expect(result.state).toBe('completed')
    if (result.state !== 'completed') return
    expect(journalRowsAtDispatch).toBe(1)
    const row = f.store.repos.side_effect.get(`stage-call:v1:${result.receipt.callId}`)
    expect(row).toMatchObject({ kind: 'stage-call-v1', state: 'recorded' })
    const detail = row?.detail as any
    expect(detail).toMatchObject({ version: 1, stage: 'locate', mode: 'inherit', configVersion: 1, provider: 'fast', model: 'text', input: { text: '继续星河项目的工作' } })
    expect(detail.config).toMatchObject({ provider: 'fast', model: 'text' })
    expect(detail.system).toContain('JSON')
    expect(JSON.stringify(detail.messages)).toContain('继续星河项目的工作')
    expect(detail.inputDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(detail.modelVisibleDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(f.store.repos.audit.all())).not.toContain('继续星河项目的工作')
  })

  it('routes an override to the actual prepared model and inherits the default otherwise', async () => {
    const f = fixture(), service = f.models()
    await service.save(config(0, 'fast', 'text', { provider: 'strong', model: 'vision', reasoningEffort: 'deep' }))
    const first = await f.run(service)
    expect(first).toMatchObject({ state: 'completed', receipt: { mode: 'override', configVersion: 1, config: { provider: 'strong', model: 'vision', reasoningEffort: 'deep', maxTokens: 800 }, stage: 'locate' } })
    expect(f.llm.state.dispatched[0]).toMatchObject({ provider: 'strong', model: 'vision', reasoningEffort: 'deep' })
    await service.save(config(1))
    const second = await f.run(service)
    expect(second).toMatchObject({ state: 'completed', receipt: { mode: 'inherit', configVersion: 2, config: { provider: 'fast', model: 'text' } } })
    expect(f.llm.state.dispatched[1]).toMatchObject({ provider: 'fast', model: 'text' })
  })

  it('pins the in-flight configuration version while a later save only affects subsequent calls', async () => {
    const f = fixture(), service = await f.configured()
    const entered = pause(), release = pause()
    f.llm.state.prepareWait = async () => { entered.done(); await release.promise }
    const inFlight = f.run(service)
    await entered.promise
    await service.save(config(1, 'strong', 'vision'))
    release.done()
    expect(await inFlight).toMatchObject({ state: 'completed', receipt: { configVersion: 1, config: { provider: 'fast', model: 'text' } } })
    f.llm.state.prepareWait = undefined
    expect(await f.run(service)).toMatchObject({ state: 'completed', receipt: { configVersion: 2, config: { provider: 'strong', model: 'vision', reasoningEffort: 'tiny' } } })
    expect(f.llm.state.dispatched.map(entry => entry.provider)).toEqual(['fast', 'strong'])
  })

  it('blocks a send-gate denial with no stream, no retry and no model switch', async () => {
    const f = fixture(), service = await f.configured()
    const result = await f.run(service, randomUUID(), { text: 'synthetic' }, ['text', 'image'])
    expect(result).toMatchObject({ state: 'blocked', code: 'stage_models_authorization_denied' })
    expect(f.llm.state.prepareCalls).toBe(0)
    expect(f.llm.state.streamCalls).toBe(0)
  })

  it('blocks a call without a Host-issued send permit before any provider preparation', async () => {
    const f = fixture(), service = await f.configured()
    const result = await service.runStage('locate', {}, { input: { text: 'synthetic' }, context: context(randomUUID()) })
    expect(result).toMatchObject({ state: 'blocked', code: 'stage_models_binding_unavailable' })
    expect(f.llm.state.prepareCalls).toBe(0)
    expect(f.llm.state.streamCalls).toBe(0)
  })

  it('rejects a revoked permit before any provider preparation', async () => {
    const f = fixture(), service = await f.configured()
    const requestId = randomUUID(), revoke = f.permit(requestId)
    revoke()
    expect(await service.runStage('locate', {}, { input: { text: 'synthetic' }, context: context(requestId) })).toMatchObject({ state: 'blocked', code: 'stage_models_binding_unavailable' })
    expect(f.llm.state.prepareCalls).toBe(0)
    expect(f.llm.state.streamCalls).toBe(0)
  })

  it('blocks unavailable models without dispatch or fallback', async () => {
    const f = fixture(), service = await f.configured()
    const missing = createStageModels(f.store, { ...f.host.ports, catalog: catalog(f.llm.infos, new Set(['fast/text'])) })
    const requestId = randomUUID(), revoke = f.permit(requestId)
    try { expect(await missing.runStage('locate', {}, { input: { text: 'synthetic' }, context: context(requestId) })).toMatchObject({ state: 'blocked', code: 'stage_models_model_unavailable' }) } finally { revoke() }
    expect(f.llm.state.streamCalls).toBe(0)
  })

  it('blocks an unknown capability requirement and an unsupported vision requirement without dispatch', async () => {
    const f = fixture(), service = f.models()
    await service.save(config(0, 'fast', 'unknown'))
    const unknownId = randomUUID(), unknownPermit = f.permit(unknownId)
    try { expect(await service.runStage('locate', { vision: true }, { input: { text: 'synthetic' }, context: context(unknownId) })).toMatchObject({ state: 'blocked', code: 'stage_models_vision_unknown' }) } finally { unknownPermit() }
    await service.save(config(1, 'fast', 'text'))
    const unsupportedId = randomUUID(), unsupportedPermit = f.permit(unsupportedId)
    try { expect(await service.runStage('locate', { vision: true }, { input: { text: 'synthetic' }, context: context(unsupportedId) })).toMatchObject({ state: 'blocked', code: 'stage_models_vision_unsupported' }) } finally { unsupportedPermit() }
    expect(f.llm.state.streamCalls).toBe(0)
  })

  it('blocks a thrown authorization check and a structured-capability requirement without any stream', async () => {
    const f = fixture(), service = await f.configured()
    const throwing = createStageModels(f.store, { ...f.host.ports, authorize: async () => { throw new Error('fake authorization transport failed') } })
    const throwId = randomUUID(), throwPermit = f.permit(throwId)
    try { expect(await throwing.runStage('locate', {}, { input: { text: 'synthetic' }, context: context(throwId) })).toMatchObject({ state: 'blocked', code: 'stage_models_call_failed' }) } finally { throwPermit() }
    const structuredId = randomUUID(), structuredPermit = f.permit(structuredId)
    try { expect(await service.runStage('locate', { structured: true }, { input: { text: 'synthetic' }, context: context(structuredId) })).toMatchObject({ state: 'blocked', code: 'stage_models_structured_unknown' }) } finally { structuredPermit() }
    expect(f.llm.state.streamCalls).toBe(0)
  })

  it('blocks a single failed attempt without a second prepare or model switch', async () => {
    const f = fixture(), service = await f.configured()
    f.llm.state.throwStream = true
    const result = await f.run(service)
    expect(result).toMatchObject({ state: 'blocked', code: 'stage_models_call_failed', configVersion: 1 })
    expect(f.llm.state.prepareCalls).toBe(1)
    expect(f.llm.state.streamCalls).toBe(1)
  })

  it('rejects an adapter receipt that claims an atomic provider dispatch or a different route', async () => {
    const f = fixture(), service = await f.configured()
    const call = f.host.ports.call!
    const atomic = createStageModels(f.store, { ...f.host.ports, call: { async run(request) { const outcome = await call.run(request); return { ...outcome, receipt: { ...outcome.receipt, disclosure: { ...outcome.receipt.disclosure, atomicProviderDispatch: true as false } } } } } })
    const atomicId = randomUUID(), atomicPermit = f.permit(atomicId)
    try { expect(await atomic.runStage('locate', {}, { input: { text: 'synthetic' }, context: context(atomicId) })).toMatchObject({ state: 'blocked', code: 'stage_models_receipt_mismatch' }) } finally { atomicPermit() }
    const wrongRoute = createStageModels(f.store, { ...f.host.ports, call: { async run(request) { const outcome = await call.run(request); return { ...outcome, receipt: { ...outcome.receipt, config: { ...outcome.receipt.config, model: 'switched' } } } } } })
    const routeId = randomUUID(), routePermit = f.permit(routeId)
    try { expect(await wrongRoute.runStage('locate', {}, { input: { text: 'synthetic' }, context: context(routeId) })).toMatchObject({ state: 'blocked', code: 'stage_models_receipt_mismatch' }) } finally { routePermit() }
  })
})
