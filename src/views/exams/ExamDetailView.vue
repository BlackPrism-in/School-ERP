<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, Plus, Save } from 'lucide-vue-next'
import { exams, school } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const route = useRoute()
const queryClient = useQueryClient()
const examId = computed(() => String(route.params.id))

const { data, isPending, isError, error, refetch } = useQuery({
  queryKey: computed(() => ['exams', examId.value]),
  queryFn: () => exams.get(examId.value),
})

type Exam = {
  id: string
  name: string
  status: string
  className: string
  classLevelId: string
  publishedAt: string | null
  subjects: Record<string, string | number>[]
}
const exam = computed(() => data.value as unknown as Exam | undefined)

const sections = useQuery({
  queryKey: ['school', 'sections'],
  queryFn: () => school.sections(),
  staleTime: 300_000,
})
const subjects = useQuery({
  queryKey: ['school', 'subjects'],
  queryFn: school.subjects,
  enabled: computed(() => can('exam.configure')),
  staleTime: 300_000,
})

// -------------------------------------------------------------- add paper

const paper = ref({ subjectId: '', theoryMax: 80, practicalMax: 20, passMarks: 33 })
const paperError = ref('')

const addPaper = useMutation({
  mutationFn: () =>
    exams.addPaper(examId.value, {
      subjectId: paper.value.subjectId,
      theoryMax: Number(paper.value.theoryMax),
      practicalMax: Number(paper.value.practicalMax),
      passMarks: Number(paper.value.passMarks),
    }),
  onSuccess: async () => {
    paper.value = { subjectId: '', theoryMax: 80, practicalMax: 20, passMarks: 33 }
    paperError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['exams'] })
  },
  onError: (caught) => {
    paperError.value = caught instanceof ApiError ? caught.message : 'Could not add the paper.'
  },
})

// ------------------------------------------------------------ mark sheet

const activePaper = ref('')
const activeSection = ref('')

// Watch the query's data ref, not the query object itself.
watch(sections.data, (list) => {
  if (!activeSection.value && list?.data.length) activeSection.value = list.data[0]!.id
}, { immediate: true })

const sheet = useQuery({
  queryKey: computed(() => ['exams', 'marks', activePaper.value, activeSection.value]),
  queryFn: () => exams.marks(activePaper.value, activeSection.value),
  enabled: computed(() => Boolean(activePaper.value && activeSection.value)),
  retry: false,
})

type Sheet = {
  subjectName: string
  examStatus: string
  canEnter: boolean
  maxima: { theory: number; practical: number; objective: number; total: number; pass: number }
  students: Record<string, string | number | boolean | null>[]
}
const sheetData = computed(() => sheet.data.value as unknown as Sheet | undefined)

const draft = ref<Record<string, { theory: string; practical: string; absent: boolean }>>({})
const saveError = ref('')

watch(sheetData, (s) => {
  if (!s) return
  draft.value = Object.fromEntries(
    s.students.map((st) => [
      String(st.enrolmentId),
      {
        theory: st.theoryMarks === null || st.theoryMarks === undefined ? '' : String(st.theoryMarks),
        practical: st.practicalMarks === null || st.practicalMarks === undefined ? '' : String(st.practicalMarks),
        absent: Boolean(st.isAbsent),
      },
    ]),
  )
  saveError.value = ''
})

const saveMarks = useMutation({
  mutationFn: () =>
    exams.saveMarks(activePaper.value, {
      sectionId: activeSection.value,
      entries: Object.entries(draft.value)
        .filter(([, v]) => v.absent || v.theory !== '' || v.practical !== '')
        .map(([enrolmentId, v]) => ({
          enrolmentId,
          isAbsent: v.absent,
          ...(v.absent
            ? {}
            : {
                theoryMarks: v.theory === '' ? null : Number(v.theory),
                practicalMarks: v.practical === '' ? null : Number(v.practical),
              }),
        })),
    }),
  onSuccess: async () => {
    saveError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['exams'] })
  },
  onError: (caught) => {
    saveError.value = caught instanceof ApiError ? caught.message : 'Could not save the marks.'
  },
})

function totalFor(enrolmentId: string) {
  const row = draft.value[enrolmentId]
  if (!row || row.absent) return '—'
  const sum = (Number(row.theory) || 0) + (Number(row.practical) || 0)
  return sum === 0 && row.theory === '' && row.practical === '' ? '—' : String(sum)
}

function overMax(enrolmentId: string, field: 'theory' | 'practical') {
  const row = draft.value[enrolmentId]
  const max = field === 'theory' ? sheetData.value?.maxima.theory : sheetData.value?.maxima.practical
  return row && row[field] !== '' && max !== undefined && Number(row[field]) > max
}

const anyOverMax = computed(() =>
  Object.keys(draft.value).some((id) => overMax(id, 'theory') || overMax(id, 'practical')),
)

const results = useQuery({
  queryKey: computed(() => ['exams', examId.value, 'results']),
  queryFn: () => exams.results(examId.value),
  enabled: computed(() => ['published', 'locked'].includes(exam.value?.status ?? '')),
})
</script>

<template>
  <RouterLink to="/app/exams" class="back-link"><ArrowLeft :size="16" /> All exams</RouterLink>

  <LoadingPanel v-if="isPending" :rows="4" label="Loading exam…" />
  <ErrorPanel v-else-if="isError" :error="error" context="Could not load this exam" @retry="refetch" />

  <template v-else-if="exam">
    <div class="page-head">
      <div>
        <p class="eyebrow">{{ exam.className }}</p>
        <h1>{{ exam.name }}</h1>
        <p><span :class="['status-pill', exam.status]">{{ exam.status.replace('_', ' ') }}</span></p>
      </div>
    </div>

    <article class="panel">
      <div class="panel-head"><div><h3>Papers</h3><p>Each paper's maximum bounds what can be entered.</p></div></div>

      <table v-if="exam.subjects.length" class="data-table">
        <thead>
          <tr><th>Subject</th><th class="num">Theory</th><th class="num">Practical</th><th class="num">Total</th><th class="num">Pass</th><th class="num">Marked</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in exam.subjects" :key="String(p.id)">
            <td><strong>{{ p.subjectName }}</strong></td>
            <td class="num">{{ Number(p.theoryMax) }}</td>
            <td class="num">{{ Number(p.practicalMax) }}</td>
            <td class="num">{{ Number(p.totalMax) }}</td>
            <td class="num">{{ Number(p.passMarks) }}</td>
            <td class="num">{{ p.marksEntered }}</td>
            <td>
              <button class="mini" @click="activePaper = String(p.id)">
                {{ activePaper === String(p.id) ? 'Open' : 'Enter marks' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">No papers yet.</p>

      <form v-if="can('exam.configure')" class="add-paper" @submit.prevent="addPaper.mutate()">
        <select v-model="paper.subjectId" required>
          <option value="" disabled>Subject…</option>
          <option v-for="s in subjects.data.value?.data ?? []" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <label>Theory<input v-model="paper.theoryMax" type="number" min="0" max="1000" /></label>
        <label>Practical<input v-model="paper.practicalMax" type="number" min="0" max="1000" /></label>
        <label>Pass<input v-model="paper.passMarks" type="number" min="0" max="1000" /></label>
        <button class="primary" :disabled="!paper.subjectId || addPaper.isPending.value"><Plus :size="15" /> Add</button>
      </form>
      <p v-if="paperError" class="login-error">{{ paperError }}</p>
    </article>

    <!-- Mark sheet -->
    <article v-if="activePaper" class="panel">
      <div class="panel-head">
        <div>
          <h3>Mark entry<template v-if="sheetData"> — {{ sheetData.subjectName }}</template></h3>
          <p v-if="sheetData">Theory out of {{ sheetData.maxima.theory }}, practical out of {{ sheetData.maxima.practical }}.</p>
        </div>
        <select v-model="activeSection">
          <option v-for="s in sections.data.value?.data ?? []" :key="s.id" :value="s.id">
            {{ s.className }} · {{ s.name }}
          </option>
        </select>
      </div>

      <LoadingPanel v-if="sheet.isPending.value" :rows="4" />
      <ErrorPanel v-else-if="sheet.isError.value" :error="sheet.error.value" @retry="sheet.refetch" />

      <template v-else-if="sheetData">
        <p v-if="!sheetData.canEnter" class="notice-inline">
          Marks can only be entered while the exam is open for mark entry (it is “{{ sheetData.examStatus.replace('_', ' ') }}”).
        </p>

        <table class="data-table">
          <thead>
            <tr><th>Roll</th><th>Student</th><th class="num">Theory</th><th class="num">Practical</th><th class="num">Total</th><th>Absent</th></tr>
          </thead>
          <tbody>
            <tr v-for="st in sheetData.students" :key="String(st.enrolmentId)">
              <td class="mono">{{ st.rollNo ?? '—' }}</td>
              <td><strong>{{ st.name }}</strong></td>
              <td class="num">
                <input
                  v-model="draft[String(st.enrolmentId)]!.theory"
                  type="number" min="0" :max="sheetData.maxima.theory"
                  :disabled="!sheetData.canEnter || draft[String(st.enrolmentId)]!.absent"
                  :class="{ invalid: overMax(String(st.enrolmentId), 'theory') }"
                />
              </td>
              <td class="num">
                <input
                  v-model="draft[String(st.enrolmentId)]!.practical"
                  type="number" min="0" :max="sheetData.maxima.practical"
                  :disabled="!sheetData.canEnter || draft[String(st.enrolmentId)]!.absent"
                  :class="{ invalid: overMax(String(st.enrolmentId), 'practical') }"
                />
              </td>
              <td class="num total">{{ totalFor(String(st.enrolmentId)) }}</td>
              <td>
                <input
                  v-model="draft[String(st.enrolmentId)]!.absent"
                  type="checkbox"
                  :disabled="!sheetData.canEnter"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="anyOverMax" class="hint-error">Some marks are above the paper maximum.</p>
        <p v-if="saveError" class="login-error">{{ saveError }}</p>

        <div v-if="sheetData.canEnter" class="save-bar">
          <button class="primary" :disabled="anyOverMax || saveMarks.isPending.value" @click="saveMarks.mutate()">
            <Save :size="16" /> {{ saveMarks.isPending.value ? 'Saving…' : 'Save marks' }}
          </button>
        </div>
      </template>
    </article>

    <!-- Results -->
    <article v-if="results.data.value?.data.length" class="panel">
      <div class="panel-head">
<div>
          <h3>Results</h3>
          <p>
            Published{{ exam.publishedAt ? ` on ${new Date(String(exam.publishedAt)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : '' }}<template v-if="exam.status === 'locked'"> and locked</template>.
          </p>
        </div>
</div>
      <table class="data-table">
        <thead>
          <tr><th class="num">Rank</th><th>Student</th><th class="num">Obtained</th><th class="num">Percentage</th><th>Grade</th><th>Outcome</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in results.data.value.data" :key="String(r.enrolmentId)">
            <td class="num">{{ r.rank }}</td>
            <td><strong>{{ r.name }}</strong></td>
            <td class="num">{{ Number(r.obtained) }} / {{ Number(r.maxMarks) }}</td>
            <td class="num">{{ Number(r.percentage) }}%</td>
            <td>{{ r.grade ?? '—' }}</td>
            <td><span :class="['badge', String(r.outcome)]">{{ r.outcome }}</span></td>
          </tr>
        </tbody>
      </table>
    </article>
  </template>
</template>

<style scoped>
.back-link { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; font-size: 0.86rem; text-decoration: none; color: inherit; opacity: 0.7; }
.status-pill { display: inline-block; padding: 3px 11px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; text-transform: capitalize; background: rgba(148,163,184,0.16); }
.status-pill.mark_entry { background: rgba(59,130,246,0.13); color: #1d4ed8; }
.status-pill.published { background: rgba(22,163,74,0.13); color: #15803d; }
.status-pill.locked { background: rgba(71,85,105,0.16); color: #334155; }

.panel-head select { padding: 8px 11px; border-radius: 9px; border: 1px solid rgba(148,163,184,0.3); background: var(--surface,#fff); font: inherit; font-size: 0.85rem; }

.data-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.data-table th { padding: 9px 12px; text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; border-bottom: 1px solid rgba(148,163,184,0.22); }
.data-table td { padding: 8px 12px; border-bottom: 1px solid rgba(148,163,184,0.12); }
.data-table tbody tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.mono { font-variant-numeric: tabular-nums; opacity: 0.75; }
.total { font-weight: 700; }
.muted { opacity: 0.5; }

.data-table input[type='number'] {
  width: 72px; padding: 6px 8px; text-align: right;
  border-radius: 8px; border: 1px solid rgba(148,163,184,0.34);
  font: inherit; font-variant-numeric: tabular-nums;
}
.data-table input.invalid { border-color: #dc2626; background: rgba(220,38,38,0.05); }
.data-table input:disabled { opacity: 0.45; }

.add-paper { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding-top: 14px; margin-top: 14px; border-top: 1px solid rgba(148,163,184,0.18); }
.add-paper select { padding: 9px 11px; border-radius: 9px; border: 1px solid rgba(148,163,184,0.34); background: var(--surface,#fff); font: inherit; }
.add-paper label { display: grid; gap: 5px; font-size: 0.76rem; font-weight: 600; }
.add-paper label input { width: 84px; padding: 9px 10px; border-radius: 9px; border: 1px solid rgba(148,163,184,0.34); font: inherit; font-weight: 400; }
.add-paper .primary, .save-bar .primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 16px; border: none; border-radius: 9px;
  background: var(--brand,#5b4df7); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.add-paper .primary:disabled, .save-bar .primary:disabled { opacity: 0.5; cursor: default; }

.mini { padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.32); background: none; font: inherit; font-size: 0.8rem; cursor: pointer; }
.save-bar { display: flex; justify-content: flex-end; margin-top: 16px; }
.notice-inline { margin: 0 0 14px; padding: 11px 14px; border-radius: 10px; font-size: 0.86rem; background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.24); color: #1e40af; }
.hint-error { margin: 12px 0 0; font-size: 0.83rem; color: #b91c1c; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.73rem; font-weight: 600; text-transform: capitalize; background: rgba(148,163,184,0.16); }
.badge.pass { background: rgba(22,163,74,0.13); color: #15803d; }
.badge.fail { background: rgba(220,38,38,0.11); color: #b91c1c; }
</style>
