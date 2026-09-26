/**
 * The natural (neural) Japanese voices the server can speak with: Azure's standard ja-JP
 * neural voices, which its free tier covers. (Its "HD" voices are billed separately, so they're left out.)
 */
export const NEURAL_VOICES = [
  { id: 'ja-JP-NanamiNeural', name: 'Nanami', gender: 'female' },
  { id: 'ja-JP-KeitaNeural', name: 'Keita', gender: 'male' },
  { id: 'ja-JP-AoiNeural', name: 'Aoi', gender: 'female' },
  { id: 'ja-JP-DaichiNeural', name: 'Daichi', gender: 'male' },
  { id: 'ja-JP-MayuNeural', name: 'Mayu', gender: 'female' },
  { id: 'ja-JP-NaokiNeural', name: 'Naoki', gender: 'male' },
  { id: 'ja-JP-ShioriNeural', name: 'Shiori', gender: 'female' },
  { id: 'ja-JP-MasaruMultilingualNeural', name: 'Masaru', gender: 'male' },
] as const

export type NeuralVoice = (typeof NEURAL_VOICES)[number]
export type NeuralVoiceId = NeuralVoice['id']

export const DEFAULT_NEURAL_VOICE: NeuralVoiceId = 'ja-JP-NanamiNeural'

/** Settings store a neural voice as `neural:<id>` beside the browser's own voiceURIs. */
export const NEURAL_PREFIX = 'neural:'

export const isNeuralVoiceId = (id: string): id is NeuralVoiceId => NEURAL_VOICES.some((v) => v.id === id)

/** The neural voice a setting names, or null for a browser voice (or none). */
export function neuralVoiceOf(voiceURI: string | undefined): NeuralVoiceId | null {
  if (!voiceURI?.startsWith(NEURAL_PREFIX)) return null
  const id = voiceURI.slice(NEURAL_PREFIX.length)
  return isNeuralVoiceId(id) ? id : null
}

/**
 * Voices from open-source engines on the learner's own computer: VOICEVOX and AivisSpeech (which
 * speaks VOICEVOX's API). Stored as `<engine>:<style id>`. Clips made there are uploaded, so the
 * learner's other devices play them too.
 */
export const ENGINES = ['voicevox', 'aivis'] as const
export type EngineKind = (typeof ENGINES)[number]
export type EngineVoiceId = `${EngineKind}:${number}`
export const isEngineVoiceId = (v: string): v is EngineVoiceId => /^(voicevox|aivis):\d{1,12}$/.test(v)
export const engineOf = (id: EngineVoiceId): EngineKind => id.slice(0, id.indexOf(':')) as EngineKind
export const styleOf = (id: EngineVoiceId) => id.slice(id.indexOf(':') + 1)
export const ENGINE_NAMES: Record<EngineKind, string> = { voicevox: 'VOICEVOX', aivis: 'AivisSpeech' }

/**
 * Defaults, best first: AivisSpeech's まお (ノーマル), then VOICEVOX's 青山龍星 (ノーマル). The
 * learner picked these by ear over VOICEVOX's No.7, the first default.
 */
export const DEFAULT_ENGINE_VOICES: readonly EngineVoiceId[] = ['aivis:888753760', 'voicevox:13']

/** A voice other than the device's own: an Azure neural voice, or an engine style. */
export type NaturalVoiceId = NeuralVoiceId | EngineVoiceId

/** The natural voice a setting names, or null for a device voice (or none). */
export function naturalVoiceOf(voiceURI: string | undefined): NaturalVoiceId | null {
  if (voiceURI && isEngineVoiceId(voiceURI)) return voiceURI
  return neuralVoiceOf(voiceURI)
}

/** An engine voice with a display name; `speaker` is the character, which the credit names. */
export interface EngineVoice {
  id: EngineVoiceId
  name: string
  speaker: string
}

/**
 * "VOICEVOX:<character>" (VOICEVOX's terms require it) or "AivisSpeech:<character>" (its model
 * licence, ACML 1.0, makes credit optional; shown anyway, so every voice is attributed).
 */
export const engineCredit = (id: EngineVoiceId, speaker: string) => `${ENGINE_NAMES[engineOf(id)]}:${speaker}`

/** One sentence at a time; long enough for any real sentence, short enough to bound a request. */
export const MAX_TTS_CHARS = 1000
