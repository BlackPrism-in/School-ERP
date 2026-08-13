import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { currentUser, refreshSession } from '../session'
import type { Permission } from '../api/types'

declare module 'vue-router' {
  interface RouteMeta {
    /** Signed-in users only. Default for anything under /app. */
    requiresAuth?: boolean
    /** Server-side permission the route needs; the API enforces it regardless. */
    permission?: Permission
    /** Reachable while a forced password change is pending. */
    allowDuringPasswordChange?: boolean
    title?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('../views/LandingView.vue'),
    meta: { title: 'EduNova · School ERP' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { title: 'Sign in · EduNova' },
  },
  {
    path: '/change-password',
    name: 'change-password',
    component: () => import('../views/ChangePasswordView.vue'),
    meta: { requiresAuth: true, allowDuringPasswordChange: true, title: 'Set a new password' },
  },
  {
    path: '/app',
    component: () => import('../views/AppShell.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: 'Dashboard · EduNova' },
      },
      {
        path: 'students',
        name: 'students',
        component: () => import('../views/students/StudentListView.vue'),
        meta: { permission: 'student.read', title: 'Students · EduNova' },
      },
      {
        path: 'students/:id',
        name: 'student-detail',
        component: () => import('../views/students/StudentDetailView.vue'),
        meta: { permission: 'student.read', title: 'Student · EduNova' },
      },
      {
        path: 'security',
        name: 'security',
        component: () => import('../views/SecurityView.vue'),
        meta: { title: 'Security · EduNova' },
      },
      {
        path: 'module/:key',
        name: 'planned-module',
        component: () => import('../views/PlannedModuleView.vue'),
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * One resolution pass per navigation.
 *
 * The session is fetched from the server on first navigation rather than
 * trusted from storage — the old build decided who you were by reading
 * `localStorage.getItem('edunova-session')`, which anyone could edit in
 * DevTools to become superadmin.
 */
let bootstrapped = false

router.beforeEach(async (to) => {
  if (!bootstrapped) {
    bootstrapped = true
    await refreshSession().catch(() => undefined)
  }

  const user = currentUser.value

  if (to.meta.requiresAuth && !user) {
    return { name: 'login', query: to.fullPath === '/app' ? {} : { redirect: to.fullPath } }
  }

  // A pending password change blocks everything except setting it. The API
  // enforces this too; this just avoids showing a screen that would 403.
  if (user?.mustChangePassword && !to.meta.allowDuringPasswordChange) {
    return { name: 'change-password' }
  }

  if (user && !user.mustChangePassword && to.name === 'change-password' && !to.query.voluntary) {
    return { name: 'dashboard' }
  }

  if (user && (to.name === 'login' || to.name === 'landing')) {
    return { name: 'dashboard' }
  }

  if (to.meta.permission && user && !user.permissions.includes(to.meta.permission)) {
    return { name: 'dashboard' }
  }

  return true
})

router.afterEach((to) => {
  const title = to.meta.title
  if (title) document.title = title
})
