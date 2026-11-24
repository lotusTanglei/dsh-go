import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/client/workspace.ts', 'utf8')
const tree = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, globals: Record<string, any> = {}): any {
  let initializer = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) initializer = node.initializer.getText(tree); node.forEachChild(visit) }
  visit(tree)
  if (!initializer) throw new Error(`Missing ${name}`)
  const context = createContext(globals)
  new Script(ts.transpileModule(`globalThis.actual = (${initializer})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText).runInContext(context)
  return context.actual
}
const array = (value: any) => Array.isArray(value) ? value : []
const tr = (key: string) => key
const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children })

// Execute the actual closures. These are data/interaction contracts, not DOM or visual proof.
describe('read-only conversation work UI closures', () => {
  it('separates durable active/complete from idle runtime and never turns missing evidence into work', () => {
    const card = closure('sessionWorkCard', { h, array, React: { Fragment: 'fragment' }, tr, displayTitle: (v: any) => v, sessionSourceTitle: (v: any) => v.title, sessionWorkBusy: '', time: () => 'snapshot', button() {} })
    const base = { sessionId: 'source', title: 'Source', evidence: 'structured', objective: 'Ship feature', goalPhase: 'active', runtime: 'idle' }
    const active = JSON.stringify(card(base))
    expect(active).toContain('SessionWorkGoalActive'); expect(active).toContain('SessionWorkRuntimeIdle'); expect(active).not.toContain('SessionWorkGoalCompleted')
    expect(JSON.stringify(card({ ...base, goalPhase: 'complete' }))).toContain('SessionWorkGoalCompleted')
    const missing = JSON.stringify(card({ ...base, evidence: 'unavailable', decision: 'Do not invent me' }))
    expect(missing).toContain('SessionWorkNoSummary'); expect(missing).not.toContain('Ship feature'); expect(missing).not.toContain('Do not invent me')
    const blocker = JSON.stringify(card({ ...base, blocker: 'Waiting for CI' }))
    expect(blocker).not.toContain('SessionWorkDecision')
    const readFull = closure('sessionWorkCard', { h, array, React: { Fragment: 'fragment' }, tr, displayTitle: (v: string) => v.slice(0, 8), sessionSourceTitle: (v: any) => v.title, sessionWorkBusy: '', time: () => 'snapshot', button() {} })
    const objective = 'A complete objective that must remain readable on the source page', decision = 'A complete question that must remain readable without a hover tooltip'
    const preview = JSON.stringify(readFull({ ...base, objective, decision }))
    expect(preview).not.toContain(objective)
    const managed = JSON.stringify(readFull({ ...base, objective, decision }, true, 'revision'))
    expect(managed).toContain(objective); expect(managed).toContain(decision); expect(managed).not.toContain('saw-line-clamp')
  })

  it('groups by authoritative identity rather than label, merging cross-page rows and keeping unknown/unassigned separate', () => {
    const group=closure('groupSessionWork',{array,tr})
    const p=(key:string,name='Same project')=>({kind:'project',key,name})
    const rows=[{sessionId:'a',project:p('one')},{sessionId:'b',project:p('two')},{sessionId:'c',project:p('one')},{sessionId:'unassigned',project:{kind:'unassigned',key:'unassigned'}},{sessionId:'unknown',project:{kind:'unknown',key:'unknown'}},{sessionId:'legacy'},{sessionId:'a',project:p('wrong')}]
    const groups=group(rows)
    expect(groups.map((item:any)=>item.key)).toEqual(['project:one','project:two','unassigned','unknown'])
    expect(groups[0].items.map((row:any)=>row.sessionId)).toEqual(['a','c'])
    expect(groups[1].items.map((row:any)=>row.sessionId)).toEqual(['b'])
    expect(groups[3].items.map((row:any)=>row.sessionId)).toEqual(['unknown','legacy'])
    expect(groups[0].name).toBe(groups[1].name)
  })

  it('renders project headings first, disambiguates duplicate project names, and limits only the preview rather than source management', () => {
    const groupSessionWork=closure('groupSessionWork',{array,tr})
    const render=closure('sessionProjectGroups',{groupSessionWork,h,tr,sessionWorkCard:(row:any)=>({session:row.sessionId})})
    const rows=[{sessionId:'a',project:{kind:'project',key:'abcdefgh-111',name:'Same'}},{sessionId:'b',project:{kind:'project',key:'abcdefgh-222',name:'Same'}},{sessionId:'c',project:{kind:'project',key:'abcdefgh-111',name:'Same'}},{sessionId:'d',project:{kind:'unassigned',key:'unassigned'}},{sessionId:'e'}]
    const preview=JSON.stringify(render(rows,false,undefined,true))
    expect(preview).toContain('abcdefgh-1');expect(preview).toContain('abcdefgh-2')
    expect(preview).toContain('"session":"a"');expect(preview).not.toContain('"session":"c"');expect(preview).not.toContain('"session":"e"')
    const full=JSON.stringify(render(rows,true,'revision',false))
    expect(full).toContain('"session":"c"');expect(full).toContain('"session":"e"');expect(full).toContain('ProjectLoadedSessions')
    expect(full).toContain('"tag":"h4"');expect(full).not.toMatch(/"tag":"button"|activate|steer/)
  })

  it('distinguishes same-title included sessions in source management without turning identities into headlines', () => {
    const card=closure('sessionWorkCard',{h,array,React:{Fragment:'fragment'},tr,displayTitle:(v:any)=>v,sessionSourceTitle:(row:any)=>row.title,sessionWorkBusy:'',time:()=>'',button(){}})
    const base={title:'Same title',evidence:'missing',runtime:'idle'}
    const first=JSON.stringify(card({...base,sessionId:'session-first-12345678'},true,'revision')),second=JSON.stringify(card({...base,sessionId:'session-next-87654321'},true,'revision'))
    expect(first).toContain('…12345678');expect(second).toContain('…87654321')
    expect(first).toContain('SessionWorkReference');expect(second).toContain('SessionWorkReference')
    expect(first).toContain('session-first-12345678');expect(second).toContain('session-next-87654321')
  })

  it('never uses raw UUID as a source headline and keeps excluded references secondary', () => {
    const title = closure('sessionSourceTitle', { tr, displayTitle: (v: any) => v })
    expect(title({ sessionId: 'id', title: 'edc79c24-8071-4318-a972-afb5e0649922' })).toBe('SessionWorkUntitled')
    expect(title({ sessionId: 'id', title: 'id' })).toBe('SessionWorkUntitled')
    expect(title({ sessionId: 'id', title: 'Fix cart' })).toBe('Fix cart')
  })

  it('reads only the dedicated route and rejects cross-revision pagination without mixing records', async () => {
    const old = { revision: 'r1', items: [{ sessionId: 'one' }], hasMore: true, next: 'opaque' }, pages = { current: { included: old } }, errors: string[] = [], calls: any[] = []
    const read = closure('readSessionWork', { epochRef: { current: 'epoch' }, sessionWorkBusyRef: { current: false }, sessionWorkGeneration: { current: 0 }, sessionWorkPagesRef: pages, alive: { current: true }, array, tr,
      setSessionWorkBusy() {}, setSessionWorkError: (v: string) => errors.push(v), setSessionWorkPages() {},
      call: async (path: string, input: any) => { calls.push({ path, input }); return { revision: 'r2', items: [{ sessionId: 'two' }] } },
    })
    await read('included', true)
    expect(calls).toEqual([{ path: 'session-work', input: { action: 'list', epoch: 'epoch', view: 'included', limit: 20, cursor: 'opaque' } }])
    expect(pages.current).toEqual({}); expect(errors.at(-1)).toBe('SessionWorkChanged') // Known revision drift revokes the old body, not merely its next cursor.
  })

  it('does not hide or retry membership changes after an uncertain receipt', async () => {
    const pages = { current: { included: { items: ['retain'] } } }, errors: string[] = [], calls: any[] = []
    const change = closure('setSessionIncluded', { epochRef: { current: 'epoch' }, sessionWorkBusyRef: { current: false }, sessionWorkGeneration: { current: 0 }, sessionWorkPagesRef: pages, alive: { current: true }, tr,
      setSessionWorkBusy() {}, setSessionWorkError: (v: string) => errors.push(v), setSessionWorkPages() { throw new Error('must retain') }, setNotice() {},
      call: async (path: string, input: any) => { calls.push({ path, input }); throw new Error('network') },
    })
    await change({ sessionId: 'one' }, false, 'r1')
    expect(calls).toEqual([{ path: 'session-work', input: { action: 'set-included', epoch: 'epoch', sessionId: 'one', included: false, revision: 'r1' } }])
    expect(errors.at(-1)).toBe('SessionWorkSaveFailed'); expect(pages.current.included.items).toEqual(['retain'])
  })

  it('refreshes only after a confirmed membership receipt, without optimistic preview edits or controls', async () => {
    const calls: any[] = [], pages = { current: { included: {} } }, notices: string[] = []
    const change = closure('setSessionIncluded', { epochRef: { current: 'epoch' }, sessionWorkBusyRef: { current: false }, sessionWorkGeneration: { current: 0 }, sessionWorkPagesRef: pages, alive: { current: true }, excludedOpenRef: { current: true }, tr,
      setSessionWorkBusy() {}, setSessionWorkError() {}, setSessionWorkPages() {}, setNotice: (v: string) => notices.push(v), poke: { current: () => calls.push('preview') },
      readSessionWork: async (view: string) => calls.push(view), call: async (path: string, input: any) => { calls.push(path); return { sessionId: input.sessionId, included: input.included } },
    })
    await change({ sessionId: 'one' }, true, 'r1')
    expect(calls).toEqual(['session-work', 'preview', 'included', 'excluded']); expect(notices).toEqual(['SessionWorkRestored'])
    expect(pages.current).toEqual({})
  })
})
