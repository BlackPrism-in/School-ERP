<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, GraduationCap, HeartPulse, Pencil, UserMinus } from 'lucide-vue-next'
import { enrolment as enrolmentApi, school, students, type StudentInput } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const id = computed(() => String(route.params.id))

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: computed(() => ['students', id.value]),
  queryFn: () => students.get(id.value),
})

const editing = ref(false)
const form = ref<Partial<StudentInput>>({})
const formErrors = ref<Record<string, string>>({})
const formError = ref('')

watch(
  data,
  (student) => {
    if (!student) return
    form.value = {
      admissionNo: student.admissionNo,
      firstName: student.firstName,
      lastName: student.lastName ?? '',
      dateOfBirth: student.dateOfBirth?.slice(0, 10) ?? '',
      gender: student.gender ?? '',
      bloodGroup: student.bloodGroup ?? '',
      addressLine: student.addressLine ?? '',
      city: student.city ?? '',
      state: student.state ?? '',
      postalCode: student.postalCode ?? '',
      medicalNotes: student.medicalNotes ?? '',
    }
  },
  { immediate: true },
)

const update = useMutation({
  mutationFn: (input: Partial<StudentInput>) => students.update(id.value, input),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['students'] })
    editing.value = false
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

const withdraw = useMutation({
  mutationFn: () => students.withdraw(id.value),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['students'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    router.push('/app/students')
  },
})

const confirmingWithdraw = ref(false)

// ------------------------------------------------------------- enrolment

const enrolments = useQuery({
  queryKey: computed(() => ['students', id.value, 'enrolment']),
  queryFn: () => enrolmentApi.forStudent(id.value),
})

const sections = useQuery({
  queryKey: ['school', 'sections'],
  queryFn: () => school.sections(),
  enabled: computed(() => can('enrolment.manage')),
  staleTime: 300_000,
})

const currentEnrolment = computed(() => enrolments.data.value?.data.find((e) => e.isCurrent) ?? null)

const enrolForm = ref({ sectionId: '', rollNo: '' })
const enrolError = ref('')
const showEnrol = ref(false)

const enrol = useMutation({
  mutationFn: () =>
    enrolmentApi.enrol(id.value, {
      sectionId: enrolForm.value.sectionId,
      ...(enrolForm.value.rollNo.trim() ? { rollNo: enrolForm.value.rollNo.trim() } : {}),
    }),
  onSuccess: async () => {
    showEnrol.value = false
    enrolForm.value = { sectionId: '', rollNo: '' }
    enrolError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['students'] })
    await queryClient.invalidateQueries({ queryKey: ['school'] })
  },
  onError: (caught) => {
    enrolError.value = caught instanceof ApiError ? caught.message : 'Could not save the enrolment.'
  },
})

function openEnrol() {
  enrolForm.value = {
    sectionId: currentEnrolment.value?.sectionId ?? '',
    rollNo: currentEnrolment.value?.rollNo ?? '',
  }
  enrolError.value = ''
  showEnrol.value = true
}

function save() {
  formErrors.value = {}
  formError.value = ''
  const payload = Object.fromEntries(
    Object.entries(form.value).filter(([, v]) => v !== '' && v !== undefined),
  )
  update.mutate(payload)
}

const fullName = computed(() =>
  data.value ? [data.value.firstName, data.value.lastName].filter(Boolean).join(' ') : '',
)

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <RouterLink to="/app/students" class="back-link"><ArrowLeft :size="16" /> All students</RouterLink>

  <LoadingPanel v-if="isPending" :rows="5" label="Loading student…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not load this student" @retry="refetch" />

  <template v-else-if="data">
    <div class="page-head">
      <div>
        <p class="eyebrow">Admission {{ data.admissionNo }}</p>
        <h1>{{ fullName }}</h1>
        <p>
          <template v-if="data.className">{{ data.className }}{{ data.sectionName ? ` · Section ${data.sectionName}` : '' }}</template>
          <template v-else>Not enrolled in the current session</template>
          <span :class="['badge', data.status]">{{ data.status }}</span>
        </p>
      </div>
      <div v-if="can('student.write')" class="page-actions">
        <button v-if="!editing" class="secondary" @click="editing = true"><Pencil :size="16" /> Edit</button>
        <button
          v-if="can('student.delete') && data.status === 'active' && !editing"
          class="danger"
          @click="confirmingWithdraw = true"
        >
          <UserMinus :size="16" /> Withdraw
        </button>
      </div>
    </div>

    <!-- View -->
    <template v-if="!editing">
      <article class="panel">
        <div class="panel-head"><div><h3>Personal details</h3></div></div>
        <dl class="detail-grid">
          <div><dt>Date of birth</dt><dd>{{ formatDate(data.dateOfBirth) }}</dd></div>
          <div><dt>Gender</dt><dd class="cap">{{ data.gender ?? '—' }}</dd></div>
          <div><dt>Blood group</dt><dd>{{ data.bloodGroup || '—' }}</dd></div>
          <div><dt>Category</dt><dd>{{ data.category || '—' }}</dd></div>
          <div><dt>Admitted</dt><dd>{{ formatDate(data.admissionDate) }}</dd></div>
          <div><dt>Roll number</dt><dd>{{ data.rollNo || '—' }}</dd></div>
        </dl>
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <h3><GraduationCap :size="16" /> Enrolment</h3>
            <p>Which class this student sits in for the current session.</p>
          </div>
          <button v-if="can('enrolment.manage')" class="text-action" @click="openEnrol">
            {{ currentEnrolment ? 'Change class' : 'Enrol' }}
          </button>
        </div>

        <template v-if="currentEnrolment">
          <dl class="detail-grid">
            <div><dt>Class</dt><dd>{{ currentEnrolment.className }} · {{ currentEnrolment.sectionName }}</dd></div>
            <div><dt>Roll number</dt><dd>{{ currentEnrolment.rollNo || '—' }}</dd></div>
            <div><dt>Session</dt><dd>{{ currentEnrolment.sessionName }}</dd></div>
          </dl>
        </template>
        <p v-else class="address"><span class="muted">Not enrolled in the current session.</span></p>

        <ul v-if="(enrolments.data.value?.data.length ?? 0) > 1" class="history">
          <li v-for="e in enrolments.data.value?.data.filter((x) => !x.isCurrent)" :key="e.id">
            {{ e.sessionName }} — {{ e.className }} · {{ e.sectionName }}
          </li>
        </ul>
      </article>

      <article class="panel">
        <div class="panel-head"><div><h3>Address</h3></div></div>
        <p class="address">
          <template v-if="data.addressLine || data.city">
            {{ [data.addressLine, data.city, data.state, data.postalCode].filter(Boolean).join(', ') }}
          </template>
          <span v-else class="muted">No address on record.</span>
        </p>
      </article>

      <!-- Only rendered when the API chose to return it. -->
      <article v-if="data.medicalNotes !== undefined" class="panel sensitive">
        <div class="panel-head">
          <div>
            <h3><HeartPulse :size="16" /> Medical notes</h3>
            <p>Sensitive personal data. Every time this is opened, the access is recorded.</p>
          </div>
        </div>
        <p class="address">
          <template v-if="data.medicalNotes">{{ data.medicalNotes }}</template>
          <span v-else class="muted">None recorded.</span>
        </p>
      </article>
    </template>

    <!-- Edit -->
    <article v-else class="panel">
      <div class="panel-head"><div><h3>Edit student</h3></div></div>
      <form @submit.prevent="save">
        <div class="form-grid">
          <label>Admission number
            <input v-model="form.admissionNo" :class="{ invalid: formErrors.admissionNo }" />
            <small v-if="formErrors.admissionNo" class="field-error">{{ formErrors.admissionNo }}</small>
          </label>
          <label>First name
            <input v-model="form.firstName" :class="{ invalid: formErrors.firstName }" />
          </label>
          <label>Last name<input v-model="form.lastName" /></label>
          <label>Date of birth<input v-model="form.dateOfBirth" type="date" /></label>
          <label>Gender
            <select v-model="form.gender">
              <option value="">Not specified</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="undisclosed">Undisclosed</option>
            </select>
          </label>
          <label>Blood group<input v-model="form.bloodGroup" /></label>
          <label class="span-2">Address<input v-model="form.addressLine" /></label>
          <label>City<input v-model="form.city" /></label>
          <label>State<input v-model="form.state" /></label>
          <label>Postal code<input v-model="form.postalCode" /></label>
          <label v-if="data.medicalNotes !== undefined" class="span-2">
            Medical notes
            <textarea v-model="form.medicalNotes" rows="3"></textarea>
            <small class="hint">Sensitive. Record only what staff need in an emergency.</small>
          </label>
        </div>

        <p v-if="formError" class="login-error">{{ formError }}</p>

        <div class="modal-actions">
          <button type="button" class="secondary" @click="editing = false">Cancel</button>
          <button type="submit" class="primary" :disabled="update.isPending.value">
            {{ update.isPending.value ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </form>
    </article>

    <!-- Enrol / change class -->
    <div v-if="showEnrol" class="modal-backdrop" @click.self="showEnrol = false">
      <div class="modal" role="dialog" aria-modal="true">
        <h2>{{ currentEnrolment ? 'Change class' : 'Enrol student' }}</h2>
        <p v-if="currentEnrolment" class="confirm-body">
          Moving a student keeps their existing register history — attendance follows the enrolment,
          not the section.
        </p>

        <form @submit.prevent="enrol.mutate()">
          <div class="form-grid enrol-grid">
            <label class="span-2">
              Class and section
              <select v-model="enrolForm.sectionId" required>
                <option value="" disabled>Choose a section…</option>
                <option v-for="s in sections.data.value?.data ?? []" :key="s.id" :value="s.id">
                  {{ s.className }} · {{ s.name }}
                  <template v-if="s.capacity"> ({{ s.studentCount }}/{{ s.capacity }})</template>
                </option>
              </select>
            </label>
            <label>
              Roll number
              <input v-model="enrolForm.rollNo" maxlength="20" placeholder="Optional" />
            </label>
          </div>

          <p v-if="enrolError" class="login-error">{{ enrolError }}</p>

          <div class="modal-actions">
            <button type="button" class="secondary" @click="showEnrol = false">Cancel</button>
            <button type="submit" class="primary" :disabled="!enrolForm.sectionId || enrol.isPending.value">
              {{ enrol.isPending.value ? 'Saving…' : (currentEnrolment ? 'Move student' : 'Enrol') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Withdraw confirmation -->
    <div v-if="confirmingWithdraw" class="modal-backdrop" @click.self="confirmingWithdraw = false">
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Withdraw {{ fullName }}?</h2>
        <p class="confirm-body">
          Their record stays in the system — fee history, attendance and marks are preserved and remain
          auditable. They will no longer appear in the active roster.
        </p>
        <p v-if="withdraw.isError.value" class="login-error">Could not withdraw. Please try again.</p>
        <div class="modal-actions">
          <button class="secondary" @click="confirmingWithdraw = false">Cancel</button>
          <button class="danger" :disabled="withdraw.isPending.value" @click="withdraw.mutate()">
            {{ withdraw.isPending.value ? 'Withdrawing…' : 'Withdraw student' }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.panel-head h3 { display: flex; align-items: center; gap: 8px; }
.text-action {
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: none;
  border-radius: 9px;
  padding: 7px 13px;
  font: inherit;
  font-size: 0.83rem;
  font-weight: 600;
  cursor: pointer;
}
.history { list-style: none; margin: 14px 0 0; padding: 12px 0 0; border-top: 1px solid rgba(148,163,184,0.16); font-size: 0.84rem; opacity: 0.65; }
.history li { padding: 3px 0; }
.enrol-grid { grid-template-columns: 1fr 140px; }
@media (max-width: 560px) { .enrol-grid { grid-template-columns: 1fr; } }

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

.page-head p .badge { margin-left: 10px; }
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

.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin: 0; }
@media (max-width: 720px) { .detail-grid { grid-template-columns: repeat(2, 1fr); } }
.detail-grid dt { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; margin-bottom: 4px; }
.detail-grid dd { margin: 0; font-weight: 600; }
.cap { text-transform: capitalize; }
.address { margin: 0; line-height: 1.6; }
.muted { opacity: 0.45; }

.panel.sensitive { border-color: rgba(234, 88, 12, 0.3); }
.panel.sensitive h3 { display: flex; align-items: center; gap: 7px; }

.form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
@media (max-width: 720px) { .form-grid { grid-template-columns: 1fr; } }
.form-grid .span-2 { grid-column: span 2; }
@media (max-width: 720px) { .form-grid .span-2 { grid-column: span 1; } }
.form-grid label { display: grid; gap: 6px; font-size: 0.84rem; font-weight: 600; }
.form-grid input,
.form-grid select,
.form-grid textarea {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: var(--surface, #fff);
  font: inherit;
  font-weight: 400;
}
.form-grid .invalid { border-color: #dc2626; }
.field-error { font-weight: 400; font-size: 0.78rem; color: #dc2626; }
.hint { font-weight: 400; font-size: 0.78rem; opacity: 0.6; }

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.modal-actions button, .page-actions button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 18px;
  border-radius: 10px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.secondary { border: 1px solid rgba(148, 163, 184, 0.34); background: none; }
.primary { border: none; background: var(--brand, #5b4df7); color: #fff; }
.danger { border: 1px solid rgba(220, 38, 38, 0.35); background: none; color: #b91c1c; }
.danger:hover { background: rgba(220, 38, 38, 0.07); }
button:disabled { opacity: 0.6; cursor: default; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
}
.modal {
  width: min(480px, 100%);
  padding: 24px;
  border-radius: 18px;
  background: var(--surface, #fff);
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.28);
}
.modal h2 { margin: 0 0 10px; font-size: 1.1rem; }
.confirm-body { margin: 0; font-size: 0.89rem; line-height: 1.55; opacity: 0.75; }
</style>
