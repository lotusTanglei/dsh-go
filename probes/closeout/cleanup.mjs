import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '../..')
const names = ['closeout-a', 'closeout-b', 'closeout-b2', 'closeout-d']
const checks = []
for (const name of names) {
  const base = resolve(root, '.superagent-state', name)
  const file = resolve(base, 'superagent.sqlite')
  if (!existsSync(file)) throw new Error(`missing owned fixture ${name}`)
  const db = new DatabaseSync(file, { readOnly: true })
  const activeAssignments = Number(db.prepare("SELECT COUNT(*) AS n FROM assignment WHERE state<>'ended'").get().n)
  const pendingTriggers = Number(db.prepare("SELECT COUNT(*) AS n FROM thread_trigger WHERE state='pending'").get().n)
  const evaluatingTriggers = Number(db.prepare("SELECT COUNT(*) AS n FROM thread_trigger WHERE state='evaluating'").get().n)
  const runningEvals = Number(db.prepare("SELECT COUNT(*) AS n FROM eval WHERE state='running'").get().n)
  const pendingOutbound = Number(db.prepare("SELECT COUNT(*) AS n FROM outbound WHERE state='pending'").get().n)
  db.close()
  checks.push({ fixture: name, activeAssignments, pendingTriggers, evaluatingTriggers, runningEvals, pendingOutbound, ownerLockPresent: existsSync(file + '.lock'), recoverySentinelPresent: existsSync(file + '.lock.recovery') })
}
const ports = new Set()
for (const name of readdirSync(resolve(root, '.probe')).filter(name => /^closeout-(?:a|b|b2|d-zero|d-final-zero|d-resume-zero)\.log$/.test(name))) {
  const text = readFileSync(resolve(root, '.probe', name), 'utf8')
  for (const match of text.matchAll(/dsh web: http:\/\/127\.0\.0\.1:(\d+)/g)) ports.add(Number(match[1]))
}
const listeners = [...ports].map(port => {
  const process = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  if (process.error || ![0, 1].includes(process.status)) throw new Error('listener check unavailable')
  return { port, listening: process.status === 0 && Boolean(process.stdout.trim()) }
})
const snapshots = ['a-live-result.json', 'b-live-result.json', 'b2-live-result.json', 'd-zero-result.json', 'd-final-zero-result.json', 'd-resume-zero-result.json'].map(name => {
  const row = JSON.parse(readFileSync(resolve(root, 'probes/closeout', name), 'utf8'))
  return { receipt: name, state: row.state, liveAgents: row.liveAgents }
})
const result = { kind: 'closeout-owned-fixture-cleanup', at: new Date().toISOString(), state: checks.every(row => row.activeAssignments === 0 && row.pendingTriggers === 0 && row.evaluatingTriggers === 0 && row.runningEvals === 0 && row.pendingOutbound === 0 && !row.ownerLockPresent) && listeners.every(row => !row.listening) && snapshots.every(row => row.liveAgents === 0) ? 'passed' : 'failed', checks, listeners, snapshots, retained: 'History, backups and recovery sentinels retained; no user data deleted. No claim about unrelated desktop or historical fixtures.' }
writeFileSync(resolve(root, 'probes/closeout/d-cleanup-result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
if (result.state !== 'passed') process.exitCode = 1
