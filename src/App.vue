<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, Bell, ChevronDown, PanelLeftClose, Plus, ArrowUpRight, MoreHorizontal, Clock3, MapPin, CheckCircle2, Circle, Download, CalendarDays, Sparkles, Menu, X, LogOut } from 'lucide-vue-next'
import { menu, roles, roleData, type Role } from './data'
import ModuleView from './components/ModuleView.vue'
import TasksWidget from './components/TasksWidget.vue'
import SpecializedModule from './components/SpecializedModule.vue'
import RoleWorkspace from './components/RoleWorkspace.vue'

const props = defineProps<{ initialRole?: Role }>()
const emit = defineEmits<{ logout:[] }>()
const role = ref<Role>(props.initialRole || 'admin')
const active = ref('Dashboard')
const mobileOpen = ref(false)
const notifyOpen = ref(false)
const globalQuery = ref('')
const appToast = ref('')
const currentRole = computed(() => roles.find(r => r.id === role.value)!)
const visibleMenu = computed(() => menu.filter(item => item.roles.includes(role.value)))
const content = computed(() => roleData[role.value])
const roleNotifications=computed(()=>({superadmin:[['Approval Center','✅','3 requests awaiting approval','Admissions and payroll require a decision'],['Reports','📊','Weekly governance report','Ready for review']],admin:[['Admissions','🎓','2 applications need verification','Documents received today'],['Messages','✉️','Message from Dr. Wilson','Admission returned with comments']],teacher:[['Assignments','📝','12 submissions to review','Science · Grade 9 B'],['Messages','✉️','Message from Priya Mehta','10 minutes ago']],student:[['Assignments','📚','English assignment due','25 July · 11:59 PM'],['Library','📖','Library book due soon','The Alchemist · 24 July']],guardian:[['Fees & Finance','₹','Aarav’s fee payment is due','₹12,500 · Due 28 July'],['Messages','✉️','Update from Maya Thomas','Aarav’s mathematics progress']]} as Record<Role,string[][]>)[role.value])
const todaySchedule=computed(()=>({superadmin:[['09:00','Leadership briefing','Principal office'],['11:30','Admission approvals','Conference room'],['02:00','School board review','Board room']],admin:[['08:30','Admissions desk review','Admin office'],['10:15','Fee reconciliation','Accounts office'],['01:30','Staff operations meeting','Conference room']],teacher:[['08:30','Biology · Grade 10 A','Room 204'],['10:15','Science · Grade 9 B','Lab 2'],['01:30','Science · Grade 8 A','Room 108']],student:[['08:30','Mathematics','Room 204'],['09:15','English Literature','Room 204'],['10:15','Science','Lab 2'],['01:30','Computer Science','IT Lab']],guardian:[['07:18','Aarav bus pickup','Green Park'],['03:42','Aarav bus drop','Green Park'],['05:30','PTM confirmation due','Online']]} as Record<Role,string[][]>)[role.value])
function showToast(message:string){appToast.value=message;setTimeout(()=>appToast.value='',2200)}
function quickAction(){ active.value = role.value==='teacher'?'Assignments':role.value==='admin'?'People':'Timetable' }
function exportDashboard(){const data='Metric,Value\n'+content.value.stats.map(s=>`"${s[0]}","${s[1]}"`).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'text/csv'}));a.download='edunova-dashboard.csv';a.click();showToast('Dashboard exported')}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ open: mobileOpen }">
      <div class="brand"><div class="brand-mark">E</div><div><strong>EduNova</strong><span>School ERP</span></div><button class="icon-button sidebar-close" @click="mobileOpen=false"><X :size="19" /></button></div>
      <div class="school-card"><div class="school-logo">EA</div><div><strong>EduNova Academy</strong><span>CBSE · New Delhi</span></div><ChevronDown :size="15" /></div>
      <p class="nav-label">Workspace</p>
      <nav class="sidebar-nav">
        <button v-for="item in visibleMenu" :key="item.label" :class="{ active: active === item.label }" @click="active=item.label;mobileOpen=false">
          <component :is="item.icon" :size="19" :stroke-width="1.8"/><span>{{ item.label }}</span><span v-if="item.label==='Messages'" class="nav-badge">4</span>
        </button>
      </nav>
      <div class="help-card"><Sparkles :size="19"/><strong>Interactive demo</strong><p>Every module includes working records and actions.</p><button @click="active='Messages'">Contact support</button></div>
      <button class="collapse" @click="emit('logout')"><LogOut :size="18"/> Sign out</button>
    </aside>

    <main>
      <header>
        <button class="icon-button mobile-menu" @click="mobileOpen=true"><Menu :size="21"/></button>
        <div class="search"><Search :size="18"/><input v-model="globalQuery" placeholder="Search students, classes, reports…" @keyup.enter="active=globalQuery.toLowerCase().includes('fee')?'Fees & Finance':globalQuery.toLowerCase().includes('student')?'People':'Reports';globalQuery=''"/><kbd>Enter</kbd></div>
        <div class="header-actions"><button class="session" @click="showToast('Academic session: 2026–27')"><CalendarDays :size="17"/> 2026–27 <ChevronDown :size="14"/></button><div class="notification-wrap"><button class="icon-button notification" @click="notifyOpen=!notifyOpen"><Bell :size="20"/><i></i></button><div v-if="notifyOpen" class="notification-panel"><div><strong>Notifications</strong><button @click="showToast('All notifications marked as read');notifyOpen=false">Mark all read</button></div><button v-for="n in roleNotifications" :key="n[2]" @click="active=n[0];notifyOpen=false"><span class="notif-icon">{{n[1]}}</span><span><strong>{{n[2]}}</strong><small>{{n[3]}}</small></span></button></div></div>
          <div class="role-wrap"><div class="profile profile-static"><span class="avatar">{{ currentRole.initials }}</span><span><strong>{{ currentRole.name }}</strong><small>{{ currentRole.label }}</small></span></div></div>
        </div>
      </header>

      <section class="content">
        <template v-if="active==='Dashboard'">
          <div class="page-head"><div><p class="eyebrow">Sunday, 19 July</p><h1>{{content.greeting}} <span>👋</span></h1><p>{{content.subtitle}}</p></div><div class="page-actions"><button class="secondary" @click="exportDashboard"><Download :size="17"/> Export</button><button class="primary" @click="quickAction"><Plus :size="17"/> {{role==='teacher'?'Create assignment':role==='admin'?'Quick add':'View calendar'}}</button></div></div>
          <div class="stats-grid"><article v-for="(stat,i) in content.stats" :key="stat[0]" class="stat-card"><div class="stat-top"><span :class="['stat-icon',stat[3]]"><component :is="visibleMenu[(i+1)%visibleMenu.length].icon" :size="20"/></span><button @click="showToast(stat[0]+': '+stat[1])"><MoreHorizontal :size="19"/></button></div><p>{{stat[0]}}</p><h2>{{stat[1]}}</h2><span class="trend"><ArrowUpRight :size="14"/>{{stat[2]}}</span></article></div>
          <div class="dashboard-grid">
            <article class="panel attendance-panel"><div class="panel-head"><div><h3>{{role==='admin'?'Attendance overview':role==='teacher'?'Class attendance':'Attendance trend'}}</h3><p>Weekly presence across the current term</p></div><select><option>This week</option><option>This month</option></select></div><div class="chart"><div class="chart-y"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="bars"><div v-for="(h,i) in [82,91,87,96,92,76]" :key="i" class="bar-wrap"><div class="bar-track"><div class="bar" :style="{height:h+'%'}"><span>{{h}}%</span></div></div><small>{{['Mon','Tue','Wed','Thu','Fri','Sat'][i]}}</small></div></div></div><div class="legend"><span><i class="present"></i>Present 94.2%</span><span><i class="absent"></i>Absent 5.8%</span></div></article>
            <article class="panel schedule"><div class="panel-head"><div><h3>Today’s schedule</h3><p>{{todaySchedule.length}} activities planned</p></div><button class="text-button" @click="active='Timetable'">View all</button></div><div class="timeline"><div v-for="(event,i) in todaySchedule" :key="event[0]" class="event" :class="{muted:i===2}"><div class="event-time">{{event[0]}}<span>{{Number(event[0].split(':')[0])>=7?'AM':'PM'}}</span></div><i></i><div><strong>{{event[1]}}</strong><span><MapPin :size="13"/>{{event[2]}}</span></div></div></div></article>
            <TasksWidget :role="role" />
            <article class="panel announcements"><div class="panel-head"><div><h3>Announcements</h3><p>Latest school updates</p></div><button class="text-button" @click="active='Announcements'">View all</button></div><div class="announcement"><div class="announce-icon violet">🎓</div><div><strong>Annual Sports Day 2026</strong><p>Registrations are open until 24 July. Students can enroll through their class teacher.</p><span>2 hours ago · All school</span></div></div><div class="announcement"><div class="announce-icon orange">📚</div><div><strong>Library maintenance</strong><p>The senior library will remain closed this Saturday.</p><span>Yesterday · Grades 9–12</span></div></div></article>
          </div>
        </template>
        <SpecializedModule v-else-if="['Timetable','Attendance','Messages'].includes(active)" :key="active+'-'+role" :title="active" :role="role" />
        <RoleWorkspace v-else-if="['User Accounts','My Classes','My Learning','My Children','Settings'].includes(active)" :key="active+'-'+role" :title="active" :role="role" @navigate="active=$event" />
        <ModuleView v-else :key="active+'-'+role" :title="active" :role="role" />
      </section>
    </main>
    <div v-if="mobileOpen" class="overlay" @click="mobileOpen=false"></div>
    <Transition name="toast"><div v-if="appToast" class="app-toast"><CheckCircle2 :size="18"/>{{appToast}}</div></Transition>
  </div>
</template>
