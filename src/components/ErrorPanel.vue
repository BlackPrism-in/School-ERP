<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-vue-next'
import { ApiError } from '../api/client'

const props = defineProps<{ error: unknown; context?: string }>()
defineEmits<{ retry: [] }>()

const isOffline = computed(() => props.error instanceof ApiError && props.error.code === 'network_error')

const message = computed(() => {
  if (props.error instanceof ApiError) return props.error.message
  return 'Something went wrong while loading this.'
})
</script>

<template>
  <div class="error-panel" role="alert">
    <component :is="isOffline ? WifiOff : AlertTriangle" :size="26" />
    <div>
      <strong>{{ isOffline ? 'Cannot reach the server' : (context ?? 'Could not load this') }}</strong>
      <p>{{ message }}</p>
    </div>
    <button @click="$emit('retry')"><RefreshCw :size="15" /> Try again</button>
  </div>
</template>

<style scoped>
.error-panel {
  display: flex;
  gap: 14px;
  align-items: center;
  margin: 18px 0;
  padding: 18px 20px;
  border-radius: 14px;
  background: rgba(220, 38, 38, 0.07);
  border: 1px solid rgba(220, 38, 38, 0.24);
  color: #991b1b;
}
.error-panel > svg { flex: none; }
.error-panel strong { display: block; margin-bottom: 3px; }
.error-panel p { margin: 0; font-size: 0.87rem; line-height: 1.45; opacity: 0.9; }
.error-panel button {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px;
  border: 1px solid rgba(220, 38, 38, 0.32);
  border-radius: 10px;
  background: #fff;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: #991b1b;
  cursor: pointer;
}
.error-panel button:hover { background: rgba(220, 38, 38, 0.06); }
</style>
