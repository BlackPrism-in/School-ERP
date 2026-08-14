<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-vue-next'
import { onboarding } from '../../api/endpoints'
import { ApiError } from '../../api/client'

const queryClient = useQueryClient()

/**
 * The column names the importer understands. Anything else in the file is
 * ignored rather than rejected — schools keep extra columns and should not
 * have to strip them.
 */
const COLUMNS = [
  'admissionNo', 'firstName', 'lastName', 'dateOfBirth', 'gender',
  'className', 'sectionName', 'rollNo', 'guardianName', 'guardianPhone', 'guardianRelation',
] as const

/** Header aliases, because nobody's spreadsheet uses camelCase. */
const ALIASES: Record<string, string> = {
  'admission no': 'admissionNo', 'admission number': 'admissionNo', 'adm no': 'admissionNo',
  'first name': 'firstName', 'given name': 'firstName', name: 'firstName',
  'last name': 'lastName', surname: 'lastName',
  'date of birth': 'dateOfBirth', dob: 'dateOfBirth',
  sex: 'gender',
  class: 'className', grade: 'className',
  section: 'sectionName', division: 'sectionName',
  'roll no': 'rollNo', roll: 'rollNo', 'roll number': 'rollNo',
  'guardian name': 'guardianName', 'parent name': 'guardianName', father: 'guardianName',
  'guardian phone': 'guardianPhone', 'parent phone': 'guardianPhone', mobile: 'guardianPhone', phone: 'guardianPhone',
  relation: 'guardianRelation', 'guardian relation': 'guardianRelation',
}

const rawText = ref('')
const fileName = ref('')

/** Minimal CSV reader: handles quoted fields and embedded commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 }
        else inQuotes = false
      } else field += char
    } else if (char === '"') inQuotes = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Parsing yields the rows and any problem as one value.
 *
 * This previously assigned to a separate `parseError` ref from inside the
 * computed. Writing reactive state during evaluation is an anti-pattern Vue
 * cannot order reliably — the message could render a tick behind the rows it
 * describes, or not clear at all when the input became valid again.
 */
const parsed = computed<{ rows: Record<string, unknown>[]; error: string }>(() => {
  if (!rawText.value.trim()) return { rows: [], error: '' }

  const table = parseCsv(rawText.value)
  if (table.length < 2) {
    return { rows: [], error: 'The file needs a header row and at least one student.' }
  }

  const header = table[0]!.map((h) => {
    const clean = h.trim()
    if ((COLUMNS as readonly string[]).includes(clean)) return clean
    return ALIASES[clean.toLowerCase()] ?? ''
  })

  if (!header.includes('admissionNo') || !header.includes('firstName')) {
    return {
      rows: [],
      error: 'The file must have at least an admission number and a first name column.',
    }
  }

  const rows = table.slice(1).map((line) => {
    const record: Record<string, unknown> = {}
    header.forEach((key, i) => {
      if (key && line[i] !== undefined) record[key] = (line[i] ?? '').trim()
    })
    // Drop empty optional values so the server treats them as absent.
    for (const key of Object.keys(record)) if (record[key] === '') delete record[key]
    return record
  })

  return { rows, error: '' }
})

const rows = computed(() => parsed.value.rows)
const parseError = computed(() => parsed.value.error)

function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => { rawText.value = String(reader.result ?? '') }
  reader.readAsText(file)
}

type Result = Awaited<ReturnType<typeof onboarding.importStudents>>
const result = ref<Result | null>(null)
const serverError = ref('')

/**
 * Two named actions rather than one mutation taking a boolean. Passing a bare
 * `false` through `mutate()` reads as "off" at the call site with no clue what
 * it toggles — and it silently sent a dry run when a commit was intended.
 */
const mode = ref<'check' | 'commit'>('check')

const run = useMutation({
  mutationFn: () => onboarding.importStudents(rows.value, mode.value === 'check'),
  onSuccess: async (res) => {
    result.value = res
    serverError.value = ''
    if (!res.dryRun && res.imported > 0) {
      await queryClient.invalidateQueries({ queryKey: ['students'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    }
  },
  onError: (caught) => {
    serverError.value = caught instanceof ApiError ? caught.message : 'The import could not be run.'
  },
})

const checked = computed(() => result.value?.dryRun === true && result.value.problems.length === 0)
const committed = computed(() => result.value?.dryRun === false)

function checkFile() {
  mode.value = 'check'
  run.mutate()
}

function commitImport() {
  mode.value = 'commit'
  run.mutate()
}

function reset() {
  rawText.value = ''
  fileName.value = ''
  result.value = null
  serverError.value = ''
}
</script>

<template>
  <RouterLink to="/app/students" class="back-link"><ArrowLeft :size="16" /> All students</RouterLink>

  <div class="page-head">
    <div>
      <p class="eyebrow">Onboarding</p>
      <h1>Import students</h1>
      <p>Upload your spreadsheet as CSV. Nothing is saved until you have seen the check pass.</p>
    </div>
  </div>

  <article v-if="!committed" class="panel">
    <div class="panel-head">
      <div>
        <h3>1 · Choose your file</h3>
        <p>Columns recognised: admission number, first/last name, date of birth, gender, class, section, roll number, guardian name/phone/relation. Extra columns are ignored.</p>
      </div>
    </div>

    <label class="dropzone">
      <FileSpreadsheet :size="26" />
      <span v-if="fileName"><strong>{{ fileName }}</strong> — {{ rows.length }} row{{ rows.length === 1 ? '' : 's' }} read</span>
      <span v-else>Choose a CSV file</span>
      <input type="file" accept=".csv,text/csv" @change="onFile" />
    </label>

    <details class="paste">
      <summary>Or paste the rows directly</summary>
      <textarea v-model="rawText" rows="6" placeholder="admissionNo,firstName,lastName,className,sectionName&#10;ADM-001,Aarav,Mehta,Grade 10,A"></textarea>
    </details>

    <p v-if="parseError" class="login-error">{{ parseError }}</p>
  </article>

  <article v-if="rows.length && !committed" class="panel">
    <div class="panel-head">
      <div>
        <h3>2 · Check before importing</h3>
        <p>A dry run validates every row and writes nothing. If any row is wrong, the whole import is refused — a half-loaded file is worse than none.</p>
      </div>
    </div>

    <div class="preview-wrap">
      <table class="data-table">
        <thead>
          <tr><th v-for="c in Object.keys(rows[0]!)" :key="c">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows.slice(0, 5)" :key="i">
            <td v-for="c in Object.keys(rows[0]!)" :key="c">{{ r[c] ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="rows.length > 5" class="more">…and {{ rows.length - 5 }} more</p>
    </div>

    <div class="actions">
      <button class="secondary" :disabled="run.isPending.value" @click="checkFile">
        {{ run.isPending.value ? 'Checking…' : 'Check file' }}
      </button>
      <button class="primary" :disabled="!checked || run.isPending.value" @click="commitImport">
        <Upload :size="16" /> Import {{ rows.length }} student{{ rows.length === 1 ? '' : 's' }}
      </button>
    </div>
    <p v-if="!checked && result" class="hint">Fix the problems below, then check again.</p>
    <p v-if="serverError" class="login-error">{{ serverError }}</p>
  </article>

  <!-- Outcome -->
  <article v-if="result?.problems.length" class="panel problems">
    <div class="panel-head">
      <div>
        <h3><AlertTriangle :size="17" /> {{ result.summary.problemRows }} row{{ result.summary.problemRows === 1 ? '' : 's' }} need attention</h3>
        <p>Nothing has been saved. Row numbers match your spreadsheet, counting the header as row 1.</p>
      </div>
    </div>
    <table class="data-table">
      <thead><tr><th class="num">Row</th><th>Column</th><th>Problem</th></tr></thead>
      <tbody>
        <tr v-for="(p, i) in result.problems" :key="i">
          <td class="num mono">{{ p.row }}</td>
          <td class="mono">{{ p.field }}</td>
          <td>{{ p.message }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="result.truncatedProblems" class="more">…and {{ result.truncatedProblems }} more problems</p>
  </article>

  <article v-else-if="checked" class="panel ok">
    <CheckCircle2 :size="24" />
    <div>
      <strong>All {{ result!.summary.validRows }} rows are valid</strong>
      <p>Nothing has been saved yet. Use “Import” above to commit them.</p>
    </div>
  </article>

  <article v-if="committed" class="panel ok">
    <CheckCircle2 :size="24" />
    <div>
      <strong>Imported {{ result!.imported }} student{{ result!.imported === 1 ? '' : 's' }}</strong>
      <p>They now appear on the student roster with their class and guardian.</p>
    </div>
    <div class="done-actions">
      <RouterLink class="primary" to="/app/students">View students</RouterLink>
      <button class="secondary" @click="reset">Import another file</button>
    </div>
  </article>
</template>

<style scoped>
.back-link { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; font-size: 0.86rem; text-decoration: none; color: inherit; opacity: 0.7; }

.dropzone {
  display: grid; justify-items: center; gap: 9px;
  padding: 32px 20px; border-radius: 14px; cursor: pointer;
  border: 1px dashed rgba(148,163,184,0.45); text-align: center;
}
.dropzone:hover { border-color: var(--brand,#5b4df7); background: rgba(91,77,247,0.03); }
.dropzone svg { opacity: 0.45; }
.dropzone input { display: none; }
.dropzone span { font-size: 0.9rem; opacity: 0.75; }

.paste { margin-top: 14px; }
.paste summary { font-size: 0.85rem; cursor: pointer; opacity: 0.7; }
.paste textarea {
  width: 100%; margin-top: 10px; padding: 11px 13px;
  border-radius: 10px; border: 1px solid rgba(148,163,184,0.34);
  font-family: ui-monospace, monospace; font-size: 0.82rem;
}

.preview-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(148,163,184,0.2); }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.data-table th { padding: 9px 12px; text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.6; border-bottom: 1px solid rgba(148,163,184,0.22); white-space: nowrap; }
.data-table td { padding: 8px 12px; border-bottom: 1px solid rgba(148,163,184,0.12); white-space: nowrap; }
.data-table tbody tr:last-child td { border-bottom: none; }
.num { text-align: right; }
th.num { text-align: right; }
.mono { font-variant-numeric: tabular-nums; }
.more { margin: 10px 0 0; font-size: 0.82rem; opacity: 0.55; }

.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
.actions button, .done-actions .primary, .done-actions button {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600;
  text-decoration: none; cursor: pointer;
}
.secondary { border: 1px solid rgba(148,163,184,0.34); background: none; color: inherit; }
.primary { border: none; background: var(--brand,#5b4df7); color: #fff; }
.primary:disabled, .secondary:disabled { opacity: 0.5; cursor: default; }
.hint { margin: 10px 0 0; text-align: right; font-size: 0.82rem; opacity: 0.65; }

.panel.problems { border-color: rgba(220,38,38,0.28); }
.panel.problems h3 { display: flex; align-items: center; gap: 8px; color: #b91c1c; }

.panel.ok {
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
  border-color: rgba(22,163,74,0.28); background: rgba(22,163,74,0.05);
}
.panel.ok > svg { color: #15803d; flex: none; }
.panel.ok strong { display: block; margin-bottom: 3px; }
.panel.ok p { margin: 0; font-size: 0.87rem; opacity: 0.75; }
.done-actions { margin-left: auto; display: flex; gap: 10px; }
</style>
