import { loadAnalyzer, type Analyzer, type DictFetcher } from '@kikitori/core/tokenizer'

export const browserDictFetcher =
  (baseUrl: string): DictFetcher =>
  async (fileName) => {
    const res = await fetch(`${baseUrl}${fileName}`)
    if (!res.ok) throw new Error(`dictionary ${fileName}: HTTP ${res.status}`)
    return res.arrayBuffer()
  }

let shared: Promise<Analyzer> | null = null

/** The app-wide analyzer, loaded once from `<base>/dict/`. */
export function getAnalyzer(): Promise<Analyzer> {
  shared ??= loadAnalyzer(browserDictFetcher(`${import.meta.env.BASE_URL}dict/`))
  shared.catch(() => (shared = null))
  return shared
}
