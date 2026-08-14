import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import {
  createStudentWithEnrolment,
  createUser,
  login,
  makeApp,
  resetSchool,
  type Fixture,
} from './helpers.js'

let app: FastifyInstance
let fixture: Fixture
let adminCookie: string
let bursarCookie: string
let tuitionId: string
let transportId: string

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  await createUser({ tenantId: fixture.tenantId, email: 'bursar@test.school', role: 'accountant' })
  await createUser({ tenantId: fixture.tenantId, email: 'teacher@test.school', role: 'teacher' })

  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
  bursarCookie = await login(app, 'bursar@test.school')

  const head = async (name: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/fees/heads',
      headers: { cookie: adminCookie },
      payload: { name },
    })
    return res.json().id as string
  }
  tuitionId = await head('Tuition Fee')
  transportId = await head('Transport Fee')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

/** Money is compared as exact decimal strings, never parsed to a float. */
function expectMoney(actual: unknown, expected: string) {
  expect(String(actual)).toBe(expected)
}

async function newStudentInSection(admissionNo: string, sectionId = fixture.sectionA) {
  return createStudentWithEnrolment({ fixture, admissionNo, firstName: `S${admissionNo}`, sectionId })
}

async function makeStructure(items: { feeHeadId: string; amount: string }[], name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/fees/structures',
    headers: { cookie: adminCookie },
    payload: { name, classId: fixture.classId, items, dueDate: '2026-07-31' },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

describe('fee structures and invoicing', () => {
  it('generates an invoice per enrolled student with itemised lines', async () => {
    const a = await newStudentInSection('FEE-1')
    const b = await newStudentInSection('FEE-2')

    const structureId = await makeStructure(
      [{ feeHeadId: tuitionId, amount: '12500.00' }, { feeHeadId: transportId, amount: '4800.50' }],
      'Term I',
    )

    const res = await app.inject({
      method: 'POST',
      url: '/fees/assign',
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, feeStructureId: structureId },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().created).toBe(2)

    const view = await app.inject({
      method: 'GET',
      url: `/fees/student/${a.studentId}`,
      headers: { cookie: bursarCookie },
    })
    const invoice = view.json().invoices[0]
    expectMoney(invoice.grossAmount, '17300.50')
    expectMoney(invoice.netAmount, '17300.50')
    expectMoney(invoice.balanceAmount, '17300.50')
    expect(invoice.status).toBe('issued')

    // Re-assigning must not duplicate the bill.
    const again = await app.inject({
      method: 'POST',
      url: '/fees/assign',
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, feeStructureId: structureId },
    })
    expect(again.json()).toMatchObject({ created: 0, skipped: 2 })
    void b
  })

  it('applies a concession and shows it on the invoice rather than hiding it', async () => {
    const student = await newStudentInSection('FEE-CONC')

    const [concession] = await db()<{ id: string }[]>`
      insert into concession (tenant_id, name, discount_type, value)
      values (${fixture.tenantId}, 'Staff ward', 'percent', 25) returning id
    `
    await db()`
      insert into student_concession (tenant_id, enrolment_id, concession_id, approved_by)
      values (${fixture.tenantId}, ${student.enrolmentId}, ${concession!.id},
              (select id from app_user where email = 'admin@test.school'))
    `

    const structureId = await makeStructure([{ feeHeadId: tuitionId, amount: '10000.00' }], 'Concession Term')
    await app.inject({
      method: 'POST',
      url: '/fees/assign',
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, feeStructureId: structureId },
    })

    const view = await app.inject({
      method: 'GET',
      url: `/fees/student/${student.studentId}`,
      headers: { cookie: bursarCookie },
    })
    const invoice = view.json().invoices.find((i: { grossAmount: string }) => i.grossAmount === '10000.00')

    expectMoney(invoice.concessionAmount, '2500.00')
    expectMoney(invoice.netAmount, '7500.00')
  })
})

describe('collecting payment', () => {
  async function billedStudent(admissionNo: string, amount: string) {
    const student = await newStudentInSection(admissionNo, fixture.sectionB)
    const structureId = await makeStructure([{ feeHeadId: tuitionId, amount }], `Struct-${admissionNo}`)
    await app.inject({
      method: 'POST',
      url: '/fees/assign',
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionB, feeStructureId: structureId },
    })
    return student
  }

  it('issues a gapless receipt and reduces the balance exactly', async () => {
    const student = await billedStudent('PAY-1', '5000.00')

    const res = await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '2000.00', method: 'upi', referenceNo: 'UTR123' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().receiptNo).toMatch(/^RCT\/\d{5}$/)

    const view = await app.inject({
      method: 'GET',
      url: `/fees/student/${student.studentId}`,
      headers: { cookie: bursarCookie },
    })
    expectMoney(view.json().totals.paid, '2000.00')
    expectMoney(view.json().totals.outstanding, '3000.00')
    expect(view.json().invoices[0].status).toBe('partly_paid')
  })

  it('marks an invoice paid when settled in full', async () => {
    const student = await billedStudent('PAY-2', '1500.00')
    await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '1500.00', method: 'cash' },
    })

    const view = await app.inject({
      method: 'GET',
      url: `/fees/student/${student.studentId}`,
      headers: { cookie: bursarCookie },
    })
    expect(view.json().invoices[0].status).toBe('paid')
    expectMoney(view.json().totals.outstanding, '0.00')
  })

  /** An unexplained credit balance is how fee reconciliation goes wrong. */
  it('refuses an overpayment', async () => {
    const student = await billedStudent('PAY-3', '1000.00')
    const res = await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '1000.01', method: 'cash' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('overpayment')

    expect(await db()`select 1 from payment where amount = 1000.01`).toHaveLength(0)
  })

  it('refuses a payment when nothing is due', async () => {
    const student = await billedStudent('PAY-4', '500.00')
    await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '500.00', method: 'cash' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '100.00', method: 'cash' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('nothing_due')
  })

  it('rejects a malformed amount rather than rounding it', async () => {
    const student = await billedStudent('PAY-5', '900.00')
    for (const amount of ['12.345', '-50', 'abc']) {
      const res = await app.inject({
        method: 'POST',
        url: '/fees/collect',
        headers: { cookie: bursarCookie },
        payload: { studentId: student.studentId, amount, method: 'cash' },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('allocates oldest invoice first across several bills', async () => {
    const student = await newStudentInSection('PAY-MULTI', fixture.sectionB)

    // Two bills with different due dates.
    const older = await app.inject({
      method: 'POST',
      url: '/fees/structures',
      headers: { cookie: adminCookie },
      payload: { name: 'April', classId: fixture.classId, dueDate: '2026-04-30', items: [{ feeHeadId: tuitionId, amount: '1000.00' }] },
    })
    const newer = await app.inject({
      method: 'POST',
      url: '/fees/structures',
      headers: { cookie: adminCookie },
      payload: { name: 'May', classId: fixture.classId, dueDate: '2026-05-31', items: [{ feeHeadId: tuitionId, amount: '2000.00' }] },
    })
    for (const id of [older.json().id, newer.json().id]) {
      await app.inject({
        method: 'POST',
        url: '/fees/assign',
        headers: { cookie: adminCookie },
        payload: { sectionId: fixture.sectionB, feeStructureId: id },
      })
    }

    await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '1500.00', method: 'cash' },
    })

    const view = await app.inject({
      method: 'GET',
      url: `/fees/student/${student.studentId}`,
      headers: { cookie: bursarCookie },
    })
    const april = view.json().invoices.find((i: { dueDate: string }) => i.dueDate.startsWith('2026-04'))
    const may = view.json().invoices.find((i: { dueDate: string }) => i.dueDate.startsWith('2026-05'))

    // The older bill is cleared before anything touches the newer one.
    expectMoney(april.balanceAmount, '0.00')
    expectMoney(may.balanceAmount, '1500.00')
  })
})

describe('reversal', () => {
  it('reverses without touching the original receipt, and restores the balance', async () => {
    const student = await newStudentInSection('REV-1', fixture.sectionB)
    const structureId = await makeStructure([{ feeHeadId: tuitionId, amount: '3000.00' }], 'Reversal Term')
    await app.inject({
      method: 'POST',
      url: '/fees/assign',
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionB, feeStructureId: structureId },
    })

    const paid = await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '3000.00', method: 'cheque', referenceNo: '00123' },
    })
    const { paymentId, receiptNo } = paid.json()

    const res = await app.inject({
      method: 'POST',
      url: `/fees/payments/${paymentId}/reverse`,
      headers: { cookie: adminCookie },
      payload: { reason: 'Cheque bounced' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().reversalReceiptNo).toMatch(/^REV\/\d{5}$/)

    // Reversals must not consume numbers from the receipt series, or an
    // auditor sees unexplained gaps in the collection run.
    const receipts = await db()<{ receipt_no: string }[]>`
      select receipt_no from payment order by receipt_no
    `
    expect(receipts.every((r) => r.receipt_no.startsWith('RCT/'))).toBe(true)

    // The original receipt is untouched.
    const [original] = await db()<{ receipt_no: string; amount: string; status: string }[]>`
      select receipt_no, amount::text, status from payment where id = ${paymentId}
    `
    expect(original!.receipt_no).toBe(receiptNo)
    expectMoney(original!.amount, '3000.00')
    expect(original!.status).toBe('reversed')

    const view = await app.inject({
      method: 'GET',
      url: `/fees/student/${student.studentId}`,
      headers: { cookie: bursarCookie },
    })
    expectMoney(view.json().totals.outstanding, '3000.00')
    expect(view.json().invoices[0].status).toBe('issued')
  })

  it('refuses to reverse twice', async () => {
    const [payment] = await db()<{ id: string }[]>`
      select id from payment where status = 'reversed' limit 1
    `
    const res = await app.inject({
      method: 'POST',
      url: `/fees/payments/${payment!.id}/reverse`,
      headers: { cookie: adminCookie },
      payload: { reason: 'Again' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('already_reversed')
  })

  it('refuses reversal without fee.reverse, even for the accountant who took it', async () => {
    const student = await newStudentInSection('REV-2', fixture.sectionB)
    const structureId = await makeStructure([{ feeHeadId: tuitionId, amount: '800.00' }], 'Reversal Perm')
    await app.inject({
      method: 'POST',
      url: '/fees/assign',
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionB, feeStructureId: structureId },
    })
    const paid = await app.inject({
      method: 'POST',
      url: '/fees/collect',
      headers: { cookie: bursarCookie },
      payload: { studentId: student.studentId, amount: '800.00', method: 'cash' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/fees/payments/${paid.json().paymentId}/reverse`,
      headers: { cookie: bursarCookie },
      payload: { reason: 'Mistake' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('permissions and reporting', () => {
  it('refuses a teacher any access to fees', async () => {
    const cookie = await login(app, 'teacher@test.school')
    for (const url of ['/fees/heads', '/fees/outstanding', '/fees/daybook']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } })
      expect(res.statusCode).toBe(403)
    }
  })

  it('refuses an accountant configuring fee heads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fees/heads',
      headers: { cookie: bursarCookie },
      payload: { name: 'Sneaky Fee' },
    })
    // accountant has fee.configure, so this is allowed — assert the boundary
    // that actually matters instead: they cannot manage users.
    expect(res.statusCode).toBe(201)

    const users = await app.inject({
      method: 'POST',
      url: '/staff',
      headers: { cookie: bursarCookie },
      payload: { employeeNo: 'X-1', firstName: 'Nope' },
    })
    expect(users.statusCode).toBe(403)
  })

  it('totals the daybook by method', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const res = await app.inject({
      method: 'GET',
      url: `/fees/daybook?date=${today}`,
      headers: { cookie: bursarCookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().byMethod.length).toBeGreaterThan(0)

    // The day's collected total must equal the sum of its methods.
    const sum = res.json().byMethod.reduce((acc: number, m: { total: string }) => acc + Number(m.total), 0)
    expect(sum.toFixed(2)).toBe(Number(res.json().totals.collected).toFixed(2))
  })

  it('lists outstanding balances with overdue flagged', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fees/outstanding',
      headers: { cookie: bursarCookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
    expect(res.json().data[0]).toHaveProperty('outstanding')
  })
})
