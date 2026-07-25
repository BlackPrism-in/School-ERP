<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-vue-next'
import { roles, roleData, type Role } from './data'
import MightyAdminWorkflow from './components/MightyAdminWorkflow.vue'
import MightyRolePortal from './components/MightyRolePortal.vue'
import TasksWidget from './components/TasksWidget.vue'
import { flattenNavigation, navigationForRole, type MightyNavItem } from './mightyNavigation'

const props = defineProps<{ initialRole?: Role }>()
const emit = defineEmits<{ logout: [] }>()

const role = ref<Role>(props.initialRole || 'admin')
const active = ref('dashboard')
const mobileOpen = ref(false)
const notifyOpen = ref(false)
const globalQuery = ref('')
const appToast = ref('')
const expandedGroups = ref<string[]>([])

const currentRole = computed(() => roles.find((item) => item.id === role.value)!)
const navigation = computed(() => navigationForRole(role.value))
const flatNavigation = computed(() => flattenNavigation(navigation.value))
const activeItem = computed(() => flatNavigation.value.find((item) => item.id === active.value))
const content = computed(() => roleData[role.value])
const isPortalRole = computed(() => role.value === 'student' || role.value === 'guardian')
const dashboardIcons = computed(() => navigation.value.filter((item) => item.icon).slice(0, 4))

const roleNotifications = computed(() => {
  const notifications: Record<Role, { route: string; title: string; detail: string }[]> = {
    superadmin: [
      { route: 'student-migration', title: '3 migration requests are pending', detail: 'Student Information' },
      { route: 'fee-monthly-report', title: 'Monthly fee report is ready', detail: 'Fees Reports' },
    ],
    admin: [
      { route: 'student-list', title: '2 student records need verification', detail: 'Student Information' },
      { route: 'smart-collection', title: 'Fee collection needs reconciliation', detail: 'Fees Management' },
    ],
    teacher: [
      { route: 'assignments', title: '12 submissions need review', detail: 'Assignments' },
      { route: 'mark-input', title: 'Term marks are ready for entry', detail: 'Exam Management' },
    ],
    student: [
      { route: 'student-assignment', title: 'Science assignment is due', detail: '29 July 2026' },
      { route: 'student-library', title: 'A library book is overdue', detail: 'The Alchemist' },
    ],
    guardian: [
      { route: 'parent-fee-payment', title: 'Aarav’s fee payment is due', detail: '₹12,500 · 28 July' },
      { route: 'parent-exams', title: 'Term result has been published', detail: 'View marks and grade' },
    ],
  }
  return notifications[role.value]
})

const todaySchedule = computed(() => {
  const schedules: Record<Role, string[][]> = {
    superadmin: [
      ['09:00', 'Leadership briefing', 'Principal office'],
      ['11:30', 'Student migration review', 'Conference room'],
      ['14:00', 'School board review', 'Board room'],
    ],
    admin: [
      ['08:30', 'Student records review', 'Admin office'],
      ['10:15', 'Fee reconciliation', 'Accounts office'],
      ['13:30', 'Staff operations meeting', 'Conference room'],
    ],
    teacher: [
      ['08:30', 'Biology · Grade 10 A', 'Room 204'],
      ['10:15', 'Science · Grade 9 B', 'Lab 2'],
      ['13:30', 'Science · Grade 8 A', 'Room 108'],
    ],
    student: [],
    guardian: [],
  }
  return schedules[role.value]
})

function showToast(message: string) {
  appToast.value = message
  window.setTimeout(() => {
    if (appToast.value === message) appToast.value = ''
  }, 2200)
}

function containsActive(item: MightyNavItem) {
  return item.id === active.value || Boolean(item.children?.some((child) => child.id === active.value))
}

function toggleGroup(id: string) {
  expandedGroups.value = expandedGroups.value.includes(id)
    ? expandedGroups.value.filter((item) => item !== id)
    : [...expandedGroups.value, id]
}

function openRoute(route: string, parent?: string) {
  active.value = route
  if (parent && !expandedGroups.value.includes(parent)) expandedGroups.value.push(parent)
  mobileOpen.value = false
  notifyOpen.value = false
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function openNotification(route: string) {
  const parent = navigation.value.find((item) => item.children?.some((child) => child.id === route))
  openRoute(route, parent?.id)
}

function quickAction() {
  if (role.value === 'teacher') openRoute('assignments', 'routine-management')
  else openRoute('student-list', 'student-information')
}

function exportDashboard() {
  const data = `Metric,Value\n${content.value.stats.map((stat) => `"${stat[0]}","${stat[1]}"`).join('\n')}`
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${role.value}-dashboard.csv`
  link.click()
  URL.revokeObjectURL(url)
  showToast('Dashboard exported')
}

function runGlobalSearch() {
  const term = globalQuery.value.trim().toLowerCase()
  if (!term) return
  const match = flatNavigation.value.find((item) => item.label.toLowerCase().includes(term))
  globalQuery.value = ''
  if (!match) {
    showToast(`No feature found for “${term}”`)
    return
  }
  if (match.children?.length) {
    toggleGroup(match.id)
    openRoute(match.children[0].id, match.id)
    return
  }
  const parent = navigation.value.find((item) => item.children?.some((child) => child.id === match.id))
  openRoute(match.id, parent?.id)
  showToast(`Opened ${match.label}`)
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
        <div class="school-logo">EA</div>
        <div><strong>EduNova Academy</strong><span>CBSE · New Delhi</span></div>
        <ChevronDown :size="15" />
      </div>

      <p class="nav-label">{{ isPortalRole ? `${currentRole.label} Portal` : 'Workspace' }}</p>
      <nav class="sidebar-nav nested-nav">
        <template v-for="item in navigation" :key="item.id">
          <p v-if="item.section" class="nav-section-title">{{ item.section }}</p>

          <button
            v-if="!item.children"
            :data-route="item.id"
            :class="{ active: active === item.id }"
            @click="openRoute(item.id)"
          >
            <component :is="item.icon" :size="18" :stroke-width="1.8" />
            <span>{{ item.label }}</span>
          </button>

          <div v-else class="nav-group" :class="{ open: expandedGroups.includes(item.id), current: containsActive(item) }">
            <button class="nav-group-trigger" :data-group="item.id" @click="toggleGroup(item.id)">
              <component :is="item.icon" :size="18" :stroke-width="1.8" />
              <span>{{ item.label }}</span>
              <ChevronRight class="nav-chevron" :size="15" />
            </button>
            <div v-show="expandedGroups.includes(item.id)" class="nav-children">
              <button
                v-for="child in item.children"
                :key="child.id"
                :data-route="child.id"
                :class="{ active: active === child.id }"
                @click="openRoute(child.id, item.id)"
              >
                <i></i><span>{{ child.label }}</span>
              </button>
            </div>
          </div>
        </template>
      </nav>

      <div class="help-card">
        <Sparkles :size="19" />
        <strong>{{ isPortalRole ? 'Need help?' : 'Mighty feature flow' }}</strong>
        <p>{{ isPortalRole ? 'Check notices and contact your school office.' : 'Every visible route follows your assigned role permissions.' }}</p>
        <button @click="openRoute(isPortalRole ? (role === 'guardian' ? 'parent-notice' : 'student-notice') : (flatNavigation.some(item => item.id === 'chatgpt') ? 'chatgpt' : 'notice'))">
          {{ isPortalRole ? 'View notices' : 'Open support' }}
        </button>
      </div>
      <button class="collapse" @click="emit('logout')"><LogOut :size="18" /> Sign out</button>
    </aside>

    <main>
      <header>
        <button class="icon-button mobile-menu" @click="mobileOpen = true"><Menu :size="21" /></button>
        <div class="search">
          <Search :size="18" />
          <input v-model="globalQuery" :placeholder="`Search ${currentRole.label.toLowerCase()} features…`" @keyup.enter="runGlobalSearch" />
          <kbd>Enter</kbd>
        </div>
        <div class="header-actions">
          <button class="session" @click="showToast('Academic session: 2026–27')"><CalendarDays :size="17" /> 2026–27 <ChevronDown :size="14" /></button>
          <div class="notification-wrap">
            <button class="icon-button notification" @click="notifyOpen = !notifyOpen"><Bell :size="20" /><i></i></button>
            <div v-if="notifyOpen" class="notification-panel">
              <div><strong>Notifications</strong><button @click="showToast('All notifications marked as read'); notifyOpen = false">Mark all read</button></div>
              <button v-for="notice in roleNotifications" :key="notice.title" @click="openNotification(notice.route)">
                <span class="notif-icon"><Bell :size="16" /></span>
                <span><strong>{{ notice.title }}</strong><small>{{ notice.detail }}</small></span>
              </button>
            </div>
          </div>
          <div class="role-wrap">
            <div class="profile profile-static">
              <span class="avatar">{{ currentRole.initials }}</span>
              <span><strong>{{ currentRole.name }}</strong><small>{{ currentRole.label }}</small></span>
            </div>
          </div>
        </div>
      </header>

      <section class="content mighty-content">
        <MightyRolePortal
          v-if="isPortalRole"
          :key="`${role}-${active}`"
          :route="active"
          :role="role"
          @navigate="openRoute"
        />

        <template v-else-if="active === 'dashboard'">
          <div class="page-head">
            <div>
              <p class="eyebrow">Academic session 2026–27</p>
              <h1>{{ content.greeting }}</h1>
              <p>{{ content.subtitle }}</p>
            </div>
            <div class="page-actions">
              <button class="secondary" @click="exportDashboard"><Download :size="17" /> Export</button>
              <button class="primary" @click="quickAction"><Plus :size="17" /> {{ role === 'teacher' ? 'Create assignment' : 'Add student' }}</button>
            </div>
          </div>

          <div class="stats-grid">
            <article v-for="(stat, index) in content.stats" :key="stat[0]" class="stat-card">
              <div class="stat-top">
                <span :class="['stat-icon', stat[3]]"><component :is="dashboardIcons[index % dashboardIcons.length]?.icon" :size="20" /></span>
                <button @click="showToast(`${stat[0]}: ${stat[1]}`)"><MoreHorizontal :size="19" /></button>
              </div>
              <p>{{ stat[0] }}</p><h2>{{ stat[1] }}</h2>
              <span class="trend"><ArrowUpRight :size="14" />{{ stat[2] }}</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <article class="panel attendance-panel">
              <div class="panel-head">
                <div><h3>{{ role === 'teacher' ? 'Class attendance' : 'Attendance overview' }}</h3><p>Weekly presence across the current term</p></div>
                <button class="text-button" @click="openRoute('attendance-report', 'student-attendance-management')">View report</button>
              </div>
              <div class="chart">
                <div class="chart-y"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
                <div class="bars">
                  <div v-for="(height, index) in [82, 91, 87, 96, 92, 76]" :key="index" class="bar-wrap">
                    <div class="bar-track"><div class="bar" :style="{ height: `${height}%` }"><span>{{ height }}%</span></div></div>
                    <small>{{ ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index] }}</small>
                  </div>
                </div>
              </div>
              <div class="legend"><span><i class="present"></i>Present 94.2%</span><span><i class="absent"></i>Absent 5.8%</span></div>
            </article>

            <article class="panel schedule">
              <div class="panel-head">
                <div><h3>Today’s schedule</h3><p>{{ todaySchedule.length }} activities planned</p></div>
                <button class="text-button" @click="openRoute('class-routine', 'routine-management')">View all</button>
              </div>
              <div class="timeline">
                <div v-for="(event, index) in todaySchedule" :key="event[0]" class="event" :class="{ muted: index === 2 }">
                  <div class="event-time">{{ event[0] }}</div><i></i>
                  <div><strong>{{ event[1] }}</strong><span><MapPin :size="13" />{{ event[2] }}</span></div>
                </div>
              </div>
            </article>

            <TasksWidget :role="role" />
            <article class="panel announcements">
              <div class="panel-head">
                <div><h3>Notices & events</h3><p>Latest school updates</p></div>
                <button class="text-button" @click="openRoute('notice', 'administrator')">View all</button>
              </div>
              <div class="announcement"><div class="announce-icon violet">SD</div><div><strong>Annual Sports Day 2026</strong><p>Registrations are open until 30 July through the school office.</p><span>25 July · All school</span></div></div>
              <div class="announcement"><div class="announce-icon orange">LB</div><div><strong>Library maintenance</strong><p>The senior library will remain closed this Saturday.</p><span>24 July · Grades 9–12</span></div></div>
            </article>
          </div>
        </template>

        <MightyAdminWorkflow v-else :key="`${role}-${active}`" :route="active" :role="role" />
      </section>
    </main>

    <div v-if="mobileOpen" class="overlay" @click="mobileOpen = false"></div>
    <Transition name="toast"><div v-if="appToast" class="app-toast"><CheckCircle2 :size="18" />{{ appToast }}</div></Transition>
  </div>
</template>
