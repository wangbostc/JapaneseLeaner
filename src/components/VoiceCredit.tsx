import { useNaturalVoices } from '../app/neuralVoice'
import { useSettings } from '../app/useSettings'
import { neuralChoice } from '../lib/speech'
import { engineCredit, isEngineVoiceId } from '../lib/voices'

/** Names the engine and character wherever an engine voice speaks (VOICEVOX's terms require it). */
export function VoiceCredit() {
  const { settings } = useSettings()
  const natural = useNaturalVoices()
  const voice = neuralChoice(settings.voiceURI)
  if (!voice || !isEngineVoiceId(voice)) return null
  const speaker = natural.engineVoices?.find((v) => v.id === voice)?.speaker
  if (!speaker) return null
  return (
    <small className="muted voice-credit" data-testid="voice-credit">
      {engineCredit(voice, speaker)}
    </small>
  )
}
