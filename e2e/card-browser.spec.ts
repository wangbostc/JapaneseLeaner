import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const CORE = (JSON.parse(readFileSync(new URL('../packages/core/src/coreWords.json', import.meta.url), 'utf8')) as { words: [string, string][] }).words

/** A fresh install in English (10 core cards due by default), opened at Cards. */
async function fresh(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('kikitori.settings')) localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' }))
  })
  await page.goto('./#/cards')
}

const rows = (page: Page) => page.getByTestId(/^card-row-/)
const row = (page: Page, front: string) => rows(page).filter({ has: page.locator('.card-row-front', { hasText: new RegExp(`^${front}$`) }) })

/** Opens a row's actions (one row at a time). */
async function open(page: Page, front: string) {
  const r = row(page, front)
  await r.locator('.card-row-main').click()
  await expect(r.getByTestId(/^edit-\d+$/)).toBeVisible()
  return r
}

test('All cards lists every card; search and filters narrow it', async ({ page }) => {
  await fresh(page)
  await expect(page.getByText('1 of 10')).toBeVisible()
  await page.getByTestId('all-cards').click()
  await expect(page).toHaveURL(/#\/cards\/all$/)
  await expect(page.getByRole('heading', { name: 'All cards' })).toBeVisible()
  // Still under Cards in the nav.
  await expect(page.locator('.tab.active')).toHaveText('Cards')
  await expect(page.getByTestId('card-count')).toHaveText('10 cards')
  await expect(rows(page)).toHaveCount(10)
  // Most frequent first; none reviewed yet.
  await expect(rows(page).first()).toContainText(CORE[0][0])
  await expect(rows(page).first()).toContainText('Core 3,500 · #1')
  await expect(rows(page).first().getByTestId('card-status')).toHaveText('New')
  // A reading shows only where it differs from the word.
  await expect(row(page, '人')).toContainText('ひと')
  await expect(page.getByTestId('show-more')).toHaveCount(0)

  const search = page.getByTestId('card-search')
  await search.fill('る')
  await expect(page.getByTestId('card-count')).toHaveText('4 cards')
  // Katakana finds the hiragana reading.
  await search.fill('ヒト')
  await expect(page.getByTestId('card-count')).toHaveText('1 card')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('人')
  await search.fill('xyz')
  await expect(page.getByText('No cards match.')).toBeVisible()
  await search.fill('')
  await expect(page.getByTestId('card-count')).toHaveText('10 cards')

  for (const [filter, count] of [
    ['core', '10 cards'],
    ['due', '10 cards'],
    ['saved', '0 cards'],
    ['suspended', '0 cards'],
  ]) {
    await page.getByTestId(`card-filter-${filter}`).click()
    await expect(page.getByTestId(`card-filter-${filter}`)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('card-count')).toHaveText(count)
  }
  // Filter and search together.
  await page.getByTestId('card-filter-core').click()
  await search.fill('る')
  await expect(page.getByTestId('card-count')).toHaveText('4 cards')

  await page.getByTestId('back-to-cards').click()
  await expect(page).toHaveURL(/#\/cards$/)
  await expect(page.getByText('1 of 10')).toBeVisible()
})

test('a suspended card leaves review until it is resumed', async ({ page }) => {
  await fresh(page)
  await page.getByTestId('all-cards').click()
  let r = await open(page, CORE[0][0])
  await r.getByTestId(/^suspend-/).click()
  await expect(r.getByTestId('card-status')).toHaveText('Suspended')
  await expect(r.getByTestId(/^suspend-/)).toHaveText('Resume')
  // Suspended ones go last.
  await expect(rows(page).last()).toContainText(CORE[0][0])
  await page.getByTestId('card-filter-due').click()
  await expect(page.getByTestId('card-count')).toHaveText('9 cards')
  await expect(row(page, CORE[0][0])).toHaveCount(0)
  await page.getByTestId('card-filter-suspended').click()
  await expect(page.getByTestId('card-count')).toHaveText('1 card')

  await page.goto('./')
  await expect(page.getByText('9 cards to review')).toBeVisible()
  await page.goto('./#/cards')
  await expect(page.getByText('1 of 9')).toBeVisible()
  await expect(page.getByTestId('flashcard')).toContainText(CORE[1][0])

  await page.getByTestId('all-cards').click()
  r = await open(page, CORE[0][0])
  await r.getByTestId(/^suspend-/).click()
  await expect(r.getByTestId('card-status')).toHaveText('New')
  await expect(rows(page).first()).toContainText(CORE[0][0])
  await page.getByTestId('card-filter-due').click()
  await expect(page.getByTestId('card-count')).toHaveText('10 cards')
  await page.goto('./')
  await expect(page.getByText('10 cards to review')).toBeVisible()
})

test('keys typed in the browser grade nothing', async ({ page }) => {
  await fresh(page)
  await expect(page.getByText('1 of 10')).toBeVisible()
  await page.getByTestId('all-cards').click()
  const search = page.getByTestId('card-search')
  await search.click()
  await page.keyboard.type('3 u')
  await expect(search).toHaveValue('3 u')
  await expect(page.getByTestId('card-count')).toHaveText('0 cards')
  await search.fill('')
  await search.blur()
  for (const key of ['u', 'Space', '3', 'Enter', '4']) await page.keyboard.press(key)
  await expect(page).toHaveURL(/#\/cards\/all$/)
  await expect(rows(page).first().getByTestId('card-status')).toHaveText('New')

  await page.getByTestId('back-to-cards').click()
  await expect(page.getByText('1 of 10')).toBeVisible()
  await expect(page.getByTestId('flashcard')).toContainText(CORE[0][0])
  await expect(page.getByTestId('card-back')).toHaveCount(0)
  await expect(page.getByTestId('undo')).toHaveCount(0)
  await page.goto('./')
  await expect(page.getByText('10 cards to review')).toBeVisible()
})

test('All cards is there once everything is reviewed, too', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en', newWordsPerDay: 0 })))
  await page.goto('./#/cards')
  await expect(page.getByText('No cards due.', { exact: false })).toBeVisible()
  await page.getByTestId('all-cards').click()
  await expect(page.getByTestId('card-count')).toHaveText('0 cards')
  await expect(page.getByText('No cards match.')).toBeVisible()
})

test('a saved card can be corrected and deleted; a core word keeps its spelling', async ({ page }) => {
  await fresh(page)
  // Save a word from a lesson (found in the Library: Today lists only what's due by the moment it opened).
  await page.goto('./#/library')
  await page.getByRole('link', { name: /私の朝/ }).click()
  await page.getByRole('link', { name: 'Intensive listening' }).click()
  await page.getByRole('button', { name: 'Show text' }).first().click()
  await page.locator('.sentence-card .word', { hasText: '起' }).click({ timeout: 20_000 })
  await expect(page.getByRole('dialog')).toContainText('起きる')
  await page.getByRole('button', { name: 'Save word' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()

  await page.goto('./#/cards/all')
  await expect(page.getByTestId('card-count')).toHaveText('11 cards')
  await page.getByTestId('card-filter-saved').click()
  await expect(page.getByTestId('card-count')).toHaveText('1 card')
  let r = await open(page, '起きる')
  await expect(r).toContainText('おきる')
  await expect(r).not.toContainText('Core 3,500')

  // Cancel leaves it as it was.
  await r.getByTestId(/^edit-\d+$/).click()
  await expect(page.getByTestId('edit-front')).toBeEnabled()
  await expect(page.getByTestId('edit-context')).toHaveValue('私は毎朝六時に起きます。')
  await page.getByTestId('edit-reading').fill('まちがい')
  await page.getByTestId('cancel-edit').click()
  await expect(page.getByTestId('edit-reading')).toHaveCount(0)
  await expect(r).toContainText('おきる')

  await r.getByTestId(/^edit-\d+$/).click()
  await page.getByTestId('edit-reading').fill(' オキル ')
  await page.getByTestId('save-card').click()
  await expect(page.getByTestId('edit-reading')).toHaveCount(0)
  await expect(r).toContainText('オキル')
  await page.getByTestId('card-search').fill('おきる')
  await expect(page.getByTestId('card-count')).toHaveText('1 card')
  await page.getByTestId('card-search').fill('')

  // A core word's spelling can't be edited.
  await page.getByTestId('card-filter-core').click()
  const core = await open(page, CORE[1][0])
  await core.getByTestId(/^edit-\d+$/).click()
  await expect(page.getByTestId('edit-front')).toBeDisabled()
  await expect(page.getByTestId('edit-front')).toHaveValue(CORE[1][0])
  await expect(core).toContainText('A core word’s spelling can’t be changed.')
  await page.getByTestId('cancel-edit').click()

  // Deleting takes a second press; a core word says it won't come back.
  await core.getByTestId(/^delete-/).click()
  await expect(core.getByTestId(/^delete-/)).toHaveText('Tap again to delete')
  await expect(core).toContainText('A deleted core word isn’t added again.')
  await core.getByTestId(/^delete-/).click()
  await expect(row(page, CORE[1][0])).toHaveCount(0)
  await expect(page.getByTestId('card-count')).toHaveText('9 cards')

  await page.getByTestId('card-filter-saved').click()
  r = await open(page, '起きる')
  await r.getByTestId(/^delete-/).click()
  await expect(r.getByTestId(/^delete-/)).toHaveText('Tap again to delete')
  await expect(r).not.toContainText('A deleted core word')
  await expect(rows(page)).toHaveCount(1)
  await r.getByTestId(/^delete-/).click()
  await expect(page.getByText('No cards match.')).toBeVisible()
  await page.getByTestId('card-filter-all').click()
  await expect(page.getByTestId('card-count')).toHaveText('9 cards')
})
