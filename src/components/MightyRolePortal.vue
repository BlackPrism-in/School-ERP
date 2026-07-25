<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  FileText,
  GraduationCap,
  Library,
  LockKeyhole,
  MapPin,
  Megaphone,
  Paperclip,
  ReceiptText,
  Send,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-vue-next'
import type { Role } from '../data'

const props = defineProps<{ route: string; role: Role }>()
const emit = defineEmits<{ navigate: [route: string] }>()

type Assignment = {
  id: number
  title: string
  subject: string
  description: string
  deadline: string
  fullMark: number
  passMark: number
  status: 'Assigned' | 'Submitted' | 'Reviewed'
  attachment: string
  submission?: string
  submittedAt?: string
}
type Fee = {
  id: number
  invoice: string
  head: string
  amount: number
  fine: number
  waiver: number
  date: string
  status: 'Paid' | 'Unpaid'
}

const children = [
  { id: 1, name: 'Aarav Mehta', className: 'Grade 10', section: 'A', roll: '01', group: 'Science', attendance: 96.25, monthly: 94.8, tasks: 3, exams: 2 },
  { id: 2, name: 'Anaya Mehta', className: 'Grade 6', section: 'B', roll: '12', group: 'General', attendance: 93.5, monthly: 95.1, tasks: 2, exams: 1 },
]
const selectedChildId = ref(Number(localStorage.getItem('edunova:mighty:default-child') || 1))
const selectedChild = computed(() => children.find((item) => item.id === selectedChildId.value) || children[0])
const isParent = computed(() => props.role === 'guardian')
const toast = ref('')
const activeDay = ref('Monday')
const feeTab = ref<'Paid' | 'Unpaid'>('Paid')
const assignmentTab = ref<'Assigned' | 'Submitted'>('Assigned')
const selectedExam = ref<(typeof exams)[number] | null>(null)
const selectedAssignment = ref<Assignment | null>(null)
const submissionOpen = ref(false)
const submissionText = ref('')
const submissionFile = ref('')
const paymentOpen = ref(false)
const paymentFee = ref<Fee | null>(null)
const paymentGateway = ref('Razorpay')
const passwordForm = ref({ current: '', next: '', confirm: '' })

const titles: Record<string, [string, string]> = {
  'parent-routine': ['Class Routine', 'Day-wise class periods for the selected child.'],
  'student-routine': ['Class Routine', 'Your day-wise class periods.'],
  'parent-fees': ['Fees', 'Paid and unpaid fee information for the selected child.'],
  'student-fees': ['Fees', 'Your paid and unpaid fee information.'],
  'parent-fee-payment': ['Fees Payment', 'Review mapped fee heads and complete a secure payment.'],
  'parent-library': ['Library', 'Book issue and return history for the selected child.'],
  'student-library': ['Library', 'Your current and previous library issues.'],
  'parent-assignment': ['Assignment', 'Assigned and submitted homework for the selected child.'],
  'student-assignment': ['Assignment', 'Review assignment details and submit your work.'],
  'parent-behavior': ['Behavior', 'Teacher-recorded behavior and activity notes.'],
  'student-behavior': ['Behavior', 'Your behavior and activity notes.'],
  'parent-notice': ['Notice', 'School notices for the selected child.'],
  'student-notice': ['Notice', 'Notices published for your class.'],
  'parent-event': ['Events', 'Upcoming and completed school events.'],
  'student-event': ['Events', 'Upcoming and completed school events.'],
  'parent-exams': ['Exams', 'Exam list, merit position and published results.'],
  'parent-profile': ['Profile', 'Account security and parent access.'],
  'student-profile': ['Profile', 'Student information and password security.'],
}
const pageTitle = computed(() => titles[props.route]?.[0] || 'Dashboard')
const pageDescription = computed(() => titles[props.route]?.[1] || '')

const routines = [
  { day: 'Monday', time: '08:30–09:15', subject: 'Mathematics', teacher: 'Maya Thomas', room: 'Room 204' },
  { day: 'Monday', time: '09:15–10:00', subject: 'English Literature', teacher: 'Sophia Miller', room: 'Room 204' },
  { day: 'Monday', time: '10:15–11:00', subject: 'Science', teacher: 'Ethan Carter', room: 'Lab 2' },
  { day: 'Monday', time: '11:15–12:00', subject: 'Computer Science', teacher: 'Liam Davis', room: 'IT Lab' },
  { day: 'Tuesday', time: '08:30–09:15', subject: 'Physics', teacher: 'Ethan Carter', room: 'Lab 1' },
  { day: 'Tuesday', time: '09:15–10:00', subject: 'Mathematics', teacher: 'Maya Thomas', room: 'Room 204' },
  { day: 'Tuesday', time: '10:15–11:00', subject: 'Social Science', teacher: 'Noah Wilson', room: 'Room 204' },
  { day: 'Wednesday', time: '08:30–09:15', subject: 'English Literature', teacher: 'Sophia Miller', room: 'Room 204' },
  { day: 'Wednesday', time: '09:15–10:00', subject: 'Chemistry', teacher: 'Ethan Carter', room: 'Lab 2' },
  { day: 'Thursday', time: '08:30–09:15', subject: 'Mathematics', teacher: 'Maya Thomas', room: 'Room 204' },
  { day: 'Friday', time: '08:30–09:15', subject: 'Computer Science', teacher: 'Liam Davis', room: 'IT Lab' },
]

const defaultFees: Fee[] = [
  { id: 1, invoice: 'INV-2026-1842', head: 'Term II Tuition Fee', amount: 12500, fine: 0, waiver: 0, date: '2026-07-28', status: 'Unpaid' },
  { id: 2, invoice: 'RCP-2026-1194', head: 'Term I Tuition Fee', amount: 18500, fine: 0, waiver: 0, date: '2026-04-02', status: 'Paid' },
  { id: 3, invoice: 'RCP-2026-1281', head: 'Transport Fee · July', amount: 4800, fine: 0, waiver: 0, date: '2026-07-05', status: 'Paid' },
  { id: 4, invoice: 'INV-2026-1851', head: 'Laboratory Fee', amount: 2200, fine: 150, waiver: 200, date: '2026-07-31', status: 'Unpaid' },
]
const fees = ref<Fee[]>([])
const feeStorageKey = computed(() => `edunova:mighty:fees:${selectedChild.value.id}`)

const defaultAssignments: Assignment[] = [
  { id: 1, title: 'Quadratic Equations', subject: 'Mathematics', description: 'Complete exercise 4.2 and show all calculation steps.', deadline: '2026-07-27', fullMark: 20, passMark: 8, status: 'Submitted', attachment: 'quadratic-equations.pdf', submission: 'Completed solution attached.', submittedAt: '25 Jul 2026 · 18:42' },
  { id: 2, title: 'Cell Structure Lab Report', subject: 'Science', description: 'Submit a labelled cell diagram and the practical observation report.', deadline: '2026-07-29', fullMark: 30, passMark: 12, status: 'Assigned', attachment: 'lab-report-guide.pdf' },
  { id: 3, title: 'The Merchant of Venice', subject: 'English', description: 'Write a 700-word character analysis of Portia.', deadline: '2026-07-31', fullMark: 25, passMark: 10, status: 'Assigned', attachment: 'essay-rubric.pdf' },
]
const assignments = ref<Assignment[]>([])
const assignmentStorageKey = computed(() => `edunova:mighty:assignments:${selectedChild.value.id}`)

const libraryHistory = [
  { id: 'ISS-1842', book: 'The Alchemist', author: 'Paulo Coelho', issue: '10 Jul 2026', due: '24 Jul 2026', returned: '—', status: 'Overdue' },
  { id: 'ISS-1798', book: 'Oxford School Atlas', author: 'Oxford Press', issue: '02 Jul 2026', due: '16 Jul 2026', returned: '15 Jul 2026', status: 'Returned' },
  { id: 'ISS-1711', book: 'A Brief History of Time', author: 'Stephen Hawking', issue: '12 Jun 2026', due: '26 Jun 2026', returned: '25 Jun 2026', status: 'Returned' },
]
const behavior = [
  { id: 1, title: 'Excellent laboratory teamwork', date: '22 Jul 2026', note: 'Worked safely and helped the group complete the practical on time.', type: 'Positive', teacher: 'Ethan Carter' },
  { id: 2, title: 'Homework completion', date: '18 Jul 2026', note: 'All mathematics homework was completed with clear working.', type: 'Positive', teacher: 'Maya Thomas' },
  { id: 3, title: 'Late arrival', date: '11 Jul 2026', note: 'Arrived ten minutes late to the first period. Guardian was informed.', type: 'Attention', teacher: 'Maya Thomas' },
]
const notices = [
  { id: 1, title: 'Annual Sports Day 2026', date: '25 Jul 2026', notice: 'Registrations are open until 30 July. Submit participation choices to the class teacher.', audience: 'All students' },
  { id: 2, title: 'Library maintenance', date: '24 Jul 2026', notice: 'The senior library will remain closed this Saturday for annual maintenance.', audience: 'Grades 9–12' },
  { id: 3, title: 'Parent–Teacher Meeting', date: '22 Jul 2026', notice: 'The Grade 10 parent–teacher meeting will be held on 1 August at 10:00 AM.', audience: 'Grade 10' },
]
const events = [
  { id: 1, name: 'Annual Sports Day', start: '05 Aug 2026', end: '06 Aug 2026', place: 'Main Sports Ground', status: 'Registration open' },
  { id: 2, name: 'Science Exhibition', start: '12 Aug 2026', end: '12 Aug 2026', place: 'School Auditorium', status: 'Upcoming' },
  { id: 3, name: 'Inter-school Debate', start: '18 Jul 2026', end: '18 Jul 2026', place: 'City Convention Hall', status: 'Completed' },
]
const exams = [
  { id: 1, name: 'Term I Examination', code: 'TERM-I-26', merit: 'Class Merit', position: 5, total: 500, obtained: 446, percentage: 89.2, grade: 'A1', gpa: 4.8, result: 'Passed' },
  { id: 2, name: 'Mathematics Unit Test', code: 'MATH-UT-02', merit: 'Subject Merit', position: 3, total: 50, obtained: 46, percentage: 92, grade: 'A1', gpa: 5, result: 'Passed' },
]
const examSubjects = [
  { name: 'Mathematics', obtained: 92, total: 100, grade: 'A1', remark: 'Outstanding' },
  { name: 'Science', obtained: 88, total: 100, grade: 'A1', remark: 'Very good' },
  { name: 'English', obtained: 84, total: 100, grade: 'A2', remark: 'Very good' },
  { name: 'Social Science', obtained: 89, total: 100, grade: 'A1', remark: 'Excellent' },
  { name: 'Computer Science', obtained: 93, total: 100, grade: 'A1', remark: 'Outstanding' },
]

function loadRoleData() {
  try {
    fees.value = JSON.parse(localStorage.getItem(feeStorageKey.value) || 'null') || structuredClone(defaultFees)
    assignments.value = JSON.parse(localStorage.getItem(assignmentStorageKey.value) || 'null') || structuredClone(defaultAssignments)
  } catch {
    fees.value = structuredClone(defaultFees)
    assignments.value = structuredClone(defaultAssignments)
  }
  selectedExam.value = null
  selectedAssignment.value = null
}
watch(selectedChildId, (id) => {
  localStorage.setItem('edunova:mighty:default-child', String(id))
  loadRoleData()
})
watch(() => props.route, () => {
  selectedExam.value = null
  selectedAssignment.value = null
})
loadRoleData()

const visibleAssignments = computed(() =>
  assignments.value.filter((item) => assignmentTab.value === 'Submitted' ? item.status !== 'Assigned' : item.status === 'Assigned'),
)
const visibleFees = computed(() => fees.value.filter((item) => item.status === feeTab.value))
const feeTotals = computed(() => ({
  paid: fees.value.filter((item) => item.status === 'Paid').reduce((sum, item) => sum + item.amount + item.fine - item.waiver, 0),
  due: fees.value.filter((item) => item.status === 'Unpaid').reduce((sum, item) => sum + item.amount + item.fine - item.waiver, 0),
}))

function notify(message: string) {
  toast.value = message
  window.setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2300)
}
function openSubmission(item: Assignment) {
  selectedAssignment.value = item
  submissionText.value = ''
  submissionFile.value = ''
  submissionOpen.value = true
}
function chooseSubmissionFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  submissionFile.value = file?.name || ''
}
function submitAssignment() {
  if (!selectedAssignment.value || !submissionText.value.trim() || !submissionFile.value) return
  selectedAssignment.value.status = 'Submitted'
  selectedAssignment.value.submission = submissionText.value
  selectedAssignment.value.submittedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  localStorage.setItem(assignmentStorageKey.value, JSON.stringify(assignments.value))
  submissionOpen.value = false
  assignmentTab.value = 'Submitted'
  notify('Assignment submitted successfully')
}
function openPayment(fee: Fee) {
  paymentFee.value = fee
  paymentOpen.value = true
}
function completePayment() {
  if (!paymentFee.value) return
  paymentFee.value.status = 'Paid'
  paymentFee.value.invoice = `RCP-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`
  paymentFee.value.date = new Date().toISOString().slice(0, 10)
  localStorage.setItem(feeStorageKey.value, JSON.stringify(fees.value))
  paymentOpen.value = false
  feeTab.value = 'Paid'
  notify(`Payment completed through ${paymentGateway.value}`)
}
function downloadDocument(filename: string) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([`EduNova document\n${filename}\nGenerated for ${selectedChild.value.name}`], { type: 'text/plain' }))
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
  notify(`${filename} downloaded`)
}
function updatePassword() {
  if (passwordForm.value.current !== 'Demo@123') {
    notify('Current password is incorrect')
    return
  }
  if (passwordForm.value.next.length < 8 || passwordForm.value.next !== passwordForm.value.confirm) {
    notify('New passwords must match and contain at least 8 characters')
    return
  }
  passwordForm.value = { current: '', next: '', confirm: '' }
  notify('Password updated successfully')
}
</script>

<template>
  <div class="mighty-role-portal">
    <div v-if="route !== 'dashboard'" class="page-head">
      <div>
        <p class="eyebrow">{{ isParent ? 'Parent module' : 'Student module' }}</p>
        <h1>{{ pageTitle }}</h1>
        <p>{{ pageDescription }}</p>
      </div>
      <label v-if="isParent && route !== 'parent-profile'" class="child-switcher">
        <Users :size="15" />
        <select v-model="selectedChildId">
          <option v-for="student in children" :key="student.id" :value="student.id">{{ student.name }} · {{ student.className }} {{ student.section }}</option>
        </select>
      </label>
    </div>

    <template v-if="route === 'dashboard'">
      <div class="role-dashboard-head">
        <div><p class="eyebrow">{{ isParent ? 'Parent dashboard' : 'Student dashboard' }}</p><h1>Welcome back, {{ isParent ? 'Priya Mehta' : 'Aarav Mehta' }}</h1><p>Here’s a quick overview of school activity.</p></div>
        <label v-if="isParent" class="child-switcher"><Users :size="15" /><select v-model="selectedChildId"><option v-for="student in children" :key="student.id" :value="student.id">{{ student.name }}</option></select></label>
      </div>
      <section class="mighty-summary">
        <article class="student-identity-card">
          <span class="profile-avatar">{{ selectedChild.name.split(' ').map((part) => part[0]).join('') }}</span>
          <div><small>DEFAULT STUDENT</small><h2>{{ selectedChild.name }}</h2><p>{{ selectedChild.className }} · Section {{ selectedChild.section }} · Roll {{ selectedChild.roll }}</p><span>{{ selectedChild.group }}</span></div>
        </article>
        <article class="summary-tile indigo"><GraduationCap :size="18" /><strong>{{ selectedChild.attendance.toFixed(2) }}%</strong><span>Total Attendance</span></article>
        <article class="summary-tile violet"><CalendarDays :size="18" /><strong>{{ selectedChild.monthly.toFixed(2) }}%</strong><span>Monthly Attendance</span></article>
        <article class="summary-tile orange"><BookOpen :size="18" /><strong>{{ String(selectedChild.tasks).padStart(2, '0') }} Tasks</strong><span>Pending Homework</span></article>
        <article class="summary-tile green"><FileText :size="18" /><strong>{{ String(selectedChild.exams).padStart(2, '0') }}</strong><span>Upcoming Exams</span></article>
      </section>
      <section class="role-dashboard-grid">
        <article class="fees-overview-card">
          <div class="panel-head"><div><h3>Fees Overview</h3><p>Current academic session</p></div><button @click="emit('navigate', isParent ? 'parent-fees' : 'student-fees')">View details <ChevronRight :size="14" /></button></div>
          <div class="fees-overview-values"><span><b>{{ new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(feeTotals.paid) }}</b><small>Paid fees</small></span><span><b>{{ new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(feeTotals.due) }}</b><small>Unpaid fees</small></span><span><b>{{ fees.filter(item=>item.status==='Unpaid').length }}</b><small>Due items</small></span></div>
        </article>
        <article class="routine-preview-card">
          <div class="panel-head"><div><h3>Class Routine</h3><p>Monday’s classes</p></div><button @click="emit('navigate', isParent ? 'parent-routine' : 'student-routine')">View routine <ChevronRight :size="14" /></button></div>
          <div v-for="period in routines.filter(item=>item.day==='Monday').slice(0,3)" :key="period.time" class="routine-preview-row"><time>{{ period.time }}</time><span><strong>{{ period.subject }}</strong><small>{{ period.teacher }} · {{ period.room }}</small></span></div>
        </article>
      </section>
    </template>

    <template v-else-if="route.endsWith('routine')">
      <div class="week-selector"><button v-for="day in ['Monday','Tuesday','Wednesday','Thursday','Friday']" :key="day" :class="{active:activeDay===day}" @click="activeDay=day">{{ day.slice(0,3) }}</button></div>
      <article class="routine-list-card">
        <div v-for="(period,index) in routines.filter(item=>item.day===activeDay)" :key="period.time" class="routine-period">
          <span class="period-number">{{ index+1 }}</span><time>{{ period.time }}</time><div><strong>{{ period.subject }}</strong><p>{{ period.teacher }}</p></div><span><MapPin :size="13" />{{ period.room }}</span>
        </div>
        <div v-if="!routines.some(item=>item.day===activeDay)" class="role-empty">No classes configured for {{ activeDay }}.</div>
      </article>
    </template>

    <template v-else-if="route.endsWith('fees')">
      <section class="fees-summary-row"><article><WalletCards :size="20" /><span><small>Total paid</small><strong>{{ new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(feeTotals.paid) }}</strong></span></article><article><ReceiptText :size="20" /><span><small>Total unpaid</small><strong>{{ new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(feeTotals.due) }}</strong></span></article></section>
      <div class="role-type-tabs"><button :class="{active:feeTab==='Paid'}" @click="feeTab='Paid'">Paid Fees</button><button :class="{active:feeTab==='Unpaid'}" @click="feeTab='Unpaid'">Unpaid Fees</button></div>
      <article class="role-table-card">
        <div class="role-table-head"><span>Invoice</span><span>Fee head</span><span>Date</span><span>Fine</span><span>Waiver</span><span>Amount</span><span></span></div>
        <div v-for="fee in visibleFees" :key="fee.id" class="role-table-row"><strong>{{ fee.invoice }}</strong><span>{{ fee.head }}</span><span>{{ new Date(`${fee.date}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }}</span><span>₹{{ fee.fine }}</span><span>₹{{ fee.waiver }}</span><strong>₹{{ (fee.amount+fee.fine-fee.waiver).toLocaleString('en-IN') }}</strong><button v-if="fee.status==='Paid'" @click="downloadDocument(`${fee.invoice}.txt`)"><Download :size="14" /> Receipt</button></div>
      </article>
    </template>

    <template v-else-if="route === 'parent-fee-payment'">
      <section class="collection-layout">
        <article class="fee-due-list"><h3>Payable Fee Heads</h3><button v-for="fee in fees.filter(item=>item.status==='Unpaid')" :key="fee.id" :class="{selected:paymentFee?.id===fee.id}" @click="paymentFee=fee"><span><strong>{{ fee.head }}</strong><small>{{ fee.invoice }} · Due {{ new Date(`${fee.date}T00:00:00`).toLocaleDateString('en-IN') }}</small></span><b>₹{{ (fee.amount+fee.fine-fee.waiver).toLocaleString('en-IN') }}</b></button></article>
        <article class="payment-review"><template v-if="paymentFee"><CreditCard :size="28" /><h2>Payment Summary</h2><div><span>Base fee</span><b>₹{{ paymentFee.amount.toLocaleString('en-IN') }}</b></div><div><span>Fine</span><b>₹{{ paymentFee.fine.toLocaleString('en-IN') }}</b></div><div><span>Waiver</span><b>− ₹{{ paymentFee.waiver.toLocaleString('en-IN') }}</b></div><div class="total"><span>Total payable</span><b>₹{{ (paymentFee.amount+paymentFee.fine-paymentFee.waiver).toLocaleString('en-IN') }}</b></div><label>Payment gateway<select v-model="paymentGateway"><option>Razorpay</option><option>Stripe</option><option>PayPal</option><option>Paytm</option></select></label><button class="primary" @click="paymentOpen=true">Proceed to payment</button></template><div v-else class="role-empty">Select a payable fee head to continue.</div></article>
      </section>
    </template>

    <template v-else-if="route.endsWith('library')">
      <article class="role-table-card">
        <div class="role-table-head library-columns"><span>Issue ID</span><span>Book</span><span>Issue date</span><span>Due date</span><span>Returned</span><span>Status</span><span></span></div>
        <div v-for="item in libraryHistory" :key="item.id" class="role-table-row library-columns"><strong>{{ item.id }}</strong><span><b>{{ item.book }}</b><small>{{ item.author }}</small></span><span>{{ item.issue }}</span><span>{{ item.due }}</span><span>{{ item.returned }}</span><span :class="['status-pill',item.status.toLowerCase()]">{{ item.status }}</span><button @click="downloadDocument(`${item.id}.txt`)"><Download :size="14" /></button></div>
      </article>
    </template>

    <template v-else-if="route.endsWith('assignment')">
      <div class="role-type-tabs"><button :class="{active:assignmentTab==='Assigned'}" @click="assignmentTab='Assigned'">Assignment</button><button :class="{active:assignmentTab==='Submitted'}" @click="assignmentTab='Submitted'">Submitted Assignment</button></div>
      <section class="assignment-list">
        <article v-for="item in visibleAssignments" :key="item.id">
          <div class="assignment-card-top"><span><BookOpen :size="17" /></span><div><small>{{ item.subject }}</small><h3>{{ item.title }}</h3></div><i :class="['status-pill',item.status.toLowerCase()]">{{ item.status }}</i></div>
          <p>{{ item.description }}</p>
          <div class="assignment-meta"><span><Clock3 :size="13" /> Deadline {{ new Date(`${item.deadline}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }}</span><span>{{ item.fullMark }} marks · Pass {{ item.passMark }}</span></div>
          <div class="assignment-actions"><button @click="selectedAssignment=item"><FileText :size="14" /> View details</button><button @click="downloadDocument(item.attachment)"><Download :size="14" /> Attachment</button><button v-if="!isParent&&item.status==='Assigned'" class="primary" @click="openSubmission(item)"><Upload :size="14" /> Submit assignment</button></div>
        </article>
        <div v-if="!visibleAssignments.length" class="role-empty">No {{ assignmentTab.toLowerCase() }} assignments.</div>
      </section>
    </template>

    <template v-else-if="route.endsWith('behavior')">
      <section class="behavior-list"><article v-for="item in behavior" :key="item.id" :class="item.type.toLowerCase()"><span><ShieldCheck :size="18" /></span><div><div><h3>{{ item.title }}</h3><i>{{ item.type }}</i></div><p>{{ item.note }}</p><small>{{ item.date }} · {{ item.teacher }}</small></div></article></section>
    </template>

    <template v-else-if="route.endsWith('notice')">
      <section class="notice-list"><article v-for="item in notices" :key="item.id"><span><Megaphone :size="19" /></span><div><small>{{ item.date }} · {{ item.audience }}</small><h3>{{ item.title }}</h3><p>{{ item.notice }}</p></div></article></section>
    </template>

    <template v-else-if="route.endsWith('event')">
      <section class="event-card-grid"><article v-for="item in events" :key="item.id"><div class="event-date"><CalendarDays :size="18" /><span>{{ item.start }}</span></div><h3>{{ item.name }}</h3><p><MapPin :size="13" />{{ item.place }}</p><div><span>{{ item.start }} – {{ item.end }}</span><i :class="['status-pill',item.status.toLowerCase().replaceAll(' ','-')]">{{ item.status }}</i></div></article></section>
    </template>

    <template v-else-if="route === 'parent-exams'">
      <template v-if="selectedExam">
        <button class="back-link" @click="selectedExam=null"><ArrowLeft :size="15" /> Back to exams</button>
        <section class="result-hero"><div><small>EXAM RESULT</small><h2>{{ selectedExam.name }}</h2><p>{{ selectedChild.name }} · {{ selectedChild.className }} {{ selectedChild.section }} · Roll {{ selectedChild.roll }}</p></div><div class="result-kpis"><span><b>{{ selectedExam.obtained }}/{{ selectedExam.total }}</b><small>Marks obtained</small></span><span><b>{{ selectedExam.percentage }}%</b><small>Percentage</small></span><span><b>{{ selectedExam.grade }}</b><small>Grade</small></span><span><b>{{ selectedExam.gpa }}</b><small>GPA</small></span><span><b>{{ selectedExam.result }}</b><small>Result</small></span></div></section>
        <article class="role-table-card result-table"><div class="role-table-head"><span>Subject name</span><span>Marks obtained</span><span>Total marks</span><span>Grade</span><span>Remark</span><span></span><span></span></div><div v-for="subject in examSubjects" :key="subject.name" class="role-table-row"><strong>{{ subject.name }}</strong><span>{{ subject.obtained }}</span><span>{{ subject.total }}</span><strong>{{ subject.grade }}</strong><span>{{ subject.remark }}</span><span></span><span></span></div></article>
      </template>
      <section v-else class="exam-list"><button v-for="item in exams" :key="item.id" @click="selectedExam=item"><span><FileText :size="18" /></span><div><small>{{ item.code }}</small><h3>{{ item.name }}</h3><p>{{ item.merit }} · Position {{ item.position }}</p></div><strong>View result <ChevronRight :size="15" /></strong></button></section>
    </template>

    <template v-else-if="route.endsWith('profile')">
      <section class="profile-security-layout">
        <article v-if="!isParent" class="student-profile-card"><span class="profile-avatar">AM</span><div><h2>Aarav Mehta</h2><p>student@edunova.school · +91 98765 43210</p><span>Grade 10 A · Science · Student</span></div></article>
        <article v-else class="student-profile-card"><span class="profile-avatar">PM</span><div><h2>Priya Mehta</h2><p>guardian@edunova.school · +91 98111 22334</p><span>Parent account · Default child {{ selectedChild.name }}</span></div></article>
        <form class="password-card" @submit.prevent="updatePassword"><LockKeyhole :size="23" /><h3>Update Password</h3><p>Use your current password before setting a new one.</p><label>Current password<input v-model="passwordForm.current" type="password" required /></label><label>New password<input v-model="passwordForm.next" type="password" minlength="8" required /></label><label>Confirm password<input v-model="passwordForm.confirm" type="password" minlength="8" required /></label><button class="primary"><ShieldCheck :size="15" /> Update password</button></form>
      </section>
    </template>

    <div v-if="submissionOpen" class="modal-backdrop" @click.self="submissionOpen=false"><form class="task-modal" @submit.prevent="submitAssignment"><div class="modal-head"><div><p>SUBMIT ASSIGNMENT</p><h2>{{ selectedAssignment?.title }}</h2></div><button type="button" @click="submissionOpen=false"><X :size="18" /></button></div><label>Submission note<textarea v-model="submissionText" required placeholder="Describe the work you are submitting…"></textarea></label><label class="file-drop"><Paperclip :size="18" /><span><strong>{{ submissionFile || 'Choose attachment' }}</strong><small>PDF, DOCX or image · Maximum 10 MB</small></span><input type="file" required @change="chooseSubmissionFile" /></label><div class="modal-actions"><button type="button" class="secondary" @click="submissionOpen=false">Cancel</button><button class="primary"><Send :size="14" /> Submit</button></div></form></div>

    <div v-if="paymentOpen&&paymentFee" class="modal-backdrop" @click.self="paymentOpen=false"><div class="payment-confirm-modal"><div class="modal-head"><div><p>SECURE PAYMENT</p><h2>{{ paymentFee.head }}</h2></div><button @click="paymentOpen=false"><X :size="18" /></button></div><CreditCard :size="34" /><strong>₹{{ (paymentFee.amount+paymentFee.fine-paymentFee.waiver).toLocaleString('en-IN') }}</strong><p>{{ paymentFee.invoice }} · {{ paymentGateway }}</p><div class="secure-note"><LockKeyhole :size="15" /> Payment is processed in a secure demo flow.</div><div class="modal-actions"><button class="secondary" @click="paymentOpen=false">Cancel</button><button class="primary" @click="completePayment">Pay securely</button></div></div></div>

    <div v-if="selectedAssignment&&!submissionOpen" class="modal-backdrop" @click.self="selectedAssignment=null"><div class="assignment-detail-modal"><div class="modal-head"><div><p>{{ selectedAssignment.subject }}</p><h2>{{ selectedAssignment.title }}</h2></div><button @click="selectedAssignment=null"><X :size="18" /></button></div><p>{{ selectedAssignment.description }}</p><div class="detail-grid"><div><small>Deadline</small><strong>{{ selectedAssignment.deadline }}</strong></div><div><small>Full mark</small><strong>{{ selectedAssignment.fullMark }}</strong></div><div><small>Pass mark</small><strong>{{ selectedAssignment.passMark }}</strong></div><div><small>Status</small><strong>{{ selectedAssignment.status }}</strong></div></div><div v-if="selectedAssignment.submission" class="submission-detail"><CheckCircle2 :size="17" /><span><strong>Submitted {{ selectedAssignment.submittedAt }}</strong><p>{{ selectedAssignment.submission }}</p></span></div><div class="modal-actions"><button class="secondary" @click="downloadDocument(selectedAssignment.attachment)"><Download :size="14" /> Download file</button><button v-if="!isParent&&selectedAssignment.status==='Assigned'" class="primary" @click="openSubmission(selectedAssignment)">Submit assignment</button></div></div></div>

    <Transition name="toast"><div v-if="toast" class="app-toast"><CheckCircle2 :size="18" />{{ toast }}</div></Transition>
  </div>
</template>
