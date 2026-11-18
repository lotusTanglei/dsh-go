// Bounded process owner for explicit isolated development acceptance only.
import { spawn } from 'node:child_process'
import { openSync, closeSync, existsSync, readFileSync, watch, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
const [patch, receipt, label = 'acceptance'] = process.argv.slice(2)
if (!patch || !receipt || !process.env.DSH_NODE_EXECUTABLE || !process.env.DSH_INSTALL_DIR) throw new Error('launch arguments/runtime unavailable')
const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, receipt)
if (!output.startsWith(root + '/probes/closeout/')) throw new Error('receipt outside owned evidence directory')
if (existsSync(output)) throw new Error('receipt already exists; never accept stale evidence')
mkdirSync(resolve(root, '.probe'), { recursive: true })
const fd = openSync(resolve(root, '.probe', `closeout-${label}.log`), 'a', 0o600)
const child = spawn(process.env.DSH_NODE_EXECUTABLE, [resolve(process.env.DSH_INSTALL_DIR, 'lib/bin.js'), '--profile', 'superagent-dev', '--patch', resolve(root, patch), '--port', '0', '--no-open'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SA_CLOSEOUT_POLL_MS: '5000' }, stdio: ['ignore', fd, fd], detached: true })
closeSync(fd)
let finished = false, timedOut = false, result
const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch {} } }
const inspect = () => { if (!finished && existsSync(output)) { try { result = JSON.parse(readFileSync(output, 'utf8')); finished = true; stop() } catch { /* atomic write completion */ } } }
const watcher = watch(dirname(output), inspect)
const timer = setTimeout(() => { timedOut = true; stop() }, 120_000)
const escalation = setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} } }, 130_000)
child.on('error', error => { console.error(JSON.stringify({ kind: label, launchError: error.code })); stop(); process.exitCode = 1 })
child.on('exit', (code, signal) => {
  inspect(); watcher.close(); clearTimeout(timer); clearTimeout(escalation)
  console.log(JSON.stringify({ kind: label, processCode: code, signal, timedOut, receipt: result?.state ?? 'missing' }))
  if (timedOut || result?.state !== 'passed') process.exitCode = 1
})
process.on('SIGTERM', stop)
inspect()
