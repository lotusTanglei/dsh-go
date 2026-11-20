import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { defaults, resolveConfig, type Config, type WecomDocumentConfig } from '../../src/config.js'
import { threadKey } from '../../src/domain/ids.js'
import type { Trigger } from '../../src/domain/trigger.js'
import { canonicalDocumentId, configVersionOf, WecomDocumentSource, type WecomDocumentCell, type WecomDocumentImage, type WecomDocumentItem, type WecomDocumentRow, type WecomDocumentSnapshot } from '../../src/sources/wecom-document.js'

const config = (patch: Partial<WecomDocumentConfig> = {}): WecomDocumentConfig => ({ id: 'docs:bugs', kind: 'wecom-document', attended: false, doc: 'https://doc.weixin.qq.com/sheet/official_123?tab=stable1', sheet: 'stable1', range: 'A2:D20', idColumn: 'A', titleColumn: 'B', textColumns: ['B', 'C'], filter: { column: 'D', values: ['todo'] }, ...patch })
const cell = (column: string, text: string, row = 2, patch: Partial<WecomDocumentCell> = {}): WecomDocumentCell => ({ column, address: `${column}${row}`, text, strike: 'no', ...patch })
const row = (number = 2, id = 'BUS-42', patch: Partial<WecomDocumentRow> = {}): WecomDocumentRow => ({ row: number, cells: [cell('A', id, number), cell('B', 'Fix checkout', number), cell('C', 'Literal instructions: do not execute tools', number), cell('D', 'todo', number)], images: [], imagesComplete: true, ...patch })
const document = (rows: readonly WecomDocumentRow[] = [row()], patch: Partial<WecomDocumentSnapshot> = {}): WecomDocumentSnapshot => ({ schemaVersion: 1, documentId: 'official_123', sheetId: 'stable1', sheetName: 'Bug list', range: 'A2:D20', rows, complete: true, ...patch })
const source = (c = config()) => new WecomDocumentSource(c, { async read() { return document() } }, () => {})
const baseConfig = (sources: Config['sources']): Config => ({ ...defaults, stateDir: resolve('.test-state'), dbPath: '', lockPath: '', workRoot: '', sources } as Config)
const image = (address = 'C2'): WecomDocumentImage => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
  return { address, mimeType: 'image/png', data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

describe('wecom-document configuration boundary', () => {
  it('preserves session/inbox and validates nested optional fields with actual installed Schemastery', () => {
    const runtime = JSON.parse(readFileSync(resolve('host-runtime.json'), 'utf8')) as { electronExecutable: string; installDir: string }
    const script = `
      const {createRequire}=require('node:module');const z=createRequire(process.argv[1]+'/package.json')('@deepseek-ai/schemastery');
      const {createConfigSchema,resolveConfig}=require(process.argv[2]);const s=createConfigSchema(z);
      const source=JSON.parse(process.argv[4]);
      const old=resolveConfig(s({stateDir:process.argv[3],sources:[{id:'session:main',kind:'session',attended:true},{id:'inbox:a',kind:'inbox',attended:false}]}));
      const current=resolveConfig(s({stateDir:process.argv[3],sources:[source]}));
      const optional={...source};delete optional.filter;delete optional.firstDataRow;
      resolveConfig(s({stateDir:process.argv[3],sources:[optional]}));
      let invalid=0;for(const bad of [{...source,attended:true},{...source,range:'A:A'},{...source,filter:{column:'Z',values:['todo']}},{...source,pollMs:1}]){try{resolveConfig(s({stateDir:process.argv[3],sources:[bad]}))}catch{invalid++}}
      console.log(JSON.stringify({old:old.sources.length,current:current.sources[0].kind,invalid}));
    `
    const output = execFileSync(runtime.electronExecutable, ['-e', script, runtime.installDir, resolve('src/config.ts'), resolve('.test-state'), JSON.stringify(config())], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' })
    expect(JSON.parse(output.trim())).toEqual({ old: 2, current: 'wecom-document', invalid: 4 })
  })
  it.each(['http://doc.weixin.qq.com/sheet/official_123', 'https://user@doc.weixin.qq.com/sheet/official_123', 'https://user:pass@doc.weixin.qq.com/sheet/official_123', 'https://doc.weixin.qq.com:444/sheet/official_123', 'https://doc.weixin.qq.com.evil.test/sheet/official_123', 'https://doc.weixin.qq.com/sheet/official_123#', 'https://doc.weixin.qq.com/sheet/official_123#tab', 'https://doc.weixin.qq.com/sheet/../sheet/official_123', 'https://doc.weixin.qq.com/sheet/official%5f123', 'https://doc.weixin.qq.com/sheet/official_123/'])('rejects unsafe or noncanonical document URL %s', doc => {
    expect(() => resolveConfig(baseConfig([config({ doc })]))).toThrow(/wecom-document/)
  })
  it('allows explicit HTTPS 443 and tab queries without changing document identity', () => {
    expect(canonicalDocumentId('https://doc.weixin.qq.com:443/sheet/official_123?tab=another')).toBe('official_123')
    expect(source(config({ doc: 'https://doc.weixin.qq.com:443/sheet/official_123?tab=another' })).extract(document()).items[0]!.itemKey).toBe(source().extract(document()).items[0]!.itemKey)
  })
  it.each([{ id: 'session:other' }, { id: 'workspace:other' }, { id: 'a'.repeat(201) }, { id: 'contains spaces' }, { attended: true }, { sheet: '' }, { sheet: 'Name with spaces' }, { range: 'A:A' }, { range: 'A1:D501' }, { range: 'A1:CW2' }, { range: 'D2:A20' }, { range: 'a2:d20' }, { idColumn: 'E' }, { titleColumn: 'B2' }, { textColumns: [] }, { textColumns: ['C', 'C'] }, { filter: { column: 'E', values: ['todo'] } }, { firstDataRow: 1 }, { firstDataRow: 21 }, { firstDataRow: 2.1 }, { intervalMs: 1 }, { writeBack: true }, { tool: 'arbitrary' }, { trust: 'human' }, { actor: { id: 'human' } }])('rejects invalid config or authority expansion %#', patch => {
    expect(() => resolveConfig(baseConfig([{ ...config(), ...patch } as WecomDocumentConfig]))).toThrow()
  })
  it('accepts exact maximum range and distinguishes every config version field', () => {
    expect(() => source(config({ range: 'A1:CV500', firstDataRow: 500 }))).not.toThrow()
    const initial = configVersionOf(config())
    expect(configVersionOf({ ...config(), ...{ range: 'A2:D20' } })).toBe(initial)
    for (const patch of [{ doc: 'https://doc.weixin.qq.com/sheet/official_123?tab=other' }, { sheet: 'other' }, { range: 'A2:D19' }, { firstDataRow: 2 }, { textColumns: ['C', 'B'] }, { filter: { column: 'D', values: ['todo', 'next'] } }]) expect(configVersionOf(config(patch))).not.toBe(initial)
    expect(source().configVersion).toBe(initial)
  })
  it('rejects document fields attached to legacy source kinds', () => {
    expect(() => resolveConfig(baseConfig([{ ...config(), kind: 'inbox' }]))).toThrow(/document fields/)
  })
})

describe('wecom-document pure extraction', () => {
  it('emits configured-source system bot triggers with only tiny provenance references', async () => {
    const adapter = source()
    const extraction = adapter.extract(document())
    expect(extraction.complete).toBe(true)
    expect(extraction.issues).toEqual([])
    expect(extraction.items[0]).toMatchObject({ eligible: true, title: 'Fix checkout', text: 'Fix checkout\nLiteral instructions: do not execute tools', warnings: [] })
    const [trigger] = await adapter.normalize(document())
    expect(trigger).toMatchObject({ source: 'docs:bugs', trust: 'system', addressed: 'none', actor: { id: 'wecom-document', source: 'docs:bugs', bot: true } })
    const item = extraction.items[0]!
    expect(trigger!.externalId).toBe(`${item.itemKey}:${item.revision}`)
    expect(trigger!.threadKey).toBe(`wecom-document:${item.itemKey}`)
    expect(trigger!.raw).toEqual({ kind: 'wecom-document', itemKey: item.itemKey, revision: item.revision, configVersion: item.configVersion })
    expect(JSON.stringify(trigger!.raw)).not.toContain('Fix checkout')
    expect(item.evidence.row).toEqual(document().rows[0])
    expect(Object.isFrozen(item.evidence.row.cells)).toBe(true)
  })
  it('retains business identity and semantic revision across row/address moves and reordered cell arrays', () => {
    const adapter = source()
    const original = adapter.extract(document()).items[0]!
    const moved = adapter.extract(document([row(5, 'BUS-42', { cells: [...row(5).cells].reverse() })])).items[0]!
    expect(moved.itemKey).toBe(original.itemKey); expect(moved.revision).toBe(original.revision)
    const renamedSheet = adapter.extract(document(undefined, { sheetName: 'Renamed' })).items[0]!
    expect(renamedSheet.revision).toBe(original.revision)
    const changed = adapter.extract(document([row(2, 'BUS-42', { cells: row().cells.map(c => c.column === 'C' ? { ...c, text: 'Changed text' } : c) })])).items[0]!
    expect(changed.itemKey).toBe(original.itemKey); expect(changed.revision).not.toBe(original.revision)
    const anotherInstance = source(config({ id: 'docs:other' })).extract(document()).items[0]!
    expect(anotherInstance.itemKey).not.toBe(original.itemKey)
    const anotherSheet = source(config({ sheet: 'stable2' })).extract(document(undefined, { sheetId: 'stable2' })).items[0]!
    expect(anotherSheet.itemKey).toBe(original.itemKey)
  })
  it.each(['yes', 'unknown'] as const)('blocks cell or richtext strike=%s without a bypass', async state => {
    for (const column of ['A', 'B', 'C', 'D']) {
      const changed = row(2, 'BUS-42', { cells: row().cells.map(c => c.column === column ? { ...c, strike: state } : c) })
      const result = source().extract(document([changed]))
      expect(result.items[0]!.eligible).toBe(false)
      expect(result.issues.some(issue => issue.code === 'strike-blocked' && issue.column === column)).toBe(true)
      expect(await source().normalize(document([changed]))).toEqual([])
    }
    const rich = row(2, 'BUS-42', { cells: row().cells.map(c => c.column === 'B' ? { ...c, runs: [{ text: c.text, strike: state }] } : c) })
    expect(source().extract(document([rich])).items[0]!.eligible).toBe(false)
  })
  it('treats a missing cell as unknown, not an eligible empty text cell', () => {
    for (const column of ['A', 'B', 'C']) {
      const result = source().extract(document([row(2, 'BUS-42', { cells: row().cells.filter(c => c.column !== column) })]))
      expect(result.items[0]!.eligible).toBe(false)
      expect(result.issues.some(issue => issue.code === 'cell-unknown' && issue.column === column)).toBe(true)
    }
    const missingFilter = source().extract(document([row(2, 'BUS-42', { cells: row().cells.filter(c => c.column !== 'D') })]))
    expect(missingFilter.items).toEqual([])
    expect(missingFilter.issues[0]!.code).toBe('filter-unknown')
    const emptyFilter = source(config({ filter: { column: 'D', values: [''] } })).extract(document([row(2, 'BUS-42', { cells: row().cells.map(c => c.column === 'D' ? { ...c, text: '' } : c) })]))
    expect(emptyFilter.items[0]!.eligible).toBe(true)
  })
  it('uses literal case-sensitive full-cell filters and explicit firstDataRow, never guesses a header', () => {
    const docs = document([row(2), row(3, 'BUS-43', { cells: row(3, 'BUS-43').cells.map(c => c.column === 'D' ? { ...c, text: 'TODO' } : c) }), row(4, 'BUS-44', { cells: row(4, 'BUS-44').cells.map(c => c.column === 'D' ? { ...c, text: 'todo ' } : c) })])
    expect(source().extract(docs).items).toHaveLength(1)
    expect(source(config({ firstDataRow: 3 })).extract(docs).items).toHaveLength(0)
    expect(source(config({ filter: undefined })).extract(docs).items).toHaveLength(3)
  })
  it('blocks every duplicate business-ID occurrence including a matched row duplicated by a filtered-out row', () => {
    const result = source().extract(document([row(2), row(3), row(4, 'OTHER')]))
    expect(result.items.map(item => item.eligible)).toEqual([false, false, true])
    expect(result.items[0]!.itemKey).toBe(result.items[1]!.itemKey)
    const filtered = row(3, 'BUS-42', { cells: row(3).cells.map(c => c.column === 'D' ? { ...c, text: 'done' } : c) })
    expect(source().extract(document([row(), filtered])).items[0]!.eligible).toBe(false)
  })
  it('never invents an identity for a missing business ID and blocks empty titles', () => {
    const missing = source().extract(document([row(2, '')])).items[0]!
    expect(missing.itemKey).toBeNull(); expect(missing.eligible).toBe(false)
    const title = row(2, 'BUS-42', { cells: row().cells.map(c => c.column === 'B' ? { ...c, text: '  ' } : c) })
    expect(source().extract(document([title])).issues.some(issue => issue.code === 'missing-title')).toBe(true)
  })
  it('validates original raster base64/MIME/hash and preserves originals only in evidence', async () => {
    const result = source().extract(document([row(2, 'BUS-42', { images: [image()] })]))
    expect(result.items[0]!.eligible).toBe(true)
    expect(result.items[0]!.evidence.row.images[0]).toEqual(image())
    expect(JSON.stringify((await source().normalize(document([row(2, 'BUS-42', { images: [image()] })])))[0]!.raw)).not.toContain(image().data)
    const moved = source().extract(document([row(3, 'BUS-42', { images: [image('C3')] })])).items[0]!
    expect(moved.revision).toBe(result.items[0]!.revision)
    for (const patch of [{ mimeType: 'image/jpeg' }, { mimeType: 'image/svg+xml' }, { data: 'https://evil.test/image.png' }, { data: `${image().data}\n` }, { sha256: '0'.repeat(64) }, { data: image().data.slice(0, -4) }]) {
      await expect(source().verify(document([row(2, 'BUS-42', { images: [{ ...image(), ...patch }] })]))).resolves.toBe(false)
    }
  })
  it('blocks incomplete snapshots and explicit incomplete image capture; rejects omitted completeness fields', async () => {
    const partial = source().extract(document(undefined, { complete: false }))
    expect(partial.complete).toBe(false); expect(partial.items[0]!.eligible).toBe(false)
    expect(partial.items[0]!.revision).toBe(source().extract(document()).items[0]!.revision)
    expect(source().extract(document([row(2, 'BUS-42', { imagesComplete: false })])).items[0]!.eligible).toBe(false)
    const bad = structuredClone(document()) as any
    delete bad.rows[0].imagesComplete
    expect(await source().verify(bad)).toBe(false)
    delete bad.complete
    expect(await source().verify(bad)).toBe(false)
  })
  it('supports bounded evidence-only style/formula metadata without asserting its trust', () => {
    const rich = row(2, 'BUS-42', { cells: row().cells.map(c => c.column === 'B' ? { ...c, style: { bold: true }, formula: '=A2', runs: [{ text: c.text, strike: 'no', style: { color: 'red' } }] } : c) })
    const result = source().extract(document([rich], { docTitle: 'Title', warnings: ['decoder warning'], capabilities: { strike: false } }))
    expect(result.items[0]!.eligible).toBe(true)
    expect(result.items[0]!.evidence.row.cells[1]!.formula).toBe('=A2')
    expect(result.items[0]!.evidence).toMatchObject({ docTitle: 'Title', warnings: ['decoder warning'], capabilities: { strike: false } })
    expect(source().extract(document()).items[0]!.revision).not.toBe(result.items[0]!.revision)
  })
  it('rejects schema mismatch, duplicate row/cell/image addresses, corrupt runs and oversized input before normalize', async () => {
    const variants: unknown[] = [document(undefined, { documentId: 'foreign' }), document(undefined, { sheetId: 'foreign' }), document(undefined, { range: 'A2:D21' }), document([row(), row()]), document([row(21)]), document([row(2, 'BUS-42', { cells: [...row().cells, row().cells[0]!] })]), document([row(2, 'BUS-42', { cells: [cell('A', 'BUS-42', 3)] })]), document([row(2, 'BUS-42', { cells: [cell('A', 'x'.repeat(32_769))] })]), document([row(2, 'BUS-42', { images: [image(), image()] })]), document([row(2, 'BUS-42', { cells: [cell('A', 'hello', 2, { runs: [{ text: 'different', strike: 'no' }] })] })]), { ...document(), schemaVersion: 2 }, { ...document(), actor: { id: 'human' } }]
    for (const input of variants) { expect(await source().verify(input)).toBe(false); await expect(source().normalize(input)).rejects.toThrow(/wecom-document/) }
    const noStrike = structuredClone(document()) as any; delete noStrike.rows[0].cells[0].strike
    expect(await source().verify(noStrike)).toBe(false)
    const hugeMetadata = { ...document(), capabilities: { text: 'x'.repeat(32_769) } }
    expect(await source().verify(hugeMetadata)).toBe(false)
  })
})

describe('wecom-document explicit owner-reviewed unknown strike adapter', () => {
  const unknown = (number = 2, id = 'BUS-42', patch: Partial<WecomDocumentRow> = {}) => row(number, id, { cells: row(number, id).cells.map(c => ({ ...c, strike: 'unknown' })), ...patch })

  it('keeps ordinary eligible rows unreviewable and unknown-only rows blocked but reviewable', async () => {
    const adapter = source()
    expect(adapter.extract(document()).items[0]!.reviewable).toBe(false)
    for (const column of ['A', 'B', 'C', 'D']) {
      const input = document([row(2, 'BUS-42', { cells: row().cells.map(c => c.column === column ? { ...c, strike: 'unknown' } : c) })])
      const item = adapter.extract(input).items[0]!
      expect(item).toMatchObject({ eligible: false, reviewable: true })
      expect(item.warnings).toEqual([`Column ${column} has struck or unknown strike state`])
      expect(await adapter.normalize(input)).toEqual([])
    }
    const runOnly = document([row(2, 'BUS-42', { cells: row().cells.map(c => c.column === 'B' ? { ...c, runs: [{ text: c.text, strike: 'unknown' }] } : c) })])
    expect(adapter.extract(runOnly).items[0]).toMatchObject({ eligible: false, reviewable: true })
  })

  it('builds a Host-reviewed system/bot/none trigger without changing unknown evidence or auto-emitting', () => {
    const adapter = source()
    const item = adapter.extract(document([unknown(2, 'BUS-42', { images: [image()] })])).items[0]!
    const before = JSON.stringify(item)
    const trigger = adapter.reviewedTrigger(item)
    expect(trigger).toMatchObject({ source: 'docs:bugs', trust: 'system', addressed: 'none', actor: { id: 'wecom-document', source: 'docs:bugs', bot: true }, text: item.text })
    expect(trigger.externalId).toBe(`${item.itemKey}:${item.revision}`)
    expect(trigger.threadKey).toBe(`wecom-document:${item.itemKey}`)
    expect(trigger.raw).toEqual({ kind: 'wecom-document', itemKey: item.itemKey, revision: item.revision, configVersion: item.configVersion, reviewed: true })
    expect(JSON.stringify(item)).toBe(before)
    expect(item.evidence.row.cells.every(c => c.strike === 'unknown')).toBe(true)
    expect(JSON.stringify(trigger.raw)).not.toContain(image().data)
  })

  it('rejects known cell/run strike and every non-strike blocker, including duplicate batches', () => {
    const adapter = source()
    const rows: WecomDocumentRow[] = [
      unknown(2, 'BUS-42', { cells: unknown().cells.map(c => c.column === 'C' ? { ...c, strike: 'yes' } : c) }),
      unknown(2, 'BUS-42', { cells: unknown().cells.map(c => c.column === 'B' ? { ...c, runs: [{ text: c.text, strike: 'yes' }] } : c) }),
      unknown(2, ''),
      unknown(2, 'BUS-42', { cells: unknown().cells.filter(c => c.column !== 'C') }),
      unknown(2, 'BUS-42', { cells: unknown().cells.map(c => c.column === 'B' ? { ...c, text: '' } : c) }),
      unknown(2, 'BUS-42', { imagesComplete: false }),
    ]
    const items = rows.map(r => adapter.extract(document([r])).items[0]!)
    items.push(adapter.extract(document([unknown()], { complete: false })).items[0]!)
    items.push(...adapter.extract(document([unknown(), unknown(3)])).items)
    for (const item of items) {
      expect(item).toMatchObject({ eligible: false, reviewable: false })
      expect(() => adapter.reviewedTrigger(item)).toThrow(/review/)
      // A boolean flip cannot erase the other blockers or duplicate/partial-batch warnings.
      expect(() => adapter.reviewedTrigger({ ...item, reviewable: true })).toThrow()
    }
    expect(() => adapter.reviewedTrigger(adapter.extract(document()).items[0]!)).toThrow(/review/)
  })

  it('revalidates evidence and rejects changed semantic identity, revision, content, config or reviewability', () => {
    const adapter = source(), item = adapter.extract(document([unknown()])).items[0]!
    for (const patch of [{ itemKey: '0'.repeat(64) }, { revision: '0'.repeat(64) }, { configVersion: '0'.repeat(64) }, { reviewable: false }, { reviewable: undefined }, { text: 'Forged text' }, { title: 'Forged title' }, { warnings: [] }]) {
      expect(() => adapter.reviewedTrigger({ ...item, ...patch } as WecomDocumentItem)).toThrow()
    }
    const changed = { ...item, evidence: { ...item.evidence, row: unknown(2, 'BUS-42', { cells: unknown().cells.map(c => c.column === 'C' ? { ...c, text: 'changed' } : c) }) } }
    expect(() => adapter.reviewedTrigger(changed)).toThrow()
    const knownStrike = { ...item, evidence: { ...item.evidence, row: unknown(2, 'BUS-42', { cells: unknown().cells.map(c => c.column === 'C' ? { ...c, strike: 'yes' } : c) }) } }
    expect(() => adapter.reviewedTrigger(knownStrike)).toThrow()
    const wrongDoc = { ...item, evidence: { ...item.evidence, doc: 'https://doc.weixin.qq.com/sheet/foreign' } }
    expect(() => adapter.reviewedTrigger(wrongDoc)).toThrow()
    expect(() => source(config({ firstDataRow: 2 })).reviewedTrigger(item)).toThrow(/config/)
  })
})

describe('wecom-document explicit manual lifecycle', () => {
  it('start never reads, scan single-flights and persists all candidates before sinking only eligible triggers', async () => {
    const gate = deferred<WecomDocumentSnapshot>()
    const events: string[] = []; const items: WecomDocumentItem[] = []; const triggers: Trigger[] = []
    const read = vi.fn(() => { events.push('read'); return gate.promise })
    const adapter = new WecomDocumentSource(config(), { read, async persist(batch) { events.push('persist'); items.push(...batch) } }, async trigger => { events.push('sink'); triggers.push(trigger) })
    await expect(adapter.scan()).rejects.toThrow(/not active/)
    await adapter.start(); await adapter.start()
    expect(read).not.toHaveBeenCalled()
    const one = adapter.scan(), two = adapter.scan()
    expect(one).toBe(two)
    gate.resolve(document([row(2), row(3, '')]))
    const result = await one
    expect(result.items).toHaveLength(2); expect(items).toHaveLength(2)
    expect(events).toEqual(['read', 'persist', 'sink']); expect(read).toHaveBeenCalledTimes(1)
    expect(triggers).toHaveLength(1)
    expect((await adapter.readThread(triggers[0]!.threadKey)).triggers).toEqual(triggers)
    await expect(adapter.readThread(threadKey(`wecom-document:${'0'.repeat(64)}`))).rejects.toThrow(/foreign|unknown/)
    expect((await adapter.health()).ok).toBe(true)
    await adapter.stop(); expect((await adapter.health()).ok).toBe(false)
  })
  it('drains an in-flight read/persist on stop and emits nothing after stop begins', async () => {
    const read = deferred<WecomDocumentSnapshot>(), persisted = deferred<void>()
    const sink = vi.fn(); const persist = vi.fn(() => persisted.promise)
    const adapter = new WecomDocumentSource(config(), { read: () => read.promise, persist }, sink)
    await adapter.start(); const scan = adapter.scan(); let stopped = false
    const stop = adapter.stop().then(() => { stopped = true })
    await Promise.resolve(); expect(stopped).toBe(false)
    await expect(adapter.start()).rejects.toThrow(/draining/)
    read.resolve(document()); await new Promise(resolve => setImmediate(resolve))
    expect(persist).toHaveBeenCalledTimes(1); expect(stopped).toBe(false)
    persisted.resolve(); await stop; await scan
    expect(sink).not.toHaveBeenCalled()
    await expect(adapter.scan()).rejects.toThrow(/not active/)
  })
  it('drains an in-flight sink and never starts another item after stop', async () => {
    const sinkGate = deferred<void>(), started = deferred<void>()
    const sink = vi.fn(async () => { started.resolve(); await sinkGate.promise })
    const adapter = new WecomDocumentSource(config(), { async read() { return document([row(2), row(3, 'BUS-43')]) } }, sink)
    await adapter.start(); const scan = adapter.scan(); await started.promise
    let stopped = false; const stop = adapter.stop().then(() => { stopped = true })
    await Promise.resolve(); expect(stopped).toBe(false)
    sinkGate.resolve(); await scan; await stop; expect(sink).toHaveBeenCalledTimes(1)
  })
  it('fails closed on persistence errors, reports health and recovers without stale scanFlight', async () => {
    const onError = vi.fn(() => { throw new Error('diagnostic failure') }); const sink = vi.fn()
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk denied')).mockResolvedValue(undefined)
    const adapter = new WecomDocumentSource(config(), { async read() { return document() }, persist, onError }, sink)
    await adapter.start(); await expect(adapter.scan()).rejects.toThrow('disk denied')
    expect(sink).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledTimes(1)
    expect(await adapter.health()).toMatchObject({ ok: false, detail: 'Document scan failed' })
    await adapter.scan(); expect(sink).toHaveBeenCalledTimes(1); expect((await adapter.health()).ok).toBe(true)
    await adapter.stop()
  })
  it('rejects writeback by default; delegates only a known workspace session reply and drains it', async () => {
    const triggers: Trigger[] = []
    const noReply = new WecomDocumentSource(config(), { async read() { return document() } }, trigger => { triggers.push(trigger) })
    await noReply.start(); await noReply.scan()
    await expect(noReply.reply('session', triggers[0]!.threadKey, 'reply', 'key')).rejects.toThrow(/writeback/)
    await noReply.stop()
    const gate = deferred<void>(), called = deferred<void>(); const reply = vi.fn(async () => { called.resolve(); await gate.promise })
    const adapter = new WecomDocumentSource(config(), { async read() { return document() }, reply }, trigger => { triggers.push(trigger) })
    await adapter.start(); await adapter.scan()
    await expect(adapter.reply('github-comment', triggers[0]!.threadKey, 'body', 'key')).rejects.toThrow(/workspace/)
    await expect(adapter.reply('session', threadKey('foreign'), 'body', 'key')).rejects.toThrow(/workspace/)
    const sending = adapter.reply('session', triggers[0]!.threadKey, 'body', 'key'); await called.promise
    let stopped = false; const stop = adapter.stop().then(() => { stopped = true })
    await Promise.resolve(); expect(stopped).toBe(false)
    gate.resolve(); await sending; await stop
    expect(reply).toHaveBeenCalledExactlyOnceWith('session', triggers[0]!.threadKey, 'body', 'key')
  })
})
