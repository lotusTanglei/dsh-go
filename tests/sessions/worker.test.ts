import { describe, expect, it } from 'vitest'
import { assignmentId, ticketId } from '../../src/domain/ids.js'
import type { TicketBrief } from '../../src/domain/ticket.js'
import { startWorker, type SpawnActivationInput, type Spawner } from '../../src/sessions/worker.js'

const brief: TicketBrief = {
  goal: 'test worker', scope: { repo: '/repo', subdirs: ['src'] },
  base: { ref: 'main', requireCleanTree: true }, allowWrite: ['src/**'], denyWrite: [],
  runtime: 'test', acceptance: [{ id: 'A1', check: 'works', kind: 'assertion' }],
  outOfScope: [], blockers: [], firstAction: 'run test', approvalsRequired: [],
}

describe('sessions/worker', () => {
  it('adapts startActivation with the required spawn/caller shape', async () => {
    let call: SpawnActivationInput | undefined
    const spawner: Spawner = {
      async startActivation(input) {
        call = input
        return {
          id: 'activation-1', sessionId: 'child-1',
          result: Promise.resolve({ structured: { state: 'ready' } }),
          async dispose() {},
        }
      },
    }
    const signal = new AbortController().signal
    const worker = await startWorker({
      ticket: { id: ticketId('ticket-1'), title: 'Ticket', brief, workdir: '/tmp/work' },
      assignment: { id: assignmentId('assignment-1'), ticketId: ticketId('ticket-1'), sessionId: 'child-1' },
      brief, workdir: '/tmp/work', preset: 'dsh-superagent-worker', parent: { id: 'router' }, signal,
    }, spawner)

    expect(call).toMatchObject({
      provider: 'spawn', delivery: 'caller', cwd: '/tmp/work', agentPreset: 'dsh-superagent-worker',
      childId: 'child-1', parent: { id: 'router' }, signal,
    })
    expect(call?.outputSchema).toBeDefined()
    expect(call?.outputSchema.required).toEqual(expect.arrayContaining(['state', 'acceptance']))
    expect(worker.sessionId).toBe('child-1')
    await expect(worker.result).resolves.toEqual({ structured: { state: 'ready' } })
  })

  it('rejects relative worker directories before invoking the spawner', async () => {
    let called = false
    const spawner: Spawner = { async startActivation() { called = true; throw new Error('unexpected') } }
    await expect(startWorker({
      ticket: { id: ticketId('ticket-1'), title: 'Ticket', brief, workdir: 'relative' },
      assignment: { id: assignmentId('assignment-1'), ticketId: ticketId('ticket-1'), sessionId: 'child-1' },
      brief, workdir: 'relative', preset: 'worker',
    }, spawner)).rejects.toThrow(/absolute/i)
    expect(called).toBe(false)
  })
})
