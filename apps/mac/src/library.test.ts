import type { Lesson } from '@kikitori/core/model'
import { describe, expect, it } from 'vitest'
import { memoryPrefs } from './platform/prefs'
import { loadPlace, pageCount, partOf, savePlace, shelvesOf } from './library'

let id = 0
const lesson = (title: string, level?: string, extra: Partial<Lesson> = {}): Lesson => ({
  id: ++id,
  title,
  level,
  sentences: [],
  progress: { roundsDone: 0, lastRoundAt: null } as unknown as Lesson['progress'],
  resume: null,
  hard: [],
  createdAt: id,
  ...extra,
})

describe('library shelves', () => {
  it('shelves textbooks by name, then the starters, then the learner’s own', () => {
    const shelves = shelvesOf([
      lesson('mine 1'),
      lesson('N1 starter', 'N1', { builtIn: true }),
      lesson('G2 L13', 'Genki II · L13'),
      lesson('N5 starter', 'N5', { builtIn: true }),
      lesson('G1 L1', 'Genki I · L1'),
      lesson('mine 2', 'N3'),
    ])
    expect(shelves.map((s) => s.key)).toEqual(['book:Genki I', 'book:Genki II', 'starters', 'mine'])
    expect(shelves[2].lessons.map((l) => l.title)).toEqual(['N5 starter', 'N1 starter'])
    expect(shelves[3].lessons.map((l) => l.title)).toEqual(['mine 2', 'mine 1']) // newest first
  })

  it('orders a book by lesson number, dialogues before readings, then as added', () => {
    const [book] = shelvesOf([
      lesson('L10 会話', 'Genki I · L10'),
      lesson('L3 読み物 a', 'Genki I · L3 読み書き'),
      lesson('L3 会話 I', 'Genki I · L3'),
      lesson('L3 読み物 b', 'Genki I · L3 読み書き'),
      lesson('L3 会話 II', 'Genki I · L3'),
      lesson('あいさつ', 'Genki I · あいさつ'),
    ])
    expect(book.lessons.map((l) => l.title)).toEqual(['あいさつ', 'L3 会話 I', 'L3 会話 II', 'L3 読み物 a', 'L3 読み物 b', 'L10 会話'])
  })

  it('reads a book part', () => {
    expect(partOf('Genki II · L13 読み書き')).toEqual({ chapter: 13, reading: true, heading: 'L13' })
    expect(partOf('Genki I · あいさつ')).toEqual({ chapter: -1, reading: false, heading: 'あいさつ' })
  })

  it('counts pages and keeps the place', () => {
    expect([0, 1, 20, 21].map(pageCount)).toEqual([1, 1, 1, 2])
    const prefs = memoryPrefs()
    expect(loadPlace(prefs)).toEqual({ shelf: null, page: 0 })
    savePlace(prefs, { shelf: 'book:Genki II', page: 2 })
    expect(loadPlace(prefs)).toEqual({ shelf: 'book:Genki II', page: 2 })
    prefs.setItem('kikitori.libraryPlace', '{oops')
    expect(loadPlace(prefs)).toEqual({ shelf: null, page: 0 })
  })
})
