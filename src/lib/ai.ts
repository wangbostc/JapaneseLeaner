import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { UiLang } from './db'

/**
 * Optional AI help, called straight from the browser with the learner's own
 * Anthropic API key. Nothing in the study loop depends on it.
 */

export const AI_MODEL = 'claude-opus-5'
// On a safety decline, the API re-runs the request on a fallback model it picks by refusal category.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

const LANG_NAME: Record<UiLang, string> = { en: 'English', zh: 'Simplified Chinese' }

export function createAiClient(apiKey: string): Anthropic {
  // The key is the learner's own and already lives in this browser; there is no server to proxy through.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

export class AiRefusal extends Error {}

export function explainPrompt(sentence: string, lang: UiLang, context: string[]) {
  const system = `You are a Japanese tutor for a learner whose own language is ${LANG_NAME[lang]}. \
Explain the sentence they are studying: what it means, how its grammar works (particles, conjugations, \
set phrases), and any nuance or register worth noticing. Write in ${LANG_NAME[lang]}, keep Japanese \
examples in Japanese with readings in parentheses where helpful, and stay under 180 words. \
Use plain text with short paragraphs or "- " bullets; no Markdown headings or bold.`
  const user = `${context.length ? `Surrounding passage:\n${context.join('')}\n\n` : ''}Sentence to explain:\n${sentence}`
  return { system, user }
}

/** Streams an explanation of one sentence; `onText` receives each chunk. */
export async function explainSentence(
  client: Anthropic,
  args: { sentence: string; lang: UiLang; context?: string[]; signal?: AbortSignal; onText: (chunk: string) => void },
): Promise<void> {
  const { system, user } = explainPrompt(args.sentence, args.lang, args.context ?? [])
  const stream = client.beta.messages.stream(
    {
      model: AI_MODEL,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    },
    { signal: args.signal },
  )
  stream.on('text', args.onText)
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') throw new AiRefusal('The assistant declined to explain this sentence.')
}

const Translations = z.object({ translations: z.array(z.string()) })

export function translatePrompt(sentences: string[], lang: UiLang) {
  const system = `Translate each numbered Japanese sentence into natural ${LANG_NAME[lang]}. \
Return exactly one translation per input sentence, in the same order, as the "translations" array. \
Translate faithfully; don't merge, split, or annotate sentences.`
  const user = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')
  return { system, user }
}

/** One translation per sentence, same order; throws if the model returns a different count. */
export async function translateSentences(client: Anthropic, sentences: string[], lang: UiLang): Promise<string[]> {
  const { system, user } = translatePrompt(sentences, lang)
  // create(), not parse(): parse() throws on a refusal's empty text before
  // the stop reason can be checked, so check first and validate ourselves.
  const res = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Translations) },
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new AiRefusal('The assistant declined to translate this lesson.')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let out: string[] | undefined
  try {
    out = Translations.parse(JSON.parse(text)).translations
  } catch {
    throw new Error('the assistant returned an unreadable translation')
  }
  if (out.length !== sentences.length) throw new Error(`expected ${sentences.length} translations, got ${out.length}`)
  return out
}

/** A readable message for the common failures (bad key, rate limit, offline). */
export function describeAiError(e: unknown): string {
  if (e instanceof AiRefusal) return e.message
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Settings.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Try again in a minute.'
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the API. Are you online?'
  if (e instanceof Anthropic.APIError) return `API error: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}
