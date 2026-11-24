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
    const next = 'e'.repeat(120), item = { sessionId, title: 'Work', objective: 'Goal', runtime: 'idle', goalPhase: 'active', evidence: 'structured', excluded: false, factRevision: revision, observedAt: 1, raw: 'hidden', projections: { secret: 'hidden' }, url: 'https://hidden.invalid', project: {kind:'project',key:'project-safe',name:'Safe project',path:'/Users/private/hidden',raw:'hidden'} }
    const data = { state: 'ready', scope: 'current-host', total: 31, defaultIncluded: true, revision, next, hasMore: true, items: [item], header: { private: 'hidden' } }
    const f = fixture({ sessionWork: async () => data, workspace: async () => ({ epoch, admissions: [], sessionWork: data, next }) })
    const page = (await f.post({ action: 'list', epoch })).body.data
    expect(page).toMatchObject({ revision, next, items: [{ sessionId, factRevision: revision, goalPhase: 'active', runtime: 'idle',project:{kind:'project',key:'project-safe',name:'Safe project'} }] })
    expect(page.items[0].project).toEqual({kind:'project',key:'project-safe',name:'Safe project'})
    expect(JSON.stringify(page)).not.toMatch(/hidden|projections|header|raw/)
    const workspace = (await f.post({}, 'http://owner.test', 'workspace')).body.data
    expect(workspace.sessionWork.next).toBe(next); expect(workspace.sessionWork.items[0].sessionId).toBe(sessionId)
    expect(workspace.next).not.toBe(next) // no widening of the global string redaction
  })

  it('omits excluded content even if a misbehaving port supplies it', async () => {
    const f = fixture({ sessionWork: async () => ({ revision, items: [{ sessionId, title: 'Safe caption', excluded: true, objective: 'Do not send', progress: 'Do not send', decision: 'Do not send', runtime: 'running', evidence: 'structured', observedAt: 2 }] }) })
    const item = (await f.post({ action: 'list', epoch, view: 'excluded' })).body.data.items[0]
    expect(item).toEqual({ sessionId, title: 'Safe caption', excluded: true, observedAt: 2, project: {kind:'unknown',key:'unknown'} })
  })

  it('allows project catalog and exact scope changes, but does not accept caller controls or paths', async () => {
    const port = vi.fn(async (input: any) => input.action === 'projects' ? { state: 'ready', revision, total: 1, items: [{ key: sessionId, kind: 'project', name: 'Empty project', excluded: false, sessionTotal: 0, includedTotal: 0, path: '/hidden', sessionIds: ['hidden'] }] } : { projectId: sessionId, included: false, revision, stopped: false }), f = fixture({ sessionWork: port })
    const projects = await f.post({ action: 'projects', epoch })
    expect(projects.body.data.items).toEqual([{ key: sessionId, kind: 'project', name: 'Empty project', excluded: false, sessionTotal: 0, includedTotal: 0 }])
    expect((await f.post({ action: 'set-project-included', epoch, projectId: sessionId, included: false, revision })).body.data).toEqual({ projectId: sessionId, included: false, revision, stopped: false })
    expect((await f.post({ action: 'list', epoch, projectKey: `project:${'a'.repeat(200)}` })).status).toBe(200)
    for (const input of [{ action: 'projects', epoch, projectId: sessionId }, { action: 'list', epoch, projectKey: 'arbitrary' }, { action: 'set-project-included', epoch, projectId: sessionId, included: false, revision, stop: true }]) expect((await f.post(input)).status).toBe(400)
  })

  it('keeps lookup non-dispatching and bounded, preserving only exact target evidence metadata', async () => {
    const target = { sessionId, title: 'Fix work', project: { kind: 'project', key: 'p', name: 'Project' }, evidence: 'structured', factRevision: revision, matchField: 'objective', matchText: '<script>literal evidence</script>', raw: 'hidden' }
    const port = vi.fn(async () => ({ status: 'located', revision, target, candidates: [target], controlAvailable: true, code: 'ok', raw: 'hidden' })), f = fixture({ sessionLocate: port })
    const result = await f.post({ epoch, text: 'Fix work' }, 'http://owner.test', 'session-locate')
    expect(result.status).toBe(200)
    expect(result.body.data).toMatchObject({ status: 'located', revision, controlAvailable: false, target: { sessionId, factRevision: revision, matchField: 'objective', matchText: '<script>literal evidence</script>' } })
    expect(JSON.stringify(result.body)).not.toContain('hidden')
    for (const input of [{ epoch, text: '' }, { epoch, text: 'work', actor: 'owner' }, { epoch, text: 'work', action: 'activate' }, { epoch, text: 'work', sessionId: 'https://evil' }]) expect((await f.post(input, 'http://owner.test', 'session-locate')).status).toBe(400)
    expect((await f.post({ epoch, text: 'work' }, 'https://evil', 'session-locate')).status).toBe(403)
    expect(port).toHaveBeenCalledTimes(1)
  })

  it('accepts only a precise human action check or receipt status, never caller authority or control methods', async () => {
    const actionId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222'
    const input = { action: 'prepare', epoch, actionId, requestId, operation: 'supplement', text: 'Direct request', target: { sessionId, scopeRevision: revision, factRevision: revision } }
    const port = vi.fn(async () => ({ epoch, actionId, requestId, operation: 'supplement', target: { ...input.target, project: { kind: 'project', key: 'p' }, path: '/hidden' }, digest: revision, state: 'blocked', code: 'SA_EXECUTION_BOUNDARY_UNVERIFIED', seq: 2, durable: true, accepted: false, executed: true, completed: true, text: 'hidden', raw: 'hidden' })), f = fixture({ sessionAction: port })
    const result = await f.post(input, 'http://owner.test', 'session-action')
    expect(result.status).toBe(200); expect(result.body.data).toMatchObject({ actionId, state: 'blocked', executed: false, completed: false, accepted: false, target: input.target })
    expect(JSON.stringify(result.body)).not.toContain('hidden')
    expect(port).toHaveBeenCalledWith({ action: 'prepare', input: { epoch, actionId, requestId, operation: 'supplement', text: 'Direct request', target: input.target } })
    for (const invalid of [{ ...input, actor: 'owner' }, { ...input, approved: true }, { ...input, target: { ...input.target, control: 'resume' } }, { ...input, operation: 'resume' }, { ...input, target: { ...input.target, sessionId: 'https://evil' } }, { action: 'status', epoch, actionId, text: 'Do more' }]) expect((await f.post(invalid, 'http://owner.test', 'session-action')).status).toBe(400)
    expect((await f.post(input, 'https://evil', 'session-action')).status).toBe(403)
    expect((await f.post({ action: 'status', epoch, actionId }, 'http://owner.test', 'session-action')).status).toBe(200)
    expect(port).toHaveBeenCalledTimes(2)
    expect((await fixture().post(input, 'http://owner.test', 'session-action')).status).toBe(503)
  })

  it('projects an explicit missing-action closure without inventing verified project membership', async () => {
    const input = { epoch, requestId: '22222222-2222-4222-8222-222222222222', actionId: '11111111-1111-4111-8111-111111111111', operation: 'continue', text: 'Original exact text', target: { sessionId, scopeRevision: revision, factRevision: revision } }
    const port = vi.fn(async () => ({ version: 1, ...input, text: 'hidden', digest: revision, state: 'closed', seq: 1, at: 2, updatedAt: 2, bindingVerified: false, durable: true, accepted: false, executed: null, completed: null, disposition: 'closed-before-dispatch', code: 'session_action_id_closed' })), f = fixture({ sessionAction: port })
    const result = await f.post({ action: 'close', ...input }, 'http://owner.test', 'session-action')
    expect(result.status).toBe(200); expect(result.body.data).toMatchObject({ version: 1, state: 'closed', bindingVerified: false, target: input.target, executed: null, completed: null })
    expect(result.body.data.target.project).toBeUndefined(); expect(JSON.stringify(result.body)).not.toContain('hidden')
    expect(port).toHaveBeenCalledWith({ action: 'close', input })
    expect((await f.post({ action: 'close', epoch, actionId: input.actionId }, 'http://owner.test', 'session-action')).status).toBe(400)
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
