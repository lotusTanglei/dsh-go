import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStore, type Store } from '../../src/store/index.js'
import { decodeJson, encodeJson, hasSensitiveContractData, redact } from '../../src/store/codec.js'
import { apply } from '../../src/index.js'
import { defaults, type Config } from '../../src/config.js'
import { installPanelRoutes, type PanelPorts } from '../../src/panel/routes.js'

// Synthetic values only: no live profile, credentials, network, or model activation.
const paths = ['/Users/fixture/project/private.txt', '/home/fixture/project/private.txt', String.raw`C:\Users\fixture\project\private.txt`]
const secrets = ['sk' + '-CLOSEOUTdummy123', 'ghp' + '_CLOSEOUTdummy123', 'Bearer ' + 'CLOSEOUTdummy123']
const privateUrl = 'https://' + 'service.internal/private'
const attack = [...secrets, privateUrl, ...paths].join(' | ')
const payload = { note: attack, nested: [{ note: attack, api_key: 'key-field-dummy' }], tokens: 123, steps: 4 }
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks() })
function temporaryDirectory() {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-closeout-security-'))
  const absolute = resolve(dir)
  cleanup.push(() => {
    if (resolve(dir) !== absolute || !absolute.startsWith(resolve(tmpdir()) + '/') || !dir.includes('superagent-closeout-security-')) throw new Error('unexpected cleanup target')
    rmSync(absolute, { recursive: true, force: true })
  })
  return dir
}
function makeStore(): Store {
  const store = openStore({ dbPath: join(temporaryDirectory(), 'fixture.sqlite') })
  cleanup.push(() => store.close())
  return store
}
function noPrivateData(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const sensitive of [...secrets, privateUrl, ...paths, 'key-field-dummy']) expect(text).not.toContain(sensitive)
  expect(text).not.toMatch(/sk-|ghp_|Bearer\s|https?:\/\/|\/Users\/|\/home\/|[A-Z]:(?:\\)+Users(?:\\)+/i)
}
function trigger(store: Store, id: string, raw: unknown = payload) {
  store.repos.trigger.insert({ id, source: 'fixture-source', external_id: id, thread_key: 'fixture-thread', actor_id: 'fixture-human', actor_bot: false, text: attack, trust: 'human', addressed: 'direct', at: 1, raw })
}
function ticket(store: Store, id = 'fixture-ticket', brief: unknown = {}, mandate: unknown = {}) {
  store.repos.ticket.insert({ id, thread_key: 'fixture-thread', decision_id: 'fixture-decision', title: attack, state: 'open', brief_json: brief, mandate_json: mandate, workdir: '/tmp/fixture-work', created_at: 1, updated_at: 1 })
}
function panel(store: Store, ports: PanelPorts = {}) {
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const installed = installPanelRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route.fetch); return () => { routes.delete(route.path) } } } } }, store, { panelPageSize: 20 }, ports)
  cleanup.push(installed.dispose)
  return async (route: string, value: unknown = {}) => {
    const response = await routes.get(`/api/superagent/${route}`)!(new Request(`http://localhost/api/superagent/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }))
    return { status: response.status, body: await response.json() as any }
  }
}

describe('CLOSE-OUT C privacy sinks and execution-contract separation', () => {
  it.each(paths)('redacts the complete user path %s in nested sink data but preserves metrics', path => {
    expect(redact(path)).toBe('[REDACTED_PATH]')
    expect(redact(`failure at "${path}"`)).toBe('failure at "[REDACTED_PATH]"')
    expect(redact({ note: path, nested: [path], tokens: 123, steps: 4 })).toEqual({ note: '[REDACTED_PATH]', nested: ['[REDACTED_PATH]'], tokens: 123, steps: 4 })
    expect(decodeJson(encodeJson({ note: path }))).toEqual({ note: '[REDACTED_PATH]' })
    expect(redact(redact(path))).toBe(redact(path))
  })

  it('redacts spaced user paths and sensitive object keys without leaking suffixes', () => {
    for (const path of ['/Users/Fixture Person/private-project/file.txt', '/home/fixture/my project/private.txt', String.raw`C:\\Users\\Fixture Person\\private-project\\file.txt`]) {
      expect(redact(`failure at "${path}"`)).toBe('failure at "[REDACTED_PATH]"')
    }
    const keys = redact({ '/Users/fixture/private-project/file.txt': 'v', 'sk-CLOSEOUTkey123': 'v', 'https://internal.example/private': 'v' }) as Record<string, unknown>
    expect(keys).toEqual({ '[REDACTED_PATH]': 'v', '[REDACTED_SECRET]': 'v', '[REDACTED_URL]': 'v' })
  })

  it('parses wrapped contract JSON before checking secrets and does not reject long legal paths', () => {
    const legalPath = '/Users/fixture/' + 'longcomponent'.repeat(4) + '/repo'
    expect(hasSensitiveContractData({ scope: { repo: legalPath } })).toBe(false)
    expect(hasSensitiveContractData(JSON.stringify({ schemaVersion: 1, value: { token: 'short-secret-not-prefixed' } }))).toBe(true)
    expect(hasSensitiveContractData(JSON.stringify({ schemaVersion: 1, value: { scope: { repo: legalPath } } }))).toBe(false)
    const store = makeStore()
    expect(() => ticket(store, 'wrapped-secret', JSON.stringify({ schemaVersion: 1, value: { token: 'short-secret-not-prefixed' } }), {})).toThrow('Sensitive value')
  })

  it.each(paths)('roundtrips legal brief/mandate paths exactly for %s without weakening secret rejection', path => {
    const store = makeStore()
    const brief = { goal: 'Inspect fixture', scope: { repo: path, subdirs: ['src'] }, allowWrite: ['src/**'], denyWrite: ['.env'], acceptance: [] }
    const mandate = { scope: { repo: path }, policyVersion: 'a'.repeat(64) }
    expect(hasSensitiveContractData(brief)).toBe(false)
    ticket(store, 'legal-path', brief, mandate)
    expect(store.repos.ticket.get('legal-path')?.brief_json).toEqual(brief)
    expect(store.repos.ticket.get('legal-path')?.mandate_json).toEqual(mandate)
    for (const [index, sensitive] of [...secrets, privateUrl].entries()) {
      expect(hasSensitiveContractData({ goal: sensitive })).toBe(true)
      expect(() => ticket(store, `sensitive-${index}`, { goal: sensitive }, {})).toThrow('Sensitive value')
      expect(store.repos.ticket.get(`sensitive-${index}`)).toBeUndefined()
    }
    expect(() => ticket(store, 'sensitive-key', { token: 'key-field-dummy' }, {})).toThrow('Sensitive value')
  })

  it('C1-6 redacts actual repo.insert audit.detail and trigger.raw before SQLite persistence', () => {
    const store = makeStore()
    trigger(store, 'trigger-direct')
    trigger(store, 'trigger-wrapped', JSON.stringify({ schemaVersion: 1, value: payload }))
    store.repos.audit.insert({ at: 1, actor: 'fixture', action: 'security_fixture', detail: payload })
    const audit = store.repos.audit.all()[0]!
    noPrivateData(audit.detail)
    noPrivateData(store.repos.trigger.get('trigger-direct')?.raw)
    noPrivateData(store.repos.trigger.get('trigger-wrapped')?.raw)
    expect(audit.detail).toMatchObject({ tokens: 123, steps: 4, nested: [{ api_key: '[REDACTED]' }] })
    // Inspect real SQL bytes, not merely decoded projections or calls to redact().
    for (const table of ['audit', 'trigger']) {
      const persisted = store.db.prepare(`SELECT * FROM ${table}`).all()
      expect(persisted.length).toBeGreaterThan(0)
      noPrivateData(persisted)
      expect(JSON.stringify(persisted)).toContain('[REDACTED_PATH]')
    }
  })

  it('C1-4 rejects SQL ids and 201-character ids on each id-bearing panel route without side effects', async () => {
    const store = makeStore()
    ticket(store)
    let actionCalls = 0
    const post = panel(store, { stopTicket() { actionCalls++ }, resumeTicket() { actionCalls++ } })
    const hostileIds = ["fixture'); DROP TABLE ticket; --", 'x'.repeat(201)]
    for (const id of hostileIds) {
      for (const [route, input] of [
        ['ticket', { id }], ['ticket-action', { id, action: 'stop', reason: 'fixture request' }],
        ['approval', { id, decision: 'approve', reason: 'fixture request' }], ['threads', { key: id }], ['tickets', { source: id }],
      ] as const) {
        const response = await post(route, input)
        expect(response.status, route).toBe(400)
        expect(response.body).toMatchObject({ ok: false, code: 'invalid_input', error: { code: 'invalid_input' } })
        expect(JSON.stringify(response.body)).not.toContain(id)
      }
    }
    expect(actionCalls).toBe(0)
    expect(store.repos.ticket.get('fixture-ticket')?.state).toBe('open')
    expect(store.repos.audit.all()).toHaveLength(0)
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ticket'").get()?.name).toBe('ticket')
  })

  it('C5 scans four synthetic sinks: actual product log, audit, panel JSON and trigger.raw', async () => {
    const store = makeStore()
    trigger(store, 'four-sinks')
    store.repos.audit.insert({ at: 1, actor: 'fixture', action: 'security_fixture', detail: payload })
    ticket(store)
    // Deliberately bypass repository privacy for this title to exercise panel sanitization itself.
    store.db.prepare('UPDATE ticket SET title = ? WHERE id = ?').run(attack, 'fixture-ticket')
    const post = panel(store, { health: () => ({ ok: false, runtime: { state: attack } }), sources: () => [{ id: 'fixture-source', kind: attack, attended: false, ok: false, lastAt: 1, paused: false }] })
    const panelOutput: unknown[] = []
    for (const route of ['overview', 'tickets', 'ticket', 'health', 'threads', 'approvals', 'settings']) {
      const response = await post(route, route === 'ticket' ? { id: 'fixture-ticket' } : {})
      expect(response.status).toBe(200)
      panelOutput.push(response.body)
    }
    // Product logging is fixed text today. This proves its actual activation log only,
    // not arbitrary Harness/OS failure logs. No runtime/model adapters are supplied.
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...values) => { output.push(values.map(String).join(' ')) })
    const effects: Array<() => void | Promise<void>> = []
    const stateDir = temporaryDirectory()
    const config = { ...defaults, stateDir, dbPath: '', lockPath: '', workRoot: '', sources: [], roleTools: defaults.roleTools } as Config
    apply({ effect(factory) { effects.push(factory()) } }, config)
    cleanup.push(async () => { for (const dispose of effects.reverse()) await dispose() })
    expect(output).toEqual(['[superagent] loaded'])
    // A synthetic diagnostic passed through the real public redactor is a separate,
    // explicitly bounded log-format check, not proof that every logger calls it.
    const syntheticDiagnostic = JSON.stringify(redact({ message: attack }))
    const sinks = { log: [...output, syntheticDiagnostic], audit: store.repos.audit.all()[0]!.detail, panel: panelOutput, triggerRaw: store.repos.trigger.get('four-sinks')!.raw }
    expect(Object.keys(sinks)).toEqual(['log', 'audit', 'panel', 'triggerRaw'])
    for (const [name, result] of Object.entries(sinks)) { expect(result, name).toBeTruthy(); noPrivateData(result) }
    expect(JSON.stringify(sinks.panel)).toContain('[REDACTED_PATH]')
  })
})
