import type { Role } from './data'

export type AccessMode = 'manage' | 'operate' | 'personal' | 'linked' | 'oversight'

const matrix: Record<Role, Record<string, AccessMode>> = {
  superadmin: {
    Dashboard:'oversight','Approval Center':'manage',Admissions:'oversight',People:'oversight',Academics:'oversight',Timetable:'oversight',Attendance:'oversight',Assignments:'oversight','Exams & Results':'oversight','Fees & Finance':'oversight',Announcements:'manage',Messages:'operate',Transport:'oversight',Library:'oversight','HR & Payroll':'oversight',Reports:'oversight',Settings:'manage'
  },
  admin: {
    Dashboard:'manage',Admissions:'operate','User Accounts':'manage',People:'manage',Academics:'manage',Timetable:'manage',Attendance:'operate',Assignments:'oversight','Exams & Results':'manage','Fees & Finance':'manage',Announcements:'manage',Messages:'operate',Transport:'manage',Library:'manage','HR & Payroll':'manage',Reports:'oversight',Settings:'manage'
  },
  teacher: {
    Dashboard:'operate','My Classes':'operate',Timetable:'personal',Attendance:'operate',Assignments:'operate','Exams & Results':'operate',Announcements:'operate',Messages:'operate',Library:'personal',Reports:'personal'
  },
  student: {
    Dashboard:'personal','My Learning':'personal',Timetable:'personal',Attendance:'personal',Assignments:'personal','Exams & Results':'personal',Announcements:'personal',Messages:'operate',Transport:'personal',Library:'personal'
  },
  guardian: {
    Dashboard:'linked','My Children':'linked',Timetable:'linked',Attendance:'linked',Assignments:'linked','Exams & Results':'linked','Fees & Finance':'linked',Announcements:'linked',Messages:'operate',Transport:'linked'
  }
}

export function accessFor(role:Role,module:string):AccessMode|undefined{return matrix[role][module]}
export function canCreate(role:Role,module:string){const mode=accessFor(role,module);if(mode==='manage')return true;if(role==='admin'&&module==='Admissions')return true;return mode==='operate'&&['Assignments','Announcements','Messages','Attendance','Exams & Results'].includes(module)}
export function canEdit(role:Role,module:string){const mode=accessFor(role,module);return mode==='manage'||mode==='operate'&&module!=='Messages'}
export function canDelete(role:Role,module:string){return role==='admin'&&['Admissions','People','Academics','Timetable','Announcements','Transport','Library'].includes(module)}
export function canImport(role:Role,module:string){return role==='admin'&&['Admissions','People','Academics','Fees & Finance','Library'].includes(module)}
