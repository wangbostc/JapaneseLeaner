import type { Sentence } from '@kikitori/core/model'
import { parseTranscript } from '@kikitori/core/subtitles'
import { basename } from 'node:path'
import { useMemo, useState } from 'react'
import { useApp } from '../context'
import { placeOf, savePlace } from '../library'
import { audioTypeOf } from '../platform/media'
import { Field, TextArea, TextField } from '../ui/form'
import { Button, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'

const TRANSCRIPT = /\.(srt|vtt|lrc|txt)$/i

export function Import() {
  const { t, settings, store, db, prefs, files, navigate } = useApp()
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('')
  const [audio, setAudio] = useState<{ path: string; type: string } | null>(null)
  const [transcript, setTranscript] = useState('')
  const [transcriptName, setTranscriptName] = useState('pasted.txt')
  const [translation, setTranslation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // As in the web app: cues from the transcript, translation lines matched by position.
  const sentences: Sentence[] = useMemo(() => {
    const lines = translation.split(/\r?\n/).map((l) => l.trim())
    return parseTranscript(transcriptName, transcript).map((cue, i) => ({ ...cue, translations: lines[i] ? { [settings.lang]: lines[i] } : undefined }))
  }, [transcript, transcriptName, translation, settings.lang])
  const timed = sentences.length > 0 && sentences.every((s) => s.start !== null)
  const valid = Boolean(title.trim()) && sentences.length > 0 && (!audio || timed)

  /** A picked or dropped file: audio, or a transcript (by its extension). */
  const take = async (path: string) => {
    setError(null)
    if (TRANSCRIPT.test(path)) {
      setTranscriptName(basename(path))
      setTranscript(await files.readText(path))
      if (!title) setTitle(basename(path).replace(/\.[^.]+$/, ''))
      return
    }
    const type = audioTypeOf(path)
    if (!type) return setError(t.macNotAudio)
    setAudio({ path, type })
  }
  const pick = async () => {
    const paths = await files.pick()
    if (paths?.[0]) await take(paths[0])
  }

  const create = async () => {
    if (busy || !valid) return
    setBusy(true)
    setError(null)
    try {
      const media = audio ? await files.readBlob(audio.path, audio.type) : undefined
      const id = await store.createLesson({ title: title.trim(), level: level.trim() || undefined, sentences, media })
      // Back in the library, it's on screen: its shelf, its page.
      savePlace(prefs, placeOf(await db.lessons.all(), id))
      navigate({ name: 'lesson', id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      onFileDrop={(e) => {
        const path = e.paths?.[0]
        if (path) void take(path)
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Button testId="back" label={`‹ ${t.navLibrary}`} variant="ghost" onPress={() => navigate({ name: 'library' })} />
        <Text size={28} weight={700}>
          {t.importTitle}
        </Text>
      </Row>
      <Field label={t.fieldTitle}>
        <TextField testId="title" value={title} onChange={setTitle} />
      </Field>
      <Field label={t.fieldLevel}>
        <TextField testId="level" value={level} onChange={setLevel} placeholder="N5 – N1" />
      </Field>
      <Field label={t.fieldAudio} hint={t.fieldAudioHint}>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <Button testId="choose-audio" label={t.macChooseAudio} onPress={() => void pick()} />
          {audio ? (
            <>
              <Text testId="audio-name">{basename(audio.path)}</Text>
              <Button testId="remove-audio" label={t.macRemove} variant="ghost" onPress={() => setAudio(null)} />
            </>
          ) : (
            <Text color={C.dim}>{t.macDropHint}</Text>
          )}
        </Row>
      </Field>
      <Field label={t.fieldTranscript} hint={t.fieldTranscriptHint}>
        <TextArea
          testId="transcript"
          value={transcript}
          rows={8}
          onChange={(v) => {
            setTranscript(v)
            setTranscriptName('pasted.txt')
          }}
        />
        <Row>
          <Button testId="load-transcript" label={t.macChooseFile} variant="ghost" onPress={() => void pick()} />
        </Row>
      </Field>
      <Field label={t.fieldTranslation} hint={t.fieldTranslationHint}>
        <TextArea testId="translation" value={translation} rows={4} onChange={setTranslation} />
      </Field>
      <Text testId="preview" color={C.dim}>
        {t.preview(sentences.length)}
      </Text>
      {audio && !timed && sentences.length > 0 && <Text color={C.danger}>{t.needsTimings}</Text>}
      {error && (
        <Text testId="import-error" color={C.danger}>
          {error}
        </Text>
      )}
      <Row>
        <Button testId="create" label={t.create} variant="primary" onPress={() => void create()} disabled={!valid || busy} />
      </Row>
    </div>
  )
}
