import { afterEach, describe, expect, it, vi } from 'vitest'
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { openStore, type Store } from '../../src/store/index.js'
import { installPanelRoutes } from '../../src/panel/routes.js'
import { bindWorkspace, WorkspaceError } from '../../src/workspace/commands.js'
import { createDeliveries, deliveryDigest, type DeliveryInput } from '../../src/workspace/deliveries.js'
import type { SessionTargetBinding } from '../../src/workspace/session-actions.js'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function storeFixture() {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, 'go-delivery-route-')), identity = lstatSync(root)
  cleanups.push(() => {
    const stat = lstatSync(root)
    if (dirname(root) !== parent || !basename(root).startsWith('go-delivery-route-') || realpathSync(root) !== root || !stat.isDirectory() || stat.isSymbolicLink() || stat.ino !== identity.ino || stat.dev !== identity.dev) throw new Error('unsafe delivery route cleanup')
    rmSync(root, { recursive: true })
  })
  const store = openStore({ dbPath: join(root, 'fixture.sqlite') })
  cleanups.push(() => store.close())
  return store
}
function routesFixture(ports: any) {
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  installPanelRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => { routes.delete(route.path) } } } } }, storeFixture(), {}, ports)
  return async (path: string, body: any, origin?: string) => {
    const response = await routes.get(`/api/superagent/${path}`)!(new Request(`http://localhost/api/superagent/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }))
    return { status: response.status, ...(await response.json()) as any }
  }
}
function deliveryFixture() {
  const store = storeFixture()
  const epoch = bindWorkspace(store, 'delivery-route-fixture').current.epoch
  const state = {
    epoch,
    generation: 0,
    binding: { sessionId: 'session-delivery-target', scopeRevision: digest(['scope', 0]), factRevision: digest(['fact', 0]), project: { kind: 'project' as const, key: 'project-one' } } as SessionTargetBinding,
  }
  const service = createDeliveries(store, {
    requireEpoch(value) { if (value !== state.epoch) throw new WorkspaceError('epoch_mismatch', 409) },
    async target(requested) {
      const generation = state.generation, binding = state.binding
      return { binding: { ...binding, project: { ...binding.project } }, fence() { if (generation !== state.generation) throw new WorkspaceError('session_action_target_changed', 409) } }
    },
  })
  const post = routesFixture({
    delivery: async (input: any) => {
      const { action, ...payload } = input
      if (action === 'prepare') return service.prepare(payload)
      if (action === 'confirm') return service.confirm(payload)
      if (action === 'cancel') return service.cancel(payload)
      return service.status(payload)
    },
  })
  const input = (patch: Partial<DeliveryInput> = {}): DeliveryInput => ({ epoch: state.epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'continue', text: 'Exact delivery body\n保留原字节 🧭', target: { sessionId: state.binding.sessionId, scopeRevision: state.binding.scopeRevision, factRevision: state.binding.factRevision }, images: [], ...patch })
  return { store, state, service, post, input }
}

describe('POST /delivery: one HTTP seam for pre-delivery confirmation', () => {
  it('prepares and confirms the exact human object while exposing no body, authority or delivery claim', async () => {
    const f = deliveryFixture(), input = f.input({ text: 'PRIVATE ROUTE BODY — do not echo' })
    const prepared = await f.post('delivery', { action: 'prepare', ...input })
    expect(prepared.status).toBe(200)
    expect(prepared.data).toEqual({
      version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId, operation: 'continue',
      target: { ...f.state.binding, project: { kind: 'project', key: 'project-one' } }, digest: deliveryDigest(input), bodyBytes: Buffer.byteLength(input.text, 'utf8'), images: [],
      seq: 1, at: expect.any(Number), updatedAt: expect.any(Number), state: 'prepared',
      humanConfirmed: false, delivered: false, accepted: false, executed: false, completed: false, disposition: 'not-confirmed', durable: true,
    })
    expect(JSON.stringify(prepared.data)).not.toContain('PRIVATE ROUTE BODY')
    expect(JSON.stringify(f.store.repos.side_effect.all())).not.toContain('PRIVATE ROUTE BODY')
    expect((await f.post('delivery', { action: 'status', epoch: input.epoch, confirmationId: input.confirmationId })).data).toEqual(prepared.data)
    const confirmed = await f.post('delivery', { action: 'confirm', ...input })
    expect(confirmed.status).toBe(200)
    expect(confirmed.data).toMatchObject({ state: 'confirmed', seq: 2, humanConfirmed: true, delivered: false, accepted: false, executed: false, completed: false, disposition: 'confirmed-pending-delivery' })
    expect(await f.post('delivery', { action: 'confirm', ...input })).toEqual(confirmed)
    expect(JSON.stringify(confirmed.data)).not.toContain('PRIVATE ROUTE BODY')
    expect(f.store.repos.ticket.all()).toEqual([]); expect(f.store.repos.trigger.all()).toEqual([]); expect(f.store.repos.assignment.all()).toEqual([])
  })

  it('rejects changed content, changed binding and stale epoch after an exact confirmation', async () => {
    const f = deliveryFixture(), input = f.input()
    await f.post('delivery', { action: 'prepare', ...input }); await f.post('delivery', { action: 'confirm', ...input })
    const changed = await f.post('delivery', { action: 'confirm', ...input, text: 'Changed by another tab' })
    expect(changed.status).toBe(409); expect(changed.code).toBe('delivery_confirmation_changed')
    const rebound = await f.post('delivery', { action: 'confirm', ...input, target: { ...input.target, factRevision: digest(['fact', 9]) } })
    expect(rebound.status).toBe(409); expect(rebound.code).toBe('delivery_confirmation_changed')
    f.state.epoch = 'delivery-next-epoch'
    const stale = await f.post('delivery', { action: 'status', epoch: input.epoch, confirmationId: input.confirmationId })
    expect(stale.status).toBe(409); expect(stale.code).toBe('epoch_mismatch')
    expect((await f.post('delivery', { action: 'prepare', ...f.input(), epoch: input.epoch })).status).toBe(409)
    expect((await f.post('delivery', { action: 'prepare', ...f.input() })).status).toBe(200)
  })

  it('cancels only an unconfirmed object and keeps the canceled id terminal across HTTP', async () => {
    const f = deliveryFixture(), input = f.input()
    await f.post('delivery', { action: 'prepare', ...input })
    const canceled = await f.post('delivery', { action: 'cancel', epoch: input.epoch, confirmationId: input.confirmationId })
    expect(canceled.status).toBe(200); expect(canceled.data).toMatchObject({ state: 'canceled', humanConfirmed: false, delivered: false, disposition: 'canceled' })
    expect(await f.post('delivery', { action: 'cancel', epoch: input.epoch, confirmationId: input.confirmationId })).toEqual(canceled)
    const confirm = await f.post('delivery', { action: 'confirm', ...input })
    expect(confirm.status).toBe(409); expect(confirm.code).toBe('delivery_confirmation_canceled')
  })

  it('accepts only exact action shapes, exact epochs and same-origin owners', async () => {
    const f = deliveryFixture(), input = f.input(), path = 'delivery'
    expect((await f.post(path, { action: 'prepare', ...input }, 'https://foreign.invalid')).status).toBe(403)
    for (const bad of [
      {}, { action: 'prepare', epoch: input.epoch }, { action: 'activate', epoch: input.epoch },
      { action: 'prepare', ...input, text: '' }, { action: 'prepare', ...input, text: 'x'.repeat(16_385) },
      { action: 'prepare', ...input, operation: 'resume' }, { action: 'prepare', ...input, target: { ...input.target, sessionId: 'https://evil' } },
      { action: 'prepare', ...input, target: { ...input.target, scopeRevision: 'bad' } }, { action: 'prepare', ...input, actor: 'owner' },
      { action: 'prepare', ...input, approved: true }, { action: 'prepare', ...input, text: 'PRIVATE', images: 'not-array' },
      { action: 'prepare', ...input, images: [{ imageId: randomUUID(), digest: digest(['x']), seq: 1 }, { imageId: randomUUID(), digest: digest(['x']), seq: 1 }, { imageId: randomUUID(), digest: digest(['x']), seq: 1 }, { imageId: randomUUID(), digest: digest(['x']), seq: 1 }, { imageId: randomUUID(), digest: digest(['x']), seq: 1 }, { imageId: randomUUID(), digest: digest(['x']), seq: 1 }] },
      { action: 'status', epoch: input.epoch }, { action: 'status', epoch: input.epoch, confirmationId: input.confirmationId, actor: 'owner' },
      { action: 'cancel', epoch: input.epoch, confirmationId: 'https://evil' },
    ]) expect((await f.post(path, bad)).status, JSON.stringify(bad)).toBe(400)
    expect(f.store.repos.side_effect.all()).toEqual([])
    expect((await f.post(path, { action: 'prepare', ...input, requestId: 'not-a-uuid' })).status).toBe(400)
    expect((await f.post(path, { action: 'status', epoch: input.epoch, confirmationId: randomUUID() })).status).toBe(404)
    const bare = routesFixture({})
    expect((await bare('delivery', { action: 'status', epoch: input.epoch, confirmationId: input.confirmationId })).status).toBe(503)
  })

  it('omits hidden or forged fields from a misbehaving confirmation port', async () => {
    const post = routesFixture({ delivery: async () => ({ version: 1, epoch: 'epoch-one', requestId: randomUUID(), confirmationId: randomUUID(), operation: 'steer',
      target: { sessionId: 'session-target', scopeRevision: digest(['scope']), factRevision: digest(['fact']), project: { kind: 'project', key: 'project-one', path: '/hidden' }, url: 'https://hidden.invalid' },
      digest: digest(['digest']), bodyBytes: 4, images: [{ imageId: randomUUID(), digest: digest(['image']), seq: 1, path: '/hidden' }], seq: 2, at: 1, updatedAt: 2,
      state: 'confirmed', humanConfirmed: false, delivered: true, accepted: true, executed: true, completed: true, disposition: 'confirmed-pending-delivery', code: 'ok', text: 'PRIVATE TEXT', raw: 'hidden' }) })
    const result = await post('delivery', { action: 'status', epoch: 'epoch-one', confirmationId: randomUUID() })
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({ state: 'confirmed', humanConfirmed: true, delivered: false, accepted: false, executed: false, completed: false, disposition: 'confirmed-pending-delivery' })
    expect(result.data.target).toEqual({ sessionId: 'session-target', scopeRevision: digest(['scope']), factRevision: digest(['fact']), project: { kind: 'project', key: 'project-one' } })
    expect(result.data.images).toEqual([{ imageId: expect.any(String), digest: digest(['image']), seq: 1 }])
    expect(JSON.stringify(result.data)).not.toContain('hidden')
    expect(JSON.stringify(result.data)).not.toContain('PRIVATE TEXT')
    expect(JSON.stringify(result.data)).not.toContain('raw')
  })

  it('delegates exact epoch and binding checks without retry, keeping errors fixed', async () => {
    const store = storeFixture(), epoch = bindWorkspace(store, 'delivery-err-fixture').current.epoch
    const delivery = vi.fn(async (_input: any) => { throw new WorkspaceError('delivery_target_changed', 409) })
    const post = routesFixture({ delivery })
    const input = { epoch, requestId: randomUUID(), confirmationId: randomUUID(), operation: 'continue', text: 'Exact', target: { sessionId: 'session-target', scopeRevision: digest(['s']), factRevision: digest(['f']) }, images: [] }
    const result = await post('delivery', { action: 'prepare', ...input })
    expect(result.status).toBe(409); expect(result.code).toBe('delivery_target_changed'); expect(result.message).toBe('Workspace request could not be completed')
    expect(delivery).toHaveBeenCalledExactlyOnceWith({ action: 'prepare', ...input, images: [] })
    expect(delivery.mock.calls[0]![0]).toMatchObject({ epoch })
  })
})
