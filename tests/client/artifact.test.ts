import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Build-owned evidence: lead must run build first. This suite never builds or renders UI.
const artifact = readFileSync('lib/client.js', 'utf8')
const source = readFileSync('src/client/index.ts', 'utf8')
const pages = ['overview', 'tickets', 'threads', 'sources', 'approvals', 'health', 'settings']
// Exact tokens inspected on the running Harness by lead; non-color frame clearance is layout-owned.
const verifiedTokens = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
  '--dsw-alias-border-l1', '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
])

describe('CLOSE-OUT A built client static evidence (not visual proof)', () => {
  it('contains the sidebar, keyed main panel and seven localized page keys', () => {
    for (const identifier of ['sidebar.panellist', 'main', 'superagent']) expect(artifact).toContain(identifier)
    for (const page of pages) {
      const en = JSON.parse(readFileSync('locale/en.json', 'utf8')).panel[page]
      const zh = JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel[page]
      expect(artifact).toContain(JSON.stringify(page) + ':' + JSON.stringify(en))
      expect(artifact).toContain(JSON.stringify(page) + ':' + JSON.stringify(zh))
    }
    // Guard against accidentally verifying a pre-A build that only had placeholder pages.
    for (const key of ['lastInboundAt', 'pausedReadonlyHelp', 'originUnavailable', 'dbSizeBytes', 'watchdogHelp']) expect(artifact).toContain(JSON.stringify(key) + ':')
    expect(artifact).toContain("window.__ModuleLoader__.load({id:'dsh-superagent'")
  })

  it('registers exactly three slots: channel notice, sidebar and main (never the root)', () => {
    expect([...artifact.matchAll(/\bctx\.slots\.register\s*\(/g)]).toHaveLength(3)
    for (const name of ['conversation.chat.node', 'sidebar.panellist', 'main']) {
      expect([...artifact.matchAll(new RegExp(`ctx\\.slots\\.register\\(\\{\\s*name:\\s*['"]${name.replaceAll('.', '\\.')}['"]`, 'g'))]).toHaveLength(1)
    }
    expect(artifact).not.toMatch(/ctx\.slots\.register\(\{\s*name:\s*['"]root['"]|document\.body|createRoot\(/)
  })

  it('uses verified theme tokens without literal colors in source and artifact', () => {
    for (const [name, content] of [['source', source], ['artifact', artifact]]) {
      expect(content, name).not.toMatch(/#[a-f\d]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i)
      const tokens = [...content!.matchAll(/--dsw-[a-z\d-]+/g)].map(match => match[0])
      expect(tokens.length, name).toBeGreaterThan(0)
      for (const token of tokens) expect(verifiedTokens.has(token), `${name}:${token}`).toBe(true)
      const css = content!.match(/const css = `([^`]+)`/)?.[1]
      expect(css, name).toBeTruthy()
      const colorDeclarations = [...css!.matchAll(/(?:^|[;{])(?:color|background(?:-color)?|border(?:-(?:color|top|bottom|left|right))?|outline(?:-color)?)\s*:\s*([^;}]+)/g)]
      expect(colorDeclarations.length, name).toBeGreaterThan(0)
      for (const declaration of colorDeclarations) expect(declaration[1], name).toContain('var(--dsw-alias-')
    }
  })
})
