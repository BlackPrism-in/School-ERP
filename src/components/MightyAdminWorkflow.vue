<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  Eye,
  FileBadge,
  FileText,
  Filter,
  Landmark,
  MessageSquareText,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-vue-next'
import type { Role } from '../data'
import { mightyWorkflowMap, type MightyField } from '../mightyWorkflows'

const props = defineProps<{ route: string; role: Role }>()
type RecordValue = string | number
type WorkflowRecord = { id: number; status: string; [key: string]: RecordValue }
type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Leave'

const workflow = computed(() => mightyWorkflowMap[props.route])
const toast = ref('')
const query = ref('')
const statusFilter = ref('All')
const rows = ref<WorkflowRecord[]>([])
const modal = ref<'add' | 'edit' | 'view' | null>(null)
const selected = ref<WorkflowRecord | null>(null)
const form = ref<Record<string, RecordValue>>({})
const filterValues = ref<Record<string, RecordValue>>({})
const filtersApplied = ref(false)
const currentPage = ref(1)
const pageSize = 8
const selectedIds = ref<number[]>([])

const roster = ['Aarav Mehta', 'Diya Kapoor', 'Ishaan Verma', 'Sara Khan', 'Vihaan Joshi', 'Meera Nair']
const attendance = ref<Record<string, AttendanceStatus>>(Object.fromEntries(roster.map((name, index) => [name, index === 2 ? 'Absent' : 'Present'])))
const migrationSelection = ref<string[]>([])
const migrationTarget = ref({ session: '2027–28', className: 'Grade 10', section: 'A', branch: 'East Campus' })
const marks = ref<Record<string, { objective: number; written: number; practical: number }>>(
  Object.fromEntries(roster.map((name, index) => [name, { objective: 18 - index, written: 55 - index * 2, practical: 18 }]))
)
const voucher = ref({ date: '2026-07-26', reference: '', narration: '', lines: [{ ledger: 'Cash Account', debit: 0, credit: 0 }, { ledger: 'Tuition Fee Income', debit: 0, credit: 0 }] })
const collectionStudent = ref('')
const collectionSelected = ref('')
const collectionHeads = ref([
  { name: 'Term II Tuition Fee', amount: 12500, fine: 0, waiver: 0, selected: true },
  { name: 'Transport Fee · July', amount: 4800, fine: 0, waiver: 0, selected: false },
  { name: 'Laboratory Fee', amount: 2200, fine: 150, waiver: 200, selected: false },
])
const collectionGateway = ref('Cash')
const routinePeriods = ref([
  { day: 'Monday', period: '08:30', subject: 'Mathematics', teacher: 'Maya Thomas', room: '204' },
  { day: 'Monday', period: '09:15', subject: 'Science', teacher: 'Ethan Carter', room: 'Lab 2' },
  { day: 'Tuesday', period: '08:30', subject: 'English', teacher: 'Sophia Miller', room: '204' },
  { day: 'Wednesday', period: '10:15', subject: 'Computer Science', teacher: 'Liam Davis', room: 'IT Lab' },
])
const routineForm = ref({ day: 'Monday', period: '11:15', subject: 'Science', teacher: 'Ethan Carter', room: 'Lab 2' })
const certificate = ref({ student: '', purpose: '', issueDate: new Date().toISOString().slice(0, 10), generated: false })
const question = ref({ question: '', type: 'Multiple Choice', marks: 1, difficulty: 'Moderate', optionA: '', optionB: '', optionC: '', optionD: '', correct: 'A', explanation: '' })
const chatInput = ref('')
const chatMessages = ref([
  { role: 'assistant', text: 'Hello! I can help with lesson plans, notices, reports and administrative writing.' },
])
const settingsValues = ref<Record<string, RecordValue>>({})
const libraryMember = ref('')
const libraryBook = ref('')
const libraryIssueDate = ref(new Date().toISOString().slice(0, 10))
const libraryDueDate = ref(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10))

const storageKey = computed(() => `edunova:mighty:workflow:${props.route}`)
const recordStorageKey = computed(() => props.route === 'books-return' ? 'edunova:mighty:workflow:books-issue' : storageKey.value)
const canManage = computed(() => props.role !== 'superadmin' || !['student-list', 'teacher-list', 'staff-list'].includes(props.route))

const examples: Record<string, string[]> = {
  branch: ['Main Campus', 'East Campus', 'Junior Campus'],
  'student-list': ['Aarav Mehta', 'Diya Kapoor', 'Ishaan Verma'],
  'all-student-list': ['Aarav Mehta', 'Anaya Sharma', 'Kabir Singh'],
  'teacher-list': ['Ethan Carter', 'Maya Thomas', 'Sophia Miller'],
  'staff-list': ['Olivia Martin', 'Raj Kumar', 'Nisha Verma'],
  'academic-session': ['2026–27', '2025–26', '2024–25'],
  shift: ['Morning Shift', 'Day Shift', 'Evening Activities'],
  class: ['Grade 10', 'Grade 9', 'Grade 8'],
  section: ['Section A', 'Section B', 'Section C'],
  group: ['Science', 'Commerce', 'Humanities'],
  period: ['Period 1', 'Period 2', 'Period 3'],
  subjects: ['Mathematics', 'Science', 'English Literature'],
  syllabus: ['Grade 10 Mathematics', 'Grade 9 Science', 'Grade 8 English'],
  assignments: ['Quadratic Equations', 'Cell Structure Lab Report', 'Merchant of Venice'],
  books: ['The Alchemist', 'A Brief History of Time', 'Oxford School Atlas'],
  'book-categories': ['Fiction', 'Science', 'Reference'],
  exam: ['Term I Examination', 'Mathematics Unit Test', 'Science Practical'],
  notice: ['Annual Sports Day 2026', 'Library Maintenance', 'Parent–Teacher Meeting'],
  event: ['Science Exhibition', 'Annual Sports Day', 'Parent Orientation'],
  ledger: ['Cash Account', 'Tuition Fee Income', 'Transport Expense'],
  fund: ['General Fund', 'Development Fund', 'Scholarship Fund'],
  'question-category': ['CBSE Main', 'Practice Bank', 'Olympiad'],
  hostels: ['North Residence', 'Girls Residence', 'Junior Residence'],
  'transport-buses': ['Bus 01 · DL-01-AB-2486', 'Bus 02 · DL-01-AC-1842', 'Bus 03 · DL-01-AD-7631'],
}

function defaultRecord(name: string, index: number): WorkflowRecord {
  const record: WorkflowRecord = { id: 1000 + index, status: workflow.value.statuses[index % Math.min(2, workflow.value.statuses.length)] }
  workflow.value.fields.forEach((field) => {
    if (field.key === 'name' || field.key === 'title' || field.key === 'firstName') record[field.key] = name
    else if (field.key === 'lastName') record[field.key] = index === 0 ? 'Mehta' : index === 1 ? 'Kapoor' : 'Verma'
    else if (field.type === 'number') record[field.key] = field.key.toLowerCase().includes('mark') ? 100 : 10 + index
    else if (field.type === 'date') record[field.key] = `2026-07-${String(20 + index).padStart(2, '0')}`
    else if (field.type === 'time') record[field.key] = `0${8 + index}:30`
    else if (field.type === 'select') record[field.key] = field.options?.[index % (field.options?.length || 1)] || ''
    else if (field.type === 'file') record[field.key] = `${props.route}-${index + 1}.pdf`
    else record[field.key] = field.key.toLowerCase().includes('code') || field.key.toLowerCase().includes('no') ? `${props.route.slice(0, 4).toUpperCase()}-${String(index + 1).padStart(3, '0')}` : `${field.label} ${index + 1}`
  })
  if (!Object.keys(record).some((key) => ['name', 'title', 'firstName'].includes(key))) record.name = name
  return record
}

function loadWorkflow() {
  const names = examples[props.route] || [`${workflow.value.title} 01`, `${workflow.value.title} 02`, `${workflow.value.title} 03`]
  try {
    rows.value = JSON.parse(localStorage.getItem(recordStorageKey.value) || 'null') || names.map(defaultRecord)
  } catch {
    rows.value = names.map(defaultRecord)
  }
  query.value = ''
  statusFilter.value = 'All'
  selectedIds.value = []
  currentPage.value = 1
  filtersApplied.value = !workflow.value.filters?.length
  filterValues.value = Object.fromEntries((workflow.value.filters || []).map((field) => [field.key, field.type === 'date' ? new Date().toISOString().slice(0, 10) : field.options?.[0] || '']))
  try {
    settingsValues.value = JSON.parse(localStorage.getItem(`${storageKey.value}:configuration`) || 'null') || emptyForm()
  } catch {
    settingsValues.value = emptyForm()
  }
  modal.value = null
}
watch(() => props.route, loadWorkflow, { immediate: true })

function persist(message: string) {
  localStorage.setItem(recordStorageKey.value, JSON.stringify(rows.value))
  notify(message)
}
function notify(message: string) {
  toast.value = message
  window.setTimeout(() => { if (toast.value === message) toast.value = '' }, 2300)
}
function emptyForm() {
  return {
    ...Object.fromEntries(workflow.value.fields.map((field) => [field.key, field.type === 'number' ? 0 : field.type === 'date' ? new Date().toISOString().slice(0, 10) : field.options?.[0] || ''])),
    status: workflow.value.statuses[0],
  }
}
function openAdd() {
  if (workflow.value.kind === 'report') { filtersApplied.value = true; notify('Report generated successfully'); return }
  if (workflow.value.kind === 'backup') { createBackup(); return }
  form.value = emptyForm()
  selected.value = null
  modal.value = 'add'
}
function openEdit(record: WorkflowRecord) {
  form.value = Object.fromEntries(workflow.value.fields.map((field) => [field.key, record[field.key] ?? '']))
  selected.value = record
  modal.value = 'edit'
}
function openView(record: WorkflowRecord) { selected.value = record; modal.value = 'view' }
function save() {
  if (modal.value === 'add') rows.value.unshift({ id: Date.now(), status: workflow.value.statuses[0], ...form.value })
  else if (selected.value) Object.assign(selected.value, form.value)
  const created = modal.value === 'add'
  modal.value = null
  persist(created ? `${workflow.value.title} added` : 'Changes saved')
}
function remove(record: WorkflowRecord) {
  if (!window.confirm(`Delete this ${workflow.value.title.toLowerCase()} record?`)) return
  rows.value = rows.value.filter((item) => item.id !== record.id)
  persist('Record deleted')
}
function fieldValue(record: WorkflowRecord, field: MightyField) {
  const value = record[field.key]
  if (field.type === 'date' && value) return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return String(value ?? '—') || '—'
}
const filteredRows = computed(() => rows.value.filter((record) => (statusFilter.value === 'All' || record.status === statusFilter.value) && Object.values(record).some((value) => String(value).toLowerCase().includes(query.value.toLowerCase()))))
const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)))
const pagedRows = computed(() => filteredRows.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize))
const tableFields = computed(() => workflow.value.fields.filter((field) => field.type !== 'textarea' && field.type !== 'file').slice(0, 4))
const collectionTotal = computed(() => collectionHeads.value.filter((item) => item.selected).reduce((sum, item) => sum + item.amount + item.fine - item.waiver, 0))
const voucherDebit = computed(() => voucher.value.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0))
const voucherCredit = computed(() => voucher.value.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0))

function saveAttendance() {
  localStorage.setItem(`edunova:mighty:${props.route}:${filterValues.value.date}`, JSON.stringify(attendance.value))
  notify('Attendance saved successfully')
}
function executeMigration() {
  if (!migrationSelection.value.length) { notify('Select at least one student'); return }
  rows.value.unshift({ id: Date.now(), name: `${migrationSelection.value.length} students`, target: `${migrationTarget.value.session} · ${migrationTarget.value.className} ${migrationTarget.value.section}`, status: 'Completed' })
  migrationSelection.value = []
  persist('Student migration completed')
}
function submitVoucher() {
  if (!voucher.value.reference.trim() || voucherDebit.value <= 0 || voucherDebit.value !== voucherCredit.value) { notify('Voucher must be balanced and include a reference'); return }
  rows.value.unshift({ id: Date.now(), name: voucher.value.reference, amount: voucherDebit.value, date: voucher.value.date, narration: voucher.value.narration, status: 'Posted' })
  voucher.value = { date: new Date().toISOString().slice(0, 10), reference: '', narration: '', lines: [{ ledger: 'Cash Account', debit: 0, credit: 0 }, { ledger: 'Tuition Fee Income', debit: 0, credit: 0 }] }
  persist(`${workflow.value.title} voucher posted`)
}
function completeCollection() {
  if (!collectionSelected.value || !collectionTotal.value) { notify('Select a student and at least one fee head'); return }
  rows.value.unshift({ id: Date.now(), name: collectionSelected.value, amount: collectionTotal.value, gateway: collectionGateway.value, status: 'Paid' })
  collectionHeads.value.forEach((head) => head.selected = false)
  persist('Fee collected and receipt generated')
}
function addRoutinePeriod() {
  routinePeriods.value.push({ ...routineForm.value })
  localStorage.setItem(`edunova:mighty:routine:${props.route}`, JSON.stringify(routinePeriods.value))
  notify('Routine period added')
}
function saveMarks() {
  localStorage.setItem(`edunova:mighty:marks:${JSON.stringify(filterValues.value)}`, JSON.stringify(marks.value))
  notify('Marks submitted successfully')
}
function generateCertificate() {
  if (!certificate.value.student) { notify('Select a student first'); return }
  certificate.value.generated = true
  notify('Certificate generated')
}
function downloadCertificate() {
  const link = document.createElement('a')
  const content = `${workflow.value.title}\n\nThis is to certify that ${certificate.value.student} is a bonafide student of EduNova Academy.\n${certificate.value.purpose}\nIssue date: ${certificate.value.issueDate}`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  link.href = url; link.download = `${props.route}-${certificate.value.student.replaceAll(' ', '-')}.txt`; link.click(); URL.revokeObjectURL(url)
  notify('Certificate downloaded')
}
function saveQuestion() {
  if (!question.value.question.trim()) return
  rows.value.unshift({ id: Date.now(), name: question.value.question, type: question.value.type, marks: question.value.marks, difficulty: question.value.difficulty, status: 'Active' })
  question.value = { question: '', type: 'Multiple Choice', marks: 1, difficulty: 'Moderate', optionA: '', optionB: '', optionC: '', optionD: '', correct: 'A', explanation: '' }
  persist('Question saved to bank')
}
function saveSettings() {
  localStorage.setItem(`${storageKey.value}:configuration`, JSON.stringify(settingsValues.value))
  notify(`${workflow.value.title} saved successfully`)
}
function issueBook() {
  if (!libraryMember.value.trim() || !libraryBook.value.trim()) {
    notify('Select a member and book')
    return
  }
  rows.value.unshift({
    id: Date.now(),
    issueNo: `ISS-${String(Date.now()).slice(-5)}`,
    member: libraryMember.value,
    book: libraryBook.value,
    issueDate: libraryIssueDate.value,
    dueDate: libraryDueDate.value,
    status: 'Issued',
  })
  libraryMember.value = ''
  libraryBook.value = ''
  persist('Book issued successfully')
}
function returnBook(record: WorkflowRecord) {
  record.status = 'Returned'
  record.returnDate = new Date().toISOString().slice(0, 10)
  const due = new Date(`${String(record.dueDate)}T00:00:00`)
  record.fine = Math.max(0, Math.ceil((Date.now() - due.getTime()) / 86400000) * 10)
  persist('Book returned successfully')
}
function createBackup() {
  const data: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (key?.startsWith('edunova')) data[key] = localStorage.getItem(key) || '' }
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([JSON.stringify({ createdAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' }))
  link.href = url; link.download = `edunova-database-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url)
  notify('Data backup created successfully')
}
function sendChat() {
  const message = chatInput.value.trim()
  if (!message) return
  chatMessages.value.push({ role: 'user', text: message })
  chatInput.value = ''
  window.setTimeout(() => chatMessages.value.push({ role: 'assistant', text: `Draft ready: ${message}. Review the wording and adapt any school-specific details before publishing.` }), 350)
}
function exportRows() {
  const headers = ['Status', ...tableFields.value.map((field) => field.label)]
  const csv = [headers, ...filteredRows.value.map((record) => [record.status, ...tableFields.value.map((field) => record[field.key])])].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv' }))
  link.href = url; link.download = `${props.route}.csv`; link.click(); URL.revokeObjectURL(url); notify('Report downloaded')
}
</script>

<template>
  <div class="mighty-admin-workflow">
    <div class="page-head">
      <div><p class="eyebrow">Mighty workflow · {{ role === 'teacher' ? 'Permission scoped' : 'Administration' }}</p><h1>{{ workflow.title }}</h1><p>{{ workflow.description }}</p></div>
      <div class="page-actions">
        <button v-if="!['attendance','marks','collection','voucher','routine','certificate','library','settings','question','backup','ai'].includes(workflow.kind)" class="secondary" @click="exportRows"><Download :size="15" /> Export</button>
        <button v-if="!['attendance','marks','collection','voucher','routine','certificate','library','settings','question','backup','ai'].includes(workflow.kind)" class="primary" @click="openAdd"><FileText v-if="workflow.kind==='report'" :size="15" /><Plus v-else :size="15" />{{ workflow.primaryAction }}</button>
      </div>
    </div>

    <section v-if="workflow.filters?.length" class="mighty-filter-panel">
      <div v-for="field in workflow.filters" :key="field.key"><label>{{ field.label }}</label><select v-if="field.type==='select'" v-model="filterValues[field.key]"><option v-for="option in field.options" :key="option">{{ option }}</option></select><input v-else v-model="filterValues[field.key]" :type="field.type" /></div>
      <button class="primary" @click="filtersApplied=true;notify('Records loaded')"><Filter :size="14" /> Search</button>
    </section>

    <template v-if="workflow.kind==='attendance'">
      <article class="mighty-roster">
        <div class="mighty-roster-head"><span>Student / staff</span><span>ID</span><span>Attendance status</span></div>
        <div v-for="(name,index) in roster" :key="name" class="mighty-roster-row"><div><span class="student-avatar">{{ name[0] }}</span><strong>{{ name }}</strong></div><span>#{{ String(index+1).padStart(3,'0') }}</span><div><button v-for="status in (['Present','Absent','Late','Leave'] as AttendanceStatus[])" :key="status" :class="{selected:attendance[name]===status}" @click="attendance[name]=status">{{ status }}</button></div></div>
        <div class="mighty-sticky-actions"><span>{{ Object.values(attendance).filter(item=>item==='Present').length }} present · {{ Object.values(attendance).filter(item=>item==='Absent').length }} absent</span><button class="primary" @click="saveAttendance"><Check :size="15" /> Save Attendance</button></div>
      </article>
    </template>

    <template v-else-if="workflow.kind==='migration'">
      <section class="migration-layout">
        <article><h3>Students in source class</h3><label v-for="name in roster" :key="name"><input v-model="migrationSelection" type="checkbox" :value="name" /><span class="student-avatar">{{ name[0] }}</span><span><strong>{{ name }}</strong><small>Grade 9 B · Roll {{ roster.indexOf(name)+1 }}</small></span></label></article>
        <article class="migration-target"><Sparkles :size="22" /><h3>Migration destination</h3><label>Target session<select v-model="migrationTarget.session"><option>2027–28</option><option>2026–27</option></select></label><label>Target class<select v-model="migrationTarget.className"><option>Grade 10</option><option>Grade 9</option></select></label><label>Target section<select v-model="migrationTarget.section"><option>A</option><option>B</option></select></label><label v-if="route==='student-branch-migration'">Target branch<select v-model="migrationTarget.branch"><option>East Campus</option><option>Junior Campus</option></select></label><button class="primary" @click="executeMigration">{{ route==='migration-pushback'?'Push students back':'Complete migration' }} <ArrowRight :size="15" /></button></article>
      </section>
    </template>

    <template v-else-if="workflow.kind==='collection'">
      <section class="smart-collection-layout">
        <article class="student-search-card"><h3>Find Student</h3><div class="table-search"><Search :size="15" /><input v-model="collectionStudent" placeholder="Student name, roll or admission number" /></div><button v-for="name in roster.filter(item=>item.toLowerCase().includes(collectionStudent.toLowerCase())).slice(0,4)" :key="name" :class="{selected:collectionSelected===name}" @click="collectionSelected=name"><span class="student-avatar">{{ name[0] }}</span><span><strong>{{ name }}</strong><small>Grade 10 A · STU-{{ 840+roster.indexOf(name) }}</small></span></button></article>
        <article class="fee-head-card"><h3>Mapped Fee Heads</h3><label v-for="head in collectionHeads" :key="head.name"><input v-model="head.selected" type="checkbox" /><span><strong>{{ head.name }}</strong><small>Fine ₹{{ head.fine }} · Waiver ₹{{ head.waiver }}</small></span><b>₹{{ (head.amount+head.fine-head.waiver).toLocaleString('en-IN') }}</b></label><div class="collection-total"><span>Total payable</span><strong>₹{{ collectionTotal.toLocaleString('en-IN') }}</strong></div><label class="gateway-select">Payment method<select v-model="collectionGateway"><option>Cash</option><option>Bank</option><option>Razorpay</option><option>Stripe</option></select></label><button class="primary" @click="completeCollection"><CircleDollarSign :size="16" /> Collect & Generate Receipt</button></article>
      </section>
    </template>

    <template v-else-if="workflow.kind==='voucher'">
      <article class="voucher-card"><div class="voucher-top"><label>Voucher date<input v-model="voucher.date" type="date" /></label><label>Reference<input v-model="voucher.reference" placeholder="Voucher reference" /></label></div><label>Narration<textarea v-model="voucher.narration" placeholder="Transaction narration"></textarea></label><div class="voucher-lines"><div class="voucher-line-head"><span>Ledger</span><span>Debit</span><span>Credit</span><span></span></div><div v-for="(line,index) in voucher.lines" :key="index" class="voucher-line"><select v-model="line.ledger"><option>Cash Account</option><option>Bank Account</option><option>Tuition Fee Income</option><option>Transport Expense</option><option>General Fund</option></select><input v-model.number="line.debit" type="number" min="0" /><input v-model.number="line.credit" type="number" min="0" /><button @click="voucher.lines.splice(index,1)"><Trash2 :size="14" /></button></div><button class="secondary" @click="voucher.lines.push({ledger:'Cash Account',debit:0,credit:0})"><Plus :size="14" /> Add line</button></div><div :class="['voucher-balance',{balanced:voucherDebit===voucherCredit&&voucherDebit>0}]"><span>Total debit <b>₹{{ voucherDebit.toLocaleString('en-IN') }}</b></span><span>Total credit <b>₹{{ voucherCredit.toLocaleString('en-IN') }}</b></span><strong>{{ voucherDebit===voucherCredit&&voucherDebit>0?'Balanced':'Not balanced' }}</strong></div><button class="primary" @click="submitVoucher"><Landmark :size="15" /> Post {{ workflow.title }}</button></article>
    </template>

    <template v-else-if="workflow.kind==='routine'">
      <section class="routine-editor"><article class="routine-board"><div v-for="day in ['Monday','Tuesday','Wednesday','Thursday','Friday']" :key="day"><h4>{{ day }}</h4><button v-for="period in routinePeriods.filter(item=>item.day===day)" :key="period.period"><time>{{ period.period }}</time><strong>{{ period.subject }}</strong><span>{{ period.teacher }} · {{ period.room }}</span></button></div></article><form class="routine-add-card" @submit.prevent="addRoutinePeriod"><h3>Add Routine Period</h3><label>Day<select v-model="routineForm.day"><option v-for="day in ['Monday','Tuesday','Wednesday','Thursday','Friday']">{{ day }}</option></select></label><label>Period time<input v-model="routineForm.period" type="time" /></label><label>Subject<select v-model="routineForm.subject"><option v-for="subject in ['Mathematics','Science','English','Computer Science']">{{ subject }}</option></select></label><label>Teacher<input v-model="routineForm.teacher" /></label><label>Room<input v-model="routineForm.room" /></label><button class="primary">Add Period</button></form></section>
    </template>

    <template v-else-if="workflow.kind==='marks'">
      <article v-if="route==='mark-input'" class="marks-entry-card"><div class="marks-head"><span>Student</span><span>Objective / 20</span><span>Written / 60</span><span>Practical / 20</span><span>Total / 100</span></div><div v-for="name in roster" :key="name" class="marks-row"><strong>{{ name }}</strong><input v-model.number="marks[name].objective" type="number" min="0" max="20" /><input v-model.number="marks[name].written" type="number" min="0" max="60" /><input v-model.number="marks[name].practical" type="number" min="0" max="20" /><b>{{ marks[name].objective+marks[name].written+marks[name].practical }}</b></div><div class="mighty-sticky-actions"><span>{{ roster.length }} students loaded</span><button class="primary" @click="saveMarks">Submit Marks</button></div></article>
      <article v-else class="result-process-card"><FileText :size="30" /><h2>{{ route==='mark-sheet'?'Generate Mark Sheet':'Process Exam Result' }}</h2><p>Use the exam, class, section and student filters above, then generate the final academic document.</p><button class="primary" @click="notify(route==='mark-sheet'?'Mark sheet generated':'Results processed and published')">{{ route==='mark-sheet'?'Generate Mark Sheet':'Process & Publish' }}</button></article>
    </template>

    <template v-else-if="workflow.kind==='library'">
      <section v-if="route==='books-issue'" class="library-workflow-layout">
        <article class="library-catalog-card">
          <div><BookOpen :size="22" /><span><h3>Available Books</h3><p>Search the catalogue and select a book to issue.</p></span></div>
          <div class="table-search"><Search :size="15" /><input v-model="query" placeholder="Search title, ISBN or author" /></div>
          <button v-for="book in ['The Alchemist','Oxford School Atlas','A Brief History of Time','NCERT Mathematics X']" :key="book" :class="{selected:libraryBook===book}" @click="libraryBook=book"><span><strong>{{ book }}</strong><small>{{ book==='The Alchemist'?'Paulo Coelho':'School Library Catalogue' }}</small></span><i>Available</i></button>
        </article>
        <form class="library-issue-card" @submit.prevent="issueBook">
          <BookOpen :size="25" /><h3>Issue Book</h3>
          <label>Member<select v-model="libraryMember" required><option value="" disabled>Select member</option><option v-for="name in roster" :key="name">{{ name }}</option></select></label>
          <label>Selected book<input v-model="libraryBook" required placeholder="Choose from the catalogue" /></label>
          <label>Issue date<input v-model="libraryIssueDate" type="date" required /></label>
          <label>Due date<input v-model="libraryDueDate" type="date" required /></label>
          <div class="library-policy"><ShieldCheck :size="15" /><span><strong>Issue policy</strong><small>14-day loan · ₹10 daily overdue fine</small></span></div>
          <button class="primary"><Check :size="15" /> Issue Book</button>
        </form>
      </section>
      <article v-else class="library-return-card">
        <div class="table-tools"><div class="table-search"><Search :size="15" /><input v-model="query" placeholder="Search issue number, member or book" /></div></div>
        <div class="library-return-head"><span>Issue</span><span>Member & book</span><span>Issue date</span><span>Due date</span><span>Status</span><span></span></div>
        <div v-for="record in filteredRows" :key="record.id" class="library-return-row"><strong>{{ record.issueNo || `ISS-${record.id}` }}</strong><span><b>{{ record.member || record.name }}</b><small>{{ record.book || 'Library book' }}</small></span><span>{{ record.issueDate }}</span><span>{{ record.dueDate }}</span><i :class="['status-pill',String(record.status).toLowerCase()]">{{ record.status }}</i><button v-if="record.status!=='Returned'" class="primary" @click="returnBook(record)">Return Book</button><span v-else>Fine ₹{{ record.fine || 0 }}</span></div>
      </article>
    </template>

    <template v-else-if="workflow.kind==='settings'">
      <form class="settings-workflow-card" @submit.prevent="saveSettings">
        <div class="settings-workflow-intro"><span><ShieldCheck :size="24" /></span><div><h2>{{ workflow.title }}</h2><p>These values control the matching Mighty School configuration flow.</p></div></div>
        <div class="settings-workflow-grid">
          <label v-for="field in workflow.fields" :key="field.key" :class="{wide:field.type==='textarea'}">{{ field.label }}
            <textarea v-if="field.type==='textarea'" v-model="settingsValues[field.key]" :required="field.required"></textarea>
            <select v-else-if="field.type==='select'" v-model="settingsValues[field.key]" :required="field.required"><option v-for="option in field.options" :key="option">{{ option }}</option></select>
            <input v-else v-model="settingsValues[field.key]" :type="field.type" :required="field.required" />
          </label>
        </div>
        <div class="settings-save-row"><span><ShieldCheck :size="14" /> Configuration is stored for this workspace.</span><button class="primary"><Check :size="15" /> Save Configuration</button></div>
      </form>
    </template>

    <template v-else-if="workflow.kind==='certificate'">
      <section class="certificate-layout"><form @submit.prevent="generateCertificate"><FileBadge :size="25" /><h2>{{ workflow.title }}</h2><label>Student<select v-model="certificate.student" required><option value="" disabled>Select student</option><option v-for="name in roster">{{ name }}</option></select></label><label>Issue date<input v-model="certificate.issueDate" type="date" required /></label><label>Purpose / remarks<textarea v-model="certificate.purpose"></textarea></label><button class="primary">Generate Certificate</button></form><article :class="{ready:certificate.generated}"><div class="certificate-brand">E</div><small>EDUNOVA ACADEMY</small><h2>{{ workflow.title }}</h2><p>This is to certify that <strong>{{ certificate.student || 'Student Name' }}</strong> is a bonafide student of EduNova Academy.</p><p>{{ certificate.purpose || 'The requested certificate details will appear here.' }}</p><div class="certificate-sign"><span>Issue date<br><b>{{ certificate.issueDate }}</b></span><span>Principal signature<br><b>Dr. James Wilson</b></span></div><button v-if="certificate.generated" class="secondary" @click="downloadCertificate"><Download :size="14" /> Download</button></article></section>
    </template>

    <template v-else-if="workflow.kind==='question'">
      <section class="question-builder"><form @submit.prevent="saveQuestion"><h2>{{ route==='question-paper'?'Question Paper Builder':'Create Question' }}</h2><label>Question<textarea v-model="question.question" required placeholder="Write the question…"></textarea></label><div><label>Question type<select v-model="question.type"><option>Multiple Choice</option><option>Short Answer</option><option>Essay</option><option>True / False</option></select></label><label>Difficulty<select v-model="question.difficulty"><option>Easy</option><option>Moderate</option><option>Advanced</option></select></label><label>Marks<input v-model.number="question.marks" type="number" min="1" /></label></div><template v-if="question.type==='Multiple Choice'"><div class="option-grid"><label>Option A<input v-model="question.optionA" required /></label><label>Option B<input v-model="question.optionB" required /></label><label>Option C<input v-model="question.optionC" required /></label><label>Option D<input v-model="question.optionD" required /></label></div><label>Correct answer<select v-model="question.correct"><option>A</option><option>B</option><option>C</option><option>D</option></select></label></template><label>Answer explanation<textarea v-model="question.explanation"></textarea></label><button class="primary">Save Question</button></form><article><h3>Question Bank</h3><div v-for="record in rows.slice(0,6)" :key="record.id"><span><FileText :size="15" /></span><p><strong>{{ record.name }}</strong><small>{{ record.type || 'Question' }} · {{ record.marks || 1 }} mark</small></p><i class="status-pill active">{{ record.status }}</i></div></article></section>
    </template>

    <template v-else-if="workflow.kind==='backup'">
      <article class="backup-workflow"><Database :size="38" /><h2>Database Backup</h2><p>Create a complete downloadable backup of all EduNova ERP data stored in this workspace.</p><div><ShieldCheck :size="18" /><span><strong>Backup scope</strong><small>Academic, students, fees, accounting, exams, library and configuration</small></span></div><button class="primary" @click="createBackup"><Download :size="15" /> Create & Download Backup</button></article>
    </template>

    <template v-else-if="workflow.kind==='ai'">
      <article class="ai-workspace"><div class="ai-head"><span><Bot :size="21" /></span><div><h3>EduNova AI</h3><p>Administrative and teaching assistant</p></div></div><div class="ai-thread"><div v-for="(message,index) in chatMessages" :key="index" :class="['ai-message',message.role]"><span>{{ message.role==='assistant'?'AI':'You' }}</span><p>{{ message.text }}</p></div></div><form @submit.prevent="sendChat"><textarea v-model="chatInput" required placeholder="Ask for a notice, lesson plan, report summary…"></textarea><button class="primary"><Send :size="15" /> Send</button></form></article>
    </template>

    <template v-else>
      <article class="data-panel mighty-data-panel">
        <div class="table-tools"><div class="table-search"><Search :size="15" /><input v-model="query" :placeholder="`Search ${workflow.title.toLowerCase()}…`" /></div><div class="filter-wrap"><Filter :size="14" /><select v-model="statusFilter"><option>All</option><option v-for="status in workflow.statuses">{{ status }}</option></select></div><button class="secondary compact" @click="loadWorkflow"><RefreshCw :size="14" /> Refresh</button></div>
        <div class="table-scroll"><table><thead><tr><th v-for="field in tableFields" :key="field.key">{{ field.label }}</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="record in pagedRows" :key="record.id"><td v-for="(field,index) in tableFields" :key="field.key"><div v-if="index===0" class="record-cell"><span>{{ fieldValue(record,field)[0] }}</span><div><strong>{{ fieldValue(record,field) }}</strong><small>#{{ record.id }}</small></div></div><span v-else>{{ fieldValue(record,field) }}</span></td><td><span :class="['status-pill',String(record.status).toLowerCase()]">{{ record.status }}</span></td><td><div class="row-actions"><button @click="openView(record)"><Eye :size="14" /></button><button v-if="canManage" @click="openEdit(record)"><Pencil :size="14" /></button><button v-if="canManage" @click="remove(record)"><Trash2 :size="14" /></button></div></td></tr><tr v-if="!pagedRows.length"><td :colspan="tableFields.length+2" class="empty-table"><Search :size="25" /><strong>No records found</strong><span>Change the search or add a new record.</span></td></tr></tbody></table></div><div class="table-footer"><span>Showing {{ pagedRows.length }} of {{ filteredRows.length }}</span><div><button :disabled="currentPage===1" @click="currentPage--"><ChevronLeft :size="14" /></button><button class="current">{{ currentPage }}</button><button :disabled="currentPage===totalPages" @click="currentPage++"><ChevronRight :size="14" /></button></div></div>
      </article>
    </template>

    <div v-if="modal" class="modal-backdrop" @click.self="modal=null"><div class="record-modal mighty-record-modal"><div class="modal-head"><div><p>{{ modal==='view'?'RECORD DETAILS':modal==='edit'?'UPDATE RECORD':'CREATE RECORD' }}</p><h2>{{ workflow.title }}</h2></div><button @click="modal=null"><X :size="18" /></button></div><template v-if="modal==='view'&&selected"><div class="detail-hero"><span>{{ String(selected[tableFields[0]?.key]||workflow.title)[0] }}</span><div><h3>{{ selected[tableFields[0]?.key] }}</h3><p>#{{ selected.id }}</p></div><i :class="['status-pill',String(selected.status).toLowerCase()]">{{ selected.status }}</i></div><div class="mighty-detail-list"><div v-for="field in workflow.fields" :key="field.key"><small>{{ field.label }}</small><strong>{{ fieldValue(selected,field) }}</strong></div></div><div class="modal-actions"><button class="secondary" @click="modal=null">Close</button><button v-if="canManage" class="primary" @click="openEdit(selected)">Edit</button></div></template><form v-else class="mighty-dynamic-form" @submit.prevent="save"><label v-for="field in workflow.fields" :key="field.key" :class="{wide:field.type==='textarea'}">{{ field.label }}<textarea v-if="field.type==='textarea'" v-model="form[field.key]" :required="field.required"></textarea><select v-else-if="field.type==='select'" v-model="form[field.key]" :required="field.required"><option v-for="option in field.options">{{ option }}</option></select><input v-else v-model="form[field.key]" :type="field.type" :required="field.required" /></label><label>Status<select v-model="form.status"><option v-for="status in workflow.statuses">{{ status }}</option></select></label><div class="modal-actions"><button type="button" class="secondary" @click="modal=null">Cancel</button><button class="primary">{{ modal==='edit'?'Save Changes':'Create' }}</button></div></form></div></div>
    <Transition name="toast"><div v-if="toast" class="app-toast"><CheckCircle2 :size="18" />{{ toast }}</div></Transition>
  </div>
</template>
