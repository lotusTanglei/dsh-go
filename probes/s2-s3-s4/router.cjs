// Disposable test sentinels: never sends a message or asks a human.
const { createRequire } = require('node:module')
exports.inject = ['tools']
exports.apply = function apply(ctx, config) {
  const installed = createRequire(`${config.installDir}/package.json`)
  const { defineTool } = installed('@deepseek-ai/dsh-tools')
  for (const name of ['channel_reply', 'human_ask']) {
    ctx.tools.register(defineTool({
      name,
      description: 'Local test sentinel. Returns a constant and performs no external action.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { return 'local-probe-only' },
    }))
  }
}
