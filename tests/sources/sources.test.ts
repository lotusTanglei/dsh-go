import { describe, expect, it } from 'vitest'
import { sourceId, threadKey } from '../../src/domain/ids.js'
import { createTrigger } from '../../src/domain/trigger.js'
import { SourceRegistry } from '../../src/sources/registry.js'
import { SessionSource } from '../../src/sources/session.js'
import { FakeSource } from '../../src/sources/fake.js'

const source = sourceId('inbox:one')
const trigger = (id: string, at: number) => createTrigger({ source, externalId: id, threadKey: threadKey('one'), actor: { id: 'human', source, bot: false }, text: 'task', at, trust: 'human', addressed: 'direct', raw: null })
describe('source instances', () => {
  it('keys by instance rather than kind and rejects duplicates', async () => {
    const effects: Array<() => void | Promise<void>> = []
    const registry = new SourceRegistry({ effect(factory) { effects.push(factory()) } })
    const one = new FakeSource(source, () => {})
    const two = new FakeSource(sourceId('inbox:two'), () => {})
    registry.register(one); registry.register(two)
    expect(registry.all()).toHaveLength(2)
    expect(() => registry.register(one)).toThrow(/duplicate/)
    await one.start(); await effects[0]!()
    expect((await one.health()).ok).toBe(false)
    expect(registry.get(source)).toBeUndefined()
    await registry.stopAll()
    expect(registry.all()).toHaveLength(0)
  })
  it('fake supports duplicates, out-of-order, normalize and reply failure with idempotency', async () => {
    const emitted: string[] = []
    const fake = new FakeSource(source, event => { emitted.push(event.externalId) })
    await fake.start()
    await fake.emitMany([trigger('2', 20), trigger('1', 10), trigger('1', 10)])
    expect(emitted).toEqual(['2', '1', '1'])
    expect((await fake.readThread(threadKey('one'))).triggers.map(row => row.at)).toEqual([10, 10, 20])
    fake.failNormalizeNext(1)
    await expect(fake.emit(trigger('3', 30))).rejects.toThrow(/normalize/)
    fake.failNext(1)
    await expect(fake.reply('session', threadKey('one'), 'reply', 'key')).rejects.toThrow(/reply/)
    await fake.reply('session', threadKey('one'), 'reply', 'key')
    await fake.reply('session', threadKey('one'), 'reply', 'key')
    expect(fake.replies.size).toBe(1)
  })
  it('only admits direct human user/message from its selected session', async () => {
    let listener: any
    let removed = false
    const events: any[] = []
    const adapter = new SessionSource('main', { on(_name, callback) { listener = callback; return () => { removed = true } }, async reply() {} }, event => { events.push(event) })
    const input = { session: { id: 'main' }, event: { type: 'user/message', time: 12, data: { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } } }
    expect(await adapter.verify(input)).toBe(true)
    const normalized = await adapter.normalize(input)
    expect(normalized).toMatchObject({ source: 'session:main', externalId: 'm1', trust: 'human', addressed: 'direct', threadKey: 'session:main' })
    expect(await adapter.verify({ ...input, event: { ...input.event, data: { ...input.event.data, source: { kind: 'context' } } } })).toBe(false)
    expect(await adapter.verify({ ...input, session: { id: 'other' } })).toBe(false)
    expect(await adapter.verify({ ...input, event: { ...input.event, type: 'tool/result' } })).toBe(false)
    await adapter.start(); listener(input.session, input.event)
    await new Promise(resolve => setImmediate(resolve))
    expect(events).toHaveLength(1)
    await adapter.stop(); expect(removed).toBe(true)
  })
})
