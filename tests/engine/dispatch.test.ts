import { describe, expect, it } from 'vitest'
import { isAbsolute, join } from 'node:path'
import { createAssignment } from '../../src/domain/assignment.js'
import { assignmentId, decisionId, sourceId, ticketId } from '../../src/domain/ids.js'
import { createTicket, type TicketBrief } from '../../src/domain/ticket.js'
import { createTrigger, type Trigger } from '../../src/domain/trigger.js'
import { dispatchTriggers, type AcceptedDispatch } from '../../src/engine/dispatch.js'
import type { Report } from '../../src/engine/report.js'
import type { Spawner } from '../../src/sessions/worker.js'

const workRoot = '/tmp/superagent-dispatch-test'
const workerPreset = 'superagent-worker'
const brief: TicketBrief = {
  goal: 'Prove the injected dispatch seam',
  scope: { repo: 'fixture/repo', subdirs: ['src'] },
  base: { ref: 'main', requireCleanTree: true },
  allowWrite: ['src/**'],
  denyWrite: [],
  runtime: 'No shell, server, or network for this fixture',
  acceptance: [{ id: 'A1', check: 'The fake worker returns its report', kind: 'assertion' }],
  outOfScope: ['Persistence and intake'],
  blockers: [],
  firstAction: 'Read the supplied brief',
  approvalsRequired: [],
}

function trigger(id: string): Trigger {
  const source = sourceId('fixture')
  return createTrigger({
    source, externalId: id, threadRef: { source, kind: 'test', id },
    actor: { id: 'human', source, bot: false },
    text: id === 'chat' ? 'Just chatting' : `Please handle ${id}`,
    at: 100, trust: 'human', addressed: 'direct', raw: null,
  })
}

function accept(input: Trigger, id = input.externalId): AcceptedDispatch | undefined {
  if (id === 'chat') return undefined
  const ticket = createTicket({
    id: ticketId(id), threadKey: input.threadKey, decisionId: decisionId(`decision-${id}`),
    title: `Fixture ${id}`, brief, workdir: join(workRoot, id), createdAt: input.at,
    mandate: {
      strength: 'explicit', policyVersion: 'fixture-policy', grantedBy: input.actor,
      at: input.at, scope: brief.scope.repo, via: 'addressed', rules: [],
    },
  })
  const assignment = createAssignment({
    id: assignmentId(`assignment-${id}`), ticketId: ticket.id,
    sessionId: `worker-${id}`, createdAt: input.at,
  })
  return { ticket, assignment }
}

function report(done: string): Report {
  return {
    state: 'ready', done: [done], todo: [], changedPaths: ['src/fixture.ts'],
    acceptance: [{ id: 'A1', result: 'passed', evidence: 'Fake worker completed A1' }],
    risks: [], needHuman: [],
  }
}

function fakeSpawner(outputs: readonly unknown[]) {
  const calls: Parameters<Spawner['startActivation']>[0][] = []
  const spawner: Spawner = {
    async startActivation(input) {
      const index = calls.push(input) - 1
      return {
        id: `activation-${index}`,
        sessionId: input.childId ?? `worker-${index}`,
        result: Promise.resolve({ structured: outputs[index] }),
        async dispose() {},
      }
    },
  }
  return { spawner, calls }
}

function options(spawner: Spawner) {
  return {
    spawner, workRoot, workerPreset,
    parent: { id: 'router-session' },
    signal: new AbortController().signal,
    accept,
    now: () => 200,
  }
}

describe('P2 injected dispatch', () => {
  it('returns two validated reports to Router from three fake triggers and exactly two workers', async () => {
    const reports = [report('First result'), report('Second result')]
    const { spawner, calls } = fakeSpawner(reports)
    const accepted: AcceptedDispatch[] = []
    const results = await dispatchTriggers([trigger('one'), trigger('chat'), trigger('two')], {
      ...options(spawner),
      accept(input) {
        const work = accept(input)
        if (work) accepted.push(work)
        return work
      },
    })

    expect(accepted).toHaveLength(2)
    expect(accepted.every(({ ticket, assignment }) => ticket.state === 'open' && assignment.state === 'pending')).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.cwd)).toEqual([join(workRoot, 'one'), join(workRoot, 'two')])
    expect(calls.every((call) => isAbsolute(call.cwd))).toBe(true)
    expect(calls.every((call) => call.provider === 'spawn' && call.delivery === 'caller')).toBe(true)
    expect(calls.map((call) => call.agentPreset)).toEqual([workerPreset, workerPreset])
    expect(calls.every((call) => call.outputSchema !== undefined)).toBe(true)
    expect(results.map((result) => result.report)).toEqual(reports)
    expect(results.map((result) => [result.ticketId, result.assignmentId])).toEqual([
      ['one', 'assignment-one'], ['two', 'assignment-two'],
    ])
  })

  it('rejects malformed structured output rather than returning it to Router', async () => {
    const { spawner, calls } = fakeSpawner([{ state: 'ready', done: [] }])
    await expect(dispatchTriggers([trigger('one')], options(spawner))).rejects.toThrow(/invalid.*report/i)
    expect(calls).toHaveLength(1)
  })

  it('compares report acceptance with the dispatched brief', async () => {
    const wrongAcceptance = { ...report('Wrong criterion'), acceptance: [{ id: 'A2', result: 'passed', evidence: 'Wrong id' }] }
    const { spawner } = fakeSpawner([wrongAcceptance])
    await expect(dispatchTriggers([trigger('one')], options(spawner))).rejects.toThrow(/invalid.*report/i)
  })

  it('rejects a relative work root before starting any worker', async () => {
    const { spawner, calls } = fakeSpawner([report('Unused')])
    await expect(dispatchTriggers([trigger('one')], { ...options(spawner), workRoot: 'relative' })).rejects.toThrow(/absolute/i)
    expect(calls).toHaveLength(0)
  })

  it('rejects ticket ids that escape the assigned work root', async () => {
    const { spawner, calls } = fakeSpawner([report('Unused')])
    await expect(dispatchTriggers([trigger('one')], {
      ...options(spawner), accept: (input) => accept(input, '../outside'),
    })).rejects.toThrow(/ticket id/i)
    expect(calls).toHaveLength(0)
  })

  it('rejects a ticket workdir that does not match its isolated directory', async () => {
    const { spawner, calls } = fakeSpawner([report('Unused')])
    await expect(dispatchTriggers([trigger('one')], {
      ...options(spawner),
      accept(input) {
        const accepted = accept(input)!
        return { ...accepted, ticket: { ...accepted.ticket, workdir: '/tmp/other-workdir' } }
      },
    })).rejects.toThrow(/workdir/i)
    expect(calls).toHaveLength(0)
  })

  it('rejects a missing worker preset before starting a worker', async () => {
    const { spawner, calls } = fakeSpawner([report('Unused')])
    await expect(dispatchTriggers([trigger('one')], { ...options(spawner), workerPreset: '' })).rejects.toThrow(/preset/i)
    expect(calls).toHaveLength(0)
  })

  it('rejects an assignment belonging to another ticket before starting a worker', async () => {
    const { spawner, calls } = fakeSpawner([report('Unused')])
    await expect(dispatchTriggers([trigger('one')], {
      ...options(spawner),
      accept(input) {
        const accepted = accept(input)!
        return { ...accepted, assignment: { ...accepted.assignment, ticketId: ticketId('other') } }
      },
    })).rejects.toThrow(/assignment.*ticket/i)
    expect(calls).toHaveLength(0)
  })
})
