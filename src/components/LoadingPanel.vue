<script setup lang="ts">
defineProps<{ label?: string; rows?: number }>()
</script>

<template>
  <div class="loading-panel" role="status" aria-live="polite">
    <div v-for="n in (rows ?? 3)" :key="n" class="skeleton-row">
      <span class="skeleton" style="width: 38%"></span>
      <span class="skeleton" style="width: 22%"></span>
      <span class="skeleton" style="width: 16%"></span>
    </div>
    <p v-if="label">{{ label }}</p>
  </div>
</template>

<style scoped>
.loading-panel { padding: 20px 0; }
.skeleton-row { display: flex; gap: 14px; margin-bottom: 14px; }
.skeleton {
  height: 13px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(148,163,184,0.16) 25%, rgba(148,163,184,0.28) 50%, rgba(148,163,184,0.16) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.3s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}
.loading-panel p { margin: 14px 0 0; font-size: 0.85rem; opacity: 0.6; }
</style>
