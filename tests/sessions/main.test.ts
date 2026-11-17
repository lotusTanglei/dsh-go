import { describe, expect, it } from 'vitest'
import { ensureMainSession, injectContext, notifyRouter, watchMainSessionDisposal, type MainSessionContext } from '../../src/sessions/main.js'

function context() {
  const agents = new Map<string, { sessionId: string; inject: (text: string) => void; followup: (text: string) => void }>()
  const kv = new Map<string, string>()
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const ctx: MainSessionContext = {
    kv: {
      get(key) { const value = kv.get(String(key)); return value ? { k: String(key), v: value } : undefined },
      upsert(row) { kv.set(row.k, row.v) }, delete(key) { kv.delete(String(key)) },
    },
    sessions: { get(id) { return agents.has(id) ? { id } : undefined } },
    agents: {
      get(id) { return agents.get(id) },
      async resume({ resumeSessionId }) { return agents.get(resumeSessionId)! },
      async create({ sessionId }) {
        const events = { inject: (_text: string) => undefined, followup: (_text: string) => undefined }
        const agent = { sessionId, ...events }
        agents.set(sessionId, agent)
        return agent
      },
    },
    on(event, listener) { listeners.set(event, listener) },
  }
  return { ctx, agents, kv, listeners }
}

describe('sessions/main', () => {
  it('creates and persists a main session, then injects and notifies', async () => {
    const { ctx, agents, kv } = context()
    const id = await ensureMainSession(ctx, { mainSessionId: 'router-1', routerPreset: 'dsh-superagent-router' })
    expect(id).toBe('router-1')
    expect(kv.get('mainSessionId')).toBe('router-1')
    const calls: string[] = []
    const agent = agents.get(id)!
    agent.inject = (text) => { calls.push(`inject:${text}`) }
    agent.followup = (text) => { calls.push(`followup:${text}`) }
    injectContext(ctx, id, 'context')
    notifyRouter(ctx, id, 'notify')
    expect(calls).toEqual(['inject:context', 'followup:notify'])
  })

  it('clears only the matching persisted binding on disposal', async () => {
    const { ctx, kv, listeners } = context()
    await ensureMainSession(ctx, { mainSessionId: 'router-1' })
    watchMainSessionDisposal(ctx)
    listeners.get('session/disposed')?.({ id: 'other' })
    expect(kv.get('mainSessionId')).toBe('router-1')
    listeners.get('session/disposed')?.({ id: 'router-1' })
    expect(kv.get('mainSessionId')).toBeUndefined()
  })
})
