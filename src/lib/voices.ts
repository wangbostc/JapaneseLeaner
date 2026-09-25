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

/** One sentence at a time; long enough for any real sentence, short enough to bound a request. */
export const MAX_TTS_CHARS = 1000
