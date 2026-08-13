import { computed, readonly, ref } from 'vue'
import { auth } from './api/endpoints'
import { ApiError } from './api/client'
import type { CurrentUser, Permission, RoleKey } from './api/types'

/**
 * Who is signed in, as far as the client knows.
 *
 * This is a cache of what the server said, never the source of truth. The
 * session itself is an httpOnly cookie the browser cannot read, and every
 * permission here is re-checked server-side on each request. Hiding a button
 * is a courtesy, not a control.
 */

const user = ref<CurrentUser | null>(null)
const loading = ref(true)

export const currentUser = readonly(user)
export const sessionLoading = readonly(loading)

export const isAuthenticated = computed(() => user.value !== null)

export function can(permission: Permission): boolean {
  return user.value?.permissions.includes(permission) ?? false
}

export function hasRole(...roles: RoleKey[]): boolean {
  return user.value?.roles.some((r) => roles.includes(r)) ?? false
}

export const isPortalRole = computed(() => hasRole('student', 'guardian'))

/** Initials for the avatar, derived rather than stored. */
export const initials = computed(() => {
  const name = user.value?.displayName?.trim()
  if (!name) return '?'
  const parts = name.split(/\s+/)
  return (parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : name.slice(0, 2)).toUpperCase()
})

export const primaryRoleLabel = computed(() => {
  const labels: Record<RoleKey, string> = {
    superadmin: 'Super Admin',
    admin: 'Administrator',
    accountant: 'Accountant',
    teacher: 'Teacher',
    student: 'Student',
    guardian: 'Guardian',
  }
  const role = user.value?.roles[0]
  return role ? labels[role] : ''
})

/**
 * Asks the server who we are. Called once at boot and after sign-in.
 * A 401 is the expected answer for a signed-out visitor, not an error.
 */
export async function refreshSession(): Promise<CurrentUser | null> {
  loading.value = true
  try {
    user.value = await auth.me()
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) {
      user.value = null
    } else if (error instanceof ApiError && error.isPasswordChangeRequired) {
      // /auth/me is reachable under a forced password change, so this should
      // not happen — but if the allowlist ever changes, fail closed.
      user.value = null
    } else {
      user.value = null
      throw error
    }
  } finally {
    loading.value = false
  }
  return user.value
}

export function clearSession() {
  user.value = null
}
