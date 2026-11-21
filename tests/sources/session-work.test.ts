import { afterEach, describe, expect, it, vi } from 'vitest'
import { threadKey } from '../../src/domain/ids.js'
import { SessionWorkSource, type SessionWorkPorts } from '../../src/sources/session-work.js'

const header = (id: string, extra: Record<string, unknown> = {}) => ({ header: { id, createdAt: 1, ...extra }, live: false, persisted: true })
function fixture(ids = ['one']) {
  const state = { rows: ids.map(id => header(id)), excluded: [] as string[], owned: [] as string[], denied: [] as string[], values: {} as Record<string, Record<string, unknown>>, agents: {} as Record<string, any> }
  const abort = new AbortController()
  const ports: SessionWorkPorts = {
    listProjects: vi.fn(() => []),
    listSessions: vi.fn(async () => state.rows),
    read: vi.fn(async id => ({ asOfSeq: -1, values: state.values[id] ?? { title: `Title ${id}` } })),
    agent: vi.fn(id => state.agents[id]), ownedSessionIds: () => state.owned,
    canAccess: id => !state.denied.includes(id), getExcluded: () => state.excluded,
    setExcluded: vi.fn(ids => { state.excluded = [...ids] }), signal: abort.signal,
  }
  return { state, ports, abort, source: new SessionWorkSource(ports) }
}
afterEach(() => vi.restoreAllMocks())
describe('SessionWorkSource read-only current-host coverage', () => {
  it('starts cold, never normalizes/triggers/replies, includes ordinary forks and excludes only internal ancestry/subagents/forbidden', async () => {
    const f = fixture(['one', 'main', 'worker', 'forbidden'])
    f.state.owned = ['main']; f.state.denied = ['forbidden']
    f.state.rows.push(header('ordinary-fork', { parentSession: 'one' }), header('unresolved-fork', { parentSession: 'absent' }),
      header('internal-fork', { parentSession: 'main' }), header('internal-grandchild', { parentSession: 'internal-fork' }),
      header('child', { parentSession: 'one', origin: 'subagent' }), header('preset', { agentPreset: 'dsh-superagent-worker' }))
    f.state.agents.worker = { status: 'running' }
    await f.source.start()
    expect(f.ports.listSessions).not.toHaveBeenCalled(); expect(f.ports.read).not.toHaveBeenCalled()
    expect(await f.source.health()).toMatchObject({ ok: false })
    expect(await f.source.verify({})).toBe(false); expect(await f.source.normalize({})).toEqual([])
    expect(await f.source.readThread(threadKey(f.source.id))).toMatchObject({ triggers: [] })
    await expect(f.source.readThread(threadKey('foreign'))).rejects.toMatchObject({ code: 'session_work_foreign_thread' })
    await expect(f.source.reply('session', threadKey(f.source.id), 'no', 'no')).rejects.toMatchObject({ code: 'session_work_read_only' })
    const page = await f.source.summary()
    expect(page).toMatchObject({ state: 'ready', total: 4, internalTotal: 5, defaultIncluded: true, scope: 'current-host' })
    expect(page.items.map(row => row.sessionId)).toEqual(['worker', 'one', 'ordinary-fork', 'unresolved-fork'])
    expect(vi.mocked(f.ports.read).mock.calls.map(call => call[0])).not.toContain('forbidden')
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    await f.source.stop()
  })

  it('takes project identity from Host membership, not matching titles or cwd, and retains it on excluded metadata without content reads', async () => {
    const f=fixture(['one','two','three','four'])
    f.state.rows[0]=header('one',{cwd:'/private/path/same'})
    f.state.rows[1]=header('two',{cwd:'/private/path/same'})
    let projects=[{id:'project-a',title:'Same title',sessionIds:['one','three']},{id:'project-b',title:'Same title',sessionIds:['two']}]
    f.ports.listProjects=()=>projects
    await f.source.start()
    const first=await f.source.list()
    expect(first.items.find(row=>row.sessionId==='one')?.project).toEqual({kind:'project',key:'project-a',name:'Same title'})
    expect(first.items.find(row=>row.sessionId==='two')?.project).toEqual({kind:'project',key:'project-b',name:'Same title'})
    expect(first.items.find(row=>row.sessionId==='three')?.project).toEqual(first.items.find(row=>row.sessionId==='one')?.project)
    expect(first.items.find(row=>row.sessionId==='four')?.project).toEqual({kind:'unassigned',key:'unassigned'})
    expect(JSON.stringify(first)).not.toContain('/private/path')
    await f.source.setIncluded('one',false,{revision:first.revision!})
    const reads=vi.mocked(f.ports.read).mock.calls.length
    const excluded=await f.source.list({view:'excluded'})
    expect(excluded.items[0]?.project).toEqual({kind:'project',key:'project-a',name:'Same title'})
    expect(f.ports.read).toHaveBeenCalledTimes(reads)
    projects=[{...projects[0]!,title:'Renamed'},projects[1]!]
    const renamed=await f.source.list({view:'excluded'})
    expect(renamed.revision).not.toBe(excluded.revision)
    expect(renamed.items[0]?.project).toEqual({kind:'project',key:'project-a',name:'Renamed'})
    await expect(f.source.setIncluded('one',true,{revision:excluded.revision!})).rejects.toMatchObject({code:'session_work_resync'})
    await f.source.stop()
  })

  it('keeps registry failure, missing service, denied and ambiguous memberships unknown rather than inventing an unassigned project', async () => {
    for(const mode of ['missing','throw','malformed','denied','ambiguous']) {
      const f=fixture(['one'])
      if(mode==='missing') delete f.ports.listProjects
      else f.ports.listProjects=()=>{
        if(mode==='throw') throw new Error('PRIVATE REGISTRY ERROR')
        if(mode==='malformed') return [{id:'project-a',title:'x',sessionIds:null}] as any
        if(mode==='denied') return [{id:'private-project',title:'PRIVATE PROJECT',sessionIds:['one'],accessible:false}]
        return [{id:'project-a',title:'A',sessionIds:['one']},{id:'project-b',title:'B',sessionIds:['one']}]
      }
      await f.source.start()
      const page=await f.source.list()
      expect(page.state,mode).toBe('partial')
      expect(page.items[0]?.project,mode).toEqual({kind:'unknown',key:'unknown'})
      expect(JSON.stringify(page)).not.toMatch(/PRIVATE|private-project/)
      await f.source.stop()
    }
    const f=fixture();await f.source.start()
    expect((await f.source.list()).items[0]?.project).toEqual({kind:'unassigned',key:'unassigned'})
    await f.source.stop()
    const empty=fixture([]);await empty.source.start()
    expect((await empty.source.list()).state).toBe('ready')
    empty.ports.listProjects=()=>{throw new Error('private failure')}
    expect((await empty.source.list()).state).toBe('partial')
    await empty.source.stop()
  })

  it('invalidates cached project ownership and old cursors, and never publishes a membership changed during a content read', async () => {
    const f=fixture(Array.from({length:21},(_,i)=>`s${i}`))
    let projects=[{id:'project-a',title:'A',sessionIds:f.state.rows.map(row=>row.header.id)}]
    f.ports.listProjects=()=>projects;await f.source.start()
    const first=await f.source.list()
    projects=[{id:'project-b',title:'B',sessionIds:projects[0]!.sessionIds}]
    await expect(f.source.list({cursor:first.next})).rejects.toMatchObject({code:'session_work_resync'})
    expect((await f.source.list()).items.every(row=>row.project.kind==='project'&&row.project.key==='project-b')).toBe(true)
    await f.source.stop()
    const race=fixture();let current=[{id:'project-a',title:'A',sessionIds:['one']}];race.ports.listProjects=()=>current
    let finish!:(value:any)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve)
    vi.mocked(race.ports.read).mockImplementation(()=>{started();return new Promise(resolve=>finish=resolve)})
    await race.source.start();const result=race.source.list();const outcome=result.catch(error=>error);await ready
    current=[];finish({asOfSeq:0,values:{title:'Old project content'}})
    expect(await outcome).toMatchObject({code:'session_work_resync'})
    await race.source.stop()
  })

  it('projects only structured facts, separates goal/runtime, retains continued questions, redacts bounded strings and does not infer completion', async () => {
    const f = fixture(['one', 'two', 'three'])
    f.state.agents.one = { status: 'idle' }; f.state.agents.two = { status: 'alien' }
    f.state.values.one = { title: 'Label https://private.invalid/x /Users/test/private secret=unsafe',
      goal: { goal: { id: 'g', revision: 1, objective: 'Actual objective', phase: 'active', blockedReason: { code: 'test', message: 'Safe blocker message' } } },
      todos: [{ content: 'Now', status: 'in_progress' }, { content: 'Later', status: 'pending' }],
      agentTeam: { enabled: true, tasks: [{ subject: 'Do not double count', status: 'in_progress' }] },
      userQuestions: { active: [{ callId: 'q', state: 'continued', questions: [{ id: 'x', question: 'Choose direction', detail: 'not returned' }] }], settled: [{ answer: 'PRIVATE ANSWER' }] } }
    f.state.values.two = { title: 'A label is not a goal', todos: [{ content: 'Done', status: 'completed' }] }
    f.state.values.three = { title: '00000000-0000-4000-8000-000000000000' }
    await f.source.start()
    const result = await f.source.list()
    const one = result.items.find(row => row.sessionId === 'one')!
    expect(one).toMatchObject({ objective: 'Actual objective', goalPhase: 'active', runtime: 'idle', progress: 'Now', nextAction: 'Later', decision: 'Choose direction', blocker: 'Safe blocker message', evidence: 'structured' })
    expect(JSON.stringify(result)).not.toMatch(/private\.invalid|\/Users\/test|unsafe|PRIVATE ANSWER|not returned|Do not double count/)
    expect(result.items.find(row => row.sessionId === 'two')).toMatchObject({ title: 'A label is not a goal', runtime: 'unknown', evidence: 'structured' })
    expect(result.items.find(row => row.sessionId === 'two')?.objective).toBeUndefined()
    expect(result.items.find(row => row.sessionId === 'two')?.goalPhase).toBeUndefined()
    expect(result.items.find(row => row.sessionId === 'three')).toMatchObject({ title: '未提供会话标题', runtime: 'unavailable' })
    f.state.agents.one = { status: 'running' }
    expect((await f.source.list()).items.find(row => row.sessionId === 'one')?.runtime).toBe('running')
    f.state.denied = ['one']
    expect((await f.source.list()).items.map(row => row.sessionId)).not.toContain('one')
    expect(vi.mocked(f.ports.read).mock.calls.filter(call => call[0] === 'one')).toHaveLength(1)
    await f.source.stop()
  })

  it('persists only exclusion IDs, never reads exclusions, restores >100 excluded cards with revision-bound pages and auto-includes new sessions', async () => {
    let now = 10_000; vi.spyOn(Date, 'now').mockImplementation(() => now)
    const ids = Array.from({ length: 125 }, (_, index) => `s${String(index).padStart(3, '0')}`), f = fixture(ids)
    f.state.excluded = ids.slice(0, 124)
    await f.source.start()
    const first = await f.source.list({ view: 'excluded' })
    expect(first).toMatchObject({ total: 124, excludedTotal: 124, hasMore: true }); expect(first.items).toHaveLength(20)
    let cursor = first.next, seen = first.items.length
    while (cursor) { const page = await f.source.list({ view: 'excluded', cursor }); seen += page.items.length; cursor = page.next }
    expect(seen).toBe(124); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.ports.listSessions).toHaveBeenCalledTimes(1)
    const restored = await f.source.setIncluded('s000', true, { revision: first.revision! })
    expect(restored.included).toBe(true); expect(f.state.excluded).not.toContain('s000')
    await expect(f.source.list({ view: 'excluded', cursor: first.next })).rejects.toMatchObject({ code: 'session_work_resync', status: 409 })
    const included = await f.source.list()
    expect(included.items.map(row => row.sessionId)).toEqual(['s000', 's124'])
    const excluded = await f.source.setIncluded('s000', false, { revision: included.revision! })
    expect(excluded.revision).toBe(first.revision)
    const restarted = new SessionWorkSource(f.ports); await restarted.start()
    await restarted.list(); expect(vi.mocked(f.ports.read).mock.calls.filter(call => call[0] === 's000')).toHaveLength(1)
    f.state.values.s124 = { title: 'Renamed label' }; f.state.rows.push(header('new', { createdAt: 2 }))
    now += 15_001
    const next = await f.source.list()
    expect(next.items.map(row => row.sessionId)).toEqual(['new', 's124'])
    expect(next.items.find(row => row.sessionId === 's124')?.title).toBe('Renamed label')
    expect(f.state.excluded.every(id => typeof id === 'string' && !id.includes('Title'))).toBe(true)
    await f.source.stop(); await restarted.stop()
  })

  it('limits page reads to 20/concurrency 4, reuses summary flights/cache and rejects stale, forged and cross-view cursors', async () => {
    const f = fixture(Array.from({ length: 105 }, (_, i) => `s${String(i).padStart(3, '0')}`))
    let active = 0, maximum = 0
    vi.mocked(f.ports.read).mockImplementation(async id => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; return { asOfSeq: 1, values: { title: id } } })
    await f.source.start()
    const [summary, page] = await Promise.all([f.source.summary(), f.source.list()])
    expect(summary.items).toHaveLength(6); expect(page.items).toHaveLength(20); expect(page.total).toBe(105)
    expect(maximum).toBeLessThanOrEqual(4); expect(f.ports.read).toHaveBeenCalledTimes(20); expect(f.ports.listSessions).toHaveBeenCalledTimes(1)
    await f.source.summary(); expect(f.ports.read).toHaveBeenCalledTimes(20)
    await expect(f.source.list({ view: 'excluded', cursor: page.next })).rejects.toMatchObject({ code: 'session_work_resync' })
    await expect(f.source.list({ cursor: 'invalid' })).rejects.toMatchObject({ code: 'session_work_resync' })
    f.state.rows.push(header('new'))
    await expect(f.source.setIncluded('s000', false, { revision: page.revision! })).rejects.toMatchObject({ code: 'session_work_resync' })
    expect(f.ports.setExcluded).not.toHaveBeenCalled()
    await expect(f.source.list({ cursor: page.next })).rejects.toMatchObject({ code: 'session_work_resync' })
    await f.source.stop()
  })

  it('marks malformed/failing evidence partial, hides global failures and guards exclusion/access races and stop abort', async () => {
    const f = fixture(['one', 'two', 'three'])
    f.state.values.one = { title: 'Safe title', goal: 'not-json' }
    f.state.values.two = { title: 'Safe team', agentTeam: { enabled: true, tasks: [{ subject: 'Old claim', status: 'in_progress' }], failure: 'private failure' } }
    vi.mocked(f.ports.read).mockImplementation(async id => { if (id === 'three') throw new Error('PRIVATE ERROR'); return { asOfSeq: 1, values: f.state.values[id]! } })
    await f.source.start()
    const partial = await f.source.list()
    expect(partial).toMatchObject({ state: 'partial', total: 3 }); expect(partial.items.every(item => item.evidence === 'unavailable')).toBe(true)
    expect(JSON.stringify(partial)).not.toMatch(/Old claim|PRIVATE ERROR|private failure/)
    expect(partial.items.find(item => item.sessionId === 'three')?.runtime).toBe('unknown')
    await f.source.stop()
    const unavailable = fixture(); vi.mocked(unavailable.ports.listSessions).mockRejectedValue(new Error('private roster'))
    await unavailable.source.start()
    expect(await unavailable.source.list()).toMatchObject({ state: 'unavailable', total: null, excludedTotal: null, internalTotal: null, items: [] })
    await unavailable.source.stop()

    const race = fixture(); await race.source.start()
    const revision = (await race.source.list({ view: 'excluded' })).revision!
    let resolve!: (value: { asOfSeq: number; values: Record<string, unknown> }) => void
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve })
    vi.mocked(race.ports.read).mockImplementation(() => { started(); return new Promise(done => { resolve = done }) })
    const flight = race.source.list(); const outcome = flight.catch(error => error)
    await ready
    await race.source.setIncluded('one', false, { revision })
    resolve({ asOfSeq: 1, values: { title: 'Excluded private body' } })
    expect(await outcome).toMatchObject({ code: 'session_work_resync' })
    expect(JSON.stringify(await race.source.list({ view: 'excluded' }))).not.toContain('Excluded private body')
    await race.source.stop()

    const stopping = fixture(); await stopping.source.start()
    let readSignal!: AbortSignal
    vi.mocked(stopping.ports.read).mockImplementation(async (_id, signal) => { readSignal = signal; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); throw new Error('aborted') })
    const pending = stopping.source.list(); const pendingOutcome = pending.catch(error => error)
    while (!readSignal) await new Promise(resolve => setImmediate(resolve))
    await stopping.source.stop()
    expect(readSignal.aborted).toBe(true); expect(await pendingOutcome).toMatchObject({ code: 'session_work_resync' })
    expect(await stopping.source.list()).toMatchObject({ state: 'unavailable', total: null })
  })
})
