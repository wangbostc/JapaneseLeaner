import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
})

// The narrowest phones still in use (iPhone SE, 1st generation).
test.use({ viewport: { width: 320, height: 640 } })

test('intensive listening fits a 320px screen: the hidden sentence wraps inside its card', async ({ page }) => {
  await page.goto('./#/library')
  await page.getByRole('link', { name: /私の朝/ }).click()
  await page.getByRole('link', { name: 'Intensive listening' }).click()
  await expect(page.locator('.conceal')).toBeVisible()

  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  // The dots stay inside the card, over more than one line.
  const fit = await page.evaluate(() => {
    const button = document.querySelector('.conceal')!
    const range = document.createRange()
    range.selectNodeContents(button)
    const text = range.getBoundingClientRect()
    const card = document.querySelector('.sentence-card')!.getBoundingClientRect()
    return { inside: text.right <= card.right && text.left >= card.left, lines: range.getClientRects().length }
  })
  expect(fit.inside).toBe(true)
  expect(fit.lines).toBeGreaterThan(1)

  // Every control's label stays inside its button: in this machine's font, and set wider than any
  // likely font (Android's and Linux's make "sentence" wider than Apple's do). Measured from the
  // text itself, as a centred label spills out of both sides.
  const spills = () =>
    page.locator('.controls > .btn').evaluateAll((els) =>
      els.flatMap((el) => {
        const box = el.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(el.querySelector('span')!)
        return [...range.getClientRects()].some((r) => r.left < box.left || r.right > box.right) ? [el.textContent] : []
      }),
    )
  expect(await spills()).toEqual([])
  await page.addStyleTag({ content: ".controls span { font-family: Verdana, 'DejaVu Sans', sans-serif; letter-spacing: 0.3em; }" })
  expect(await spills()).toEqual([])
})
