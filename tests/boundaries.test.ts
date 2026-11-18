import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function textFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? textFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])
}

describe('P1 package boundaries', () => {
  it('domain remains independent of DSH and third-party libraries', () => {
    for (const file of textFiles('src/domain')) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/(?:from\s*|import\s*\()['"]@deepseek-ai\//)
      expect(text, file).not.toMatch(/(?:from\s*|import\s*\()['"](?:vitest|cordis|schemastery)/)
    }
  })
  it('Host entry delegates DSH session effects and scheduling to its owned runtime', () => {
    const text = readFileSync('src/index.ts', 'utf8')
    expect(text).not.toMatch(/startActivation|followup\(|steer\(|setInterval|fetch\(|\.sessions\.|\.subagents\./)
    expect(text).toContain('createRuntime(')
    expect(text).toContain('runtime?.dispose()')
    expect(text).toContain('[superagent] loaded')
  })
  it('manifest declares bundle/client/version and external core packages are not installed by project', () => {
    const p = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, any>
    expect(p.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(p.dsh.client.platform).toBe('web')
    expect(p.engines.dsh).toBe('>=0.2.2-rc.3 <0.3.0')
    expect(Object.keys(p.dependencies ?? {}).some(name => name.startsWith('@deepseek-ai/'))).toBe(false)
    expect(Object.keys(p.devDependencies).some(name => name.startsWith('@deepseek-ai/'))).toBe(false)
  })
})
