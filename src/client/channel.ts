/** Pure DSH Conversation Definitions; no renderer/DOM or runtime package imports. */
export function createChannelDefinitions() {
  const notices = (event: any) => event?.type === 'agent/inbox/spliced'
    ? (event.data?.inserted ?? []).filter((item: any) => item.source?.kind === 'superagent-channel' && typeof item.id === 'string') : []
  const data = (event: any) => event.type === 'user/message' ? [event.data] : notices(event)
  return [{
    kind: 'superagent-channel-notice',
    target: 'chat',
    match(event: any) {
      if (event.type === 'user/message' && event.data?.source?.kind === 'superagent-channel') return { id: String(event.data.id), role: 'start', exclusive: true }
      const message = notices(event)[0]
      return message ? { id: message.id, role: 'start' } : null
    },
    start(_context: any, match: any) {
      return { seq: match.event.seq, messages: data(match.event).map((item: any) => ({ id: item.id, summary: typeof item.source.summary === 'string' ? item.source.summary : '', text: (item.content ?? []).filter((block: any) => block.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n') })) }
    },
    update(context: any) { return context.state },
    publication() { return 'immediate' },
    buildViewNode(context: any) {
      if (!context.state) return null
      return { key: context.key, id: context.id, kind: 'superagent-channel-notice', target: 'chat', anchorSeq: context.state.seq, location: context.start?.location ?? { kind: 'unresolved' }, visibility: 'visible', groupTree: 'turn', data: context.state }
    },
  }]
}
