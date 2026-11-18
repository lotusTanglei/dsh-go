import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStore, type Row } from '../../src/store/index.js'
import { approvalFingerprint, BOARD_COLUMNS } from '../../src/panel/board.js'
import { installPanelRoutes, PANEL_ROUTE_PATHS, type PanelConfig, type PanelContext, type PanelPorts } from '../../src/panel/routes.js'
import { WorkspaceError } from '../../src/workspace/commands.js'
import { conversationPage } from '../../src/workspace/conversation.js'

type Column = typeof BOARD_COLUMNS[number]
type BoardData = { columns: Record<Column, { total: number; items: Array<Record<string, any>>; hasMore: boolean; cursor?: string }>; revision: string; filtered: boolean; pendingApprovals: number }
type Envelope = { ok: boolean; data: any; code?: string; error?: { code: string; message: string } }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

/** Calls installed handlers directly: proves field/Origin/CAS behavior, NOT Host owner authentication. */
function fixture(ports: PanelPorts = {}, config: PanelConfig = {}) {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'panel-kanban-')))
  const store = openStore({ dbPath: join(dir, 'state.sqlite') })
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const registrations: Array<{ path: string; methods: readonly string[]; requestBody: string }> = []
  const ctx: PanelContext = { connection: { fetch: { register(route) {
    handlers.set(route.path, route.fetch); registrations.push(route)
    return () => { handlers.delete(route.path) }
  } } } }
  const installation = installPanelRoutes(ctx, store, { panelPageSize: 20, approvalTimeoutMs: 60_000, ...config }, ports)
  cleanups.push(async () => {
    try { await installation.dispose() } finally {
      store.close()
      const target = resolve(dir)
      if (target !== dir || !target.startsWith(resolve(tmpdir()) + '/') || !target.split('/').at(-1)!.startsWith('panel-kanban-')) throw new Error('unsafe panel fixture cleanup')
      rmSync(target, { recursive: true, force: true })
    }
  })
  return {
    store, handlers, registrations,
    async post(path: string, input: unknown, origin = 'http://owner.test') {
      const handler = handlers.get(`/api/superagent${path}`)
      if (!handler) throw new Error('missing registered panel handler')
      const response = await handler(new Request(`http://owner.test/api/superagent${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(input),
      }))
      return { status: response.status, body: await response.json() as Envelope }
    },
    ticket(id: string, patch: Row = {}) {
      store.repos.ticket.insert({ id, thread_key: `thread:${id}`, decision_id: `decision:${id}`, title: `Card ${id}`, state: 'open',
        mandate_json: {}, brief_json: { acceptance: [{ id: 'A1', check: 'fixture', kind: 'assertion' }] }, workdir: '/tmp/fake-panel-workdir',
        created_at: 1, updated_at: 1, ...patch })
    },
    approval(id: string, patch: Row = {}) {
      store.repos.approval.insert({ id, ticket_id: null, kind: 'permission', summary: `Review ${id}`, payload_json: { scope: 'scoped-change', operation: 'run-tests', impact: 'synthetic only' },
        requested_by: 'fixture-worker', created_at: Date.now(), state: 'pending', ...patch })
    },
  }
}

// This is intentionally only a synthetic owner-call boundary. Host connection auth,
// real browser DOM/text rendering, and provider execution remain unverified here.
describe('kanban panel handler contract with real SQLite', () => {
  it('registers the workspace/kanban routes as POST buffered handlers and rejects Origin before a port call', async () => {
    const workspace = vi.fn(async () => ({ epoch: randomUUID() })), h = fixture({ workspace })
    expect(h.registrations.map(route => route.path).sort()).toEqual(PANEL_ROUTE_PATHS.map(path => `/api/superagent${path}`).sort())
    expect(h.registrations.every(route => route.methods.length === 1 && route.methods[0] === 'POST' && route.requestBody === 'buffered')).toBe(true)
    expect((await h.post('/workspace', {}, 'https://untrusted.invalid')).status).toBe(403)
    expect(workspace).not.toHaveBeenCalled()
    expect((await h.post('/workspace', {})).status).toBe(200)
    expect(workspace).toHaveBeenCalledTimes(1)
  })

  it('enforces per-handler authority-field allowlists before touching workspace ports', async () => {
    const seen: unknown[] = [], epoch = randomUUID(), requestId = randomUUID(), planId = randomUUID()
    const port = async (input?: unknown) => { seen.push(input); return { accepted: true } }
    const workspace = async () => { seen.push(undefined); return { epoch, admissions: [{ epoch, requestId, planId, fingerprint: 'a'.repeat(64), brief: { scope: { repo: '/tmp/planning-only' }, acceptance: [] } }] } }
    const h = fixture({ workspace, conversation: port, command: port, commandStatus: port, admission: port, reviseAdmission: port, cancelCommand: port })
    const valid = {
      '/workspace': {}, '/conversation': { epoch, limit: 10 },
      '/command': { epoch, requestId, intent: 'new-task', text: 'Scoped request' },
      '/command-status': { epoch, requestId },
      '/command-cancel': { epoch, requestId, seq: 2 },
      '/admission': { epoch, requestId, planId, fingerprint: 'a'.repeat(64), decision: 'approve' },
      '/admission-revise': { epoch, requestId, planId, fingerprint: 'a'.repeat(64), patch: { goal: 'Explicit revision' } },
    }
    for (const [path, input] of Object.entries(valid)) {
      for (const extra of [{ actor: 'owner' }, { sessionId: 'foreign' }, { role: 'router' }, { agent: 'foreign' }, { source: { kind: 'user' } }, { approved: true }]) {
        const response = await h.post(path, { ...input, ...extra })
        expect(response.status, `${path} must reject caller authority`).toBe(400)
        expect(response.body.code).toBe('invalid_input')
      }
    }
    expect(seen).toEqual([])
    for (const [path, input] of Object.entries(valid)) expect((await h.post(path, input)).status).toBe(200)
    expect(seen).toHaveLength(8)
  })

  it('blocks approval of a scope hidden by privacy projection, while allowing a precise safe plan and rejection', async () => {
    const epoch = randomUUID(), requestId = randomUUID(), planId = randomUUID(), fingerprint = 'd'.repeat(64)
    let repo = '/Users/private-owner/secret-project'
    const admission = vi.fn(async () => ({ state: 'consumed' }))
    const workspace = async () => ({ epoch, admissions: [{ epoch, requestId, planId, fingerprint, brief: { goal: 'Scoped task', scope: { repo, subdirs: ['src'] }, allowWrite: ['src/**'], denyWrite: ['private/**'], acceptance: [] } }] })
    const h = fixture({ workspace, admission })
    const shown = (await h.post('/workspace', {})).body.data.admissions[0]
    expect(shown.reviewable).toBe(false); expect(shown.blockedReason).toBe('admission_scope_redacted')
    expect(JSON.stringify(shown)).not.toContain('private-owner')
    const input = { epoch, requestId, planId, fingerprint, decision: 'approve' }
    expect((await h.post('/admission', input)).status).toBe(409); expect(admission).not.toHaveBeenCalled()
    expect((await h.post('/admission', { ...input, decision: 'reject' })).status).toBe(200)
    repo = join(homedir(), 'Local Projects', 'exact-project')
    const relative = (await h.post('/workspace', {})).body.data.admissions[0]
    expect(relative.reviewable).toBe(true); expect(relative.scopeIdentity).toBe('host-owner-home-relative')
    expect(relative.brief.scope.repo).toBe('~/Local Projects/exact-project'); expect(relative.scope.repo).toBe(relative.brief.scope.repo)
    expect(JSON.stringify(relative)).not.toContain(homedir())
    expect((await h.post('/admission', input)).status).toBe(200)
    repo = join(homedir(), 'projects', 'sk-secretcredential')
    expect((await h.post('/workspace', {})).body.data.admissions[0].reviewable).toBe(false)
    expect((await h.post('/admission', input)).status).toBe(409)
    repo = '/tmp/visible-synthetic-project'
    expect((await h.post('/workspace', {})).body.data.admissions[0].reviewable).toBe(true)
    expect((await h.post('/admission', input)).status).toBe(200)
  })

  it('preserves body as inert port data, rejects malformed epoch fields, and returns fixed errors without echoing injection', async () => {
    const epoch = randomUUID(), injected = '<img src=x onerror=owner.approve()> {"decision":"approve","epoch":"other"}'
    const command = vi.fn(async (input: any) => {
      if (input.epoch !== epoch) throw new WorkspaceError('epoch_mismatch', 409)
      return { requestId: input.requestId, accepted: true, stage: 'queued' }
    })
    const h = fixture({ command })
    const input = { epoch, requestId: randomUUID(), intent: 'message', text: injected }
    expect((await h.post('/command', input)).status).toBe(200)
    expect(command).toHaveBeenCalledWith(input)
    const stale = await h.post('/command', { ...input, epoch: 'other' })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('epoch_mismatch')
    expect(JSON.stringify(stale.body)).not.toContain(injected)
    expect((await h.post('/conversation', { epoch: '<script>foreign epoch</script>' })).status).toBe(400)
    expect((await h.post('/admission', { epoch: { owner: true }, requestId: randomUUID(), planId: randomUUID(), fingerprint: 'b'.repeat(64), decision: 'approve' })).status).toBe(400)
    expect((await h.post('/board', { query: "'; DROP TABLE ticket; --" })).status).toBe(200)
    expect(h.store.repos.ticket.all()).toEqual([])
  })

  it('round-trips conversation history and delta cursors and rejects a cursor from another epoch', async () => {
    const epoch = randomUUID()
    const events = Array.from({ length: 8 }, (_, seq) => ({ type: 'user/message', seq, time: seq,
      data: { id: `message-${seq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `Conversation ${seq}` }] } }))
    const h = fixture({ conversation: async input => conversationPage(events, input) })
    const recent = await h.post('/conversation', { epoch, limit: 3 })
    expect(recent.status).toBe(200)
    expect(recent.body.data.items.map((item: any) => item.id)).toEqual(['message-5', 'message-6', 'message-7'])
    expect(recent.body.data.nextBefore).not.toContain('REDACTED')
    const history = await h.post('/conversation', { epoch, before: recent.body.data.nextBefore, limit: 3 })
    expect(history.status).toBe(200)
    expect(history.body.data.items.map((item: any) => item.id)).toEqual(['message-2', 'message-3', 'message-4'])
    const delta = await h.post('/conversation', { epoch, after: recent.body.data.nextAfter, limit: 3 })
    expect(delta.status).toBe(200); expect(delta.body.data.items).toEqual([])
    const wrongEpoch = await h.post('/conversation', { epoch: randomUUID(), after: recent.body.data.nextAfter })
    expect(wrongEpoch.status).toBe(409); expect(wrongEpoch.body.code).toBe('epoch_mismatch')
  })

  it('pages every column beyond 100 cards with complete totals and round-trippable opaque cursors', async () => {
    const h = fixture(), states = { pending: 'open', running: 'running', waiting: 'waiting_human', ended: 'ended' }
    for (const column of BOARD_COLUMNS) for (let i = 0; i < 107; i++) {
      const id = `${column}-${String(i).padStart(3, '0')}`
      h.ticket(id, { state: states[column], created_at: i + 1, updated_at: i + 1, ...(column === 'ended' ? { outcome: 'completed' } : {}) })
      if (column === 'running') {
        const assignment = `assignment:${id}`
        h.store.repos.assignment.insert({ id: assignment, ticket_id: id, session_id: `worker:${id}`, state: 'running', created_at: 1, started_at: 1,
          last_progress_at: 1, steps: 0, tokens: 0, retries: 0, repeated_calls: 0 })
        h.store.repos.ticket.updateByState(id, 'running', 'running', { current_assignment: assignment })
      }
    }
    const response = await h.post('/board', { limit: 37 })
    expect(response.status).toBe(200)
    const first = response.body.data as BoardData
    for (const column of BOARD_COLUMNS) {
      const initial = first.columns[column]
      expect(initial.total).toBe(107); expect(initial.items).toHaveLength(37); expect(initial.hasMore).toBe(true)
      const ids = initial.items.map(item => item.id), cursors = new Set<string>()
      let page = initial
      while (page.hasMore) {
        expect(page.cursor).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(page.cursor).not.toContain('REDACTED')
        expect(cursors.has(page.cursor!)).toBe(false); cursors.add(page.cursor!)
        const next = await h.post('/board', { column, cursor: page.cursor, limit: 37 })
        expect(next.status).toBe(200)
        const data = next.body.data as BoardData
        for (const other of BOARD_COLUMNS) expect(data.columns[other].total).toBe(107)
        page = data.columns[column]; ids.push(...page.items.map(item => item.id))
      }
      expect(ids).toHaveLength(107); expect(new Set(ids).size).toBe(107)
      expect(new Set(ids)).toEqual(new Set(Array.from({ length: 107 }, (_, i) => `${column}-${String(i).padStart(3, '0')}`)))
    }
  })

  it('keeps unknown states/outcomes visible with anomaly and no invented outcome or enabled actions', async () => {
    const h = fixture()
    h.ticket('known-open'); h.ticket('unknown-state', { state: 'future_state' })
    h.ticket('unknown-outcome', { state: 'ended', outcome: 'future_outcome' })
    h.ticket('failed', { state: 'ended', outcome: 'failed' })
    const result = await h.post('/board', {}), board = result.body.data as BoardData
    expect(board.columns.pending.total).toBe(2); expect(board.columns.ended.total).toBe(2)
    expect(board.columns.pending.items.find(item => item.id === 'unknown-state')).toMatchObject({ state: 'future_state', anomaly: 'unknown_state', allowed: { input: false, stop: false, resume: false } })
    expect(board.columns.ended.items.find(item => item.id === 'unknown-outcome')).toMatchObject({ outcome: 'unknown' })
    const failed = (await h.post('/board', { outcome: 'failed' })).body.data as BoardData
    expect(failed.columns.ended.items.map(item => item.id)).toEqual(['failed'])
    expect(failed.columns.ended.total).toBe(1); expect(failed.filtered).toBe(true)
    expect((await h.post('/board', { column: 'future' })).status).toBe(400)
    expect((await h.post('/board', { limit: 101 })).status).toBe(400)
  })

  it('returns 409 and fresh counts instead of losing cards after a column changes between pages', async () => {
    const h = fixture()
    for (let i = 0; i < 5; i++) h.ticket(`pending-${i}`, { created_at: i, updated_at: i })
    const first = (await h.post('/board', { limit: 2 })).body.data as BoardData
    expect(first.columns.pending.total).toBe(5)
    expect(h.store.repos.ticket.updateByState('pending-0', 'open', 'waiting_human', { updated_at: 100, attention_json: { question: 'Human review' } })).toBe(true)
    const stale = await h.post('/board', { column: 'pending', cursor: first.columns.pending.cursor, limit: 2 })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('board_resync_required')
    const fresh = (await h.post('/board', { limit: 2 })).body.data as BoardData
    expect(fresh.columns.pending.total).toBe(4); expect(fresh.columns.waiting.total).toBe(1)
    expect(fresh.revision).not.toBe(first.revision)
    const mismatched = await h.post('/board', { column: 'ended', cursor: first.columns.pending.cursor, limit: 2 })
    expect(mismatched.status).toBe(400); expect(mismatched.body.code).toBe('invalid_cursor')
  })

  it('rejects stale pages when approval-derived card status changes even without a ticket timestamp write', async () => {
    const h = fixture()
    h.ticket('first', { created_at: 2 }); h.ticket('second')
    const first = (await h.post('/board', { limit: 1 })).body.data as BoardData
    h.approval('new-approval', { ticket_id: 'second' })
    const stale = await h.post('/board', { column: 'pending', cursor: first.columns.pending.cursor, limit: 1 })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('board_resync_required')
  })

  it('pages all task approvals beyond 100 without mixing other tasks or losing decided history', async () => {
    const h = fixture(); h.ticket('many-approvals'); h.ticket('other-approvals')
    for (let i = 0; i < 135; i++) h.approval(`review-${String(i).padStart(3, '0')}`, { ticket_id: 'many-approvals', state: i % 2 ? 'approved' : 'pending' })
    for (let i = 0; i < 8; i++) h.approval(`noise-${i}`, { ticket_id: 'other-approvals' })
    const detail = (await h.post('/ticket', { id: 'many-approvals' })).body.data
    expect(detail.approvalsTotal).toBe(135); expect(detail.approvals).toHaveLength(30); expect(detail.approvalsNext).toBe(detail.approvals.at(-1).id)
    const ids = detail.approvals.map((row: any) => row.id), states = new Set(detail.approvals.map((row: any) => row.state))
    let cursor = detail.approvalsNext
    while (cursor) {
      const page = (await h.post('/approvals', { ticketId: 'many-approvals', cursor, limit: 37 })).body.data
      expect(page.total).toBe(135); expect(page.items.every((row: any) => row.ticketId === 'many-approvals')).toBe(true)
      ids.push(...page.items.map((row: any) => row.id)); for (const row of page.items) states.add(row.state)
      cursor = page.next
    }
    expect(ids).toHaveLength(135); expect(new Set(ids).size).toBe(135); expect([...states].sort()).toEqual(['approved', 'pending'])
  })

  it('paginates ticket-scoped old audit history without dropping it among newer unrelated activity', async () => {
    const h = fixture(); h.ticket('history-ticket'); h.ticket('other-ticket')
    const expected: number[] = []
    for (let i = 0; i < 135; i++) {
      h.store.repos.audit.insert({ at: i, actor: 'fixture', action: `history-${i}`, ticket_id: 'history-ticket', thread_key: null, detail: { private: 'not in timeline' } })
      expected.push(Number(h.store.repos.audit.all().at(-1)!.id))
    }
    for (let i = 0; i < 170; i++) h.store.repos.audit.insert({ at: i + 1000, actor: 'fixture', action: 'unrelated-newer', ticket_id: 'other-ticket', thread_key: null, detail: {} })
    let cursor: string | undefined
    const seen: number[] = []
    do {
      const result = await h.post('/ticket', { id: 'history-ticket', limit: 19, ...(cursor ? { timelineCursor: cursor } : {}) })
      expect(result.status).toBe(200)
      const data = result.body.data as { timeline: Array<{ id: number; action: string }>; timelineCursor?: string }
      expect(data.timeline.every(item => item.action.startsWith('history-'))).toBe(true)
      seen.push(...data.timeline.map(item => item.id)); cursor = data.timelineCursor
    } while (cursor)
    expect(seen).toEqual(expected.reverse()); expect(new Set(seen).size).toBe(135)
  })

  it('binds approval to the reviewed fingerprint and rejects both stale-content and second-tab decisions', async () => {
    const delivered = vi.fn(async () => {}), h = fixture({ approvalDecided: delivered })
    h.ticket('waiting', { state: 'waiting_human' }); h.approval('review', { ticket_id: 'waiting' })
    const tab1 = (await h.post('/approvals', {})).body.data.items[0]
    const tab2 = (await h.post('/approvals', {})).body.data.items[0]
    expect(tab1.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(tab2.fingerprint).toBe(tab1.fingerprint)
    h.store.repos.approval.updateByState('review', 'pending', 'pending', { summary: 'Materially revised scope' })
    const stale = await h.post('/approval', { id: 'review', decision: 'approve', reason: 'Reviewed old scope', fingerprint: tab1.fingerprint })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('conflict')
    expect(h.store.repos.approval.get('review')?.state).toBe('pending'); expect(delivered).not.toHaveBeenCalled()
    const current = approvalFingerprint(h.store.repos.approval.get('review')!)
    expect(current).not.toBe(tab1.fingerprint)
    const decision = { id: 'review', decision: 'approve', reason: 'Reviewed exact revised scope', fingerprint: current, actor: 'spoofed-admin' }
    expect((await h.post('/approval', decision)).status).toBe(200)
    expect((await h.post('/approval', { ...decision, decision: 'deny' })).status).toBe(409)
    expect(h.store.repos.approval.get('review')).toMatchObject({ state: 'approved', decided_by: 'panel-owner' })
    expect(h.store.repos.ticket.get('waiting')?.state).toBe('open')
    expect(delivered).toHaveBeenCalledTimes(1); expect(delivered).toHaveBeenCalledWith('waiting', 'review', true)
    expect(h.store.repos.audit.all().every(row => row.actor === 'panel-owner')).toBe(true)
  })

  it('expires at the exact timeout boundary and never releases the linked waiting ticket', async () => {
    const delivered = vi.fn(async () => {}), h = fixture({ approvalDecided: delivered }, { approvalTimeoutMs: 100 })
    h.ticket('blocked', { state: 'waiting_human' }); h.approval('expired', { ticket_id: 'blocked', created_at: 1000 })
    const fingerprint = approvalFingerprint(h.store.repos.approval.get('expired')!)
    vi.spyOn(Date, 'now').mockReturnValue(1100)
    const result = await h.post('/approval', { id: 'expired', decision: 'approve', reason: 'too late', fingerprint })
    expect(result.status).toBe(409); expect(result.body.code).toBe('expired')
    expect(h.store.repos.approval.get('expired')?.state).toBe('expired')
    expect(h.store.repos.ticket.get('blocked')?.state).toBe('waiting_human')
    expect(delivered).not.toHaveBeenCalled()
    expect(h.store.repos.audit.all()).toEqual([expect.objectContaining({ action: 'approval.expire', actor: 'panel-owner' })])
  })
})
