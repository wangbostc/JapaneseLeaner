import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STRINGS } from '../app/i18n'
import { SettingsContext, type Settings } from '../app/useSettings'
import { MovedBanner } from './MovedBanner'

const settings: Settings = { lang: 'en', furigana: true, translation: true, chunks: false, rate: 1 }
const render = (to?: string, lang: Settings['lang'] = 'en') =>
  renderToString(
    <SettingsContext.Provider value={{ settings: { ...settings, lang }, update: () => {}, t: STRINGS[lang] }}>
      <MovedBanner to={to} />
    </SettingsContext.Provider>,
  )

describe('MovedBanner', () => {
  it('renders nothing when the app has not moved (the default build: no VITE_MOVED_TO)', () => {
    expect(render()).toBe('')
  })

  it('points at the new address and offers the backup export, as a labelled region', () => {
    const html = render('https://kikitori.example.workers.dev/')
    expect(html).toContain('href="https://kikitori.example.workers.dev/"')
    expect(html).toContain(STRINGS.en.movedTitle)
    expect(html).toContain(STRINGS.en.movedExport)
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"[\s\S]*<strong id="\1"/)
    expect(html).not.toContain('role="alert"') // no error until an export fails
  })

  it('speaks the learner’s UI language', () => {
    expect(render('https://example.com/', 'zh')).toContain(STRINGS.zh.movedOpen)
  })
})
