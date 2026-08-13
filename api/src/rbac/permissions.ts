/**
 * Mirror of the `permission` table seeded in migration 0002. Kept as a const
 * tuple so route definitions get compile-time checking of permission keys —
 * a typo in `requirePermission('fee.colect')` should not be a runtime 403
 * discovered in production.
 *
 * tests/rbac.test.ts asserts this list matches the database exactly.
 */
export const PERMISSIONS = [
  'student.read',
  'student.write',
  'student.delete',
  'student.import',
  'staff.read',
  'staff.write',
  'enrolment.manage',
  'attendance.read',
  'attendance.mark',
  'attendance.correct',
  'fee.read',
  'fee.configure',
  'fee.collect',
  'fee.reverse',
  'fee.concession',
  'exam.read',
  'exam.configure',
  'exam.mark',
  'exam.moderate',
  'exam.publish',
  'notice.read',
  'notice.write',
  'report.read',
  'audit.read',
  'user.manage',
  'settings.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_KEYS = [
  'superadmin',
  'admin',
  'accountant',
  'teacher',
  'student',
  'guardian',
] as const

export type RoleKey = (typeof ROLE_KEYS)[number]

/**
 * Roles that must complete MFA. These accounts can read every child's record
 * in the school, so a stolen password alone must not be enough.
 */
export const MFA_REQUIRED_ROLES: readonly RoleKey[] = ['superadmin', 'admin']
