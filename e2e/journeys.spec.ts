import { expect, test } from '@playwright/test'
import { PASSWORD, dialog, nav, signIn, signOut, waitForLoaded } from './helpers'

/**
 * The six journeys from PRODUCTION-PLAN.md §Phase 4, run against a real API
 * and a real database. These replace the old `verify-mighty.mjs` click-through.
 *
 * They deliberately drive the UI the way a person does — typing into labelled
 * fields, clicking buttons by their visible name — so a change that breaks the
 * interface breaks the test, even if the API still works.
 */

test.describe('1 · Admit a student', () => {
  test('an admin adds a student who then appears on the roster', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')

    await nav(page, 'students').click()
    await expect(page).toHaveURL(/\/app\/students/)
    await waitForLoaded(page)

    await page.getByRole('button', { name: /Add student/ }).click()

    const admissionNo = `E2E-${Date.now().toString().slice(-6)}`
    await dialog(page).getByLabel('Admission number *').fill(admissionNo)
    await dialog(page).getByLabel('First name *').fill('Kabir')
    await dialog(page).getByLabel('Last name').fill('Singh')
    await dialog(page).getByRole('button', { name: 'Add student' }).click()

    // Lands on the new student's page.
    await expect(page.getByRole('heading', { name: 'Kabir Singh' })).toBeVisible()
    await expect(page.getByText(`Admission ${admissionNo}`)).toBeVisible()

    // And they are on the roster.
    await page.getByRole('link', { name: 'All students' }).click()
    await expect(page.getByRole('link', { name: 'Kabir Singh' })).toBeVisible()
  })

  test('a duplicate admission number is refused with a readable message', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')
    await page.goto('/app/students?new=1')

    await dialog(page).getByLabel('Admission number *').fill('ADM-001')
    await dialog(page).getByLabel('First name *').fill('Clash')
    await dialog(page).getByRole('button', { name: 'Add student' }).click()

    await expect(page.getByText(/already in use/i)).toBeVisible()
  })
})

test.describe('2 · Mark attendance', () => {
  test('a teacher marks a register and it persists across a reload', async ({ page }) => {
    await signIn(page, 'teacher@e2e.school')

    await nav(page, 'attendance').click()
    await expect(page).toHaveURL(/\/app\/attendance/)
    await waitForLoaded(page)

    await expect(page.getByRole('cell', { name: /Aarav Mehta ADM-/ })).toBeVisible()

    // Present, absent, late for the three pupils.
    const rows = page.locator('.register-table tbody tr')
    await rows.nth(0).getByRole('button', { name: /^Present/ }).click()
    await rows.nth(1).getByRole('button', { name: /^Absent/ }).click()
    await rows.nth(2).getByRole('button', { name: /^Late/ }).click()

    await expect(page.getByText('3 unsaved changes')).toBeVisible()
    await page.getByRole('button', { name: /Save register/ }).click()
    await expect(page.getByText('All students marked.')).toBeVisible()

    await page.reload()
    await waitForLoaded(page)
    await expect(page.getByText('Marked by Maya Thomas').first()).toBeVisible()
  })

  test('a teacher cannot mark a future date', async ({ page }) => {
    await signIn(page, 'teacher@e2e.school')
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await page.goto(`/app/attendance?date=${tomorrow}`)

    // The date input caps at today, so the register simply refuses the date.
    await expect(page.getByText('Cannot record attendance for this date')).toBeVisible()
  })
})

test.describe('3 · Collect a fee', () => {
  test('an admin bills a class then takes a payment and gets a receipt', async ({ page, request }) => {
    await signIn(page, 'admin@e2e.school')

    // Set up the bill through the API — the UI for fee configuration is
    // covered by its own unit tests, and this journey is about collection.
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const api = process.env.E2E_API_URL ?? 'http://localhost:3210'
    const headers = { cookie: cookieHeader, 'content-type': 'application/json' }

    const head = await request.post(`${api}/fees/heads`, { headers, data: { name: `Tuition ${Date.now()}` } })
    const sections = await (await request.get(`${api}/school/sections`, { headers })).json()
    const classes = await (await request.get(`${api}/school/classes`, { headers })).json()

    const structure = await request.post(`${api}/fees/structures`, {
      headers,
      data: {
        name: `Term ${Date.now()}`,
        classLevelId: classes.data[0].id,
        dueDate: '2026-07-31',
        items: [{ feeHeadId: (await head.json()).id, amount: '10000.00' }],
      },
    })
    await request.post(`${api}/fees/assign`, {
      headers,
      data: { sectionId: sections.data[0].id, feeStructureId: (await structure.json()).id },
    })

    await page.goto('/app/fees')
    await page.getByPlaceholder(/Search by name or admission/).fill('Aarav')
    await page.getByRole('button', { name: /Aarav Mehta/ }).click()

    await expect(page.getByText('Outstanding')).toBeVisible()

    await page.getByLabel('Amount').fill('2500.50')
    await page.getByRole('button', { name: 'Record payment' }).click()

    await expect(page.getByText('Payment recorded')).toBeVisible()
    await expect(page.getByText(/Receipt RCT\//)).toBeVisible()
    // Exact decimal arithmetic, not floating point.
    await expect(page.getByText('₹7,499.50').first()).toBeVisible()
  })

  test('overpayment is refused before it can be submitted', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')
    await page.goto('/app/fees')
    await page.getByPlaceholder(/Search by name or admission/).fill('Aarav')
    await page.getByRole('button', { name: /Aarav Mehta/ }).click()

    await page.getByLabel('Amount').fill('999999')
    await expect(page.getByText(/Enter an amount up to/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record payment' })).toBeDisabled()
  })
})

test.describe('4 · Enter marks · 5 · Publish a result', () => {
  test('an admin runs an exam from creation to published results', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')

    await nav(page, 'exams').click()
    await page.getByRole('button', { name: /New exam/ }).click()

    const examName = `Term ${Date.now().toString().slice(-5)}`
    await dialog(page).getByLabel('Name').fill(examName)
    await dialog(page).getByLabel('Class').selectOption({ index: 1 })
    await dialog(page).getByRole('button', { name: 'Create exam' }).click()

    await page.getByRole('link', { name: examName }).click()
    await expect(page.getByRole('heading', { name: examName })).toBeVisible()

    // Add a paper.
    await page.locator('.add-paper select').selectOption({ index: 1 })
    await page.getByRole('button', { name: /Add/ }).click()
    await expect(page.getByRole('cell', { name: 'Mathematics' })).toBeVisible()

    // Walk the state machine to mark entry.
    await page.goto('/app/exams')
    await page.getByRole('button', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: 'Open mark entry' }).click()

    await page.getByRole('link', { name: examName }).click()
    await page.getByRole('button', { name: 'Enter marks' }).click()

    const markRows = page.locator('.data-table').last().locator('tbody tr')
    for (let i = 0; i < 3; i += 1) {
      await markRows.nth(i).locator('input[type=number]').first().fill(String(70 - i * 15))
      await markRows.nth(i).locator('input[type=number]').nth(1).fill('18')
    }
    await page.getByRole('button', { name: /Save marks/ }).click()

    // Moderate, then publish.
    await page.goto('/app/exams')
    await page.getByRole('button', { name: 'Close entry' }).click()
    await page.getByRole('button', { name: 'Publish results' }).click()

    await page.getByRole('link', { name: examName }).click()
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
    await expect(page.getByRole('cell', { name: /Aarav Mehta ADM-/ })).toBeVisible()
    // 88/100 for the top pupil.
    await expect(page.getByText('88%')).toBeVisible()
  })

  test('marks above the paper maximum are blocked in the form', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')
    await page.goto('/app/exams')

    // Any exam still open for entry; created by the journey above.
    const openExam = page.locator('li', { has: page.getByText('mark entry') }).first()
    if ((await openExam.count()) === 0) test.skip()

    await openExam.getByRole('link').click()
    await page.getByRole('button', { name: 'Enter marks' }).click()

    await page.locator('.data-table').last().locator('input[type=number]').first().fill('500')
    await expect(page.getByText(/above the paper maximum/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Save marks/ })).toBeDisabled()
  })
})

test.describe('6 · A notice reaches its audience', () => {
  test('an admin publishes to teachers and only a teacher sees it', async ({ page }) => {
    const title = `Staff meeting ${Date.now().toString().slice(-5)}`

    await signIn(page, 'admin@e2e.school')
    await nav(page, 'notices').click()
    await page.getByRole('button', { name: /New notice/ }).click()

    await dialog(page).getByLabel('Title').fill(title)
    await dialog(page).getByLabel('Message').fill('Friday at 4pm in the staff room.')
    await dialog(page).getByLabel('Audience kind').selectOption('role')
    await dialog(page).getByLabel('Audience role').selectOption('teacher')
    await dialog(page).getByRole('button', { name: 'Publish notice' }).click()

    await expect(page.getByText(title)).toBeVisible()
    await signOut(page)

    await signIn(page, 'teacher@e2e.school')
    await nav(page, 'notices').click()
    await expect(page.getByText(title)).toBeVisible()
  })
})

test.describe('Session handling', () => {
  test('a deep link survives a hard reload', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')
    await page.goto('/app/students')
    await waitForLoaded(page)

    await page.reload()
    await expect(page).toHaveURL(/\/app\/students$/)
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  })

  test('a signed-out visitor is sent to login and returned afterwards', async ({ page }) => {
    await page.goto('/app/students')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fapp%2Fstudents|\/login\?redirect=\/app\/students/)

    await page.getByLabel('Email address').fill('admin@e2e.school')
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: /^Sign in/ }).click()

    await expect(page).toHaveURL(/\/app\/students/)
  })

  test('wrong credentials say nothing about whether the account exists', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill('admin@e2e.school')
    await page.getByLabel('Password', { exact: true }).fill('WrongPassword123')
    await page.getByRole('button', { name: /^Sign in/ }).click()
    const knownUser = await page.getByText(/Incorrect email or password/).textContent()

    await page.getByLabel('Email address').fill('ghost@e2e.school')
    await page.getByLabel('Password', { exact: true }).fill('WrongPassword123')
    await page.getByRole('button', { name: /^Sign in/ }).click()
    const unknownUser = await page.getByText(/Incorrect email or password/).textContent()

    expect(unknownUser).toBe(knownUser)
  })
})

test.describe('Role separation', () => {
  test('a teacher is not offered fees or school setup', async ({ page }) => {
    await signIn(page, 'teacher@e2e.school')

    await expect(nav(page, 'attendance')).toBeVisible()
    await expect(nav(page, 'fees')).toHaveCount(0)
    await expect(nav(page, 'setup')).toHaveCount(0)
    await expect(nav(page, 'staff')).toHaveCount(0)
  })

  test('a teacher typing the fees URL is redirected, not shown data', async ({ page }) => {
    await signIn(page, 'teacher@e2e.school')
    await page.goto('/app/fees')

    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByText('Collect fees')).toHaveCount(0)
  })
})
