import { createHash } from 'node:crypto'
import { redact } from '../store/codec.js'

export interface ConversationItem {
  id: string
  /** First visible occurrence; never moves when this message is admitted or updated. */
  seq: number
  /** Most recent durable event that changed the visible item. */
  lastSeq: number
  at: number
  kind: 'user' | 'assistant' | 'notice'
  /** Plain text, not HTML or Markdown. Render with a text node, never innerHTML. */
  text: string
  stage?: string
}

export interface ConversationPageOptions {
  epoch: string
  after?: string
  before?: string
  limit?: number
}

export interface ConversationPage {
  items: ConversationItem[]
  nextBefore?: string
  nextAfter: string
  hasMore: boolean
}

export type ConversationErrorCode = 'invalid_input' | 'invalid_cursor' | 'epoch_mismatch'

/** Fixed public errors: neither messages nor causes contain caller input. */
export class ConversationError extends Error {
  constructor(readonly code: ConversationErrorCode) {
    super(code)
    this.name = 'ConversationError'
  }
}

type Stage = 'queued' | 'claimed' | 'admitted' | 'canceled' | 'rejected' | 'unknown'
type Target = 'next-turn' | 'next-step'
interface Row {
  item: ConversationItem
  firstSlot: number
  lastSlot: number
}
interface Position { seq: number; slot: number }
interface Cursor extends Position { mode: 'after' | 'before'; through: number }
interface Turn {
  number: number
  /** Only the batch proposed since the last step/start can be rejected by pre-step. */
  batch: Set<string>
  targets: Set<Target>
  enteredStep: boolean
  certain: boolean
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 30
const END_SLOT = Number.MAX_SAFE_INTEGER
const isRecord = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isSeq = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0)
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function visibleKind(message: any): 'user' | 'notice' | undefined {
  if (!isRecord(message) || !isId(message.id) || message.role !== 'user') return
  if (message.source?.kind === 'user') return 'user'
  if (message.source?.kind === 'superagent-channel' && message.source.form === 'notice') return 'notice'
}

function textContent(message: any): string {
  if (!Array.isArray(message?.content)) return ''
  const text = message.content.filter((block: any) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text).join('\n')
  // Do not parse HTML, Markdown, entities, links, or producer-supplied summaries.
  return redact(text) as string
}

function compare(a: Position, b: Position): number { return a.seq - b.seq || a.slot - b.slot }
function firstPosition(row: Row): Position { return { seq: row.item.seq, slot: row.firstSlot } }
function lastPosition(row: Row): Position { return { seq: row.item.lastSeq, slot: row.lastSlot } }

/** Fold a complete, one-epoch Session log, not the current model-visible surface. */
function fold(events: readonly any[]): { rows: Row[]; watermark: number } {
  const rows = new Map<string, Row>()
  const pending: Record<Target, string[]> = { 'next-turn': [], 'next-step': [] }
  let queuesCertain = true
  let turn: Turn | undefined
  let watermark = -1
  // Sorting a copy leaves frozen/read-only input alone. Duplicated or broken seqs
  // cannot be evidence for a rejection, but never cause guesses about message IDs.
  const ordered = events.filter(event => isRecord(event) && isSeq(event.seq)).slice().sort((a, b) => a.seq - b.seq)
  let previousSeq = -1
  let eventSlot = 0
  const seenSeqs = new Set<number>()

  function stage(id: string, next: Stage, event: any): void {
    const row = rows.get(id)
    if (!row || row.item.stage === 'admitted' || row.item.stage === next) return
    row.item.stage = next
    row.item.lastSeq = event.seq
    row.lastSlot = eventSlot++
  }

  function upsert(message: any, kind: ConversationItem['kind'], next: Stage | undefined, event: any): void {
    const slot = eventSlot++
    const text = textContent(message)
    // Textless assistant events (reasoning, tools) never acquire a visible row.
    if (kind === 'assistant' && text.length === 0) return
    const current = rows.get(message.id)
    if (current) {
      // Conflicting producer identities never turn an existing human row into
      // an assistant/notice (or expose an internal producer's replacement text).
      if (current.item.kind !== kind) return
      const nextStage = current.item.stage === 'admitted' ? 'admitted' : next
      if (text !== current.item.text || nextStage !== current.item.stage) {
        current.item.text = text
        if (nextStage !== undefined) current.item.stage = nextStage
        current.item.lastSeq = event.seq
        current.lastSlot = slot
      }
      return
    }
    rows.set(message.id, {
      item: { id: message.id, seq: event.seq, lastSeq: event.seq, at: typeof event.time === 'number' && Number.isFinite(event.time) && event.time >= 0 ? event.time : 0, kind, text, ...(next === undefined ? {} : { stage: next }) },
      firstSlot: slot,
      lastSlot: slot,
    })
  }

  function uncertain(event: any): void {
    queuesCertain = false
    if (turn) turn.certain = false
    for (const row of rows.values()) {
      if (row.item.stage === 'queued') stage(row.item.id, 'unknown', event)
    }
    pending['next-turn'] = []
    pending['next-step'] = []
  }

  for (const event of ordered) {
    watermark = Math.max(watermark, event.seq)
    if (seenSeqs.has(event.seq)) { uncertain(event); continue }
    eventSlot = 0
    seenSeqs.add(event.seq)
    if (event.seq !== previousSeq + 1) uncertain(event)
    previousSeq = event.seq
    const data = event.data

    if (event.type === 'turn/start') {
      turn = isSeq(data?.turn) ? { number: data.turn, batch: new Set(), targets: new Set(), enteredStep: false, certain: queuesCertain } : undefined
      continue
    }
    if (event.type === 'step/start') {
      if (turn && data?.turn === turn.number && isSeq(data?.step)) {
        turn.batch.clear()
        turn.targets.clear()
        turn.enteredStep = true
      } else if (turn) turn.certain = false
      continue
    }
    if (event.type === 'turn/end') {
      if (turn && data?.turn === turn.number && data?.reason?.kind === 'blocked' && turn.certain) {
        for (const id of turn.batch) {
          if (rows.get(id)?.item.stage === 'claimed') stage(id, 'rejected', event)
        }
      }
      // A mismatched end cannot lend its blocked reason to another turn's claim.
      turn = undefined
      continue
    }
    if (event.type === 'agent/inbox/spliced') {
      if (!isRecord(data) || !['next-turn', 'next-step'].includes(data.target) || !Array.isArray(data.inserted)) {
        uncertain(event)
        continue
      }
      const target = data.target as Target
      const queue = pending[target]
      const count = data.removedCount ?? 0
      const validMessages = data.inserted.every((message: any) => isRecord(message) && isId(message.id))
      const validRange = isSeq(data.start) && isSeq(count) && data.start <= queue.length && count <= queue.length - data.start
      if (!validMessages || !validRange || !queuesCertain) {
        uncertain(event)
        // Persisted visible insertions remain evidence of receipt, even when
        // an incomplete/corrupt prefix prevents reconstructing their location.
        data.inserted.forEach((message: any) => {
          const kind = visibleKind(message)
          if (kind) upsert(message, kind, 'unknown', event)
        })
        continue
      }
      const removed = queue.slice(data.start, data.start + count)
      const candidate = [...queue.slice(0, data.start), ...data.inserted.map((message: any) => message.id), ...queue.slice(data.start + count)]
      const all = target === 'next-turn' ? [...candidate, ...pending['next-step']] : [...pending['next-turn'], ...candidate]
      if (new Set(all).size !== all.length) { uncertain(event); continue }
      pending[target] = candidate
      if (count > 0 && data.outcome !== undefined && data.outcome !== 'canceled' && turn) turn.certain = false
      // A normal driver claim removes the complete next-step batch or exactly
      // the first next-turn message. Other removals are still claimed, but are
      // insufficient evidence to infer a later pre-step rejection.
      const claimShape = data.start === 0 && data.inserted.length === 0 && (target === 'next-step' ? count === queue.length : count === 1)
      if (count > 0 && data.outcome === undefined && turn) {
        const wrongTurnClaim = target === 'next-turn' && (turn.enteredStep || pending['next-step'].length > 0)
        const wrongClaimOrder = target === 'next-step' && turn.targets.has('next-turn')
        if (!claimShape || turn.targets.has(target) || wrongTurnClaim || wrongClaimOrder) turn.certain = false
        turn.targets.add(target)
      }
      removed.forEach(id => {
        const next = data.outcome === 'canceled' ? 'canceled' : data.outcome === undefined ? 'claimed' : 'unknown'
        stage(id, next, event)
        if (next === 'claimed' && turn && claimShape) turn.batch.add(id)
        else turn?.batch.delete(id)
      })
      data.inserted.forEach((message: any) => {
        const kind = visibleKind(message)
        if (kind) upsert(message, kind, 'queued', event)
        // Replacement/requeue is not a still-unadmitted pre-step claim.
        turn?.batch.delete(message.id)
      })
      continue
    }
    if (event.type === 'user/message') {
      const kind = visibleKind(data)
      if (kind) upsert(data, kind, 'admitted', event)
      if (isId(data?.id)) turn?.batch.delete(data.id)
      continue
    }
    if (event.type === 'assistant/message') {
      const message = data?.message
      if (isRecord(message) && isId(message.id) && message.role === 'assistant' && message.source?.kind === 'model') {
        upsert(message, 'assistant', undefined, event)
      }
    }
  }
  return { rows: [...rows.values()].sort((a, b) => compare(firstPosition(a), firstPosition(b))), watermark }
}

/** Visible human input, model text, and explicit superagent notices only. */
export function foldConversation(events: readonly any[]): ConversationItem[] {
  return fold(events).rows.map(row => row.item)
}

function epochKey(epoch: string): string {
  return createHash('sha256').update(epoch).digest('base64url')
}

function encodeCursor(epoch: string, mode: Cursor['mode'], position: Position, through: number): string {
  return Buffer.from(JSON.stringify([1, epochKey(epoch), mode, position.seq, position.slot, through]), 'utf8').toString('base64url')
}

function decodeCursor(value: unknown, epoch: string, mode: Cursor['mode'], watermark: number): Cursor {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ConversationError('invalid_cursor')
  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error()
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch { throw new ConversationError('invalid_cursor') }
  if (!Array.isArray(decoded) || decoded.length !== 6 || decoded[0] !== 1 || typeof decoded[1] !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(decoded[1]) || decoded[2] !== mode
    || !Number.isSafeInteger(decoded[3]) || decoded[3] < -1 || Object.is(decoded[3], -0) || !isSeq(decoded[4]) || (decoded[3] === -1 && decoded[4] !== END_SLOT) || (mode === 'before' && (decoded[3] < 0 || decoded[4] === END_SLOT))
    || !Number.isSafeInteger(decoded[5]) || decoded[5] < -1 || Object.is(decoded[5], -0) || decoded[5] < decoded[3]) {
    throw new ConversationError('invalid_cursor')
  }
  if (decoded[1] !== epochKey(epoch)) throw new ConversationError('epoch_mismatch')
  if (decoded[5] > watermark) throw new ConversationError('invalid_cursor')
  return { mode, seq: decoded[3], slot: decoded[4], through: decoded[5] }
}

/**
 * Initial/before: newest bounded window in first-seq ascending display order.
 * After: bounded updates in (lastSeq, event slot) order; merge by stable item id.
 * A completed delta read advances over the whole log, including invisible events.
 * Cursors are opaque positions, not authorization: the Host must bind epoch/log.
 */
export function conversationPage(events: readonly any[], options: ConversationPageOptions): ConversationPage {
  if (!isRecord(options) || typeof options.epoch !== 'string' || options.epoch.length === 0 || options.epoch.length > 4096
    || (options.after !== undefined && options.before !== undefined)
    || (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_LIMIT))) {
    throw new ConversationError('invalid_input')
  }
  const limit = options.limit ?? DEFAULT_LIMIT
  const { rows, watermark } = fold(events)
  const tail: Position = { seq: watermark, slot: END_SLOT }
  if (options.after !== undefined) {
    const after = decodeCursor(options.after, options.epoch, 'after', watermark)
    const updates = rows.filter(row => compare(lastPosition(row), after) > 0).sort((a, b) => compare(lastPosition(a), lastPosition(b)))
    const selected = updates.slice(0, limit)
    const hasMore = updates.length > selected.length
    const next = hasMore ? lastPosition(selected[selected.length - 1]!) : tail
    return { items: selected.map(row => row.item), nextAfter: encodeCursor(options.epoch, 'after', next, watermark), hasMore }
  }
  const before = options.before === undefined ? undefined : decodeCursor(options.before, options.epoch, 'before', watermark)
  const history = before === undefined ? rows : rows.filter(row => compare(firstPosition(row), before) < 0)
  const selected = history.slice(-limit)
  const hasMore = history.length > selected.length
  const first = selected[0]
  // A history request did not deliver updates to the already-loaded recent
  // window. Preserve its original delta baseline instead of skipping them.
  const through = before?.through ?? watermark
  return {
    items: selected.map(row => row.item),
    ...(hasMore && first ? { nextBefore: encodeCursor(options.epoch, 'before', firstPosition(first), through) } : {}),
    nextAfter: encodeCursor(options.epoch, 'after', { seq: through, slot: END_SLOT }, through),
    hasMore,
  }
}
