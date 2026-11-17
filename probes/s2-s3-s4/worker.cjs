// Disposable report sentinel; no business state, network or file writes.
const { createRequire } = require('node:module')
exports.inject = ['tools']
exports.apply = function apply(ctx, config) {
  const installed = createRequire(`${config.installDir}/package.json`)
  const { defineTool } = installed('@deepseek-ai/dsh-tools')
  ctx.tools.register(defineTool({
    name: 'report_progress',
    description: 'Local test sentinel. Returns a constant.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'progress-probe-ok' },
  }))
}
