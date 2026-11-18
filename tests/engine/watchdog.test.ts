import { describe, expect, it } from 'vitest'
import { createWatchdog, measureWorker, type WatchdogAssignment, type WatchdogAudit } from '../../src/engine/watchdog.js'
const options = { stallMs: 300_000, repeatCallThreshold: 3, waitingHumanMs: 1_800_000, maxSteps: 80, maxTokens: 1000, maxDurationMs: 7_200_000, deviationIntervalMs: 600_000 }
const base: WatchdogAssignment = { assignmentId: 'a', ticketId: 't', sessionId: 's', state: 'running', startedAt: 0, lastProgressAt: 0, steps: 0, tokens: 0, briefGoal: 'fix' }
function fixture(assignment: WatchdogAssignment = { ...base }, events: any[] = [], deviation?: () => Promise<string | undefined>) {
  const audits: WatchdogAudit[] = [], actions: string[] = [], reads: string[] = []
  const watchdog = createWatchdog({ sessionQuery: { async readSession(id) { reads.push(id); return { sessionId: id, events } } }, async assignments() { return [assignment] }, async nudge(_id, msg) { actions.push(`nudge:${msg}`) }, async steer(_id, msg) { actions.push(`steer:${msg}`) }, async cancel(row) { actions.push('cancel'); Object.assign(row, { state: 'ended' }) }, async escalate() { actions.push('escalate') }, audit(record) { audits.push(record) }, deviation }, options)
  return { assignment, watchdog, actions, audits, reads }
}
describe('P4 cold-read watchdog', () => {
  it('nudges a stalled Worker then cancels only after a second timeout, auditing the original snapshot', async () => {
    const f = fixture()
    await f.watchdog.tick(300_001); await f.watchdog.tick(400_000); await f.watchdog.tick(600_002)
    expect(f.actions[0]).toContain('nudge:No recorded progress')
    expect(f.actions).toHaveLength(2); expect(f.actions[1]).toBe('cancel')
    expect(f.audits[0]).toMatchObject({ outcome: 'requested', metrics: { at: 300_001, lastProgressAt: 0 } })
    expect(f.audits.map(row => row.outcome)).toEqual(['requested', 'completed', 'requested', 'completed'])
    expect(f.reads).toEqual(['s', 's', 's'])
  })
  it('finishes stall nudge → cancel → escalate once, including after state recovery', async () => {
    const f = fixture()
    await f.watchdog.tick(300_001)
    await f.watchdog.tick(600_002)
    await f.watchdog.tick(600_003)
    await f.watchdog.tick(600_004)
    expect(f.actions.map(row => row.split(':')[0])).toEqual(['nudge', 'cancel', 'escalate'])
    expect(f.audits.every(row => typeof row.metrics.stallMs === 'number' && row.metrics.stallMs >= 0 && typeof row.metrics.tokens === 'number' && typeof row.metrics.durationMs === 'number' && typeof row.metrics.repeatedCalls === 'number')).toBe(true)
    const actions: string[] = []
    const recovered = createWatchdog({ sessionQuery: { async readSession() { return { sessionId: 's', events: [] } } }, async assignments() { return [{ ...base, state: 'ended' }] }, state() { return { stallStage: 2, stallAt: 300_001 } }, async nudge() { actions.push('nudge') }, async steer() {}, async cancel() { actions.push('cancel') }, async escalate() { actions.push('escalate') }, audit() {} }, options)
    await recovered.tick(600_003); await recovered.tick(600_004)
    expect(actions).toEqual(['escalate'])
  })
  it('identifies the exact repeated call without treating tool activity as progress', async () => {
    const events = Array.from({ length: 3 }, () => ({ type: 'tool/call', data: { name: 'read', arguments: '{"path":"same"}' } }))
    const f = fixture({ ...base }, events)
    await f.watchdog.tick(100); await f.watchdog.tick(200)
    expect(f.actions).toHaveLength(1); expect(f.actions[0]).toContain('read {"path":"same"}')
    expect(measureWorker(base, events, 200).lastProgressAt).toBe(0)
  })
  it('does not kill a 20-minute task making progress every two minutes', async () => {
    const f = fixture()
    for (let time = 120_000; time <= 1_200_000; time += 120_000) { Object.assign(f.assignment, { lastProgressAt: time }); await f.watchdog.tick(time) }
    expect(f.actions).toEqual([])
  })
  it('counts DSH disjoint input/cache/output fields toward the token budget', async () => {
    const events = [{ type: 'assistant/message', data: { usage: { inputTokens: 900, cacheReadTokens: 50, cacheWriteTokens: 20, outputTokens: 40 } } }]
    expect(measureWorker(base, events, 1).tokens).toBe(1010)
    const f = fixture({ ...base }, events)
    await f.watchdog.tick(1)
    expect(f.actions).toHaveLength(1)
    expect(f.actions[0]).toContain('tokens=1010')
  })
  it('orders budget escalation nudge → cancel → escalate exactly once', async () => {
    const f = fixture({ ...base, tokens: 1001 })
    for (let i = 0; i < 4; i++) await f.watchdog.tick(i * 100)
    expect(f.actions.map(row => row.split(':')[0])).toEqual(['nudge', 'cancel', 'escalate'])
  })
  it('only reminds waiting humans and uses low-frequency deviation steering', async () => {
    const waiting = fixture({ ...base, state: 'ended', waitingSince: 0, tokens: 1001, steps: 90 })
    await waiting.watchdog.tick(1_800_001)
    expect(waiting.actions).toEqual(['escalate'])
    const deviation = fixture({ ...base, lastProgressAt: 600_001 }, [], async () => 'Return to the brief goal')
    await deviation.watchdog.tick(600_001)
    expect(deviation.actions).toEqual(['steer:Return to the brief goal'])
  })
})
