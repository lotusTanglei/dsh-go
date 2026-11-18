// Standalone zero-model proof. Run with ELECTRON_RUN_AS_NODE=1 installed Electron.
// Uses installed real ConversationNodeAssembler + actual Chat snapshot builder +
// actual generic inbox/message/fallback definitions + product source definition.
// No DOM, React render, profile mutation, engine copy, or custom view builder.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const root = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/'
// Native Node strips no node_modules TS by default. This read-only loader uses
// Node's own transform (needed for parameter properties), never copies engine code.
const { registerHooks, stripTypeScriptTypes, createRequire } = require('node:module')
const { fileURLToPath, pathToFileURL } = require('node:url')
let resolving = false
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!resolving && specifier.startsWith('@deepseek-ai/') && context.parentURL?.startsWith('file:')) {
      resolving = true
      try { return { url: pathToFileURL(createRequire(context.parentURL).resolve(specifier)).href, shortCircuit: true } }
      finally { resolving = false }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }) }
    return nextLoad(url, context)
  },
})
const runtime = (pkg, path) => require(root + pkg + '/src/' + path)
const entry = event => ({ type: 'event', event })
const outcome = { kind: 'real-installed-conversation-and-chat-builder', modelsStarted: false, domUsed: false, fixtures: true, checks: [] }
try {
  const { ConversationNodeAssembler } = runtime('dsh-client-ui-conversation', 'client/conversation/assembler.ts')
  const { chatViewDefinition } = runtime('dsh-client-ui-chat', 'client/conversation-nodes/chat-snapshot-builder.ts')
  const { messageDefinition } = runtime('dsh-client-ui-chat', 'client/conversation-nodes/message.ts')
  const { nextStepInboxDefinition, nextTurnInboxDefinition } = runtime('dsh-client-ui-chat', 'client/conversation-nodes/inbox.ts')
  const { unknownFallbackDefinition } = runtime('dsh-client-ui-chat', 'client/conversation-nodes/fallback.ts')
  const { createChannelDefinitions } = require(resolve(__dirname, '../src/client/channel.ts'))
  const product = createChannelDefinitions()
  const make = () => new ConversationNodeAssembler({ entries: () => [nextStepInboxDefinition, nextTurnInboxDefinition, messageDefinition, ...product], fallbackEntry: () => unknownFallbackDefinition }, { entries: () => [chatViewDefinition] })
  const fixtureMessage = { id: 'fixture-channel-message', role: 'user', source: { kind: 'superagent-channel', form: 'notice', summary: 'Superagent notification' }, content: [{ type: 'text', text: 'Fixture: line one\nline two <not HTML>' }] }
  const fixture = { type: 'agent/inbox/spliced', seq: 10, time: 1000, data: { target: 'next-step', start: 0, inserted: [fixtureMessage] } }
  let splice = fixture
  const supplied = process.argv[2]
  if (supplied) {
    const receipt = JSON.parse(readFileSync(resolve(supplied), 'utf8'))
    const events = receipt.realEvents || receipt.events || []
    const found = events.find(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(item => item.source?.kind === 'superagent-channel'))
    if (!found) throw new Error('Supplied receipt contains no real channel splice')
    splice = found
    outcome.fixtures = false
    outcome.source = resolve(supplied)
  }
  const message = splice.data.inserted.find(item => item.source?.kind === 'superagent-channel')
  const admitted = { type: 'user/message', seq: splice.seq + 1, time: splice.time + 1, surfaceOp: 'append', data: message }
  const ordinary = { type: 'user/message', seq: splice.seq + 2, time: splice.time + 2, surfaceOp: 'append', data: { id: 'fixture-ordinary-human', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Ordinary human input' }] } }
  const generic = { type: 'user/message', seq: splice.seq + 3, time: splice.time + 3, surfaceOp: 'append', data: { id: 'fixture-generic-context', role: 'user', source: { kind: 'superagent-report' }, content: [{ type: 'text', text: 'Ordinary injected report' }] } }
  outcome.admissionEvidence = 'controlled fixture made from the selected message; not a live model admission'
  const notices = engine => {
    const snapshot = engine.snapshot('chat')
    assert(snapshot && snapshot.nodes, 'Actual Chat snapshot exists')
    return snapshot.order.map(key => snapshot.nodes.get(key)).filter(node => node.kind === 'superagent-channel-notice')
  }
  const check = (label, operation) => { operation(); outcome.checks.push({ label, state: 'passed' }) }
  const live = make(); live.replaceWindow([], true); live.activateTarget('chat')
  check('live splice returns immediate and actual Chat emits one visible row', () => { assert.equal(live.append(entry(splice)), 'immediate'); live.flush(); const rows = notices(live); assert.equal(rows.length, 1); assert.equal(rows[0].visibility, 'visible'); assert.equal(rows[0].anchorSeq, splice.seq); assert.equal(rows[0].data.messages[0].text, message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')) })
  const stableKey = notices(live)[0].key
  check('admission same id does not duplicate or move original row', () => { live.append(entry(admitted)); live.flush(); assert.equal(notices(live).length, 1); assert.equal(notices(live)[0].key, stableKey); assert.equal(notices(live)[0].anchorSeq, splice.seq) })
  check('ordinary human and injected report retain generic Chat rows', () => { live.append(entry(ordinary)); live.append(entry(generic)); live.flush(); const snapshot = live.snapshot('chat'); const rows = snapshot.order.map(key => snapshot.nodes.get(key)); assert.equal(rows.length, 3); assert.equal(rows.filter(row => row.kind === 'user').length, 1); assert.equal(rows.filter(row => row.kind === 'context').length, 1) })
  const cold = make(); cold.replaceWindow([entry(admitted)], true); cold.activateTarget('chat')
  check('cold admission-only window reconstructs one visible notification', () => { assert.equal(notices(cold).length, 1); assert.equal(notices(cold)[0].anchorSeq, admitted.seq); assert.equal(notices(cold)[0].key, stableKey) })
  check('prepend older splice reanchors same key without duplicate', () => { cold.prepend([entry(splice)], false); cold.flush(); assert.equal(notices(cold).length, 1); assert.equal(notices(cold)[0].key, stableKey); assert.equal(notices(cold)[0].anchorSeq, splice.seq) })
  check('replace full cold history retains one notification', () => { cold.replaceWindow([entry(splice), entry(admitted)], false); cold.flush(); assert.equal(notices(cold).length, 1); assert.equal(notices(cold)[0].anchorSeq, splice.seq) })
  outcome.state = 'passed'
} catch (error) {
  outcome.state = 'failed'
  outcome.error = { name: error.name, message: error.message, stack: error.stack }
  process.exitCode = 1
}
console.log(JSON.stringify(outcome, null, 2))
