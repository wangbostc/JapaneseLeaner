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
 * VOICEVOX (open-source Japanese TTS) voices, stored as `voicevox:<style id>`. The engine runs on the
 * learner's own computer; clips made there are uploaded, so their other devices play them too.
 */
export const VOICEVOX_PREFIX = 'voicevox:'
export type VoicevoxVoiceId = `voicevox:${number}`
export const isVoicevoxId = (v: string): v is VoicevoxVoiceId => /^voicevox:\d{1,6}$/.test(v)
/** No.7「アナウンス」: a clear announcer's voice, a good default for listening practice. */
export const DEFAULT_VOICEVOX_VOICE: VoicevoxVoiceId = 'voicevox:30'

/** A voice other than the device's own: an Azure neural voice, or a VOICEVOX style. */
export type NaturalVoiceId = NeuralVoiceId | VoicevoxVoiceId

/** The natural voice a setting names, or null for a device voice (or none). */
export function naturalVoiceOf(voiceURI: string | undefined): NaturalVoiceId | null {
  if (voiceURI && isVoicevoxId(voiceURI)) return voiceURI
  return neuralVoiceOf(voiceURI)
}

/** A VOICEVOX voice with a display name; `speaker` is the character, which the credit must name. */
export interface VoicevoxVoice {
  id: VoicevoxVoiceId
  name: string
  speaker: string
}

/** VOICEVOX's terms ask for a credit naming the character wherever its audio is used. */
export const voicevoxCredit = (speaker: string) => `VOICEVOX:${speaker}`

/** One sentence at a time; long enough for any real sentence, short enough to bound a request. */
export const MAX_TTS_CHARS = 1000
