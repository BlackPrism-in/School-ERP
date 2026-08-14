<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Copy, KeyRound, Plus, Search, UserCog, X } from 'lucide-vue-next'
import { staff } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const queryClient = useQueryClient()

const search = ref('')
const debounced = ref('')
let timer: ReturnType<typeof setTimeout>
watch(search, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => (debounced.value = v), 300)
})

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: computed(() => ['staff', debounced.value]),
  queryFn: () => staff.list({ q: debounced.value || undefined }),
})

// -------------------------------------------------------------- add staff

const showForm = ref(false)
const form = ref({ employeeNo: '', firstName: '', lastName: '', designation: '', isTeaching: true })
const formError = ref('')

const create = useMutation({
  mutationFn: () =>
    staff.create({
      employeeNo: form.value.employeeNo.trim(),
      firstName: form.value.firstName.trim(),
      ...(form.value.lastName.trim() ? { lastName: form.value.lastName.trim() } : {}),
      ...(form.value.designation.trim() ? { designation: form.value.designation.trim() } : {}),
      isTeaching: form.value.isTeaching,
    }),
  onSuccess: async () => {
    showForm.value = false
    form.value = { employeeNo: '', firstName: '', lastName: '', designation: '', isTeaching: true }
    formError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['staff'] })
  },
  onError: (caught) => {
    formError.value = caught instanceof ApiError ? caught.message : 'Could not save.'
  },
})

// ---------------------------------------------------------------- account

const accountFor = ref<{ id: string; name: string } | null>(null)
const accountForm = ref({ email: '', role: 'teacher' })
const accountError = ref('')
const issued = ref<{ email: string; password: string } | null>(null)
const copied = ref(false)

const createAccount = useMutation({
  mutationFn: () => staff.createAccount(accountFor.value!.id, accountForm.value),
  onSuccess: async (result) => {
    // Shown exactly once. It is generated, never chosen, and the holder must
    // change it at first sign-in.
    issued.value = { email: result.email, password: result.temporaryPassword }
    accountFor.value = null
    accountError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['staff'] })
  },
  onError: (caught) => {
    accountError.value = caught instanceof ApiError ? caught.message : 'Could not create the account.'
  },
})

async function copyCredentials() {
  if (!issued.value) return
  await navigator.clipboard.writeText(`${issued.value.email} / ${issued.value.password}`)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">People</p>
      <h1>Staff</h1>
      <p v-if="data">{{ data.total }} record{{ data.total === 1 ? '' : 's' }}</p>
    </div>
    <div v-if="can('staff.write')" class="page-actions">
      <button class="primary" @click="showForm = true"><Plus :size="17" /> Add staff</button>
    </div>
  </div>

  <div class="toolbar-search">
    <Search :size="17" />
    <input v-model="search" placeholder="Search by name, employee number or role…" />
  </div>

  <LoadingPanel v-if="isPending" :rows="5" label="Loading staff…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not load staff" @retry="refetch" />

  <template v-else-if="data">
    <div v-if="data.data.length === 0" class="empty-state">
      <UserCog :size="32" />
      <h3>No staff records</h3>
      <p>Staff you add will appear here.</p>
    </div>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Employee no.</th><th>Designation</th><th class="num">Classes</th><th>Account</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in data.data" :key="String(s.id)">
            <td><strong>{{ s.firstName }} {{ s.lastName ?? '' }}</strong></td>
            <td class="mono">{{ s.employeeNo }}</td>
            <td>{{ s.designation ?? '—' }}<small v-if="!s.isTeaching" class="tag">non-teaching</small></td>
            <td class="num">{{ s.sectionCount }}</td>
            <td>
              <span v-if="s.hasAccount" class="badge active">Has login</span>
              <span v-else class="badge">No login</span>
            </td>
            <td>
              <button
                v-if="!s.hasAccount && can('user.manage')"
                class="mini"
                @click="accountFor = { id: String(s.id), name: `${s.firstName} ${s.lastName ?? ''}` }"
              >
                <KeyRound :size="13" /> Create login
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <!-- Add staff -->
  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>Add staff</h2><button aria-label="Close" @click="showForm = false"><X :size="18" /></button></div>
      <form @submit.prevent="create.mutate()">
        <div class="two-up">
          <label class="field-label">Employee number<input v-model="form.employeeNo" required maxlength="40" /></label>
          <label class="field-label">Designation<input v-model="form.designation" maxlength="80" placeholder="Teacher" /></label>
          <label class="field-label">First name<input v-model="form.firstName" required maxlength="80" /></label>
          <label class="field-label">Last name<input v-model="form.lastName" maxlength="80" /></label>
        </div>
        <label class="check"><input v-model="form.isTeaching" type="checkbox" /> Teaching staff</label>
        <p v-if="formError" class="login-error">{{ formError }}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="showForm = false">Cancel</button>
          <button type="submit" class="primary" :disabled="!form.employeeNo.trim() || !form.firstName.trim() || create.isPending.value">
            {{ create.isPending.value ? 'Saving…' : 'Add staff' }}
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Create login -->
  <div v-if="accountFor" class="modal-backdrop" @click.self="accountFor = null">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>Create login for {{ accountFor.name }}</h2><button aria-label="Close" @click="accountFor = null"><X :size="18" /></button></div>
      <form @submit.prevent="createAccount.mutate()">
        <label class="field-label">Email<input v-model="accountForm.email" type="email" required maxlength="254" /></label>
        <label class="field-label">
          Role
          <select v-model="accountForm.role">
            <option value="teacher">Teacher</option>
            <option value="accountant">Accountant</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <p class="note">A password is generated and shown once. They must change it at first sign-in.</p>
        <p v-if="accountError" class="login-error">{{ accountError }}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" @click="accountFor = null">Cancel</button>
          <button type="submit" class="primary" :disabled="!accountForm.email.trim() || createAccount.isPending.value">
            {{ createAccount.isPending.value ? 'Creating…' : 'Create login' }}
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Credentials, shown once -->
  <div v-if="issued" class="modal-backdrop" @click.self="issued = null">
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Login created</h2>
      <p class="note">This password is shown once. Give it to them directly — it cannot be retrieved later.</p>
      <div class="credentials">
        <div><small>Email</small><strong>{{ issued.email }}</strong></div>
        <div><small>Temporary password</small><strong class="mono">{{ issued.password }}</strong></div>
      </div>
      <div class="modal-actions">
        <button class="secondary" @click="copyCredentials"><Copy :size="15" /> {{ copied ? 'Copied' : 'Copy' }}</button>
        <button class="primary" @click="issued = null">Done</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-search {
  display: flex; align-items: center; gap: 9px; max-width: 460px;
  padding: 0 12px; margin-bottom: 16px; border-radius: 11px;
  border: 1px solid rgba(148,163,184,0.3); background: var(--surface,#fff);
}
.toolbar-search input { flex: 1; padding: 11px 0; border: none; background: none; font: inherit; outline: none; }

.table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid rgba(148,163,184,0.22); }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.89rem; }
.data-table th { padding: 11px 14px; text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; border-bottom: 1px solid rgba(148,163,184,0.22); }
.data-table td { padding: 11px 14px; border-bottom: 1px solid rgba(148,163,184,0.12); }
.data-table tbody tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.mono { font-variant-numeric: tabular-nums; }
.tag { display: inline-block; margin-left: 7px; padding: 2px 7px; border-radius: 999px; font-size: 0.7rem; background: rgba(148,163,184,0.16); opacity: 0.8; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.73rem; font-weight: 600; background: rgba(148,163,184,0.16); }
.badge.active { background: rgba(22,163,74,0.13); color: #15803d; }

.mini { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.32); background: none; font: inherit; font-size: 0.78rem; cursor: pointer; }

.empty-state { display: grid; justify-items: center; gap: 8px; padding: 48px 24px; text-align: center; border-radius: 16px; border: 1px dashed rgba(148,163,184,0.42); }
.empty-state svg { opacity: 0.4; }
.empty-state h3 { margin: 6px 0 0; }
.empty-state p { margin: 0; opacity: 0.68; }

.modal-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgba(15,23,42,0.45); }
.modal { width: min(560px, 100%); padding: 24px; border-radius: 18px; background: var(--surface,#fff); box-shadow: 0 30px 70px rgba(15,23,42,0.28); }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.modal-head h2, .modal > h2 { margin: 0; font-size: 1.1rem; }
.modal-head button { border: none; background: none; padding: 5px; cursor: pointer; opacity: 0.6; }
.two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 560px) { .two-up { grid-template-columns: 1fr; } }
.field-label { display: grid; gap: 6px; margin-bottom: 14px; font-size: 0.84rem; font-weight: 600; }
.field-label input, .field-label select { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.34); background: var(--surface,#fff); font: inherit; font-weight: 400; }
.check { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; }
.note { margin: 10px 0 0; font-size: 0.83rem; line-height: 1.5; opacity: 0.65; }

.credentials { display: grid; gap: 12px; margin: 16px 0 0; padding: 16px; border-radius: 12px; background: rgba(148,163,184,0.1); }
.credentials small { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; margin-bottom: 3px; }
.credentials strong { font-size: 0.98rem; word-break: break-all; }

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.modal-actions button { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; }
.modal-actions .secondary { border: 1px solid rgba(148,163,184,0.34); background: none; }
.modal-actions .primary { border: none; background: var(--brand,#5b4df7); color: #fff; }
.modal-actions .primary:disabled { opacity: 0.5; cursor: default; }
.page-actions .primary { display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px; border: none; border-radius: 10px; background: var(--brand,#5b4df7); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
</style>
