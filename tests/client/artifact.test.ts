import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'

// Lead builds before running this suite. This evaluates the real browser artifact,
// but deliberately provides no DOM, React renderer, screenshots, or visual proof.
const artifact = readFileSync('lib/client.js', 'utf8')
const source = readFileSync('src/client/index.ts', 'utf8')
const styles = readFileSync('src/client/workspace-style.ts', 'utf8')
// Exact color tokens previously verified against the running Harness. The separate
// --dsh-frame-top-clearance variable is layout-owned, not an invented color token.
const verifiedTokens = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
  '--dsw-alias-border-l1', '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
])

type Slot = { name: string; id?: string; key?: string; locale?: string }
type Plugin = { inject: string[]; apply(ctx: unknown): void }

describe('KANBAN-WORKSPACE-DESIGN v1 built client contract (not visual proof)', () => {
  it('evaluates the real loader factory and registers three host slots without rendering', () => {
    const modules: Array<{ id: string; factory(require: (id: string) => unknown): Plugin }> = []
    const imports: string[] = []
    const slots: Slot[] = []
    const owners: string[] = []
    const components: unknown[] = []
    const effects: Array<() => void> = []
    const definitions: string[] = []
    let registeredDictionaries: unknown
    let localeRemoved = false
    let definitionRemoved = false
    const React = { createElement() { throw new Error('registration must not render a page') } }
    const context = createContext({
      window: { __ModuleLoader__: { load(module: typeof modules[number]) { modules.push(module) } } },
    })
    // No globals for createWorkspacePage/workspaceStyles: an accidentally captured
    // import in a toString()-serialized factory must fail, not pass via a test shim.
    new Script(artifact, { filename: 'lib/client.js' }).runInContext(context, { timeout: 1000 })
    expect(modules).toHaveLength(1)
    expect(modules[0]!.id).toBe('dsh-superagent')
    const plugin = modules[0]!.factory((id: string) => {
      imports.push(id)
      if (id !== 'react') throw new Error(`unexpected browser import: ${id}`)
      return React
    })
    expect(imports).toEqual(['react'])
    expect(Array.from(plugin.inject)).toEqual(['slots', 'locale', 'layout', 'uiConversation'])
    expect(() => plugin.apply({
      effect(factory: () => (() => void)) { effects.push(factory()) },
      locale: {
        register(name: string, dictionaries: unknown) {
          expect(name).toBe('superagent'); registeredDictionaries = dictionaries
          return () => { localeRemoved = true }
        },
        bind(name: string) { expect(name).toBe('superagent'); return (key: string) => key },
      },
      uiConversation: { events: { register(definition: { kind: string }) {
        definitions.push(definition.kind)
        return () => { definitionRemoved = true }
      } } },
      layout: { selectPanel() { throw new Error('registration must not navigate') } },
      slots: {
        inject(owner: string, register: () => void) { owners.push(owner); register() },
        register(options: Slot, component: unknown) { slots.push(options); components.push(component) },
      },
    })).not.toThrow()
    expect(owners).toEqual(['conversation.chat.node', 'sidebar.panellist', 'main'])
    expect(slots).toMatchObject([
      { name: 'conversation.chat.node', key: 'superagent-channel-notice', locale: 'superagent' },
      { name: 'sidebar.panellist', id: 'superagent', locale: 'superagent' },
      { name: 'main', key: 'superagent', locale: 'superagent' },
    ])
    expect(slots).toHaveLength(3)
    expect(components.every(component => typeof component === 'function')).toBe(true)
    expect((components[2] as Function).name).toBe('WorkspacePage')
    expect(definitions).toEqual(['superagent-channel-notice'])
    const dictionaries = {
      en: JSON.parse(readFileSync('locale/en.json', 'utf8')).panel,
      zh: JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel,
    }
    // Detect a stale build, including locale changes, rather than asserting that
    // replaced seven-page implementation details remain in the bundle.
    expect(JSON.parse(JSON.stringify(registeredDictionaries))).toEqual(dictionaries)
    for (const seam of ['command-status', 'timelineCursor', 'RetrySameRequest', 'PlanningOnly', 'saw-workspace', 'deriveDeskState', 'saw-compose-modes']) expect(artifact).toContain(seam)
    effects.forEach(dispose => dispose())
    expect(localeRemoved).toBe(true)
    expect(definitionRemoved).toBe(true)
  })

  it('never owns the host root or mounts a second application', () => {
    for (const content of [source, artifact]) {
      expect(content).not.toMatch(/name:\s*['"]root['"]|key:\s*['"]conversation['"]|document\.body|createRoot\s*\(|ReactDOM|dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/)
    }
    expect(artifact).not.toMatch(/__ModuleLoader__\s*=|require\(['"](?:react-dom|@deepseek-ai\/dsh-client)/)
  })

  it('uses only verified theme tokens in index, workspace styles, and the actual artifact', () => {
    for (const [name, content] of [['index', source], ['workspace styles', styles], ['artifact', artifact]] as const) {
      expect(content, name).not.toMatch(/#[a-f\d]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i)
      const tokens = [...content.matchAll(/--dsw-[a-z\d-]+/g)].map(match => match[0])
      expect(tokens.length, name).toBeGreaterThan(0)
      for (const token of tokens) expect(verifiedTokens.has(token), `${name}:${token}`).toBe(true)
    }
    const colorDeclarations = [...styles.matchAll(/(?:^|[;{])\s*(?:color|background(?:-color)?|border(?:-(?:color|top|bottom|left|right|inline-start))?|outline(?:-color)?)\s*:\s*([^;}]+)/g)]
    expect(colorDeclarations.length).toBeGreaterThan(0)
    for (const declaration of colorDeclarations) {
      expect(declaration[1] === '0' || declaration[1]!.includes('var(--dsw-alias-'), declaration[0]).toBe(true)
    }
  })
})
