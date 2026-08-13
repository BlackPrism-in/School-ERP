<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Users, UserCog, LayoutGrid, ArrowRight, ShieldAlert, Plus } from 'lucide-vue-next'
import { dashboard } from '../api/endpoints'
import { can, currentUser, primaryRoleLabel } from '../session'
import { navigationFor } from '../navigation'
import LoadingPanel from '../components/LoadingPanel.vue'
import ErrorPanel from '../components/ErrorPanel.vue'

const user = currentUser

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: ['dashboard', 'summary'],
  queryFn: dashboard.summary,
  staleTime: 60_000,
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  // Use the whole display name. Taking the first token turns an account
  // named "School Administrator" into "Good morning, School".
  const name = user.value?.displayName?.trim() ?? ''
  return `${part}${name ? `, ${name}` : ''}`
})

/** Only figures the server actually returned. Nothing is estimated or invented. */
const stats = computed(() => {
  const summary = data.value
  if (!summary) return []
  const cards: { label: string; value: string; note: string; tone: string; icon: typeof Users }[] = []

  if (summary.students) {
    cards.push({
      label: 'Students',
      value: String(summary.students.total),
      note: `${summary.students.active} active`,
      tone: 'violet',
      icon: Users,
    })
  }
  if (summary.staff) {
    cards.push({
      label: 'Staff',
      value: String(summary.staff.total),
      note: 'Currently active',
      tone: 'blue',
      icon: UserCog,
    })
  }
  if (summary.sections) {
    cards.push({
      label: 'Sections',
      value: String(summary.sections.total),
      note: `Session ${summary.session?.name ?? '—'}`,
      tone: 'green',
      icon: LayoutGrid,
    })
  }
  return cards
})

const upcoming = computed(() =>
  navigationFor(user.value?.permissions ?? [], user.value?.roles ?? [])
    .filter((item) => item.status === 'planned' && item.phase === 'mvp')
    .slice(0, 4),
)

const isEmpty = computed(() => data.value?.students?.total === 0)
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">{{ primaryRoleLabel }}<template v-if="data?.session"> · Session {{ data.session.name }}</template></p>
      <h1>{{ greeting }}</h1>
      <p>Here’s what EduNova can show you today.</p>
    </div>
    <div v-if="can('student.write')" class="page-actions">
      <RouterLink class="primary" to="/app/students?new=1"><Plus :size="17" /> Add student</RouterLink>
    </div>
  </div>

  <div v-if="user?.mfaEnrolmentRequired" class="mfa-callout">
    <ShieldAlert :size="20" />
    <div>
      <strong>Turn on two-factor authentication</strong>
      <p>Your account can read every student record in the school. A password alone should not be enough to reach it.</p>
    </div>
    <RouterLink to="/app/security">Set it up <ArrowRight :size="15" /></RouterLink>
  </div>

  <LoadingPanel v-if="isPending" label="Loading your dashboard…" />
  <ErrorPanel v-else-if="isError" :error="error" @retry="refetch" />

  <template v-else>
    <div v-if="stats.length" class="stats-grid">
      <article v-for="stat in stats" :key="stat.label" class="stat-card">
        <div class="stat-top">
          <span :class="['stat-icon', stat.tone]"><component :is="stat.icon" :size="20" /></span>
        </div>
        <p>{{ stat.label }}</p>
        <h2>{{ stat.value }}</h2>
        <span class="trend-plain">{{ stat.note }}</span>
      </article>
    </div>

    <div v-if="isEmpty" class="empty-state">
      <Users :size="34" />
      <h3>No students yet</h3>
      <p>Once students are added, this dashboard fills in with real figures from your school.</p>
      <RouterLink v-if="can('student.write')" class="primary" to="/app/students?new=1">
        <Plus :size="16" /> Add your first student
      </RouterLink>
    </div>

    <article v-if="upcoming.length" class="panel roadmap-panel">
      <div class="panel-head">
        <div>
          <h3>Being built next</h3>
          <p>These modules are designed and their database tables exist — the screens are not connected yet.</p>
        </div>
      </div>
      <ul class="roadmap-list">
        <li v-for="item in upcoming" :key="item.id">
          <span class="roadmap-icon"><component :is="item.icon" :size="17" /></span>
          <div>
            <strong>{{ item.label }}</strong>
            <p>{{ item.summary }}</p>
          </div>
        </li>
      </ul>
    </article>
  </template>
</template>

<style scoped>
.trend-plain { font-size: 0.82rem; opacity: 0.62; }

.mfa-callout {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 22px;
  padding: 16px 18px;
  border-radius: 14px;
  background: rgba(249, 115, 22, 0.09);
  border: 1px solid rgba(249, 115, 22, 0.26);
  color: #9a3412;
}
.mfa-callout > svg { flex: none; }
.mfa-callout strong { display: block; margin-bottom: 3px; }
.mfa-callout p { margin: 0; font-size: 0.87rem; line-height: 1.45; opacity: 0.9; }
.mfa-callout a {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 15px;
  border-radius: 10px;
  font-size: 0.86rem;
  font-weight: 600;
  text-decoration: none;
  background: #ea580c;
  color: #fff;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  margin: 26px 0;
  padding: 46px 24px;
  text-align: center;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.42);
}
.empty-state svg { opacity: 0.4; }
.empty-state h3 { margin: 6px 0 0; }
.empty-state p { margin: 0; max-width: 400px; opacity: 0.7; line-height: 1.55; }
.empty-state .primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  background: var(--brand, #5b4df7);
  color: #fff;
}

.roadmap-panel { margin-top: 24px; }
.roadmap-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.roadmap-list li {
  display: flex;
  gap: 13px;
  align-items: flex-start;
  padding: 13px 4px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}
.roadmap-list li:first-child { border-top: none; }
.roadmap-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: rgba(91, 77, 247, 0.1);
  color: #5b4df7;
}
.roadmap-list strong { display: block; margin-bottom: 2px; font-size: 0.92rem; }
.roadmap-list p { margin: 0; font-size: 0.85rem; line-height: 1.5; opacity: 0.68; }

.page-actions .primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  text-decoration: none;
}
</style>
