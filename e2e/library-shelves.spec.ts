import { expect, test, type Page } from '@playwright/test'
import { SAMPLES } from './samples'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
})

/** A lesson labelled as a textbook's would be ("<book> · L<n>"), made through Import. */
async function addLesson(page: Page, title: string, level: string) {
  await page.goto('./#/import')
  await page.getByRole('textbox', { name: /^Title/ }).fill(title)
  await page.getByRole('textbox', { name: /^Level/ }).fill(level)
  await page.getByRole('textbox', { name: /^Transcript/ }).fill('これはテストです。')
  await page.getByRole('button', { name: 'Create lesson' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

const rows = (page: Page) => page.locator('.lesson-row .lesson-title')

test('without a textbook, the library is one list, newest first', async ({ page }) => {
  await addLesson(page, '自分の課', 'N4')
  await page.goto('./#/library')
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await expect(page.locator('.lesson-row')).toHaveCount(SAMPLES + 1)
  await expect(rows(page).first()).toContainText('自分の課')
})

test('a textbook gets its own shelf, a chapter at a time, in book order', async ({ page }) => {
  await addLesson(page, 'テスト本 第二課 会話', 'Test book · L2')
  await addLesson(page, 'テスト本 第一課 読み物', 'Test book · L1 読み書き')
  // Back in the library after an import, it opens where that lesson is.
  await page.goto('./#/library')
  await expect(page.getByRole('tab', { name: /Test book/, selected: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'L1', selected: true })).toBeVisible()
  await addLesson(page, 'テスト本 第一課 会話', 'Test book · L1')

  await page.goto('./#/library')
  const shelves = page.getByRole('tablist', { name: 'Library' }).getByRole('tab')
  await expect(shelves).toHaveText([/Test book\s*3/, new RegExp(`Starter lessons\\s*${SAMPLES}`)])
  await expect(page.getByRole('tab', { name: 'L1', selected: true })).toBeVisible()
  // The chapter's dialogue before its reading.
  await expect(rows(page)).toHaveText([/テスト本 第一課 会話/, /テスト本 第一課 読み物/])

  await page.getByRole('tab', { name: 'L2' }).click()
  await expect(rows(page)).toHaveText([/テスト本 第二課 会話/])
  // Coming back from a lesson keeps the chapter.
  await rows(page).first().click()
  await page.goBack()
  await expect(page.getByRole('tab', { name: 'L2', selected: true })).toBeVisible()

  await page.getByRole('tab', { name: /Starter lessons/ }).click()
  await expect(page.locator('.lesson-row')).toHaveCount(SAMPLES)
  await expect(page.getByRole('tab', { name: 'L1' })).toHaveCount(0)
})
