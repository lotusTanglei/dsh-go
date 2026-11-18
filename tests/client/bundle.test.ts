import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClientPlugin } from '../../src/client/index.js'
import { createChannelDefinitions } from '../../src/client/channel.js'

// Check the public registration contract only: no DOM or renderer emulation.
describe('P5 client module contract', () => {
  it('registers the sidebar and matching keyed main panel, never the app root', () => {
    const slots: Array<{ name: string; id?: string; key?: string }> = []
    const owners: string[] = []
    const dictionaries = { en: JSON.parse(readFileSync('locale/en.json', 'utf8')).panel, zh: JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel }
    let localeRemoved = false
    const disposers: Array<() => void> = []
    const plugin = createClientPlugin({ createElement() { throw new Error('registration must not render') } }, dictionaries, createChannelDefinitions())
    plugin.apply({
      effect(factory: () => (() => void)) { disposers.push(factory()) },
      uiConversation: { events: { register(definition: { kind: string }) { expect(definition.kind).toBe('superagent-channel-notice'); return () => {} } } },
      locale: { register(name: string) { expect(name).toBe('superagent'); return () => { localeRemoved = true } }, bind() { return (key: string) => key } },
      layout: { selectPanel() {} },
      slots: { inject(owner: string, factory: () => void) { owners.push(owner); factory() }, register(options: typeof slots[number]) { slots.push(options) } },
    })
    expect(plugin.inject).toEqual(['slots', 'locale', 'layout', 'uiConversation'])
    expect(owners).toEqual(['conversation.chat.node', 'sidebar.panellist', 'main'])
    expect(slots).toMatchObject([{ name: 'conversation.chat.node', key: 'superagent-channel-notice' }, { name: 'sidebar.panellist', id: 'superagent' }, { name: 'main', key: 'superagent' }])
    expect(slots.some(slot => slot.name === 'root')).toBe(false)
    disposers.forEach(dispose => dispose())
    expect(localeRemoved).toBe(true)
  })
  it('keeps visible strings localized and browser imports host-owned', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const en = JSON.parse(readFileSync('locale/en.json', 'utf8')).panel as Record<string, string>
    const zh = JSON.parse(readFileSync('locale/zh.json', 'utf8')).panel as Record<string, string>
    for (const match of source.matchAll(/\bt\('([A-Za-z0-9]+)'\)/g)) {
      expect(en[match[1]!], `en:${match[1]}`).toBeTruthy()
      expect(zh[match[1]!], `zh:${match[1]}`).toBeTruthy()
    }
    expect(source).not.toMatch(/@deepseek-ai\/dsh-client|#[a-fA-F0-9]{3,8}\b|rgba?\(/)
    const build = readFileSync('scripts/build-client.mjs', 'utf8')
    expect(build).toContain("window.__ModuleLoader__.load({id:'dsh-superagent'")
    expect(build).toContain("require('react')")
    expect(source).toContain('credentials: \'same-origin\'')
    expect(source).toContain('new URL(`/api/superagent/')
  })
})
