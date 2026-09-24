import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { loadAnalyzer, type Analyzer } from '../lib/tokenizer'

const require = createRequire(import.meta.url)
const dictDir = join(dirname(require.resolve('kuromoji/package.json')), 'dict')

let analyzer: Promise<Analyzer> | null = null

/** The real IPADIC analyzer, read from node_modules. */
export function testAnalyzer(): Promise<Analyzer> {
  analyzer ??= loadAnalyzer(async (file) => {
    const buf = await readFile(join(dictDir, file))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })
  return analyzer
}
