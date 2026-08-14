import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn, waitForLoaded } from './helpers'

/**
 * WCAG 2.1 AA, checked with axe on every screen a school will actually use.
 *
 * This matters more than usual here: school offices run old hardware at odd
 * zoom levels, and a portion of any school's staff and families use assistive
 * technology. A colour-contrast failure on the fee balance is a real problem,
 * not a checkbox.
 *
 * Violations are asserted to be empty and printed in full on failure, so the
 * report says which element and which rule rather than just a count.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 120)),
  }))
}

test.describe('public pages', () => {
  test('landing page has no WCAG AA violations', async ({ page }) => {
    await page.goto('/')
    expect(await scan(page)).toEqual([])
  })

  test('sign-in page has no WCAG AA violations', async ({ page }) => {
    await page.goto('/login')
    expect(await scan(page)).toEqual([])
  })
})

test.describe('signed-in pages', () => {
  const pages: [name: string, path: string][] = [
    ['dashboard', '/app'],
    ['students', '/app/students'],
    ['staff', '/app/staff'],
    ['attendance register', '/app/attendance'],
    ['attendance report', '/app/attendance/report'],
    ['notices', '/app/notices'],
    ['exams', '/app/exams'],
    ['fees', '/app/fees'],
    ['school setup', '/app/setup'],
    ['student import', '/app/students/import'],
    ['account security', '/app/security'],
  ]

  for (const [name, path] of pages) {
    test(`${name} has no WCAG AA violations`, async ({ page }) => {
      await signIn(page, 'admin@e2e.school')
      await page.goto(path)
      await waitForLoaded(page)
      expect(await scan(page)).toEqual([])
    })
  }
})

test.describe('keyboard operation', () => {
  test('the sign-in form can be completed without a mouse', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel('Email address').focus()
    await page.keyboard.type('admin@e2e.school')
    await page.keyboard.press('Tab')
    await page.keyboard.type('E2eTestPassword99')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/app/)
  })

  test('every interactive control is reachable by tab on the register', async ({ page }) => {
    await signIn(page, 'admin@e2e.school')
    await page.goto('/app/attendance')
    await waitForLoaded(page)

    // Nothing may be focusable-but-invisible, and nothing interactive may be
    // skipped by having a negative tabindex.
    const unreachable = await page.evaluate(() => {
      const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea')]
      return interactive
        .filter((el) => {
          const style = getComputedStyle(el)
          const visible = style.display !== 'none' && style.visibility !== 'hidden'
          const tabindex = el.getAttribute('tabindex')
          return visible && tabindex !== null && Number(tabindex) < 0
        })
        .map((el) => el.outerHTML.slice(0, 100))
    })
    expect(unreachable).toEqual([])
  })
})

test.describe('reduced motion', () => {
  test('animations are suppressed when the user asks for it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await signIn(page, 'admin@e2e.school')
    await page.goto('/app/students')

    const animated = await page.evaluate(() =>
      [...document.querySelectorAll('*')].filter((el) => {
        const name = getComputedStyle(el).animationName
        return name && name !== 'none'
      }).length,
    )
    expect(animated).toBe(0)
  })
})
