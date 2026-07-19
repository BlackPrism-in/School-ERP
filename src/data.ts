import { LayoutDashboard, Users, GraduationCap, CalendarDays, ClipboardCheck, BookOpen, FileText, WalletCards, Megaphone, MessagesSquare, Bus, Library, BriefcaseBusiness, BarChart3, Settings, UserRoundPlus, ShieldCheck } from 'lucide-vue-next'

export type Role = 'superadmin' | 'admin' | 'teacher' | 'student' | 'guardian'
export const roles: { id: Role; label: string; name: string; initials: string }[] = [
  { id: 'superadmin', label: 'Super Admin', name: 'Dr. James Wilson', initials: 'JW' },
  { id: 'admin', label: 'Administrator', name: 'Olivia Martin', initials: 'OM' },
  { id: 'teacher', label: 'Teacher', name: 'Ethan Carter', initials: 'EC' },
  { id: 'student', label: 'Student', name: 'Aarav Mehta', initials: 'AM' },
  { id: 'guardian', label: 'Guardian', name: 'Priya Mehta', initials: 'PM' },
]

export const menu = [
  { label: 'Dashboard', icon: LayoutDashboard, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Approval Center', icon: ShieldCheck, roles: ['superadmin'] },
  { label: 'Admissions', icon: UserRoundPlus, roles: ['superadmin','admin'] },
  { label: 'User Accounts', icon: Users, roles: ['admin'] },
  { label: 'People', icon: Users, roles: ['superadmin','admin'] },
  { label: 'My Classes', icon: GraduationCap, roles: ['teacher'] },
  { label: 'My Learning', icon: GraduationCap, roles: ['student'] },
  { label: 'My Children', icon: Users, roles: ['guardian'] },
  { label: 'Academics', icon: GraduationCap, roles: ['superadmin','admin'] },
  { label: 'Timetable', icon: CalendarDays, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Attendance', icon: ClipboardCheck, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Assignments', icon: BookOpen, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Exams & Results', icon: FileText, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Fees & Finance', icon: WalletCards, roles: ['superadmin','admin','guardian'] },
  { label: 'Announcements', icon: Megaphone, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Messages', icon: MessagesSquare, roles: ['superadmin','admin','teacher','student','guardian'] },
  { label: 'Transport', icon: Bus, roles: ['superadmin','admin','student','guardian'] },
  { label: 'Library', icon: Library, roles: ['superadmin','admin','teacher','student'] },
  { label: 'HR & Payroll', icon: BriefcaseBusiness, roles: ['superadmin','admin'] },
  { label: 'Reports', icon: BarChart3, roles: ['superadmin','admin','teacher'] },
  { label: 'Settings', icon: Settings, roles: ['superadmin','admin'] },
]

export const roleData = {
  superadmin: {
    greeting: 'Good morning, Dr. Wilson', subtitle: 'Institution oversight, approvals and compliance are up to date.',
    stats: [['Total enrollment','1,248','+4.6% year on year','violet'],['Pending approvals','9','3 require attention','orange'],['School performance','91.4%','Across all grades','green'],['Operational health','98%','All systems online','blue']],
  },
  admin: {
    greeting: 'Good morning, Olivia', subtitle: 'Here’s what’s happening at EduNova today.',
    stats: [['Total students','1,248','+36 this term','violet'],['Teaching staff','86','92% present','blue'],['Fee collected','₹18.4L','78% of target','green'],['Pending tasks','12','4 need attention','orange']],
  },
  teacher: {
    greeting: 'Good morning, Ethan', subtitle: 'You have 4 classes and 2 assignments to review today.',
    stats: [['Classes today','4','Next at 10:15','violet'],['My students','142','Across 5 sections','blue'],['Attendance','94%','This month','green'],['To review','18','Submissions','orange']],
  },
  student: {
    greeting: 'Hey Aarav, ready to learn?', subtitle: 'Your next class starts in 35 minutes.',
    stats: [['Attendance','96%','Excellent standing','green'],['Assignments','3','Due this week','violet'],['Average score','88%','Top 12% of class','blue'],['Library books','2','1 due Friday','orange']],
  },
  guardian: {
    greeting: 'Good morning, Priya', subtitle: 'Here is Aarav’s latest school update.',
    stats: [['Attendance','96%','2 absences this term','green'],['Fee balance','₹12,500','Due 28 Jul','orange'],['Average score','88%','Up 4% this term','blue'],['Unread updates','5','2 from teachers','violet']],
  },
}
