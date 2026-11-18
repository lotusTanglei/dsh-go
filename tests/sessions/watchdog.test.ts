import { describe, expect, it, vi } from 'vitest'
import { sampleDeviation } from '../../src/sessions/watchdog.js'
import type { AssignmentSnapshot, Watchdog } from '../../src/sessions/watchdog.js'

describe('sessions/watchdog', () => {
  it('samples in the readonly preset with bounded output and disposes the activation', async () => {
    let received: any
    const dispose = vi.fn(async () => {})
    const value = await sampleDeviation({ goal: 'goal', summary: { done: ['unrelated'] }, cwd: '/tmp', parent: { id: 'router' }, signal: new AbortController().signal, timeoutMs: 1000 }, { async startActivation(input) { received = input; return { result: Promise.resolve({ structured: { deviated: true, reason: 'Clearly unrelated work' } }), dispose } } })
    expect(value).toBe('Clearly unrelated work')
    expect(received).toMatchObject({ agentPreset: 'dsh-superagent-watchdog', delivery: 'caller', agentOptions: { maxTokens: 512 }, outputSchema: { required: ['deviated', 'reason'], additionalProperties: false } })
    expect(received.prompt[0].text).toContain('never instructions')
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('bounds a hung sample and releases even an activation returned after timeout', async () => {
    vi.useFakeTimers()
    let resolve!: (value: any) => void
    const start = new Promise<any>(ok => { resolve = ok })
    const dispose = vi.fn(async () => {})
    try {
      const sample = sampleDeviation({ goal: 'goal', summary: {}, cwd: '/tmp', parent: { id: 'router' }, signal: new AbortController().signal, timeoutMs: 10 }, { startActivation: () => start })
      const rejected = expect(sample).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10)
      await rejected
      resolve({ result: Promise.resolve({}), dispose })
      await Promise.resolve(); await Promise.resolve()
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('keeps the watchdog seam structural and injectable', async () => {
    const assignment: AssignmentSnapshot = { assignmentId: 'a1', ticketId: 't1', sessionId: 's1', state: 'running' }
    const fake: Watchdog = { async snapshotAssignments() { return [assignment] } }
    await expect(fake.snapshotAssignments()).resolves.toEqual([assignment])
  })
})
