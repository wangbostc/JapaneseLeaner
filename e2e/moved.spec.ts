import { expect, test } from '@playwright/test'

// The moved banner is baked in at build time (VITE_MOVED_TO); the normal e2e build has none.
test('the normal build shows no moved banner', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.lesson-row').first()).toBeVisible()
  await expect(page.getByTestId('moved-banner')).toHaveCount(0)
})
