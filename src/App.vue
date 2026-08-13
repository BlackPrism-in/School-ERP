<script setup lang="ts">
import { RouterView } from 'vue-router'
import { sessionLoading } from './session'
</script>

<template>
  <!--
    The router resolves the session on first navigation, so hold the first
    paint briefly rather than flashing the landing page at someone who is
    already signed in.
  -->
  <div v-if="sessionLoading" class="boot">
    <div class="boot-mark">E</div>
    <span class="boot-bar"><i></i></span>
  </div>
  <RouterView v-else />
</template>

<style scoped>
.boot {
  display: grid;
  place-items: center;
  gap: 20px;
  min-height: 100vh;
}
.boot-mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  font-size: 1.3rem;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #6d5cf7, #4c3ce8);
}
.boot-bar {
  display: block;
  width: 120px;
  height: 3px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.22);
}
.boot-bar i {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 3px;
  background: #5b4df7;
  animation: slide 1s ease-in-out infinite;
}
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
@media (prefers-reduced-motion: reduce) {
  .boot-bar i { animation: none; width: 100%; }
}
</style>
