import { api } from './client'
import type {
  AcademicSession,
  AttendanceReport,
  ClassLevel,
  CurrentUser,
  DashboardSummary,
  Enrolment,
  Holiday,
  LoginResponse,
  Paginated,
  Register,
  Section,
  Student,
  StudentDetail,
  Subject,
} from './types'

export const auth = {
  login: (email: string, password: string, totp?: string) =>
    api.post<LoginResponse>('/auth/login', { email, password, ...(totp ? { totp } : {}) }),

  logout: () => api.post<{ ok: true }>('/auth/logout'),

  me: () => api.get<CurrentUser>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true; message: string }>('/auth/change-password', {
      currentPassword,
      newPassword,
    }),

  forgotPassword: (email: string) =>
    api.post<{ ok: true; message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, newPassword: string) =>
    api.post<{ ok: true; message: string }>('/auth/reset-password', { token, newPassword }),

  mfaBegin: () => api.post<{ secret: string; otpauthUri: string }>('/auth/mfa/begin'),

  mfaConfirm: (code: string) =>
    api.post<{ ok: true; recoveryCodes: string[] }>('/auth/mfa/confirm', { code }),
}

export type StudentQuery = {
  q?: string
  status?: string
  sectionId?: string
  page?: number
  pageSize?: number
}

export type StudentInput = {
  admissionNo: string
  firstName: string
  lastName?: string
  dateOfBirth?: string
  gender?: string
  bloodGroup?: string
  category?: string
  addressLine?: string
  city?: string
  state?: string
  postalCode?: string
  admissionDate?: string
  medicalNotes?: string
}

export const students = {
  list: (query: StudentQuery = {}) => api.get<Paginated<Student>>('/students', query),
  get: (id: string) => api.get<StudentDetail>(`/students/${id}`),
  create: (input: StudentInput) => api.post<{ id: string; admissionNo: string }>('/students', input),
  update: (id: string, input: Partial<StudentInput>) =>
    api.patch<{ id: string; updated: boolean }>(`/students/${id}`, input),
  withdraw: (id: string) => api.delete<{ id: string; status: string }>(`/students/${id}`),
}

export const dashboard = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
}

export const school = {
  sessions: () => api.get<{ data: AcademicSession[] }>('/school/sessions'),
  createSession: (input: { name: string; startDate: string; endDate: string; makeCurrent?: boolean }) =>
    api.post<{ id: string }>('/school/sessions', input),

  classes: () => api.get<{ data: ClassLevel[] }>('/school/classes'),
  createClass: (input: { name: string; code?: string; sortOrder?: number }) =>
    api.post<{ id: string }>('/school/classes', input),
  deleteClass: (id: string) => api.delete<{ id: string }>(`/school/classes/${id}`),

  sections: (query: { classId?: string } = {}) => api.get<{ data: Section[] }>('/school/sections', query),
  createSection: (input: { name: string; classId: string; capacity?: number }) =>
    api.post<{ id: string }>('/school/sections', input),

  subjects: () => api.get<{ data: Subject[] }>('/school/subjects'),
  createSubject: (input: { name: string; code?: string; kind?: string }) =>
    api.post<{ id: string }>('/school/subjects', input),
}

export const enrolment = {
  forStudent: (studentId: string) => api.get<{ data: Enrolment[] }>(`/students/${studentId}/enrolment`),
  enrol: (studentId: string, input: { sectionId: string; rollNo?: string }) =>
    api.post<{ enrolmentId: string; moved: boolean }>(`/students/${studentId}/enrolment`, input),
}

export type RegisterEntry = {
  enrolmentId: string
  status: string
  remarks?: string
  reason?: string
}

export const attendance = {
  register: (query: { sectionId: string; date: string; periodId?: string }) =>
    api.get<Register>('/attendance/register', query),
  save: (input: { sectionId: string; date: string; periodId?: string; entries: RegisterEntry[] }) =>
    api.post<{ saved: number; created: number; updated: number; corrected: number }>(
      '/attendance/register',
      input,
    ),
  report: (query: { sectionId: string; from: string; to: string }) =>
    api.get<AttendanceReport>('/attendance/report', query),
  holidays: () => api.get<{ data: Holiday[] }>('/attendance/holidays'),
  createHoliday: (input: { date: string; name: string; appliesTo?: string }) =>
    api.post<{ id: string }>('/attendance/holidays', input),
}

// ---------------------------------------------------------------- staff

export const staff = {
  list: (query: { q?: string; status?: string; page?: number } = {}) =>
    api.get<Paginated<Record<string, unknown>>>('/staff', query),
  get: (id: string) => api.get<Record<string, unknown>>(`/staff/${id}`),
  create: (input: Record<string, unknown>) => api.post<{ id: string }>('/staff', input),
  update: (id: string, input: Record<string, unknown>) => api.patch<{ id: string }>(`/staff/${id}`, input),
  createAccount: (id: string, input: { email: string; role: string }) =>
    api.post<{ userId: string; email: string; temporaryPassword: string }>(`/staff/${id}/account`, input),
  assign: (id: string, input: { sectionId: string; subjectId: string }) =>
    api.post<{ id: string }>(`/staff/${id}/assignments`, input),
  unassign: (assignmentId: string) => api.delete<{ id: string }>(`/staff/assignments/${assignmentId}`),
}

// -------------------------------------------------------------- notices

export type NoticeAudience = {
  type: 'everyone' | 'role' | 'class_level' | 'section' | 'student'
  roleKey?: string
  classLevelId?: string
  sectionId?: string
  studentId?: string
}

export type NoticeSummary = {
  id: string
  title: string
  category: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'draft' | 'published' | 'archived'
  publishAt: string
  expiresAt: string | null
  excerpt: string
  truncated: boolean
  createdBy: string | null
  read: boolean
}

export const notices = {
  list: (query: { status?: string; unreadOnly?: boolean; page?: number } = {}) =>
    api.get<Paginated<NoticeSummary>>('/notices', query as Record<string, string | number | undefined>),
  get: (id: string) => api.get<Record<string, unknown>>(`/notices/${id}`),
  create: (input: Record<string, unknown>) => api.post<{ id: string }>('/notices', input),
  publish: (id: string) => api.post<{ id: string; status: string }>(`/notices/${id}/publish`),
  archive: (id: string) => api.delete<{ id: string }>(`/notices/${id}`),
}

// ---------------------------------------------------------------- exams

export const exams = {
  list: () => api.get<{ data: Record<string, unknown>[] }>('/exams'),
  get: (id: string) => api.get<Record<string, unknown>>(`/exams/${id}`),
  create: (input: { name: string; classLevelId: string }) => api.post<{ id: string }>('/exams', input),
  addPaper: (examId: string, input: Record<string, unknown>) =>
    api.post<{ id: string }>(`/exams/${examId}/subjects`, input),
  setStatus: (examId: string, status: string) =>
    api.post<{ id: string; status: string }>(`/exams/${examId}/status`, { status }),
  marks: (examSubjectId: string, sectionId: string) =>
    api.get<Record<string, unknown>>(`/exams/subjects/${examSubjectId}/marks`, { sectionId }),
  saveMarks: (examSubjectId: string, input: Record<string, unknown>) =>
    api.post<{ saved: number }>(`/exams/subjects/${examSubjectId}/marks`, input),
  results: (examId: string) => api.get<{ data: Record<string, unknown>[] }>(`/exams/${examId}/results`),
}

// ----------------------------------------------------------------- fees

export const fees = {
  heads: () => api.get<{ data: Record<string, unknown>[] }>('/fees/heads'),
  createHead: (input: { name: string }) => api.post<{ id: string }>('/fees/heads', input),
  structures: () => api.get<{ data: Record<string, unknown>[] }>('/fees/structures'),
  createStructure: (input: Record<string, unknown>) => api.post<{ id: string }>('/fees/structures', input),
  assign: (input: { sectionId: string; feeStructureId: string }) =>
    api.post<{ created: number; skipped: number }>('/fees/assign', input),
  forStudent: (studentId: string) => api.get<Record<string, unknown>>(`/fees/student/${studentId}`),
  collect: (input: Record<string, unknown>) =>
    api.post<{ paymentId: string; receiptNo: string }>('/fees/collect', input),
  reverse: (paymentId: string, reason: string) =>
    api.post<{ reversalReceiptNo: string }>(`/fees/payments/${paymentId}/reverse`, { reason }),
  daybook: (date?: string) => api.get<Record<string, unknown>>('/fees/daybook', { date }),
  outstanding: () => api.get<{ data: Record<string, unknown>[] }>('/fees/outstanding'),
}

// ------------------------------------------------------------ onboarding

export const onboarding = {
  importStudents: (rows: Record<string, unknown>[], dryRun: boolean) =>
    api.post<{
      dryRun: boolean
      imported: number
      summary: { totalRows: number; validRows: number; problemRows: number }
      problems: { row: number; field: string; message: string }[]
      truncatedProblems: number
    }>('/students/import', { rows, dryRun }),

  guardians: (studentId: string) => api.get<{ data: Record<string, unknown>[] }>(`/students/${studentId}/guardians`),
  addGuardian: (studentId: string, input: Record<string, unknown>) =>
    api.post<{ guardianId: string }>(`/students/${studentId}/guardians`, input),

  promotePreview: (input: { fromSectionId: string; toSectionId: string }) =>
    api.post<Record<string, unknown>>('/enrolment/promote/preview', input),
  promote: (input: { fromSectionId: string; toSectionId: string; retainStudentIds?: string[] }) =>
    api.post<{ promoted: number; retained: number }>('/enrolment/promote', input),
}
