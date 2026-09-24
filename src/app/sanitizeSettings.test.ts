import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from './sanitizeSettings'

describe('sanitizeSettings', () => {
  it('keeps valid known settings', () => {
    expect(sanitizeSettings({ lang: 'zh', furigana: false, translation: true, rate: 0.8, voiceURI: 'x' })).toEqual({
      lang: 'zh',
      furigana: false,
      translation: true,
      rate: 0.8,
      voiceURI: 'x',
    })
  })

  it('drops unknown languages, bad types and unknown keys', () => {
    expect(sanitizeSettings({ lang: 'ja', furigana: 'yes', rate: 'fast', evil: 1, __proto__: { lang: 'en' } })).toEqual({})
    expect(sanitizeSettings({ lang: 'toString' })).toEqual({})
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('en')).toEqual({})
  })

  it('clamps the playback rate', () => {
    expect(sanitizeSettings({ rate: 9 })).toEqual({ rate: 2 })
    expect(sanitizeSettings({ rate: Infinity })).toEqual({})
  })
})
