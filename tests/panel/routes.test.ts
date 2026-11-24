import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStore, type Store } from '../../src/store/index.js'
import { installPanelRoutes, type PanelContext } from '../../src/panel/routes.js'
import { approvalFingerprint } from '../../src/panel/board.js'

const dirs: string[] = []
const stores: Store[] = []
afterEach(() => { while (stores.length) stores.pop()!.close(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
function makeStore(): Store { const dir = mkdtempSync(join(tmpdir(), 'panel-routes-')); dirs.push(dir); const store = openStore({ dbPath: join(dir, 'state.sqlite') }); stores.push(store); return store }
function setup(store: Store, ports: Record<string, unknown> = {}) {
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const context: PanelContext = { connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => { routes.delete(route.path) } } } } }
  const installation = installPanelRoutes(context, store, { panelPageSize: 20, approvalTimeoutMs: 24 * 60 * 60 * 1000 }, ports)
  return { routes, installation }
}
async function post(routes: Map<string, (request: Request) => Promise<Response>>, path: string, value: unknown, headers?: Record<string, string>) {
  const handler = routes.get(`/api/superagent${path}`)
  if (!handler) throw new Error(`missing route ${path}`)
  const response = await handler(new Request(`http://localhost/api/superagent${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers ?? {}) }, body: JSON.stringify(value) }))
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe('panel host routes', () => {
  it('registers all twenty-six exact POST buffered routes and uses a stable envelope', async () => {
    const store = makeStore(); const { routes } = setup(store)
    expect([...routes.keys()].sort()).toEqual(['admission', 'admission-revise', 'approval', 'approvals', 'board', 'command', 'command-cancel', 'command-status', 'config-mutation', 'conversation', 'delivery', 'health', 'images', 'overview', 'session-action', 'session-decision', 'session-locate', 'session-work', 'settings', 'stage-locate', 'stage-models', 'threads', 'ticket', 'ticket-action', 'tickets', 'workspace'].map(name => `/api/superagent/${name}`))
    const result = await post(routes, '/settings', {})
    expect(result.status).toBe(200); expect(result.body).toEqual({ ok: true, data: { effective: expect.arrayContaining([expect.objectContaining({ key: 'panelPageSize', value: 20, origin: expect.any(String) })]) } })
  })

  it('rejects hostile fields/origins and never returns raw persisted payloads', async () => {
    const store = makeStore()
    store.repos.ticket.insert({ id: 'ticket-1', thread_key: 'thread-1', decision_id: 'decision-1', title: 'safe title', state: 'open', mandate_json: {}, brief_json: {}, workdir: '/private/path', created_at: 1, updated_at: 1 })
    const { routes } = setup(store)
    expect((await post(routes, '/tickets', { state: "open'; DROP TABLE ticket; --" })).body).toEqual({ ok: true, data: { items: [] } })
    expect((await post(routes, '/ticket', { id: 'ticket-1', extra: 'forbidden' })).status).toBe(400)
    expect((await post(routes, '/settings', {}, { origin: 'https://evil.invalid' })).status).toBe(403)
    const listed = await post(routes, '/tickets', {})
    expect(listed.body).toEqual({ ok: true, data: { items: [expect.objectContaining({ id: 'ticket-1', title: 'safe title', allowed: { stop: false, resume: false } })] } })
    expect(JSON.stringify(listed.body)).not.toContain('/private/path')
  })

  it('performs approval transition with reason, CAS and audit, then rejects replay', async () => {
    const store = makeStore(); store.repos.approval.insert({ id: 'approval-1', ticket_id: null, kind: 'merge-pr', summary: 'Merge change', payload_json: { repository: 'fixture', ref: 'feature', base: 'main', commit: 'abcdef1' }, requested_by: 'agent', created_at: Date.now(), state: 'pending' })
    const { routes } = setup(store)
    const first = await post(routes, '/approval', { id: 'approval-1', fingerprint: approvalFingerprint(store.repos.approval.get('approval-1')!), decision: 'approve', reason: 'Reviewed by owner', actor: 'owner' })
    expect(first.status).toBe(200); expect((first.body.data as Record<string, unknown>).state).toBe('approved')
    expect(store.repos.approval.get('approval-1')?.state).toBe('approved')
    expect(store.repos.audit.all()).toHaveLength(1)
    const replay = await post(routes, '/approval', { id: 'approval-1', fingerprint: approvalFingerprint(store.repos.approval.get('approval-1')!), decision: 'deny', reason: 'replay', actor: 'owner' })
    expect(replay.status).toBe(409)
  })

  it('advances a linked waiting-human ticket atomically with approval', async () => {
    const store = makeStore()
    store.repos.ticket.insert({ id: 'ticket-linked', thread_key: 'thread-linked', decision_id: 'decision-1', title: 'Waiting', state: 'waiting_human', mandate_json: {}, brief_json: {}, workdir: '/private/path', created_at: 1, updated_at: 1, attention_json: { id: 'approval-1', question: 'Approve?' } })
    store.repos.approval.insert({ id: 'approval-linked', ticket_id: 'ticket-linked', kind: 'permission', summary: 'Continue', payload_json: { scope: 'ticket', operation: 'run-tests', impact: 'synthetic only' }, requested_by: 'agent', created_at: Date.now(), state: 'pending' })
    const { routes } = setup(store)
    const result = await post(routes, '/approval', { id: 'approval-linked', fingerprint: approvalFingerprint(store.repos.approval.get('approval-linked')!), decision: 'approve', reason: 'Owner approved' })
    expect(result.status).toBe(200)
    expect(store.repos.ticket.get('ticket-linked')?.state).toBe('open')
    expect(store.repos.audit.all()).toHaveLength(2)
    expect(JSON.stringify(result.body)).not.toContain('hidden')
  })

  it('expires approvals fail closed and missing ticket action ports return 503', async () => {
    const store = makeStore(); store.repos.approval.insert({ id: 'approval-old', ticket_id: null, kind: 'payment', summary: 'Old', payload_json: {}, requested_by: 'agent', created_at: 1, state: 'pending' })
    store.repos.ticket.insert({ id: 'ticket-1', thread_key: 'thread-1', decision_id: 'decision-1', title: 'Ticket', state: 'open', mandate_json: {}, brief_json: {}, workdir: '/private/path', created_at: 1, updated_at: 1 })
    const { routes } = setup(store, { approvalTimeoutMs: 5 })
    const expired = await post(routes, '/approval', { id: 'approval-old', fingerprint: approvalFingerprint(store.repos.approval.get('approval-old')!), decision: 'approve', reason: 'too late' })
    expect(expired.status).toBe(409); expect((expired.body.error as Record<string, unknown>).code).toBe('expired'); expect(store.repos.approval.get('approval-old')?.state).toBe('expired')
    const unavailable = await post(routes, '/ticket-action', { id: 'ticket-1', action: 'stop', reason: 'stop now' })
    expect(unavailable.status).toBe(503)
  })

  it('returns safe approval impact and complete ticket details without payload or credentials', async () => {
    const store = makeStore()
    store.repos.ticket.insert({ id: 'detail-ticket', thread_key: 'detail-thread', decision_id: 'decision', title: 'Details', state: 'open', mandate_json: {}, brief_json: {}, workdir: '/private/hidden', created_at: 1, updated_at: 1 })
    store.repos.approval.insert({ id: 'detail-approval', ticket_id: 'detail-ticket', kind: 'merge-pr', summary: 'Merge reviewed ref', payload_json: { branch: 'feature', token: 'hidden-secret', nested: { password: 'never-show' } }, requested_by: 'worker', created_at: Date.now(), state: 'pending' })
    const { routes } = setup(store)
    const approvals = await post(routes, '/approvals', {})
    expect((approvals.body.data as any).items[0].impact.targets).toEqual(['branch: feature'])
    expect(JSON.stringify(approvals.body)).not.toMatch(/hidden-secret|never-show|payload_json/)
    const detail = await post(routes, '/ticket', { id: 'detail-ticket' })
    expect(detail.body.data).toMatchObject({ ticket: { id: 'detail-ticket' }, assignments: [], approvals: [{ id: 'detail-approval' }], timeline: [] })
    expect(JSON.stringify(detail.body)).not.toContain('/private/hidden')
  })

  it('keeps a ticket waiting until all approvals are allowed and ignores spoofed audit actors', async () => {
    const store = makeStore()
    store.repos.ticket.insert({ id: 'multi-ticket', thread_key: 'multi-thread', decision_id: 'decision', title: 'Wait', state: 'waiting_human', mandate_json: {}, brief_json: {}, workdir: '/tmp/test', created_at: 1, updated_at: 1 })
    for (const id of ['first', 'second']) store.repos.approval.insert({ id, ticket_id: 'multi-ticket', kind: 'permission', summary: 'Check', payload_json: { scope: 'ticket', operation: 'run-tests', impact: 'synthetic only' }, requested_by: 'worker', created_at: Date.now(), state: 'pending' })
    const { routes } = setup(store)
    expect((await post(routes, '/approval', { id: 'first', fingerprint: approvalFingerprint(store.repos.approval.get('first')!), decision: 'approve', reason: 'reviewed', actor: 'impersonated-admin' })).status).toBe(200)
    expect(store.repos.ticket.get('multi-ticket')?.state).toBe('waiting_human')
    expect((await post(routes, '/approval', { id: 'second', fingerprint: approvalFingerprint(store.repos.approval.get('second')!), decision: 'deny', reason: 'not safe' })).status).toBe(200)
    expect(store.repos.ticket.get('multi-ticket')?.state).toBe('waiting_human')
    expect(store.repos.audit.all().every(row => row.actor === 'panel-owner')).toBe(true)
  })

  it('persists approval decisions across a store restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-restart-')); dirs.push(dir)
    let store = openStore({ dbPath: join(dir, 'state.sqlite') }); stores.push(store)
    store.repos.approval.insert({ id: 'approval-restart', ticket_id: null, kind: 'permission', summary: 'Persist', payload_json: {}, requested_by: 'agent', created_at: Date.now(), state: 'pending' })
    const first = setup(store); await post(first.routes, '/approval', { id: 'approval-restart', fingerprint: approvalFingerprint(store.repos.approval.get('approval-restart')!), decision: 'deny', reason: 'No', actor: 'owner' }); store.close(); stores.splice(stores.indexOf(store), 1)
    store = openStore({ dbPath: join(dir, 'state.sqlite') }); stores.push(store)
    const second = setup(store); const listed = await post(second.routes, '/approvals', {})
    expect((listed.body.data as { items: Array<Record<string, unknown>> }).items[0]?.state).toBe('denied')
  })
})
