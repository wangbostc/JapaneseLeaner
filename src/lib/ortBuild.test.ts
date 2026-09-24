import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickAsyncifyBuild } from './ortBuild'

const SAFARI_18_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const SAFARI_26 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

describe('pickAsyncifyBuild', () => {
  it('uses the plain build on Safari below 26 without WebGPU, like transformers.js', () => {
    expect(pickAsyncifyBuild({ userAgent: SAFARI_18_IOS, vendor: 'Apple Computer, Inc.' })).toBe(false)
  })

  it('uses asyncify everywhere else', () => {
    expect(pickAsyncifyBuild({ userAgent: SAFARI_18_IOS, vendor: 'Apple Computer, Inc.', gpu: {} })).toBe(true)
    expect(pickAsyncifyBuild({ userAgent: SAFARI_26, vendor: 'Apple Computer, Inc.' })).toBe(true)
    expect(pickAsyncifyBuild({ userAgent: CHROME_IOS, vendor: 'Apple Computer, Inc.' })).toBe(true)
    expect(pickAsyncifyBuild({ userAgent: CHROME, vendor: 'Google Inc.' })).toBe(true)
  })
})

describe('onnxruntime-web pin', () => {
  it('matches the version transformers.js was built against', () => {
    // The worker loads its wasm from our pinned copy; a mismatch with the JS inside transformers.js breaks at runtime.
    const require = createRequire(import.meta.url)
    const ours = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')).dependencies['onnxruntime-web']
    const transformersDir = dirname(dirname(require.resolve('@huggingface/transformers')))
    const theirs = JSON.parse(readFileSync(join(transformersDir, 'package.json'), 'utf8')).dependencies['onnxruntime-web']
    expect(ours).toBe(theirs)
  })
})
