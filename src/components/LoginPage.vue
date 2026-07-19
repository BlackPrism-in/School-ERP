<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-vue-next'
import { roles, type Role } from '../data'
const props = defineProps<{ initialRole: Role }>()
const emit = defineEmits<{ back:[]; login:[role:Role] }>()
const role = ref<Role>(props.initialRole)
const email = ref('admin@edunova.school')
const password = ref('Demo@123')
const show = ref(false), loading = ref(false), recovery = ref(false)
const credentials: Record<Role,[string,string]> = {superadmin:['principal@edunova.school','Demo@123'],admin:['admin@edunova.school','Demo@123'],teacher:['teacher@edunova.school','Demo@123'],student:['student@edunova.school','Demo@123'],guardian:['guardian@edunova.school','Demo@123']}
const selected = computed(()=>roles.find(r=>r.id===role.value)!)
function select(next:Role){role.value=next;[email.value,password.value]=credentials[next]}
function submit(){loading.value=true;setTimeout(()=>{loading.value=false;emit('login',role.value)},650)}
</script>
<template><div class="login-page"><div class="login-visual"><button class="back-home" @click="emit('back')"><ArrowLeft :size="17"/> Back to website</button><div class="login-quote"><div class="quote-brand"><span>E</span> EduNova</div><h1>School feels simpler<br>when everything connects.</h1><p>One secure home for learning, communication and operations.</p><div class="quote-stats"><span><b>1,248</b><small>Students connected</small></span><span><b>94.2%</b><small>Attendance today</small></span><span><b>4.9/5</b><small>Family satisfaction</small></span></div></div><div class="visual-orb one"></div><div class="visual-orb two"></div></div>
  <main class="login-form-wrap"><div class="login-form"><div class="mobile-login-brand"><span>E</span><strong>EduNova</strong></div><p class="login-kicker">WELCOME BACK</p><h2>Sign in to your workspace</h2><p class="login-sub">Choose a role to explore the complete interactive demo.</p><div class="role-tabs"><button v-for="r in roles" :key="r.id" @click="select(r.id)" :class="{active:role===r.id}"><span>{{r.initials}}</span>{{r.label}}</button></div><form @submit.prevent="submit"><label>Email address<div class="field"><input v-model="email" type="email" required/><CheckCircle2 :size="17"/></div></label><label>Password<div class="field"><input v-model="password" :type="show?'text':'password'" required/><button type="button" @click="show=!show"><EyeOff v-if="show" :size="17"/><Eye v-else :size="17"/></button></div></label><div class="form-row"><label class="remember"><input type="checkbox" checked/> Remember me</label><a href="#" @click.prevent="recovery=true">Forgot password?</a></div><div v-if="recovery" class="recovery-message"><CheckCircle2 :size="15"/> Demo recovery link sent to {{email}}</div><button class="login-submit" :disabled="loading"><span v-if="loading" class="spinner"></span><template v-else>Sign in as {{selected.label}} <ArrowRight :size="17"/></template></button></form><div class="demo-note"><ShieldCheck :size="18"/><span><strong>Demo credentials are prefilled</strong><small>Simply select a role and sign in. No account needed.</small></span></div></div></main></div></template>
