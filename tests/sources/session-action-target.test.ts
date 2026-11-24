import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionWorkSource, type SessionWorkPorts } from '../../src/sources/session-work.js'

type Projection = Awaited<ReturnType<SessionWorkPorts['read']>>
type TargetInput = Parameters<SessionWorkSource['actionTarget']>[0]
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

function fixture() {
  const state = {
    excluded: [] as string[], excludedProjects: [] as string[], version: 0,
    denied: [] as string[], owned: [] as string[],
    projects: [
      { id: 'p-a', title: 'Same project name', sessionIds: ['one'] },
      { id: 'p-b', title: 'Same project name', sessionIds: [] as string[] },
    ],
    projection: { asOfSeq: 1, values: { title: 'Work title', goal: { goal: { phase: 'active', objective: 'Exact objective' } } } } as Projection,
  }
  const read = vi.fn(async (_id: string, _signal: AbortSignal): Promise<Projection> => state.projection)
  // Unit-only ports: no Host, profile, model, control/grant adapter, or dispatch.
  const ports: SessionWorkPorts = {
    listSessions: vi.fn(async () => [{ header: { id: 'one', createdAt: 1 } }]),
    listProjects: () => state.projects, read, agent: () => undefined,
    ownedSessionIds: () => state.owned, canAccess: id => !state.denied.includes(id),
    getExcluded: () => state.excluded,
    setExcluded: ids => { state.excluded = [...ids]; state.version++ },
    getExcludedProjects: () => state.excludedProjects,
    setExcludedProjects: ids => { state.excludedProjects = [...ids]; state.version++ },
    // Model a persisted, monotonically increasing preference version, including ABA.
    getScopeVersion: () => state.version, signal: new AbortController().signal,
  }
  const source = new SessionWorkSource(ports)
  cleanups.push(() => source.stop())
  return { state, read, ports, source }
}

async function locateInput(source: SessionWorkSource): Promise<TargetInput> {
  const located = await source.locate({ text: 'Exact objective' })
  expect(located).toMatchObject({ status: 'located', controlAvailable: false })
  if (located.status !== 'located' || !located.target?.factRevision) throw new Error('Expected located facts, not a control grant')
  return { sessionId: located.target.sessionId, scopeRevision: located.revision, factRevision: located.target.factRevision }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('SessionWorkSource exact action target and membership-only fence', () => {
  it('freshly binds locate scope/facts to the exact project without granting execution', async () => {
    const f = fixture(); await f.source.start()
    const input = await locateInput(f.source)
    const prepared = await f.source.actionTarget(input)
    expect(prepared).toEqual({
      binding: { ...input, project: { kind: 'project', key: 'p-a' } },
      fence: expect.any(Function),
    })
    expect(f.read).toHaveBeenCalledTimes(2) // Locate's cached body is not sufficient.
    expect(f.read.mock.calls.every(call => call.length === 2 && call[0] === 'one')).toBe(true)
    expect(prepared.fence()).toBeUndefined()
    expect(f.read).toHaveBeenCalledTimes(2) // The revocation fence is synchronous, not a body refresh.
    // Membership only: no assertion of control, manual-stop clearance, grant, or dispatch.
  })

  it.each(['session scope', 'project scope', 'session ABA', 'project ABA', 'project move', 'access revoke', 'owned addition', 'source stop'] as const)(
    'synchronously revokes an existing fence after %s', async change => {
      const f = fixture(); await f.source.start()
      const input = await locateInput(f.source)
      const prepared = await f.source.actionTarget(input)
      expect(prepared.fence()).toBeUndefined()
      // Mutate authoritative ports, not source setters: ABA must be detected by version,
      // not merely by a source-local generation invalidation.
      if (change === 'session scope' || change === 'session ABA') {
        f.ports.setExcluded(['one'])
        if (change === 'session ABA') f.ports.setExcluded([])
      } else if (change === 'project scope' || change === 'project ABA') {
        f.ports.setExcludedProjects!(['p-a'])
        if (change === 'project ABA') f.ports.setExcludedProjects!([])
      } else if (change === 'project move') {
        f.state.projects[0]!.sessionIds = []
        f.state.projects[1]!.sessionIds = ['one']
      } else if (change === 'access revoke') f.state.denied.push('one')
      else if (change === 'owned addition') f.state.owned.push('one')
      else await f.source.stop()

      if (change.endsWith('ABA')) {
        expect(f.state.excluded).toEqual([])
        expect(f.state.excludedProjects).toEqual([])
        expect(f.state.version).toBe(2)
      }
      expect(() => prepared.fence()).toThrow(expect.objectContaining({ code: 'session_action_target_changed', status: 409 }))
      expect(prepared.binding.scopeRevision).toBe(input.scopeRevision)
      expect(f.read).toHaveBeenCalledTimes(2)
    },
  )

  it('refuses preparation when facts change inside the same scope instead of reusing locate facts', async () => {
    const f = fixture(); await f.source.start()
    const input = await locateInput(f.source)
    f.state.projection = { asOfSeq: 2, values: { title: 'Work title', goal: { goal: { phase: 'active', objective: 'Different objective' } } } }
    expect((await f.source.listScopeProjects()).revision).toBe(input.scopeRevision)
    await expect(f.source.actionTarget(input)).rejects.toMatchObject({ code: 'session_action_target_changed', status: 409 })
    expect(f.read).toHaveBeenCalledTimes(2)
  })

  it.each(['forged ID', 'unknown membership', 'excluded session', 'excluded project'] as const)(
    'does not read a body for %s even with the current scope revision', async kind => {
      const f = fixture()
      if (kind === 'unknown membership') delete f.ports.listProjects
      else if (kind === 'excluded session') f.ports.setExcluded(['one'])
      else if (kind === 'excluded project') f.ports.setExcludedProjects!(['p-a'])
      await f.source.start()
      const scope = await f.source.listScopeProjects()
      await expect(f.source.actionTarget({
        sessionId: kind === 'forged ID' ? 'not-in-roster' : 'one',
        scopeRevision: scope.revision, factRevision: 'a'.repeat(64),
      })).rejects.toMatchObject({ code: 'session_action_target_changed', status: 409 })
      expect(f.read).not.toHaveBeenCalled()
    },
  )

  it.each(['session', 'project'] as const)('rejects a late fact body with 409 after %s exclusion during preparation', async kind => {
    const f = fixture(); await f.source.start()
    const input = await locateInput(f.source)
    const read = deferred<Projection>(), started = deferred<void>()
    cleanups.push(() => { read.resolve({ asOfSeq: -1, values: {} }) })
    f.read.mockImplementationOnce(() => { started.resolve(); return read.promise })
    const pending = f.source.actionTarget(input).then(
      value => ({ value, error: undefined }), error => ({ value: undefined, error }),
    )
    await started.promise
    if (kind === 'session') await f.source.setIncluded('one', false, { revision: input.scopeRevision })
    else await f.source.setProjectIncluded('p-a', false, { revision: input.scopeRevision })
    // Return identical facts: exclusion alone, not fact mismatch, must reject the result.
    read.resolve(f.state.projection)
    const outcome = await pending
    expect(outcome).toMatchObject({ value: undefined, error: { status: 409 } })
    expect(JSON.stringify(outcome)).not.toContain('Exact objective')
    expect(f.read).toHaveBeenCalledTimes(2)
    const scope = await f.source.listScopeProjects()
    await expect(f.source.actionTarget({ ...input, scopeRevision: scope.revision })).rejects.toMatchObject({ status: 409 })
    expect(f.read).toHaveBeenCalledTimes(2)
  })
})
