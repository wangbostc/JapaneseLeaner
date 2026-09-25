import { useNaturalVoices } from '../app/neuralVoice'
import { useSettings } from '../app/useSettings'
import { neuralChoice } from '../lib/speech'
import { isVoicevoxId, voicevoxCredit } from '../lib/voices'

/** VOICEVOX's terms ask for a credit naming the character wherever its audio is used. */
export function VoiceCredit() {
  const { settings } = useSettings()
  const natural = useNaturalVoices()
  const voice = neuralChoice(settings.voiceURI)
  if (!voice || !isVoicevoxId(voice)) return null
  const speaker = natural.voicevox?.find((v) => v.id === voice)?.speaker
  if (!speaker) return null
  return (
    <small className="muted voice-credit" data-testid="voice-credit">
      {voicevoxCredit(speaker)}
    </small>
  )
}
