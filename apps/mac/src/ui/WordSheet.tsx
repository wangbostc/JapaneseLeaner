import { readingOf } from '@kikitori/core/scoring'
import { useEffect, useState } from 'react'
import { useApp, type WordPick } from '../context'
import { Meanings } from './Meanings'
import { PitchAccent } from './PitchAccent'
import { Button, Col, Pressable, Row, Text } from './primitives'
import { C } from './theme'
import { VoiceCredit } from './VoiceCredit'

/** A tapped word over the page: its reading, pitch and meanings, and a button to save it as a card. */
export function WordSheet({ pick, onClose }: { pick: WordPick; onClose: () => void }) {
  const { t, store, analyzer, keys, audio, settings } = useApp()
  const [saved, setSaved] = useState(false)
  const { token, lessonId, context } = pick
  const reading = readingOf(analyzer, token.lemma)
  useEffect(() => keys.subscribe((key) => key === 'escape' && onClose()), [keys, onClose])
  const save = async () => {
    await store.addCard({ lessonId, kind: 'word', front: token.lemma, reading, context })
    setSaved(true)
  }
  return (
    <Col style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable testId="sheet-backdrop" onPress={onClose} style={{ flexGrow: 1, backgroundColor: C.scrim, cursor: 'default' }} />
      <Col testId="word-sheet" style={{ gap: 12, padding: 24, backgroundColor: C.panel, borderTopWidth: 1, borderColor: C.line }}>
        <Row style={{ gap: 12, alignItems: 'flex-end' }}>
          <Text size={30} ja weight={600}>
            {token.lemma}
          </Text>
          <Text size={18} ja color={C.ruby}>
            {reading}
          </Text>
        </Row>
        {token.surface !== token.lemma && (
          <Text color={C.dim} ja>
            {`${token.surface} · ${token.pos}`}
          </Text>
        )}
        <PitchAccent word={token.lemma} reading={reading} pos={token.pos} />
        <Meanings word={token.lemma} reading={reading} />
        <Row style={{ gap: 10 }}>
          <Button testId="play-word" label={t.play} onPress={() => void audio.speak(token.lemma, settings.rate)} />
          <Button testId="save-word" label={saved ? t.saved : t.saveWord} variant="primary" onPress={save} disabled={saved} />
          <Button testId="close-sheet" label={t.back} variant="ghost" onPress={onClose} />
        </Row>
        <VoiceCredit />
      </Col>
    </Col>
  )
}
