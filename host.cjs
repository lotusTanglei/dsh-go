// Runtime bootstrap only: uses the installed DSH schema without installing/forking it.
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')
const bootstrap = require('./host-runtime.json')
const installed = createRequire(`${process.env.DSH_INSTALL_DIR || bootstrap.installDir}/package.json`)
const Schema = installed('@deepseek-ai/schemastery')
const configModule = require('./lib/config.js')
exports.Config = configModule.createConfigSchema(Schema)
exports.inject = ['tools', 'agentPresets']
exports.apply = async function apply(ctx, config) {
  const entry = await import(pathToFileURL(resolve(__dirname, 'lib/index.js')).href)
  return entry.apply(ctx, config)
}
