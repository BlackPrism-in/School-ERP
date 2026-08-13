<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowLeft, Construction, Database, ShieldCheck } from 'lucide-vue-next'
import { findNavItem } from '../navigation'

const route = useRoute()
const item = computed(() => findNavItem(String(route.params.key)))
</script>

<template>
  <RouterLink to="/app" class="back-link"><ArrowLeft :size="16" /> Dashboard</RouterLink>

  <div class="page-head">
    <div>
      <p class="eyebrow">Not connected yet</p>
      <h1>{{ item?.label ?? 'Module' }}</h1>
      <p>{{ item?.summary ?? 'This module is planned but not yet built.' }}</p>
    </div>
  </div>

  <article class="panel planned">
    <Construction :size="30" />
    <h3>This screen isn’t connected to real data</h3>
    <p>
      Rather than show sample records that look real, EduNova shows you nothing until the module is
      genuinely working. Nothing you see in this application is invented.
    </p>

    <div class="progress-items">
      <div class="done">
        <Database :size="17" />
        <div>
          <strong>Database tables — done</strong>
          <p>Schema, constraints and audit triggers for this module already exist and are tested.</p>
        </div>
      </div>
      <div class="done">
        <ShieldCheck :size="17" />
        <div>
          <strong>Permissions — done</strong>
          <p>Roles and access rules for this module are defined and enforced server-side.</p>
        </div>
      </div>
      <div>
        <Construction :size="17" />
        <div>
          <strong>API and screens — to do</strong>
          <p>The endpoints and this interface are the remaining work.</p>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  font-size: 0.86rem;
  text-decoration: none;
  color: inherit;
  opacity: 0.7;
}
.back-link:hover { opacity: 1; }

.panel.planned { text-align: center; padding: 42px 28px; }
.panel.planned > svg { opacity: 0.35; }
.panel.planned h3 { margin: 14px 0 8px; }
.panel.planned > p { max-width: 520px; margin: 0 auto; line-height: 1.6; opacity: 0.72; }

.progress-items {
  display: grid;
  gap: 12px;
  max-width: 520px;
  margin: 30px auto 0;
  text-align: left;
}
.progress-items > div {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.22);
}
.progress-items > div > svg { flex: none; margin-top: 2px; opacity: 0.6; }
.progress-items .done { background: rgba(22, 163, 74, 0.06); border-color: rgba(22, 163, 74, 0.26); }
.progress-items .done > svg { color: #15803d; opacity: 1; }
.progress-items strong { display: block; margin-bottom: 3px; font-size: 0.9rem; }
.progress-items p { margin: 0; font-size: 0.84rem; line-height: 1.5; opacity: 0.68; }
</style>
