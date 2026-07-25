import { adminNavigation, flattenNavigation } from './mightyNavigation'

export type MightyFieldType = 'text' | 'number' | 'date' | 'time' | 'email' | 'tel' | 'select' | 'textarea' | 'file'
export type MightyField = {
  key: string
  label: string
  type: MightyFieldType
  required?: boolean
  options?: string[]
}
export type MightyWorkflowKind =
  | 'crud'
  | 'people'
  | 'attendance'
  | 'migration'
  | 'report'
  | 'mapping'
  | 'collection'
  | 'voucher'
  | 'routine'
  | 'marks'
  | 'certificate'
  | 'library'
  | 'communication'
  | 'question'
  | 'settings'
  | 'backup'
  | 'ai'

export type MightyWorkflowDefinition = {
  id: string
  title: string
  description: string
  kind: MightyWorkflowKind
  fields: MightyField[]
  filters?: MightyField[]
  statuses: string[]
  primaryAction?: string
}

const text = (key: string, label: string, required = true): MightyField => ({ key, label, type: 'text', required })
const number = (key: string, label: string, required = true): MightyField => ({ key, label, type: 'number', required })
const date = (key: string, label: string, required = true): MightyField => ({ key, label, type: 'date', required })
const time = (key: string, label: string, required = true): MightyField => ({ key, label, type: 'time', required })
const select = (key: string, label: string, options: string[], required = true): MightyField => ({ key, label, type: 'select', options, required })
const textarea = (key: string, label: string, required = true): MightyField => ({ key, label, type: 'textarea', required })

const classes = ['Grade 1', 'Grade 3', 'Grade 6', 'Grade 8', 'Grade 9', 'Grade 10']
const sections = ['A', 'B', 'C']
const sessions = ['2026–27', '2025–26']
const subjects = ['Mathematics', 'Science', 'English', 'Social Science', 'Computer Science']

const descriptions: Record<string, string> = {
  branch: 'Create and manage institution branches, status and branch contact information.',
  'student-list': 'Search, filter, add, view, update and activate student records.',
  'student-migration': 'Select students from a class and promote them into a target academic session.',
  'migration-pushback': 'Return migrated students to their previous session and class.',
  'migration-list': 'Review completed migration batches and their student records.',
  'student-branch-migration': 'Move selected students from the current branch to another branch.',
  'all-student-list': 'View students across every branch with branch and academic filters.',
  'student-attendance': 'Load a class roster by date and record Present, Absent, Late or Leave.',
  'attendance-report': 'Generate date-range student attendance reports by class and section.',
  'monthly-attendance-report': 'Generate a monthly student attendance matrix.',
  'staff-attendance': 'Record daily staff attendance and notify absent staff.',
  'staff-attendance-report': 'Generate date-range staff attendance reports.',
  'teacher-list': 'Manage teachers, department assignments and teacher accounts.',
  'staff-list': 'Manage non-teaching staff, roles and employment records.',
  'smart-collection': 'Find a student, calculate mapped fee heads, apply fine or waiver and collect payment.',
  'mark-input': 'Load an exam subject roster and enter theory, practical and objective marks.',
  'mark-sheet': 'Generate a student mark sheet for an exam.',
  'exam-result': 'Process, approve and publish class exam results.',
  'database-backup': 'Create and download a complete application data backup.',
  chatgpt: 'Use the configured AI assistant for school administration and teaching support.',
}

const peopleIds = new Set(['student-list', 'all-student-list', 'teacher-list', 'staff-list', 'employees', 'library-members', 'hostel-members', 'transport-members', 'branch'])
const attendanceIds = new Set(['student-attendance', 'staff-attendance'])
const migrationIds = new Set(['student-migration', 'migration-pushback', 'migration-list', 'student-branch-migration'])
const mappingIds = new Set(['fees-mapping', 'amount-config', 'date-config', 'waiver-config', 'payroll-mapping', 'payroll-assign', 'mark-config', 'exam-start-up'])
const voucherIds = new Set(['payment', 'receipt', 'contra', 'journal', 'fund-transfer'])
const routineIds = new Set(['class-routine', 'exam-routine', 'admit-and-seat-plan'])
const marksIds = new Set(['mark-input', 'mark-sheet', 'exam-result'])
const certificateIds = new Set([
  'general-recommendation-letter',
  'testimonial',
  'attendance-certificate',
  'hsc-recommendation-letter',
  'abroad-letter',
  'transfer-certificate',
  'character-certificate',
  'study-certificate',
  'bonafide-certificate',
  'migration-certificate',
  'id-card',
])
const libraryIds = new Set(['books-issue', 'books-return'])
const communicationIds = new Set(['sms-configuration', 'sms-template', 'phone-book-category', 'phone-book', 'sms-sent', 'absent-sms', 'purchase-sms', 'sms-report', 'notice', 'event', 'zoom-classes'])
const questionIds = new Set(['add-new-question', 'question', 'question-paper'])
const settingsIds = new Set(['system-settings', 'payment-gateway', 'zoom-config', 'theme'])
const reportIds = new Set([
  'attendance-report',
  'monthly-attendance-report',
  'staff-attendance-report',
  'salary-slip',
  'paid-info',
  'unpaid-info',
  'books-issue-report',
  'balance-sheet',
  'trial-balance',
  'cash-flow',
  'income-statement',
  'fund-wise-report',
  'ledger-wise-report',
  'user-wise-report',
  'voucher-wise-report',
  'fee-monthly-report',
  'fees-payment-info',
  'head-wise-info',
  'fees-unpaid-info',
  'payment-ratio-info',
  'user-activities',
  'sms-report',
])

function workflowKind(id: string): MightyWorkflowKind {
  if (id === 'database-backup') return 'backup'
  if (id === 'chatgpt') return 'ai'
  if (id === 'smart-collection') return 'collection'
  if (attendanceIds.has(id)) return 'attendance'
  if (migrationIds.has(id)) return 'migration'
  if (marksIds.has(id)) return 'marks'
  if (certificateIds.has(id)) return 'certificate'
  if (libraryIds.has(id)) return 'library'
  if (voucherIds.has(id)) return 'voucher'
  if (routineIds.has(id)) return 'routine'
  if (questionIds.has(id)) return 'question'
  if (communicationIds.has(id)) return 'communication'
  if (settingsIds.has(id)) return 'settings'
  if (reportIds.has(id) || id.endsWith('-report')) return 'report'
  if (mappingIds.has(id)) return 'mapping'
  if (peopleIds.has(id)) return 'people'
  return 'crud'
}

const defaultFields = [text('name', 'Name / title'), text('code', 'Code / reference'), textarea('description', 'Description', false)]

const fieldOverrides: Record<string, MightyField[]> = {
  branch: [text('name', 'Branch name'), text('code', 'Branch code'), text('phone', 'Phone number'), text('email', 'Email address'), textarea('address', 'Address')],
  'student-list': [
    text('firstName', 'First name'), text('lastName', 'Last name'), text('admissionNo', 'Admission number'),
    select('className', 'Class', classes), select('section', 'Section', sections), text('roll', 'Roll number'),
    select('gender', 'Gender', ['Male', 'Female', 'Other']), date('birthday', 'Date of birth'), text('guardian', 'Guardian name'),
    text('phone', 'Guardian phone'), textarea('address', 'Present address', false),
  ],
  'all-student-list': [text('name', 'Student name'), text('admissionNo', 'Admission number'), select('branch', 'Branch', ['Main Campus', 'East Campus', 'Junior Campus']), select('className', 'Class', classes), select('section', 'Section', sections)],
  'teacher-list': [text('name', 'Teacher name'), text('employeeId', 'Employee ID'), text('email', 'Email'), text('phone', 'Phone'), select('department', 'Department', ['Science', 'Mathematics', 'English', 'Administration']), select('designation', 'Designation', ['Teacher', 'Senior Teacher', 'Head of Department'])],
  'staff-list': [text('name', 'Staff name'), text('employeeId', 'Employee ID'), text('email', 'Email'), text('phone', 'Phone'), select('department', 'Department', ['Administration', 'Accounts', 'Transport', 'Library']), select('designation', 'Designation', ['Accountant', 'Librarian', 'Driver', 'Office Staff'])],
  'academic-session': [text('name', 'Session name'), date('startDate', 'Start date'), date('endDate', 'End date'), select('isCurrent', 'Current session', ['Yes', 'No'])],
  shift: [text('name', 'Shift name'), time('startTime', 'Start time'), time('endTime', 'End time')],
  class: [text('name', 'Class name'), number('numericValue', 'Numeric value'), select('shift', 'Shift', ['Morning Shift', 'Day Shift'])],
  section: [text('name', 'Section name'), select('className', 'Class', classes), text('roomNo', 'Room number')],
  group: [text('name', 'Group name'), select('className', 'Class', classes), textarea('description', 'Description', false)],
  period: [text('name', 'Period name'), time('startTime', 'Start time'), time('endTime', 'End time'), select('shift', 'Shift', ['Morning Shift', 'Day Shift'])],
  subjects: [text('name', 'Subject name'), text('code', 'Subject code'), select('type', 'Subject type', ['Theory', 'Practical', 'Theory + Practical']), number('fullMark', 'Full mark'), number('passMark', 'Pass mark')],
  'student-categories': [text('name', 'Category name'), textarea('description', 'Description', false)],
  department: [text('name', 'Department name'), text('code', 'Department code')],
  picklist: [text('name', 'Picklist name'), select('type', 'Picklist type', ['Blood Group', 'Religion', 'Relationship', 'Document Type']), textarea('values', 'Values (one per line)')],
  signature: [text('name', 'Signatory name'), text('designation', 'Designation'), { key: 'file', label: 'Signature image', type: 'file', required: true }],
  'payroll-start-up': [text('name', 'Salary head'), select('type', 'Type', ['Addition', 'Deduction']), select('calculation', 'Calculation', ['Fixed', 'Percentage']), number('amount', 'Default amount')],
  'fees-start-up': [text('name', 'Fee head'), text('code', 'Fee code'), select('frequency', 'Frequency', ['Monthly', 'Quarterly', 'Term', 'Annual']), select('fineApplicable', 'Fine applicable', ['Yes', 'No'])],
  waiver: [text('student', 'Student'), text('invoice', 'Invoice'), select('waiverType', 'Waiver type', ['Merit', 'Sibling', 'Staff Ward', 'Special']), number('amount', 'Waiver amount'), textarea('reason', 'Reason')],
  ledger: [text('name', 'Ledger name'), text('code', 'Ledger code'), select('group', 'Accounting group', ['Current Assets', 'Current Liabilities', 'Income', 'Expense']), select('fund', 'Fund', ['General Fund', 'Development Fund', 'Scholarship Fund']), number('openingBalance', 'Opening balance')],
  fund: [text('name', 'Fund name'), text('code', 'Fund code'), textarea('description', 'Description', false)],
  'account-category': [text('name', 'Category name'), select('type', 'Type', ['Income', 'Expense', 'Asset', 'Liability'])],
  'account-group': [text('name', 'Group name'), select('nature', 'Account nature', ['Debit', 'Credit']), textarea('description', 'Description', false)],
  'chart-of-account': [text('name', 'Account name'), text('code', 'Account code'), select('parent', 'Parent account', ['Assets', 'Liabilities', 'Income', 'Expenses']), select('type', 'Type', ['Group', 'Ledger'])],
  syllabus: [text('title', 'Syllabus title'), select('className', 'Class', classes), select('section', 'Section', sections), select('subject', 'Subject', subjects), textarea('description', 'Details'), { key: 'file', label: 'Syllabus file', type: 'file', required: false }],
  assignments: [text('title', 'Assignment title'), select('className', 'Class', classes), select('section', 'Section', sections), select('subject', 'Subject', subjects), date('deadline', 'Deadline'), number('fullMark', 'Full mark'), number('passMark', 'Pass mark'), textarea('description', 'Details'), { key: 'file', label: 'Attachment', type: 'file', required: false }],
  'book-categories': [text('name', 'Category name'), textarea('description', 'Description', false)],
  books: [text('name', 'Book name'), text('isbn', 'ISBN'), text('author', 'Author'), select('category', 'Category', ['Fiction', 'Science', 'Reference', 'Textbook']), number('quantity', 'Quantity'), text('shelf', 'Shelf number'), number('price', 'Price')],
  exam: [text('name', 'Exam name'), text('code', 'Exam code'), select('session', 'Session', sessions), date('startDate', 'Start date'), date('endDate', 'End date')],
  'remark-config': [text('name', 'Remark'), number('minimum', 'Minimum percentage'), number('maximum', 'Maximum percentage'), textarea('description', 'Description', false)],
  'sms-template': [text('name', 'Template name'), select('type', 'Template type', ['Attendance', 'Fees', 'Exam', 'General']), textarea('message', 'SMS message')],
  'phone-book-category': [text('name', 'Category name')],
  'phone-book': [text('name', 'Contact name'), select('category', 'Category', ['Emergency', 'Vendor', 'Committee']), text('phone', 'Phone number'), text('email', 'Email', false), textarea('address', 'Address', false)],
  notice: [text('title', 'Notice title'), select('audience', 'Audience', ['All', 'Students', 'Teachers', 'Parents', 'Selected class']), date('publishDate', 'Publish date'), textarea('notice', 'Notice')],
  event: [text('name', 'Event name'), date('startDate', 'Start date'), date('endDate', 'End date'), text('place', 'Event place'), textarea('description', 'Description')],
  'question-category': [text('name', 'Category name'), textarea('description', 'Description', false)],
  'question-class': [text('name', 'Class name')],
  'question-group': [text('name', 'Group name'), select('className', 'Class', classes)],
  'question-subject': [text('name', 'Subject name'), select('className', 'Class', classes), text('code', 'Subject code')],
  'question-chapter': [text('name', 'Chapter name'), select('subject', 'Subject', subjects)],
  'question-types': [text('name', 'Question type')],
  'question-level': [text('name', 'Level name'), select('chapter', 'Chapter', ['Algebra', 'Cell Biology', 'Literature'])],
  'question-topics': [text('name', 'Topic name'), select('chapter', 'Chapter', ['Algebra', 'Cell Biology', 'Literature'])],
  'question-sources': [text('name', 'Source name')],
  'question-sub-sources': [text('name', 'Sub-source name'), select('source', 'Source', ['NCERT', 'Board Paper', 'Teacher Authored'])],
  'question-year': [number('year', 'Year')],
  'question-board': [text('name', 'Board name'), text('shortName', 'Short name')],
  'question-tag': [text('name', 'Tag name')],
  roles: [text('name', 'Role name'), textarea('description', 'Description', false)],
  'zoom-classes': [text('topic', 'Meeting topic'), select('className', 'Class / audience', [...classes, 'All staff']), date('date', 'Meeting date'), time('startTime', 'Start time'), number('duration', 'Duration in minutes'), textarea('agenda', 'Agenda', false)],
  'about-us': [text('title', 'Section title'), textarea('content', 'Content'), { key: 'image', label: 'Section image', type: 'file', required: false }],
  banner: [text('title', 'Banner title'), text('subtitle', 'Subtitle'), text('buttonText', 'Button text'), text('buttonLink', 'Button link'), { key: 'image', label: 'Banner image', type: 'file', required: true }],
  'why-choose-us': [text('title', 'Title'), textarea('description', 'Description'), { key: 'image', label: 'Icon / image', type: 'file', required: false }],
  faq: [text('question', 'Question'), textarea('answer', 'Answer')],
  feedback: [text('name', 'Name'), text('designation', 'Designation'), number('rating', 'Rating'), textarea('message', 'Feedback')],
  hostels: [text('name', 'Hostel name'), select('type', 'Hostel type', ['Boys', 'Girls', 'Mixed']), text('warden', 'Warden'), text('phone', 'Phone'), textarea('address', 'Address')],
  'hostel-categories': [text('name', 'Category name'), number('monthlyFee', 'Monthly fee')],
  'hostel-rooms': [text('roomNo', 'Room number'), select('hostel', 'Hostel', ['North Residence', 'Girls Residence', 'Junior Residence']), select('category', 'Category', ['Single', 'Double', 'Dormitory']), number('capacity', 'Capacity')],
  'hostel-meals': [text('name', 'Meal name'), select('type', 'Meal type', ['Breakfast', 'Lunch', 'Dinner', 'Snack']), number('rate', 'Rate')],
  'transport-buses': [text('name', 'Bus name'), text('registration', 'Registration number'), number('capacity', 'Capacity'), text('model', 'Model'), date('fitnessExpiry', 'Fitness expiry')],
  'transport-drivers': [text('name', 'Driver name'), text('phone', 'Phone'), text('license', 'License number'), date('licenseExpiry', 'License expiry'), textarea('address', 'Address')],
  'bus-routes': [text('name', 'Route name'), select('bus', 'Bus', ['Bus 01', 'Bus 02', 'Bus 03']), select('driver', 'Driver', ['Raj Kumar', 'Sunil Yadav', 'Imran Khan']), number('monthlyFee', 'Monthly fee')],
  'bus-stops': [text('name', 'Stop name'), select('route', 'Route', ['Route A', 'Route B', 'Route C']), time('pickupTime', 'Pickup time'), time('dropTime', 'Drop time'), number('monthlyFee', 'Stop fee')],
  'payroll-mapping': [select('employee', 'Employee', ['Ethan Carter', 'Maya Thomas', 'Olivia Martin']), select('salaryHead', 'Salary head', ['Basic Salary', 'House Rent', 'Transport Allowance', 'Provident Fund']), select('type', 'Type', ['Addition', 'Deduction']), number('amount', 'Mapped amount')],
  'payroll-assign': [select('employee', 'Employee', ['Ethan Carter', 'Maya Thomas', 'Olivia Martin']), select('month', 'Payroll month', ['July 2026', 'June 2026', 'May 2026']), number('gross', 'Gross salary'), number('deduction', 'Deduction'), number('net', 'Net salary')],
  'salary-slip': [text('employee', 'Employee'), text('employeeId', 'Employee ID'), text('month', 'Month'), number('gross', 'Gross salary'), number('deduction', 'Deduction'), number('net', 'Net salary')],
  salary: [select('employee', 'Employee', ['Ethan Carter', 'Maya Thomas', 'Olivia Martin']), select('month', 'Salary month', ['July 2026', 'June 2026', 'May 2026']), number('amount', 'Payable salary'), select('paymentMethod', 'Payment method', ['Bank Transfer', 'Cash', 'Cheque']), text('reference', 'Payment reference')],
  'payroll-due': [text('employee', 'Employee'), text('month', 'Month'), number('dueAmount', 'Due amount'), date('dueDate', 'Due date')],
  advance: [select('employee', 'Employee', ['Ethan Carter', 'Maya Thomas', 'Olivia Martin']), number('amount', 'Advance amount'), date('date', 'Advance date'), textarea('reason', 'Reason'), number('installments', 'Recovery installments')],
  'fees-mapping': [select('className', 'Class', classes), select('feeHead', 'Fee head', ['Tuition Fee', 'Transport Fee', 'Laboratory Fee', 'Annual Fee']), select('frequency', 'Frequency', ['Monthly', 'Quarterly', 'Term', 'Annual']), number('amount', 'Amount')],
  'amount-config': [select('feeHead', 'Fee head', ['Tuition Fee', 'Transport Fee', 'Laboratory Fee', 'Annual Fee']), select('className', 'Class', classes), number('amount', 'Configured amount'), select('session', 'Session', sessions)],
  'date-config': [select('feeHead', 'Fee head', ['Tuition Fee', 'Transport Fee', 'Laboratory Fee', 'Annual Fee']), select('session', 'Session', sessions), date('dueDate', 'Due date'), date('fineStartDate', 'Fine start date')],
  'waiver-config': [text('name', 'Waiver name'), select('type', 'Waiver type', ['Fixed Amount', 'Percentage']), number('value', 'Waiver value'), select('appliesTo', 'Applies to', ['All Fees', 'Tuition Fee', 'Transport Fee'])],
  'paid-info': [text('receiptNo', 'Receipt number'), text('student', 'Student'), text('feeHead', 'Fee head'), number('amount', 'Paid amount'), date('paymentDate', 'Payment date'), text('method', 'Method')],
  'unpaid-info': [text('invoiceNo', 'Invoice number'), text('student', 'Student'), text('feeHead', 'Fee head'), number('amount', 'Outstanding amount'), date('dueDate', 'Due date')],
  'balance-sheet': [text('account', 'Account head'), select('side', 'Balance side', ['Assets', 'Liabilities']), number('opening', 'Opening'), number('movement', 'Movement'), number('closing', 'Closing')],
  'trial-balance': [text('ledger', 'Ledger'), number('debit', 'Debit'), number('credit', 'Credit'), number('balance', 'Balance')],
  'cash-flow': [text('activity', 'Cash activity'), select('type', 'Type', ['Operating', 'Investing', 'Financing']), number('inflow', 'Inflow'), number('outflow', 'Outflow')],
  'income-statement': [text('account', 'Income / expense head'), select('type', 'Type', ['Income', 'Expense']), number('amount', 'Amount')],
  'fund-wise-report': [text('fund', 'Fund'), number('opening', 'Opening balance'), number('receipt', 'Receipts'), number('payment', 'Payments'), number('closing', 'Closing balance')],
  'ledger-wise-report': [text('ledger', 'Ledger'), text('voucher', 'Voucher'), date('date', 'Date'), number('debit', 'Debit'), number('credit', 'Credit')],
  'user-wise-report': [text('user', 'User'), number('voucherCount', 'Voucher count'), number('debit', 'Total debit'), number('credit', 'Total credit')],
  'voucher-wise-report': [text('voucher', 'Voucher number'), select('type', 'Voucher type', ['Payment', 'Receipt', 'Contra', 'Journal']), date('date', 'Date'), number('amount', 'Amount')],
  'library-members': [text('memberId', 'Member ID'), text('name', 'Member name'), select('memberType', 'Member type', ['Student', 'Teacher', 'Staff']), select('className', 'Class / department', [...classes, 'Administration']), text('phone', 'Phone')],
  'books-issue': [text('issueNo', 'Issue number'), text('member', 'Member'), text('book', 'Book'), date('issueDate', 'Issue date'), date('dueDate', 'Due date')],
  'books-return': [text('issueNo', 'Issue number'), text('member', 'Member'), text('book', 'Book'), date('issueDate', 'Issue date'), date('dueDate', 'Due date'), date('returnDate', 'Return date', false), number('fine', 'Fine', false)],
  'books-issue-report': [text('issueNo', 'Issue number'), text('member', 'Member'), text('book', 'Book'), date('issueDate', 'Issue date'), date('dueDate', 'Due date'), text('returnStatus', 'Return status')],
  'exam-start-up': [select('exam', 'Exam', ['Term I Examination', 'Mathematics Unit Test']), select('className', 'Class', classes), select('section', 'Section', sections), select('subject', 'Subject', subjects), select('teacher', 'Examiner', ['Ethan Carter', 'Maya Thomas', 'Sophia Miller'])],
  'mark-config': [select('exam', 'Exam', ['Term I Examination', 'Mathematics Unit Test']), select('subject', 'Subject', subjects), number('objectiveMark', 'Objective mark'), number('writtenMark', 'Written mark'), number('practicalMark', 'Practical mark'), number('passMark', 'Pass mark')],
  'sms-configuration': [text('provider', 'SMS provider'), text('senderId', 'Sender ID'), text('apiUrl', 'API URL'), text('apiKey', 'API key'), select('unicode', 'Unicode support', ['Enabled', 'Disabled'])],
  'sms-sent': [select('recipientType', 'Recipient type', ['All Students', 'All Parents', 'All Staff', 'Selected Class', 'Phone Book']), select('template', 'Template', ['Attendance Alert', 'Fee Reminder', 'Exam Notice', 'General']), textarea('message', 'Message'), date('sendDate', 'Send date')],
  'absent-sms': [date('attendanceDate', 'Attendance date'), select('className', 'Class', classes), select('section', 'Section', sections), textarea('message', 'Absent notification')],
  'purchase-sms': [text('package', 'SMS package'), number('credits', 'Credits'), number('amount', 'Amount'), date('purchaseDate', 'Purchase date'), text('transaction', 'Transaction reference')],
  'sms-report': [date('date', 'Date'), text('recipient', 'Recipient'), text('phone', 'Phone'), text('message', 'Message'), select('delivery', 'Delivery status', ['Delivered', 'Pending', 'Failed'])],
  'user-activities': [text('user', 'User'), text('module', 'Module'), text('action', 'Action'), date('date', 'Date'), text('ipAddress', 'IP address')],
  'fee-monthly-report': [text('month', 'Month'), number('expected', 'Expected'), number('collected', 'Collected'), number('outstanding', 'Outstanding'), number('ratio', 'Collection ratio %')],
  'fees-payment-info': [text('receipt', 'Receipt'), text('student', 'Student'), text('feeHead', 'Fee head'), date('date', 'Payment date'), number('amount', 'Amount')],
  'head-wise-info': [text('feeHead', 'Fee head'), number('mapped', 'Mapped students'), number('expected', 'Expected'), number('collected', 'Collected'), number('outstanding', 'Outstanding')],
  'fees-unpaid-info': [text('student', 'Student'), text('className', 'Class'), text('feeHead', 'Fee head'), date('dueDate', 'Due date'), number('amount', 'Unpaid amount')],
  'payment-ratio-info': [text('className', 'Class'), number('students', 'Students'), number('paid', 'Paid'), number('unpaid', 'Unpaid'), number('ratio', 'Payment ratio %')],
  'system-settings': [text('schoolName', 'School name'), text('schoolCode', 'School code'), text('phone', 'Phone'), text('email', 'Email'), textarea('address', 'Address'), select('language', 'Default language', ['English', 'Hindi', 'Bengali']), select('timezone', 'Timezone', ['Asia/Kolkata', 'Asia/Dhaka', 'UTC'])],
  'payment-gateway': [select('gateway', 'Gateway', ['Razorpay', 'Stripe', 'PayPal', 'Paytm']), text('merchantId', 'Merchant ID'), text('publicKey', 'Public key'), text('secretKey', 'Secret key'), select('mode', 'Mode', ['Test', 'Live'])],
  employees: [text('name', 'Employee name'), text('employeeId', 'Employee ID'), text('email', 'Email'), text('phone', 'Phone'), select('role', 'Role', ['Administrator', 'Teacher', 'Accountant', 'Librarian', 'Driver']), select('department', 'Department', ['Administration', 'Science', 'Accounts', 'Library', 'Transport']), date('joiningDate', 'Joining date')],
  'zoom-config': [text('accountId', 'Account ID'), text('clientId', 'Client ID'), text('clientSecret', 'Client secret'), text('hostEmail', 'Default host email'), select('autoRecording', 'Auto recording', ['None', 'Local', 'Cloud'])],
  'mobile-app-section': [text('title', 'Section title'), textarea('description', 'Description'), text('androidLink', 'Android app link'), text('iosLink', 'iOS app link'), { key: 'image', label: 'App image', type: 'file', required: false }],
  'ready-to-join': [text('title', 'Section title'), textarea('description', 'Description'), text('buttonText', 'Button text'), text('buttonLink', 'Button link')],
  gallery: [text('title', 'Gallery title'), select('category', 'Category', ['Campus', 'Events', 'Academic', 'Sports']), date('date', 'Date'), { key: 'image', label: 'Gallery image', type: 'file', required: true }],
  theme: [select('primaryColor', 'Primary colour', ['Indigo', 'Blue', 'Green', 'Orange']), select('headerStyle', 'Header style', ['Light', 'Dark', 'Transparent']), select('font', 'Website font', ['DM Sans', 'Inter', 'Manrope']), select('layout', 'Layout', ['Wide', 'Boxed'])],
  'hostel-members': [text('memberId', 'Member ID'), select('student', 'Student', ['Aarav Mehta', 'Diya Kapoor', 'Ishaan Verma']), select('hostel', 'Hostel', ['North Residence', 'Girls Residence', 'Junior Residence']), select('room', 'Room', ['N-101', 'N-102', 'G-201']), date('checkIn', 'Check-in date'), text('guardianPhone', 'Guardian phone')],
  'hostel-meal-plan': [text('name', 'Plan name'), select('hostel', 'Hostel', ['North Residence', 'Girls Residence', 'Junior Residence']), select('meal', 'Meal', ['Breakfast', 'Lunch', 'Dinner', 'Full Day']), number('monthlyRate', 'Monthly rate')],
  'hostel-meal-entries': [select('member', 'Member', ['Aarav Mehta', 'Diya Kapoor', 'Ishaan Verma']), date('date', 'Meal date'), select('meal', 'Meal', ['Breakfast', 'Lunch', 'Dinner']), number('quantity', 'Quantity'), number('amount', 'Amount')],
  'hostel-bills': [text('billNo', 'Bill number'), select('member', 'Member', ['Aarav Mehta', 'Diya Kapoor', 'Ishaan Verma']), text('month', 'Billing month'), number('roomCharge', 'Room charge'), number('mealCharge', 'Meal charge'), number('total', 'Total')],
  'transport-members': [text('memberId', 'Member ID'), select('student', 'Student', ['Aarav Mehta', 'Diya Kapoor', 'Ishaan Verma']), select('route', 'Route', ['Route A', 'Route B', 'Route C']), select('stop', 'Stop', ['Green Park', 'Saket', 'Malviya Nagar']), select('bus', 'Bus', ['Bus 01', 'Bus 02', 'Bus 03']), number('monthlyFee', 'Monthly fee')],
}

const commonFilters: MightyField[] = [
  select('session', 'Session', sessions),
  select('className', 'Class', classes),
  select('section', 'Section', sections),
]
const filterOverrides: Record<string, MightyField[]> = {
  'student-list': [...commonFilters, select('group', 'Group', ['All', 'Science', 'Commerce', 'Humanities'])],
  'all-student-list': [select('branch', 'Branch', ['All branches', 'Main Campus', 'East Campus']), ...commonFilters],
  'student-attendance': [...commonFilters, date('date', 'Attendance date')],
  'attendance-report': [...commonFilters, date('from', 'From date'), date('to', 'To date')],
  'monthly-attendance-report': [...commonFilters, select('month', 'Month', ['July 2026', 'June 2026', 'May 2026'])],
  'staff-attendance': [date('date', 'Attendance date'), select('department', 'Department', ['All', 'Science', 'Administration', 'Accounts'])],
  'staff-attendance-report': [select('department', 'Department', ['All', 'Science', 'Administration', 'Accounts']), date('from', 'From date'), date('to', 'To date')],
  'mark-input': [...commonFilters, select('exam', 'Exam', ['Term I Examination', 'Mathematics Unit Test']), select('subject', 'Subject', subjects)],
  'mark-sheet': [...commonFilters, select('exam', 'Exam', ['Term I Examination', 'Mathematics Unit Test']), text('student', 'Student / roll')],
  'exam-result': [...commonFilters, select('exam', 'Exam', ['Term I Examination', 'Mathematics Unit Test'])],
}

function defaultFilters(id: string, kind: MightyWorkflowKind) {
  if (filterOverrides[id]) return filterOverrides[id]
  if (kind === 'report') return [select('session', 'Session', sessions), date('from', 'From date'), date('to', 'To date')]
  if (kind === 'mapping' || kind === 'routine' || kind === 'migration') return commonFilters
  return []
}

function defaultStatuses(kind: MightyWorkflowKind) {
  if (kind === 'report') return ['Ready', 'Generated']
  if (kind === 'migration') return ['Pending', 'Processing', 'Completed', 'Pushed back']
  if (kind === 'attendance') return ['Present', 'Absent', 'Late', 'Leave']
  if (kind === 'voucher') return ['Draft', 'Posted', 'Reversed']
  if (kind === 'marks') return ['Pending', 'In progress', 'Submitted', 'Published']
  if (kind === 'certificate') return ['Draft', 'Generated', 'Downloaded']
  if (kind === 'library') return ['Issued', 'Returned', 'Overdue']
  if (kind === 'communication') return ['Draft', 'Scheduled', 'Sent', 'Published']
  return ['Active', 'Inactive']
}

const navigationLeaves = flattenNavigation(adminNavigation).filter((item) => !item.children && item.id !== 'dashboard')

export const mightyWorkflowMap = Object.fromEntries(
  navigationLeaves.map((item) => {
    const kind = workflowKind(item.id)
    const workflow: MightyWorkflowDefinition = {
      id: item.id,
      title: item.label,
      description: descriptions[item.id] || `Manage ${item.label.toLowerCase()} using the same operational flow as Mighty School.`,
      kind,
      fields: fieldOverrides[item.id] || defaultFields,
      filters: defaultFilters(item.id, kind),
      statuses: defaultStatuses(kind),
      primaryAction:
        kind === 'report' ? 'Generate Report'
          : kind === 'collection' ? 'New Collection'
            : kind === 'migration' ? 'Start Migration'
              : kind === 'attendance' ? 'Save Attendance'
                : kind === 'certificate' ? 'Generate'
                  : kind === 'backup' ? 'Create Backup'
                    : kind === 'ai' ? 'New Chat'
                      : `Add ${item.label}`,
    }
    return [item.id, workflow]
  }),
) as Record<string, MightyWorkflowDefinition>
