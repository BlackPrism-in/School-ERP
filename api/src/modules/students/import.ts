import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { badRequest } from '../../lib/errors.js'
import type { Tx } from '../../db/client.js'

/**
 * Bulk student import.
 *
 * Schools onboard from a spreadsheet, always — and their spreadsheet is never
 * clean. The design rule here is that **nothing is written until the whole
 * file is valid**: a partial import leaves an office unable to tell which of
 * 400 rows landed, and re-running it duplicates whatever did.
 *
 * So there are two calls with identical validation:
 *   dryRun: true  → report every problem, write nothing
 *   dryRun: false → write all rows in one transaction, or none
 */

const rowSchema = z.object({
  admissionNo: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  dateOfBirth: z.string().trim().optional(),
  gender: z.string().trim().optional(),
  className: z.string().trim().max(60).optional(),
  sectionName: z.string().trim().max(30).optional(),
  rollNo: z.string().trim().max(20).optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianPhone: z.string().trim().max(20).optional(),
  guardianRelation: z.string().trim().max(20).optional(),
})

type Row = z.infer<typeof rowSchema>
type Problem = { row: number; field: string; message: string }

/** Accepts the formats a school spreadsheet actually contains. */
function normaliseDate(value: string | undefined): string | null | 'invalid' {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    const iso = `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
    return Number.isNaN(Date.parse(iso)) ? 'invalid' : iso
  }
  return 'invalid'
}

function normaliseGender(value: string | undefined): string | null | 'invalid' {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (['m', 'male', 'boy'].includes(v)) return 'male'
  if (['f', 'female', 'girl'].includes(v)) return 'female'
  if (['o', 'other'].includes(v)) return 'other'
  if (['u', 'undisclosed', 'not specified', ''].includes(v)) return 'undisclosed'
  return 'invalid'
}

export async function studentImportRoutes(app: FastifyInstance) {
  app.post('/students/import', async (request) => {
    const principal = request.require('student.import')
    const body = z
      .object({
        dryRun: z.boolean().default(true),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const problems: Problem[] = []
      const parsed: (Row & { _line: number; _dob: string | null; _gender: string | null })[] = []
      const seenAdmission = new Map<string, number>()

      // ------------------------------------------------------ shape check
      body.rows.forEach((raw, index) => {
        const line = index + 2 // account for the header row in the source file
        const result = rowSchema.safeParse(raw)
        if (!result.success) {
          for (const issue of result.error.issues) {
            problems.push({ row: line, field: String(issue.path[0] ?? '?'), message: issue.message })
          }
          return
        }

        const row = result.data
        const dob = normaliseDate(row.dateOfBirth)
        if (dob === 'invalid') {
          problems.push({ row: line, field: 'dateOfBirth', message: `Cannot read “${row.dateOfBirth}” as a date.` })
        }
        const gender = normaliseGender(row.gender)
        if (gender === 'invalid') {
          problems.push({ row: line, field: 'gender', message: `Cannot read “${row.gender}” as a gender.` })
        }

        // Duplicates *within the file* are as damaging as duplicates against
        // the database, and far easier to miss.
        const previous = seenAdmission.get(row.admissionNo.toLowerCase())
        if (previous) {
          problems.push({
            row: line,
            field: 'admissionNo',
            message: `Duplicate of row ${previous} in this file.`,
          })
        } else {
          seenAdmission.set(row.admissionNo.toLowerCase(), line)
        }

        if (row.sectionName && !row.className) {
          problems.push({ row: line, field: 'className', message: 'A section needs its class.' })
        }

        parsed.push({
          ...row,
          _line: line,
          _dob: dob === 'invalid' ? null : dob,
          _gender: gender === 'invalid' ? null : gender,
        })
      })

      // ------------------------------------------- checks against the data
      const admissionNos = parsed.map((r) => r.admissionNo)
      if (admissionNos.length) {
        const existing = await tx<{ admission_no: string }[]>`
          select admission_no from student
           where admission_no in ${tx(admissionNos)} and deleted_at is null
        `
        const taken = new Set(existing.map((e) => e.admission_no))
        for (const row of parsed) {
          if (taken.has(row.admissionNo)) {
            problems.push({
              row: row._line,
              field: 'admissionNo',
              message: `${row.admissionNo} already exists in the school.`,
            })
          }
        }
      }

      const sectionCache = await resolveSections(tx, parsed)
      for (const row of parsed) {
        if (!row.className) continue
        const key = `${row.className}|${row.sectionName ?? ''}`
        if (!sectionCache.has(key)) {
          problems.push({
            row: row._line,
            field: 'className',
            message: row.sectionName
              ? `No section “${row.sectionName}” in class “${row.className}”.`
              : `No class called “${row.className}”.`,
          })
        }
      }

      const summary = {
        totalRows: body.rows.length,
        validRows: body.rows.length - new Set(problems.map((p) => p.row)).size,
        problemRows: new Set(problems.map((p) => p.row)).size,
      }

      if (problems.length) {
        return {
          dryRun: body.dryRun,
          imported: 0,
          summary,
          // Cap what we return; a 2,000-row file with a wrong header would
          // otherwise produce an unusable wall of identical errors.
          problems: problems.slice(0, 100),
          truncatedProblems: Math.max(0, problems.length - 100),
        }
      }

      if (body.dryRun) {
        return { dryRun: true, imported: 0, summary, problems: [], truncatedProblems: 0 }
      }

      // ------------------------------------------------------------ write
      const [session] = await tx<{ id: string }[]>`
        select id from academic_session where is_current limit 1
      `
      if (!session) throw badRequest('No current academic session.')

      let imported = 0
      for (const row of parsed) {
        const [student] = await tx<{ id: string }[]>`
          insert into student (tenant_id, admission_no, first_name, last_name,
                               date_of_birth, gender, admission_date)
          values (app_current_tenant(), ${row.admissionNo}, ${row.firstName},
                  ${row.lastName ?? null}, ${row._dob}, ${row._gender}, current_date)
          returning id
        `

        if (row.className) {
          const section = sectionCache.get(`${row.className}|${row.sectionName ?? ''}`)!
          await tx`
            insert into enrolment (tenant_id, student_id, session_id, branch_id,
                                   class_level_id, section_id, roll_no)
            values (app_current_tenant(), ${student!.id}, ${session.id}, ${section.branch_id},
                    ${section.class_level_id}, ${section.id}, ${row.rollNo ?? null})
          `
        }

        if (row.guardianName && row.guardianPhone) {
          const [guardian] = await tx<{ id: string }[]>`
            insert into guardian (tenant_id, first_name, phone)
            values (app_current_tenant(), ${row.guardianName}, ${row.guardianPhone})
            returning id
          `
          await tx`
            insert into student_guardian (tenant_id, student_id, guardian_id, relation,
                                          is_primary_contact, is_consent_giver)
            values (app_current_tenant(), ${student!.id}, ${guardian!.id},
                    ${(row.guardianRelation ?? 'guardian').toLowerCase()}, true, true)
          `
        }
        imported += 1
      }

      request.log.info({ imported, by: principal.user.userId }, 'student import committed')
      return { dryRun: false, imported, summary, problems: [], truncatedProblems: 0 }
    })
  })
}

async function resolveSections(tx: Tx, rows: { className?: string; sectionName?: string }[]) {
  const cache = new Map<string, { id: string; class_level_id: string; branch_id: string }>()
  const wanted = rows.filter((r) => r.className)
  if (!wanted.length) return cache

  const sections = await tx<
    { id: string; class_level_id: string; branch_id: string; class_name: string; section_name: string }[]
  >`
    select sec.id, sec.class_level_id, sec.branch_id,
           cl.name as class_name, sec.name as section_name
      from section sec
      join class_level cl on cl.id = sec.class_level_id
      join academic_session s on s.id = sec.session_id and s.is_current
     where sec.deleted_at is null
  `

  for (const row of wanted) {
    const match = sections.find(
      (s) =>
        s.class_name.toLowerCase() === row.className!.toLowerCase() &&
        (row.sectionName
          ? s.section_name.toLowerCase() === row.sectionName.toLowerCase()
          : true),
    )
    if (match) {
      cache.set(`${row.className}|${row.sectionName ?? ''}`, match)
    }
  }
  return cache
}
