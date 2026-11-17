import { describe, expect, it } from 'vitest'
import { generateBrief, validateBrief, type TicketBriefInput } from '../../src/engine/brief.js'
import { generateReport, inspectReport, shouldRetryReport, validateReport, type Report } from '../../src/engine/report.js'

const briefInput: TicketBriefInput = {
  goal: 'repair login retry handling',
  scope: { repo: 'org/name', subdirs: ['app/login'] },
  base: { ref: 'main@abc123', requireCleanTree: true },
  allowWrite: ['app/login/**'],
  denyWrite: ['prod/**'],
  runtime: 'do not start a dev server',
  acceptance: [
    { id: 'A1', check: 'pnpm test -- login', kind: 'command' },
    { id: 'A2', check: 'repeated click sends one request', kind: 'assertion' },
  ],
  outOfScope: ['do not refactor shared http'],
  blockers: ['unknown'],
  firstAction: 'read the login submit path',
  approvalsRequired: ['merge PR'],
}

const brief = generateBrief(briefInput)
const passingReport: Report = {
  state: 'ready',
  done: ['fixed submit guard'],
  todo: [],
  changedPaths: ['app/login/form.ts'],
  acceptance: [
    { id: 'A1', result: 'passed', evidence: 'vitest: 4 passed' },
    { id: 'A2', result: 'passed', evidence: 'manual click trace: one request' },
  ],
  risks: [],
  needHuman: [],
}

describe('pure brief/report validation', () => {
  it('generates and validates all TicketBrief fields', () => {
    expect(validateBrief(brief)).toBe(true)
    expect(Object.keys(brief)).toEqual([
      'goal', 'scope', 'base', 'allowWrite', 'denyWrite', 'runtime', 'acceptance',
      'outOfScope', 'blockers', 'firstAction', 'approvalsRequired',
    ])
    expect(() => generateBrief({ ...briefInput, goal: '' })).toThrow(/invalid TicketBrief/)
  })

  it('requires every report field and maps acceptance ids exactly', () => {
    expect(validateReport(passingReport, brief)).toBe(true)
    expect(validateReport({ ...passingReport, acceptance: [{ id: 'A1', result: 'passed', evidence: 'ok' }] }, brief)).toBe(false)
    expect(validateReport({ ...passingReport, acceptance: [...passingReport.acceptance, { id: 'A1', result: 'passed', evidence: 'duplicate' }] }, brief)).toBe(false)
    expect(validateReport({ ...passingReport, acceptance: passingReport.acceptance.map((item) => item.id === 'A2' ? { ...item, id: 'other' } : item) }, brief)).toBe(false)
    const { done: _done, ...missingDone } = passingReport
    expect(validateReport(missingDone, brief)).toBe(false)
  })

  it('rejects not-run and empty evidence', () => {
    const notRun = { ...passingReport, acceptance: passingReport.acceptance.map((item) => item.id === 'A2' ? { ...item, result: 'not-run' as const } : item) }
    expect(validateReport(notRun, brief)).toBe(false)
    expect(inspectReport(notRun, brief).errors.some((error) => error.includes('not-run'))).toBe(true)
    expect(validateReport({ ...passingReport, acceptance: passingReport.acceptance.map((item) => item.id === 'A1' ? { ...item, evidence: '' } : item) }, brief)).toBe(false)
  })

  it('allows one retry for an invalid ready report, never a second', () => {
    const failed = { ...passingReport, acceptance: passingReport.acceptance.map((item) => item.id === 'A2' ? { ...item, result: 'failed' as const, evidence: 'assertion failed' } : item) }
    expect(generateReport(passingReport, brief)).toMatchObject({ state: 'ready' })
    expect(shouldRetryReport(failed, brief, 0)).toBe(true)
    expect(shouldRetryReport(failed, brief, 1)).toBe(false)
    expect(shouldRetryReport({ ...passingReport, todo: undefined }, brief, 0)).toBe(true)
    expect(shouldRetryReport(passingReport, brief, 0)).toBe(false)
  })
})
