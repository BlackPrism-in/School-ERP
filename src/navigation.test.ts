import { describe, expect, it } from 'vitest'
import { navigationFor, findNavItem } from './navigation'
import type { Permission, RoleKey } from './api/types'

/**
 * The navigation is permission-driven, so these assertions double as a
 * readable statement of who sees what. The server re-checks everything — a
 * hidden link is a courtesy, not a control — but a teacher being shown a Fees
 * tab that 403s is still a bug worth catching.
 */

const TEACHER: Permission[] = [
  'student.read', 'attendance.read', 'attendance.mark',
  'exam.read', 'exam.mark', 'notice.read', 'notice.write', 'report.read',
]
const ACCOUNTANT: Permission[] = [
  'student.read', 'fee.read', 'fee.configure', 'fee.collect', 'fee.concession', 'report.read', 'notice.read',
]
const STUDENT: Permission[] = ['student.read', 'attendance.read', 'fee.read', 'exam.read', 'notice.read']
const ADMIN: Permission[] = [
  'student.read', 'student.write', 'student.delete', 'student.import',
  'staff.read', 'staff.write', 'enrolment.manage',
  'attendance.read', 'attendance.mark', 'attendance.correct',
  'fee.read', 'fee.configure', 'fee.collect', 'fee.concession', 'fee.reverse',
  'exam.read', 'exam.configure', 'exam.mark', 'exam.moderate', 'exam.publish',
  'notice.read', 'notice.write', 'report.read', 'user.manage', 'settings.manage',
]

function idsFor(permissions: Permission[], roles: RoleKey[] = []) {
  return navigationFor(permissions, roles).map((i) => i.id)
}

describe('navigation by role', () => {
  it('gives a teacher their daily work but not money or setup', () => {
    const ids = idsFor(TEACHER, ['teacher'])

    expect(ids).toContain('attendance')
    expect(ids).toContain('exams')
    expect(ids).toContain('notices')
    expect(ids).toContain('students')

    expect(ids).not.toContain('fees')
    expect(ids).not.toContain('setup')
    expect(ids).not.toContain('staff')
    expect(ids).not.toContain('student-import')
  })

  it('gives an accountant fees but never attendance or exams', () => {
    const ids = idsFor(ACCOUNTANT, ['accountant'])

    expect(ids).toContain('fees')
    expect(ids).toContain('students')

    expect(ids).not.toContain('attendance')
    expect(ids).not.toContain('exams')
    expect(ids).not.toContain('setup')
  })

  it('gives a student only their own read-only surfaces', () => {
    const ids = idsFor(STUDENT, ['student'])

    expect(ids).toEqual(expect.arrayContaining(['dashboard', 'students', 'attendance', 'exams', 'notices', 'fees']))
    expect(ids).not.toContain('staff')
    expect(ids).not.toContain('setup')
    expect(ids).not.toContain('student-import')
    expect(ids).not.toContain('attendance-report')
  })

  it('gives an admin everything that is built', () => {
    const ids = idsFor(ADMIN, ['admin'])
    for (const id of ['students', 'staff', 'attendance', 'notices', 'exams', 'fees', 'setup', 'student-import']) {
      expect(ids).toContain(id)
    }
  })

  it('shows the dashboard to a user with no permissions at all', () => {
    // Failing closed must not mean a blank shell with no way out.
    expect(idsFor([], [])).toEqual(['dashboard'])
  })
})

describe('module status', () => {
  it('marks the four MVP modules as live', () => {
    for (const id of ['attendance', 'notices', 'exams', 'fees']) {
      expect(findNavItem(id)?.status).toBe('live')
    }
  })

  it('routes every planned module to the roadmap view, never a dead link', () => {
    const planned = navigationFor(ADMIN, ['admin']).filter((i) => i.status === 'planned')
    expect(planned.length).toBeGreaterThan(0)
    for (const item of planned) {
      expect(item.to).toMatch(/^\/app\/module\//)
      // The roadmap page renders this, so an empty one would be a blank panel.
      expect(item.summary).toBeTruthy()
    }
  })

  it('points every live module at a real route, not the roadmap', () => {
    for (const item of navigationFor(ADMIN, ['admin'])) {
      if (item.status === 'live') expect(item.to).not.toContain('/module/')
    }
  })
})
