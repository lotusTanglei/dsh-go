/** Pure DTO projection; kept self-contained for Function#toString serialization. */
export function deriveDeskState(workspace: any, now: number, stale = false): {
  ready: boolean
  idle: boolean
  actionTotal: number | null
  actions: any[]
  recordTotal: number | null
  records: any[]
  moreActions: boolean
  moreRecords: boolean
} {
  const array = (value: any): any[] => Array.isArray(value) ? value : []
  const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const timestamp = (value: any): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
  const validGroup = (group: any): boolean => Array.isArray(group?.items)
    && Number.isSafeInteger(group?.total) && group.total >= 0 && group.total >= group.items.length
  const order = (a: any, b: any): number => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const known = (items: any): any[] => array(items).filter(item => object(item) && typeof item.id === 'string')
  const briefing = workspace?.briefing
  const decisions = briefing?.decisions, active = briefing?.active, results = briefing?.results
  const ready = validGroup(decisions) && validGroup(active) && validGroup(results) && Array.isArray(workspace?.admissions)
  const currentPlans = array(workspace?.admissions).filter(plan => object(plan) && typeof plan.planId === 'string'
    && Number.isFinite(now) && typeof plan.expiresAt === 'number' && Number.isFinite(plan.expiresAt) && plan.expiresAt > now)
  const livePlans = currentPlans.filter(plan => plan.state === 'pending')
  const approved = currentPlans.filter(plan => plan.state === 'approved')
  const actions = [
    ...livePlans.map(plan => ({ kind: 'plan', id: `plan:${plan.planId}`, data: plan, at: timestamp(plan.createdAt) })),
    ...known(decisions?.items).filter(decision => ['approval', 'question', 'anomaly'].includes(decision.kind))
      .map(decision => ({ kind: decision.kind, id: decision.id, data: decision, at: timestamp(decision.at) })),
  ].sort(order).slice(0, 3)
  const records = [
    ...known(active?.items).map(data => ({ kind: 'task', id: `task:${data.id}`, data, at: timestamp(data.at) })),
    ...known(results?.items).map(data => ({ kind: 'result', id: `result:${data.id}`, data, at: timestamp(data.at) })),
    ...approved.map(plan => ({ kind: 'confirmed-plan', id: `plan:${plan.planId}`, data: plan, at: timestamp(plan.createdAt) })),
  ].sort(order).slice(0, 3)
  // Incomplete snapshots retain bounded known cards, but cannot claim totals or idle.
  const actionTotal = ready ? livePlans.length + decisions.total : null
  const recordTotal = ready ? active.total + results.total + approved.length : null
  return {
    ready,
    idle: ready && !stale && actionTotal === 0 && active.total === 0 && approved.length === 0,
    actionTotal,
    actions,
    recordTotal,
    records,
    moreActions: actionTotal !== null && actionTotal > actions.length,
    moreRecords: recordTotal !== null && recordTotal > records.length,
  }
}
