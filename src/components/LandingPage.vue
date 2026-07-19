<script setup lang="ts">
import { ArrowRight, Check, ShieldCheck, BarChart3, Users, GraduationCap, CalendarCheck, CreditCard, MessageSquareText, Sparkles, Menu, X } from 'lucide-vue-next'
import { ref } from 'vue'
import type { Role } from '../data'
const emit = defineEmits<{ login:[role:Role] }>()
const menu = ref(false)
const features = [
  [Users,'Student lifecycle','Admissions, profiles, documents, promotion and alumni in one record.'],
  [CalendarCheck,'Academic operations','Timetables, attendance, leave, assignments and lesson planning.'],
  [GraduationCap,'Exams & results','Exam schedules, marks, report cards and performance analytics.'],
  [CreditCard,'Fees & finance','Fee plans, invoices, online payments, receipts and expense tracking.'],
  [MessageSquareText,'Connected community','Announcements, direct messaging, events and parent updates.'],
  [BarChart3,'Actionable reports','Live dashboards and exportable academic and operational insights.'],
]
</script>
<template>
  <div class="landing">
    <header class="landing-nav"><a class="landing-brand" href="#"><span>E</span><strong>EduNova</strong></a><nav :class="{open:menu}"><a href="#features" @click="menu=false">Features</a><a href="#roles" @click="menu=false">For everyone</a><a href="#security" @click="menu=false">Security</a><button class="nav-login" @click="emit('login','admin')">Sign in</button><button class="nav-demo" @click="emit('login','admin')">Explore live demo <ArrowRight :size="15"/></button></nav><button class="landing-menu" @click="menu=!menu"><X v-if="menu"/><Menu v-else/></button></header>
    <main>
      <section class="hero"><div class="hero-copy"><div class="hero-tag"><Sparkles :size="14"/> A smarter school starts here</div><h1>One connected campus.<br><em>Every learner thriving.</em></h1><p>EduNova brings academics, people, finance and communication together—so your team spends less time managing systems and more time shaping futures.</p><div class="hero-actions"><button @click="emit('login','admin')">Explore interactive demo <ArrowRight :size="17"/></button><a href="#features">See all features</a></div><div class="hero-proof"><span><Check :size="14"/> No setup required</span><span><Check :size="14"/> Four role demos</span><span><Check :size="14"/> Real workflows</span></div></div>
        <div class="hero-visual"><div class="visual-glow"></div><div class="demo-window"><div class="window-top"><i></i><i></i><i></i><span>EduNova Academy · Dashboard</span></div><div class="mini-shell"><div class="mini-side"><b>E</b><span v-for="n in 7" :key="n" :class="{on:n===1}"></span></div><div class="mini-main"><div class="mini-head"><span></span><i></i><i></i></div><div class="mini-greeting"><small>GOOD MORNING</small><strong>Your school, at a glance.</strong></div><div class="mini-stats"><div v-for="(n,i) in ['1,248','94.2%','₹18.4L','86']" :key="n"><i :class="'c'+i"></i><small>{{['Students','Attendance','Fees','Teachers'][i]}}</small><b>{{n}}</b></div></div><div class="mini-panels"><div class="mini-chart"><b>Attendance overview</b><span v-for="h in [48,65,57,78,70,52]" :style="{height:h+'%'}"></span></div><div class="mini-list"><b>Today’s schedule</b><span v-for="n in 4" :key="n"><i></i><em></em></span></div></div></div></div></div><div class="floating-card fc-one"><span>✓</span><div><b>96%</b><small>Student attendance</small></div></div><div class="floating-card fc-two"><span>↗</span><div><b>+12.8%</b><small>Academic growth</small></div></div></div>
      </section>
      <section class="trust"><p>Built for the whole school community</p><div><span>School leaders</span><span>Teachers</span><span>Students</span><span>Families</span><span>Operations teams</span></div></section>
      <section id="features" class="landing-section"><div class="section-kicker">Everything in one place</div><h2>Less administration. More education.</h2><p class="section-intro">Thoughtfully designed tools that work together across your entire institution.</p><div class="feature-grid"><article v-for="(f,i) in features" :key="i"><div><component :is="f[0]" :size="22"/></div><h3>{{f[1]}}</h3><p>{{f[2]}}</p><a @click.prevent="emit('login','admin')" href="#">Explore module <ArrowRight :size="14"/></a></article></div></section>
      <section id="roles" class="roles-section"><div><div class="section-kicker">Made for every role</div><h2>One platform.<br>Five focused experiences.</h2><p>Every person sees exactly what they need—without the clutter.</p></div><div class="role-cards"><button v-for="r in ([['superadmin','Super Admin','Govern the institution, approve and audit.'],['admin','Administrator','Control daily operations, people and records.'],['teacher','Teacher','Plan, teach, assess and communicate.'],['student','Student','Learn, submit and track progress.'],['guardian','Guardian','Stay informed and support growth.']] as const)" :key="r[0]" @click="emit('login',r[0])"><span>{{r[1].charAt(0)}}</span><div><strong>{{r[1]}}</strong><p>{{r[2]}}</p><small>Open demo <ArrowRight :size="13"/></small></div></button></div></section>
      <section id="security" class="security"><div><ShieldCheck :size="30"/><span><strong>Secure by design</strong><small>Role-based access · Audit trails · Data isolation · Encrypted records</small></span></div><button @click="emit('login','admin')">Experience EduNova <ArrowRight :size="16"/></button></section>
    </main>
    <footer><a class="landing-brand"><span>E</span><strong>EduNova</strong></a><p>Modern school management, thoughtfully connected.</p><small>© 2026 EduNova Technologies</small></footer>
  </div>
</template>
