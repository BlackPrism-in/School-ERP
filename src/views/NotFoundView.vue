<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { isAuthenticated } from '../session'
</script>

<template>
  <div class="notfound">
    <p class="code">404</p>
    <h1>That page doesn’t exist</h1>
    <p class="body">The link may be out of date, or the page may have moved.</p>
    <RouterLink :to="isAuthenticated ? '/app' : '/'">
      {{ isAuthenticated ? 'Back to dashboard' : 'Back to home' }}
    </RouterLink>
  </div>
</template>

<style scoped>
.notfound {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 100vh;
  padding: 24px;
  text-align: center;
}
.code { margin: 0; font-size: 3.4rem; font-weight: 800; opacity: 0.18; }
h1 { margin: 0; }
.body { margin: 0; opacity: 0.68; }
.notfound a {
  margin-top: 14px;
  padding: 11px 20px;
  border-radius: 11px;
  text-decoration: none;
  font-weight: 600;
  background: var(--brand, #5b4df7);
  color: #fff;
}
</style>
