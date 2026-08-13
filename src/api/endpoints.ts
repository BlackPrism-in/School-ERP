import { api } from './client'
import type {
  CurrentUser,
  DashboardSummary,
  LoginResponse,
  Paginated,
  Student,
  StudentDetail,
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
