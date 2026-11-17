// Runs with node --test against built domain. No DSH or test-library imports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPolicy, sourceId, createThread, enqueueTrigger, startEvaluation, evalId, triggerId } from '../lib/domain/index.js'

test('built domain runs without DSH or Vitest', () => {
  const policy = createPolicy({
    acceptedSources: [sourceId('session:bare')], acceptMode: 'auto', confirm: 'never', bots: 'deny', paused: false, evalTimeoutMs: 100,
    budgets: { maxWorkers: 1, maxStepsPerTicket: 1, maxTokensPerTicket: 1, maxDurationMsPerTicket: 100, maxRetries: 0, queueLimit: 1, watchdog: { intervalMs: 100, stallMs: 100, repeatCallThreshold: 1 } },
  })
  assert.match(policy.version, /^[a-f0-9]{64}$/)
  const thread = enqueueTrigger(createThread({ source: sourceId('session:bare'), kind: 'session', id: 'one', address: {} }, 0), { id: triggerId('session:bare:one'), at: 1 })
  const active = startEvaluation(thread, evalId('bare-eval'))
  assert.throws(() => startEvaluation(active, evalId('second')))
  assert.equal(thread.evaluating, undefined)
  assert.equal(active.evaluating, 'bare-eval')
})
