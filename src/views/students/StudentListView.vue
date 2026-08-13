<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronLeft, ChevronRight, Plus, Search, Users, X } from 'lucide-vue-next'
import { students, type StudentInput } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const search = ref('')
const debounced = ref('')
const status = ref('')
const page = ref(1)

let timer: ReturnType<typeof setTimeout>
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = value
    page.value = 1
  }, 300)
})
watch(status, () => (page.value = 1))

const { data, isPending, isError, error, refetch, isFetching } = useQuery({
  queryKey: computed(() => ['students', debounced.value, status.value, page.value]),
  queryFn: () =>
    students.list({
      q: debounced.value || undefined,
      status: status.value || undefined,
      page: page.value,
      pageSize: 25,
    }),
})

const totalPages = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1,
)

// ------------------------------------------------------------------ create

const showForm = ref(route.query.new === '1')
const form = ref<StudentInput>({ admissionNo: '', firstName: '' })
const formErrors = ref<Record<string, string>>({})
const formError = ref('')

watch(showForm, (open) => {
  const query = { ...route.query }
  if (open) query.new = '1'
  else delete query.new
  router.replace({ query })
  if (!open) resetForm()
})

function resetForm() {
  form.value = { admissionNo: '', firstName: '' }
  formErrors.value = {}
  formError.value = ''
}

const createStudent = useMutation({
  mutationFn: (input: StudentInput) => students.create(input),
  onSuccess: async (created) => {
    await queryClient.invalidateQueries({ queryKey: ['students'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    showForm.value = false
    router.push(`/app/students/${created.id}`)
  },
  onError: (caught) => {
    if (caught instanceof ApiError) {
      formError.value = caught.fields.length ? 'Please check the highlighted fields.' : caught.message
      formErrors.value = Object.fromEntries(caught.fields.map((f) => [f.path, f.message]))
    } else {
      formError.value = 'Could not save. Please try again.'
    }
  },
})

function submitForm() {
  formErrors.value = {}
  formError.value = ''
  // Empty optional strings would fail server-side date/enum validation.
  const payload = Object.fromEntries(
    Object.entries(form.value).filter(([, v]) => v !== '' && v !== undefined),
  ) as unknown as StudentInput
  createStudent.mutate(payload)
}

function fullName(s: { firstName: string; lastName: string | null }) {
  return [s.firstName, s.lastName].filter(Boolean).join(' ')
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">People</p>
      <h1>Students</h1>
      <p v-if="data">{{ data.total }} {{ data.total === 1 ? 'record' : 'records' }} you can access</p>
    </div>
    <div v-if="can('student.write')" class="page-actions">
      <button class="primary" @click="showForm = true"><Plus :size="17" /> Add student</button>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-search">
      <Search :size="17" />
      <input v-model="search" placeholder="Search by name or admission number…" />
      <button v-if="search" aria-label="Clear search" @click="search = ''"><X :size="15" /></button>
    </div>
    <select v-model="status" aria-label="Filter by status">
      <option value="">All statuses</option>
      <option value="active">Active</option>
      <option value="transferred">Transferred</option>
      <option value="withdrawn">Withdrawn</option>
      <option value="alumni">Alumni</option>
    </select>
  </div>

  <LoadingPanel v-if="isPending" :rows="6" label="Loading students…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not load students" @retry="refetch" />

  <template v-else-if="data">
    <div v-if="data.data.length === 0" class="empty-state">
      <Users :size="32" />
      <h3>{{ debounced || status ? 'No matching students' : 'No students yet' }}</h3>
      <p v-if="debounced || status">Try a different search or clear the filters.</p>
      <p v-else>Students you add will appear here.</p>
    </div>

    <template v-else>
      <div class="table-wrap" :class="{ refreshing: isFetching }">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Admission no.</th>
              <th>Class</th>
              <th>Roll</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="student in data.data" :key="student.id">
              <td>
                <RouterLink :to="`/app/students/${student.id}`" class="row-link">
                  {{ fullName(student) }}
                </RouterLink>
              </td>
              <td class="mono">{{ student.admissionNo }}</td>
              <td>
                <template v-if="student.className">{{ student.className }}{{ student.sectionName ? ` · ${student.sectionName}` : '' }}</template>
                <span v-else class="muted">Not enrolled</span>
              </td>
              <td>{{ student.rollNo ?? '—' }}</td>
              <td><span :class="['badge', student.status]">{{ student.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="pagination">
        <button :disabled="page === 1" @click="page -= 1"><ChevronLeft :size="16" /> Previous</button>
        <span>Page {{ page }} of {{ totalPages }}</span>
        <button :disabled="page >= totalPages" @click="page += 1">Next <ChevronRight :size="16" /></button>
      </div>
    </template>
  </template>

  <!-- Create -->
  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-student-title">
      <div class="modal-head">
        <h2 id="add-student-title">Add student</h2>
        <button aria-label="Close" @click="showForm = false"><X :size="18" /></button>
      </div>

      <form @submit.prevent="submitForm">
        <div class="form-grid">
          <label>
            Admission number *
            <input v-model="form.admissionNo" required :class="{ invalid: formErrors.admissionNo }" />
            <small v-if="formErrors.admissionNo" class="field-error">{{ formErrors.admissionNo }}</small>
          </label>
          <label>
            First name *
            <input v-model="form.firstName" required :class="{ invalid: formErrors.firstName }" />
            <small v-if="formErrors.firstName" class="field-error">{{ formErrors.firstName }}</small>
          </label>
          <label>
            Last name
            <input v-model="form.lastName" />
          </label>
          <label>
            Date of birth
            <input v-model="form.dateOfBirth" type="date" :class="{ invalid: formErrors.dateOfBirth }" />
            <small v-if="formErrors.dateOfBirth" class="field-error">{{ formErrors.dateOfBirth }}</small>
          </label>
          <label>
            Gender
            <select v-model="form.gender">
              <option value="">Not specified</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="undisclosed">Undisclosed</option>
            </select>
          </label>
          <label>
            Admission date
            <input v-model="form.admissionDate" type="date" />
          </label>
        </div>

        <p v-if="formError" class="login-error">{{ formError }}</p>

        <div class="modal-actions">
          <button type="button" class="secondary" @click="showForm = false">Cancel</button>
          <button type="submit" class="primary" :disabled="createStudent.isPending.value">
            {{ createStudent.isPending.value ? 'Saving…' : 'Add student' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.toolbar-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 220px;
  padding: 0 12px;
  border-radius: 11px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: var(--surface, #fff);
}
.toolbar-search input { flex: 1; padding: 11px 0; border: none; background: none; font: inherit; outline: none; }
.toolbar-search button { border: none; background: none; padding: 4px; cursor: pointer; opacity: 0.6; }
.toolbar select {
  padding: 11px 13px;
  border-radius: 11px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: var(--surface, #fff);
  font: inherit;
}

.table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.22); }
.table-wrap.refreshing { opacity: 0.72; transition: opacity 0.15s; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.data-table th {
  padding: 12px 16px;
  text-align: left;
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.6;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}
.data-table td { padding: 13px 16px; border-bottom: 1px solid rgba(148, 163, 184, 0.13); }
.data-table tbody tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover { background: rgba(91, 77, 247, 0.035); }
.row-link { font-weight: 600; text-decoration: none; color: inherit; }
.row-link:hover { color: var(--brand, #5b4df7); text-decoration: underline; }
.mono { font-variant-numeric: tabular-nums; opacity: 0.8; }
.muted { opacity: 0.45; }

.badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
  background: rgba(148, 163, 184, 0.16);
}
.badge.active { background: rgba(22, 163, 74, 0.13); color: #15803d; }
.badge.withdrawn { background: rgba(220, 38, 38, 0.11); color: #b91c1c; }
.badge.transferred { background: rgba(234, 88, 12, 0.12); color: #c2410c; }
.badge.alumni { background: rgba(91, 77, 247, 0.12); color: #4f46e5; }

.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 18px; font-size: 0.87rem; }
.pagination button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: var(--surface, #fff);
  font: inherit;
  font-size: 0.86rem;
  cursor: pointer;
}
.pagination button:disabled { opacity: 0.4; cursor: default; }

.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 52px 24px;
  text-align: center;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.42);
}
.empty-state svg { opacity: 0.4; }
.empty-state h3 { margin: 6px 0 0; }
.empty-state p { margin: 0; opacity: 0.68; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}
.modal {
  width: min(620px, 100%);
  max-height: 88vh;
  overflow-y: auto;
  padding: 24px;
  border-radius: 18px;
  background: var(--surface, #fff);
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.28);
}
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.modal-head h2 { margin: 0; font-size: 1.15rem; }
.modal-head button { border: none; background: none; padding: 5px; cursor: pointer; opacity: 0.6; }

.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 560px) { .form-grid { grid-template-columns: 1fr; } }
.form-grid label { display: grid; gap: 6px; font-size: 0.84rem; font-weight: 600; }
.form-grid input,
.form-grid select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: var(--surface, #fff);
  font: inherit;
  font-weight: 400;
}
.form-grid .invalid { border-color: #dc2626; }
.field-error { font-weight: 400; font-size: 0.78rem; color: #dc2626; }

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.modal-actions button { padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; }
.modal-actions .secondary { border: 1px solid rgba(148, 163, 184, 0.34); background: none; }
.modal-actions .primary { border: none; background: var(--brand, #5b4df7); color: #fff; }
.modal-actions .primary:disabled { opacity: 0.6; cursor: default; }
</style>
