import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { assertStudentInScope } from '../../rbac/scope.js'
import type { Tx } from '../../db/client.js'

/**
 * Fees. The module where a bug costs a school real money and real trust.
 *
 * Everything monetary is `numeric(12,2)` end to end and handled as a **string**
 * in JavaScript — never parsed to a float. `0.1 + 0.2` is not `0.3`, and a
 * rounding error spread across 1,200 termly invoices is a reconciliation
 * nightmare nobody can unpick afterwards. Arithmetic happens in Postgres.
 *
 * The database already guarantees the hard parts (migration 0006): receipts
 * are gapless, payments are immutable, and the outstanding balance is a view
 * derived from allocations rather than a stored number that can drift.
 */

const money = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Must be an amount with at most two decimal places')

export async function feeRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ fee heads

  app.get('/fees/heads', async (request) => {
    request.require('fee.read')
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select id, name, code, is_recurring as "isRecurring", sort_order as "sortOrder"
          from fee_head where deleted_at is null order by sort_order, name
      `
      return { data: rows }
    })
  })

  app.post('/fees/heads', async (request, reply) => {
    request.require('fee.configure')
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        code: z.string().trim().max(20).optional(),
        isRecurring: z.boolean().default(true),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const existing = await tx`select 1 from fee_head where name = ${body.name} and deleted_at is null`
      if (existing.length) throw conflict(`A fee head called “${body.name}” already exists.`)

      const rows = await tx<{ id: string }[]>`
        insert into fee_head (tenant_id, name, code, is_recurring)
        values (app_current_tenant(), ${body.name}, ${body.code ?? null}, ${body.isRecurring})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  // ------------------------------------------------------- fee structures

  app.get('/fees/structures', async (request) => {
    request.require('fee.read')
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select fs.id, fs.name, fs.status, fs.class_level_id as "classLevelId",
               cl.name as "className",
               coalesce(sum(fsi.amount), 0)::text as "totalAmount",
               count(distinct fa.id) as "assignedCount"
          from fee_structure fs
          left join class_level cl on cl.id = fs.class_level_id
          left join fee_structure_item fsi on fsi.fee_structure_id = fs.id
          left join fee_assignment fa on fa.fee_structure_id = fs.id
          join academic_session s on s.id = fs.session_id and s.is_current
         group by fs.id, cl.name
         order by cl.sort_order nulls first, fs.name
      `
      return { data: rows.map((r) => ({ ...r, assignedCount: Number(r.assignedCount) })) }
    })
  })

  app.post('/fees/structures', async (request, reply) => {
    request.require('fee.configure')
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        classLevelId: z.string().uuid().optional(),
        items: z
          .array(z.object({ feeHeadId: z.string().uuid(), amount: money }))
          .min(1)
          .max(50),
        dueDate: z.string().date(),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`
        select id from academic_session where is_current limit 1
      `
      if (!session) throw badRequest('No current academic session.')

      const [structure] = await tx<{ id: string }[]>`
        insert into fee_structure (tenant_id, session_id, class_level_id, name, status)
        values (app_current_tenant(), ${session.id}, ${body.classLevelId ?? null}, ${body.name}, 'published')
        returning id
      `

      const [instalment] = await tx<{ id: string }[]>`
        insert into fee_instalment (tenant_id, fee_structure_id, name, due_date, sequence)
        values (app_current_tenant(), ${structure!.id}, 'Full payment', ${body.dueDate}, 1)
        returning id
      `

      for (const item of body.items) {
        await tx`
          insert into fee_structure_item (tenant_id, fee_structure_id, fee_instalment_id,
                                          fee_head_id, amount)
          values (app_current_tenant(), ${structure!.id}, ${instalment!.id},
                  ${item.feeHeadId}, ${item.amount}::numeric)
        `
      }

      reply.code(201)
      return { id: structure!.id }
    })
  })

  /**
   * Assigning a structure generates the invoice. Concessions are applied at
   * this point and recorded per line, so a parent's bill shows what was
   * discounted rather than just a smaller number.
   */
  app.post('/fees/assign', async (request, reply) => {
    const principal = request.require('fee.configure')
    const body = z
      .object({ sectionId: z.string().uuid(), feeStructureId: z.string().uuid() })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [structure] = await tx<{ id: string; session_id: string }[]>`
        select id, session_id from fee_structure where id = ${body.feeStructureId}
      `
      if (!structure) throw notFound('No such fee structure.')

      const enrolments = await tx<{ id: string }[]>`
        select id from enrolment where section_id = ${body.sectionId} and status = 'enrolled'
      `
      if (!enrolments.length) throw badRequest('That section has no enrolled students.')

      const [instalment] = await tx<{ id: string; due_date: Date }[]>`
        select id, due_date from fee_instalment
         where fee_structure_id = ${structure.id} order by sequence limit 1
      `

      let created = 0
      let skipped = 0

      for (const enrolment of enrolments) {
        const [already] = await tx<{ id: string }[]>`
          select id from fee_assignment
           where enrolment_id = ${enrolment.id} and fee_structure_id = ${structure.id}
        `
        if (already) {
          skipped += 1
          continue
        }

        await tx`
          insert into fee_assignment (tenant_id, enrolment_id, fee_structure_id, assigned_by)
          values (app_current_tenant(), ${enrolment.id}, ${structure.id}, ${principal.user.userId})
        `

        const invoiceNo = await nextNumber(tx, 'invoice', structure.session_id, 'INV/')

        const [invoice] = await tx<{ id: string }[]>`
          insert into invoice (tenant_id, session_id, enrolment_id, fee_instalment_id,
                               invoice_no, due_date, gross_amount, concession_amount,
                               fine_amount, status, created_by)
          values (app_current_tenant(), ${structure.session_id}, ${enrolment.id},
                  ${instalment?.id ?? null}, ${invoiceNo},
                  ${instalment?.due_date ?? new Date().toISOString().slice(0, 10)},
                  0, 0, 0, 'issued', ${principal.user.userId})
          returning id
        `

        // Lines are inserted first, then the header totals are summed from
        // them — so a header can never disagree with its own lines.
        await tx`
          insert into invoice_line (tenant_id, invoice_id, fee_head_id, description,
                                    gross_amount, concession_amount, fine_amount)
          select app_current_tenant(), ${invoice!.id}, fsi.fee_head_id, fh.name,
                 fsi.amount,
                 coalesce((
                   select case when c.discount_type = 'percent'
                               then round(fsi.amount * c.value / 100, 2)
                               else least(c.value, fsi.amount) end
                     from student_concession sc
                     join concession c on c.id = sc.concession_id
                    where sc.enrolment_id = ${enrolment.id}
                      and (sc.fee_head_id is null or sc.fee_head_id = fsi.fee_head_id)
                      and c.is_active
                    order by sc.fee_head_id nulls last
                    limit 1
                 ), 0),
                 0
            from fee_structure_item fsi
            join fee_head fh on fh.id = fsi.fee_head_id
           where fsi.fee_structure_id = ${structure.id}
        `

        await tx`
          update invoice i
             set gross_amount = t.gross, concession_amount = t.concession
            from (
              select coalesce(sum(gross_amount), 0) as gross,
                     coalesce(sum(concession_amount), 0) as concession
                from invoice_line where invoice_id = ${invoice!.id}
            ) t
           where i.id = ${invoice!.id}
        `
        created += 1
      }

      reply.code(201)
      return { created, skipped }
    })
  })

  // --------------------------------------------------------- student view

  app.get('/fees/student/:studentId', async (request) => {
    const principal = request.require('fee.read')
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, studentId)

      const invoices = await tx<Record<string, unknown>[]>`
        select i.id, i.invoice_no as "invoiceNo", i.issue_date as "issueDate",
               i.due_date as "dueDate", i.status,
               i.gross_amount::text as "grossAmount",
               i.concession_amount::text as "concessionAmount",
               i.fine_amount::text as "fineAmount",
               i.net_amount::text as "netAmount",
               b.paid_amount::text as "paidAmount",
               b.balance_amount::text as "balanceAmount"
          from invoice i
          join invoice_balance b on b.invoice_id = i.id
          join enrolment e on e.id = i.enrolment_id
         where e.student_id = ${studentId}
         order by i.issue_date desc
      `

      const payments = await tx<Record<string, unknown>[]>`
        select p.id, p.receipt_no as "receiptNo", p.paid_on as "paidOn",
               p.amount::text as amount, p.method, p.reference_no as "referenceNo",
               p.status, u.display_name as "collectedBy",
               pr.reason as "reversalReason"
          from payment p
          join enrolment e on e.id = p.enrolment_id
          left join app_user u on u.id = p.collected_by
          left join payment_reversal pr on pr.payment_id = p.id
         where e.student_id = ${studentId}
         order by p.paid_on desc, p.created_at desc
      `

      const [totals] = await tx<{ billed: string; paid: string; outstanding: string }[]>`
        select coalesce(sum(b.net_amount), 0)::text as billed,
               coalesce(sum(b.paid_amount), 0)::text as paid,
               coalesce(sum(b.balance_amount), 0)::text as outstanding
          from invoice_balance b
          join enrolment e on e.id = b.enrolment_id
         where e.student_id = ${studentId}
      `

      return { invoices, payments, totals }
    })
  })

  /**
   * POST /fees/collect — take a payment.
   *
   * Allocation is oldest-invoice-first, which is what a school office does by
   * hand and what a parent expects. Overpayment is refused rather than
   * silently held as a credit: an unexplained credit balance is how fee
   * reconciliation goes wrong.
   */
  app.post('/fees/collect', async (request, reply) => {
    const principal = request.require('fee.collect')
    const body = z
      .object({
        studentId: z.string().uuid(),
        amount: money,
        method: z.enum(['cash', 'upi', 'card', 'cheque', 'bank_transfer', 'online']),
        referenceNo: z.string().trim().max(80).optional(),
        paidOn: z.string().date().optional(),
        notes: z.string().trim().max(300).optional(),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, body.studentId)

      const [enrolment] = await tx<{ id: string; session_id: string }[]>`
        select e.id, e.session_id from enrolment e
          join academic_session s on s.id = e.session_id and s.is_current
         where e.student_id = ${body.studentId} and e.status = 'enrolled'
      `
      if (!enrolment) throw badRequest('That student is not enrolled in the current session.')

      const outstanding = await tx<{ invoice_id: string; balance_amount: string }[]>`
        select b.invoice_id, b.balance_amount::text
          from invoice_balance b
         where b.enrolment_id = ${enrolment.id} and b.balance_amount > 0
         order by (select due_date from invoice where id = b.invoice_id)
      `
      if (!outstanding.length) throw badRequest('That student has nothing outstanding.', 'nothing_due')

      // Comparison in SQL, not JavaScript — floats must never touch money.
      const [check] = await tx<{ total: string; over: boolean }[]>`
        select coalesce(sum(balance_amount), 0)::text as total,
               ${body.amount}::numeric > coalesce(sum(balance_amount), 0) as over
          from invoice_balance where enrolment_id = ${enrolment.id}
      `
      if (check!.over) {
        throw badRequest(
          `That is more than the ₹${check!.total} outstanding. Collect the exact amount or less.`,
          'overpayment',
        )
      }

      const receiptNo = await nextNumber(tx, 'receipt', enrolment.session_id, 'RCT/')

      const [payment] = await tx<{ id: string }[]>`
        insert into payment (tenant_id, session_id, enrolment_id, receipt_no, paid_on,
                             amount, method, reference_no, notes, collected_by)
        values (app_current_tenant(), ${enrolment.session_id}, ${enrolment.id}, ${receiptNo},
                ${body.paidOn ?? new Date().toISOString().slice(0, 10)}, ${body.amount}::numeric,
                ${body.method}, ${body.referenceNo ?? null}, ${body.notes ?? null},
                ${principal.user.userId})
        returning id
      `

      let remaining = body.amount
      const allocations: { invoiceId: string; amount: string }[] = []

      for (const invoice of outstanding) {
        const [step] = await tx<{ apply: string; left: string }[]>`
          select least(${remaining}::numeric, ${invoice.balance_amount}::numeric)::text as apply,
                 greatest(${remaining}::numeric - ${invoice.balance_amount}::numeric, 0)::text as left
        `
        if (Number(step!.apply) <= 0) break

        await tx`
          insert into payment_allocation (tenant_id, payment_id, invoice_id, amount)
          values (app_current_tenant(), ${payment!.id}, ${invoice.invoice_id}, ${step!.apply}::numeric)
        `
        allocations.push({ invoiceId: invoice.invoice_id, amount: step!.apply })
        remaining = step!.left
      }

      await refreshInvoiceStatuses(tx, enrolment.id)

      reply.code(201)
      return { paymentId: payment!.id, receiptNo, allocations }
    })
  })

  /**
   * Reversal, never deletion. The original receipt stays exactly as issued —
   * a parent may be holding a printout of it, and the database blocks any
   * other change anyway.
   */
  app.post('/fees/payments/:id/reverse', async (request) => {
    const principal = request.require('fee.reverse')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ reason: z.string().trim().min(3).max(300) }).parse(request.body)

    return request.tx(async (tx) => {
      const [payment] = await tx<{ id: string; status: string; session_id: string; enrolment_id: string }[]>`
        select id, status, session_id, enrolment_id from payment where id = ${id}
      `
      if (!payment) throw notFound('No such payment.')
      if (payment.status === 'reversed') throw conflict('That payment is already reversed.', 'already_reversed')

      // Its own series, not the receipt series. Sharing the 'receipt' scope
      // would hand the reversal an RCT/ number — indistinguishable from a
      // collection in the ledger, and it would consume numbers from the
      // receipt run so an auditor sees unexplained gaps.
      const reversalNo = await nextNumber(tx, 'reversal', payment.session_id, 'REV/')

      await tx`update payment set status = 'reversed' where id = ${id}`
      await tx`
        insert into payment_reversal (tenant_id, payment_id, reversal_receipt_no, reason, reversed_by)
        values (app_current_tenant(), ${id}, ${reversalNo}, ${body.reason}, ${principal.user.userId})
      `

      await refreshInvoiceStatuses(tx, payment.enrolment_id)

      return { id, reversalReceiptNo: reversalNo }
    })
  })

  /** The office's end-of-day cash-up. */
  app.get('/fees/daybook', async (request) => {
    request.require('fee.read')
    const query = z
      .object({ date: z.string().date().optional() })
      .parse(request.query)
    const date = query.date ?? new Date().toISOString().slice(0, 10)

    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select p.receipt_no as "receiptNo", p.amount::text as amount, p.method, p.status,
               trim(st.first_name || ' ' || coalesce(st.last_name, '')) as "studentName",
               st.admission_no as "admissionNo", u.display_name as "collectedBy"
          from payment p
          join enrolment e on e.id = p.enrolment_id
          join student st on st.id = e.student_id
          left join app_user u on u.id = p.collected_by
         where p.paid_on = ${date}
         order by p.created_at
      `

      const byMethod = await tx<{ method: string; total: string; count: string }[]>`
        select method, sum(amount)::text as total, count(*) as count
          from payment
         where paid_on = ${date} and status = 'completed'
         group by method order by method
      `

      const [total] = await tx<{ collected: string; reversed: string }[]>`
        select coalesce(sum(amount) filter (where status = 'completed'), 0)::text as collected,
               coalesce(sum(amount) filter (where status = 'reversed'), 0)::text as reversed
          from payment where paid_on = ${date}
      `

      return {
        date,
        payments: rows,
        byMethod: byMethod.map((m) => ({ ...m, count: Number(m.count) })),
        totals: total,
      }
    })
  })

  app.get('/fees/outstanding', async (request) => {
    request.require('fee.read')
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select st.id as "studentId",
               trim(st.first_name || ' ' || coalesce(st.last_name, '')) as name,
               st.admission_no as "admissionNo",
               cl.name as "className", sec.name as "sectionName",
               sum(b.balance_amount)::text as outstanding,
               min(i.due_date) as "earliestDue",
               min(i.due_date) < current_date as overdue
          from invoice_balance b
          join invoice i on i.id = b.invoice_id
          join enrolment e on e.id = b.enrolment_id
          join student st on st.id = e.student_id and st.deleted_at is null
          join class_level cl on cl.id = e.class_level_id
          join section sec on sec.id = e.section_id
         where b.balance_amount > 0
         group by st.id, cl.name, sec.name
         order by overdue desc, min(i.due_date)
      `
      return { data: rows }
    })
  })
}

/** Gapless numbering, per migration 0001. Creates the counter on first use. */
async function nextNumber(tx: Tx, scope: string, scopeKey: string, prefix: string): Promise<string> {
  await tx`
    insert into document_sequence (tenant_id, scope, scope_key, prefix, padding)
    values (app_current_tenant(), ${scope}, ${scopeKey}, ${prefix}, 5)
    on conflict (tenant_id, scope, scope_key) do nothing
  `
  const [row] = await tx<{ n: string }[]>`
    select next_document_number(app_current_tenant(), ${scope}, ${scopeKey}) as n
  `
  return row!.n
}

/**
 * Invoice status is derived from the balance view, so it can never disagree
 * with the payments actually recorded against it.
 */
async function refreshInvoiceStatuses(tx: Tx, enrolmentId: string) {
  await tx`
    update invoice i
       set status = case
             when b.balance_amount <= 0 then 'paid'
             when b.paid_amount > 0 then 'partly_paid'
             else 'issued'
           end
      from invoice_balance b
     where b.invoice_id = i.id
       and i.enrolment_id = ${enrolmentId}
       and i.status <> 'cancelled'
  `
}
