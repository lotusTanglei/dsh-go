import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionWorkSource, type SessionWorkPorts } from '../../src/sources/session-work.js'

type Projection = Awaited<ReturnType<SessionWorkPorts['read']>>
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
function fixture(values: Record<string, unknown> = {}) {
  const state = { values, asOfSeq: 7, status: 'idle', excluded: [] as string[], excludedProjects: [] as string[], version: 0 }
  const ports: SessionWorkPorts = {
    listProjects: vi.fn(() => [{ id: 'project', title: 'Synthetic project', sessionIds: ['session'] }]),
    listSessions: vi.fn(async () => [{ header: { id: 'session', createdAt: 1 }, live: false, persisted: true }]),
    // Only the structured projection is supplied; there is no Host/profile/model or transcript API.
    read: vi.fn(async () => ({ asOfSeq: state.asOfSeq, values: state.values })),
    agent: vi.fn(() => ({ status: state.status })), ownedSessionIds: () => [], canAccess: () => true,
    getExcluded: () => state.excluded,
    setExcluded: ids => { state.excluded = [...ids]; state.version++ },
    getExcludedProjects: () => state.excludedProjects,
    setExcludedProjects: ids => { state.excludedProjects = [...ids]; state.version++ },
    getScopeVersion: () => state.version, signal: new AbortController().signal,
  }
  const source = new SessionWorkSource(ports)
  cleanups.push(() => source.stop())
  return { state, ports, source }
}
const goal = (phase: string, objective = 'Ship the synthetic change') => ({ goal: { phase, objective } })
const todo = (content: string, status = 'completed') => ({ content, status })
const task = (subject: string, status = 'completed') => ({ subject, status })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('structured session progress without inferred success or approval', () => {
  it('projects at most three distinct completed facts from todos then team tasks while preserving active/next precedence', async () => {
    const f = fixture({ goal: goal('active'),
      todos: [todo('Finished parser'), todo('Current task', 'in_progress'), todo('Next task', 'pending'), todo('Finished parser'), todo('Finished tests')],
      agentTeam: { tasks: [task('Finished tests'), task('Finished review'), task('Fourth completed fact'), task('Team current', 'in_progress'), task('Team next', 'pending'), task('Deleted work', 'deleted')] },
    })
    await f.source.start()
    const page = await f.source.list(), item = page.items[0]!
    expect(item).toMatchObject({ evidence: 'structured', goalPhase: 'active', progress: 'Current task', nextAction: 'Next task',
      done: ['Finished parser', 'Finished tests', 'Finished review'], result: { state: 'unverified', summary: 'Finished parser', acceptanceVerified: false }, approvalCoverage: 'unavailable' })
    expect(item.done).toHaveLength(3)
    expect(JSON.stringify(item)).not.toMatch(/Fourth completed fact|Deleted work|Team current|Team next/)
  })

  it('uses team completed facts and current/next only when the corresponding todo facts are absent', async () => {
    const f = fixture({ agentTeam: { tasks: [task('Team finished'), task('Team current', 'in_progress'), task('Team next', 'pending')] } })
    await f.source.start()
    expect((await f.source.list()).items[0]).toMatchObject({ done: ['Team finished'], progress: 'Team current', nextAction: 'Team next', result: { state: 'unverified', acceptanceVerified: false }, approvalCoverage: 'unavailable' })
  })

  it.each(['idle', 'running'])('does not turn completed todos or %s runtime into a completed goal or verified result', async status => {
    const f = fixture({ todos: [todo('One finished step'), todo('Another finished step')] })
    f.state.status = status
    await f.source.start()
    const item = (await f.source.list()).items[0]!
    expect(item).toMatchObject({ runtime: status, done: ['One finished step', 'Another finished step'], result: { state: 'unverified', acceptanceVerified: false } })
    expect(item.goalPhase).toBeUndefined()
    expect(item).not.toHaveProperty('percent')
    expect(item).not.toHaveProperty('percentage')
  })

  it('does not invent completed work or a result from an idle session without structured completion evidence', async () => {
    const f = fixture({ title: 'Synthetic idle session', goal: goal('active') })
    await f.source.start()
    const item = (await f.source.list()).items[0]!
    expect(item).toMatchObject({ runtime: 'idle', goalPhase: 'active', approvalCoverage: 'unavailable' })
    expect(item.done).toBeUndefined()
    expect(item.result).toBeUndefined()
  })

  it('reports goal-declared completion separately from runtime and never claims verified acceptance', async () => {
    const f = fixture({ goal: { goal: { phase: 'complete', objective: 'Goal declares delivery', acceptanceVerified: true, result: 'PRIVATE UNTRUSTED RESULT' } } })
    f.state.status = 'running'
    await f.source.start()
    const item = (await f.source.list()).items[0]!
    expect(item).toMatchObject({ runtime: 'running', goalPhase: 'complete', result: { state: 'goal-complete', summary: 'Goal declares delivery', acceptanceVerified: false }, approvalCoverage: 'unavailable' })
    expect(item.done).toBeUndefined()
    expect(JSON.stringify(item)).not.toContain('PRIVATE UNTRUSTED RESULT')
  })

  it('keeps user questions as decisions, explicitly reports missing approval coverage and never reads transcript-shaped data', async () => {
    const values: Record<string, unknown> = { userQuestions: { active: [{ state: 'continued', questions: [{ question: 'Approve this action?' }] }] } }
    for (const key of ['transcript', 'messages', 'events', 'approval', 'approvals']) Object.defineProperty(values, key, { get() { throw new Error(`forbidden read of ${key}`) } })
    const f = fixture(values)
    await f.source.start()
    const item = (await f.source.list()).items[0]!
    expect(item).toMatchObject({ evidence: 'structured', decision: 'Approve this action?', approvalCoverage: 'unavailable' })
    expect(item.result).toBeUndefined()
    expect(item).not.toHaveProperty('approval')
    expect(item).not.toHaveProperty('approvalVerified')
    expect(f.ports.read).toHaveBeenCalledTimes(1)
  })

  it.each([
    { kind: 'todos', patch: { todos: [todo('Valid done'), { content: 'Malformed', status: 'invented' }] } },
    { kind: 'team', patch: { agentTeam: { tasks: [task('Team done')], failure: 'PRIVATE FAILURE' } } },
    { kind: 'questions', patch: { userQuestions: { active: [{ state: 'invented', questions: [] }] } } },
    { kind: 'goal', patch: { goal: { goal: { phase: 'complete', objective: 42 } } } },
  ])('keeps malformed $kind evidence partial and does not publish added completion/result claims', async ({ patch }) => {
    const f = fixture({ goal: goal('complete'), todos: [todo('Completed claim')], ...patch })
    await f.source.start()
    const page = await f.source.list(), item = page.items[0]!
    expect(page.state).toBe('partial')
    expect(item).toMatchObject({ evidence: 'unavailable', runtime: 'unknown', approvalCoverage: 'unavailable' })
    expect(item.done).toBeUndefined()
    expect(item.result).toBeUndefined()
    expect(JSON.stringify(item)).not.toContain('PRIVATE FAILURE')
  })

  it('keeps a failed projection partial without claiming completed work, a result or available approvals', async () => {
    const f = fixture({ goal: goal('complete'), todos: [todo('Unobserved completed claim')] })
    vi.mocked(f.ports.read).mockRejectedValue(new Error('PRIVATE PROJECTION FAILURE'))
    await f.source.start()
    const page = await f.source.list(), item = page.items[0]!
    expect(page.state).toBe('partial')
    expect(item).toMatchObject({ evidence: 'unavailable', runtime: 'unknown', approvalCoverage: 'unavailable' })
    expect(item.done).toBeUndefined()
    expect(item.result).toBeUndefined()
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|Unobserved/)
  })

  it.each(['session', 'project'])('drops cached done/result/decision after %s exclusion without reading the body again', async kind => {
    const f = fixture({ goal: goal('complete'), todos: [todo('Private completed work')], userQuestions: { active: [{ state: 'open', questions: [{ question: 'Private decision' }] }] } })
    await f.source.start()
    const first = await f.source.list()
    expect(first.items[0]).toHaveProperty('done')
    expect(first.items[0]).toHaveProperty('result')
    if (kind === 'session') await f.source.setIncluded('session', false, { revision: first.revision! })
    else await f.source.setProjectIncluded('project', false, { revision: first.revision! })
    const excluded = (await f.source.list({ view: 'excluded' })).items[0]!
    expect(excluded).toMatchObject({ excluded: true, approvalCoverage: 'unavailable' })
    for (const field of ['done', 'result', 'decision', 'objective', 'progress', 'nextAction']) expect(excluded).not.toHaveProperty(field)
    expect(f.ports.read).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'])('fails closed on exclusion when an in-flight completed projection will %s late', async outcome => {
    const f = fixture()
    await f.source.start()
    const revision = (await f.source.listScopeProjects()).revision
    const read = deferred<Projection>(), started = deferred<void>()
    cleanups.push(() => read.resolve({ asOfSeq: -1, values: {} }))
    vi.mocked(f.ports.read).mockImplementation(() => { started.resolve(); return read.promise })
    const pending = f.source.list().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
    await started.promise
    await f.source.setIncluded('session', false, { revision })
    if (outcome === 'resolve') read.resolve({ asOfSeq: 7, values: { goal: goal('complete', 'PRIVATE GOAL'), todos: [todo('PRIVATE DONE')] } })
    else read.reject(new Error('PRIVATE READ FAILURE'))
    expect(await pending).toMatchObject({ value: undefined, error: { code: 'session_work_resync', status: 409 } })
    const page = await f.source.list({ view: 'excluded' })
    expect(JSON.stringify(page)).not.toContain('PRIVATE')
    expect(page.items[0]).not.toHaveProperty('done')
    expect(page.items[0]).not.toHaveProperty('result')
  })

  it('keeps unknown membership body-free and never fabricates progress, result or approval coverage', async () => {
    const f = fixture({ goal: goal('complete'), todos: [todo('Must not read')] })
    delete f.ports.listProjects
    await f.source.start()
    const item = (await f.source.list()).items[0]!
    expect(item).toMatchObject({ evidence: 'unavailable', project: { kind: 'unknown', key: 'unknown' }, approvalCoverage: 'unavailable' })
    expect(item.done).toBeUndefined()
    expect(item.result).toBeUndefined()
    expect(f.ports.read).not.toHaveBeenCalled()
  })

  it('redacts and bounds every added display field, drops blank facts and caps the completed list', async () => {
    const f = fixture({ goal: goal('complete', 'Delivered https://private.invalid/result secret=unsafe /Users/person/private'),
      todos: [todo('  '), todo('Done https://private.invalid/private token=unsafe'), todo('Local /Users/person/private'), todo('x'.repeat(1000)), todo('Fourth suppressed')],
    })
    await f.source.start()
    const item = (await f.source.list()).items[0]!
    expect(item.done).toHaveLength(3)
    expect(item.done?.every(value => value.length <= 240)).toBe(true)
    expect(item.result?.summary?.length).toBeLessThanOrEqual(600)
    expect(item.result?.acceptanceVerified).toBe(false)
    expect(JSON.stringify(item)).not.toMatch(/private\.invalid|unsafe|\/Users\/person|Fourth suppressed/)
  })

  it.each(['done', 'result'] as const)('changes the fact revision for changed %s content at the same sequence and rejects the old action target', async change => {
    const f = fixture({ goal: goal('active'), todos: [todo('Completed fact A'), todo('Secondary fact A')] })
    await f.source.start()
    const before = await f.source.locate({ text: 'Ship the synthetic change', sessionId: 'session' })
    if (before.status !== 'located' || !before.target?.factRevision) throw new Error('Expected exact structured target')
    const input = { sessionId: 'session', scopeRevision: before.revision, factRevision: before.target.factRevision }
    // Change a later done fact so title/objective/current/next/result summary and sequence stay fixed.
    if (change === 'done') f.state.values = { goal: goal('active'), todos: [todo('Completed fact A'), todo('Secondary fact B')] }
    else f.state.values = { goal: goal('complete'), todos: [todo('Completed fact A'), todo('Secondary fact A')] }
    expect(f.state.asOfSeq).toBe(7)
    await expect(f.source.actionTarget(input)).rejects.toMatchObject({ code: 'session_action_target_changed', status: 409 })
    const after = await f.source.locate({ text: 'Ship the synthetic change', sessionId: 'session' })
    expect(after.status).toBe('located')
    if (after.status !== 'located' || !after.target?.factRevision) throw new Error('Expected refreshed structured target')
    expect(after.target.factRevision).not.toBe(before.target.factRevision)
    expect(after.revision).toBe(before.revision)
    expect((await f.source.actionTarget({ ...input, factRevision: after.target.factRevision })).binding.factRevision).toBe(after.target.factRevision)
  })

  it('does not expose mutable completed/result containers from the cached fact snapshot', async () => {
    const f = fixture({ goal: goal('complete'), todos: [todo('Real completed fact')] })
    await f.source.start()
    const first = (await f.source.list()).items[0]!
    const revision = first.factRevision
    first.done?.push('Forged completion')
    if (first.result) first.result.summary = 'Forged result'
    const second = (await f.source.list()).items[0]!
    expect(second.done).toEqual(['Real completed fact'])
    expect(second.result?.summary).toBe('Ship the synthetic change')
    expect(second.factRevision).toBe(revision)
    expect(f.ports.read).toHaveBeenCalledTimes(1)
  })
})
