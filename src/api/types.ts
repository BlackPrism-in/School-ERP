/** Mirrors the API contract. Kept hand-written and small rather than generated. */

export type RoleKey = 'superadmin' | 'admin' | 'accountant' | 'teacher' | 'student' | 'guardian'

export type Permission =
  | 'student.read' | 'student.write' | 'student.delete' | 'student.import'
  | 'staff.read' | 'staff.write' | 'enrolment.manage'
  | 'attendance.read' | 'attendance.mark' | 'attendance.correct'
  | 'fee.read' | 'fee.configure' | 'fee.collect' | 'fee.reverse' | 'fee.concession'
  | 'exam.read' | 'exam.configure' | 'exam.mark' | 'exam.moderate' | 'exam.publish'
  | 'notice.read' | 'notice.write' | 'report.read' | 'audit.read'
  | 'user.manage' | 'settings.manage'

export type CurrentUser = {
  id: string
  displayName: string
  email: string | null
  roles: RoleKey[]
  permissions: Permission[]
  mustChangePassword: boolean
  mfaEnabled: boolean
  mfaEnrolmentRequired: boolean
  scope: 'all' | 'sections' | 'enrolments'
}

export type LoginResponse = {
  user: { id: string; displayName: string; roles: RoleKey[] }
  mfaEnrolmentRequired: boolean
}

export type Student = {
  id: string
  admissionNo: string
  firstName: string
  lastName: string | null
  dateOfBirth: string | null
  gender: string | null
  status: 'active' | 'transferred' | 'withdrawn' | 'alumni'
  admissionDate: string | null
  rollNo: string | null
  sectionName: string | null
  className: string | null
}

export type StudentDetail = Student & {
  bloodGroup: string | null
  category: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  /** Only present for callers permitted to see it. */
  medicalNotes?: string | null
}

export type Paginated<T> = {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export type DashboardSummary = {
  school: { name: string } | null
  session: { name: string; startDate: string; endDate: string } | null
  students: { total: number; active: number } | null
  staff: { total: number } | null
  sections: { total: number } | null
  availableModules: string[]
}

// ---------------------------------------------------------------- school

export type ClassLevel = { id: string; name: string; code: string | null; sortOrder: number; sectionCount: number }
export type Section = {
  id: string
  name: string
  capacity: number | null
  classId: string
  className: string
  sessionId: string
  classTeacherName: string | null
  studentCount: number
}
export type Subject = { id: string; name: string; code: string | null; kind: string }
export type AcademicSession = {
  id: string
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
  status: string
}
export type Enrolment = {
  id: string
  rollNo: string | null
  status: string
  enrolledOn: string
  sectionId: string
  sectionName: string
  className: string
  sessionName: string
  isCurrent: boolean
}

// ------------------------------------------------------------ attendance

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave' | 'excused'

export type RegisterStudent = {
  enrolmentId: string
  studentId: string
  name: string
  admissionNo: string
  rollNo: string | null
  status: AttendanceStatus | null
  remarks: string | null
  markedAt: string | null
  markedBy: string | null
  needsCorrection: boolean
}

export type Register = {
  section: { id: string; name: string; className: string; sessionName: string }
  date: string
  holiday: { name: string } | null
  canMark: boolean
  canCorrect: boolean
  editWindowHours: number
  students: RegisterStudent[]
  summary: Record<AttendanceStatus | 'unmarked', number>
}

export type AttendanceReport = {
  from: string
  to: string
  daysRecorded: number
  students: {
    enrolmentId: string
    name: string
    rollNo: string | null
    present: number
    absent: number
    late: number
    halfDay: number
    leave: number
    excused: number
    markedDays: number
    percentage: number | null
  }[]
}

export type Holiday = { id: string; date: string; name: string; appliesTo: string }
