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

/** Failure kinds the UI translates; see `aiErrors` in i18n. */
export type AiErrorCode = 'refusal' | 'tooLong' | 'unreadable' | 'count' | 'auth' | 'rateLimit' | 'offline' | 'api' | 'unknown'

export class AiError extends Error {
  code: AiErrorCode
  constructor(code: AiErrorCode, detail: string = code) {
    super(detail)
    this.code = code
  }
}

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
  if (final.stop_reason === 'refusal') throw new AiError('refusal')
  if (final.stop_reason === 'max_tokens') throw new AiError('tooLong')
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
  if (res.stop_reason === 'refusal') throw new AiError('refusal')
  if (res.stop_reason === 'max_tokens') throw new AiError('tooLong')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let out: string[] | undefined
  try {
    out = Translations.parse(JSON.parse(text)).translations
  } catch {
    throw new AiError('unreadable')
  }
  if (out.length !== sentences.length) throw new AiError('count', `expected ${sentences.length} translations, got ${out.length}`)
  return out
}

/** Classifies a failure so the UI can explain it in the learner's language. */
export function aiErrorCode(e: unknown): AiErrorCode {
  if (e instanceof AiError) return e.code
  if (e instanceof Anthropic.AuthenticationError) return 'auth'
  if (e instanceof Anthropic.RateLimitError) return 'rateLimit'
  if (e instanceof Anthropic.APIConnectionError) return 'offline'
  if (e instanceof Anthropic.APIError) return 'api'
  return 'unknown'
}
