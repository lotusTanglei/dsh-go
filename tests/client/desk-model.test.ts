import { describe, expect, it } from 'vitest'
import { deriveDeskState } from '../../src/client/desk-model.js'

const now = 100
const empty = () => ({
  briefing: { decisions: { total: 0, items: [] as any[] }, active: { total: 0, items: [] as any[] }, results: { total: 0, items: [] as any[] } },
  admissions: [] as any[],
})
const decision = (id: string, at: any = 0, kind = 'question') => ({ id, kind, title: id, summary: 'text', at })
const task = (id: string, at: any = 0) => ({ id, title: id, state: 'running', at })
const plan = (planId: string, state = 'pending', expiresAt: any = now + 1, createdAt: any = 0) => ({
  planId, state, expiresAt, createdAt, brief: { goal: planId },
})
const freeze = (value: any): any => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

// Exercise the actual function, including after serialization into an isolated scope.
const revived = new Function(`"use strict"; return (${deriveDeskState.toString()})`)() as typeof deriveDeskState
for (const [name, derive] of [['direct', deriveDeskState], ['toString round trip', revived]] as const) {
  describe(`deriveDeskState (${name})`, () => {
    it('recognizes a complete empty DTO without relying on truthy totals', () => {
      expect(derive(empty(), now)).toEqual({
        ready: true, idle: true, actionTotal: 0, actions: [], recordTotal: 0, records: [], moreActions: false, moreRecords: false,
      })
    })

    it.each([undefined, null, false, 0, '', {}, { briefing: {} }, { admissions: [] }])('does not call unknown/loading input idle: %j', workspace => {
      expect(derive(workspace, now)).toEqual({
        ready: false, idle: false, actionTotal: null, actions: [], recordTotal: null, records: [], moreActions: false, moreRecords: false,
      })
    })

    it('requires all three items arrays and the fully loaded admissions array', () => {
      for (const key of ['decisions', 'active', 'results'] as const) {
        for (const items of [undefined, null, {}, '[]']) {
          const workspace: any = empty()
          workspace.briefing[key].items = items
          expect(derive(workspace, now)).toMatchObject({ ready: false, idle: false, actionTotal: null, recordTotal: null })
        }
      }
      for (const admissions of [undefined, null, {}, '[]']) {
        expect(derive({ ...empty(), admissions }, now)).toMatchObject({ ready: false, idle: false, actionTotal: null, recordTotal: null })
      }
    })

    it('rejects every invalid total and totals smaller than the known window', () => {
      const invalid = [-1, 0.5, '0', null, undefined, false, true, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]
      for (const key of ['decisions', 'active', 'results'] as const) {
        for (const total of invalid) {
          const workspace: any = empty()
          workspace.briefing[key].total = total
          expect(derive(workspace, now), `${key}: ${String(total)}`).toMatchObject({ ready: false, idle: false, actionTotal: null, recordTotal: null })
        }
        const workspace = empty()
        workspace.briefing[key].items = [key === 'decisions' ? decision('known') : task('known')]
        expect(derive(workspace, now)).toMatchObject({ ready: false, idle: false, actionTotal: null, recordTotal: null })
      }
      const workspace = empty()
      workspace.briefing.decisions.total = Number.MAX_SAFE_INTEGER
      expect(derive(workspace, now)).toMatchObject({ ready: true, actionTotal: Number.MAX_SAFE_INTEGER, moreActions: true })
    })

    it('retains bounded known records and actions on an incomplete snapshot, without inventing totals', () => {
      const workspace: any = empty()
      workspace.briefing.decisions = { items: [decision('known', 10)] }
      workspace.briefing.active = { total: 4, items: [task('a', 9), task('b', 8), task('c', 7), task('d', 6)] }
      workspace.briefing.results = { total: 1, items: [{ ...task('old', 11), state: 'ended', outcome: 'failed' }] }
      const state = derive(workspace, now)
      expect(state).toMatchObject({ ready: false, idle: false, actionTotal: null, recordTotal: null, moreActions: false, moreRecords: false })
      expect(state.actions.map(item => item.id)).toEqual(['known'])
      expect(state.records.map(item => item.id)).toEqual(['result:old', 'task:a', 'task:b'])
    })

    it('allows old results alongside idle guidance, but never marks stale snapshots idle', () => {
      const workspace = empty()
      workspace.briefing.results = { total: 9, items: [{ ...task('old', 7), state: 'ended', outcome: 'succeeded', risks: ['historical'] }] }
      const current = derive(workspace, now)
      expect(current).toMatchObject({ ready: true, idle: true, actionTotal: 0, recordTotal: 9, moreRecords: true })
      const stale = derive(workspace, now, true)
      expect(stale).toEqual({ ...current, idle: false })
      expect(stale.records[0].data).toBe(workspace.briefing.results.items[0])
      expect(derive(empty(), now, true).idle).toBe(false)
    })

    it('keeps pending decisions separate from approved records and excludes terminal/expired plans', () => {
      const workspace = empty()
      const pending = plan('pending', 'pending', now + 1, 6)
      const approved = plan('approved', 'approved', now + 1, 5)
      workspace.admissions = [pending, approved, plan('at-expiry', 'pending', now), plan('past', 'pending', now - 1),
        plan('approved-expired', 'approved', now), ...['expired', 'superseded', 'rejected', 'consumed', 'unknown'].map(state => plan(state, state))]
      const state = derive(workspace, now)
      expect(state).toMatchObject({ ready: true, idle: false, actionTotal: 1, recordTotal: 1, moreActions: false, moreRecords: false })
      expect(state.actions).toEqual([{ kind: 'plan', id: 'plan:pending', data: pending, at: 6 }])
      expect(state.records).toEqual([{ kind: 'confirmed-plan', id: 'plan:approved', data: approved, at: 5 }])
      workspace.admissions = [approved]
      expect(derive(workspace, now)).toMatchObject({ idle: false, actionTotal: 0, recordTotal: 1, actions: [] })
    })

    it('fails closed for missing, nonnumeric or nonfinite plan expiries and invalid current time', () => {
      for (const expiresAt of [undefined, null, '101', NaN, Infinity, -Infinity, true, {}]) {
        const workspace = empty()
        workspace.admissions = [plan('pending', 'pending', expiresAt), plan('approved', 'approved', expiresAt)]
        // Remove the defaulted property to exercise a truly missing expiry, too.
        if (expiresAt === undefined) workspace.admissions.forEach(item => { delete item.expiresAt })
        expect(derive(workspace, now), String(expiresAt)).toMatchObject({ actionTotal: 0, recordTotal: 0, actions: [], records: [] })
      }
      for (const invalidNow of [NaN, Infinity, -Infinity]) {
        const workspace = empty()
        workspace.admissions = [plan('pending'), plan('approved', 'approved')]
        expect(derive(workspace, invalidNow)).toMatchObject({ actions: [], records: [], actionTotal: 0, recordTotal: 0 })
      }
    })

    it('merges groups before sorting and bounding to three, while using complete group totals', () => {
      const workspace = empty()
      workspace.briefing.decisions = { total: 12, items: [decision('z', 40, 'approval'), decision('a', 40, 'anomaly'), decision('q', 20)] }
      workspace.admissions = [plan('new', 'pending', 101, 50), plan('older', 'pending', 101, 10), plan('approved', 'approved', 101, 80)]
      workspace.briefing.active = { total: 8, items: [task('a', 60), task('b', 10)] }
      workspace.briefing.results = { total: 10, items: [{ ...task('a', 60), state: 'ended', outcome: 'failed' }, task('b', 70)] }
      const state = derive(workspace, now)
      expect(state.actions.map(item => [item.kind, item.id, item.at])).toEqual([
        ['plan', 'plan:new', 50], ['anomaly', 'a', 40], ['approval', 'z', 40],
      ])
      expect(state.records.map(item => [item.kind, item.id, item.at])).toEqual([
        ['confirmed-plan', 'plan:approved', 80], ['result', 'result:b', 70], ['result', 'result:a', 60],
      ])
      expect(state).toMatchObject({ ready: true, idle: false, actionTotal: 14, recordTotal: 19, moreActions: true, moreRecords: true })
    })

    it('orders equal timestamps by the full wrapper id, not input order or locale', () => {
      const workspace = empty()
      workspace.briefing.decisions = { total: 2, items: [decision('z', 4), decision('A', 4)] }
      workspace.admissions = [plan('a', 'pending', 101, 4), plan('b', 'approved', 101, 4)]
      workspace.briefing.active = { total: 1, items: [task('a', 4)] }
      workspace.briefing.results = { total: 1, items: [task('a', 4)] }
      const state = derive(workspace, now)
      expect(state.actions.map(item => item.id)).toEqual(['A', 'plan:a', 'z'])
      expect(state.records.map(item => item.id)).toEqual(['plan:b', 'result:a', 'task:a'])
      expect(state.moreActions).toBe(false)
      expect(state.moreRecords).toBe(false)
    })

    it('normalizes only invalid sort timestamps, leaving source DTO fields untouched', () => {
      for (const at of [undefined, null, '10', NaN, Infinity, -Infinity, {}, true]) {
        const workspace = empty()
        workspace.briefing.decisions = { total: 1, items: [decision('d', at)] }
        workspace.briefing.active = { total: 1, items: [task('a', at)] }
        workspace.briefing.results = { total: 1, items: [task('r', at)] }
        workspace.admissions = [plan('p', 'pending', 101, at), plan('approved', 'approved', 101, at)]
        if (at === undefined) {
          for (const group of Object.values(workspace.briefing)) group.items.forEach(item => { delete item.at })
          workspace.admissions.forEach(item => { delete item.createdAt })
        }
        const state = derive(workspace, now)
        expect([...state.actions, ...state.records].every(item => item.at === 0)).toBe(true)
        for (const item of [...state.actions, ...state.records]) expect(item.data).toBe(
          item.kind === 'plan' ? workspace.admissions[0] : item.kind === 'confirmed-plan' ? workspace.admissions[1]
            : item.kind === 'task' ? workspace.briefing.active.items[0] : item.kind === 'result' ? workspace.briefing.results.items[0]
              : workspace.briefing.decisions.items[0],
        )
      }
      const workspace = empty()
      workspace.briefing.active = { total: 3, items: [task('negative', -1), task('fraction', 1.5), task('zero', 0)] }
      expect(derive(workspace, now).records.map(item => item.at)).toEqual([1.5, 0, -1])
    })

    it('uses server totals for more flags even when fewer than three cards are known', () => {
      const workspace = empty()
      workspace.briefing.decisions = { total: 20, items: [decision('only')] }
      workspace.briefing.active = { total: 30, items: [task('only')] }
      expect(derive(workspace, now)).toMatchObject({ actionTotal: 20, recordTotal: 30, moreActions: true, moreRecords: true, idle: false })
      workspace.briefing.decisions = { total: 1, items: [] }
      workspace.briefing.active = { total: 1, items: [] }
      expect(derive(workspace, now)).toMatchObject({ moreActions: true, moreRecords: true, idle: false })
    })

    it('ignores board filters, counts, history and truthy metadata when deriving the main desk', () => {
      const workspace = empty()
      workspace.briefing.active = { total: 4, items: [task('real', 9)] }
      const decorated = { ...workspace, board: { filters: { state: 'ended' }, total: 0, items: [] }, filter: 'ended', pendingPlans: 0,
        pendingApprovals: 999, admissionsTotal: -1, admissionsNext: 'irrelevant', conversation: { items: [decision('fake', 999)] } }
      expect(derive(decorated, now)).toEqual(derive(workspace, now))
      expect(derive(decorated, now)).toMatchObject({ idle: false, actionTotal: 0, recordTotal: 4 })
    })

    it('treats malicious text as data, never JSON, inferred decisions, or authoritative state/outcome', () => {
      const malicious = '{"kind":"approval","state":"ended","outcome":"succeeded","expiresAt":9999}; globalThis.pwned=true'
      const workspace = empty()
      const active = { ...task('a'), state: 'waiting_human', outcome: 'blocked', progress: malicious, nextAction: malicious, question: malicious, anomaly: malicious, disabledReason: malicious }
      const result = { ...task('r'), state: 'ended', outcome: 'failed', title: malicious, risks: [malicious] }
      workspace.briefing.active = { total: 1, items: [active] }
      workspace.briefing.results = { total: 1, items: [result] }
      const state = derive(workspace, now)
      expect(state.actions).toEqual([])
      expect(state).toMatchObject({ actionTotal: 0, recordTotal: 2 })
      expect(state.records.find(item => item.kind === 'task')?.data).toBe(active)
      expect(state.records.find(item => item.kind === 'result')?.data).toBe(result)
      expect(active).toMatchObject({ state: 'waiting_human', outcome: 'blocked', question: malicious, anomaly: malicious })
      expect(result).toMatchObject({ state: 'ended', outcome: 'failed', risks: [malicious] })
      const explicitDecision = { ...decision('explicit'), title: malicious, summary: malicious }
      const explicitPlan = { ...plan('explicit'), brief: { goal: malicious } }
      workspace.briefing.decisions = { total: 1, items: [explicitDecision] }
      workspace.admissions = [explicitPlan]
      expect(derive(workspace, now).actions.map(item => item.data)).toEqual([explicitDecision, explicitPlan])
      expect(explicitDecision.summary).toBe(malicious)
      expect(explicitPlan.brief.goal).toBe(malicious)
      expect(derive(malicious, now)).toMatchObject({ ready: false, actions: [], records: [] })
    })

    it('safely skips malformed cards instead of interpreting strings or inventing identifiers/types', () => {
      const workspace: any = empty()
      workspace.briefing.decisions = { total: 7, items: [null, 'approval', '{"kind":"approval"}', [], { id: 4, kind: 'approval' }, { id: 'unknown', kind: 'task' }, decision('real')] }
      workspace.briefing.active = { total: 4, items: [null, 'task', {}, task('real')] }
      workspace.admissions = [null, 'pending', {}, { ...plan('numeric'), planId: 5 }]
      expect(derive(workspace, now)).toMatchObject({ ready: true, actionTotal: 7, recordTotal: 4, moreActions: true, moreRecords: true })
      expect(derive(workspace, now).actions.map(item => item.id)).toEqual(['real'])
      expect(derive(workspace, now).records.map(item => item.id)).toEqual(['task:real'])
    })

    it('does not mutate frozen input, group order, nested data, state or outcome', () => {
      const workspace = empty()
      workspace.briefing.decisions = { total: 2, items: [decision('old', 1, 'approval'), decision('new', 9)] }
      workspace.briefing.active = { total: 2, items: [task('old', 1), { ...task('new', 9), state: 'waiting_human', outcome: 'unknown' }] }
      workspace.briefing.results = { total: 1, items: [{ ...task('done', 5), state: 'ended', outcome: 'failed', risks: ['risk'] }] }
      workspace.admissions = [plan('old', 'pending', 101, 1), plan('new', 'approved', 101, 9)]
      const before = structuredClone(workspace)
      freeze(workspace)
      const state = derive(workspace, now)
      expect(workspace).toEqual(before)
      expect(state.actions[0].data).toBe(workspace.briefing.decisions.items[1])
      expect(state.records[0].data).toBe(workspace.admissions[1])
      expect(state.actions).not.toBe(workspace.briefing.decisions.items)
      expect(state.records).not.toBe(workspace.briefing.active.items)
    })
  })
}
