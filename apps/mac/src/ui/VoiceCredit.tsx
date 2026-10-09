import { engineCredit } from '@kikitori/core/voices'
import { useApp } from '../context'
import { Text } from './primitives'
import { C } from './theme'

/** "VOICEVOX:<character>" wherever an engine voice can speak (VOICEVOX's terms require it). */
export function VoiceCredit() {
  const { settings } = useApp()
  if (!settings.voiceURI || !settings.voiceSpeaker) return null
  return (
    <Text testId="voice-credit" size={12} color={C.dim}>
      {engineCredit(settings.voiceURI, settings.voiceSpeaker)}
    </Text>
  )
}
