/** Browser factory is serialized by build-client; React and slots stay host-owned. */
import { createWorkspacePage } from './workspace.js'
import { workspaceStyles } from './workspace-style.js'
import { deriveDeskState } from './desk-model.js'
export function createClientPlugin(React: any, dictionaries: Record<string, Record<string, unknown>>, channelDefinitions: readonly unknown[], workspaceFactory = createWorkspacePage, styleFactory = workspaceStyles, deskFactory = deriveDeskState) {
  const h = React.createElement
  const NS = 'superagent'
  return {
    inject: ['slots', 'locale', 'layout', 'uiConversation'],
    apply(ctx: any) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries))
      const t = ctx.locale.bind(NS)
      for (const definition of channelDefinitions) ctx.effect(() => ctx.uiConversation.events.register(definition))
      function ChannelNotice({ node }: any) {
        return h('section', { role: 'status', 'aria-label': t('channelNotice'), style: { color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 12, margin: '8px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, h('strong', null, t('channelNotice')), ...(node.data.messages ?? []).map((message: any) => h('p', { key: message.id, style: { margin: '8px 0 0' } }, message.text)))
      }
      ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'superagent-channel-notice', locale: NS }, ChannelNotice))
      async function request(path: string, body = {}, signal?: AbortSignal) {
        const timeout = new AbortController()
        const timer = setTimeout(() => timeout.abort(), 15000)
        const abort = () => timeout.abort()
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) timeout.abort()
        try {
          const response = await fetch(new URL(`/api/superagent/${path.replace(/^\/+/, '')}`, document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: timeout.signal })
          const text = await response.text()
          let value: any
          try { value = text ? JSON.parse(text) : {} } catch { const error: any = new Error(response.status === 401 ? t('webAuthRequired') : t('invalidResponse')); error.code = response.status === 401 ? 'web_auth_required' : 'invalid_response'; error.status = response.status; throw error }
          if (!response.ok || !value?.ok) {
            const error: any = new Error(response.status === 401 ? t('webAuthRequired') : t('requestFailed'))
            error.code = response.status === 401 ? 'web_auth_required' : value?.code || value?.error?.code
            error.status = response.status
            throw error
          }
          return value.data
        } catch (e: any) {
          if (e?.name === 'AbortError' && !signal?.aborted) { throw new Error(t('requestTimeout')) }
          throw e
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        }
      }
      function Icon() {
        return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'M3 4h18v16H3zM8 4v16M13 4v16M18 4v16' }))
      }
      const Page = workspaceFactory(React, request, t, styleFactory(), deskFactory)
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'superagent', order: 100, label: () => t('title'), locale: NS }, Icon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'superagent', inject: () => ({}), locale: NS }, Page))
    },
  }
}
