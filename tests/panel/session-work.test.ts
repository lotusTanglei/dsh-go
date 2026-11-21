import { describe, expect, it, vi } from 'vitest'
import { installPanelRoutes, type PanelPorts } from '../../src/panel/routes.js'
import type { Store } from '../../src/store/index.js'
import { WorkspaceError } from '../../src/workspace/commands.js'

const epoch = 'epoch-1', revision = 'a'.repeat(64), sessionId = 'b'.repeat(64)
function fixture(ports: PanelPorts = {}) {
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  installPanelRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => {} } } } }, {} as Store, {}, ports)
  return { async post(input: unknown, origin = 'http://owner.test', path = 'session-work') {
    const response = await routes.get(`/api/superagent/${path}`)!(new Request(`http://owner.test/api/superagent/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(input) }))
    return { status: response.status, body: await response.json() as any }
  } }
}

describe('session work owner route contract (not live authentication)', () => {
  it('rejects foreign Origins, extra fields, controls, and malformed action shapes before the passive port', async () => {
    const port = vi.fn(async () => ({ items: [] })), f = fixture({ sessionWork: port })
    const list = { action: 'list', epoch }, change = { action: 'set-included', epoch, sessionId, included: false, revision }
    expect((await f.post(list, 'https://other.invalid')).status).toBe(403)
    for (const input of [
      { ...list, sessionId }, { ...list, limit: 21 }, { ...list, limit: 0 }, { ...list, view: 'all' }, { ...list, cursor: 'https://evil' },
      { ...change, revision: undefined }, { ...change, included: 'false' }, { ...change, sessionId: 'https://evil' },
      { ...change, cursor: 'opaque' }, { action: 'activate', epoch, sessionId }, { action: 'list' },
      ...['url', 'path', 'actor', 'agentOptions', 'followup', 'steer', 'control', 'role'].map(key => ({ ...list, [key]: 'caller' })),
    ]) expect((await f.post(input)).status, JSON.stringify(input)).toBe(400)
    expect(port).not.toHaveBeenCalled()
    expect((await f.post({ ...list, view: 'excluded', limit: 20, cursor: 'opaque_cursor' })).status).toBe(200)
    expect((await f.post(change)).status).toBe(200)
    expect(port.mock.calls).toHaveLength(2)
  })

  it('preserves exact identities, revisions and next cursors only in the white-listed work DTO', async () => {
    const next = 'e'.repeat(120), item = { sessionId, title: 'Work', objective: 'Goal', runtime: 'idle', goalPhase: 'active', evidence: 'structured', excluded: false, observedAt: 1, raw: 'hidden', projections: { secret: 'hidden' }, url: 'https://hidden.invalid' }
    const data = { state: 'ready', scope: 'current-host', total: 31, defaultIncluded: true, revision, next, hasMore: true, items: [item], header: { private: 'hidden' } }
    const f = fixture({ sessionWork: async () => data, workspace: async () => ({ epoch, admissions: [], sessionWork: data, next }) })
    const page = (await f.post({ action: 'list', epoch })).body.data
    expect(page).toMatchObject({ revision, next, items: [{ sessionId, goalPhase: 'active', runtime: 'idle' }] })
    expect(JSON.stringify(page)).not.toMatch(/hidden|projections|header|raw/)
    const workspace = (await f.post({}, 'http://owner.test', 'workspace')).body.data
    expect(workspace.sessionWork.next).toBe(next); expect(workspace.sessionWork.items[0].sessionId).toBe(sessionId)
    expect(workspace.next).not.toBe(next) // no widening of the global string redaction
  })

  it('omits excluded content even if a misbehaving port supplies it', async () => {
    const f = fixture({ sessionWork: async () => ({ revision, items: [{ sessionId, title: 'Safe caption', excluded: true, objective: 'Do not send', progress: 'Do not send', decision: 'Do not send', runtime: 'running', evidence: 'structured', observedAt: 2 }] }) })
    const item = (await f.post({ action: 'list', epoch, view: 'excluded' })).body.data.items[0]
    expect(item).toEqual({ sessionId, title: 'Safe caption', excluded: true, observedAt: 2 })
  })

  it('delegates exact epoch and membership revision checks without retry and keeps errors fixed', async () => {
    const port = vi.fn(async () => { throw new WorkspaceError('session_work_resync', 409) })
    const f = fixture({ sessionWork: port }), input = { action: 'set-included', epoch, sessionId, included: true, revision }
    const result = await f.post(input)
    expect(result.status).toBe(409); expect(result.body.message).toBe('Workspace request could not be completed')
    expect(port).toHaveBeenCalledExactlyOnceWith(input)
    expect((await fixture().post({ action: 'list', epoch })).status).toBe(503)
  })
})
