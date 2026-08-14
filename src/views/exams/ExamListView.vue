<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FileText, Plus, X } from 'lucide-vue-next'
import { exams, school } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const queryClient = useQueryClient()
const canConfigure = computed(() => can('exam.configure'))

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: ['exams'],
  queryFn: exams.list,
})

const classes = useQuery({
  queryKey: ['school', 'classes'],
  queryFn: school.classes,
  enabled: canConfigure,
  staleTime: 300_000,
})

const showForm = ref(false)
const form = ref({ name: '', classLevelId: '' })
const formError = ref('')

const create = useMutation({
  mutationFn: () => exams.create({ name: form.value.name.trim(), classLevelId: form.value.classLevelId }),
  onSuccess: async () => {
    showForm.value = false
    form.value = { name: '', classLevelId: '' }
    formError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['exams'] })
  },
  onError: (caught) => {
    formError.value = caught instanceof ApiError ? caught.message : 'Could not create the exam.'
  },
})

/** Mirrors the server state machine so the UI never offers an illegal hop. */
const NEXT: Record<string, { to: string; label: string; permission: string } | null> = {
  draft: { to: 'scheduled', label: 'Schedule', permission: 'exam.configure' },
  scheduled: { to: 'mark_entry', label: 'Open mark entry', permission: 'exam.configure' },
  mark_entry: { to: 'moderation', label: 'Close entry', permission: 'exam.moderate' },
  moderation: { to: 'published', label: 'Publish results', permission: 'exam.publish' },
  published: { to: 'locked', label: 'Lock', permission: 'exam.publish' },
  locked: null,
}

const advance = useMutation({
  mutationFn: (input: { id: string; status: string }) => exams.setStatus(input.id, input.status),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exams'] }),
})

const advanceError = computed(() =>
  advance.error.value instanceof ApiError ? advance.error.value.message : '',
)
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">Assessment</p>
      <h1>Exams</h1>
      <p>Papers, mark entry and results.</p>
    </div>
    <div v-if="canConfigure" class="page-actions">
      <button class="primary" @click="showForm = true"><Plus :size="17" /> New exam</button>
    </div>
  </div>

  <p v-if="advanceError" class="login-error">{{ advanceError }}</p>

  <LoadingPanel v-if="isPending" :rows="4" label="Loading exams…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not load exams" @retry="refetch" />

  <template v-else-if="data">
    <div v-if="data.data.length === 0" class="empty-state">
      <FileText :size="32" />
      <h3>No exams yet</h3>
      <p>{{ canConfigure ? 'Create one to start scheduling papers.' : 'Exams will appear here once scheduled.' }}</p>
    </div>

    <ul v-else class="exam-list">
      <li v-for="e in data.data" :key="String(e.id)">
        <div class="exam-main">
          <h3><RouterLink :to="`/app/exams/${e.id}`">{{ e.name }}</RouterLink></h3>
          <small>
            {{ e.className }} · {{ e.subjectCount }} paper{{ e.subjectCount === 1 ? '' : 's' }}
          </small>
        </div>

        <span :class="['status-pill', String(e.status)]">{{ String(e.status).replace('_', ' ') }}</span>

        <button
          v-if="NEXT[String(e.status)] && can(NEXT[String(e.status)]!.permission as never)"
          class="mini"
          :disabled="advance.isPending.value"
          @click="advance.mutate({ id: String(e.id), status: NEXT[String(e.status)]!.to })"
        >
          {{ NEXT[String(e.status)]!.label }}
        </button>
      </li>
    </ul>
  </template>

  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>New exam</h2>
        <button aria-label="Close" @click="showForm = false"><X :size="18" /></button>
      </div>
      <form @submit.prevent="create.mutate()">
        <label class="field-label">
          Name
          <input v-model="form.name" required maxlength="120" placeholder="Term I Examination" />
        </label>
        <label class="field-label">
          Class
          <select v-model="form.classLevelId" required>
            <option value="" disabled>Choose a class…</option>
            <option v-for="c in classes.data.value?.data ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <p v-if="formError" class="login-error">{{ formError }}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="showForm = false">Cancel</button>
          <button type="submit" class="primary" :disabled="!form.name.trim() || !form.classLevelId || create.isPending.value">
            {{ create.isPending.value ? 'Creating…' : 'Create exam' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.exam-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.exam-list li {
  display: flex; align-items: center; gap: 16px;
  padding: 15px 18px; border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.22); background: var(--surface, #fff);
}
.exam-main { flex: 1; min-width: 0; }
.exam-list a { text-decoration: none; color: inherit; }
.exam-list h3 { margin: 0 0 3px; font-size: 1rem; }
.exam-list a:hover h3 { color: var(--brand, #5b4df7); text-decoration: underline; }
.exam-list small { font-size: 0.8rem; opacity: 0.6; }

.status-pill {
  flex: none; padding: 4px 11px; border-radius: 999px;
  font-size: 0.74rem; font-weight: 700; text-transform: capitalize;
  background: rgba(148, 163, 184, 0.16);
}
.status-pill.mark_entry { background: rgba(59, 130, 246, 0.13); color: #1d4ed8; }
.status-pill.moderation { background: rgba(234, 88, 12, 0.13); color: #c2410c; }
.status-pill.published { background: rgba(22, 163, 74, 0.13); color: #15803d; }
.status-pill.locked { background: rgba(71, 85, 105, 0.16); color: #334155; }

.mini {
  flex: none; padding: 7px 13px; border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.32); background: none;
  font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer;
}
.mini:disabled { opacity: 0.5; cursor: default; }

.empty-state {
  display: grid; justify-items: center; gap: 8px;
  padding: 48px 24px; text-align: center;
  border-radius: 16px; border: 1px dashed rgba(148, 163, 184, 0.42);
}
.empty-state svg { opacity: 0.4; }
.empty-state h3 { margin: 6px 0 0; }
.empty-state p { margin: 0; opacity: 0.68; }

.modal-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgba(15,23,42,0.45); }
.modal { width: min(520px, 100%); padding: 24px; border-radius: 18px; background: var(--surface, #fff); box-shadow: 0 30px 70px rgba(15,23,42,0.28); }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.modal-head h2 { margin: 0; font-size: 1.12rem; }
.modal-head button { border: none; background: none; padding: 5px; cursor: pointer; opacity: 0.6; }
.field-label { display: grid; gap: 6px; margin-bottom: 14px; font-size: 0.84rem; font-weight: 600; }
.field-label input, .field-label select {
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,0.34); background: var(--surface, #fff);
  font: inherit; font-weight: 400;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.modal-actions button { padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; }
.modal-actions .secondary { border: 1px solid rgba(148,163,184,0.34); background: none; }
.modal-actions .primary { border: none; background: var(--brand, #5b4df7); color: #fff; }
.modal-actions .primary:disabled { opacity: 0.5; cursor: default; }
.page-actions .primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 18px; border: none; border-radius: 10px;
  background: var(--brand, #5b4df7); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
</style>
