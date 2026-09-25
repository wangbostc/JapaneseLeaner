import { describe, expect, it } from 'vitest'
import { codeFor, trimContext } from './serverAi'

describe('trimContext', () => {
  const lesson = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(10)) // 10 sentences × 10 chars

  it('keeps everything under the limit', () => {
    expect(trimContext(lesson, lesson[5], 1000)).toEqual(lesson)
  })

  it('keeps the sentence and its nearest neighbours within the limit', () => {
    expect(trimContext(lesson, lesson[5], 30)).toEqual([lesson[4], lesson[5], lesson[6]])
    expect(trimContext(lesson, lesson[0], 30)).toEqual([lesson[0], lesson[1], lesson[2]])
    expect(trimContext(lesson, lesson[9], 25)).toEqual([lesson[8], lesson[9]])
  })
})

describe('codeFor', () => {
  it('uses the server’s code when it is one we know', () => {
    expect(codeFor(502, 'count')).toBe('count')
    expect(codeFor(400, 'tooLong')).toBe('tooLong')
    expect(codeFor(503, 'serverOff')).toBe('serverOff')
  })
  it('reads a rejected key as the server’s, and a 401 as a revoked device', () => {
    expect(codeFor(502, 'auth')).toBe('serverKey')
    expect(codeFor(401, 'unauthorized')).toBe('reconnect')
  })
  it('falls back on the status for anything else', () => {
    expect(codeFor(503, 'AI is not configured')).toBe('serverOff')
    expect(codeFor(400, 'some sentence')).toBe('invalid')
    expect(codeFor(500, undefined)).toBe('api')
  })
})
