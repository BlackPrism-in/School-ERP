<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CalendarOff, Check, CheckCheck, ClipboardCheck, Info, Save, ShieldAlert } from 'lucide-vue-next'
import { attendance, school, type RegisterEntry } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { AttendanceStatus } from '../../api/types'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const today = new Date().toISOString().slice(0, 10)

const sectionId = ref(String(route.query.section ?? ''))
const date = ref(String(route.query.date ?? today))

// Keep the URL in step so a register is shareable and survives a refresh.
watch([sectionId, date], ([s, d]) => {
  router.replace({ query: { ...(s ? { section: s } : {}), date: d } })
})

const { data: sections, isPending: sectionsPending } = useQuery({
  queryKey: ['school', 'sections'],
  queryFn: () => school.sections(),
  staleTime: 300_000,
})

watch(sections, (list) => {
  if (!sectionId.value && list?.data.length) sectionId.value = list.data[0]!.id
}, { immediate: true })

const registerKey = computed(() => ['attendance', 'register', sectionId.value, date.value])

const { data: register, isPending, isError, error, refetch, isFetching } = useQuery({
  queryKey: registerKey,
  queryFn: () => attendance.register({ sectionId: sectionId.value, date: date.value }),
  enabled: computed(() => Boolean(sectionId.value && date.value)),
  retry: false,
})

/** Local edits, keyed by enrolment. Only what changed is sent. */
const draft = ref<Record<string, AttendanceStatus>>({})
const reasons = ref<Record<string, string>>({})
const saveError = ref('')
const savedNote = ref('')

watch(register, () => {
  draft.value = {}
  reasons.value = {}
  saveError.value = ''
})

function statusOf(enrolmentId: string): AttendanceStatus | null {
  return draft.value[enrolmentId] ?? register.value?.students.find((s) => s.enrolmentId === enrolmentId)?.status ?? null
}

function setStatus(enrolmentId: string, status: AttendanceStatus) {
  draft.value = { ...draft.value, [enrolmentId]: status }
  saveError.value = ''
}

function markAllPresent() {
  const next: Record<string, AttendanceStatus> = { ...draft.value }
  for (const s of register.value?.students ?? []) {
    if (statusOf(s.enrolmentId) === null) next[s.enrolmentId] = 'present'
  }
  draft.value = next
}

const changed = computed(() =>
  (register.value?.students ?? []).filter((s) => {
    const next = draft.value[s.enrolmentId]
    return next !== undefined && next !== s.status
  }),
)

/** Rows that are settled and therefore need a written reason to amend. */
const needingReason = computed(() => changed.value.filter((s) => s.needsCorrection))

const unmarked = computed(() =>
  (register.value?.students ?? []).filter((s) => statusOf(s.enrolmentId) === null).length,
)

const liveSummary = computed(() => {
  const counts: Record<string, number> = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, excused: 0 }
  for (const s of register.value?.students ?? []) {
    const status = statusOf(s.enrolmentId)
    if (status) counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
})

const blockedByMissingReason = computed(() =>
  needingReason.value.some((s) => !(reasons.value[s.enrolmentId] ?? '').trim()),
)

const save = useMutation({
  mutationFn: () => {
    const entries: RegisterEntry[] = changed.value.map((s) => ({
      enrolmentId: s.enrolmentId,
      status: draft.value[s.enrolmentId]!,
      ...(s.needsCorrection ? { reason: reasons.value[s.enrolmentId] } : {}),
    }))
    return attendance.save({ sectionId: sectionId.value, date: date.value, entries })
  },
  onSuccess: async (result) => {
    savedNote.value =
      result.corrected > 0
        ? `Saved. ${result.corrected} correction${result.corrected === 1 ? '' : 's'} recorded.`
        : `Saved ${result.saved} record${result.saved === 1 ? '' : 's'}.`
    setTimeout(() => (savedNote.value = ''), 3500)
    await queryClient.invalidateQueries({ queryKey: ['attendance'] })
  },
  onError: (caught) => {
    saveError.value = caught instanceof ApiError ? caught.message : 'Could not save the register.'
  },
})

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'late', label: 'Late', short: 'L' },
  { value: 'half_day', label: 'Half day', short: 'H' },
  { value: 'leave', label: 'Leave', short: 'Lv' },
  { value: 'excused', label: 'Excused', short: 'E' },
]

/** A blocked register (holiday, future date) is an explanation, not a failure. */
const blockingMessage = computed(() => {
  if (!isError.value) return null
  const e = error.value
  if (e instanceof ApiError && ['future_date', 'date_outside_session'].includes(e.code)) return e.message
  return null
})
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">Attendance</p>
      <h1>Daily register</h1>
      <p v-if="register">{{ register.section.className }} · Section {{ register.section.name }}</p>
    </div>
  </div>

  <div class="toolbar">
    <label class="picker">
      <span>Class</span>
      <select v-model="sectionId" :disabled="sectionsPending">
        <option v-if="!sections?.data.length" value="">No classes available</option>
        <option v-for="s in sections?.data ?? []" :key="s.id" :value="s.id">
          {{ s.className }} · {{ s.name }} ({{ s.studentCount }})
        </option>
      </select>
    </label>
    <label class="picker">
      <span>Date</span>
      <input v-model="date" type="date" :max="today" />
    </label>
    <button v-if="date !== today" class="secondary today-btn" @click="date = today">Today</button>
  </div>

  <div v-if="sections && sections.data.length === 0" class="empty-state">
    <ClipboardCheck :size="32" />
    <h3>No classes yet</h3>
    <p>Attendance is recorded against a class section. Create one in school setup first.</p>
    <RouterLink class="primary" to="/app/setup">Go to school setup</RouterLink>
  </div>

  <template v-else-if="sectionId">
    <LoadingPanel v-if="isPending" :rows="6" label="Loading register…" />

    <div v-else-if="blockingMessage" class="notice-panel">
      <CalendarOff :size="22" />
      <div><strong>Cannot record attendance for this date</strong><p>{{ blockingMessage }}</p></div>
    </div>

    <ErrorPanel v-else-if="isError" :error="error" context="Could not load the register" @retry="refetch" />

    <template v-else-if="register">
      <div v-if="register.holiday" class="notice-panel holiday">
        <CalendarOff :size="22" />
        <div>
          <strong>{{ register.holiday.name }}</strong>
          <p>This day is a declared holiday, so attendance cannot be recorded. Remove the holiday if the school was open.</p>
        </div>
      </div>

      <template v-else>
        <div class="summary-bar">
          <span v-for="opt in STATUS_OPTIONS" :key="opt.value" :class="['chip', opt.value]">
            {{ opt.label }} <b>{{ liveSummary[opt.value] }}</b>
          </span>
          <span v-if="unmarked" class="chip unmarked">Unmarked <b>{{ unmarked }}</b></span>
          <button v-if="unmarked && register.canMark" class="secondary mark-all" @click="markAllPresent">
            <CheckCheck :size="15" /> Mark remaining present
          </button>
        </div>

        <div class="table-wrap" :class="{ refreshing: isFetching }">
          <table class="data-table register-table">
            <thead>
              <tr>
                <th class="roll">Roll</th>
                <th>Student</th>
                <th class="statuses">Attendance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in register.students" :key="s.enrolmentId" :class="{ settled: s.needsCorrection }">
                <td class="roll mono">{{ s.rollNo ?? '—' }}</td>
                <td>
                  <strong>{{ s.name }}</strong>
                  <small class="admission">{{ s.admissionNo }}</small>
                  <small v-if="s.markedBy" class="marked-by">
                    Marked by {{ s.markedBy }}<template v-if="s.needsCorrection"> · settled</template>
                  </small>
                </td>
                <td class="statuses">
                  <div class="status-group" role="group" :aria-label="`Attendance for ${s.name}`">
                    <button
                      v-for="opt in STATUS_OPTIONS"
                      :key="opt.value"
                      type="button"
                      :class="['status-btn', opt.value, { on: statusOf(s.enrolmentId) === opt.value }]"
                      :disabled="!register.canMark"
                      :title="opt.label"
                      :aria-label="`${opt.label} — ${s.name}`"
                      :aria-pressed="statusOf(s.enrolmentId) === opt.value"
                      @click="setStatus(s.enrolmentId, opt.value)"
                    >
                      {{ opt.short }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Corrections need a written reason; the API refuses without one. -->
        <div v-if="needingReason.length" class="correction-panel">
          <div class="correction-head">
            <ShieldAlert :size="19" />
            <div>
              <strong>{{ needingReason.length }} record{{ needingReason.length === 1 ? '' : 's' }} settled more than {{ register.editWindowHours }} hours ago</strong>
              <p v-if="register.canCorrect">
                Amending these is a correction. Give a reason for each — it is kept with the record permanently.
              </p>
              <p v-else>
                You cannot amend attendance this old. Ask an administrator to make the correction.
              </p>
            </div>
          </div>
          <label v-for="s in needingReason" v-show="register.canCorrect" :key="s.enrolmentId" class="reason-row">
            <span>{{ s.name }}<em>{{ s.status }} → {{ draft[s.enrolmentId] }}</em></span>
            <input v-model="reasons[s.enrolmentId]" placeholder="Reason for the change" maxlength="300" />
          </label>
        </div>

        <p v-if="saveError" class="login-error">{{ saveError }}</p>

        <div class="save-bar">
          <p class="save-status">
            <template v-if="savedNote"><Check :size="15" /> {{ savedNote }}</template>
            <template v-else-if="changed.length">{{ changed.length }} unsaved change{{ changed.length === 1 ? '' : 's' }}</template>
            <template v-else-if="!register.canMark"><Info :size="15" /> You have read-only access to this register.</template>
            <template v-else-if="unmarked === 0">All students marked.</template>
          </p>
          <button
            v-if="register.canMark"
            class="primary"
            :disabled="!changed.length || save.isPending.value || blockedByMissingReason"
            @click="save.mutate()"
          >
            <Save :size="16" />
            {{ save.isPending.value ? 'Saving…' : 'Save register' }}
          </button>
        </div>
      </template>
    </template>
  </template>
</template>

<style scoped>
.toolbar { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 18px; }
.picker { display: grid; gap: 6px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
.picker select, .picker input {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: var(--surface, #fff);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink, #20233a);
}
.today-btn { height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.34); background: #fff; cursor: pointer; }

.notice-panel {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin: 18px 0;
  padding: 18px 20px;
  border-radius: 14px;
  background: rgba(59, 130, 246, 0.07);
  border: 1px solid rgba(59, 130, 246, 0.26);
  color: #1e40af;
}
.notice-panel.holiday { background: rgba(234, 88, 12, 0.08); border-color: rgba(234, 88, 12, 0.28); color: #9a3412; }
.notice-panel > svg { flex: none; margin-top: 1px; }
.notice-panel strong { display: block; margin-bottom: 3px; }
.notice-panel p { margin: 0; font-size: 0.87rem; line-height: 1.5; opacity: 0.9; }

.summary-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.chip {
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 0.78rem;
  background: rgba(148, 163, 184, 0.14);
}
.chip b { margin-left: 4px; font-variant-numeric: tabular-nums; }
.chip.present { background: rgba(22, 163, 74, 0.12); color: #15803d; }
.chip.absent { background: rgba(220, 38, 38, 0.11); color: #b91c1c; }
.chip.late { background: rgba(234, 88, 12, 0.12); color: #c2410c; }
.chip.unmarked { background: rgba(148, 163, 184, 0.2); font-weight: 600; }
.mark-all { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid rgba(148,163,184,0.34); background: #fff; font-size: 0.82rem; cursor: pointer; }

.table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.22); }
.table-wrap.refreshing { opacity: 0.7; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.data-table th {
  padding: 11px 16px;
  text-align: left;
  font-size: 0.73rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.6;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}
.data-table td { padding: 10px 16px; border-bottom: 1px solid rgba(148, 163, 184, 0.13); }
.data-table tbody tr:last-child td { border-bottom: none; }
.register-table .roll { width: 64px; }
.register-table .statuses { width: 300px; }
.mono { font-variant-numeric: tabular-nums; opacity: 0.75; }
.register-table strong { display: block; font-size: 0.9rem; }
.admission { display: inline-block; margin-top: 2px; font-size: 0.75rem; opacity: 0.5; }
.marked-by { display: block; font-size: 0.72rem; opacity: 0.45; }
tr.settled { background: rgba(148, 163, 184, 0.05); }

.status-group { display: flex; gap: 5px; }
.status-btn {
  width: 34px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  background: var(--surface, #fff);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
}
.status-btn:hover:not(:disabled) { border-color: #94a3b8; }
.status-btn:disabled { opacity: 0.45; cursor: default; }
.status-btn.on.present { background: #16a34a; border-color: #16a34a; color: #fff; }
.status-btn.on.absent { background: #dc2626; border-color: #dc2626; color: #fff; }
.status-btn.on.late { background: #ea580c; border-color: #ea580c; color: #fff; }
.status-btn.on.half_day { background: #ca8a04; border-color: #ca8a04; color: #fff; }
.status-btn.on.leave { background: #6366f1; border-color: #6366f1; color: #fff; }
.status-btn.on.excused { background: #64748b; border-color: #64748b; color: #fff; }

.correction-panel {
  margin-top: 18px;
  padding: 16px 18px;
  border-radius: 14px;
  background: rgba(249, 115, 22, 0.07);
  border: 1px solid rgba(249, 115, 22, 0.26);
}
.correction-head { display: flex; gap: 12px; align-items: flex-start; color: #9a3412; }
.correction-head > svg { flex: none; margin-top: 1px; }
.correction-head strong { display: block; margin-bottom: 3px; font-size: 0.9rem; }
.correction-head p { margin: 0; font-size: 0.85rem; line-height: 1.5; }
.reason-row { display: grid; grid-template-columns: 190px 1fr; gap: 12px; align-items: center; margin-top: 12px; }
@media (max-width: 620px) { .reason-row { grid-template-columns: 1fr; } }
.reason-row > span { font-size: 0.85rem; font-weight: 600; }
.reason-row em { display: block; font-style: normal; font-size: 0.76rem; opacity: 0.6; text-transform: capitalize; }
.reason-row input {
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: #fff;
  font: inherit;
  font-size: 0.86rem;
}

.save-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; }
.save-status { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 0.86rem; opacity: 0.72; }
.save-bar .primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  border: none;
  border-radius: 10px;
  background: var(--brand, #5b4df7);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.save-bar .primary:disabled { opacity: 0.5; cursor: default; }

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
.empty-state .primary {
  margin-top: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  background: var(--brand, #5b4df7);
  color: #fff;
}
</style>
