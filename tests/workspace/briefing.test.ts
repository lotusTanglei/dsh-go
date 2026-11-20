import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { defaults, resolveConfig } from '../../src/config.js'
import { createPolicy } from '../../src/domain/policy.js'
import { openStore, type Row, type Store } from '../../src/store/index.js'
import { boardTicket, readBoard } from '../../src/panel/board.js'
import { readWorkspaceBriefing } from '../../src/workspace/briefing.js'
import { createWorkspaceRuntime } from '../../src/workspace/runtime.js'

const cleanups: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const tempRoot = resolve(tmpdir())
function cleanupTarget(path: string): string {
  const target = resolve(path)
  if (target !== path || dirname(target) !== tempRoot || !basename(target).startsWith('workspace-briefing-')) throw new Error('unsafe briefing fixture cleanup')
  return target
}
/** Real on-disk SQLite; no Host, provider, model turn, or execution side effect. */
function fixture() {
  const dir = resolve(mkdtempSync(join(tempRoot, 'workspace-briefing-'))), own = lstatSync(dir)
  let store: Store | undefined, disposed = false
  const dispose = () => {
    if (disposed) return
    try { store?.close() } finally {
      const target = cleanupTarget(dir), current = lstatSync(target)
      if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== own.ino || current.dev !== own.dev) throw new Error('briefing fixture ownership changed')
      rmSync(target, { recursive: true, force: true }); disposed = true
    }
  }
  cleanups.push(dispose)
  store = openStore({ dbPath: join(dir, 'state.sqlite') })
  const opened = store
  return { store: opened, dir, dispose,
    ticket(id: string, patch: Row = {}) {
      opened.repos.ticket.insert({ id, thread_key: `thread:${id}`, decision_id: `decision:${id}`, title: `Task ${id}`, state: 'open',
        mandate_json: {}, brief_json: { firstAction: 'Inspect approved scope', acceptance: [] }, workdir: '/tmp/briefing-workdir', created_at: 1, updated_at: 1, ...patch })
    },
    assignment(ticketId: string, report: unknown, patch: Row = {}) {
      const id = `assignment:${ticketId}`
      opened.repos.assignment.insert({ id, ticket_id: ticketId, session_id: `worker:${ticketId}`, state: 'ended', created_at: 1,
        last_progress_at: 1, report_json: report, ...patch })
      return id
    },
    approval(id: string, patch: Row = {}) {
      opened.repos.approval.insert({ id, ticket_id: null, kind: 'permission', summary: `Review ${id}`, payload_json: {}, requested_by: 'human', created_at: 1, state: 'pending', ...patch })
    },
  }
}

function persisted(store: Store) {
  return { tickets: store.repos.ticket.all(), assignments: store.repos.assignment.all(), approvals: store.repos.approval.all(),
    effects: store.repos.side_effect.all(), audit: store.repos.audit.all(), version: store.version }
}

describe('workspace task briefing with real SQLite', () => {
  it('returns the explicit empty DTO and safely cleans only its owned temporary directory', () => {
    const h = fixture(); vi.spyOn(Date, 'now').mockReturnValue(1234)
    expect(readWorkspaceBriefing(h.store)).toEqual({ snapshotAt: 1234, decisions: { total: 0, items: [] }, active: { total: 0, items: [] },
      results: { total: 0, items: [] }, counts: { pending: 0, running: 0, waiting: 0, ended: 0 } })
    expect(() => cleanupTarget(tempRoot)).toThrow('unsafe briefing fixture cleanup')
    expect(() => cleanupTarget(join(tempRoot, 'unrelated-fixture'))).toThrow('unsafe briefing fixture cleanup')
    h.dispose(); expect(existsSync(h.dir)).toBe(false); expect(existsSync(tempRoot)).toBe(true)
  })

  it('caps each group at six with complete totals and timestamp-desc/id-asc ordering independent of board pages', () => {
    const h = fixture(), times = [50, 100, 100, 200, 0, 200, 150, 150, 25]
    for (const [index, id] of [...'abcdefghi'].entries()) {
      const at = times[index]!
      h.ticket(`active-${id}`, { updated_at: at, created_at: 1000 - at, title: `Fixture ${id}` })
      h.ticket(`result-${id}`, { state: 'ended', outcome: 'completed', ended_at: at, updated_at: 1000 - at })
      h.approval(`review-${id}`, { created_at: at })
    }
    h.approval('already-approved', { state: 'approved', created_at: 5000 })
    const before = persisted(h.store), data = readWorkspaceBriefing(h.store)
    expect(data.counts).toEqual({ pending: 9, running: 0, waiting: 0, ended: 9 })
    expect(data.active.total).toBe(9); expect(data.results.total).toBe(9); expect(data.decisions.total).toBe(9)
    expect(data.active.items.map(item => item.id)).toEqual(['d', 'f', 'g', 'h', 'b', 'c'].map(id => `active-${id}`))
    expect(data.results.items.map(item => item.id)).toEqual(['d', 'f', 'g', 'h', 'b', 'c'].map(id => `result-${id}`))
    expect(data.decisions.items.map(item => item.id)).toEqual(['d', 'f', 'g', 'h', 'b', 'c'].map(id => `approval:review-${id}`))
    expect(data.active.items.every(item => item.title.startsWith('Fixture '))).toBe(true)
    readBoard(h.store, { column: 'ended', outcome: 'failed', query: 'no matching card', limit: 1 })
    expect(readWorkspaceBriefing(h.store)).toMatchObject({ decisions: data.decisions, active: data.active, results: data.results, counts: data.counts })
    expect(persisted(h.store)).toEqual(before)
  })

  it('preserves pending unlinked/orphan approvals and simultaneous waiting questions without merging them', () => {
    const h = fixture()
    h.ticket('both', { state: 'waiting_human', attention_json: { question: 'Which safe scope?', at: 9999 }, updated_at: 20 })
    h.ticket('fallback', { state: 'waiting_human', attention_json: { question: '   ' }, updated_at: 15 })
    h.ticket('approval-only', { state: 'waiting_human', attention_json: { question: 42 }, updated_at: 10 })
    h.approval('both', { ticket_id: 'both', created_at: 20 })
    h.approval('approval-only', { ticket_id: 'approval-only', created_at: 10 })
    h.approval('unlinked', { created_at: 30 })
    h.approval('orphan', { ticket_id: 'missing-ticket', created_at: 25 })
    h.approval('not-pending', { state: 'expired', created_at: 40 })
    const data = readWorkspaceBriefing(h.store)
    expect(data.decisions.total).toBe(6); expect(data.counts).toEqual({ pending: 0, running: 0, waiting: 3, ended: 0 })
    expect(data.decisions.items).toEqual([
      { id: 'question:both', kind: 'question', ticketId: 'both', title: 'Task both', summary: 'Which safe scope?', at: 9999 },
      { id: 'approval:unlinked', kind: 'approval', title: 'Review unlinked', summary: 'Review unlinked', at: 30 },
      { id: 'approval:orphan', kind: 'approval', title: 'Review orphan', summary: 'Review orphan', at: 25 },
      { id: 'approval:both', kind: 'approval', ticketId: 'both', title: 'Task both', summary: 'Review both', at: 20 },
      { id: 'question:fallback', kind: 'question', ticketId: 'fallback', title: 'Task fallback', summary: '', at: 15 },
      { id: 'approval:approval-only', kind: 'approval', ticketId: 'approval-only', title: 'Task approval-only', summary: 'Review approval-only', at: 10 },
    ])
    expect(new Set(data.decisions.items.map(item => item.id)).size).toBe(6)
    expect(data.active.total).toBe(3)
    expect(data.active.items.find(item => item.id === 'both')?.question).toBe('Which safe scope?')
    expect(data.active.items.find(item => item.id === 'fallback')).not.toHaveProperty('question')
    expect(data.decisions.items.find(item => item.id === 'approval:orphan')).not.toHaveProperty('ticketId')
  })

  it('orders questions by their own valid attention time and falls back to task updates for invalid or missing time', () => {
    const h = fixture()
    h.ticket('old-question', { state: 'waiting_human', attention_json: { question: 'Old question', at: 5 }, updated_at: 1000 })
    h.ticket('new-question', { state: 'waiting_human', attention_json: { question: 'New question', at: 25 }, updated_at: 30 })
    h.ticket('invalid-time', { state: 'waiting_human', attention_json: { question: 'Invalid time', at: '9999' }, updated_at: 20 })
    h.ticket('missing-time', { state: 'waiting_human', attention_json: { question: 'Missing time' }, updated_at: 15 })
    h.ticket('zero-time', { state: 'waiting_human', attention_json: { question: 'Zero is valid', at: 0 }, updated_at: 2000 })
    const data = readWorkspaceBriefing(h.store)
    expect(data.decisions.items.map(item => [item.ticketId, item.at])).toEqual([['new-question', 25], ['invalid-time', 20], ['missing-time', 15], ['old-question', 5], ['zero-time', 0]])
    expect(data.active.items.map(item => [item.id, item.at])).toEqual([['zero-time', 2000], ['old-question', 1000], ['new-question', 30], ['invalid-time', 20], ['missing-time', 15]])
  })

  it('reuses board anomalies and execution blockers without offering actions or inventing running progress', () => {
    const h = fixture()
    h.ticket('unknown', { state: 'future_state', updated_at: 50 })
    h.ticket('conflict', { state: 'running', updated_at: 40 })
    h.ticket('blocked', { updated_at: 30 })
    h.ticket('running', { state: 'running', updated_at: 20 })
    const running = h.assignment('running', { done: ['Inspected', 'Still running'], todo: [] }, { state: 'running' })
    h.store.repos.ticket.updateByState('running', 'running', 'running', { current_assignment: running })
    h.ticket('waiting', { state: 'waiting_human', attention_json: { question: 'Clarify scope' }, updated_at: 10 })
    const data = readWorkspaceBriefing(h.store)
    expect(data.counts).toEqual({ pending: 2, running: 2, waiting: 1, ended: 0 })
    expect(data.decisions.items.filter(item => item.kind === 'anomaly')).toEqual([
      { id: 'anomaly:unknown', kind: 'anomaly', ticketId: 'unknown', title: 'Task unknown', summary: 'unknown_state', at: 50 },
      { id: 'anomaly:conflict', kind: 'anomaly', ticketId: 'conflict', title: 'Task conflict', summary: 'state_conflict', at: 40 },
    ])
    for (const item of data.active.items) {
      const board = boardTicket(h.store, h.store.repos.ticket.get(item.id)!)
      expect(item.anomaly).toBe(board.anomaly); expect(item.disabledReason).toBe(board.disabledReason)
      expect(item).not.toHaveProperty('allowed'); expect(item).not.toHaveProperty('actions')
    }
    expect(data.active.items.find(item => item.id === 'blocked')).toEqual({ id: 'blocked', title: 'Task blocked', state: 'open', at: 30,
      nextAction: 'Inspect approved scope', disabledReason: 'SA_EXECUTION_BOUNDARY_UNVERIFIED' })
    expect(data.active.items.find(item => item.id === 'blocked')).not.toHaveProperty('progress')
    for (const id of ['unknown', 'conflict', 'running', 'waiting']) expect(data.active.items.find(item => item.id === id)).not.toHaveProperty('nextAction')
    expect(data.active.items.find(item => item.id === 'running')?.progress).toBe('Still running')
    h.approval('running-conflict', { ticket_id: 'running' })
    expect(readWorkspaceBriefing(h.store).active.items.find(item => item.id === 'running')?.anomaly).toBe('state_conflict')
  })

  it('takes results state/outcome only from Ticket and ignores invalid report fields without altering persisted reports', () => {
    const h = fixture()
    h.ticket('failed', { state: 'ended', outcome: 'failed', ended_at: 50, updated_at: 100 })
    h.assignment('failed', { state: 'ready', done: ['First evidence', 17, 'Last string', null], todo: ['Next review', 'Not selected'],
      risks: ['Known risk', null, 42, { text: 'not a string' }, 'Second risk'], acceptance: [null, 4] })
    h.ticket('completed', { state: 'ended', outcome: 'completed', updated_at: 40 })
    h.assignment('completed', { state: 'failed', done: 42, todo: { text: 'not an array' }, risks: 'not an array', acceptance: [null] })
    h.ticket('unknown-outcome', { state: 'ended', outcome: 'future_outcome', ended_at: 30 })
    h.assignment('unknown-outcome', '{"state":"ready","done":["invented"]}')
    h.ticket('old-vs-current', { state: 'running', updated_at: 20 })
    h.assignment('old-vs-current', { done: ['Current progress'], todo: [42, 'Do not promote later todo'], needHuman: ['Not an attention question'] }, { state: 'running' })
    h.store.repos.assignment.insert({ id: 'later-history', ticket_id: 'old-vs-current', session_id: 'history', state: 'ended', created_at: 100,
      last_progress_at: 100, report_json: { done: ['Not current'], todo: ['Not current'] } })
    h.store.repos.ticket.updateByState('old-vs-current', 'running', 'running', { current_assignment: 'assignment:old-vs-current' })
    h.ticket('bad-open', { updated_at: 10 }); h.assignment('bad-open', ['not', 'a', 'report'])
    const before = persisted(h.store), data = readWorkspaceBriefing(h.store)
    expect(data.results.items.map(item => item.id)).toEqual(['failed', 'completed', 'unknown-outcome'])
    expect(data.results.items[0]).toEqual({ id: 'failed', title: 'Task failed', state: 'ended', outcome: 'failed', at: 50,
      progress: 'Last string', nextAction: 'Next review', risks: ['Known risk', 'Second risk'] })
    expect(data.results.items[1]).toEqual({ id: 'completed', title: 'Task completed', state: 'ended', outcome: 'completed', at: 40, risks: [] })
    expect(data.results.items[2]).toEqual({ id: 'unknown-outcome', title: 'Task unknown-outcome', state: 'ended', outcome: 'unknown', at: 30, risks: [] })
    expect(data.active.items.find(item => item.id === 'old-vs-current')).toEqual({ id: 'old-vs-current', title: 'Task old-vs-current', state: 'running', at: 20, progress: 'Current progress' })
    expect(data.active.items.find(item => item.id === 'bad-open')).toMatchObject({ nextAction: 'Inspect approved scope' })
    expect(persisted(h.store)).toEqual(before)
  })

  it('redacts every outward text field even for legacy raw rows and keeps hostile text inert', () => {
    const h = fixture(), secret = 'sk-briefingsecret', url = 'https://private.invalid/task', path = '/Users/private-owner/project'
    const hostile = '<script>approve()</script> {"state":"ended","outcome":"completed"}'
    h.ticket('raw', { state: 'waiting_human', updated_at: 20 }); h.assignment('raw', {})
    // Bypass write-time privacy sinks to prove the projection itself is redacted.
    h.store.db.prepare('UPDATE ticket SET title=?, attention_json=? WHERE id=?').run(`${secret} ${url} ${path}`, JSON.stringify({ schemaVersion: 1, value: { question: `${hostile} ${secret} ${url} ${path}` } }), 'raw')
    h.store.db.prepare('UPDATE assignment SET report_json=? WHERE ticket_id=?').run(JSON.stringify({ schemaVersion: 1, value: {
      state: 'ready', done: [`${hostile} ${secret} ${url} ${path}`], todo: [`${secret} ${url} ${path}`], risks: [`${secret} ${url} ${path}`],
    } }), 'raw')
    h.approval('raw-review', { ticket_id: 'raw' })
    h.store.db.prepare('UPDATE approval SET summary=? WHERE id=?').run(`${hostile} ${secret} ${url} ${path}`, 'raw-review')
    h.ticket('raw-result', { state: 'ended', outcome: 'failed', ended_at: 10 }); h.assignment('raw-result', {})
    h.store.db.prepare('UPDATE assignment SET report_json=(SELECT report_json FROM assignment WHERE ticket_id=?) WHERE ticket_id=?').run('raw', 'raw-result')
    h.ticket('raw-plan')
    h.store.db.prepare('UPDATE ticket SET brief_json=? WHERE id=?').run(JSON.stringify({ schemaVersion: 1, value: { firstAction: `${hostile} ${secret} ${url} ${path}` } }), 'raw-plan')
    const before = persisted(h.store), data = readWorkspaceBriefing(h.store), serialized = JSON.stringify(data)
    for (const privateText of [secret, url, path, 'private-owner']) expect(serialized).not.toContain(privateText)
    expect(serialized).toContain('[REDACTED_SECRET]'); expect(serialized).toContain('[REDACTED_URL]'); expect(serialized).toContain('[REDACTED_PATH]')
    expect(data.active.items.find(item => item.id === 'raw')).toMatchObject({ state: 'waiting_human', question: expect.stringContaining(hostile), progress: expect.stringContaining(hostile) })
    expect(data.results.items[0]).toMatchObject({ state: 'ended', outcome: 'failed', risks: [expect.stringContaining('[REDACTED_SECRET]')] })
    expect(data.active.items.find(item => item.id === 'raw-plan')?.nextAction).toContain(hostile)
    expect(persisted(h.store)).toEqual(before)
  })

  it('also redacts legacy identifiers and unknown state/outcome text rather than leaking non-display fields', () => {
    const h = fixture(), id = 'sk-privateidentifier', approval = 'ghp_privateapproval', unknownState = 'https://private.invalid/state', unknownOutcome = '/Users/private-owner/outcome'
    h.ticket(id, { state: unknownState }); h.approval(approval, { ticket_id: id })
    h.ticket('legacy-result', { state: 'ended', outcome: unknownOutcome })
    const data = readWorkspaceBriefing(h.store), serialized = JSON.stringify(data)
    for (const value of [id, approval, unknownState, unknownOutcome]) expect(serialized).not.toContain(value)
    expect(data.active.items[0]).toMatchObject({ id: '[REDACTED_SECRET]', state: '[REDACTED_URL]', anomaly: 'unknown_state' })
    expect(data.decisions.items.find(item => item.kind === 'approval')).toMatchObject({ id: 'approval:[REDACTED_SECRET]', ticketId: '[REDACTED_SECRET]' })
    expect(data.results.items[0]?.outcome).toBe('unknown')
  })

  it('includes the same unfiltered briefing in runtime.workspace independently of admission filtering and pagination', async () => {
    const h = fixture(), config = resolveConfig({ ...defaults, stateDir: h.dir, dbPath: '', lockPath: '', workRoot: '', sources: [] })
    const policy = createPolicy({ acceptedSources: [], acceptMode: 'auto', confirm: 'always', bots: 'deny', paused: false, evalTimeoutMs: 1000,
      budgets: { maxWorkers: 1, maxStepsPerTicket: 5, maxTokensPerTicket: 100, maxDurationMsPerTicket: 1000, maxRetries: 0, queueLimit: 10,
        watchdog: { intervalMs: 100, stallMs: 1000, repeatCallThreshold: 3 } } })
    const runtime = createWorkspaceRuntime(h.store, config, policy, { ctx: { agents: { get: () => undefined } }, mainId: 'briefing-main',
      source: {} as any, engine: { paused: () => false }, deliverTicket: async () => {}, approvalsReady: () => false, mandateValid: () => false })
    for (let i = 0; i < 8; i++) h.ticket(`visible-${i}`, { updated_at: i })
    h.approval('unlinked-runtime')
    vi.spyOn(Date, 'now').mockReturnValue(9876)
    const expected = readWorkspaceBriefing(h.store), before = persisted(h.store)
    expect((await runtime.workspace()).briefing).toEqual(expected)
    expect((await runtime.workspace({ limit: 1, planId: 'missing-plan' })).briefing).toEqual(expected)
    expect(expected.active.total).toBe(8); expect(expected.active.items).toHaveLength(6); expect(expected.decisions.total).toBe(1)
    expect(persisted(h.store)).toEqual(before)
  })
})
