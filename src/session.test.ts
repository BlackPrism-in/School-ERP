import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const meMock = vi.fn()
vi.mock('./api/endpoints', () => ({ auth: { me: () => meMock() } }))

import { ApiError } from './api/client'
import { can, clearSession, currentUser, hasRole, initials, isAuthenticated, refreshSession } from './session'

const USER = {
  id: 'u1',
  displayName: 'Olivia Martin',
  email: 'olivia@school.edu',
  roles: ['admin'] as const,
  permissions: ['student.read', 'fee.collect'] as const,
  mustChangePassword: false,
  mfaEnabled: false,
  mfaEnrolmentRequired: true,
  scope: 'all' as const,
}

beforeEach(() => {
  meMock.mockReset()
  clearSession()
})

afterEach(() => {
  clearSession()
})

describe('session', () => {
  it('caches what the server said about the current user', async () => {
    meMock.mockResolvedValue(USER)
    await refreshSession()

    expect(isAuthenticated.value).toBe(true)
    expect(currentUser.value?.displayName).toBe('Olivia Martin')
    expect(can('fee.collect')).toBe(true)
    expect(can('exam.publish')).toBe(false)
    expect(hasRole('admin')).toBe(true)
    expect(hasRole('teacher')).toBe(false)
  })

  /** A signed-out visitor is the expected case on first load, not an error. */
  it('treats a 401 as signed out rather than throwing', async () => {
    meMock.mockRejectedValue(new ApiError(401, 'unauthorized', 'nope'))
    await expect(refreshSession()).resolves.toBeNull()
    expect(isAuthenticated.value).toBe(false)
  })

  /** Anything unexpected must fail closed — never leave a stale user cached. */
  it('clears the user and rethrows on an unexpected failure', async () => {
    meMock.mockResolvedValue(USER)
    await refreshSession()
    expect(isAuthenticated.value).toBe(true)

    meMock.mockRejectedValue(new ApiError(500, 'internal_error', 'boom'))
    await expect(refreshSession()).rejects.toThrow()
    expect(isAuthenticated.value).toBe(false)
  })

  it('reports no permissions at all when signed out', () => {
    expect(can('student.read')).toBe(false)
    expect(hasRole('admin')).toBe(false)
  })

  it('derives initials from the display name', async () => {
    meMock.mockResolvedValue(USER)
    await refreshSession()
    expect(initials.value).toBe('OM')

    clearSession()
    meMock.mockResolvedValue({ ...USER, displayName: 'Prince' })
    await refreshSession()
    expect(initials.value).toBe('PR')
  })
})
