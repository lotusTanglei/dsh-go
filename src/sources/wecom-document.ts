import { createHash } from 'node:crypto'
import { parseWecomDocumentRange, validateWecomDocumentConfig, wecomDocumentId, type WecomDocumentConfig } from '../config.js'
import { snapshot as immutable } from '../domain/immutable.js'
import { sourceId, threadKey, type ThreadKey } from '../domain/ids.js'
import { createTrigger, type Trigger } from '../domain/trigger.js'
import type { Channel, Source, ThreadContext, TriggerSink } from './types.js'

export type { WecomDocumentConfig } from '../config.js'
export type WecomDocumentStrike = 'yes' | 'no' | 'unknown'
export interface WecomDocumentRun { readonly text: string; readonly strike: WecomDocumentStrike; readonly style?: unknown }
export interface WecomDocumentCell {
  readonly column: string; readonly address: string; readonly text: string; readonly strike: WecomDocumentStrike
  readonly runs?: readonly WecomDocumentRun[]; readonly style?: unknown; readonly formula?: string
}
export interface WecomDocumentImage { readonly address: string; readonly mimeType: string; readonly data: string; readonly sha256: string }
export interface WecomDocumentRow {
  readonly row: number; readonly cells: readonly WecomDocumentCell[]; readonly images: readonly WecomDocumentImage[]; readonly imagesComplete: boolean
}
export interface WecomDocumentSnapshot {
  readonly schemaVersion: 1; readonly documentId: string; readonly sheetId: string; readonly sheetName: string; readonly range: string
  readonly rows: readonly WecomDocumentRow[]; readonly complete: boolean
  readonly capabilities?: unknown; readonly warnings?: readonly string[]; readonly docTitle?: string
}
export interface WecomDocumentIssue { readonly code: string; readonly message: string; readonly row?: number; readonly column?: string }
export interface WecomDocumentEvidence {
  readonly documentId: string; readonly doc: string; readonly sheetId: string; readonly sheetName: string; readonly range: string; readonly row: WecomDocumentRow
  readonly capabilities?: unknown; readonly warnings?: readonly string[]; readonly docTitle?: string
}
export interface WecomDocumentItem {
  /** Missing business IDs are retained as blocked evidence, never assigned a row-derived identity. */
  readonly itemKey: string | null; readonly revision: string; readonly configVersion: string; readonly title: string; readonly text: string
  readonly eligible: boolean; readonly reviewable: boolean; readonly warnings: readonly string[]; readonly evidence: WecomDocumentEvidence
}
export interface WecomDocumentExtraction { readonly items: readonly WecomDocumentItem[]; readonly issues: readonly WecomDocumentIssue[]; readonly complete: boolean }
export interface WecomDocumentPorts {
  read(): Promise<WecomDocumentSnapshot>
  persist?(items: readonly WecomDocumentItem[]): Promise<void>
  /** Optional workspace session-channel adapter, never a document writer. */
  reply?: Channel['reply']
  onError?(error: unknown): void
}

const limits = Object.freeze({ rows: 500, cells: 50_000, text: 32_768, totalText: 2_000_000, runs: 50_000, images: 100, imageBytes: 8_388_608, totalImageBytes: 16_777_216, history: 1_000 })
const fail = (message: string): never => { throw new Error(`wecom-document: ${message}`) }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const columnNumber = (value: string): number => [...value].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0)
export const canonicalDocumentId = wecomDocumentId
function normalizedConfig(config: WecomDocumentConfig): WecomDocumentConfig {
  validateWecomDocumentConfig(config)
  return immutable({
    id: config.id, kind: config.kind, attended: config.attended, doc: config.doc, sheet: config.sheet, range: config.range,
    idColumn: config.idColumn, titleColumn: config.titleColumn, textColumns: [...config.textColumns],
    ...(config.filter ? { filter: { column: config.filter.column, values: [...config.filter.values] } } : {}),
    ...(config.firstDataRow !== undefined ? { firstDataRow: config.firstDataRow } : {}),
  })
}
/** Every supplied configuration field participates, independent of object insertion order. */
export function configVersionOf(config: WecomDocumentConfig): string { return hash(normalizedConfig(config)) }
const record = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(`${label} must be a plain object`)
  if (Object.keys(value).some(key => !fields.includes(key))) return fail(`${label} contains unsupported fields`)
  return value as Record<string, unknown>
}
const string = (value: unknown, max: number, label: string): string => {
  if (typeof value !== 'string' || value.length > max) return fail(`invalid ${label}`)
  return value
}
const strike = (value: unknown): value is WecomDocumentStrike => value === 'yes' || value === 'no' || value === 'unknown'

/** Bounded optional metadata is evidence only, not authority or a reason to infer strike=no. */
function metadata(value: unknown): void {
  let nodes = 0, chars = 0
  const visit = (input: unknown, depth: number): void => {
    if (++nodes > 2_048 || depth > 8) fail('metadata exceeds bounds')
    if (typeof input === 'string') { chars += input.length; if (chars > 32_768) fail('metadata exceeds bounds'); return }
    if (input === null || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return
    if (!input || typeof input !== 'object') return fail('metadata must be JSON')
    if (Array.isArray(input)) { if (input.length > 512) fail('metadata exceeds bounds'); for (const entry of input) visit(entry, depth + 1); return }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('metadata must be JSON')
    for (const [key, entry] of Object.entries(input)) { chars += key.length; visit(entry, depth + 1) }
  }
  visit(value, 0)
}

function validPng(bytes: Buffer): boolean {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false
  let offset = 8, first = true, hasData = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) return false
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type) || (first && (type !== 'IHDR' || length !== 13))) return false
    let crc = 0xffffffff
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) return false
    if (type === 'IHDR' && (!first || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0)) return false
    if (type === 'IDAT') hasData = true
    offset += 12 + length
    if (type === 'IEND') return length === 0 && hasData && offset === bytes.length
    first = false
  }
  return false
}

function imageBytes(image: Record<string, unknown>): Buffer {
  const mime = string(image.mimeType, 32, 'image MIME')
  const data = string(image.data, Math.ceil(limits.imageBytes / 3) * 4, 'original image base64')
  if (!data || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return fail('invalid original image base64')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > limits.imageBytes || bytes.toString('base64') !== data) return fail('invalid original image base64')
  const png = validPng(bytes)
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
  const gif = bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  const webp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
  if (!((mime === 'image/png' && png) || (mime === 'image/jpeg' && jpeg) || (mime === 'image/gif' && gif) || (mime === 'image/webp' && webp))) return fail('image MIME does not match original raster bytes')
  if (typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256) || createHash('sha256').update(bytes).digest('hex') !== image.sha256) return fail('image SHA-256 mismatch')
  return bytes
}

/** Pure manual source: no timer, tool lookup, network request, document write, or implicit read. */
export class WecomDocumentSource implements Source {
  readonly kind = 'wecom-document' as const
  readonly attended = false
  readonly id
  readonly config: WecomDocumentConfig
  readonly configVersion: string
  private readonly documentId: string
  private readonly bounds
  private active = false
  private stopping?: Promise<void>
  private scanFlight?: Promise<WecomDocumentExtraction>
  private readonly replies = new Set<Promise<void>>()
  private readonly history = new Map<string, Trigger>()
  private lastAt?: number
  private error?: string

  constructor(config: WecomDocumentConfig, private readonly ports: WecomDocumentPorts, private readonly sink: TriggerSink) {
    this.config = normalizedConfig(config)
    this.id = sourceId(config.id)
    this.documentId = wecomDocumentId(config.doc)
    this.bounds = parseWecomDocumentRange(config.range)
    this.configVersion = hash(this.config)
  }

  private validate(input: unknown): asserts input is WecomDocumentSnapshot {
    const doc = record(input, ['schemaVersion', 'documentId', 'sheetId', 'sheetName', 'range', 'rows', 'complete', 'capabilities', 'warnings', 'docTitle'], 'snapshot')
    if (doc.schemaVersion !== 1 || doc.documentId !== this.documentId || doc.sheetId !== this.config.sheet || doc.range !== this.config.range || typeof doc.complete !== 'boolean') fail('snapshot schema/document/sheet/range mismatch')
    if (!string(doc.sheetName, 512, 'sheet name')) fail('sheet name required')
    if (doc.docTitle !== undefined) string(doc.docTitle, 512, 'document title')
    if (doc.capabilities !== undefined) metadata(doc.capabilities)
    if (doc.warnings !== undefined && (!Array.isArray(doc.warnings) || doc.warnings.length > 100 || !doc.warnings.every(value => typeof value === 'string' && value.length <= 2_048))) fail('invalid snapshot warnings')
    if (!Array.isArray(doc.rows) || doc.rows.length > limits.rows) fail('snapshot rows exceed bounds')
    const rowNumbers = new Set<number>()
    let totalCells = 0, totalText = 0, totalRuns = 0, totalImages = 0, totalImageBytes = 0
    const addText = (value: unknown, label: string) => {
      totalText += string(value, limits.text, label).length
      if (totalText > limits.totalText) fail('snapshot text exceeds bounds')
    }
    for (const inputRow of doc.rows as unknown[]) {
      const row = record(inputRow, ['row', 'cells', 'images', 'imagesComplete'], 'row')
      if (!Number.isSafeInteger(row.row) || Number(row.row) < this.bounds.r0 || Number(row.row) > this.bounds.r1 || rowNumbers.has(Number(row.row))) fail('duplicate or out-of-range row')
      rowNumbers.add(Number(row.row))
      if (!Array.isArray(row.cells) || row.cells.length > 100 || !Array.isArray(row.images) || row.images.length > 20 || typeof row.imagesComplete !== 'boolean') fail('row cells/images/completeness required within bounds')
      const validAddress = (value: unknown, column?: unknown): string => {
        const address = string(value, 16, 'cell/image address')
        const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address)
        if (!match || Number(match[2]) !== row.row || columnNumber(match[1]!) < this.bounds.c0 || columnNumber(match[1]!) > this.bounds.c1 || (column !== undefined && match[1] !== column)) return fail('cell/image address does not match configured row/column')
        return address
      }
      const cells = new Set<string>(), images = new Set<string>()
      for (const inputCell of row.cells as unknown[]) {
        if (++totalCells > limits.cells) fail('snapshot cells exceed bounds')
        const cell = record(inputCell, ['column', 'address', 'text', 'strike', 'runs', 'style', 'formula'], 'cell')
        if (typeof cell.column !== 'string' || !/^[A-Z]{1,3}$/.test(cell.column)) fail('invalid cell column')
        const address = validAddress(cell.address, cell.column)
        if (cells.has(address)) fail('duplicate cell address')
        cells.add(address)
        addText(cell.text, 'cell text')
        if (!strike(cell.strike)) fail('explicit cell strike state required')
        if (cell.formula !== undefined) addText(cell.formula, 'formula')
        if (cell.style !== undefined) { metadata(cell.style); addText(JSON.stringify(cell.style), 'cell style') }
        if (cell.runs !== undefined) {
          if (!Array.isArray(cell.runs) || cell.runs.length > 1_000) fail('cell runs exceed bounds')
          let rendered = ''
          for (const inputRun of cell.runs as unknown[]) {
            if (++totalRuns > limits.runs) fail('snapshot runs exceed bounds')
            const run = record(inputRun, ['text', 'strike', 'style'], 'run')
            addText(run.text, 'run text'); rendered += run.text
            if (!strike(run.strike)) fail('explicit run strike state required')
            if (run.style !== undefined) { metadata(run.style); addText(JSON.stringify(run.style), 'run style') }
          }
          if (rendered !== cell.text) fail('rich text runs must reproduce cell text')
        }
      }
      for (const inputImage of row.images as unknown[]) {
        if (++totalImages > limits.images) fail('snapshot images exceed bounds')
        const image = record(inputImage, ['address', 'mimeType', 'data', 'sha256'], 'image')
        const address = validAddress(image.address)
        if (images.has(address)) fail('duplicate image address')
        images.add(address)
        totalImageBytes += imageBytes(image).length
        if (totalImageBytes > limits.totalImageBytes) fail('snapshot image bytes exceed bounds')
      }
    }
  }

  /** Validation is deliberately not authentication, provenance verification, or trust elevation. */
  async verify(input: unknown): Promise<boolean> { try { this.validate(input); return true } catch { return false } }

  extract(input: unknown): WecomDocumentExtraction {
    this.validate(input)
    const doc = immutable(input)
    const issues: WecomDocumentIssue[] = []
    const items: WecomDocumentItem[] = []
    const ids = new Map<string, number>()
    const first = this.config.firstDataRow ?? this.bounds.r0
    for (const row of doc.rows) {
      if (row.row < first) continue
      const id = row.cells.find(cell => cell.column === this.config.idColumn)?.text
      if (id?.trim()) ids.set(id, (ids.get(id) ?? 0) + 1)
    }
    if (!doc.complete) issues.push({ code: 'snapshot-incomplete', message: 'Snapshot is incomplete; all matched rows are blocked' })
    for (const row of doc.rows) {
      if (row.row < first) continue
      const cells = new Map(row.cells.map(cell => [cell.column, cell]))
      const filter = this.config.filter
      const filterCell = filter ? cells.get(filter.column) : undefined
      // A missing filter cell is unknown, not the valid empty string or a proven non-match.
      if (filter && !filterCell) { issues.push({ code: 'filter-unknown', message: 'Missing filter cell; match cannot be determined', row: row.row, column: filter.column }); continue }
      if (filter && !filter.values.includes(filterCell!.text)) continue
      const warnings: string[] = [], blockers: string[] = []
      const warn = (code: string, message: string, column?: string, blocker = code) => {
        blockers.push(blocker); warnings.push(message); issues.push({ code, message, row: row.row, ...(column ? { column } : {}) })
      }
      const relevant = new Set([this.config.idColumn, this.config.titleColumn, ...this.config.textColumns, ...(filter ? [filter.column] : [])])
      for (const column of relevant) {
        const cell = cells.get(column)
        if (!cell) warn('cell-unknown', `Column ${column} is missing (strike/text unknown)`, column)
        else if (cell.strike !== 'no' || cell.runs?.some(run => run.strike !== 'no')) {
          const knownStrike = cell.strike === 'yes' || cell.runs?.some(run => run.strike === 'yes')
          warn('strike-blocked', `Column ${column} has struck or unknown strike state`, column, knownStrike ? 'strike-yes' : 'strike-unknown')
        }
      }
      const businessId = cells.get(this.config.idColumn)?.text ?? ''
      const title = cells.get(this.config.titleColumn)?.text ?? ''
      if (!businessId.trim()) warn('missing-id', 'Stable business ID is missing', this.config.idColumn)
      else if ((ids.get(businessId) ?? 0) > 1) warn('duplicate-id', 'Stable business ID is duplicated in the snapshot', this.config.idColumn)
      if (!title.trim()) warn('missing-title', 'Title is missing', this.config.titleColumn)
      if (!doc.complete) { blockers.push('snapshot-incomplete'); warnings.push('Snapshot is incomplete') }
      if (!row.imagesComplete) warn('images-incomplete', 'Original image capture is incomplete')
      const text = [title, ...this.config.textColumns.filter(column => column !== this.config.titleColumn).map(column => cells.get(column)?.text ?? '')].join('\n')
      const semanticCells = [...relevant].sort().map(column => {
        const cell = cells.get(column)
        return cell ? [column, cell.text, cell.strike, cell.runs?.map(run => [run.text, run.strike]) ?? null, cell.formula ?? null] : [column, null, 'unknown']
      })
      items.push({
        itemKey: businessId.trim() ? hash([this.id, this.documentId, businessId]) : null,
        revision: hash([this.configVersion, semanticCells, row.images.map(image => [image.mimeType, image.sha256]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]),
        configVersion: this.configVersion, title, text, eligible: warnings.length === 0,
        reviewable: blockers.length > 0 && blockers.every(code => code === 'strike-unknown'), warnings,
        evidence: {
          documentId: doc.documentId, doc: this.config.doc, sheetId: doc.sheetId, sheetName: doc.sheetName, range: doc.range, row,
          ...(doc.capabilities !== undefined ? { capabilities: doc.capabilities } : {}), ...(doc.warnings !== undefined ? { warnings: doc.warnings } : {}), ...(doc.docTitle !== undefined ? { docTitle: doc.docTitle } : {}),
        },
      })
    }
    return immutable({ items, issues, complete: doc.complete })
  }

  /**
   * Host-only construction after an owner explicitly checks the original document.
   * The coordinator must bind that receipt to this exact persisted evidence hash;
   * reviewable is a technical gate, never proof of authorization or inferred strike=no.
   */
  reviewedTrigger(item: WecomDocumentItem): Trigger {
    if (item?.reviewable !== true || item.eligible !== false) return fail('item is not available for explicit review')
    if (item.configVersion !== this.configVersion) return fail('reviewed item configuration mismatch')
    const evidence = item.evidence
    if (!evidence || evidence.doc !== this.config.doc) return fail('reviewed document evidence mismatch')
    const [recomputed] = this.extract({
      schemaVersion: 1, documentId: evidence.documentId, sheetId: evidence.sheetId, sheetName: evidence.sheetName, range: evidence.range,
      rows: [evidence.row], complete: true,
      ...(evidence.capabilities !== undefined ? { capabilities: evidence.capabilities } : {}),
      ...(evidence.warnings !== undefined ? { warnings: evidence.warnings } : {}), ...(evidence.docTitle !== undefined ? { docTitle: evidence.docTitle } : {}),
    }).items
    // Preserve batch blockers: a duplicate or partial row cannot become reviewable by
    // reconstructing a singleton. Never trust caller-supplied text or derived hashes.
    if (!recomputed?.reviewable || recomputed.itemKey !== item.itemKey || recomputed.revision !== item.revision || recomputed.title !== item.title || recomputed.text !== item.text || JSON.stringify(recomputed.warnings) !== JSON.stringify(item.warnings)) return fail('reviewed item does not match revalidated evidence')
    return this.trigger(recomputed, true)
  }

  private trigger(item: WecomDocumentItem, reviewed = false): Trigger {
    if ((!item.eligible && !(reviewed && item.reviewable)) || !item.itemKey) return fail('blocked items cannot become triggers')
    return createTrigger({
      source: this.id, externalId: `${item.itemKey}:${item.revision}`, threadKey: threadKey(`wecom-document:${item.itemKey}`),
      actor: { id: 'wecom-document', source: this.id, bot: true }, text: item.text, at: Date.now(), trust: 'system', addressed: 'none',
      raw: { kind: 'wecom-document', itemKey: item.itemKey, revision: item.revision, configVersion: item.configVersion, ...(reviewed ? { reviewed: true } : {}) },
    })
  }

  async normalize(input: unknown): Promise<Trigger[]> { return this.extract(input).items.filter(item => item.eligible).map(item => this.trigger(item)) }
  async start(): Promise<void> { if (this.stopping) fail('stop is still draining'); this.active = true }
  scan(): Promise<WecomDocumentExtraction> {
    if (this.scanFlight) return this.scanFlight
    if (!this.active || this.stopping) return Promise.reject(new Error('wecom-document: source is not active'))
    const work = Promise.resolve().then(async () => {
      const result = this.extract(await this.ports.read())
      // Persist every matched item (including blocked evidence) before emitting any trigger.
      await this.ports.persist?.(result.items)
      for (const item of result.items) {
        if (!this.active) break
        if (!item.eligible) continue
        const trigger = this.trigger(item)
        await this.sink(trigger)
        this.history.set(trigger.externalId, trigger)
        if (this.history.size > limits.history) this.history.delete(this.history.keys().next().value!)
      }
      this.lastAt = Date.now(); this.error = undefined
      return result
    }).catch(error => { this.error = 'Document scan failed'; this.report(error); throw error })
    this.scanFlight = work
    void work.then(() => { if (this.scanFlight === work) this.scanFlight = undefined }, () => { if (this.scanFlight === work) this.scanFlight = undefined })
    return work
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.active = false
    const work = Promise.allSettled([...(this.scanFlight ? [this.scanFlight] : []), ...this.replies]).then(() => {})
    this.stopping = work
    void work.then(() => { if (this.stopping === work) this.stopping = undefined })
    return work
  }
  async health() { return { ok: this.active && !this.error, lastAt: this.lastAt, detail: this.error ?? (this.active ? undefined : 'Source is inactive') } }
  async readThread(key: ThreadKey): Promise<ThreadContext> {
    if (!/^wecom-document:[a-f0-9]{64}$/.test(key) || ![...this.history.values()].some(trigger => trigger.threadKey === key)) fail('foreign or unknown document thread')
    return { threadKey: key, triggers: [...this.history.values()].filter(trigger => trigger.threadKey === key) }
  }
  reply(channel: Parameters<Channel['reply']>[0], key: ThreadKey, body: string, idemKey: string): Promise<void> {
    if (!this.active || this.stopping || channel !== 'session' || !this.ports.reply || ![...this.history.values()].some(trigger => trigger.threadKey === key)) return Promise.reject(new Error('wecom-document: document writeback is unavailable; workspace session channel required'))
    const work = Promise.resolve().then(() => this.ports.reply!(channel, key, body, idemKey)).catch(error => { this.error = 'Workspace reply failed'; this.report(error); throw error })
    this.replies.add(work)
    void work.then(() => this.replies.delete(work), () => this.replies.delete(work))
    return work
  }
  private report(error: unknown): void { try { this.ports.onError?.(error) } catch { /* Diagnostic callbacks cannot break draining or hide the original failure. */ } }
}
