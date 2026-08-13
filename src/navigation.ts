import {
  BarChart3,
  Bus,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Hotel,
  LayoutDashboard,
  Library,
  Megaphone,
  Settings,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-vue-next'
import type { Permission, RoleKey } from './api/types'

/**
 * The navigation now describes what the system can actually do.
 *
 * The previous version listed 149 routes, every one of which rendered
 * fabricated rows from a schema. That was useful as a specification and
 * actively misleading as an application — a school cannot tell a working
 * screen from a mock. Each entry now declares its status, and anything not
 * yet backed by an API says so plainly instead of showing invented data.
 */
export type NavStatus = 'live' | 'planned'

export type NavItem = {
  id: string
  label: string
  icon: LucideIcon
  status: NavStatus
  /** Router path. Planned modules route to the roadmap view. */
  to: string
  /** Server-side permission required; absent means every signed-in user. */
  permission?: Permission
  /** Restricts to specific roles on top of the permission check. */
  roles?: RoleKey[]
  section?: string
  /**
   * Which build phase this belongs to. `section` only marks the first item of
   * a visual group, so it cannot be used to filter a whole group.
   */
  phase?: 'mvp' | 'later'
  /** Shown on the roadmap page for planned modules. */
  summary?: string
}

const items: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    status: 'live',
    to: '/app',
    section: 'Workspace',
  },
  {
    id: 'students',
    label: 'Students',
    icon: Users,
    status: 'live',
    to: '/app/students',
    permission: 'student.read',
  },

  // The four MVP modules, in the order they are being built.
  {
    id: 'attendance',
    label: 'Attendance',
    icon: ClipboardCheck,
    status: 'planned',
    to: '/app/module/attendance',
    phase: 'mvp',
    permission: 'attendance.read',
    section: 'Coming next',
    summary:
      'Daily and per-period registers, holidays, leave approval, corrections with an audit trail, and monthly reports.',
  },
  {
    id: 'notices',
    label: 'Notices',
    icon: Megaphone,
    status: 'planned',
    to: '/app/module/notices',
    phase: 'mvp',
    permission: 'notice.read',
    summary: 'Announcements targeted by class, section or role, with read receipts.',
  },
  {
    id: 'exams',
    label: 'Exams & Marks',
    icon: FileText,
    status: 'planned',
    to: '/app/module/exams',
    phase: 'mvp',
    permission: 'exam.read',
    summary:
      'Exam scheduling, mark entry bounded by each paper’s maximum, moderation, result publication and report cards.',
  },
  {
    id: 'fees',
    label: 'Fees',
    icon: WalletCards,
    status: 'planned',
    to: '/app/module/fees',
    phase: 'mvp',
    permission: 'fee.read',
    summary:
      'Fee structures, concessions, instalments, late-fee rules, gapless numbered receipts, partial payments and reconciliation.',
  },

  {
    id: 'staff',
    label: 'Staff',
    icon: UserCog,
    status: 'planned',
    to: '/app/module/staff',
    phase: 'later',
    permission: 'staff.read',
    section: 'Later phases',
    summary: 'Staff records, attendance and leave. Payroll is a separate project.',
  },
  {
    id: 'timetable',
    label: 'Timetable',
    icon: CalendarDays,
    status: 'planned',
    to: '/app/module/timetable',
    phase: 'later',
    summary: 'Class routines, period allocation and teacher schedules.',
  },
  {
    id: 'library',
    label: 'Library',
    icon: Library,
    status: 'planned',
    to: '/app/module/library',
    phase: 'later',
    summary: 'Catalogue, members, issue and return.',
  },
  {
    id: 'transport',
    label: 'Transport',
    icon: Bus,
    status: 'planned',
    to: '/app/module/transport',
    phase: 'later',
    summary: 'Buses, routes, stops and riders.',
  },
  {
    id: 'hostel',
    label: 'Hostel',
    icon: Hotel,
    status: 'planned',
    to: '/app/module/hostel',
    phase: 'later',
    summary: 'Rooms, residents, meals and billing.',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    status: 'planned',
    to: '/app/module/reports',
    phase: 'later',
    permission: 'report.read',
    summary: 'Operational and academic reporting with exports.',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    status: 'planned',
    to: '/app/module/settings',
    phase: 'later',
    permission: 'settings.manage',
    summary: 'School profile, academic sessions, classes, sections, subjects and user accounts.',
  },
]

export function navigationFor(
  permissions: readonly Permission[],
  roles: readonly RoleKey[],
): NavItem[] {
  return items.filter((item) => {
    if (item.permission && !permissions.includes(item.permission)) return false
    if (item.roles && !item.roles.some((r) => roles.includes(r))) return false
    return true
  })
}

export function findNavItem(id: string): NavItem | undefined {
  return items.find((item) => item.id === id)
}

export const liveModuleCount = items.filter((i) => i.status === 'live').length
export const plannedModuleCount = items.filter((i) => i.status === 'planned').length
