<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Megaphone, Plus, Send, X, Archive } from 'lucide-vue-next'
import { notices, school, type NoticeAudience } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const queryClient = useQueryClient()
const canWrite = computed(() => can('notice.write'))

const statusFilter = ref('')
const unreadOnly = ref(false)

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: computed(() => ['notices', statusFilter.value, unreadOnly.value]),
  queryFn: () =>
    notices.list({
      ...(statusFilter.value ? { status: statusFilter.value } : {}),
      ...(unreadOnly.value ? { unreadOnly: true } : {}),
    }),
})

const sections = useQuery({
  queryKey: ['school', 'sections'],
  queryFn: () => school.sections(),
  enabled: canWrite,
  staleTime: 300_000,
})
const classes = useQuery({
  queryKey: ['school', 'classes'],
  queryFn: school.classes,
  enabled: canWrite,
  staleTime: 300_000,
})

// ------------------------------------------------------------------ compose

const showForm = ref(false)
const formError = ref('')
const form = ref({
  title: '',
  body: '',
  priority: 'normal',
  audienceKind: 'everyone' as 'everyone' | 'role' | 'class_level' | 'section',
  roleKey: 'teacher',
  classLevelId: '',
  sectionId: '',
  publishNow: true,
})

function reset() {
  form.value = {
    title: '', body: '', priority: 'normal', audienceKind: 'everyone',
    roleKey: 'teacher', classLevelId: '', sectionId: '', publishNow: true,
  }
  formError.value = ''
}

function buildAudience(): NoticeAudience {
  const kind = form.value.audienceKind
  if (kind === 'role') return { type: 'role', roleKey: form.value.roleKey }
  if (kind === 'class_level') return { type: 'class_level', classLevelId: form.value.classLevelId }
  if (kind === 'section') return { type: 'section', sectionId: form.value.sectionId }
  return { type: 'everyone' }
}

const create = useMutation({
  mutationFn: async () => {
    const created = await notices.create({
      title: form.value.title.trim(),
      body: form.value.body.trim(),
      priority: form.value.priority,
      audiences: [buildAudience()],
    })
    // Publishing is deliberately separate — a draft reaches nobody.
    if (form.value.publishNow) await notices.publish(created.id)
    return created
  },
  onSuccess: async () => {
    showForm.value = false
    reset()
    await queryClient.invalidateQueries({ queryKey: ['notices'] })
  },
  onError: (caught) => {
    formError.value = caught instanceof ApiError ? caught.message : 'Could not save the notice.'
  },
})

const publish = useMutation({
  mutationFn: (id: string) => notices.publish(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notices'] }),
})

const archive = useMutation({
  mutationFn: (id: string) => notices.archive(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notices'] }),
})

const audienceValid = computed(() => {
  const kind = form.value.audienceKind
  if (kind === 'class_level') return Boolean(form.value.classLevelId)
  if (kind === 'section') return Boolean(form.value.sectionId)
  return true
})

function formatWhen(value: string) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">Communication</p>
      <h1>Notices</h1>
      <p v-if="data">{{ data.total }} notice{{ data.total === 1 ? '' : 's' }}</p>
    </div>
    <div v-if="canWrite" class="page-actions">
      <button class="primary" @click="showForm = true"><Plus :size="17" /> New notice</button>
    </div>
  </div>

  <div class="toolbar">
    <select v-if="canWrite" v-model="statusFilter" aria-label="Filter by status">
      <option value="">Drafts and published</option>
      <option value="draft">Drafts only</option>
      <option value="published">Published only</option>
      <option value="archived">Archived</option>
    </select>
    <label class="check"><input v-model="unreadOnly" type="checkbox" /> Unread only</label>
  </div>

  <LoadingPanel v-if="isPending" :rows="4" label="Loading notices…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not load notices" @retry="refetch" />

  <template v-else-if="data">
    <div v-if="data.data.length === 0" class="empty-state">
      <Megaphone :size="32" />
      <h3>{{ unreadOnly ? 'Nothing unread' : 'No notices' }}</h3>
      <p>{{ canWrite ? 'Notices you publish will appear here.' : 'Notices from your school will appear here.' }}</p>
    </div>

    <ul v-else class="notice-list">
      <li v-for="n in data.data" :key="n.id" :class="{ unread: !n.read, draft: n.status === 'draft' }">
        <div class="notice-main">
          <div class="notice-top">
            <span :class="['pill', n.priority]">{{ n.priority }}</span>
            <span v-if="n.status !== 'published'" class="pill status">{{ n.status }}</span>
            <span v-if="!n.read && n.status === 'published'" class="dot" title="Unread"></span>
          </div>
          <h3>{{ n.title }}</h3>
          <p>{{ n.excerpt }}<template v-if="n.truncated">…</template></p>
          <small>{{ n.createdBy ?? 'School' }} · {{ formatWhen(n.publishAt) }}</small>
        </div>

        <div v-if="canWrite" class="notice-actions">
          <button v-if="n.status === 'draft'" class="mini" :disabled="publish.isPending.value" @click="publish.mutate(n.id)">
            <Send :size="14" /> Publish
          </button>
          <button v-if="n.status !== 'archived'" class="mini danger" :disabled="archive.isPending.value" @click="archive.mutate(n.id)">
            <Archive :size="14" /> Archive
          </button>
        </div>
      </li>
    </ul>
  </template>

  <!-- Compose -->
  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>New notice</h2>
        <button aria-label="Close" @click="showForm = false"><X :size="18" /></button>
      </div>

      <form @submit.prevent="create.mutate()">
        <label class="field-label">
          Title
          <input v-model="form.title" required maxlength="200" placeholder="Annual Sports Day" />
        </label>

        <label class="field-label">
          Message
          <textarea v-model="form.body" required rows="5" maxlength="20000"></textarea>
        </label>

        <div class="two-up">
          <label class="field-label">
            Priority
            <select v-model="form.priority">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          <label class="field-label">
            Who is this for?
            <select v-model="form.audienceKind" aria-label="Audience kind">
              <option value="everyone">Everyone</option>
              <option value="role">A role</option>
              <option value="class_level">A class</option>
              <option value="section">One section</option>
            </select>
          </label>
        </div>

        <label v-if="form.audienceKind === 'role'" class="field-label">
          Role
          <select v-model="form.roleKey" aria-label="Audience role">
            <option value="teacher">Teachers</option>
            <option value="accountant">Accountants</option>
            <option value="student">Students</option>
            <option value="guardian">Guardians</option>
          </select>
        </label>

        <label v-if="form.audienceKind === 'class_level'" class="field-label">
          Class
          <select v-model="form.classLevelId" aria-label="Audience class" required>
            <option value="" disabled>Choose a class…</option>
            <option v-for="c in classes.data.value?.data ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>

        <label v-if="form.audienceKind === 'section'" class="field-label">
          Section
          <select v-model="form.sectionId" aria-label="Audience section" required>
            <option value="" disabled>Choose a section…</option>
            <option v-for="s in sections.data.value?.data ?? []" :key="s.id" :value="s.id">
              {{ s.className }} · {{ s.name }}
            </option>
          </select>
        </label>

        <label class="check publish-check">
          <input v-model="form.publishNow" type="checkbox" />
          Publish immediately
          <small>Leave unticked to save as a draft. A draft reaches nobody.</small>
        </label>

        <p v-if="formError" class="login-error">{{ formError }}</p>

        <div class="modal-actions">
          <button type="button" class="secondary" @click="showForm = false">Cancel</button>
          <button type="submit" class="primary" :disabled="!form.title.trim() || !form.body.trim() || !audienceValid || create.isPending.value">
            {{ create.isPending.value ? 'Saving…' : form.publishNow ? 'Publish notice' : 'Save draft' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
.toolbar select {
  padding: 10px 13px;
  border-radius: 11px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: var(--surface, #fff);
  font: inherit;
}
.check { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; }

.notice-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.notice-list li {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: var(--surface, #fff);
}
.notice-list li.unread { border-left: 3px solid var(--brand, #5b4df7); }
.notice-list li.draft { background: rgba(148, 163, 184, 0.05); }
.notice-main { flex: 1; min-width: 0; }
.notice-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.notice-list h3 { margin: 0 0 5px; font-size: 1rem; }
.notice-list p { margin: 0 0 7px; font-size: 0.88rem; line-height: 1.55; opacity: 0.75; }
.notice-list small { font-size: 0.78rem; opacity: 0.55; }

.pill {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: rgba(148, 163, 184, 0.16);
}
.pill.high { background: rgba(234, 88, 12, 0.14); color: #c2410c; }
.pill.urgent { background: rgba(220, 38, 38, 0.13); color: #b91c1c; }
.pill.low { opacity: 0.6; }
.pill.status { background: rgba(99, 102, 241, 0.12); color: #4338ca; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand, #5b4df7); }

.notice-actions { display: flex; flex-direction: column; gap: 6px; flex: none; }
.mini {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  background: none;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}
.mini.danger { color: #b91c1c; border-color: rgba(220, 38, 38, 0.3); }

.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.42);
}
.empty-state svg { opacity: 0.4; }
.empty-state h3 { margin: 6px 0 0; }
.empty-state p { margin: 0; opacity: 0.68; }

.modal-backdrop {
  position: fixed; inset: 0; z-index: 90;
  display: grid; place-items: center; padding: 20px;
  background: rgba(15, 23, 42, 0.45);
}
.modal {
  width: min(620px, 100%); max-height: 88vh; overflow-y: auto;
  padding: 24px; border-radius: 18px; background: var(--surface, #fff);
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.28);
}
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.modal-head h2 { margin: 0; font-size: 1.15rem; }
.modal-head button { border: none; background: none; padding: 5px; cursor: pointer; opacity: 0.6; }

.field-label { display: grid; gap: 6px; margin-bottom: 14px; font-size: 0.84rem; font-weight: 600; }
.field-label input,
.field-label select,
.field-label textarea {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: var(--surface, #fff);
  font: inherit;
  font-weight: 400;
}
.two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 560px) { .two-up { grid-template-columns: 1fr; } }
.publish-check { align-items: flex-start; margin: 4px 0 0; }
.publish-check small { display: block; width: 100%; margin-top: 3px; font-weight: 400; opacity: 0.6; }

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.modal-actions button { padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; }
.modal-actions .secondary { border: 1px solid rgba(148, 163, 184, 0.34); background: none; }
.modal-actions .primary { border: none; background: var(--brand, #5b4df7); color: #fff; }
.modal-actions .primary:disabled { opacity: 0.5; cursor: default; }

.page-actions .primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 18px; border: none; border-radius: 10px;
  background: var(--brand, #5b4df7); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
</style>
