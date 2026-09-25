import { expect, test } from '@playwright/test'

test('long sentences show sense units that can be played one by one', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' }))
    ;(window as unknown as { __kikitoriFake: object }).__kikitoriFake = { transcript: () => '' }
  })
  await page.goto('./')
  await page.getByRole('link', { name: /雨の日の過ごし方/ }).click()
  await page.getByRole('link', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Show text' }).first().click()

  const groups = page.locator('.sentence-card [data-testid="sense-group"]')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0)).toContainText('時期')
  await expect(groups.nth(1)).toContainText('面倒')
  await expect(page.locator('.sentence-card .play-group')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Play part 2' })).toHaveAttribute('lang', 'en')
  await page.locator('.sentence-card .play-group').nth(1).click()
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-12-chunks.png` })

  // Short sentences aren't split, and the setting turns chunking off.
  await page.goto('./#/settings')
  await page.getByLabel(/phrase chunks/).uncheck()
  await page.goBack()
  await page.getByRole('button', { name: 'Show text' }).first().click()
  await expect(page.locator('.sentence-card [data-testid="sense-group"]')).toHaveCount(0)
})
