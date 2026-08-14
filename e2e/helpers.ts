import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'E2eTestPassword99'

/** Signs in through the real form — this is the path a user takes. */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: /^Sign in/ }).click()
  await expect(page).toHaveURL(/\/app/)
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: /Sign out/ }).click()
  await expect(page).toHaveURL(/\/$/)
}

/**
 * Navigation items by their stable `data-route`, not their label — several
 * labels legitimately overlap ("Students" / "Import students").
 */
export function nav(page: Page, route: string) {
  return page.locator(`[data-route="${route}"]`)
}

/** The open modal, so buttons inside it are unambiguous. */
export function dialog(page: Page) {
  return page.getByRole('dialog')
}

/** Waits for a page's data to settle rather than sleeping. */
export async function waitForLoaded(page: Page) {
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 })
}
