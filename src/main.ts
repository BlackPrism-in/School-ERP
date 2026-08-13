import { createApp } from 'vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { ApiError } from './api/client'
import { clearSession } from './session'
import './style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a rejection the server meant — only transient faults.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

/**
 * A 401 from anywhere means the session ended — expired, revoked, or the user
 * signed out in another tab. Clear the local copy and send them to sign in
 * from one place rather than handling it in every component.
 */
queryClient.getQueryCache().subscribe((event) => {
  const error = event.query.state.error
  if (error instanceof ApiError && error.isUnauthenticated) {
    clearSession()
    if (router.currentRoute.value.meta.requiresAuth) {
      router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    }
  }
})

createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount('#app')
