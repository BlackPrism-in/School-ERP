/**
 * Populates a school with realistic demo data.
 *
 *   npm run seed:demo -- --email principal@school.edu
 *
 * Everything here is invented. It exists so a walkthrough shows a working
 * school rather than eleven empty screens — an empty app demos terribly even
 * when every feature works.
 *
 * REFUSES TO RUN if the tenant already has students, so it can never be
 * pointed at a school's real data by accident.
 */
import { randomInt } from 'node:crypto'
import { closeDb, db } from '../src/db/client.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/env.js'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

const adminEmail = arg('--email')
const slug = arg('--slug') ?? env().TENANT_SLUG
const demoPassword = arg('--password') ?? 'DemoSchool2026!'

if (!adminEmail) {
  console.error('Missing --email (the existing bootstrap admin).')
  console.error('Usage: npm run seed:demo -- --email principal@school.edu')
  process.exit(1)
}

const FIRST_NAMES = [
  'Aarav', 'Diya', 'Ishaan', 'Ananya', 'Vihaan', 'Saanvi', 'Arjun', 'Myra',
  'Kabir', 'Aadhya', 'Reyansh', 'Anika', 'Vivaan', 'Navya', 'Aryan', 'Kiara',
  'Rudra', 'Pari', 'Shaurya', 'Riya', 'Atharv', 'Ira', 'Krishna', 'Sara',
  'Advik', 'Meera', 'Dhruv', 'Aisha', 'Kian', 'Zara',
]
const LAST_NAMES = [
  'Mehta', 'Kapoor', 'Verma', 'Sharma', 'Nair', 'Iyer', 'Singh', 'Patel',
  'Reddy', 'Joshi', 'Gupta', 'Rao', 'Desai', 'Malhotra', 'Chopra',
]

const pick = <T,>(a: T[]) => a[randomInt(a.length)]!

const sql = db()

try {
  const [tenant] = await sql<{ id: string; name: string }[]>`
    select id, name from tenant where slug = ${slug}
  `
  if (!tenant) throw new Error(`No tenant with slug "${slug}". Run bootstrap first.`)

  const [existing] = await sql<{ n: string }[]>`
    select count(*) as n from student where tenant_id = ${tenant.id}
  `
  if (Number(existing!.n) > 0) {
    throw new Error(
      `"${tenant.name}" already has ${existing!.n} student(s). ` +
        `Refusing to seed demo data over an existing school.`,
    )
  }

  const [admin] = await sql<{ id: string }[]>`
    select id from app_user where tenant_id = ${tenant.id} and email = ${adminEmail}
  `
  if (!admin) throw new Error(`No admin with email ${adminEmail} in that tenant.`)

  const [session] = await sql<{ id: string; start_date: Date }[]>`
    select id, start_date from academic_session where tenant_id = ${tenant.id} and is_current
  `
  if (!session) throw new Error('No current academic session.')

  const [branch] = await sql<{ id: string }[]>`
    select id from branch where tenant_id = ${tenant.id} and is_primary
  `

  await sql`select set_config('app.tenant_id', ${tenant.id}, false)`
  await sql`select set_config('app.user_id', ${admin.id}, false)`

  const t = tenant.id
  const hash = await hashPassword(demoPassword)
  const log = (m: string) => console.log(`  ${m}`)

  console.log(`\nSeeding demo data into "${tenant.name}"…\n`)

  // ------------------------------------------------------------- structure

  const subjectNames = ['Mathematics', 'Science', 'English', 'Social Science', 'Computer Science', 'Hindi']
  const subjects: string[] = []
  for (const name of subjectNames) {
    const [row] = await sql<{ id: string }[]>`
      insert into subject (tenant_id, name) values (${t}, ${name}) returning id
    `
    subjects.push(row!.id)
  }

  const classes: { id: string; name: string; sections: { id: string; name: string }[] }[] = []
  for (const [order, name] of [[8, 'Grade 8'], [9, 'Grade 9'], [10, 'Grade 10']] as const) {
    const [cls] = await sql<{ id: string }[]>`
      insert into class_level (tenant_id, name, sort_order) values (${t}, ${name}, ${order}) returning id
    `
    const sections: { id: string; name: string }[] = []
    for (const sectionName of ['A', 'B']) {
      const [sec] = await sql<{ id: string }[]>`
        insert into section (tenant_id, branch_id, class_level_id, session_id, name, capacity)
        values (${t}, ${branch!.id}, ${cls!.id}, ${session.id}, ${sectionName}, 40) returning id
      `
      sections.push({ id: sec!.id, name: sectionName })
    }
    classes.push({ id: cls!.id, name, sections })
  }
  log(`3 classes, 6 sections, ${subjects.length} subjects`)

  // ----------------------------------------------------------------- staff

  const teachers: { id: string; name: string }[] = []
  const teacherSeeds = [
    ['Maya', 'Thomas', 'Head of Science', 'maya@demo.school'],
    ['Ethan', 'Carter', 'Mathematics Teacher', 'ethan@demo.school'],
    ['Sophia', 'Miller', 'English Teacher', 'sophia@demo.school'],
    ['Raj', 'Kumar', 'Social Science Teacher', null],
    ['Nisha', 'Verma', 'Office Administrator', null],
  ] as const

  for (const [first, last, designation, email] of teacherSeeds) {
    let userId: string | null = null
    if (email) {
      const [user] = await sql<{ id: string }[]>`
        insert into app_user (tenant_id, email, password_hash, display_name, must_change_password)
        values (${t}, ${email}, ${hash}, ${`${first} ${last}`}, false) returning id
      `
      userId = user!.id
      await sql`
        insert into user_role (user_id, role_id)
        select ${userId}, id from role where tenant_id = ${t} and key = 'teacher'
      `
    }
    const [staff] = await sql<{ id: string }[]>`
      insert into staff (tenant_id, user_id, branch_id, employee_no, first_name, last_name,
                         designation, is_teaching, status)
      values (${t}, ${userId}, ${branch!.id}, ${`EMP-${teachers.length + 1}`.padEnd(6, '0')},
              ${first}, ${last}, ${designation}, ${designation !== 'Office Administrator'}, 'active')
      returning id
    `
    teachers.push({ id: staff!.id, name: `${first} ${last}` })
  }

  // An accountant, so the fees demo can be shown under the right role.
  const [bursar] = await sql<{ id: string }[]>`
    insert into app_user (tenant_id, email, password_hash, display_name, must_change_password)
    values (${t}, 'accounts@demo.school', ${hash}, 'Priya Shah', false) returning id
  `
  await sql`
    insert into user_role (user_id, role_id)
    select ${bursar!.id}, id from role where tenant_id = ${t} and key = 'accountant'
  `
  log(`${teachers.length} staff · 4 with logins`)

  // Class teachers and teaching assignments.
  for (const [i, cls] of classes.entries()) {
    for (const [j, sec] of cls.sections.entries()) {
      const teacher = teachers[(i * 2 + j) % 4]!
      await sql`update section set class_teacher_id = ${teacher.id} where id = ${sec.id}`
      for (const subjectId of subjects.slice(0, 4)) {
        await sql`
          insert into teaching_assignment (tenant_id, session_id, staff_id, section_id, subject_id)
          values (${t}, ${session.id}, ${teacher.id}, ${sec.id}, ${subjectId})
          on conflict do nothing
        `
      }
    }
  }

  // -------------------------------------------------------------- students

  const enrolments: { id: string; studentId: string; sectionId: string }[] = []
  let admissionCounter = 1

  for (const cls of classes) {
    for (const sec of cls.sections) {
      const count = 12 + randomInt(6)
      for (let roll = 1; roll <= count; roll += 1) {
        const first = pick(FIRST_NAMES)
        const last = pick(LAST_NAMES)
        const admissionNo = `ADM-${String(admissionCounter++).padStart(4, '0')}`
        const birthYear = 2026 - (Number(cls.name.split(' ')[1]) + 5)

        const [student] = await sql<{ id: string }[]>`
          insert into student (tenant_id, admission_no, first_name, last_name, date_of_birth,
                               gender, admission_date, city, state, status)
          values (${t}, ${admissionNo}, ${first}, ${last},
                  ${`${birthYear}-${String(1 + randomInt(12)).padStart(2, '0')}-${String(1 + randomInt(28)).padStart(2, '0')}`},
                  ${pick(['male', 'female'])}, ${session.start_date}, 'New Delhi', 'Delhi', 'active')
          returning id
        `
        const [enrolment] = await sql<{ id: string }[]>`
          insert into enrolment (tenant_id, student_id, session_id, branch_id, class_level_id,
                                 section_id, roll_no)
          values (${t}, ${student!.id}, ${session.id}, ${branch!.id}, ${cls.id}, ${sec.id}, ${String(roll)})
          returning id
        `
        enrolments.push({ id: enrolment!.id, studentId: student!.id, sectionId: sec.id })

        // A guardian for most, so the student record looks complete.
        if (roll % 3 !== 0) {
          const [guardian] = await sql<{ id: string }[]>`
            insert into guardian (tenant_id, first_name, last_name, phone, email)
            values (${t}, ${pick(['Priya', 'Rohit', 'Anita', 'Suresh', 'Kavita'])}, ${last},
                    ${`9${String(randomInt(900000000) + 100000000)}`},
                    ${`${last.toLowerCase()}.family@example.com`})
            returning id
          `
          await sql`
            insert into student_guardian (tenant_id, student_id, guardian_id, relation,
                                          is_primary_contact, is_emergency_contact, is_consent_giver)
            values (${t}, ${student!.id}, ${guardian!.id}, ${pick(['father', 'mother'])}, true, true, true)
          `
          await sql`
            insert into consent_record (tenant_id, student_id, guardian_id, purpose, is_granted,
                                        notice_version, granted_at, recorded_by)
            values (${t}, ${student!.id}, ${guardian!.id}, 'core_academic_records', true, 'v1',
                    now(), ${admin.id})
          `
        }
      }
    }
  }
  log(`${enrolments.length} students enrolled, most with a guardian and recorded consent`)

  // ------------------------------------------------------------ attendance

  const today = new Date()
  let attendanceRows = 0
  for (let dayOffset = 20; dayOffset >= 1; dayOffset -= 1) {
    const date = new Date(today.getTime() - dayOffset * 86_400_000)
    if (date.getDay() === 0) continue // Sunday
    const iso = date.toISOString().slice(0, 10)
    if (iso < session.start_date.toISOString().slice(0, 10)) continue

    for (const enrolment of enrolments) {
      // ~94% present, which is what a real register looks like.
      const roll = randomInt(100)
      const status = roll < 92 ? 'present' : roll < 96 ? 'absent' : roll < 98 ? 'late' : 'leave'
      await sql`
        insert into attendance_record (tenant_id, session_id, enrolment_id, date, status, marked_by)
        values (${t}, ${session.id}, ${enrolment.id}, ${iso}, ${status}, ${admin.id})
        on conflict do nothing
      `
      attendanceRows += 1
    }
  }
  log(`${attendanceRows} attendance records across the last ~3 weeks`)

  // ------------------------------------------------------------------ fees

  const feeHeads: { id: string; name: string; amount: string }[] = []
  for (const [name, amount] of [
    ['Tuition Fee', '12500.00'],
    ['Transport Fee', '4800.00'],
    ['Laboratory Fee', '2200.00'],
  ] as const) {
    const [head] = await sql<{ id: string }[]>`
      insert into fee_head (tenant_id, name) values (${t}, ${name}) returning id
    `
    feeHeads.push({ id: head!.id, name, amount })
  }

  const [structure] = await sql<{ id: string }[]>`
    insert into fee_structure (tenant_id, session_id, name, status)
    values (${t}, ${session.id}, 'Term I', 'published') returning id
  `
  const [instalment] = await sql<{ id: string; due_date: Date }[]>`
    insert into fee_instalment (tenant_id, fee_structure_id, name, due_date, sequence)
    values (${t}, ${structure!.id}, 'Term I', ${new Date(today.getTime() + 10 * 86_400_000).toISOString().slice(0, 10)}, 1)
    returning id, due_date
  `
  for (const head of feeHeads) {
    await sql`
      insert into fee_structure_item (tenant_id, fee_structure_id, fee_instalment_id, fee_head_id, amount)
      values (${t}, ${structure!.id}, ${instalment!.id}, ${head.id}, ${head.amount}::numeric)
    `
  }

  await sql`
    insert into document_sequence (tenant_id, scope, scope_key, prefix, padding)
    values (${t}, 'invoice', ${session.id}, 'INV/', 5), (${t}, 'receipt', ${session.id}, 'RCT/', 5)
    on conflict do nothing
  `

  let invoiced = 0
  let collected = 0
  for (const enrolment of enrolments) {
    await sql`
      insert into fee_assignment (tenant_id, enrolment_id, fee_structure_id, assigned_by)
      values (${t}, ${enrolment.id}, ${structure!.id}, ${admin.id})
    `
    const [invoiceNo] = await sql<{ n: string }[]>`
      select next_document_number(${t}, 'invoice', ${session.id}) as n
    `
    const [invoice] = await sql<{ id: string }[]>`
      insert into invoice (tenant_id, session_id, enrolment_id, fee_instalment_id, invoice_no,
                           due_date, gross_amount, concession_amount, fine_amount, status, created_by)
      values (${t}, ${session.id}, ${enrolment.id}, ${instalment!.id}, ${invoiceNo!.n},
              ${instalment!.due_date}, 0, 0, 0, 'issued', ${admin.id})
      returning id
    `
    await sql`
      insert into invoice_line (tenant_id, invoice_id, fee_head_id, description, gross_amount,
                                concession_amount, fine_amount)
      select ${t}, ${invoice!.id}, fsi.fee_head_id, fh.name, fsi.amount, 0, 0
        from fee_structure_item fsi join fee_head fh on fh.id = fsi.fee_head_id
       where fsi.fee_structure_id = ${structure!.id}
    `
    await sql`
      update invoice i set gross_amount = t2.gross
        from (select coalesce(sum(gross_amount), 0) as gross from invoice_line
               where invoice_id = ${invoice!.id}) t2
       where i.id = ${invoice!.id}
    `
    invoiced += 1

    // About 60% have paid in full, 15% part-paid — a realistic mid-term picture.
    const roll = randomInt(100)
    if (roll < 75) {
      const [net] = await sql<{ net: string }[]>`select net_amount::text as net from invoice where id = ${invoice!.id}`
      const full = roll < 60
      const amount = full ? net!.net : (Number(net!.net) / 2).toFixed(2)

      const [receiptNo] = await sql<{ n: string }[]>`
        select next_document_number(${t}, 'receipt', ${session.id}) as n
      `
      const [payment] = await sql<{ id: string }[]>`
        insert into payment (tenant_id, session_id, enrolment_id, receipt_no, paid_on, amount,
                             method, collected_by)
        values (${t}, ${session.id}, ${enrolment.id}, ${receiptNo!.n},
                ${new Date(today.getTime() - randomInt(15) * 86_400_000).toISOString().slice(0, 10)},
                ${amount}::numeric, ${pick(['cash', 'upi', 'card', 'bank_transfer'])}, ${bursar!.id})
        returning id
      `
      await sql`
        insert into payment_allocation (tenant_id, payment_id, invoice_id, amount)
        values (${t}, ${payment!.id}, ${invoice!.id}, ${amount}::numeric)
      `
      await sql`
        update invoice i set status = case when b.balance_amount <= 0 then 'paid' else 'partly_paid' end
          from invoice_balance b where b.invoice_id = i.id and i.id = ${invoice!.id}
      `
      collected += 1
    }
  }
  log(`${invoiced} invoices raised, ${collected} with payments recorded`)

  // ------------------------------------------------------------ exam+marks

  const grade10 = classes.find((c) => c.name === 'Grade 10')!
  const [exam] = await sql<{ id: string }[]>`
    insert into exam (tenant_id, session_id, class_level_id, name, status, created_by)
    values (${t}, ${session.id}, ${grade10.id}, 'Term I Examination', 'mark_entry', ${admin.id})
    returning id
  `
  for (const subjectId of subjects.slice(0, 3)) {
    await sql`
      insert into exam_subject (tenant_id, exam_id, subject_id, theory_max, practical_max, pass_marks)
      values (${t}, ${exam!.id}, ${subjectId}, 80, 20, 33)
    `
  }

  const papers = await sql<{ id: string }[]>`select id from exam_subject where exam_id = ${exam!.id}`
  const grade10Enrolments = enrolments.filter((e) =>
    grade10.sections.some((s) => s.id === e.sectionId),
  )
  for (const paper of papers) {
    for (const enrolment of grade10Enrolments) {
      await sql`
        insert into mark (tenant_id, exam_subject_id, enrolment_id, theory_marks, practical_marks,
                          status, entered_by)
        values (${t}, ${paper.id}, ${enrolment.id}, ${30 + randomInt(50)}, ${12 + randomInt(9)},
                'draft', ${admin.id})
      `
    }
  }
  log(`1 exam open for mark entry · ${papers.length} papers · ${grade10Enrolments.length} students marked`)

  // A second, already-published exam so results can be shown immediately.
  const [published] = await sql<{ id: string }[]>`
    insert into exam (tenant_id, session_id, class_level_id, name, status, created_by)
    values (${t}, ${session.id}, ${grade10.id}, 'Unit Test I', 'mark_entry', ${admin.id})
    returning id
  `
  const [unitPaper] = await sql<{ id: string }[]>`
    insert into exam_subject (tenant_id, exam_id, subject_id, theory_max, pass_marks)
    values (${t}, ${published!.id}, ${subjects[0]!}, 50, 17) returning id
  `
  for (const enrolment of grade10Enrolments) {
    await sql`
      insert into mark (tenant_id, exam_subject_id, enrolment_id, theory_marks, status, entered_by)
      values (${t}, ${unitPaper!.id}, ${enrolment.id}, ${15 + randomInt(35)}, 'published', ${admin.id})
    `
  }
  await sql`
    with totals as (
      select m.enrolment_id, sum(m.total_marks) as obtained, sum(es.total_max) as max_marks,
             bool_or(m.total_marks < es.pass_marks) as any_fail
        from mark m join exam_subject es on es.id = m.exam_subject_id
       where es.exam_id = ${published!.id} group by m.enrolment_id
    ), scored as (
      select t2.*, round((t2.obtained / nullif(t2.max_marks, 0)) * 100, 2) as percentage from totals t2
    )
    insert into exam_result (tenant_id, exam_id, enrolment_id, obtained_marks, max_marks,
                             percentage, grade, rank_in_class, outcome)
    select ${t}, ${published!.id}, s.enrolment_id, s.obtained, s.max_marks, s.percentage,
           (select gb.grade from grade_band gb join grading_scheme gs on gs.id = gb.grading_scheme_id
             where gs.tenant_id = ${t} and gs.is_default
               and s.percentage between gb.min_percent and gb.max_percent limit 1),
           rank() over (order by s.percentage desc),
           case when s.any_fail then 'fail' else 'pass' end
      from scored s
  `
  await sql`update exam set status = 'published', published_at = now(), published_by = ${admin.id} where id = ${published!.id}`
  log('1 exam published with ranked results')

  // --------------------------------------------------------------- notices

  const notices = [
    ['Annual Sports Day 2026', 'Registrations are open until 30 July through the school office. Events include athletics, football and the inter-house relay.', 'high'],
    ['Parent–Teacher Meeting', 'Saturday 9:00am to 1:00pm. Please book a slot with your class teacher.', 'normal'],
    ['Library maintenance', 'The senior library will remain closed this Saturday for stock-taking.', 'low'],
    ['Term I examination schedule', 'The detailed timetable has been shared with class teachers and is on the notice board.', 'urgent'],
  ] as const

  for (const [title, body, priority] of notices) {
    const [notice] = await sql<{ id: string }[]>`
      insert into notice (tenant_id, session_id, title, body, priority, status, created_by, published_by)
      values (${t}, ${session.id}, ${title}, ${body}, ${priority}, 'published', ${admin.id}, ${admin.id})
      returning id
    `
    await sql`
      insert into notice_audience (tenant_id, notice_id, audience_type)
      values (${t}, ${notice!.id}, 'everyone')
    `
  }
  log(`${notices.length} published notices`)

  // Holidays, so the attendance rules are demonstrable.
  for (const [offset, name] of [[5, 'Founders Day'], [12, 'Regional Holiday']] as const) {
    await sql`
      insert into holiday (tenant_id, session_id, date, name, applies_to)
      values (${t}, ${session.id}, ${new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)}, ${name}, 'all')
      on conflict do nothing
    `
  }

  console.log(`
  Demo data ready.

  Sign in as any of these — password: ${demoPassword}

    Administrator   ${adminEmail}          (existing password unchanged)
    Teacher         maya@demo.school       sees only her own classes
    Teacher         ethan@demo.school
    Accountant      accounts@demo.school   fees only, no marks or attendance

  Worth showing:
    · Attendance → pick Grade 10 A, ~3 weeks of history already marked
    · Fees → search a student, take a payment, watch the balance change
    · Exams → "Unit Test I" is published with ranks; "Term I" is open for entry
    · Sign in as the teacher to show they cannot see Fees or School setup
`)
} catch (error) {
  console.error(`\n  Seed failed: ${(error as Error).message}\n`)
  process.exitCode = 1
} finally {
  await closeDb()
}
