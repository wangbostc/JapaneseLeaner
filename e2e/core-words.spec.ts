import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const CORE = (JSON.parse(readFileSync(new URL('../packages/core/src/coreWords.json', import.meta.url), 'utf8')) as { words: [string, string][] }).words

test('a fresh install brings the day’s core words to Cards, most frequent first', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
  await page.goto('./')
  await expect(page.getByText('10 cards to review')).toBeVisible() // the default: 10 a day
  await page.goto('./#/cards')
  const card = page.getByTestId('flashcard')
  await expect(card).toContainText(CORE[0][0])
  await expect(page.getByTestId('core-label')).toHaveText('Core 3,500 · #1')
  await page.getByRole('button', { name: 'Show answer' }).click()
  await expect(card.getByTestId('meanings')).toBeVisible()
  await page.getByRole('button', { name: /^Good/ }).click()
  await expect(page.getByTestId('core-label')).toHaveText('Core 3,500 · #2')
  await expect(card).toContainText(CORE[1][0])
  // Reloading the same day adds none (still 9 to go, not 19).
  await page.goto('./')
  await expect(page.getByText('9 cards to review')).toBeVisible()
})

test('no core words when they are turned off', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en', newWordsPerDay: 0 })))
  await page.goto('./#/settings')
  await expect(page.getByTestId('new-words')).toHaveValue('0')
  await page.goto('./#/cards')
  await expect(page.getByText('No cards due.', { exact: false })).toBeVisible()
})
