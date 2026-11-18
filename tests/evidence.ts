import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
/** Test reruns never replace published historical acceptance receipts. */
const root = resolve('probes/kanban/test-runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
export function writeEvidence(name: string, value: unknown): void {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid evidence name')
  mkdirSync(root, { recursive: true })
  writeFileSync(resolve(root, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}
