<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { BarChart3, Download } from 'lucide-vue-next'
import { attendance, school } from '../../api/endpoints'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const today = new Date()
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)

const sectionId = ref('')
const from = ref(monthStart)
const to = ref(today.toISOString().slice(0, 10))

const { data: sections } = useQuery({
  queryKey: ['school', 'sections'],
  queryFn: () => school.sections(),
  staleTime: 300_000,
})

watch(sections, (list) => {
  if (!sectionId.value && list?.data.length) sectionId.value = list.data[0]!.id
}, { immediate: true })

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: computed(() => ['attendance', 'report', sectionId.value, from.value, to.value]),
  queryFn: () => attendance.report({ sectionId: sectionId.value, from: from.value, to: to.value }),
  enabled: computed(() => Boolean(sectionId.value && from.value && to.value && to.value >= from.value)),
  retry: false,
})

const invalidRange = computed(() => to.value < from.value)

/**
 * Below this a school would usually contact the family. Purely a display
 * threshold — nothing is decided or actioned on it.
 */
const CONCERN_THRESHOLD = 75

function bandOf(percentage: number | null) {
  if (percentage === null) return ''
  if (percentage < CONCERN_THRESHOLD) return 'low'
  if (percentage < 90) return 'mid'
  return 'high'
}

function exportCsv() {
  if (!data.value) return
  const header = ['Roll', 'Student', 'Present', 'Absent', 'Late', 'Half day', 'Leave', 'Excused', 'Days marked', 'Percentage']
  const rows = data.value.students.map((s) => [
    s.rollNo ?? '',
    s.name,
    s.present,
    s.absent,
    s.late,
    s.halfDay,
    s.leave,
    s.excused,
    s.markedDays,
    s.percentage === null ? '' : s.percentage,
  ])
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `attendance-${from.value}-to-${to.value}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">Attendance</p>
      <h1>Attendance report</h1>
      <p v-if="data">{{ data.daysRecorded }} day{{ data.daysRecorded === 1 ? '' : 's' }} recorded in this range</p>
    </div>
    <div v-if="data?.students.length" class="page-actions">
      <button class="secondary" @click="exportCsv"><Download :size="16" /> Export CSV</button>
    </div>
  </div>

  <div class="toolbar">
    <label class="picker">
      <span>Class</span>
      <select v-model="sectionId">
        <option v-for="s in sections?.data ?? []" :key="s.id" :value="s.id">
          {{ s.className }} · {{ s.name }}
        </option>
      </select>
    </label>
    <label class="picker"><span>From</span><input v-model="from" type="date" /></label>
    <label class="picker"><span>To</span><input v-model="to" type="date" /></label>
  </div>

  <p v-if="invalidRange" class="login-error">The end date must not be before the start date.</p>

  <LoadingPanel v-else-if="isPending" :rows="6" label="Building report…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not build the report" @retry="refetch" />

  <template v-else-if="data">
    <div v-if="data.daysRecorded === 0" class="empty-state">
      <BarChart3 :size="32" />
      <h3>No attendance recorded</h3>
      <p>Nothing has been marked for this class between {{ data.from }} and {{ data.to }}.</p>
    </div>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="roll">Roll</th>
            <th>Student</th>
            <th class="num">Present</th>
            <th class="num">Absent</th>
            <th class="num">Late</th>
            <th class="num">Half</th>
            <th class="num">Leave</th>
            <th class="num">Attendance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in data.students" :key="s.enrolmentId">
            <td class="roll mono">{{ s.rollNo ?? '—' }}</td>
            <td><strong>{{ s.name }}</strong></td>
            <td class="num">{{ s.present }}</td>
            <td class="num">{{ s.absent }}</td>
            <td class="num">{{ s.late }}</td>
            <td class="num">{{ s.halfDay }}</td>
            <td class="num">{{ s.leave }}</td>
            <td class="num">
              <template v-if="s.percentage === null">
                <span class="muted" title="Nothing countable — leave and excused absence do not count against attendance">—</span>
              </template>
              <span v-else :class="['pct', bandOf(s.percentage)]">{{ s.percentage }}%</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="footnote">
      Half days count as half present. Approved leave and excused absence are excluded from the
      calculation rather than counted against the student.
    </p>
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

.table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.22); }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.data-table th {
  padding: 11px 14px;
  text-align: left;
  font-size: 0.73rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.6;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}
.data-table td { padding: 11px 14px; border-bottom: 1px solid rgba(148, 163, 184, 0.13); }
.data-table tbody tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.roll { width: 60px; }
.mono { font-variant-numeric: tabular-nums; opacity: 0.75; }
.muted { opacity: 0.4; }

.pct { font-weight: 700; }
.pct.high { color: #15803d; }
.pct.mid { color: #c2410c; }
.pct.low { color: #b91c1c; }

.footnote { margin-top: 14px; font-size: 0.8rem; line-height: 1.55; opacity: 0.6; max-width: 640px; }

.page-actions .secondary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

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
</style>
