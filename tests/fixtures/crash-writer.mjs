import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

// Exercise the current TypeScript sources directly. Node24's native type stripping
// handles `.ts`; this synchronous resolver maps the source tree's `.js` specifiers
// to their corresponding `.ts` files without compiling generated artifacts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      const tsSpecifier = `${specifier.slice(0, -3)}.ts`
      try { return nextResolve(tsSpecifier, context) } catch (error) {
        if (existsSync(new URL(tsSpecifier, context.parentURL))) return nextResolve(tsSpecifier, context)
        throw error
      }
    }
    return nextResolve(specifier, context)
  },
})

const { openStore } = await import('../../src/store/index.ts')
const { ingestTrigger } = await import('../../src/engine/intake.ts')
const { enqueueOutbox } = await import('../../src/engine/outbox.ts')
const { createTrigger } = await import('../../src/domain/trigger.ts')
const { sourceId, threadKey } = await import('../../src/domain/ids.ts')

const dbPath = process.argv[2]
if (!dbPath) throw new Error('crash-writer: db path required')
const store = openStore({ dbPath })
try {
  const source = sourceId('session:crash')
  const thread = threadKey('session:crash')
  const trigger = createTrigger({
    source,
    externalId: 'crash-trigger-1',
    threadKey: thread,
    actor: { id: 'human', source, bot: false },
    text: 'persist before crash',
    at: 10,
    trust: 'human',
    addressed: 'direct',
    raw: null,
  })
  ingestTrigger(store, trigger, { now: () => 10, policy: { acceptedSources: [source], bots: 'deny', paused: true, budgets: { queueLimit: 10 } } })
  store.repos.ticket.insert({
    id: 'ticket-crash', thread_key: thread, decision_id: 'decision-crash', title: 'Crash ticket', state: 'running',
    mandate_json: { strength: 'explicit' },
    brief_json: { goal: 'recover', scope: { repo: 'fixture', subdirs: [] }, base: { ref: 'main', requireCleanTree: true }, allowWrite: [], denyWrite: [], runtime: 'node', acceptance: [{ id: 'A1', check: 'reconcile', kind: 'assertion' }], outOfScope: [], blockers: [], firstAction: 'inspect', approvalsRequired: [] },
    workdir: '/tmp/crash-ticket', current_assignment: 'assignment-crash', created_at: 10, updated_at: 10,
  })
  store.repos.assignment.insert({ id: 'assignment-crash', ticket_id: 'ticket-crash', session_id: `crashed-${process.pid}`, state: 'running', created_at: 10, last_progress_at: 10 })
  enqueueOutbox(store, { id: 'outbound-crash', ticketId: 'ticket-crash', threadKey: thread, channel: 'session', kind: 'reply', body: 'recover once', idempotencyKey: 'crash-idempotency-1', nextAt: 999 }, { now: () => 10 })
  // Simulate the downstream accepting the idempotency key just before this process crashes,
  // while the local Outbox row is still pending and has not recorded `sent` yet.
  store.repos.side_effect.insert({ key: 'send:crash-idempotency-1', kind: 'outbound-send', ticket_id: 'ticket-crash', at: 10, state: 'done', detail: { idempotencyKey: 'crash-idempotency-1', accepted: true } })
  process.stdout.write('READY\n')
  process.stdout.write('CRASH_WRITER_READY\n')
  process.stdout.resume()
  setInterval(() => {}, 1_000)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
}
