<script setup lang="ts">
import { ref } from 'vue'
import LandingPage from './components/LandingPage.vue'
import LoginPage from './components/LoginPage.vue'
import Dashboard from './App.vue'
import type { Role } from './data'

type Screen = 'landing' | 'login' | 'app'
const saved = localStorage.getItem('edunova-session') as Role | null
const screen = ref<Screen>(saved ? 'app' : 'landing')
const selectedRole = ref<Role>(saved || 'admin')

function openLogin(role: Role = 'admin') { selectedRole.value = role; screen.value = 'login'; window.scrollTo(0, 0) }
function login(role: Role) { selectedRole.value = role; localStorage.setItem('edunova-session', role); screen.value = 'app' }
function logout() { localStorage.removeItem('edunova-session'); screen.value = 'landing'; window.scrollTo(0, 0) }
</script>

<template>
  <LandingPage v-if="screen==='landing'" @login="openLogin" />
  <LoginPage v-else-if="screen==='login'" :initial-role="selectedRole" @back="screen='landing'" @login="login" />
  <Dashboard v-else :initial-role="selectedRole" @logout="logout" />
</template>
