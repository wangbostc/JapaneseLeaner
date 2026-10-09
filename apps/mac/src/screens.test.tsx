import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_WORDS, coreRank } from '@kikitori/core/coreWords'
import { formatDuration, STRINGS } from '@kikitori/core/i18n'
import { hasNativeTestRenderer } from '@gpuix/react/testing'
import { describe, expect, it } from 'vitest'
import type { FakeEngines } from './audio/fakeEngines'
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
    // Its example sentence, with its translation and source; played in the chosen voice.
    await shows('I get up at six every morning.')
    await shows('Tatoeba #1234')
    await click('play-example-0')
    await expect.poll(() => o.audio.spoken).toContain('毎朝六時に起きます。')
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

  it('introduces the day’s core words in Cards, most frequent first, and the setting turns them off', { timeout: 30000 }, async () => {
    const o = await open({ newWordsPerDay: 10 })
    const { click, shows, appears, db, prefs } = o
    await shows('私の朝')
    await click('tab-cards')
    await appears('flashcard')
    await shows('Core 3,500 · #1')
    await shows('1 of 10')
    await click('show-answer')
    await click('grade-3')
    await shows('Core 3,500 · #2')
    expect((await db.cards.all()).filter((c) => c.uid?.startsWith('core:'))).toHaveLength(10)
    await click('tab-settings')
    await click('new-words-0')
    expect(JSON.parse(prefs.getItem('kikitori.settings')!)).toMatchObject({ newWordsPerDay: 0 })
  })

  it('reviews cards by keyboard, and undoes a grade', { timeout: 30000 }, async () => {
    const o = await open({ newWordsPerDay: 10 })
    const { click, shows, appears, painted, db, deps } = o
    await shows('私の朝')
    await click('tab-cards')
    await shows('Core 3,500 · #1')
    await shows(STRINGS.en.cardKeys)
    const first = (await db.cards.all()).find((c) => coreRank(c) === 1)!
    deps.keys.emit('3') // nothing before the answer
    deps.keys.emit('space')
    await appears('card-back')
    deps.keys.emit('3') // Good
    deps.keys.emit('3') // still grading: not the next card too
    await shows('Core 3,500 · #2')
    await shows('2 of 10')
    expect((await db.cards.get(first.id!))!.card.reps).toBe(1)
    await appears('undo')
    deps.keys.emit('u')
    await shows(STRINGS.en.undone)
    await shows('Core 3,500 · #1')
    await shows('1 of 10')
    expect(painted()).not.toContain('Core 3,500 · #2')
    expect((await db.cards.get(first.id!))!.card).toEqual(first.card)
    expect(await o.app.getByTestId('undo').count()).toBe(0) // nothing left to undo
    // And by its button, from the end of the session.
    for (let n = 1; n <= 10; n++) {
      deps.keys.emit('space')
      await appears('card-back')
      deps.keys.emit('3')
      await shows(n < 10 ? `${n + 1} of 10` : 'All caught up.')
    }
    await click('undo')
    await shows('Core 3,500 · #10')
    await shows('10 of 10')
  })

  it('reviews by listening: the word is hidden, and played, until the answer', { timeout: 30000 }, async () => {
    const o = await open({ newWordsPerDay: 10, settings: { cardMode: 'listen' } })
    const { click, shows, appears, painted, audio, deps } = o
    const [word] = CORE_WORDS[0]
    await click('tab-cards')
    await appears('card-prompt')
    await shows(STRINGS.en.listenPrompt)
    await shows('Core 3,500 · #1') // the label stays
    expect(painted()).not.toContain(word)
    await expect.poll(() => audio.spoken).toEqual([word])
    await click('play-card')
    await expect.poll(() => audio.spoken).toEqual([word, word])
    deps.keys.emit('space')
    await appears('card-back')
    await shows(word)
    expect(await o.app.getByTestId('card-prompt').count()).toBe(0)
  })

  it('reviews by recall: the meaning first, the Japanese (and its sound) with the answer', { timeout: 30000 }, async () => {
    const o = await open({ settings: { cardMode: 'recall' } })
    const { click, shows, appears, painted, store, deps, lessonId } = o
    await shows('私の朝')
    await store.addCard({ lessonId: await lessonId('私の朝'), kind: 'word', front: '毎朝', reading: 'まいあさ', context: '私は毎朝六時に起きます。' })
    await click('tab-cards')
    await appears('card-prompt')
    await shows(STRINGS.en.recallPrompt)
    await shows('1. every morning')
    expect(painted()).not.toContain('毎朝')
    expect(painted()).not.toContain('まいあさ')
    expect(await o.app.getByTestId('play-card').count()).toBe(0)
    deps.keys.emit('r') // playing it would answer it
    deps.keys.emit('space')
    await shows('毎朝')
    await shows('1. every morning · noun, adverb')
    await appears('play-card')
    expect(o.audio.spoken).toEqual([])
    deps.keys.emit('r')
    await expect.poll(() => o.audio.spoken).toEqual(['毎朝'])
  })

  it('keeps the review mode chosen in Cards, and mixes modes card by card', { timeout: 30000 }, async () => {
    const o = await open({ newWordsPerDay: 10 })
    const { click, shows, appears, prefs, deps } = o
    await click('tab-cards')
    await shows(STRINGS.en.cardModeHint)
    await click('card-mode-recall')
    expect(JSON.parse(prefs.getItem('kikitori.settings')!)).toMatchObject({ cardMode: 'recall' })
    await shows('Core 3,500 · #1') // no meanings for it (not in the test dictionary): read
    await click('card-mode-mix')
    expect(JSON.parse(prefs.getItem('kikitori.settings')!)).toMatchObject({ cardMode: 'mix' })
    for (let n = 1; n <= 4; n++) {
      await shows(`Core 3,500 · #${n}`)
      deps.keys.emit('space')
      await appears('card-back')
      await shows(CORE_WORDS[n - 1][0])
      deps.keys.emit('3')
      await shows(`${n + 1} of 10`)
    }
  })

  it('browses all cards from Cards: filters, search, and a suspended card left out of review until resumed', { timeout: 30000 }, async () => {
    const o = await open({ newWordsPerDay: 10 })
    const { app, click, shows, appears, db, deps } = o
    await click('tab-cards')
    await shows('1 of 10')
    await click('all-cards')
    await appears('card-search')
    await shows(STRINGS.en.allCards)
    await shows('10 cards')
    const cards = await db.cards.all()
    const byRank = (rank: number) => cards.find((c) => coreRank(c) === rank)!.id!
    for (const c of cards) await appears(`card-row-${c.id}`)
    await shows('Core 3,500 · #6')
    await shows('ひと') // 人's reading, which differs from it
    await shows(STRINGS.en.newCard)

    // Search folds katakana, and filters combine with it.
    await app.getByTestId('card-search').fill('スル')
    await shows('1 card')
    expect(await app.getByTestId(`card-row-${byRank(1)}`).count()).toBe(1)
    expect(await app.getByTestId(`card-row-${byRank(2)}`).count()).toBe(0)
    await click('card-filter-saved')
    await shows('0 cards')
    await shows(STRINGS.en.noMatchingCards)
    await app.getByTestId('card-search').fill('')
    await shows('0 cards') // no saved cards
    await click('card-filter-core')
    await shows('10 cards')

    // Suspended: out of the due filter, and out of review.
    await click('card-filter-due')
    await shows('10 cards')
    await click(`card-row-${byRank(1)}`)
    await click(`suspend-${byRank(1)}`)
    await shows('9 cards')
    expect(await app.getByTestId(`card-row-${byRank(1)}`).count()).toBe(0)
    expect((await db.cards.get(byRank(1)))!.suspendedAt).toBeGreaterThan(0)
    await click('card-filter-suspended')
    await shows('1 card')
    expect(await app.getByTestId(`card-row-${byRank(1)}`).textContent()).toContain(STRINGS.en.suspended)

    // The review's keys don't reach the browser.
    const before = await db.cards.all()
    deps.keys.emit('space')
    deps.keys.emit('3')
    deps.keys.emit('u')
    deps.keys.emit('1')
    await app.getByTestId('card-search').fill('3 ')
    await shows(STRINGS.en.noMatchingCards)
    expect(await db.cards.all()).toEqual(before)
    expect(await app.getByTestId('card-back').count()).toBe(0)
    expect(await app.getByTestId('undo').count()).toBe(0)
    await app.getByTestId('card-search').fill('')

    await click('back-to-cards')
    await shows('1 of 9')
    await shows('Core 3,500 · #2')
    await click('tab-today')
    await shows('9 cards to review')

    // Resumed: due again.
    await click('tab-cards')
    await click('all-cards')
    await click('card-filter-suspended')
    await click(`card-row-${byRank(1)}`)
    await shows(STRINGS.en.resume)
    await click(`suspend-${byRank(1)}`)
    await shows(STRINGS.en.noMatchingCards)
    expect((await db.cards.get(byRank(1)))!.suspendedAt).toBeUndefined()
    await click('back-to-cards')
    await shows('1 of 10')
    await shows('Core 3,500 · #1')
  })

  it('edits and deletes cards in the browser, keeping a core word’s spelling', { timeout: 30000 }, async () => {
    const o = await open({ newWordsPerDay: 10 })
    const { app, click, shows, hides, appears, db, store, lessonId } = o
    await shows('私の朝')
    const saved = await store.addCard({ lessonId: await lessonId('私の朝'), kind: 'word', front: '毎朝', reading: 'まいあさ', context: '私は毎朝六時に起きます。' })
    await click('tab-cards')
    await shows('1 of 11')
    await click('all-cards')
    await shows('11 cards')
    await click('card-filter-saved')
    await shows('1 card')
    await app.getByTestId('card-search').fill('六時') // its sentence
    await shows('1 card')

    // Edit its reading; Cancel keeps what was there.
    await click(`card-row-${saved}`)
    await click(`edit-${saved}`)
    await appears('edit-reading')
    await app.getByTestId('edit-reading').fill('まいちょう')
    await click('save-card')
    await appears(`edit-${saved}`) // saved, and closed
    await shows('まいちょう')
    expect((await db.cards.get(saved))!).toMatchObject({ front: '毎朝', reading: 'まいちょう', context: '私は毎朝六時に起きます。' })
    await click(`edit-${saved}`)
    await app.getByTestId('edit-reading').fill('まいあさ')
    await click('cancel-edit')
    await appears(`edit-${saved}`)
    expect((await db.cards.get(saved))!.reading).toBe('まいちょう')

    // A core word's spelling can't change; its reading can.
    await app.getByTestId('card-search').fill('')
    await click('card-filter-core')
    const core = (await db.cards.all()).find((c) => coreRank(c) === 6)!
    await click(`card-row-${core.id}`)
    await click(`edit-${core.id}`)
    await shows(STRINGS.en.coreFrontFixed)
    await app.getByTestId('edit-front').fill('大人')
    await app.getByTestId('edit-reading').fill('ヒト')
    await shows('ヒト')
    expect(o.painted()).not.toContain('大人')
    await click('save-card')
    await appears(`edit-${core.id}`)
    await shows('ヒト')
    expect((await db.cards.get(core.id!))!).toMatchObject({ front: '人', reading: 'ヒト' })

    // Deleting takes a second press; a core word says it won't come back.
    await click(`delete-${core.id}`)
    await shows(STRINGS.en.confirmDeleteCard)
    await shows(STRINGS.en.coreDeleteNote)
    expect(await db.cards.get(core.id!)).toBeDefined()
    await click(`card-row-${core.id}`) // closed: no longer confirming
    await hides(STRINGS.en.coreDeleteNote)
    await click('card-filter-saved')
    await click(`card-row-${saved}`)
    await click(`delete-${saved}`)
    await shows(STRINGS.en.confirmDeleteCard)
    await hides(STRINGS.en.coreDeleteNote) // a saved card's
    expect(await db.cards.get(saved)).toBeDefined()
    await click(`delete-${saved}`)
    await shows(STRINGS.en.noMatchingCards)
    expect(await db.cards.get(saved)).toBeUndefined()
    await click('card-filter-all')
    await shows('10 cards')
  })

  it('shows a hundred cards at a time', { timeout: 30000 }, async () => {
    const o = await open()
    const { click, shows, hides, appears, store } = o
    for (let n = 0; n < 130; n++) await store.addCard({ lessonId: 0, kind: 'word', front: `語${n}`, reading: `ご${n}`, context: '' })
    await click('tab-cards')
    await click('all-cards')
    await shows('130 cards')
    await appears('show-more')
    await shows(STRINGS.en.showMoreCards(30))
    await shows('語99')
    expect(o.painted()).not.toContain('語100')
    await click('show-more')
    await hides(STRINGS.en.showMoreCards(30))
    await shows('語129')
  })

  it('speaks in an AivisSpeech or VOICEVOX voice chosen in Settings, credited, and in the Mac’s own when chosen back', { timeout: 30000 }, async () => {
    const engines = {
      aivis: [{ name: 'まお', styles: [{ name: 'ノーマル', id: 888753760 }, { name: 'おちつき', id: 888753763 }] }],
      voicevox: [
        { name: '青山龍星', styles: [{ name: 'ノーマル', id: 13 }] },
        { name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }, { name: 'ハミング', id: 3001, type: 'humming' }] },
      ],
    }
    const o = await open({ engines })
    const { click, shows, hides, prefs, audio, engine, dir, lessonId } = o
    await click('tab-settings')
    await click('voice-aivis')
    await shows('AivisSpeech is running: 2 voices.')
    await shows('AivisSpeech:まお') // the default, credited
    await click('style-aivis:888753763')
    await click('voice-try')
    await expect.poll(() => audio.played.length).toBe(1)
    expect(audio.played[0].path.startsWith(join(dir, 'voices', 'aivis-888753763-'))).toBe(true)
    expect(engine.made).toEqual([['888753763', STRINGS.en.voiceSample]])

    await click('voice-voicevox')
    await shows('VOICEVOX:青山龍星')
    await click('speaker-ずんだもん')
    await shows('VOICEVOX:ずんだもん')
    await hides('ハミング') // not a talking voice
    expect(JSON.parse(prefs.getItem('kikitori.settings')!)).toMatchObject({ voiceURI: 'voicevox:3', voiceSpeaker: 'ずんだもん' })

    // A lesson without audio is read aloud in it, credited.
    await click('tab-library')
    await click(`lesson-${await lessonId('私の朝')}`)
    await shows('VOICEVOX:ずんだもん')

    await click('tab-settings')
    await click('voice-mac')
    await hides('VOICEVOX:ずんだもん')
    await click('voice-try')
    await expect.poll(() => audio.spoken).toEqual([STRINGS.en.voiceSample])
    expect(JSON.parse(prefs.getItem('kikitori.settings')!).voiceURI).toBeUndefined()
  })

  it('says when the chosen engine isn’t running, and finds it once it is', { timeout: 30000 }, async () => {
    const engines: FakeEngines = {}
    const o = await open({ engines })
    const { click, shows, audio } = o
    await click('tab-settings')
    await click('voice-voicevox')
    await shows(STRINGS.en.macEngineMissing('VOICEVOX', 'http://127.0.0.1:50021'))
    await click('voice-try')
    await expect.poll(() => audio.spoken).toEqual([STRINGS.en.voiceSample]) // the Mac's own voice meanwhile
    engines.voicevox = [{ name: '青山龍星', styles: [{ name: 'ノーマル', id: 13 }] }]
    await click('engine-check')
    await shows('VOICEVOX is running: 1 voice.')
    await shows('VOICEVOX:青山龍星') // named now that the engine answers
    await click('voice-try')
    await expect.poll(() => audio.played.length).toBe(1) // and speaking in it, credited
  })

  it('names a voice restored without its character by asking its engine, then speaks in it', { timeout: 30000 }, async () => {
    const o = await open({ engines: { voicevox: [{ name: '青山龍星', styles: [{ name: 'ノーマル', id: 13 }] }] }, settings: { voiceURI: 'voicevox:13' } })
    const { click, shows, lessonId, prefs } = o
    await click('tab-library')
    await click(`lesson-${await lessonId('私の朝')}`)
    await shows('VOICEVOX:青山龍星') // without opening Settings
    expect(JSON.parse(prefs.getItem('kikitori.settings')!)).toMatchObject({ voiceURI: 'voicevox:13', voiceSpeaker: '青山龍星' })
  })

  it('says when the chosen voice isn’t installed in the running engine', { timeout: 30000 }, async () => {
    const o = await open({ engines: { aivis: [{ name: 'コハク', styles: [{ name: 'ノーマル', id: 1 }] }] }, settings: { voiceURI: 'aivis:888753760' } })
    await o.click('tab-settings')
    await o.shows(STRINGS.en.macVoiceNotInstalled('AivisSpeech'))
    await o.click('speaker-コハク')
    await o.hides(STRINGS.en.macVoiceNotInstalled('AivisSpeech'))
    await o.shows('AivisSpeech:コハク')
  })
})
