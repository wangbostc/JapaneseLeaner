import { expect, test, type Route } from '@playwright/test'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function message(text: string) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

function sse(chunks: string[]) {
  const events = [
    { type: 'message_start', message: { ...message(''), content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...chunks.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

test('translates a lesson and explains a sentence with the learner’s own key', async ({ page }) => {
  const requests: Record<string, unknown>[] = []
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = req.postDataJSON()
    requests.push({ ...body, key: req.headers()['x-api-key'] })
    if (body.stream) {
      return route.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(['「は」marks ', 'the topic.']) })
    }
    return route.fulfill({ headers: CORS, json: message(JSON.stringify({ translations: ['Nice to meet you.', 'I am Tanaka.'] })) })
  })
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))

  // No key yet: no AI buttons anywhere.
  await page.goto('./#/import')
  await page.getByRole('textbox', { name: /^Title/ }).fill('自己紹介')
  await page.getByRole('textbox', { name: /^Transcript/ }).fill('はじめまして。田中です。')
  await page.getByRole('button', { name: 'Create lesson' }).click()
  await expect(page.getByRole('heading', { name: '自己紹介' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Translate with AI/ })).toHaveCount(0)
  const lessonUrl = page.url()

  await page.goto('./#/settings')
  await page.getByLabel('Anthropic API key').fill('sk-ant-test-1234')
  await page.getByRole('button', { name: 'Save key' }).click()
  await expect(page.getByText('sk-ant-…1234')).toBeVisible()

  // The key never goes into a backup.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()])
  const backup = await (await download.createReadStream()).toArray()
  expect(Buffer.concat(backup).toString()).not.toContain('sk-ant-test-1234')

  await page.goto(lessonUrl)
  await page.getByRole('button', { name: /Translate with AI/ }).click()
  await expect(page.locator('.transcript .translation')).toHaveText(['Nice to meet you.', 'I am Tanaka.'])
  await expect(page.getByRole('button', { name: /Translate with AI/ })).toHaveCount(0)

  await page.getByRole('link', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Show text' }).first().click()
  await page.getByRole('button', { name: /Explain/ }).click()
  await expect(page.getByTestId('explanation')).toHaveText('「は」marks the topic.')

  expect(requests).toHaveLength(2)
  expect(requests.every((r) => r.key === 'sk-ant-test-1234' && r.model === 'claude-opus-5')).toBe(true)
})

test('shows AI errors in the interface language and offers a retry', async ({ page }) => {
  let calls = 0
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    calls++
    return route.fulfill({
      status: 401,
      headers: CORS,
      json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    })
  })
  await page.addInitScript(() => {
    localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'zh' }))
    localStorage.setItem('kikitori.anthropicKey', 'sk-ant-bad')
  })
  await page.goto('./')
  await page.getByRole('link', { name: /私の朝/ }).click()
  await page.getByRole('link', { name: '开始' }).click()
  await page.getByRole('button', { name: '显示原文' }).first().click()
  await page.getByRole('button', { name: /讲解/ }).click()
  await expect(page.getByTestId('explanation')).toContainText('API 密钥被拒绝')
  await page.getByRole('button', { name: /重试/ }).click()
  await expect.poll(() => calls).toBe(2)
})
