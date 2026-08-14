import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertStudentInScope } from '../../rbac/scope.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'

/**
 * Guardians and DPDP consent.
 *
 * Guardian records exist now even though the parent portal is a later phase:
 * a student record is incomplete without an emergency contact, and the Act
 * requires a recorded, per-purpose consent from a parent before a child's data
 * is processed. Consent that was never captured cannot be captured
 * retroactively with any honesty.
 */
export async function guardianRoutes(app: FastifyInstance) {
  app.get('/students/:id/guardians', async (request) => {
    const principal = request.require('student.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)
      const rows = await tx<Record<string, unknown>[]>`
        select g.id, g.first_name as "firstName", g.last_name as "lastName",
               g.phone, g.alt_phone as "altPhone", g.email, g.occupation,
               sg.relation, sg.is_primary_contact as "isPrimaryContact",
               sg.is_emergency_contact as "isEmergencyContact",
               sg.is_consent_giver as "isConsentGiver"
          from student_guardian sg
          join guardian g on g.id = sg.guardian_id
         where sg.student_id = ${id} and g.deleted_at is null
         order by sg.is_primary_contact desc, g.first_name
      `
      return { data: rows }
    })
  })

  app.post('/students/:id/guardians', async (request, reply) => {
    const principal = request.require('student.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().max(80).optional(),
        phone: z.string().trim().min(6).max(20),
        altPhone: z.string().trim().max(20).optional(),
        email: z.string().email().max(254).optional(),
        occupation: z.string().trim().max(80).optional(),
        relation: z.enum(['father', 'mother', 'guardian', 'other']),
        isPrimaryContact: z.boolean().default(false),
        isEmergencyContact: z.boolean().default(true),
        isConsentGiver: z.boolean().default(false),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)

      // Only one primary contact per student — the partial unique index in
      // migration 0004 enforces it, so clear the old one first rather than
      // handing the user a constraint error.
      if (body.isPrimaryContact) {
        await tx`
          update student_guardian set is_primary_contact = false
           where student_id = ${id} and is_primary_contact
        `
      }

      // Siblings share a parent: reuse an existing guardian on a phone match
      // rather than creating a second record of the same person.
      const [existing] = await tx<{ id: string }[]>`
        select id from guardian where phone = ${body.phone} and deleted_at is null limit 1
      `

      const guardianId =
        existing?.id ??
        (
          await tx<{ id: string }[]>`
            insert into guardian (tenant_id, first_name, last_name, phone, alt_phone,
                                  email, occupation)
            values (app_current_tenant(), ${body.firstName}, ${body.lastName ?? null},
                    ${body.phone}, ${body.altPhone ?? null}, ${body.email ?? null},
                    ${body.occupation ?? null})
            returning id
          `
        )[0]!.id

      const linked = await tx<{ student_id: string }[]>`
        insert into student_guardian (tenant_id, student_id, guardian_id, relation,
                                      is_primary_contact, is_emergency_contact, is_consent_giver)
        values (app_current_tenant(), ${id}, ${guardianId}, ${body.relation},
                ${body.isPrimaryContact}, ${body.isEmergencyContact}, ${body.isConsentGiver})
        on conflict (student_id, guardian_id) do update
           set relation = excluded.relation,
               is_primary_contact = excluded.is_primary_contact,
               is_emergency_contact = excluded.is_emergency_contact,
               is_consent_giver = excluded.is_consent_giver
        returning student_id
      `
      if (!linked.length) throw conflict('Could not link that guardian.')

      reply.code(201)
      return { guardianId, reusedExisting: Boolean(existing) }
    })
  })

  app.delete('/students/:id/guardians/:guardianId', async (request) => {
    const principal = request.require('student.write')
    const { id, guardianId } = z
      .object({ id: z.string().uuid(), guardianId: z.string().uuid() })
      .parse(request.params)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)
      const rows = await tx<{ student_id: string }[]>`
        delete from student_guardian
         where student_id = ${id} and guardian_id = ${guardianId}
        returning student_id
      `
      if (!rows.length) throw notFound('That guardian is not linked to this student.')
      return { removed: true }
    })
  })

  // ---------------------------------------------------------- DPDP consent

  app.get('/students/:id/consent', async (request) => {
    const principal = request.require('student.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)
      const rows = await tx<Record<string, unknown>[]>`
        select cr.id, cr.purpose, cr.is_granted as "isGranted",
               cr.notice_version as "noticeVersion",
               cr.granted_at as "grantedAt", cr.withdrawn_at as "withdrawnAt",
               g.first_name as "guardianName"
          from consent_record cr
          left join guardian g on g.id = cr.guardian_id
         where cr.student_id = ${id}
         order by cr.purpose, cr.created_at desc
      `
      return { data: rows }
    })
  })

  app.post('/students/:id/consent', async (request, reply) => {
    const principal = request.require('student.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        purpose: z.enum([
          'core_academic_records',
          'photography',
          'sms_updates',
          'medical_treatment',
          'transport',
          'third_party_sharing',
        ]),
        isGranted: z.boolean(),
        guardianId: z.string().uuid().optional(),
        noticeVersion: z.string().trim().min(1).max(20).default('v1'),
        evidence: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)

      // Consent for a child must come from a guardian on record. Consent with
      // no identified giver is not verifiable, which is the whole requirement.
      if (body.isGranted && !body.guardianId) {
        const [primary] = await tx<{ guardian_id: string }[]>`
          select guardian_id from student_guardian
           where student_id = ${id} and (is_consent_giver or is_primary_contact)
           order by is_consent_giver desc limit 1
        `
        if (!primary) {
          throw badRequest(
            'Add a guardian for this student before recording consent — it has to be attributable to someone.',
            'no_consent_giver',
          )
        }
        body.guardianId = primary.guardian_id
      }

      const rows = await tx<{ id: string }[]>`
        insert into consent_record (tenant_id, student_id, guardian_id, purpose, is_granted,
                                    notice_version, granted_at, withdrawn_at, evidence, recorded_by)
        values (app_current_tenant(), ${id}, ${body.guardianId ?? null}, ${body.purpose},
                ${body.isGranted}, ${body.noticeVersion},
                ${body.isGranted ? new Date().toISOString() : null},
                ${body.isGranted ? null : new Date().toISOString()},
                ${body.evidence ? JSON.stringify(body.evidence) : null}::jsonb,
                ${principal.user.userId})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })
}
