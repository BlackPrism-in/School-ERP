<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { ChevronDown, LockKeyhole, LogOut, Menu, Search, ShieldAlert, Sparkles, X } from 'lucide-vue-next'
import { auth, dashboard } from '../api/endpoints'
import { clearSession, currentUser, initials, primaryRoleLabel } from '../session'
import { navigationFor, type NavItem } from '../navigation'

const route = useRoute()
const router = useRouter()

const mobileOpen = ref(false)
const query = ref('')
const signingOut = ref(false)

const user = currentUser
const navigation = computed(() =>
  navigationFor(user.value?.permissions ?? [], user.value?.roles ?? []),
)

const grouped = computed(() => {
  const groups: { section: string | null; items: NavItem[] }[] = []
  for (const item of navigation.value) {
    if (item.section || groups.length === 0) {
      groups.push({ section: item.section ?? null, items: [item] })
    } else {
      groups.at(-1)!.items.push(item)
    }
  }
  return groups
})

const { data: summary } = useQuery({
  queryKey: ['dashboard', 'summary'],
  queryFn: dashboard.summary,
  staleTime: 60_000,
})

const sessionName = computed(() => summary.value?.session?.name ?? '—')
const schoolName = computed(() => summary.value?.school?.name ?? 'Loading…')
const schoolInitials = computed(() =>
  (schoolName.value.match(/\b[A-Za-z]/g) ?? ['E']).slice(0, 2).join('').toUpperCase(),
)

const matches = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return []
  return navigation.value.filter((item) => item.label.toLowerCase().includes(term)).slice(0, 6)
})

function isActive(item: NavItem) {
  if (item.to === '/app') return route.path === '/app'
  return route.path.startsWith(item.to)
}

function go(item: NavItem) {
  mobileOpen.value = false
  query.value = ''
  router.push(item.to)
}

async function signOut() {
  signingOut.value = true
  try {
    await auth.logout()
  } catch {
    // Even if the call fails the local session must go — the cookie may
    // already be invalid, and leaving the UI signed in would be worse.
  } finally {
    clearSession()
    signingOut.value = false
    router.replace({ name: 'landing' })
  }
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar mighty-sidebar" :class="{ open: mobileOpen }">
      <div class="brand">
        <div class="brand-mark">E</div>
        <div><strong>EduNova</strong><span>School ERP</span></div>
        <button class="icon-button sidebar-close" @click="mobileOpen = false"><X :size="19" /></button>
      </div>

      <div class="school-card">
        <div class="school-logo">{{ schoolInitials }}</div>
        <div><strong>{{ schoolName }}</strong><span>Session {{ sessionName }}</span></div>
        <ChevronDown :size="15" />
      </div>

      <p class="nav-label">Workspace</p>
      <nav class="sidebar-nav nested-nav">
        <template v-for="(group, gi) in grouped" :key="gi">
          <p v-if="group.section" class="nav-section-title">{{ group.section }}</p>
          <button
            v-for="item in group.items"
            :key="item.id"
            :data-route="item.id"
            :class="{ active: isActive(item), 'nav-planned': item.status === 'planned' }"
            @click="go(item)"
          >
            <component :is="item.icon" :size="18" :stroke-width="1.8" />
            <span>{{ item.label }}</span>
            <LockKeyhole v-if="item.status === 'planned'" class="planned-mark" :size="13" />
          </button>
        </template>
      </nav>

      <div class="help-card">
        <Sparkles :size="19" />
        <strong>Being built in phases</strong>
        <p>Modules marked with a lock are not connected yet. They show what is coming, not sample data.</p>
      </div>

      <button class="collapse" :disabled="signingOut" @click="signOut">
        <LogOut :size="18" /> {{ signingOut ? 'Signing out…' : 'Sign out' }}
      </button>
    </aside>

    <main>
      <header>
        <button class="icon-button mobile-menu" @click="mobileOpen = true"><Menu :size="21" /></button>

        <div class="search">
          <Search :size="18" />
          <input v-model="query" placeholder="Search modules…" />
          <div v-if="matches.length" class="search-results">
            <button v-for="m in matches" :key="m.id" @click="go(m)">
              <component :is="m.icon" :size="15" />
              {{ m.label }}
              <small v-if="m.status === 'planned'">Planned</small>
            </button>
          </div>
        </div>

        <div class="header-actions">
          <span class="session"><span>Session {{ sessionName }}</span></span>
          <RouterLink
            v-if="user?.mfaEnrolmentRequired"
            class="mfa-warning"
            to="/app/security"
            title="Two-factor authentication is not enabled"
          >
            <ShieldAlert :size="17" /> Enable 2FA
          </RouterLink>
          <RouterLink to="/app/security" class="profile profile-static">
            <span class="avatar">{{ initials }}</span>
            <span><strong>{{ user?.displayName }}</strong><small>{{ primaryRoleLabel }}</small></span>
          </RouterLink>
        </div>
      </header>

      <section class="content mighty-content">
        <RouterView />
      </section>
    </main>

    <div v-if="mobileOpen" class="overlay" @click="mobileOpen = false"></div>
  </div>
</template>

<style scoped>
.nav-planned { opacity: 0.55; }
.nav-planned:hover { opacity: 0.8; }
.planned-mark { margin-left: auto; flex: none; opacity: 0.7; }

.search { position: relative; }
.search-results {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 40;
  padding: 6px;
  border-radius: 12px;
  background: var(--surface, #fff);
  border: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14);
}
.search-results button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 9px;
  background: none;
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.search-results button:hover { background: rgba(91, 77, 247, 0.08); }
.search-results small { margin-left: auto; font-size: 0.72rem; opacity: 0.6; }

.mfa-warning {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-radius: 10px;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.3);
  color: #c2410c;
}
.mfa-warning:hover { background: rgba(249, 115, 22, 0.18); }
</style>
