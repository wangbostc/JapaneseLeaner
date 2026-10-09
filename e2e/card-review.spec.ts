import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const CORE = (JSON.parse(readFileSync(new URL('../packages/core/src/coreWords.json', import.meta.url), 'utf8')) as { words: [string, string][] }).words

/** A fresh install in English (10 core cards due by default). Only the first load: a reload keeps what the app saved. */
async function fresh(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript((s) => {
    if (!localStorage.getItem('kikitori.settings')) localStorage.setItem('kikitori.settings', JSON.stringify(s))
  }, { lang: 'en', ...settings })
  await page.goto('./#/cards')
}

test('cards are reviewed from the keyboard, and a grade can be undone', async ({ page }) => {
  await fresh(page)
  const card = page.getByTestId('flashcard')
  await expect(card).toContainText(CORE[0][0])
  await expect(page.getByText('1 of 10')).toBeVisible()
  await expect(page.getByTestId('undo')).toHaveCount(0)

  await page.keyboard.press('Space')
  await expect(page.getByTestId('card-back')).toBeVisible()
  await page.keyboard.press('3')
  await expect(page.getByText('2 of 10')).toBeVisible()
  await expect(card).toContainText(CORE[1][0])
  await expect(page.getByTestId('card-back')).toHaveCount(0)

  // U puts the first card back, unanswered.
  await page.keyboard.press('u')
  await expect(page.getByText('1 of 10')).toBeVisible()
  await expect(card).toContainText(CORE[0][0])
  await expect(page.getByTestId('card-back')).toHaveCount(0)
  await expect(page.getByTestId('undo-message')).toHaveText('Grade undone.')
  await expect(page.getByTestId('undo')).toHaveCount(0)

  // Grading it again moves on as before, and the Undo button does what U does.
  await page.keyboard.press('Enter')
  await page.keyboard.press('4')
  await expect(page.getByText('2 of 10')).toBeVisible()
  await page.getByTestId('undo').click()
  await expect(page.getByText('1 of 10')).toBeVisible()
  await expect(card).toContainText(CORE[0][0])
  // Grades need the answer showing first.
  await page.keyboard.press('3')
  await expect(page.getByText('1 of 10')).toBeVisible()
})

test('the last grade of the day can be undone too', async ({ page }) => {
  await fresh(page, { newWordsPerDay: 5 })
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`${i + 1} of 5`)).toBeVisible()
    await page.keyboard.press('Space')
    await page.keyboard.press('3')
  }
  await expect(page.getByText('All caught up.')).toBeVisible()
  await page.keyboard.press('u')
  await expect(page.getByText('5 of 5')).toBeVisible()
  await expect(page.getByTestId('flashcard')).toContainText(CORE[4][0])
})

test('Listen hides the Japanese until the answer', async ({ page }) => {
  await fresh(page)
  const card = page.getByTestId('flashcard')
  await expect(card).toContainText(CORE[0][0])
  await page.getByTestId('card-mode-listen').click()
  await expect(page.getByTestId('card-mode-listen')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('card-prompt')).toHaveText('Listen, then recall what it means.')
  await expect(page.getByTestId('play-card')).toBeVisible()
  await expect(page.getByTestId('core-label')).toHaveText('Core 3,500 · #1')
  await expect(card).not.toContainText(CORE[0][0])

  // A mode button reached with the keyboard keeps its Space (a keyboard user picks a mode so)...
  await page.getByTestId('card-mode-listen').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('card-mode-read')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('card-mode-read')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('card-back')).toHaveCount(0)
  // ...but one clicked with the mouse doesn't: Space shows the answer.
  await page.getByTestId('card-mode-listen').click()
  await page.keyboard.press('Space')
  await expect(card).toContainText(CORE[0][0])
  await expect(page.getByTestId('card-back')).toBeVisible()
  await expect(page.getByTestId('card-prompt')).toHaveCount(0)
  await expect(page.getByTestId('card-mode-listen')).toHaveAttribute('aria-pressed', 'true')
})

test('Recall asks with the meanings and hides the Japanese until the answer', async ({ page }) => {
  await fresh(page)
  const card = page.getByTestId('flashcard')
  await expect(card).toContainText(CORE[0][0])
  await page.getByTestId('card-mode-recall').click()
  const prompt = page.getByTestId('card-prompt')
  await expect(prompt).toContainText('How do you say this in Japanese?')
  await expect(prompt.locator('li').first()).toBeVisible()
  await expect(card).not.toContainText(CORE[0][0])
  await expect(page.getByTestId('core-label')).toBeVisible()
  // Hearing it would give it away.
  await expect(page.getByTestId('play-card')).toHaveCount(0)

  await page.getByRole('button', { name: 'Show answer' }).click()
  await expect(card).toContainText(CORE[0][0])
  await expect(card.getByTestId('meanings')).toBeVisible()
  await expect(prompt).toHaveCount(0)
  await expect(page.getByTestId('play-card')).toBeVisible()
  await page.getByRole('button', { name: /^Good/ }).click()
  await expect(page.getByText('2 of 10')).toBeVisible()
})

test('Mix reviews each card one way or another', async ({ page }) => {
  await fresh(page)
  const card = page.getByTestId('flashcard')
  await expect(card).toContainText(CORE[0][0])
  await page.getByTestId('card-mode-mix').click()
  for (let i = 0; i < 4; i++) {
    await expect(page.getByText(`${i + 1} of 10`)).toBeVisible()
    await expect(page.getByTestId('card-prompt').or(card.locator('.card-front'))).toBeVisible()
    await page.keyboard.press('Space')
    await expect(card).toContainText(CORE[i][0])
    await expect(page.getByTestId('card-back')).toBeVisible()
    await page.keyboard.press('3')
  }
  await expect(page.getByText('5 of 10')).toBeVisible()
})

test('the review mode is kept in settings', async ({ page }) => {
  await fresh(page)
  await expect(page.getByTestId('card-mode-read')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('card-mode-recall').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kikitori.settings') ?? '{}').cardMode)).toBe('recall')
  await page.reload()
  await expect(page.getByTestId('card-mode-recall')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('card-mode-read')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('card-prompt')).toContainText('How do you say this in Japanese?')
})

test('Space shows the answer right after the Cards tab was clicked', async ({ page }) => {
  await fresh(page)
  await page.goto('./')
  await page.getByRole('link', { name: 'Cards', exact: true }).click()
  await expect(page.getByTestId('flashcard')).toContainText(CORE[0][0])
  await page.keyboard.press('Space')
  await expect(page.getByTestId('card-back')).toBeVisible()
})
