import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/client/index.ts', 'utf8')
const en = JSON.parse(readFileSync('locale/en.json', 'utf8')).panel as Record<string, string>
const zh = JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel as Record<string, string>
const pages = ['overview', 'tickets', 'threads', 'sources', 'approvals', 'health', 'settings']
const branch = (page: string, next?: string) => {
  const start = source.indexOf(`else if (page === '${page}')`)
  const end = next ? source.indexOf(`else if (page === '${next}')`, start) : source.indexOf("return h('section', { className: 'sa-panel'", start)
  expect(start, page).toBeGreaterThan(0)
  expect(end, page).toBeGreaterThan(start)
  return source.slice(start, end)
}

// Static wiring evidence only; intentionally no DOM, React rendering, or screenshot mock.
describe('CLOSE-OUT A source contracts (not visual proof)', () => {
  it('keeps all seven localized pages and Sources on the existing health route', () => {
    expect(source).toContain(`const pages = ['overview', 'tickets', 'threads', 'sources', 'approvals', 'health', 'settings'] as const`)
    for (const page of pages) {
      expect(en[page]).toBeTruthy()
      expect(zh[page]).toBeTruthy()
    }
    expect(source).toContain("request(page === 'sources' ? 'health' : page, page === 'threads' ? { cursor: threadCursor } : {}, controller.signal)")
    expect(source).not.toMatch(/request\(['"]sources['"]|\/api\/superagent\/sources/)
    const explicitRoutes = [...source.matchAll(/request\('([^']+)'/g)].map(match => match[1])
    expect(explicitRoutes).toEqual(['ticket'])
    expect(source).toContain("confirmation.kind === 'approval' ? 'approval' : 'ticket-action'")
  })

  it('groups Threads by source and binds persisted counts, inbound time, and real Eval state', () => {
    expect(source).toContain('groups.get(source)')
    expect(source).toContain('groups.set(source, group)')
    for (const field of ['lastAt', 'createdAt', 'messageCount', 'hasSubscription', 'subscriptionCount', 'paused', 'seq']) expect(source).toContain(`item.${field}`)
    expect(source).toContain("text(item.eval?.state, t('unknown'))")
    expect(source).toContain('text(item.eval?.id ?? item.evaluating)')
    expect(zh.threadCountsHelp).toContain('Trigger')
    const threads = branch('threads', 'overview')
    expect(threads).toContain('threadGroups(items)')
    expect(threads).toContain('data.next')
    expect(threads).toContain("t('previousPage')")
    expect(threads).toContain("t('nextPage')")
  })

  it('renders Sources pause as a disabled boolean switch, never an action', () => {
    const card = source.slice(source.indexOf('const sourceCard ='), source.indexOf('const decisionCard ='))
    for (const field of ['id', 'kind', 'attended', 'ok', 'lastAt', 'paused']) expect(card).toContain(`item.${field}`)
    expect(card).toContain("typeof item.paused === 'boolean'")
    expect(card).toContain("role: 'switch'")
    expect(card).toContain("'aria-checked': item.paused")
    expect(card).toContain('disabled: true')
    expect(card).not.toMatch(/onClick|onChange|request\(/)
    expect(branch('sources', 'health')).toContain('records(data.sources)')
  })

  it('preserves complete settings values, explicit origins and sensitive path redaction', () => {
    expect(source).toContain('JSON.stringify(value)')
    expect(source).toContain("entry.redacted === true || /^(stateDir|dbPath|lockPath|workRoot)$/.test(entry.key) ? '[REDACTED_PATH]'")
    expect(source).toContain('serialized(entry.value)')
    for (const origin of ['patch', 'environment', 'default', 'derived', 'unavailable']) expect(source).toContain(`${origin}: 'origin`)
    for (const key of ['originPatch', 'originEnvironment', 'originDefault', 'originDerived', 'originUnavailable']) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
    expect(source).not.toMatch(/const origins[^\n]+:\s*t\(/)
    const settings = branch('settings', 'sources')
    expect(settings).toContain('records(data.effective)')
    expect(settings).toContain('entries.map(')
    expect(settings).toContain("t(origins[entry.origin] ?? 'unknown')")
    expect(settings).toContain('text(entry.originDetail)')
    expect(settings).not.toMatch(/\.slice\(|request\(|setConfirmation|onChange/)
  })

  it('binds Health database, outbox, latest 20 decisions, metrics and recent errors', () => {
    const health = branch('health')
    for (const field of ['data.ok', 'data.runtime', 'data.db?.version', 'data.db?.sizeBytes', 'data.outbox?.pending', 'data.outbox?.dropped', 'data.watchdog?.lastAt', 'data.watchdog?.decisions', 'data.recentErrors']) expect(health).toContain(field)
    expect(health).toContain('decisions.slice(0, 20).map(decisionCard)')
    const decision = source.slice(source.indexOf('const decisionCard ='), source.indexOf('function Page()'))
    for (const field of ['at', 'action', 'rule', 'outcome', 'assignmentId']) expect(decision).toContain(`item.${field}`)
    for (const field of ['at', 'lastProgressAt', 'stallMs', 'durationMs', 'repeatedCalls', 'usage', 'steps', 'waitingMs']) expect(decision).toContain(`metrics.${field}`)
    for (const field of ['at', 'action', 'code']) expect(health).toContain(`item.${field}`)
  })

  it('does not invent zero counts, healthy booleans, or known empty collections', () => {
    expect(source).toContain("value === true ? t('healthy') : value === false ? t('unhealthy') : t('unknown')")
    expect(source).toContain("value === true ? t('yes') : value === false ? t('no') : t('unknown')")
    expect(source).toContain("Number.isFinite(value) ? String(value) : '—'")
    expect(source).toContain("records(value) ? t('empty') : t('unknown')")
    expect(source).not.toMatch(/\?\? 0|\|\| 0|ok === false \? t\('unhealthy'\) : t\('healthy'\)/)
    for (const page of ['threads', 'settings', 'sources', 'health']) expect(branch(page, page === 'threads' ? 'overview' : page === 'settings' ? 'sources' : page === 'sources' ? 'health' : undefined)).toContain('readonly()')
  })

  it('retains existing details, permission guards and confirmation flow on main pages', () => {
    for (const seam of ["request('ticket', { id: item.id })", "page === 'approvals' ? approvalDetail(detail) : ticketDetail(detail)", '!allowed(item, action)', "confirmation?.kind === 'approval' || confirmation?.action === 'stop'", 'dialog.current.showModal()', 'previousFocus.current?.focus()', "signal?.removeEventListener('abort', abort)"]) expect(source).toContain(seam)
    for (const match of source.matchAll(/\bt\('([A-Za-z0-9]+)'\)/g)) {
      expect(en[match[1]!], `en:${match[1]}`).toBeTruthy()
      expect(zh[match[1]!], `zh:${match[1]}`).toBeTruthy()
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
