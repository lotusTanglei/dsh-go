import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaults, resolveConfig, type Config } from '../src/config.js'
import { effectiveSettings } from '../src/panel/settings.js'

function config(): Config {
  return { ...defaults, stateDir: resolve('.test-state'), dbPath: '', lockPath: '', workRoot: '', sources: [], roleTools: { router: [...defaults.roleTools.router], worker: [...defaults.roleTools.worker], watchdog: [...defaults.roleTools.watchdog] } } as Config
}

describe('Config boundary', () => {
  it('resolves every deployment path through configuration', () => {
    const c = resolveConfig(config())
    expect(c.dbPath).toBe(resolve('.test-state/superagent.sqlite'))
    expect(c.lockPath).toBe(`${c.dbPath}.lock`)
    expect(c.workRoot).toBe(resolve('.test-state/work'))
  })
  it('rejects relative/colliding paths and invalid cross-field budgets', () => {
    expect(() => resolveConfig({ ...config(), stateDir: 'relative' })).toThrow('absolute')
    expect(() => resolveConfig({ ...config(), dbPath: 'relative' })).toThrow('absolute')
    expect(() => resolveConfig({ ...config(), lockPath: resolve('.test-state/superagent.sqlite') })).toThrow('distinct')
    expect(() => resolveConfig({ ...config(), budgetWarningRatio: 1 })).toThrow('between')
    expect(() => resolveConfig({ ...config(), outboxBackoffMaxMs: 1 })).toThrow('maximum')
  })
  it('configuration cannot grant prohibited role tools', () => {
    const c = config()
    expect(() => resolveConfig({ ...c, roleTools: { ...c.roleTools, router: ['bash'] } })).toThrow('Router')
    expect(() => resolveConfig({ ...c, roleTools: { ...c.roleTools, worker: ['channel_reply'] } })).toThrow('Worker')
    expect(() => resolveConfig({ ...c, roleTools: { ...c.roleTools, watchdog: ['write'] } })).toThrow('Watchdog')
  })
  it('projects every effective field with evidence-based provenance and hidden paths', () => {
    const c = resolveConfig(config())
    const settings = effectiveSettings(c, { stateDir: c.stateDir, maxWorkers: defaults.maxWorkers, maxRetries: { __jsExpr: 'Number(process.env.SA_RETRIES || 2)' } })
    expect(settings.find(row => row.key === 'maxWorkers')).toMatchObject({ value: 3, origin: 'patch' })
    expect(settings.find(row => row.key === 'maxRetries')).toMatchObject({ value: 2, origin: 'environment' })
    expect(settings.find(row => row.key === 'queueLimit')).toMatchObject({ value: 200, origin: 'default' })
    expect(settings.find(row => row.key === 'dbPath')).toMatchObject({ value: '[REDACTED_PATH]', origin: 'derived', redacted: true })
    expect(settings.find(row => row.key === 'roleTools.worker')).toMatchObject({ origin: 'default' })
    expect(settings.find(row => row.key === 'mainSessionId')).toMatchObject({ value: null, origin: 'default' })
    for (const key of Object.keys(c).filter(key => key !== 'roleTools')) expect(settings.some(row => row.key === key)).toBe(true)
    expect(JSON.stringify(settings)).not.toContain(c.stateDir)
    expect(JSON.stringify(settings)).not.toContain('__jsExpr')
    expect(effectiveSettings(c).every(row => row.origin === 'unavailable')).toBe(true)
    expect(effectiveSettings(c, { __jsExpr: 'JSON.parse(env.FIXTURE_CONFIG)' }).every(row => row.origin === 'unavailable')).toBe(true)
    expect(effectiveSettings(c, { roleTools: { __jsExpr: 'JSON.parse(env.FIXTURE_ROLE_TOOLS)' } }).find(row => row.key === 'roleTools.worker')?.origin).toBe('environment')
  })
  it('validates with actual installed Schemastery, not a mock schema', () => {
    const runtime = JSON.parse(readFileSync(resolve('host-runtime.json'), 'utf8')) as { electronExecutable: string; installDir: string }
    const script = `
      const { createRequire } = require('node:module');
      const installed = createRequire(process.argv[1] + '/package.json');
      const z = installed('@deepseek-ai/schemastery');
      const {createConfigSchema, resolveConfig} = require(process.argv[2]);
      const s = createConfigSchema(z);
      const c = resolveConfig(s({stateDir:process.argv[3]}));
      let invalid = 0;
      for (const bad of [{maxWorkers:0},{evalTimeoutMs:-1},{repeatCallThreshold:0},{maxRetries:-1},{sources:[{id:'x',kind:'github',attended:false}]}]) {
        try { s({...bad,stateDir:process.argv[3]}); } catch { invalid++; }
      }
      console.log(JSON.stringify({callable:typeof s === 'function',maxWorkers:c.maxWorkers,invalid,routerScope:c.routerReadScope}));
    `
    const output = execFileSync(runtime.electronExecutable, ['-e', script, runtime.installDir, resolve('src/config.ts'), resolve('.test-state')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' })
    const evidence = JSON.parse(output.trim()) as Record<string, unknown>
    expect(evidence).toEqual({ callable: true, maxWorkers: 3, invalid: 5, routerScope: 'reported' })
  })
})
