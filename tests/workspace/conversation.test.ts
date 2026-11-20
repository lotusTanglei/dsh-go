import { describe, expect, it } from 'vitest'
import { ConversationError, conversationPage, foldConversation } from '../../src/workspace/conversation.js'

// Synthetic Session events only. No Host, model, filesystem, profile, or service.
const epoch = 'fixture-workspace-epoch-1'
const text = (value: string) => ({ type: 'text', text: value })
const user = (id: string, value = id, source: any = { kind: 'user' }) => ({ id, role: 'user', source, content: [text(value)] })
const notice = (id: string, value = id) => user(id, value, { kind: 'superagent-channel', form: 'notice', summary: 'Unused summary' })
const assistant = (id: string, value = id) => ({ id, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [text(value)] })
const event = (seq: number, type: string, data: any) => ({ seq, type, time: 1000 + seq, data })
const splice = (seq: number, target: 'next-turn' | 'next-step', start: number, inserted: any[] = [], removedCount?: number, outcome?: string) => event(seq, 'agent/inbox/spliced', { target, start, inserted, ...(removedCount === undefined ? {} : { removedCount }), ...(outcome === undefined ? {} : { outcome }) })
const ids = (items: { id: string }[]) => items.map(item => item.id)
const stages = (events: readonly any[]) => Object.fromEntries(foldConversation(events).map(item => [item.id, item.stage]))
function errorCode(action: () => unknown, code: string, privateInput?: string) {
  let caught: unknown
  try { action() } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(ConversationError)
  expect(caught).toBeInstanceOf(Error)
  expect(caught).toMatchObject({ code, message: code, name: 'ConversationError' })
  expect((caught as Error & { cause?: unknown }).cause).toBeUndefined()
  if (privateInput) expect(String(caught) + JSON.stringify(caught)).not.toContain(privateInput)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

describe('pure Conversation fold', () => {
  it('merges queued → claimed → admitted by message id and keeps first seq/time', () => {
    const human = user('human', 'Original input')
    const events = [splice(0, 'next-turn', 0, [human]), event(1, 'turn/start', { turn: 1 }), splice(2, 'next-turn', 0, [], 1), event(3, 'step/start', { turn: 1, step: 1 }), event(4, 'user/message', user('human', 'Admitted input'))]
    expect(foldConversation(events.slice(0, 1))).toEqual([{ id: 'human', seq: 0, lastSeq: 0, at: 1000, kind: 'user', text: 'Original input', stage: 'queued' }])
    expect(foldConversation(events.slice(0, 3))).toEqual([{ id: 'human', seq: 0, lastSeq: 2, at: 1000, kind: 'user', text: 'Original input', stage: 'claimed' }])
    expect(foldConversation(events)).toEqual([{ id: 'human', seq: 0, lastSeq: 4, at: 1000, kind: 'user', text: 'Admitted input', stage: 'admitted' }])
  })

  it('reconstructs both queues including invisible messages and non-tail insertion positions', () => {
    const events = [
      splice(0, 'next-turn', 0, [user('a'), user('b')]),
      splice(1, 'next-turn', 1, [user('internal', 'Private report', { kind: 'superagent' })]),
      splice(2, 'next-turn', 0, [user('c')]),
      splice(3, 'next-step', 0, [user('s1'), user('hidden-step', 'Hidden', { kind: 'runtime-context' }), user('s2')]),
      splice(4, 'next-turn', 2, [], 1), // Removes internal, NOT b or the last visible item.
      splice(5, 'next-step', 2, [], 1), // Removes s2, NOT all next-step messages.
      splice(6, 'next-turn', 1, [], 1), // Removes a, NOT b or c.
    ]
    expect(stages(events)).toEqual({ a: 'claimed', b: 'queued', c: 'queued', s1: 'queued', s2: 'claimed' })
    expect(ids(foldConversation(events))).toEqual(['a', 'b', 'c', 's1', 's2'])
  })

  it('treats only explicit canceled removal as cancellation, including replacement', () => {
    const events = [
      splice(0, 'next-turn', 0, [user('old'), user('keep')]),
      splice(1, 'next-turn', 0, [user('replacement')], 1, 'canceled'),
      splice(2, 'next-turn', 1, [], 1),
    ]
    expect(stages(events)).toEqual({ old: 'canceled', keep: 'claimed', replacement: 'queued' })
    expect(foldConversation(events).find(item => item.id === 'old')).toMatchObject({ seq: 0, lastSeq: 1 })
    expect(stages([...events, event(3, 'turn/end', { turn: 99, reason: { kind: 'aborted', reason: { kind: 'user' } } })])).toEqual(stages(events))
  })

  it('rejects only a matching blocked turn’s unentered claim batch, not queued input', () => {
    const events = [
      splice(0, 'next-turn', 0, [user('claimed-turn'), user('still-queued')]),
      splice(1, 'next-step', 0, [user('claimed-step')]),
      event(2, 'turn/start', { turn: 4 }),
      splice(3, 'next-step', 0, [], 1),
      splice(4, 'next-turn', 0, [], 1),
      event(5, 'turn/end', { turn: 4, reason: { kind: 'blocked' } }),
    ]
    expect(stages(events)).toEqual({ 'claimed-turn': 'rejected', 'still-queued': 'queued', 'claimed-step': 'rejected' })
    expect(foldConversation(events).filter(item => item.stage === 'rejected').map(item => item.lastSeq)).toEqual([5, 5])
    expect(stages([...events, event(6, 'user/message', user('claimed-turn'))])['claimed-turn']).toBe('admitted')
  })

  it.each(['completed', 'aborted', 'error', 'interrupted', 'forked'])('does not infer canceled/rejected from turn end %s', kind => {
    const events = [splice(0, 'next-turn', 0, [user('a')]), event(1, 'turn/start', { turn: 1 }), splice(2, 'next-turn', 0, [], 1), event(3, 'turn/end', { turn: 1, reason: { kind } })]
    expect(stages(events)).toEqual({ a: 'claimed' })
  })

  it('requires a matching turn and an actual unentered claim rather than a global blocked flag', () => {
    const base = [splice(0, 'next-turn', 0, [user('a')])]
    expect(stages([...base, splice(1, 'next-turn', 0, [], 1), event(2, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })])).toEqual({ a: 'claimed' })
    const claimed = [...base, event(1, 'turn/start', { turn: 1 }), splice(2, 'next-turn', 0, [], 1)]
    expect(stages([...claimed, event(3, 'turn/end', { turn: 2, reason: { kind: 'blocked' } })])).toEqual({ a: 'claimed' })
    expect(stages([...claimed, event(3, 'step/start', { turn: 1, step: 1 }), event(4, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })])).toEqual({ a: 'claimed' })
    expect(stages([...claimed, event(3, 'step/start', { turn: 1, step: 1 }), event(4, 'user/message', user('a')), event(5, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })])).toEqual({ a: 'admitted' })
  })

  it('does not reject a prior entered step’s claims when a later pre-step is blocked', () => {
    const events = [
      splice(0, 'next-turn', 0, [user('rewritten-away')]), event(1, 'turn/start', { turn: 1 }),
      splice(2, 'next-turn', 0, [], 1), event(3, 'step/start', { turn: 1, step: 1 }),
      event(4, 'step/end', { turn: 1, step: 1 }), splice(5, 'next-step', 0, [user('later')]),
      splice(6, 'next-step', 0, [], 1), event(7, 'turn/end', { turn: 1, reason: { kind: 'blocked' } }),
    ]
    expect(stages(events)).toEqual({ 'rewritten-away': 'claimed', later: 'rejected' })
  })

  it('does not call arbitrary or repeated queue deletions a proven rejected driver batch', () => {
    const nonHead = [splice(0, 'next-turn', 0, [user('a'), user('b')]), event(1, 'turn/start', { turn: 1 }), splice(2, 'next-turn', 1, [], 1), event(3, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })]
    expect(stages(nonHead)).toEqual({ a: 'queued', b: 'claimed' })
    const repeated = [splice(0, 'next-turn', 0, [user('a'), user('b')]), event(1, 'turn/start', { turn: 1 }), splice(2, 'next-turn', 0, [], 1), splice(3, 'next-turn', 0, [], 1), event(4, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })]
    expect(stages(repeated)).toEqual({ a: 'claimed', b: 'claimed' })
  })

  it('keeps incomplete/invalid positional evidence unknown and never guesses a removed id', () => {
    expect(stages([splice(8, 'next-turn', 0, [user('partial')]), splice(9, 'next-turn', 0, [], 1), event(10, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })])).toEqual({ partial: 'unknown' })
    const broken = [splice(0, 'next-turn', 0, [user('a'), user('b')]), event(1, 'turn/start', { turn: 1 }), splice(2, 'next-turn', 20, [], 1), event(3, 'turn/end', { turn: 1, reason: { kind: 'blocked' } })]
    expect(stages(broken)).toEqual({ a: 'unknown', b: 'unknown' })
    expect(stages([...broken, event(4, 'user/message', user('a'))])).toEqual({ a: 'admitted', b: 'unknown' })
    expect(stages([splice(0, 'next-turn', 0, [user('a')]), splice(2, 'next-turn', 0, [], 1)])).toEqual({ a: 'unknown' })
  })

  it('hides internal/unknown producers, reasoning, tools, stream attempts, and malformed payloads', () => {
    const events = [
      ...['superagent', 'worker-report', 'runtime-context', 'unknown', 'tool', 'system-prompt'].map((kind, seq) => event(seq, 'user/message', user(kind, `PRIVATE:${kind}`, { kind }))),
      event(6, 'user/message', { id: 'missing-source', role: 'user', content: [text('PRIVATE:source')] }),
      event(7, 'assistant/message', { message: { ...assistant('answer'), content: [{ type: 'reasoning', text: 'PRIVATE:reasoning' }, text('Visible answer'), { type: 'tool-call', name: 'PRIVATE:tool', arguments: 'PRIVATE:arguments' }] }, stream: ['PRIVATE:stream'] }),
      event(8, 'assistant/message', { message: { ...assistant('reasoning-only'), content: [{ type: 'reasoning', text: 'PRIVATE:reasoning-only' }] } }),
      event(9, 'assistant/attempt', { stream: [text('PRIVATE:attempt')] }),
      event(10, 'tool/result', { message: { content: [text('PRIVATE:result')] } }),
      event(11, 'system/message', { message: { content: [text('PRIVATE:system')] } }),
      event(12, 'developer/message', { message: { content: [text('PRIVATE:developer')] } }),
      event(13, 'assistant/message', { message: { ...assistant('fake'), source: { kind: 'superagent' } } }),
      event(14, 'user/message', user('human', 'Visible user')),
      splice(15, 'next-step', 0, [notice('notification', 'Visible notice'), user('non-notice-channel', 'PRIVATE:not-notice', { kind: 'superagent-channel', form: 'snapshot' })]),
      event(16, 'user/message', notice('notification', 'Visible notice')),
      event(17, 'user/message', { id: 'bad-content', role: 'user', source: { kind: 'user' }, content: { text: 'PRIVATE:wrong-shape' } }),
    ]
    const result = foldConversation(events)
    expect(ids(result)).toEqual(['answer', 'human', 'notification', 'bad-content'])
    expect(result[0]).toMatchObject({ kind: 'assistant', text: 'Visible answer' })
    expect(result[0]).not.toHaveProperty('stage')
    expect(result[2]).toMatchObject({ kind: 'notice', seq: 15, lastSeq: 16, stage: 'admitted', text: 'Visible notice' })
    expect(result[3]?.text).toBe('')
    expect(JSON.stringify(result)).not.toContain('PRIVATE:')
  })

  it('redacts secrets, private URLs, and spaced paths while retaining inert plain-text HTML', () => {
    const secret = 'sk' + '-CONVERSATIONfixture123'
    const bearer = 'Bearer ' + 'CONVERSATIONfixture123'
    const path = '/Users/Fixture Person/private workspace/secret.txt'
    const home = '/home/fixture/private.txt'
    const win = String.raw`C:\Users\Fixture Person\private.txt`
    const url = 'https://' + 'private.internal/example'
    const html = '<img src=x onerror="globalThis.__fixture=true"><script>alert(1)</script> **plain** &lt;b&gt;'
    const body = [secret, bearer, `"${path}"`, `"${home}"`, `"${win}"`, url, html].join('\n')
    const result = foldConversation([event(0, 'user/message', user('safe-user', body)), event(1, 'assistant/message', { message: assistant('safe-assistant', body) }), splice(2, 'next-step', 0, [notice('safe-notice', body)])])
    expect(result).toHaveLength(3)
    for (const item of result) {
      for (const sensitive of [secret, bearer, path, home, win, url]) expect(item.text).not.toContain(sensitive)
      expect(item.text).toContain('[REDACTED_SECRET]')
      expect(item.text).toContain('[REDACTED_PATH]')
      expect(item.text).toContain('[REDACTED_URL]')
      expect(item.text).toContain(html) // String data, not a parsed/rendered HTML fragment.
      for (const field of ['html', 'raw', 'source', 'content']) expect(item).not.toHaveProperty(field)
    }
  })

  it('does not mutate frozen input or retain caller-owned references', () => {
    const events = deepFreeze([event(1, 'user/message', user('b')), event(0, 'user/message', user('a'))])
    const snapshot = JSON.stringify(events)
    const first = foldConversation(events)
    expect(ids(first)).toEqual(['a', 'b'])
    first[0]!.text = 'Caller changed output'
    expect(foldConversation(events)[0]?.text).toBe('a')
    expect(JSON.stringify(events)).toBe(snapshot)
  })
})

describe('Conversation pagination', () => {
  const history = Array.from({ length: 7 }, (_, seq) => event(seq, 'user/message', user(`m${seq}`)))

  it('returns newest limit ascending, then bounded older pages without overlap', () => {
    const recent = conversationPage(history, { epoch, limit: 3 })
    expect(ids(recent.items)).toEqual(['m4', 'm5', 'm6'])
    expect(recent.hasMore).toBe(true)
    expect(recent.nextBefore).toEqual(expect.any(String))
    const older = conversationPage(history, { epoch, before: recent.nextBefore!, limit: 3 })
    expect(ids(older.items)).toEqual(['m1', 'm2', 'm3'])
    expect(older.hasMore).toBe(true)
    const oldest = conversationPage(history, { epoch, before: older.nextBefore!, limit: 3 })
    expect(ids(oldest.items)).toEqual(['m0'])
    expect(oldest.hasMore).toBe(false)
    expect(oldest.nextBefore).toBeUndefined()
    expect(oldest.nextAfter).toBe(recent.nextAfter)
    expect(conversationPage(history, { epoch, after: recent.nextAfter }).items).toEqual([])
  })

  it('uses default30 and enforces integer limit1–100 rather than coercing/clamping', () => {
    const many = Array.from({ length: 120 }, (_, seq) => event(seq, 'user/message', user(`m${seq}`)))
    expect(conversationPage(many, { epoch }).items).toHaveLength(30)
    expect(conversationPage(many, { epoch, limit: 100 }).items).toHaveLength(100)
    expect(conversationPage(many, { epoch, limit: 1 }).items[0]?.id).toBe('m119')
    for (const limit of [0, -1, 101, 1.5, NaN, Infinity, '2', null, true]) errorCode(() => conversationPage(history, { epoch, limit } as any), 'invalid_input')
  })

  it('catches an old message update after a recent-only initial page using lastSeq, not first seq', () => {
    const initial = [splice(0, 'next-turn', 0, [user('old')]), ...Array.from({ length: 5 }, (_, i) => event(i + 1, 'assistant/message', { message: assistant(`a${i}`) }))]
    const recent = conversationPage(initial, { epoch, limit: 2 })
    expect(ids(recent.items)).toEqual(['a3', 'a4'])
    const changed = [...initial, event(6, 'turn/start', { turn: 1 }), splice(7, 'next-turn', 0, [], 1), event(8, 'step/start', { turn: 1, step: 1 }), event(9, 'user/message', user('old', 'Now admitted')), event(10, 'assistant/message', { message: assistant('latest') })]
    const updates = conversationPage(changed, { epoch, after: recent.nextAfter, limit: 1 })
    expect(updates.items).toEqual([{ id: 'old', seq: 0, lastSeq: 9, at: 1000, kind: 'user', text: 'Now admitted', stage: 'admitted' }])
    expect(updates.hasMore).toBe(true)
    const rest = conversationPage(changed, { epoch, after: updates.nextAfter, limit: 1 })
    expect(ids(rest.items)).toEqual(['latest'])
    expect(rest.hasMore).toBe(false)
    expect(conversationPage(changed, { epoch, after: rest.nextAfter }).items).toEqual([])
    // Loading older items after an update remains based on the original position.
    const older = conversationPage(changed, { epoch, before: recent.nextBefore!, limit: 100 })
    expect(ids(older.items)).toEqual(['old', 'a0', 'a1', 'a2'])
    expect(older.items[0]?.stage).toBe('admitted')
    expect(older.nextAfter).toBe(recent.nextAfter)
    expect(ids(conversationPage(changed, { epoch, after: older.nextAfter }).items)).toEqual(['old', 'latest'])
  })

  it('supports a limit splitting many inserted/removed items at the same seq', () => {
    const initial = conversationPage([], { epoch })
    const queued = [splice(0, 'next-turn', 0, [user('a'), user('b'), user('c')])]
    const recent = conversationPage(queued, { epoch, limit: 1 })
    expect(ids(recent.items)).toEqual(['c'])
    const middle = conversationPage(queued, { epoch, before: recent.nextBefore!, limit: 1 })
    expect(ids(middle.items)).toEqual(['b'])
    expect(ids(conversationPage(queued, { epoch, before: middle.nextBefore!, limit: 1 }).items)).toEqual(['a'])
    let cursor = initial.nextAfter
    const inserted: string[] = []
    for (let index = 0; index < 3; index++) {
      const page = conversationPage(queued, { epoch, after: cursor, limit: 1 })
      inserted.push(...ids(page.items)); cursor = page.nextAfter
      expect(page.hasMore).toBe(index < 2)
    }
    expect(inserted).toEqual(['a', 'b', 'c'])
    const canceled = [...queued, splice(1, 'next-turn', 0, [], 3, 'canceled')]
    const updated: string[] = []
    for (let index = 0; index < 3; index++) {
      const page = conversationPage(canceled, { epoch, after: cursor, limit: 1 })
      updated.push(...ids(page.items)); cursor = page.nextAfter
      expect(page.items[0]?.stage).toBe('canceled')
    }
    expect(updated).toEqual(['a', 'b', 'c'])
    expect(conversationPage(canceled, { epoch, after: cursor }).items).toEqual([])
  })

  it('advances nextAfter on invisible-only events, even for an empty conversation', () => {
    const initial = conversationPage([], { epoch })
    const internal = [event(0, 'user/message', user('hidden', 'INTERNAL', { kind: 'superagent' })), event(1, 'assistant/attempt', { stream: [text('INTERNAL')] })]
    const next = conversationPage(internal, { epoch, after: initial.nextAfter })
    expect(next.items).toEqual([])
    expect(next.hasMore).toBe(false)
    expect(next.nextAfter).not.toBe(initial.nextAfter)
    expect(conversationPage(internal, { epoch, after: next.nextAfter }).nextAfter).toBe(next.nextAfter)
    const appended = conversationPage([...internal, event(2, 'user/message', user('visible'))], { epoch, after: next.nextAfter })
    expect(ids(appended.items)).toEqual(['visible'])
    const later = [...internal, event(2, 'tool/call', { arguments: 'INTERNAL' })]
    expect(conversationPage(later, { epoch }).nextAfter).toBe(conversationPage(later, { epoch, after: next.nextAfter }).nextAfter)
  })

  it('does not advance beyond a limited update batch and tolerates append/update between pages', () => {
    const empty = conversationPage([], { epoch })
    const first = conversationPage(history, { epoch, after: empty.nextAfter, limit: 2 })
    expect(ids(first.items)).toEqual(['m0', 'm1'])
    const concurrent = [...history, event(7, 'user/message', user('m0', 'Updated again')), event(8, 'user/message', user('m7'))]
    const second = conversationPage(concurrent, { epoch, after: first.nextAfter, limit: 100 })
    expect(ids(second.items)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm0', 'm7'])
    expect(second.items.find(item => item.id === 'm0')).toMatchObject({ seq: 0, lastSeq: 7, text: 'Updated again' })
    expect(conversationPage(concurrent, { epoch, after: second.nextAfter }).items).toEqual([])
  })

  it('keeps the real latest assistant reply discoverable when notices fill the bounded history window', () => {
    const events = [event(0, 'assistant/message', { message: assistant('reply', 'Which scope should I use?') }), ...Array.from({ length: 45 }, (_, i) => event(i + 1, 'user/message', notice(`notice-${i}`)))]
    const page = conversationPage(events, { epoch, limit: 5 })
    expect(page.items.every(row => row.kind === 'notice')).toBe(true)
    expect(page.latestAssistant).toMatchObject({ id: 'reply', kind: 'assistant', text: 'Which scope should I use?', lastSeq: 0 })
    const delta = conversationPage([...events, event(46, 'tool/call', { text: 'not a reply' })], { epoch, after: page.nextAfter })
    expect(delta.items).toEqual([])
    expect(delta.latestAssistant).toEqual(page.latestAssistant)
    expect(conversationPage(events, { epoch, before: page.nextBefore!, limit: 5 }).latestAssistant).toEqual(page.latestAssistant)
  })

  it('never upgrades internal/producer summaries to replies, and redacts the independently surfaced reply', () => {
    const events = [event(0, 'assistant/message', { message: assistant('real', 'Inspect /Users/private-owner/secret.txt') }), event(1, 'user/message', notice('notice', 'Approve now')), event(2, 'assistant/message', { message: { ...assistant('internal', 'hidden'), source: { kind: 'superagent' } } }), event(3, 'assistant/message', { message: assistant('real', 'Corrected question') })]
    const page = conversationPage(events, { epoch, limit: 1 })
    expect(page.latestAssistant).toMatchObject({ id: 'real', text: 'Corrected question', lastSeq: 3 })
    const earlier = conversationPage(events.slice(0, 3), { epoch, limit: 1 })
    expect(earlier.latestAssistant?.id).toBe('real')
    expect(earlier.latestAssistant?.text).not.toContain('/Users/private-owner')
    expect(conversationPage([event(0, 'user/message', notice('notice'))], { epoch }).latestAssistant).toBeUndefined()
  })

  it('rejects cross-epoch, direction-confused, future/truncated, and malformed cursors with fixed errors', () => {
    const current = conversationPage(history, { epoch, limit: 1 })
    errorCode(() => conversationPage(history, { epoch: 'foreign-private-epoch', after: current.nextAfter }), 'epoch_mismatch', 'foreign-private-epoch')
    errorCode(() => conversationPage(history, { epoch, after: current.nextBefore! }), 'invalid_cursor')
    errorCode(() => conversationPage(history, { epoch, before: current.nextAfter }), 'invalid_cursor')
    errorCode(() => conversationPage(history.slice(0, 3), { epoch, after: current.nextAfter }), 'invalid_cursor')
    // Even a partial update cursor records the full snapshot watermark.
    const empty = conversationPage([], { epoch })
    const partial = conversationPage(history, { epoch, after: empty.nextAfter, limit: 1 })
    errorCode(() => conversationPage(history.slice(0, 3), { epoch, after: partial.nextAfter }), 'invalid_cursor')
    for (const cursor of ['', 'PRIVATE:/Users/fixture/secret', 'a'.repeat(513), '%%%not-base64', 'e30', Buffer.from('null').toString('base64url'), current.nextAfter + '=']) {
      errorCode(() => conversationPage(history, { epoch, after: cursor }), 'invalid_cursor', cursor || undefined)
    }
    errorCode(() => conversationPage(history, { epoch, after: 42 } as any), 'invalid_cursor')
    errorCode(() => conversationPage(history, { epoch, after: current.nextAfter, before: current.nextBefore! }), 'invalid_input')
    errorCode(() => conversationPage(history, { epoch: '' }), 'invalid_input')
    expect(current.nextAfter).not.toContain(epoch)
  })
})
