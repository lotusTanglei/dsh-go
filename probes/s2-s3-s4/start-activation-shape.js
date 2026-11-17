// Static API-shape probe. It intentionally does not call a live model.
export function startWorker(ctx, parent, signal) {
  return ctx.subagents.startActivation({
    provider: 'spawn',
    label: 's234-probe-worker',
    delivery: 'caller',
    parent,
    signal,
    agentPreset: 'probe-s234',
    prompt: [{ type: 'text', text: 'S2 shape probe; no model call in this artifact.' }],
  })
}
