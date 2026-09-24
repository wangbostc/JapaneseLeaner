import DictionaryLoader from 'kuromoji/src/loader/DictionaryLoader'
import Tokenizer from 'kuromoji/src/Tokenizer'
import { toHiragana } from './kana'

export interface Token {
  surface: string
  /** Hiragana reading; falls back to the surface for unknown words. */
  reading: string
  /** Dictionary form, e.g. 食べ → 食べる. */
  lemma: string
  pos: string
  posDetail: string
}

export interface Analyzer {
  tokenize(text: string): Token[]
}

/** Returns the raw bytes of one dictionary file, e.g. `base.dat.gz`. */
export type DictFetcher = (fileName: string) => Promise<ArrayBuffer>

async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buffer, 0, 2)
  // Servers that send Content-Encoding: gzip hand us already-inflated bytes.
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

export const browserDictFetcher =
  (baseUrl: string): DictFetcher =>
  async (fileName) => {
    const res = await fetch(`${baseUrl}${fileName}`)
    if (!res.ok) throw new Error(`dictionary ${fileName}: HTTP ${res.status}`)
    return res.arrayBuffer()
  }

export function loadAnalyzer(fetchDict: DictFetcher): Promise<Analyzer> {
  const loader = new DictionaryLoader('dict')
  // DictionaryLoader#load calls this detached from the instance.
  loader.loadArrayBuffer = (url, callback) => {
    const fileName = url.split('/').pop()!
    fetchDict(fileName)
      .then(gunzipIfNeeded)
      .then((buf) => callback(null, buf), (err) => callback(err, null))
  }
  return new Promise((resolve, reject) => {
    loader.load((err, dic) => {
      if (err) return reject(err instanceof Error ? err : new Error(String(err)))
      const tokenizer = new Tokenizer(dic)
      resolve({
        tokenize: (text) =>
          tokenizer.tokenize(text).map((t) => ({
            surface: t.surface_form,
            reading: t.reading && t.reading !== '*' ? toHiragana(t.reading) : toHiragana(t.surface_form),
            lemma: t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form,
            pos: t.pos,
            posDetail: t.pos_detail_1,
          })),
      })
    })
  })
}

let shared: Promise<Analyzer> | null = null

/** The app-wide analyzer, loaded once from `<base>/dict/`. */
export function getAnalyzer(): Promise<Analyzer> {
  shared ??= loadAnalyzer(browserDictFetcher(`${import.meta.env.BASE_URL}dict/`))
  shared.catch(() => (shared = null))
  return shared
}
