import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionWorkSource, type SessionWorkPorts } from '../../src/sources/session-work.js'

type Project = { id: string; title: string; sessionIds: string[]; accessible?: boolean }
type Projection = Awaited<ReturnType<SessionWorkPorts['read']>>
const header = (id: string) => ({ header: { id, createdAt: 1 }, live: false, persisted: true })
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
function fixture(ids = ['one'], projects: Project[] = [{ id: 'p-a', title: 'Project A', sessionIds: [...ids] }]) {
  const state = { rows: ids.map(header), projects, excluded: [] as string[], excludedProjects: [] as string[], version: 0 }
  const ports: SessionWorkPorts = {
    listProjects: vi.fn(() => state.projects),
    listSessions: vi.fn(async () => state.rows),
    read: vi.fn(async id => ({ asOfSeq: 0, values: { title: `Title ${id}`, goal: { goal: { objective: `Work ${id}`, phase: 'active' } } } })),
    agent: vi.fn(() => ({ status: 'idle' })),
    ownedSessionIds: () => [], canAccess: () => true,
    getExcluded: () => state.excluded,
    setExcluded: vi.fn(ids => { state.excluded = [...ids]; state.version++ }),
    getExcludedProjects: () => state.excludedProjects,
    setExcludedProjects: vi.fn(ids => { state.excludedProjects = [...ids]; state.version++ }),
    getScopeVersion: vi.fn(() => state.version), signal: new AbortController().signal,
  }
  const source = new SessionWorkSource(ports)
  cleanups.push(() => source.stop())
  return { state, ports, source }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('SessionWorkSource project scope', () => {
  it('catalogs empty projects and isolates equal names by authoritative project ID, including reserved-looking IDs', async () => {
    const f = fixture(['one', 'two', 'loose'], [
      { id: 'p-a', title: 'Same name', sessionIds: ['one'] },
      { id: 'p-b', title: 'Same name', sessionIds: ['two'] },
      { id: 'empty', title: 'Same name', sessionIds: [] },
      { id: 'unassigned', title: 'Reserved project name', sessionIds: [] },
    ])
    await f.source.start()
    const catalog = await f.source.listScopeProjects()
    expect(catalog).toMatchObject({ state: 'ready', total: 5, hasMore: false })
    expect(catalog.items).toEqual(expect.arrayContaining([
      { kind: 'project', key: 'p-a', name: 'Same name', excluded: false, sessionTotal: 1, includedTotal: 1 },
      { kind: 'project', key: 'p-b', name: 'Same name', excluded: false, sessionTotal: 1, includedTotal: 1 },
      { kind: 'project', key: 'empty', name: 'Same name', excluded: false, sessionTotal: 0, includedTotal: 0 },
      { kind: 'project', key: 'unassigned', name: 'Reserved project name', excluded: false, sessionTotal: 0, includedTotal: 0 },
      { kind: 'unassigned', key: 'unassigned', excluded: false, sessionTotal: 1, includedTotal: 1 },
    ]))
    expect(f.ports.read).not.toHaveBeenCalled()
    expect((await f.source.list({ projectKey: 'project:p-a' })).items.map(row => row.sessionId)).toEqual(['one'])
    expect((await f.source.list({ projectKey: 'project:p-b' })).items.map(row => row.sessionId)).toEqual(['two'])
    expect(await f.source.list({ projectKey: 'project:empty' })).toMatchObject({ total: 0, items: [], hasMore: false })
    expect(await f.source.list({ projectKey: 'project:unassigned' })).toMatchObject({ total: 0, items: [] })
    expect((await f.source.list({ projectKey: 'unassigned' })).items.map(row => row.sessionId)).toEqual(['loose'])

    const excluded = await f.source.setProjectIncluded('p-a', false, { revision: catalog.revision })
    expect(excluded).toMatchObject({ projectId: 'p-a', included: false, stopped: false })
    expect(f.ports.setExcludedProjects).toHaveBeenCalledWith(['p-a'])
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    expect((await f.source.list({ projectKey: 'project:p-a', view: 'excluded' })).items).toEqual([
      expect.objectContaining({ sessionId: 'one', excluded: true, exclusionReason: 'project' }),
    ])
    expect((await f.source.list({ projectKey: 'project:p-b' })).items.map(row => row.sessionId)).toEqual(['two'])
  })

  it('persists an empty-project exclusion across source restart and excludes newly added sessions without reading their work', async () => {
    const f = fixture([], [{ id: 'p-a', title: 'Empty for now', sessionIds: [] }])
    await f.source.start()
    const catalog = await f.source.listScopeProjects()
    await f.source.setProjectIncluded('p-a', false, { revision: catalog.revision })
    expect(f.state.excludedProjects).toEqual(['p-a'])
    expect(f.state.excluded).toEqual([])
    await f.source.stop()

    f.state.rows.push(header('new'))
    f.state.projects[0]!.sessionIds.push('new')
    const restarted = new SessionWorkSource(f.ports)
    cleanups.push(() => restarted.stop())
    await restarted.start()
    expect(await restarted.list({ projectKey: 'project:p-a' })).toMatchObject({ total: 0, items: [] })
    const excluded = await restarted.list({ projectKey: 'project:p-a', view: 'excluded' })
    expect(excluded).toMatchObject({ total: 1, excludedTotal: 1 })
    expect(excluded.items).toEqual([expect.objectContaining({ sessionId: 'new', exclusionReason: 'project', excluded: true })])
    expect((await restarted.listScopeProjects()).items).toEqual([
      expect.objectContaining({ key: 'p-a', excluded: true, sessionTotal: 1, includedTotal: 0 }),
    ])
    f.state.rows.push(header('later'))
    f.state.projects[0]!.sessionIds.push('later')
    expect((await restarted.listScopeProjects()).items).toEqual([
      expect.objectContaining({ key: 'p-a', excluded: true, sessionTotal: 2, includedTotal: 0 }),
    ])
    expect((await restarted.list({ projectKey: 'project:p-a', view: 'excluded' })).items.map(row => row.sessionId)).toEqual(['later', 'new'])
    expect(f.state.excluded).toEqual([])
    expect(f.ports.read).not.toHaveBeenCalled()
  })

  it('restores a project without erasing a child exclusion and refuses to restore any child while its project is excluded', async () => {
    const f = fixture(['one', 'two'])
    await f.source.start()
    const initial = await f.source.listScopeProjects()
    const child = await f.source.setIncluded('one', false, { revision: initial.revision })
    const project = await f.source.setProjectIncluded('p-a', false, { revision: child.revision })
    const writes = vi.mocked(f.ports.setExcluded).mock.calls.length
    for (const sessionId of ['one', 'two']) {
      await expect(f.source.setIncluded(sessionId, true, { revision: project.revision })).rejects.toMatchObject({
        code: 'session_work_project_excluded', status: 409,
      })
    }
    expect(f.ports.setExcluded).toHaveBeenCalledTimes(writes)
    expect(f.state.excluded).toEqual(['one'])
    expect(f.state.excludedProjects).toEqual(['p-a'])
    expect(f.state.version).toBe(2)
    expect(f.ports.read).not.toHaveBeenCalled()

    await f.source.setProjectIncluded('p-a', true, { revision: project.revision })
    expect(f.state.excludedProjects).toEqual([])
    expect(f.state.excluded).toEqual(['one'])
    expect((await f.source.list({ projectKey: 'project:p-a' })).items.map(row => row.sessionId)).toEqual(['two'])
    expect((await f.source.list({ projectKey: 'project:p-a', view: 'excluded' })).items).toEqual([
      expect.objectContaining({ sessionId: 'one', exclusionReason: 'session', excluded: true }),
    ])
    expect(vi.mocked(f.ports.read).mock.calls.map(call => call[0])).toEqual(['two'])
  })

  it('revalidates moved membership and renamed projects before using revisions, filters or cached work', async () => {
    const f = fixture(['one', 'two'], [
      { id: 'p-a', title: 'Before', sessionIds: ['one'] },
      { id: 'p-b', title: 'Other', sessionIds: ['two'] },
    ])
    await f.source.start()
    const first = await f.source.list({ projectKey: 'project:p-a' })
    f.state.projects = [
      { id: 'p-a', title: 'Renamed', sessionIds: ['two'] },
      { id: 'p-b', title: 'Other', sessionIds: ['one'] },
    ]
    await expect(f.source.setProjectIncluded('p-a', false, { revision: first.revision! })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    await expect(f.source.setIncluded('one', false, { revision: first.revision! })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    expect(f.ports.setExcludedProjects).not.toHaveBeenCalled()
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    const moved = await f.source.list({ projectKey: 'project:p-b' })
    expect(moved.revision).not.toBe(first.revision)
    expect(moved.items).toEqual([expect.objectContaining({ sessionId: 'one', project: { kind: 'project', key: 'p-b', name: 'Other' } })])
    expect((await f.source.list({ projectKey: 'project:p-a' })).items).toEqual([
      expect.objectContaining({ sessionId: 'two', project: { kind: 'project', key: 'p-a', name: 'Renamed' } }),
    ])

    const beforeRename = await f.source.listScopeProjects()
    f.state.projects[0]!.title = 'Renamed again'
    await expect(f.source.setProjectIncluded('p-a', false, { revision: beforeRename.revision })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    expect((await f.source.listScopeProjects()).items).toContainEqual(expect.objectContaining({ key: 'p-a', name: 'Renamed again' }))
  })

  it.each(['move', 'rename'] as const)('rejects a late work result after an in-flight project %s and revalidates the next catalog', async change => {
    const f = fixture(['one'], [
      { id: 'p-a', title: 'Before', sessionIds: ['one'] },
      { id: 'p-b', title: 'Excluded destination', sessionIds: [] },
    ])
    f.state.excludedProjects = ['p-b']
    await f.source.start()
    const initial = await f.source.listScopeProjects()
    const read = deferred<Projection>(), started = deferred<void>()
    cleanups.push(() => { read.resolve({ asOfSeq: -1, values: {} }) })
    vi.mocked(f.ports.read).mockImplementation(() => { started.resolve(); return read.promise })
    const pending = f.source.list({ projectKey: 'project:p-a' }).then(
      value => ({ value, error: undefined }), error => ({ value: undefined, error }),
    )
    await started.promise
    if (change === 'move') {
      f.state.projects[0]!.sessionIds = []
      f.state.projects[1]!.sessionIds = ['one']
    } else f.state.projects[0]!.title = 'After'
    read.resolve({ asOfSeq: 1, values: { title: 'PRIVATE OBSOLETE BODY' } })
    expect(await pending).toMatchObject({ value: undefined, error: { code: 'session_work_resync', status: 409 } })
    const current = await f.source.listScopeProjects()
    expect(current.revision).not.toBe(initial.revision)
    if (change === 'move') {
      expect((await f.source.list({ projectKey: 'project:p-a' })).items).toEqual([])
      const excluded = await f.source.list({ projectKey: 'project:p-b', view: 'excluded' })
      expect(excluded.items).toEqual([expect.objectContaining({ sessionId: 'one', exclusionReason: 'project' })])
      expect(JSON.stringify(excluded)).not.toContain('PRIVATE')
      expect(f.ports.read).toHaveBeenCalledTimes(1)
    } else expect(current.items).toContainEqual(expect.objectContaining({ key: 'p-a', name: 'After' }))
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    expect(f.ports.setExcludedProjects).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('rejects an in-flight work read after project exclusion even when the late read will %s', async outcome => {
    const f = fixture()
    await f.source.start()
    const catalog = await f.source.listScopeProjects()
    const read = deferred<Projection>(), started = deferred<void>()
    cleanups.push(() => { read.resolve({ asOfSeq: -1, values: {} }) })
    vi.mocked(f.ports.read).mockImplementation(() => { started.resolve(); return read.promise })
    const pending = f.source.list({ projectKey: 'project:p-a' }).then(
      value => ({ value, error: undefined }), error => ({ value: undefined, error }),
    )
    await started.promise
    await f.source.setProjectIncluded('p-a', false, { revision: catalog.revision })
    if (outcome === 'resolve') read.resolve({ asOfSeq: 1, values: { title: 'PRIVATE LATE BODY', goal: { goal: { objective: 'PRIVATE WORK', phase: 'active' } } } })
    else read.reject(new Error('PRIVATE LATE READ FAILURE'))
    expect(await pending).toMatchObject({ value: undefined, error: { code: 'session_work_resync', status: 409 } })
    const excluded = await f.source.list({ projectKey: 'project:p-a', view: 'excluded' })
    expect(excluded.items).toEqual([expect.objectContaining({ sessionId: 'one', exclusionReason: 'project', excluded: true })])
    expect(JSON.stringify(excluded)).not.toContain('PRIVATE')
    expect(f.ports.read).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'throw', 'malformed', 'inaccessible', 'ambiguous'] as const)('shows unknown membership metadata without reading work when registry is %s', async mode => {
    const f = fixture()
    if (mode === 'missing') delete f.ports.listProjects
    else f.ports.listProjects = vi.fn(() => {
      if (mode === 'throw') throw new Error('PRIVATE REGISTRY ERROR')
      if (mode === 'malformed') return [{ id: 'private', title: 'PRIVATE', sessionIds: null }] as unknown as Project[]
      if (mode === 'inaccessible') return [{ id: 'private', title: 'PRIVATE', sessionIds: ['one'], accessible: false }]
      return [{ id: 'p-a', title: 'A', sessionIds: ['one'] }, { id: 'p-b', title: 'B', sessionIds: ['one'] }]
    })
    await f.source.start()
    const catalog = await f.source.listScopeProjects()
    expect(catalog.state).toBe('partial')
    expect(catalog.items).toContainEqual(expect.objectContaining({ kind: 'unknown', key: 'unknown', sessionTotal: 1 }))
    const page = await f.source.list({ projectKey: 'unknown' })
    expect(page).toMatchObject({ state: 'partial', total: 1 })
    expect(page.items).toEqual([expect.objectContaining({
      sessionId: 'one', project: { kind: 'unknown', key: 'unknown' }, evidence: 'unavailable', exclusionReason: 'membership-unknown',
    })])
    expect(page.items[0]?.objective).toBeUndefined()
    expect(JSON.stringify({ catalog, page })).not.toContain('PRIVATE')
    expect(f.ports.read).not.toHaveBeenCalled()
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    expect(f.ports.setExcludedProjects).not.toHaveBeenCalled()
  })

  it('paginates the complete project catalog without body reads and rejects stale, changed-size and cross-kind cursors', async () => {
    const f = fixture(['one', 'two'], Array.from({ length: 23 }, (_, i) => ({
      id: `p${String(i).padStart(2, '0')}`, title: 'Same name', sessionIds: i === 0 ? ['one', 'two'] : [],
    })))
    await f.source.start()
    const first = await f.source.listScopeProjects({ limit: 20 })
    expect(first).toMatchObject({ total: 23, hasMore: true })
    expect(first.items).toHaveLength(20)
    expect(first.next).toEqual(expect.any(String))
    const last = await f.source.listScopeProjects({ cursor: first.next, limit: 20 })
    expect(last).toMatchObject({ total: 23, hasMore: false })
    expect(last.items).toHaveLength(3)
    expect(new Set([...first.items, ...last.items].map(row => row.key)).size).toBe(23)
    expect(f.ports.read).not.toHaveBeenCalled()
    await expect(f.source.listScopeProjects({ cursor: first.next, limit: 10 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    const sessions = await f.source.list({ projectKey: 'project:p00', limit: 1 })
    await expect(f.source.listScopeProjects({ cursor: sessions.next, limit: 1 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    await expect(f.source.list({ projectKey: 'project:p00', cursor: first.next, limit: 20 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })

    f.state.projects[0]!.title = 'Renamed'
    await expect(f.source.listScopeProjects({ cursor: first.next, limit: 20 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    const renamed = await f.source.listScopeProjects({ limit: 20 })
    await f.source.setProjectIncluded('p00', false, { revision: renamed.revision })
    await expect(f.source.listScopeProjects({ cursor: renamed.next, limit: 20 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
  })

  it('binds session-page cursors to project identity as well as view, even for projects with the same name', async () => {
    const f = fixture(['one', 'two', 'three'], [
      { id: 'p-a', title: 'Same name', sessionIds: ['one', 'two'] },
      { id: 'p-b', title: 'Same name', sessionIds: ['three'] },
    ])
    await f.source.start()
    const first = await f.source.list({ projectKey: 'project:p-a', limit: 1 })
    expect(first).toMatchObject({ total: 2, hasMore: true })
    const last = await f.source.list({ projectKey: 'project:p-a', cursor: first.next, limit: 1 })
    expect(last).toMatchObject({ total: 2, hasMore: false })
    expect([...first.items, ...last.items].map(row => row.sessionId)).toEqual(['one', 'two'])
    await expect(f.source.list({ projectKey: 'project:p-b', cursor: first.next, limit: 1 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    await expect(f.source.list({ projectKey: 'project:p-a', view: 'excluded', cursor: first.next, limit: 1 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    await expect(f.source.list({ cursor: first.next, limit: 1 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    expect(vi.mocked(f.ports.read).mock.calls.map(call => call[0])).toEqual(['one', 'two'])
  })

  it.each(['revoke', 'owned', 'stop'] as const)('rejects a catalog completed after an async %s boundary without publishing member counts', async mode => {
    const f = fixture(), owned: string[] = []
    let allowed = true, armed = true, stopping: Promise<void> | undefined
    f.ports.canAccess = () => allowed
    f.ports.ownedSessionIds = () => owned
    f.ports.listProjects = () => {
      if (armed) {
        armed = false
        // The registry snapshot is synchronous, but the caller resumes after this microtask.
        queueMicrotask(() => {
          if (mode === 'revoke') allowed = false
          else if (mode === 'owned') owned.push('one')
          else stopping = f.source.stop()
        })
      }
      return f.state.projects
    }
    await f.source.start()
    const outcome = f.source.listScopeProjects().catch(error => error)
    expect(await outcome).toMatchObject({ code: 'session_work_resync', status: 409 })
    await stopping
    expect(f.ports.read).not.toHaveBeenCalled()
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    expect(f.ports.setExcludedProjects).not.toHaveBeenCalled()
  })

  it.each(['session', 'project'] as const)('uses getScopeVersion to reject ABA revisions and catalog cursors after %s scope returns to the same IDs', async kind => {
    const f = fixture(['one', 'two'], [
      { id: 'p-a', title: 'A', sessionIds: ['one', 'two'] },
      { id: 'p-b', title: 'B', sessionIds: [] },
    ])
    await f.source.start()
    const initial = await f.source.listScopeProjects({ limit: 1 })
    const sessionPage = await f.source.list({ projectKey: 'project:p-a', limit: 1 })
    const mutate = (included: boolean, revision: string) => kind === 'session'
      ? f.source.setIncluded('one', included, { revision })
      : f.source.setProjectIncluded('p-a', included, { revision })
    const excluded = await mutate(false, initial.revision)
    const restored = await mutate(true, excluded.revision)
    expect(f.state.excluded).toEqual([])
    expect(f.state.excludedProjects).toEqual([])
    expect(f.state.version).toBe(2)
    expect(restored.revision).not.toBe(initial.revision)
    expect(f.ports.getScopeVersion).toHaveBeenCalled()
    const writes = vi.mocked(f.ports.setExcluded).mock.calls.length + vi.mocked(f.ports.setExcludedProjects!).mock.calls.length
    await expect(mutate(false, initial.revision)).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    await expect(f.source.listScopeProjects({ cursor: initial.next, limit: 1 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    await expect(f.source.list({ projectKey: 'project:p-a', cursor: sessionPage.next, limit: 1 })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    expect(vi.mocked(f.ports.setExcluded).mock.calls.length + vi.mocked(f.ports.setExcludedProjects!).mock.calls.length).toBe(writes)
    expect((await f.source.listScopeProjects()).revision).toBe(restored.revision)
  })
})
