import { describe, expect, it } from 'vitest'
import { createChannelDefinitions } from '../../src/client/channel.js'

const message = { id: 'notice-1', source: { kind: 'superagent-channel', form: 'notice', summary: 'notice' }, content: [{ type: 'text', text: 'Review pending approval' }] }
const splice = { type: 'agent/inbox/spliced', seq: 10, data: { target: 'next-step', inserted: [message] } }
const admitted = { type: 'user/message', seq: 20, data: message }
describe('Session Channel Conversation definition contract (no DOM simulation)', () => {
  it('publishes a channel splice immediately without waiting for model admission', () => {
    const definition = createChannelDefinitions()[0]!
    expect(definition.match(splice)).toEqual({ id: message.id, role: 'start' })
    expect(definition.publication()).toBe('immediate')
    const state = definition.start({}, { event: splice })
    const node = definition.buildViewNode({ key: 'key', id: message.id, start: { location: { kind: 'session' } }, state })
    expect(node).toMatchObject({ target: 'chat', kind: 'superagent-channel-notice', anchorSeq: 10, visibility: 'visible', groupTree: 'turn', data: { messages: [{ id: message.id, text: 'Review pending approval' }] } })
  })
  it('uses one stable identity through admission and supports cold windows without the splice', () => {
    const definition = createChannelDefinitions()[0]!
    expect(definition.match(admitted)).toEqual({ id: message.id, role: 'start', exclusive: true })
    const initial = definition.start({}, { event: splice })
    expect(definition.update({ state: initial })).toBe(initial)
    const cold = definition.start({}, { event: admitted })
    expect(cold.messages).toEqual(initial.messages)
    expect(cold.seq).toBe(20)
  })
  it('does not claim human, Worker-report or unrelated inbox events', () => {
    const definition = createChannelDefinitions()[0]!
    for (const kind of ['user', 'superagent', 'tool']) {
      const other = { ...message, source: { kind } }
      expect(definition.match({ ...splice, data: { inserted: [other] } })).toBeNull()
      expect(definition.match({ ...admitted, data: other })).toBeNull()
    }
    expect(definition.match({ type: 'assistant/message', data: {} })).toBeNull()
    expect(definition.match({ type: 'agent/inbox/spliced', data: { inserted: [] } })).toBeNull()
  })
})
