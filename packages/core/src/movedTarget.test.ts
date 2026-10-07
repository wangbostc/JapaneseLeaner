import { describe, expect, it } from 'vitest'
import { movedTarget } from './movedTarget'

describe('movedTarget', () => {
  it('is unset for a missing or empty variable (an unset repo variable builds as "")', () => {
    expect(movedTarget(undefined)).toBeUndefined()
    expect(movedTarget('')).toBeUndefined()
    expect(movedTarget('  ')).toBeUndefined()
  })

  it('keeps an absolute https address', () => {
    expect(movedTarget('https://kikitori.example.workers.dev')).toBe('https://kikitori.example.workers.dev/')
    expect(movedTarget(' https://example.com/app/ ')).toBe('https://example.com/app/')
  })

  it('refuses a bare host, which would become a relative link under the Pages path', () => {
    expect(() => movedTarget('kikitori.example.workers.dev')).toThrow(/absolute http\(s\) URL/)
  })

  it('refuses non-http schemes', () => {
    expect(() => movedTarget('javascript:alert(1)')).toThrow(/http\(s\) URL/)
    expect(() => movedTarget('ftp://example.com')).toThrow(/http\(s\) URL/)
  })
})
