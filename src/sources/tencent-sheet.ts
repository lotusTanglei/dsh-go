import { createHash, randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import type { Store } from '../store/index.js'
import { decodeJson, encodeJson, hasSensitiveContractData } from '../store/codec.js'

export interface TencentSheetConfig { id: string; fileId: string; sheetId: string; range: string; idColumn: string; titleColumn: string; textColumns: string[]; revision: string }
export interface TencentSheetGrant { handle: string; fence: string; scope: 'scope.sheet.readonly'; fileId: string; sheetId: string; range: string; wire: 'documented-v3' | 'example-v3' }
export interface TencentSheetRead { config: TencentSheetConfig; grant: TencentSheetGrant; signal: AbortSignal; check(): void }
export interface TencentSheetPorts { signal: AbortSignal; requireEpoch(epoch: string): void; authorize?(config: TencentSheetConfig, epoch: string): Promise<TencentSheetGrant>; requireGrant?(grant: TencentSheetGrant, config: TencentSheetConfig, epoch: string): void; transport?(input: TencentSheetRead): Promise<Uint8Array> }
interface Auth { epoch: string }
interface CAS extends Auth { id: string; expectedRevision: string }
export interface TencentSheetConfigure extends Auth { id: string; fileId: string; sheetId: string; range: string; idColumn: string; titleColumn: string; textColumns: string[]; expectedRevision: string | null }
export interface TencentSheetScan extends CAS { expectedSnapshot: string | null }
export interface TencentSheetDetail extends CAS { snapshotId: string }
export interface TencentSheetClaim extends TencentSheetDetail { itemId: string; requestId: string; humanReview: 'reviewed-for-draft' }
export interface Item { itemId: string; rowId: string; row: number; title: string; text: string; strike: 'yes' | 'no' | 'unknown'; eligible: false }
export interface Snapshot { snapshotId: string; revision: string; config: TencentSheetConfig; raw: string; items: Item[]; capturedAt: number; remoteRevision: 'unknown'; images: { state: 'unknown'; imageSeen: false }; trust: 'external-untrusted'; authorization: 'not-granted' }
export interface Head { snapshotId: string | null; configRevision: string; state: 'unscanned' | 'partial' | 'blocked'; reason: string; epoch?: string; changes?: { added: string[]; changed: string[]; removed: string[] } }
export interface TencentSheetScanResult extends Head { sourceId: string; revision?: string; remoteRevision: 'unknown'; images: { state: 'unknown'; imageSeen: false }; items: Item[]; authorization: 'not-granted' }
const PREFIX = 'tencent-sheet:v1:', MAX_BYTES = 4 * 1024 * 1024
const INCOMPLETE = 'tencent_sheet_evidence_incomplete'
export const TENCENT_SHEET_SUPPORT = [{ kind: 'tencent-sheet', state: 'partial', reason: 'oauth-original-images-and-remote-revision-not-verified' }, { kind: 'tencent-document', state: 'unsupported' }, { kind: 'wecom-document', state: 'not-this-connector' }, { kind: 'office', state: 'unsupported' }, { kind: 'pdf', state: 'unsupported' }] as const
function fail(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }) }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function obj(value: unknown, keys: readonly string[]): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) fail('tencent_sheet_invalid', 400); return value as Record<string, any> }
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) fail('tencent_sheet_invalid', 400); return value }
function rev(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('tencent_sheet_invalid', 400); return value }
function nullable(value: unknown) { return value === null ? null : rev(value) }
function col(value: unknown): number { if (typeof value !== 'string' || !/^[A-Z]{1,3}$/.test(value)) fail('tencent_sheet_range_invalid', 400); return [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 }
function bounds(value: unknown) { if (typeof value !== 'string') fail('tencent_sheet_range_invalid', 400); const match = /^([A-Z]{1,3})([1-9]\d{0,6}):([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value); if (!match) fail('tencent_sheet_range_invalid', 400); const c = col(match[1]), r = Number(match[2]) - 1, width = col(match[3]) - c + 1, height = Number(match[4]) - r; if (width < 1 || height < 1 || width > 200 || height > 1000 || width * height > 10000) fail('tencent_sheet_range_invalid', 400); return { c, r, width, height } }
function decode(bytes: Uint8Array): string { if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) fail('tencent_sheet_response_limit', 413); try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return fail('tencent_sheet_utf8', 415) } }
function validateGrant(grant: TencentSheetGrant, config: TencentSheetConfig) { obj(grant, ['handle', 'fence', 'scope', 'fileId', 'sheetId', 'range', 'wire']); if (typeof grant.handle !== 'string' || !grant.handle || grant.handle.length > 256 || typeof grant.fence !== 'string' || !grant.fence || grant.scope !== 'scope.sheet.readonly' || grant.fileId !== config.fileId || grant.sheetId !== config.sheetId || grant.range !== config.range || !['documented-v3', 'example-v3'].includes(grant.wire)) fail('tencent_sheet_grant_denied', 403) }

/** Host-only secret resolver; no URL from browser/evidence and no OAuth/profile changes. */
export function createTencentSheetTransport(ports: { credentials(handle: string): Promise<{ clientId: string; openId: string; accessToken: string }>; fetch?: typeof fetch }) {
  return async (input: TencentSheetRead): Promise<Uint8Array> => {
    const { config, grant, signal, check } = input; id(config.fileId); id(config.sheetId); bounds(config.range); validateGrant(grant, config); check()
    try {
      const credentials = await ports.credentials(grant.handle); check()
      for (const value of [credentials.clientId, credentials.openId, credentials.accessToken]) if (typeof value !== 'string' || !value || value.length > 16384 || /[\r\n\x00]/.test(value)) fail('tencent_sheet_credentials_unavailable', 503)
      const url = `https://docs.qq.com/openapi/spreadsheet/v3/files/${config.fileId}/${config.sheetId}/${config.range}`
      const response = await (ports.fetch ?? fetch)(url, { method: 'GET', headers: { Accept: 'application/json', 'Client-Id': credentials.clientId, 'Open-Id': credentials.openId, 'Access-Token': credentials.accessToken }, redirect: 'error', credentials: 'omit', signal }); check()
      if (response.redirected || (response.url && response.url !== url) || !response.ok) fail('tencent_sheet_http_denied', 502)
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('tencent_sheet_media_type', 415)
      const length = response.headers.get('content-length'); if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('tencent_sheet_response_limit', 413)
      const reader = response.body?.getReader(); if (!reader) fail('tencent_sheet_response_missing', 502)
      const chunks: Uint8Array[] = []; let size = 0
      try { while (true) { check(); const chunk = await reader.read(); check(); if (chunk.done) break; size += chunk.value.length; if (size > MAX_BYTES) fail('tencent_sheet_response_limit', 413); chunks.push(chunk.value) } } catch (error) { try { await reader.cancel() } catch { /* preserve stable failure */ } throw error } finally { reader.releaseLock() }
      const bytes = Buffer.concat(chunks); decode(bytes); check(); return bytes
    } catch (error) { if (error instanceof Error && /^tencent_sheet_[a-z_]+$/.test(error.message)) throw error; return fail('tencent_sheet_transport_unavailable', 503) }
  }
}
function parseItems(raw: string, config: TencentSheetConfig, wire: TencentSheetGrant['wire']): Item[] {
  let envelope: Record<string, any>; try { envelope = JSON.parse(raw) } catch { return fail('tencent_sheet_json_invalid', 415) }
  let grid: unknown
  if (wire === 'documented-v3') { obj(envelope, ['code', 'message', 'gridData']); if (!Number.isInteger(envelope.code) || typeof envelope.message !== 'string') fail('tencent_sheet_wire_mismatch', 415); if (envelope.code !== 0) fail('tencent_sheet_remote_error', 502); grid = envelope.gridData }
  else { obj(envelope, ['ret', 'msg', 'data']); if (!Number.isInteger(envelope.ret) || typeof envelope.msg !== 'string') fail('tencent_sheet_wire_mismatch', 415); if (envelope.ret !== 0) fail('tencent_sheet_remote_error', 502); grid = obj(envelope.data, ['gridData']).gridData }
  const data = obj(grid, ['startRow', 'startColumn', 'rows', 'columnMetadata', 'rowMetadata']), range = bounds(config.range)
  if (data.startRow !== range.r || data.startColumn !== range.c || !Array.isArray(data.rows) || data.rows.length !== range.height || ['columnMetadata', 'rowMetadata'].some(key => data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length))) fail('tencent_sheet_range_incomplete', 415)
  const ids = new Set<string>(), selected = [...new Set([config.idColumn, config.titleColumn, ...config.textColumns])]
  return data.rows.map((input: unknown, offset: number) => {
    const row = obj(input, ['values']); if (!Array.isArray(row.values) || row.values.length !== range.width) fail('tencent_sheet_range_incomplete', 415)
    const cells = row.values.map((value: unknown) => {
      const cell = obj(value, ['cellValue', 'cellFormat', 'dataType']); if (cell.dataType !== undefined && cell.dataType !== 'DATA_TYPE_UNSPECIFIED') fail('tencent_sheet_cell_unsupported', 415)
      const content = obj(cell.cellValue, ['text', 'number']); if (Object.keys(content).length !== 1 || (typeof content.text !== 'string' && (typeof content.number !== 'number' || !Number.isFinite(content.number)))) fail('tencent_sheet_cell_unsupported', 415)
      const text = typeof content.text === 'string' ? content.text : String(content.number)
      if (hasSensitiveContractData(text.replace(/\B(?:sk|ghp|github_pat)[_-]/gi, 'key-fragment-')) || /(?:password|api[_-]?key|token|secret|credential)\s*[:=]\s*\S+|\/(?:Users|home)\//i.test(text) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail('tencent_sheet_sensitive', 403)
      let strike: Item['strike'] = 'unknown'
      if (cell.cellFormat !== null && cell.cellFormat !== undefined) { const format = obj(cell.cellFormat, ['textFormat']); if (format.textFormat !== undefined) { const font = obj(format.textFormat, ['font', 'fontSize', 'bold', 'italic', 'strikethrough', 'underline', 'color']); if (font.strikethrough !== undefined) { if (typeof font.strikethrough !== 'boolean') fail('tencent_sheet_format_unknown', 415); strike = font.strikethrough ? 'yes' : 'no' } } }
      return { text, strike, textId: typeof content.text === 'string' }
    })
    const at = (column: string) => cells[col(column) - range.c]!, key = at(config.idColumn)
    if (!key.textId || !key.text || key.text !== key.text.trim() || key.text.length > 256 || ids.has(key.text)) fail('tencent_sheet_row_id_invalid', 415); ids.add(key.text)
    const strikes = selected.map(column => at(column).strike), strike: Item['strike'] = strikes.includes('yes') ? 'yes' : strikes.includes('unknown') ? 'unknown' : 'no'
    return { itemId: hash(['tencent-sheet-item-v1', config.id, config.fileId, config.sheetId, config.idColumn, key.text]), rowId: key.text, row: range.r + offset + 1, title: at(config.titleColumn).text, text: config.textColumns.map(column => `${column}: ${at(column).text}`).join('\n'), strike, eligible: false }
  })
}

/** Isolated manual observations. Missing original-image/version contracts never become execution authority. */
export function createTencentSheets(store: Store, ports: TencentSheetPorts) {
  const get = <T>(key: string) => store.repos.kv.get(PREFIX + key)?.v as T | undefined
  const put = (key: string, value: unknown) => store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(PREFIX + key, encodeJson(value, false))
  const check = (epoch: string) => { if (ports.signal.aborted) fail('tencent_sheet_aborted', 503); ports.requireEpoch(epoch); if (ports.signal.aborted) fail('tencent_sheet_aborted', 503) }
  const auth = (input: unknown, keys: string[]) => { const value = obj(input, keys); check(id(value.epoch)); return value }
  const configFor = (key: string, expected: string) => { const row = get<{ config: TencentSheetConfig; deleted?: true }>('config:' + key); if (!row || row.deleted) fail('tencent_sheet_missing', 404); if (row.config.revision !== expected) fail('tencent_sheet_config_conflict'); return row.config }
  const headFor = (config: TencentSheetConfig) => get<Head>('head:' + config.id)
  const configs = () => store.db.prepare('SELECT v FROM kv WHERE k LIKE ?').all(PREFIX + 'config:%').map(row => decodeJson<{ config: TencentSheetConfig; deleted?: true }>(row.v as string)).filter(row => !row.deleted).map(row => row.config)
  const fingerprint = (snapshot: Omit<Snapshot, 'snapshotId' | 'revision' | 'capturedAt'>) => hash({ raw: snapshot.raw, config: snapshot.config, items: snapshot.items, remoteRevision: snapshot.remoteRevision, images: snapshot.images, trust: snapshot.trust, authorization: snapshot.authorization })
  const snapshotFor = (key: string, snapshotId: string) => { const row = get<Snapshot>('snapshot:' + snapshotId); if (!row || row.config.id !== key || row.snapshotId !== snapshotId || row.revision !== snapshotId || fingerprint(row) !== snapshotId) fail('tencent_sheet_snapshot_missing', 404); return row }
  const scans = new Set<string>()
  return {
    list(input: Auth) { auth(input, ['epoch']); return { sources: configs().map(config => ({ ...config, ...(headFor(config) ?? {}), freshness: 'manual-observation-not-remote-atomic' })), connection: ports.authorize && ports.requireGrant && ports.transport ? 'host-configured' : 'blocked-auth-unavailable', support: structuredClone(TENCENT_SHEET_SUPPORT) } },
    configure(input: TencentSheetConfigure, onCommit?: (result: TencentSheetConfig) => void) {
      const value = auth(input, ['epoch', 'id', 'fileId', 'sheetId', 'range', 'idColumn', 'titleColumn', 'textColumns', 'expectedRevision']), key = id(value.id), expected = nullable(value.expectedRevision), range = bounds(value.range)
      if (!Array.isArray(value.textColumns) || value.textColumns.length < 1 || value.textColumns.length > 200 || new Set(value.textColumns).size !== value.textColumns.length) fail('tencent_sheet_invalid', 400)
      for (const column of [value.idColumn, value.titleColumn, ...value.textColumns]) { const c = col(column); if (c < range.c || c >= range.c + range.width) fail('tencent_sheet_range_invalid', 400) }
      const config: TencentSheetConfig = { id: key, fileId: id(value.fileId), sheetId: id(value.sheetId), range: value.range, idColumn: value.idColumn, titleColumn: value.titleColumn, textColumns: [...value.textColumns], revision: hash(['config', randomUUID()]) }
      return store.transaction(() => { check(value.epoch); const prior = get<{ config: TencentSheetConfig }>('config:' + key); if ((prior?.config.revision ?? null) !== expected) fail('tencent_sheet_config_conflict'); if (!prior && configs().length >= 100) fail('tencent_sheet_source_limit', 413); put('config:' + key, { config }); put('head:' + key, { configRevision: config.revision, snapshotId: null, state: 'unscanned', reason: 'manual-read-required' }); onCommit?.(structuredClone(config)); return config })
    },
    remove(input: CAS, onCommit?: (result: { id: string; removed: true }) => void) { const value = auth(input, ['epoch', 'id', 'expectedRevision']), key = id(value.id); return store.transaction(() => { const config = configFor(key, rev(value.expectedRevision)); put('config:' + key, { config, deleted: true }); const result = { id: key, removed: true as const }; onCommit?.(result); return result }) },
    async scan(input: TencentSheetScan, onCommit?: (result: TencentSheetScanResult) => void): Promise<TencentSheetScanResult> {
      const value = auth(input, ['epoch', 'id', 'expectedRevision', 'expectedSnapshot']), key = id(value.id), expected = rev(value.expectedRevision), expectedSnapshot = nullable(value.expectedSnapshot), config = configFor(key, expected), epoch = value.epoch
      const current = () => { check(epoch); configFor(key, expected); if ((headFor(config)?.snapshotId ?? null) !== expectedSnapshot) fail('tencent_sheet_snapshot_conflict') }
      current(); if (scans.has(key)) fail('tencent_sheet_busy'); scans.add(key)
      let callbackFailed = false
      const commit = (result: TencentSheetScanResult) => { try { onCommit?.(structuredClone(result)) } catch (error) { callbackFailed = true; throw error } }
      try {
        if (!ports.authorize || !ports.requireGrant || !ports.transport) fail('tencent_sheet_auth_unavailable', 503)
        const grant = Object.freeze(structuredClone(await ports.authorize(structuredClone(config), epoch))); current(); validateGrant(grant, config)
        const authorized = () => { current(); ports.requireGrant!(grant, structuredClone(config), epoch) }; authorized()
        const bytes = await ports.transport({ config: structuredClone(config), grant, signal: ports.signal, check: authorized }); authorized()
        const raw = decode(bytes), items = parseItems(raw, config, grant.wire), observation = { config, raw, items, remoteRevision: 'unknown' as const, images: { state: 'unknown' as const, imageSeen: false as const }, trust: 'external-untrusted' as const, authorization: 'not-granted' as const }, snapshotId = fingerprint(observation)
        const snapshot: Snapshot = { ...observation, snapshotId, revision: snapshotId, capturedAt: Date.now() }, prior = expectedSnapshot ? snapshotFor(key, expectedSnapshot) : undefined
        const changes = { added: items.filter(item => !prior?.items.some(old => old.itemId === item.itemId)).map(item => item.itemId), changed: items.filter(item => prior?.items.some(old => old.itemId === item.itemId && hash(old) !== hash(item))).map(item => item.itemId), removed: prior?.items.filter(item => !items.some(next => next.itemId === item.itemId)).map(item => item.itemId) ?? [] }
        return store.transaction(() => { authorized(); if (!get('snapshot:' + snapshotId)) store.db.prepare('INSERT INTO kv(k,v) VALUES (?,?)').run(PREFIX + 'snapshot:' + snapshotId, encodeJson(snapshot, false)); const head: Head = { configRevision: expected, snapshotId, epoch, state: 'partial', reason: INCOMPLETE, changes }; put('head:' + key, head); const result: TencentSheetScanResult = { sourceId: key, ...head, revision: snapshotId, remoteRevision: 'unknown', images: observation.images, items, authorization: 'not-granted' }; commit(result); return result })
      } catch (error) {
        if (callbackFailed) throw error
        const code = error instanceof Error && /^tencent_sheet_[a-z_]+$/.test(error.message) ? error.message : 'tencent_sheet_read_unavailable'
        const blocked: TencentSheetScanResult = { sourceId: key, configRevision: expected, snapshotId: expectedSnapshot, epoch, state: 'blocked', reason: code, items: [], images: { state: 'unknown', imageSeen: false }, remoteRevision: 'unknown', authorization: 'not-granted' }
        try { store.transaction(() => { current(); put('head:' + key, { configRevision: expected, snapshotId: expectedSnapshot, epoch, state: 'blocked', reason: code }); if (code === 'tencent_sheet_auth_unavailable') commit(blocked) }) } catch (lateError) { if (callbackFailed) throw lateError /* otherwise revoked/changed state cannot be overwritten by late data */ }
        if (code === 'tencent_sheet_auth_unavailable') return blocked
        return fail(code, code === 'tencent_sheet_sensitive' ? 403 : 409)
      } finally { scans.delete(key) }
    },
    detail(input: TencentSheetDetail) { const value = auth(input, ['epoch', 'id', 'expectedRevision', 'snapshotId']), config = configFor(id(value.id), rev(value.expectedRevision)), snapshot = snapshotFor(config.id, rev(value.snapshotId)), head = headFor(config); return { ...snapshot, raw: undefined, current: head?.snapshotId === snapshot.snapshotId && head.epoch === value.epoch && head.state === 'partial' && snapshot.config.revision === config.revision, state: 'partial' as const, reason: INCOMPLETE, changes: head?.changes, freshness: 'manual-observation-not-remote-atomic' as const } },
    claim(input: TencentSheetClaim): never { const value = auth(input, ['epoch', 'id', 'expectedRevision', 'snapshotId', 'itemId', 'requestId', 'humanReview']), config = configFor(id(value.id), rev(value.expectedRevision)), snapshot = snapshotFor(config.id, rev(value.snapshotId)); id(value.requestId); if (value.humanReview !== 'reviewed-for-draft') fail('tencent_sheet_human_review_required', 400); if (!snapshot.items.some(item => item.itemId === rev(value.itemId))) fail('tencent_sheet_item_missing', 404); return fail(INCOMPLETE) },
  }
}
