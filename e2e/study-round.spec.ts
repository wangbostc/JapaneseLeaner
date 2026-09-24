import { expect, test, type Page } from '@playwright/test'

const SENTENCES = [
  '私は毎朝六時に起きます。',
  'まず、窓を開けて、コーヒーを飲みます。',
  '朝ごはんはパンと卵です。',
  '七時半に家を出て、駅まで歩きます。',
  '電車の中で、日本語のポッドキャストを聞きます。',
  '短い時間ですが、毎日続けています。',
]

/** No mic or voice in CI: the "recogniser" returns whatever the test queues. */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __next: string; __kikitoriFake: { transcript: () => string } }
    w.__next = ''
    w.__kikitoriFake = { transcript: () => w.__next }
    localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' }))
  })
}

const say = (page: Page, text: string) => page.evaluate((t) => ((window as unknown as { __next: string }).__next = t), text)

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png`, fullPage: true })

test('first study round end to end', async ({ page }) => {
  await fakeSpeech(page)
  await page.goto('./')
  await expect(page.getByRole('link', { name: /私の朝/ })).toBeVisible()
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  await shot(page, '01-today')

  await page.getByRole('link', { name: /私の朝/ }).click()
  await expect(page.locator('ruby').first()).toBeVisible({ timeout: 20_000 }) // furigana once the dictionary loads
  await shot(page, '02-lesson')
  await page.getByRole('link', { name: 'Start' }).click()

  // Intensive listening: text starts hidden.
  await expect(page.getByRole('heading', { name: 'Intensive listening' })).toBeVisible()
  await page.getByRole('button', { name: 'Show text' }).first().click()
  await expect(page.locator('.sentence-card ruby', { hasText: '毎朝' })).toBeVisible()
  await page.getByRole('button', { name: 'Hard' }).click()
  await page.locator('.sentence-card .word', { hasText: '起' }).click()
  await expect(page.getByRole('dialog')).toContainText('起きる')
  await page.waitForTimeout(300) // let the sheet finish sliding in
  await shot(page, '03-intensive-word')
  await page.getByRole('button', { name: 'Save word' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.sentence-card .word', { hasText: '毎朝' }).click()
  await page.getByRole('button', { name: 'Save word' }).click()
  await page.locator('.sheet-backdrop').click({ position: { x: 5, y: 5 } })
  for (let i = 1; i < SENTENCES.length; i++) await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Done' }).click()

  // Shadowing: a perfect attempt, a partial one (auto-marked hard), then perfect.
  await expect(page.getByRole('heading', { name: 'Shadowing' })).toBeVisible()
  for (let i = 0; i < SENTENCES.length; i++) {
    await page.getByRole('button', { name: /Speak|Try again/ }).click()
    await say(page, i === 2 ? '朝ごはん' : SENTENCES[i].replace('私', 'わたし'))
    await page.getByRole('button', { name: 'Stop' }).click()
    const result = page.getByTestId('shadow-result')
    if (i === 2) {
      await expect(result.locator('.grade')).toHaveText('C')
      await shot(page, '05-shadow-miss')
    } else {
      await expect(result.locator('.grade')).toHaveText('S')
      await expect(result.locator('.score')).toHaveText('100')
      if (i === 0) await shot(page, '04-shadow-hit')
    }
    await page.getByRole('button', { name: i === SENTENCES.length - 1 ? 'Done' : 'Next' }).click()
  }

  // Blind listening.
  await expect(page.getByRole('heading', { name: 'Blind listening' })).toBeVisible()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.getByRole('button', { name: 'The gist' }).click()

  // Retell.
  await expect(page.getByRole('heading', { name: 'Retell' })).toBeVisible()
  await page.getByRole('button', { name: 'Speak' }).click()
  await say(page, '毎朝六時に起きて、コーヒーを飲んで、駅まで歩きます。電車でポッドキャストを聞きます。')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('retell-result')).toBeVisible()
  await shot(page, '06-retell')
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible()
  await expect(page.getByText(/Next review in 6 hours/)).toBeVisible()
  await shot(page, '07-round-done')

  // Back on Today: the lesson moved to "Coming up"; the saved word is a due card.
  await page.getByRole('link', { name: 'Back to Today' }).click()
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  await expect(page.getByText('Review 1/7')).toBeVisible()
  await expect(page.getByText('2 cards to review')).toBeVisible()
  await shot(page, '08-today-after')

  // Sentences 1 (marked by hand) and 3 (scored C) are hard.
  await page.getByRole('link', { name: /私の朝/ }).click()
  await expect(page.locator('.transcript li.is-hard')).toHaveCount(2)

  await page.goto('./#/cards')
  await expect(page.getByText('1 of 2')).toBeVisible()
  await expect(page.getByTestId('flashcard')).toContainText('起きる')
  await page.getByRole('button', { name: 'Show answer' }).click()
  await expect(page.getByTestId('flashcard')).toContainText('おきる')
  await shot(page, '09-card')
  await page.getByRole('button', { name: /Good/ }).click()
  // The counter holds steady as graded cards leave the due set.
  await expect(page.getByText('2 of 2')).toBeVisible()
  await expect(page.getByTestId('flashcard')).toContainText('毎朝')
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /Easy/ }).click()
  await expect(page.getByText('All caught up.')).toBeVisible()

  await page.goto('./#/stats')
  await shot(page, '10-stats')
})

test('Chinese interface and import', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'zh' })))
  await page.goto('./#/import')
  await expect(page.getByRole('heading', { name: '导入课程' })).toBeVisible()
  await page.getByLabel('标题').fill('自己紹介')
  await page.getByRole('textbox', { name: /^原文/ }).fill('はじめまして。田中です。\nよろしくお願いします！')
  await expect(page.getByTestId('import-preview')).toHaveText('识别到 3 句')
  await page.getByRole('button', { name: '创建课程' }).click()
  await expect(page.getByRole('heading', { name: '自己紹介' })).toBeVisible()
  await expect(page.locator('.transcript li')).toHaveCount(3)
  await shot(page, '11-import-zh')
})
