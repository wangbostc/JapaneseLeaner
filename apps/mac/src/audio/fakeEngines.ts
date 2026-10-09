import { DEFAULT_ENGINE_URLS } from '@kikitori/core/engines'
import type { EngineKind } from '@kikitori/core/voices'

type Speakers = { name: string; styles: { name: string; id: number; type?: string }[] }[]
export type FakeEngines = Partial<Record<EngineKind, Speakers>>

/**
 * A fetch standing in for AivisSpeech and VOICEVOX at their usual addresses: each engine in
 * `engines` lists its speakers and "synthesises" a few bytes; the others don't answer.
 * `made` records each synthesis as [style id, text].
 */
export function fakeEngineFetch(engines: FakeEngines) {
  const made: [string, string][] = []
  const kindOf = (url: string) => (Object.keys(DEFAULT_ENGINE_URLS) as EngineKind[]).find((k) => url.startsWith(DEFAULT_ENGINE_URLS[k]) && engines[k])
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const kind = kindOf(url.href)
    if (!kind) throw new TypeError('fetch failed')
    if (url.pathname === '/speakers') return Response.json(engines[kind])
    if (url.pathname === '/audio_query') {
      made.push([url.searchParams.get('speaker')!, url.searchParams.get('text')!])
      return Response.json({ speedScale: 1 })
    }
    return new Response(new Blob(['RIFF-fake-wav'], { type: 'audio/wav' }))
  }) as typeof globalThis.fetch
  return { fetch, made }
}
