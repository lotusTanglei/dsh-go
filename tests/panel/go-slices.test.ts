import { afterEach, describe, expect, it } from 'vitest'
import { lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openStore } from '../../src/store/index.js'
import { installPanelRoutes } from '../../src/panel/routes.js'
import { createConfigMutations, type ConfigMutationJSON, type ConfigMutationKind } from '../../src/workspace/config-mutations.js'
import { createStageModels, STAGES } from '../../src/workspace/stage-models.js'
import { bindWorkspace, WorkspaceError } from '../../src/workspace/commands.js'
import { createSessionDecisions, sessionDecisionDigest } from '../../src/workspace/session-decisions.js'

const cleanups: Array<() => void> = []
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn() })
const jsonValue = (value: unknown): ConfigMutationJSON => JSON.parse(JSON.stringify(value))
function fixture() {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, 'go-route-fixture-')), identity = lstatSync(root)
  cleanups.push(() => { const stat = lstatSync(root); if (dirname(root) !== parent || !basename(root).startsWith('go-route-fixture-') || realpathSync(root) !== root || !stat.isDirectory() || stat.isSymbolicLink() || stat.ino !== identity.ino || stat.dev !== identity.dev) throw new Error('unsafe fixture cleanup'); rmSync(root, { recursive: true }) })
  const store = openStore({ dbPath: join(root, 'fixture.sqlite') }); cleanups.push(() => store.close())
  const epoch = bindWorkspace(store, 'route-fixture').current.epoch, requireEpoch = (value: string) => { if (value !== epoch) throw new WorkspaceError('epoch_mismatch', 409) }
  const mutations = createConfigMutations(store, { requireEpoch }), signal = new AbortController().signal
  const models = createStageModels(store, { catalog: { listProviders: () => [{ id: 'synthetic', name: 'Synthetic' }], async listModels() { return [{ provider: 'synthetic', id: 'model', name: 'Model' }] }, async resolveModelInfo() { return { provider: 'synthetic', id: 'model', name: 'Model', context: { contextWindow: 4096 }, defaultMaxTokens: 1024, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'balanced', name: 'Balanced' }], defaultEffort: 'balanced' } } } } })
  const mutationPort = (service: any, prefix: string) => async (input: any) => {
    const { action, requestId, epoch: requestedEpoch, ...body } = input
    requireEpoch(requestedEpoch)
    if (['configure', 'remove', 'scan'].includes(action)) return mutations.run({ epoch: requestedEpoch, requestId, kind: `${prefix}-${action}` as ConfigMutationKind, payload: body }, async commit => jsonValue(await service[action]({ epoch: requestedEpoch, ...body }, (value: unknown) => commit(jsonValue(value)))))
    return service[action === 'plan-origin' ? 'planOrigin' : action]({ epoch: requestedEpoch, ...body, ...(['claim', 'plan-origin'].includes(action) ? { requestId } : {}) })
  }
  const forbidden = () => { throw new Error('closure must not read or dispatch a target') }
  const decisions = createSessionDecisions(store, { requireEpoch, target: forbidden, questions: forbidden, gate: forbidden, dispatch: forbidden, evidence: forbidden })
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const ports: any = {
    async sessionDecision(input: any) { const { action, ...payload } = input; return action === 'close' ? decisions.close(payload) : action === 'prepare' ? decisions.prepare(payload) : decisions.status(payload) },
    async configMutation(input: any) { const { action, ...body } = input; return action === 'close' ? mutations.close(body) : mutations.status(body) },
    async stageModels(input: any) { requireEpoch(input.epoch); if (input.action !== 'save') return models.settings(); return mutations.run({ epoch, requestId: input.requestId, kind: 'stage-save', payload: { config: input.config } }, async (commit, checkpoint) => jsonValue(await models.save(input.config, checkpoint, value => commit(jsonValue(value))))) },
  }
  installPanelRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => { routes.delete(route.path) } } } } }, store, {}, ports)
  const post = async (path: string, body: any, origin?: string) => {
    const response = await routes.get(`/api/superagent/${path}`)!(new Request(`http://localhost/api/superagent/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }))
    return { status: response.status, ...(await response.json()) as any }
  }
  return { post, root, epoch, ports, store }
}

describe('Go HTTP integration with real isolated SQLite, no provider or remote document call', () => {
  it('preserves full actual model capability/default metadata in save and status receipts without a generic stage-models call action', async () => {
    const f = fixture(), config = { revision: 0, default: { provider: 'synthetic', model: 'model' }, stages: Object.fromEntries(STAGES.map(stage => [stage, { mode: 'inherit' }])) }, requestId = randomUUID()
    const saved = await f.post('stage-models', { action: 'save', epoch: f.epoch, requestId, config })
    expect(saved.status).toBe(200); expect(saved.data.mutation.state).toBe('settled')
    expect(saved.data.value.stages.understand.capabilityProof).toMatchObject({ inputModalities: ['text', 'image'], defaultMaxTokens: 1024, defaultEffort: 'balanced', tools: 'unknown', structured: 'unknown' })
    expect((await f.post('config-mutation', { action: 'status', epoch: f.epoch, requestId })).data).toEqual(saved.data)
    expect((await f.post('stage-models', { action: 'runStage', epoch: f.epoch, config })).status).toBe(400)
  })
  it('durably closes only the original missing answer ID across HTTP without reading or dispatching a target', async () => {
    const f = fixture(), input = { epoch: f.epoch, requestId: randomUUID(), actionId: randomUUID(), target: { sessionId: 'session-one', scopeRevision: 'a'.repeat(64), factRevision: 'b'.repeat(64) }, callId: 'question-call', snapshot: { asOfSeq: 4, revision: 'c'.repeat(64) }, answers: [{ id: '范围说明 🌏', selected: [], custom: 'Keep exact answer, not operation approval' }] }
    expect((await f.post('session-decision', { action: 'status', epoch: f.epoch, actionId: input.actionId })).status).toBe(404)
    const closed = await f.post('session-decision', { action: 'close', ...input })
    expect(closed.status).toBe(200); expect(closed.data).toEqual({ version: 1, epoch: input.epoch, requestId: input.requestId, actionId: input.actionId, target: input.target, callId: input.callId, snapshot: input.snapshot, digest: sessionDecisionDigest(input), seq: 1, at: expect.any(Number), updatedAt: expect.any(Number), state: 'closed', bindingVerified: false, durable: true, accepted: false, executed: null, completed: null, approval: false, disposition: 'closed-before-dispatch', code: 'session_decision_id_closed' })
    expect((await f.post('session-decision', { action: 'status', epoch: f.epoch, actionId: input.actionId })).data).toEqual(closed.data)
    expect((await f.post('session-decision', { action: 'prepare', ...input })).data).toEqual(closed.data)
    expect((await f.post('session-decision', { action: 'close', ...input, answers: [{ ...input.answers[0], custom: 'changed answer' }] })).status).toBe(409)
    expect((await f.post('session-decision', { action: 'close', ...input, target: { ...input.target, project: { kind: 'project', key: 'forged' } } })).status).toBe(400)
    expect((await f.post('session-decision', { action: 'close', ...input, actor: 'owner' })).status).toBe(400)
    expect((await f.post('session-decision', { action: 'close', ...input }, 'https://foreign.invalid')).status).toBe(403)
    const body = JSON.stringify(closed.data); expect(body).not.toContain('Keep exact answer'); expect(body).not.toContain('范围说明'); expect(f.store.repos.side_effect.all()).toEqual([])
  })
})
