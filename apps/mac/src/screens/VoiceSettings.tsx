import { useEffect, useState } from 'react'
import { DEFAULT_ENGINE_VOICES, ENGINE_NAMES, engineOf, type EngineKind, type EngineVoice } from '@kikitori/core/voices'
import { useApp } from '../context'
import { Choice, Field } from '../ui/form'
import { Button, Col, Pressable, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { VoiceCredit } from '../ui/VoiceCredit'

type Found = { voices: EngineVoice[]; up: EngineKind[] }

/** The style in a voice's name: "まお（ノーマル）" → "ノーマル". */
const styleName = (v: EngineVoice) => v.name.slice(v.speaker.length + 1, -1) || v.name

/** Settings → Japanese voice: the Mac's own, or an AivisSpeech or VOICEVOX voice on this Mac. */
export function VoiceSettings() {
  const { t, settings, updateSettings, voices, audio } = useApp()
  const [found, setFound] = useState<Found | null>(null)
  const [checks, setChecks] = useState(0)
  // Asked again when the app names the chosen voice: its engine has started meanwhile.
  useEffect(() => {
    let live = true
    voices.probe().then((f) => live && setFound(f))
    return () => {
      live = false
    }
  }, [voices, checks, settings.voiceSpeaker])
  const checkAgain = () => {
    setFound(null)
    setChecks((n) => n + 1)
  }

  const engine = settings.voiceURI ? engineOf(settings.voiceURI) : null
  const ofEngine = found?.voices.filter((v) => engineOf(v.id) === engine) ?? []
  const current = ofEngine.find((v) => v.id === settings.voiceURI)
  const choose = (v: EngineVoice) => updateSettings({ voiceURI: v.id, voiceSpeaker: v.speaker })
  // A voice chosen while its engine was closed is named once the engine answers.
  const speaker = current?.speaker
  useEffect(() => {
    if (speaker && speaker !== settings.voiceSpeaker) updateSettings({ voiceSpeaker: speaker })
  }, [speaker, settings.voiceSpeaker, updateSettings])
  const chooseEngine = (kind: EngineKind | 'mac') => {
    if (kind === 'mac') return updateSettings({ voiceURI: undefined, voiceSpeaker: undefined })
    if (kind === engine) return
    const running = found?.voices.filter((v) => engineOf(v.id) === kind) ?? []
    const best = DEFAULT_ENGINE_VOICES.map((id) => running.find((v) => v.id === id)).find(Boolean) ?? running[0]
    // Not running: its default voice, named once the engine answers.
    if (best) choose(best)
    else updateSettings({ voiceURI: DEFAULT_ENGINE_VOICES.find((id) => engineOf(id) === kind), voiceSpeaker: undefined })
  }
  // The engine's characters in its own order, each with its styles.
  const speakers = [...new Set(ofEngine.map((v) => v.speaker))]
  const styles = current ? ofEngine.filter((v) => v.speaker === current.speaker) : []

  return (
    <Field label={t.settingsVoice} hint={t.macVoiceHint}>
      <Choice
        testId="voice"
        value={engine ?? 'mac'}
        onChange={chooseEngine}
        options={[
          ['mac', t.macVoiceOwn],
          ['aivis', ENGINE_NAMES.aivis],
          ['voicevox', ENGINE_NAMES.voicevox],
        ]}
      />
      {engine && (
        <Col style={{ gap: 10 }}>
          {!found ? (
            <Text testId="engine-status" color={C.dim}>
              {t.voicevoxChecking}
            </Text>
          ) : found.up.includes(engine) ? (
            <Col style={{ gap: 6 }}>
              <Text testId="engine-status" color={C.good}>
                {t.macEngineRunning(ENGINE_NAMES[engine], ofEngine.length)}
              </Text>
              {/* From a backup, or a model since removed: the Mac's own voice speaks meanwhile. */}
              {!current && (
                <Text testId="voice-missing" color={C.danger}>
                  {t.macVoiceNotInstalled(ENGINE_NAMES[engine])}
                </Text>
              )}
            </Col>
          ) : (
            <Col style={{ gap: 6 }}>
              <Text testId="engine-status" color={C.danger}>
                {t.macEngineMissing(ENGINE_NAMES[engine], voices.urls[engine])}
              </Text>
              <Row>
                <Button testId="engine-check" label={t.macCheckAgain} variant="ghost" onPress={checkAgain} />
              </Row>
            </Col>
          )}
          {speakers.length > 0 && (
            <Row testId="speakers" style={{ gap: 6, flexWrap: 'wrap' }}>
              {speakers.map((name) => (
                <Pressable
                  key={name}
                  testId={`speaker-${name}`}
                  onPress={() => name !== current?.speaker && choose(ofEngine.find((v) => v.speaker === name)!)}
                  style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 7, backgroundColor: name === current?.speaker ? C.raised : C.panel }}
                  hover={{ backgroundColor: C.hover }}
                >
                  <Text ja color={name === current?.speaker ? C.text : C.dim} weight={name === current?.speaker ? 600 : 400}>
                    {name}
                  </Text>
                </Pressable>
              ))}
            </Row>
          )}
          {styles.length > 1 && (
            <Choice testId="style" value={current!.id} onChange={(id) => choose(styles.find((v) => v.id === id)!)} options={styles.map((v): [string, string] => [v.id, styleName(v)])} />
          )}
        </Col>
      )}
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Button testId="voice-try" label={t.voicePreview} variant="ghost" onPress={() => void audio.speak(t.voiceSample, settings.rate)} />
        <VoiceCredit />
      </Row>
    </Field>
  )
}
