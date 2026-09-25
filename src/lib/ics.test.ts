import { describe, expect, it } from 'vitest'
import { buildIcs, foldLine } from './ics'

const utf8 = new TextEncoder()

describe('buildIcs', () => {
  it('writes one event with an alarm, CRLF endings and UTC times', () => {
    const ics = buildIcs(
      {
        uid: 'lesson-3-round-2@kikitori',
        start: new Date(Date.UTC(2026, 8, 26, 0, 30)),
        durationMinutes: 15,
        title: 'Review 2/7: 私の朝',
        description: 'Blind, hard sentences, retell; then done',
        url: 'https://wangbostc.github.io/JapaneseLeaner/#/lesson/3',
      },
      new Date(Date.UTC(2026, 8, 25, 9, 0, 5)),
    )
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Kikitori//Review reminder//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:lesson-3-round-2@kikitori',
        'DTSTAMP:20260925T090005Z',
        'DTSTART:20260926T003000Z',
        'DTEND:20260926T004500Z',
        'SUMMARY:Review 2/7: 私の朝',
        'DESCRIPTION:Blind\\, hard sentences\\, retell\\; then done',
        'URL:https://wangbostc.github.io/JapaneseLeaner/#/lesson/3',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Review 2/7: 私の朝',
        'TRIGGER:PT0M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    )
  })
})

describe('foldLine', () => {
  it('folds at 75 octets without splitting a multibyte character', () => {
    const line = 'SUMMARY:' + '雨の日の過ごし方'.repeat(5) // 8 + 40 chars × 3 bytes = 128 octets
    const folded = foldLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBe(2)
    expect(utf8.encode(parts[0]).length).toBeLessThanOrEqual(75)
    expect(utf8.encode(parts[1]).length).toBeLessThanOrEqual(75)
    expect(parts[1].startsWith(' ')).toBe(true)
    expect(parts[0] + parts[1].slice(1)).toBe(line)
    // 8 ASCII + 22 kanji/kana = 74 octets; a 23rd character would make 77.
    expect(utf8.encode(parts[0]).length).toBe(74)
  })

  it('leaves short lines alone', () => {
    expect(foldLine('VERSION:2.0')).toBe('VERSION:2.0')
  })
})
