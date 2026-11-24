import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClientPlugin } from '../../src/client/index.js'
import { createChannelDefinitions } from '../../src/client/channel.js'

// Public registration only: neither the default Workspace nor any host page is
// rendered here. Real serialized-factory closure evidence is in artifact.test.ts.
describe('Workspace client module contract', () => {
  it('keeps the three-argument default factory registration compatible and never owns the root', () => {
    const slots: Array<{ name: string; id?: string; key?: string }> = []
    const components: unknown[] = []
    const owners: string[] = []
    const dictionaries = { en: JSON.parse(readFileSync('locale/en.json', 'utf8')).panel, zh: JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel }
    let localeRemoved = false
    let channelRemoved = false
    const disposers: Array<() => void> = []
    const plugin = createClientPlugin({ createElement() { throw new Error('registration must not render') } }, dictionaries, createChannelDefinitions())
    plugin.apply({
      effect(factory: () => (() => void)) { disposers.push(factory()) },
      uiConversation: { events: { register(definition: { kind: string }) { expect(definition.kind).toBe('superagent-channel-notice'); return () => { channelRemoved = true } } } },
      locale: { register(name: string, values: unknown) { expect(name).toBe('superagent'); expect(values).toBe(dictionaries); return () => { localeRemoved = true } }, bind() { return (key: string) => key } },
      layout: { selectPanel() { throw new Error('registration must not navigate') } },
      slots: { inject(owner: string, factory: () => void) { owners.push(owner); factory() }, register(options: typeof slots[number], component: unknown) { slots.push(options); components.push(component) } },
    })
    expect(plugin.inject).toEqual(['slots', 'locale', 'layout', 'uiConversation'])
    expect(owners).toEqual(['conversation.chat.node', 'sidebar.panellist', 'main'])
    expect(slots).toMatchObject([{ name: 'conversation.chat.node', key: 'superagent-channel-notice' }, { name: 'sidebar.panellist', id: 'superagent' }, { name: 'main', key: 'superagent' }])
    expect(slots).toHaveLength(3)
    expect((components[2] as Function).name).toBe('WorkspacePage')
    expect(slots.some(slot => slot.name === 'root' || slot.key === 'conversation')).toBe(false)
    disposers.forEach(dispose => dispose())
    expect(localeRemoved).toBe(true)
    expect(channelRemoved).toBe(true)
  })

  it('keeps browser imports host-owned and serializes both imported factories explicitly', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const en = JSON.parse(readFileSync('locale/en.json', 'utf8')).panel as Record<string, string>
    const zh = JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel as Record<string, string>
    for (const match of source.matchAll(/\bt\('([A-Za-z0-9]+)'\)/g)) {
      expect(en[match[1]!], `en:${match[1]}`).toBeTruthy()
      expect(zh[match[1]!], `zh:${match[1]}`).toBeTruthy()
    }
    expect(source).not.toMatch(/@deepseek-ai\/dsh-client|#[a-fA-F0-9]{3,8}\b|rgba?\(/)
    const build = readFileSync('scripts/build-client.mjs', 'utf8')
    expect(build).toContain("window.__ModuleLoader__.load({id:'dsh-go'")
    expect(build).toContain("require('react')")
    expect(build).toContain('createClientPlugin.toString()')
    expect(build).toContain('createChannelDefinitions.toString()')
    expect(build).toContain('createWorkspacePage.toString()')
    expect(build).toContain('workspaceStyles.toString()')
    expect(build).toContain('deriveDeskState.toString()')
    expect(build).toContain('createGoSettings.toString()')
    expect(build).toContain('createGoDecisions.toString()')
    expect(build).toContain('createGoTencent.toString()')
    expect(build).toContain('createGoProjects.toString()')
    expect(source).toContain('workspaceFactory = createWorkspacePage')
    expect(source).toContain('styleFactory = workspaceStyles')
    expect(source).toContain('workspaceFactory(React, request, t, styleFactory(), deskFactory, settingsFactory, decisionsFactory, tencentFactory, projectsFactory)')
    expect(source).toContain("credentials: 'same-origin'")
    expect(source).toContain('new URL(`/api/superagent/')
  })
})
