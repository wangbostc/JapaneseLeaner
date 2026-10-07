import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatDuration, STRINGS } from '@kikitori/core/i18n'
import { hasNativeTestRenderer } from '@gpuix/react/testing'
import { describe, expect, it } from 'vitest'
import { open } from './testing'

const FIXTURES = join(import.meta.dirname, '../../../e2e/fixtures')

describe.runIf(hasNativeTestRenderer)('import, cards, stats and settings', () => {
  it('imports a lesson from pasted text', { timeout: 30000 }, async () => {
    const o = await open()
    const { app, click, shows, appears, db } = o
    await click('tab-library')
    await click('import')
    await appears('title')
    await app.getByTestId('title').fill('貼り付け')
    await app.getByTestId('transcript').fill('今日は雨です。\n明日は晴れます。')
    await app.getByTestId('translation').fill('It rains today.\nIt will be sunny tomorrow.')
    await shows('2 sentences detected')
    await click('create')
    await shows('It will be sunny tomorrow.') // the new lesson's page
    const lesson = (await db.lessons.all()).find((l) => l.title === '貼り付け')!
    expect(lesson.sentences.map((s) => [s.text, s.start, s.translations?.en])).toEqual([
      ['今日は雨です。', null, 'It rains today.'],
      ['明日は晴れます。', null, 'It will be sunny tomorrow.'],
    ])
    expect(lesson.mediaId).toBeUndefined()
  })

  it('imports audio with timed subtitles, and plays each cue from the cached file', { timeout: 30000 }, async () => {
    const o = await open({ picks: [[join(FIXTURES, 'clip.wav')], [join(FIXTURES, 'clip.srt')]] })
    const { click, shows, appears, audio, db, dir } = o
    await click('tab-library')
    await click('import')
    await click('choose-audio')
    await shows('clip.wav')
    await click('load-transcript')
    await shows('3 sentences detected')
    await click('create') // the title came from the subtitles' file name
    await shows('clip') // the new lesson's page
    const lesson = (await db.lessons.all()).find((l) => l.title === 'clip')!
    const media = (await db.media.get(lesson.mediaId!))!
    expect([media.name, media.blob.type, media.blob.size]).toEqual(['clip.wav', 'audio/wav', expect.any(Number)])
    expect(media.blob.size).toBeGreaterThan(1000)
    await click('start')
    await appears('conceal')
    await expect.poll(() => audio.played.length).toBeGreaterThan(0)
    const [first] = audio.played
    expect(first).toEqual({ path: join(dir, 'media', `${media.uid}.wav`), start: 0.6, end: 2.016 })
    expect(existsSync(first.path)).toBe(true)
  })

  it('refuses a file that is not audio', { timeout: 30000 }, async () => {
    const o = await open({ picks: [[join(FIXTURES, '../study-round.spec.ts')]] })
    await o.click('tab-library')
    await o.click('import')
    await o.click('choose-audio')
    await o.shows(STRINGS.en.macNotAudio)
  })

  it('reviews a due card from Today’s banner, then schedules it', { timeout: 30000 }, async () => {
    const o = await open()
    const { click, shows, appears, store, db, lessonId } = o
    await shows('私の朝')
    const card = await store.addCard({ lessonId: await lessonId('私の朝'), kind: 'word', front: '毎朝', reading: 'まいあさ', context: '私は毎朝六時に起きます。' })
    await shows('1 card to review')
    await click('cards-banner')
    await appears('flashcard')
    await shows('1 of 1')
    await click('show-answer')
    await shows('1. every morning · noun, adverb')
    await click('grade-3') // Good
    await shows('All caught up.')
    const graded = (await db.cards.get(card))!
    expect(graded.card.due).toBeInstanceOf(Date)
    expect(graded.card.due.getTime()).toBeGreaterThan(Date.now())
  })

  it('shows practice time in Stats', { timeout: 30000 }, async () => {
    const o = await open()
    await o.shows('私の朝')
    await o.store.log({ lessonId: await o.lessonId('私の朝'), step: 'intensive', mode: 'input', ms: 90 * 60_000, at: Date.now() })
    await o.click('tab-stats')
    await o.shows(formatDuration(90 * 60_000))
    await o.shows('Listening / speaking'.toUpperCase())
  })

  it('applies settings at once and keeps them', { timeout: 30000 }, async () => {
    const o = await open()
    const { click, shows, hides, prefs, lessonId } = o
    await shows('私の朝')
    await click('tab-settings')
    await click('furigana')
    await click('tab-library')
    await click(`lesson-${await lessonId('私の朝')}`)
    await shows('私')
    await hides('わたし') // no furigana
    await click('tab-settings')
    await click('lang-zh')
    await shows(STRINGS.zh.navToday) // the tabs, in Chinese, without a restart
    expect(JSON.parse(prefs.getItem('kikitori.settings')!)).toMatchObject({ lang: 'zh', furigana: false })
  })

  it('exports a backup to a folder and restores it, after a confirmation', { timeout: 30000 }, async () => {
    const o = await open()
    const { click, shows, hides, appears, painted, db, dir, store, lessonId } = o
    // Pick a folder (the export), then the file it wrote (the restore).
    const picks: (string[] | null)[] = [[dir]]
    o.deps.files.pick = async () => picks.shift() ?? null
    await shows('私の朝')
    await click('tab-settings')
    await click('export')
    await appears('settings-message')
    expect(painted().some((line) => line.startsWith(`Saved to ${join(dir, 'kikitori-backup-')}`))).toBe(true)
    const file = readdirSync(dir).find((f) => f.startsWith('kikitori-backup-'))!
    expect(file).toMatch(/^kikitori-backup-\d{4}-\d\d-\d\d\.json$/)

    await store.deleteLesson(await lessonId('私の朝'))
    expect(await db.lessons.count()).toBe(14)
    picks.push([join(dir, file)])
    await click('restore')
    await shows('Restoring replaces everything on this device. Tap again to confirm.')
    expect(await db.lessons.count()).toBe(14) // nothing yet
    await click('confirm-restore')
    await shows('私の朝') // back, in the library
    await hides('Restoring replaces everything on this device. Tap again to confirm.')
    expect(await db.lessons.count()).toBe(15)
  })
})
