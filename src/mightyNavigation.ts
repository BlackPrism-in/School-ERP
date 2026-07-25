import {
  Activity,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  BookCopy,
  BookOpen,
  Bot,
  Building2,
  Bus,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileBadge,
  FileQuestion,
  FileText,
  GraduationCap,
  Hotel,
  IdCard,
  Landmark,
  LayoutDashboard,
  Library,
  Megaphone,
  MessageSquareText,
  MonitorPlay,
  ReceiptText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-vue-next'
import type { Role } from './data'

export type MightyNavItem = {
  id: string
  label: string
  icon?: LucideIcon
  section?: string
  children?: MightyNavItem[]
}

const child = (id: string, label: string): MightyNavItem => ({ id, label })
const group = (id: string, label: string, icon: LucideIcon, children: MightyNavItem[], section?: string): MightyNavItem => ({
  id,
  label,
  icon,
  children,
  section,
})
const single = (id: string, label: string, icon: LucideIcon, section?: string): MightyNavItem => ({
  id,
  label,
  icon,
  section,
})

export const adminNavigation: MightyNavItem[] = [
  single('dashboard', 'Dashboard', LayoutDashboard),
  single('branch', 'Branch', Building2),
  group('student-information', 'Student Information', Users, [
    child('student-list', 'Student List'),
    child('student-migration', 'Student Migration'),
    child('migration-pushback', 'Migration Pushback'),
    child('migration-list', 'Migration List'),
    child('student-branch-migration', 'Student Branch Migration'),
    child('all-student-list', 'All Student List'),
  ], 'Student Management'),
  group('student-attendance-management', 'Student Attendance', ClipboardCheck, [
    child('student-attendance', 'Student Attendance'),
    child('attendance-report', 'Attendance Report'),
    child('monthly-attendance-report', 'Monthly Attendance Report'),
  ]),
  group('academic-configuration', 'Academic Configuration', GraduationCap, [
    child('academic-session', 'Academic Session'),
    child('shift', 'Shift'),
    child('class', 'Class'),
    child('section', 'Section'),
    child('group', 'Group'),
    child('period', 'Period'),
    child('subjects', 'Subjects'),
    child('student-categories', 'Student Categories'),
    child('department', 'Department'),
    child('picklist', 'Picklist'),
    child('signature', 'Signature'),
  ]),
  group('staff-information', 'Staff Information', UserCog, [
    child('staff-attendance', 'Staff Attendance'),
    child('staff-attendance-report', 'Staff Attendance Report'),
    child('teacher-list', 'Teacher List'),
    child('staff-list', 'Staff List'),
  ], 'Staff & Payroll'),
  group('payroll-management', 'Payroll Management', Banknote, [
    child('payroll-start-up', 'Payroll Start Up'),
    child('payroll-mapping', 'Payroll Mapping'),
    child('payroll-assign', 'Payroll Assign'),
    child('salary-slip', 'Salary Slip'),
    child('salary', 'Salary'),
    child('payroll-due', 'Due'),
    child('advance', 'Advance'),
  ]),
  group('fees-management', 'Fees Management', WalletCards, [
    child('fees-start-up', 'Fees Start Up'),
    child('fees-mapping', 'Fees Mapping'),
    child('amount-config', 'Amount Config'),
    child('date-config', 'Date Config'),
    child('waiver', 'Waiver'),
    child('waiver-config', 'Waiver Config'),
    child('smart-collection', 'Smart Collection'),
    child('paid-info', 'Paid Info'),
    child('unpaid-info', 'Unpaid Info'),
  ], 'Finance & Accounts'),
  group('account-management', 'Account Management', Landmark, [
    child('ledger', 'Ledger'),
    child('fund', 'Fund'),
    child('account-category', 'Category'),
    child('account-group', 'Group'),
    child('payment', 'Payment'),
    child('receipt', 'Receipt'),
    child('contra', 'Contra'),
    child('journal', 'Journal'),
    child('fund-transfer', 'Fund Transfer'),
    child('chart-of-account', 'Chart of Account'),
  ]),
  group('accounting-reports-management', 'Accounting Reports', BarChart3, [
    child('balance-sheet', 'Balance Sheet'),
    child('trial-balance', 'Trial Balance'),
    child('cash-flow', 'Cash Flow'),
    child('income-statement', 'Income Statement'),
    child('fund-wise-report', 'Fund Wise Report'),
    child('ledger-wise-report', 'Ledger Wise Report'),
    child('user-wise-report', 'User Wise Report'),
    child('voucher-wise-report', 'Voucher Wise Report'),
  ]),
  group('routine-management', 'Routine Management', CalendarDays, [
    child('syllabus', 'Syllabus'),
    child('assignments', 'Assignments'),
    child('class-routine', 'Class Routine'),
    child('exam-routine', 'Exam Routine'),
    child('admit-and-seat-plan', 'Admit & Seat Plan'),
  ], 'Academic & Learning'),
  group('library-management', 'Library Management', Library, [
    child('book-categories', 'Book Categories'),
    child('books', 'Books'),
    child('library-members', 'Members'),
    child('books-issue', 'Books Issue'),
    child('books-return', 'Books Issue Search / Return'),
    child('books-issue-report', 'Books Issue Report'),
  ]),
  group('exam-management', 'Exam Management', FileText, [
    child('exam', 'Exam'),
    child('exam-start-up', 'Exam Start Up'),
    child('mark-config', 'Mark Config'),
    child('remark-config', 'Remark Config'),
    child('mark-input', 'Mark Input'),
    child('mark-sheet', 'Mark Sheet'),
    child('exam-result', 'Exam Result'),
  ]),
  group('layout-and-certificate', 'Layout & Certificate', FileBadge, [
    child('general-recommendation-letter', 'General Recommendation Letter'),
    child('testimonial', 'Testimonial'),
    child('attendance-certificate', 'Attendance Certificate'),
    child('hsc-recommendation-letter', 'HSC Recommendation Letter'),
    child('abroad-letter', 'Abroad Letter'),
    child('transfer-certificate', 'Transfer Certificate'),
    child('character-certificate', 'Character Certificate'),
    child('study-certificate', 'Study Certificate'),
    child('bonafide-certificate', 'Bonafide Certificate'),
    child('migration-certificate', 'Migration Certificate'),
    child('id-card', 'ID Card'),
  ]),
  group('sms-management', 'SMS Management', MessageSquareText, [
    child('sms-configuration', 'SMS Configuration'),
    child('sms-template', 'SMS Template'),
    child('phone-book-category', 'Phone Book Category'),
    child('phone-book', 'Phone Book'),
    child('sms-sent', 'SMS Sent'),
    child('absent-sms', 'Absent SMS'),
    child('purchase-sms', 'Purchase SMS'),
    child('sms-report', 'SMS Report'),
  ]),
  group('administrator', 'Administrator', ShieldCheck, [
    child('notice', 'Notice'),
    child('event', 'Event'),
    child('user-activities', 'User Activities'),
  ]),
  group('question-bank', 'Question Bank', FileQuestion, [
    child('question-category', 'Question Category'),
    child('add-new-question', 'Add New Question'),
    child('question', 'Question'),
    child('question-class', 'Class'),
    child('question-group', 'Group'),
    child('question-subject', 'Subject'),
    child('question-chapter', 'Chapter'),
    child('question-types', 'Types'),
    child('question-level', 'Level'),
    child('question-topics', 'Topics'),
    child('question-sources', 'Sources'),
    child('question-sub-sources', 'Sub Sources'),
    child('question-year', 'Year'),
    child('question-board', 'Board'),
    child('question-tag', 'Tag'),
    child('question-paper', 'Question Paper'),
  ]),
  group('fees-reports-management', 'Fees Reports', ReceiptText, [
    child('fee-monthly-report', 'Fee Monthly Report'),
    child('fees-payment-info', 'Payment Info'),
    child('head-wise-info', 'Head Wise Info'),
    child('fees-unpaid-info', 'Unpaid Info'),
    child('payment-ratio-info', 'Payment Ratio Info'),
  ]),
  group('master-configuration', 'Master Configuration', Settings, [
    child('system-settings', 'System Settings'),
    child('payment-gateway', 'Payment Gateway'),
    child('roles', 'Role'),
    child('employees', 'Employee'),
    child('database-backup', 'Database Backup'),
  ]),
  group('zoom-meeting', 'Zoom Meeting', MonitorPlay, [
    child('zoom-config', 'Zoom Config'),
    child('zoom-classes', 'Zoom Meeting'),
  ]),
  group('cms-management', 'CMS Management', Megaphone, [
    child('about-us', 'About Us'),
    child('banner', 'Banner'),
    child('why-choose-us', 'Why Choose Us'),
    child('mobile-app-section', 'Mobile App Section'),
    child('ready-to-join', 'Ready to Join'),
    child('faq', 'FAQ'),
    child('feedback', 'Feedback'),
    child('gallery', 'Gallery'),
    child('theme', 'Theme'),
  ]),
  group('hostel-management', 'Hostel Management', Hotel, [
    child('hostels', 'Hostels'),
    child('hostel-categories', 'Hostel Categories'),
    child('hostel-rooms', 'Hostel Rooms'),
    child('hostel-members', 'Hostel Members'),
    child('hostel-meals', 'Hostel Meals'),
    child('hostel-meal-plan', 'Hostel Meal Plan'),
    child('hostel-meal-entries', 'Hostel Meal Entries'),
    child('hostel-bills', 'Hostel Bills'),
  ]),
  group('transportation-management', 'Transportation Management', Bus, [
    child('transport-buses', 'Transport Buses'),
    child('transport-drivers', 'Transport Drivers'),
    child('bus-routes', 'Bus Routes'),
    child('bus-stops', 'Bus Stops'),
    child('transport-members', 'Transport Members'),
  ]),
  group('ai', 'AI', Bot, [child('chatgpt', 'ChatGPT')]),
]

const teacherRouteIds = new Set([
  'dashboard',
  'student-list',
  'student-attendance',
  'attendance-report',
  'monthly-attendance-report',
  'academic-session',
  'class',
  'section',
  'group',
  'period',
  'subjects',
  'syllabus',
  'assignments',
  'class-routine',
  'exam-routine',
  'admit-and-seat-plan',
  'books',
  'library-members',
  'books-issue',
  'books-return',
  'books-issue-report',
  'exam',
  'mark-config',
  'mark-input',
  'mark-sheet',
  'exam-result',
  'notice',
  'event',
  'question-category',
  'add-new-question',
  'question',
  'question-class',
  'question-group',
  'question-subject',
  'question-chapter',
  'question-types',
  'question-level',
  'question-topics',
  'question-sources',
  'question-sub-sources',
  'question-year',
  'question-board',
  'question-tag',
  'question-paper',
  'zoom-classes',
])

export const teacherNavigation: MightyNavItem[] = adminNavigation
  .map((item) => {
    if (!item.children) return teacherRouteIds.has(item.id) ? item : null
    const children = item.children.filter((entry) => teacherRouteIds.has(entry.id))
    return children.length ? { ...item, children } : null
  })
  .filter((item): item is MightyNavItem => Boolean(item))

export const parentNavigation: MightyNavItem[] = [
  single('dashboard', 'Dashboard', LayoutDashboard),
  single('parent-routine', 'Routine', CalendarDays),
  single('parent-fees', 'Fees', WalletCards),
  single('parent-fee-payment', 'Fees Payment', BadgeDollarSign),
  single('parent-library', 'Library', Library),
  single('parent-assignment', 'Assignment', BookOpen),
  single('parent-behavior', 'Behavior', Activity),
  single('parent-notice', 'Notice', Megaphone),
  single('parent-event', 'Event', CalendarCheck),
  single('parent-exams', 'Exams', FileText),
  single('parent-profile', 'Profile', IdCard),
]

export const studentNavigation: MightyNavItem[] = [
  single('dashboard', 'Dashboard', LayoutDashboard),
  single('student-routine', 'Routine', CalendarDays),
  single('student-fees', 'Fees', WalletCards),
  single('student-library', 'Library', Library),
  single('student-assignment', 'Assignment', BookOpen),
  single('student-behavior', 'Behavior', Activity),
  single('student-notice', 'Notice', Megaphone),
  single('student-event', 'Event', CalendarCheck),
  single('student-profile', 'Profile', IdCard),
]

export function navigationForRole(role: Role) {
  if (role === 'guardian') return parentNavigation
  if (role === 'student') return studentNavigation
  if (role === 'teacher') return teacherNavigation
  return adminNavigation
}

export function flattenNavigation(items: MightyNavItem[]) {
  return items.flatMap((item) => [item, ...(item.children || [])])
}
