import { describe, it, expect } from 'vitest'
import { createTrigger, sourceId, threadKey, createTicket, ticketId, decisionId, grantMandate, type TicketBrief } from '../../src/domain/index.js'

const source = sourceId('session:immutable')
const brief: TicketBrief = { goal: 'test', scope: { repo: '.', subdirs: [] }, base: { ref: 'main', requireCleanTree: true }, allowWrite: [], denyWrite: [], runtime: 'unknown', acceptance: [], outOfScope: [], blockers: ['unknown'], firstAction: 'inspect', approvalsRequired: [] }
describe('domain snapshot isolation', () => {
  it('does not retain caller references in mandate or ticket nested snapshots', () => {
    const actor = { id: 'human', source, bot: false }
    const mandate = grantMandate({ decision: { kind: 'accept', policyVersion: 'v', strength: 'explicit' }, grantedBy: actor, at: 1, scope: '.', via: 'addressed', rules: [] }, { version: 'v' })
    actor.id = 'mutated'
    expect(mandate.grantedBy.id).toBe('human')
    const supplied = { ...mandate, grantedBy: { ...mandate.grantedBy } }
    const ended = { at: 2, by: 'executor' as const, outcome: 'completed' as const }
    const t = createTicket({ id: ticketId('t'), threadKey: threadKey('th'), decisionId: decisionId('d'), mandate: supplied, brief, title: 'goal', workdir: '/tmp/test', createdAt: 1, state: 'ended', ended })
    supplied.grantedBy.id = 'changed'; ended.at = 9
    expect(t.mandate.grantedBy.id).toBe('human')
    expect(t.ended?.at).toBe(2)
    expect(Object.isFrozen(t.mandate.grantedBy)).toBe(true)
  })
  it('rejects mutable opaque objects instead of pretending they are frozen JSON', () => {
    expect(() => createTrigger({ source, externalId: 'x', threadKey: threadKey('th'), actor: { id: 'u', source, bot: false }, text: 'x', at: 1, trust: 'human', addressed: 'direct', raw: new Date() })).toThrow('plain JSON')
  })
})
