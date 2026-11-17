import { describe, expect, it } from 'vitest'
import type { AssignmentSnapshot, Watchdog } from '../../src/sessions/watchdog.js'

describe('sessions/watchdog', () => {
  it('keeps the watchdog seam structural and injectable', async () => {
    const assignment: AssignmentSnapshot = { assignmentId: 'a1', ticketId: 't1', sessionId: 's1', state: 'running' }
    const fake: Watchdog = { async snapshotAssignments() { return [assignment] } }
    await expect(fake.snapshotAssignments()).resolves.toEqual([assignment])
  })
})
