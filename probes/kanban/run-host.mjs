import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, openSync, closeSync, watch, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
const [patch, receipt, label] = process.argv.slice(2)
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, receipt ?? '')
if (!patch || !label || !output.startsWith(root + '/probes/kanban/') || existsSync(output)) throw new Error('invalid/stale owned fixture')
const logPath = resolve(root, 'probes/kanban', `${label}-${randomUUID()}-host.log`)
console.log(JSON.stringify({ logPath }))
const fd = openSync(logPath, 'wx', 0o600)
const child = spawn(process.env.DSH_NODE_EXECUTABLE, [resolve(process.env.DSH_INSTALL_DIR, 'lib/bin.js'), '--profile', 'superagent-dev', '--patch', resolve(root, patch), '--port', '0', '--no-open'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', fd, fd], detached: true })
closeSync(fd)
let result, done = false, timedOut = false
const stop = () => { if (child.pid && !done) try { process.kill(-child.pid, 'SIGTERM') } catch {} }
const inspect = () => { if (!existsSync(output)) return; try { result = JSON.parse(readFileSync(output, 'utf8')); stop() } catch {} }
const watcher = watch(dirname(output), inspect)
const timer = setTimeout(() => { timedOut = true; stop() }, 120000)
const hard = setTimeout(() => { if (child.pid && !done) try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 130000)
child.on('error', error => { console.error(error.code); process.exitCode = 1; stop() })
child.on('exit', (code, signal) => { done = true; inspect(); watcher.close(); clearTimeout(timer); clearTimeout(hard); console.log(JSON.stringify({ label, processCode: code, signal, timedOut, receipt: result?.state ?? 'missing' })); if (timedOut || !['passed', 'evidence-recorded'].includes(result?.state)) process.exitCode = 1 })
process.on('SIGTERM', stop)
inspect()
