import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
})

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('./')
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, null, {
    timeout: 20_000,
  })
  // With the worker in control, loading a lesson pulls the dictionary through its cache.
  await page.getByRole('link', { name: /私の朝/ }).click()
  await expect(page.locator('ruby').first()).toBeVisible({ timeout: 20_000 })

  await context.setOffline(true)
  await page.goto('./')
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  await page.getByRole('link', { name: /週末のカフェ/ }).click()
  await expect(page.locator('ruby').first()).toBeVisible({ timeout: 20_000 })
  await context.setOffline(false)
})

test('exports a backup and restores it over changed data', async ({ page }) => {
  await page.goto('./#/import')
  await page.getByRole('textbox', { name: /^Title/ }).fill('バックアップ')
  await page.getByRole('textbox', { name: /^Transcript/ }).fill('これはテストです。')
  await page.getByRole('button', { name: 'Create lesson' }).click()
  await expect(page.getByRole('heading', { name: 'バックアップ' })).toBeVisible()

  await page.goto('./#/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()])
  const path = test.info().outputPath('backup.json')
  await download.saveAs(path)
  const backup = JSON.parse(readFileSync(path, 'utf8'))
  expect(backup.format).toBe('kikitori-backup')
  expect(backup.lessons).toHaveLength(4)

  // Delete the imported lesson, then restore it from the file.
  await page.goto('./#/library')
  await page.getByRole('link', { name: /バックアップ/ }).click()
  await page.getByRole('button', { name: 'Delete lesson' }).click()
  await page.getByRole('button', { name: 'Tap again to delete' }).click()
  await expect(page.locator('.lesson-row')).toHaveCount(3)

  await page.goto('./#/settings')
  await page.getByTestId('restore-input').setInputFiles(path)
  await page.getByRole('alert').getByRole('button', { name: 'Restore backup' }).click()
  await expect(page.getByText('Restored 4 lessons.')).toBeVisible()
  await page.goto('./#/library')
  await expect(page.getByRole('link', { name: /バックアップ/ })).toBeVisible()
})
