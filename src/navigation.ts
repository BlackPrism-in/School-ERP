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
  Upload,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-vue-next'
import type { Permission, RoleKey } from './api/types'

/**
 * The navigation describes what the system can actually do.
 *
 * An earlier version listed 149 routes, every one of which rendered fabricated
 * rows from a schema — useful as a specification and actively misleading as an
 * application, because a school cannot tell a working screen from a mock. Each
 * entry declares its status, and anything not yet backed by an API says so
 * plainly instead of showing invented data.
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
  /** Which build phase this belongs to; `section` only marks a group's first item. */
  phase?: 'mvp' | 'later'
  /** Shown on the roadmap page for planned modules. */
  summary?: string
}

/** Roles that see the roadmap for modules still being built. */
const STAFF_ROLES: RoleKey[] = ['superadmin', 'admin', 'teacher', 'accountant']

const items: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    status: 'live',
    to: '/app',
    section: 'Workspace',
  },
  { id: 'students', label: 'Students', icon: Users, status: 'live', to: '/app/students', permission: 'student.read' },
  { id: 'staff', label: 'Staff', icon: UserCog, status: 'live', to: '/app/staff', permission: 'staff.read' },

  {
    id: 'attendance',
    label: 'Attendance',
    icon: ClipboardCheck,
    status: 'live',
    to: '/app/attendance',
    permission: 'attendance.read',
    section: 'Daily work',
  },
  { id: 'notices', label: 'Notices', icon: Megaphone, status: 'live', to: '/app/notices', permission: 'notice.read' },
  { id: 'exams', label: 'Exams & Marks', icon: FileText, status: 'live', to: '/app/exams', permission: 'exam.read' },
  { id: 'fees', label: 'Fees', icon: WalletCards, status: 'live', to: '/app/fees', permission: 'fee.read' },

  {
    id: 'attendance-report',
    label: 'Attendance report',
    icon: BarChart3,
    status: 'live',
    to: '/app/attendance/report',
    permission: 'attendance.read',
    // A class-wide report needs section scope. Students and guardians hold
    // attendance.read for their own record, so without this they were shown a
    // link that always 403s.
    roles: ['superadmin', 'admin', 'teacher'],
    section: 'Admin',
  },
  {
    id: 'student-import',
    label: 'Import students',
    icon: Upload,
    status: 'live',
    to: '/app/students/import',
    permission: 'student.import',
  },
  { id: 'setup', label: 'School setup', icon: Settings, status: 'live', to: '/app/setup', permission: 'settings.manage' },

  {
    id: 'timetable',
    label: 'Timetable',
    icon: CalendarDays,
    status: 'planned',
    to: '/app/module/timetable',
    phase: 'later',
    roles: STAFF_ROLES,
    section: 'Later phases',
    summary: 'Class routines, period allocation and teacher schedules.',
  },
  {
    id: 'library',
    label: 'Library',
    icon: Library,
    status: 'planned',
    to: '/app/module/library',
    phase: 'later',
    roles: STAFF_ROLES,
    summary: 'Catalogue, members, issue and return.',
  },
  {
    id: 'transport',
    label: 'Transport',
    icon: Bus,
    status: 'planned',
    to: '/app/module/transport',
    phase: 'later',
    roles: STAFF_ROLES,
    summary: 'Buses, routes, stops and riders.',
  },
  {
    id: 'hostel',
    label: 'Hostel',
    icon: Hotel,
    status: 'planned',
    to: '/app/module/hostel',
    phase: 'later',
    roles: STAFF_ROLES,
    summary: 'Rooms, residents, meals and billing.',
  },
]

export function navigationFor(permissions: readonly Permission[], roles: readonly RoleKey[]): NavItem[] {
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
