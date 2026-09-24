import { useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../app/settings'
import type { Sentence } from '../lib/db'
import { store } from '../lib/store'
import { parseTranscript } from '../lib/subtitles'

export function Import() {
  const { t, settings } = useSettings()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('')
  const [audio, setAudio] = useState<File | null>(null)
  const [transcript, setTranscript] = useState('')
  const [transcriptName, setTranscriptName] = useState('pasted.txt')
  const [translation, setTranslation] = useState('')

  const sentences: Sentence[] = useMemo(() => {
    const lines = translation.split(/\r?\n/).map((l) => l.trim())
    return parseTranscript(transcriptName, transcript).map((cue, i) => ({
      ...cue,
      translations: lines[i] ? { [settings.lang]: lines[i] } : undefined,
    }))
  }, [transcript, transcriptName, translation, settings.lang])

  const timed = sentences.length > 0 && sentences.every((s) => s.start !== null)
  const valid = title.trim() && sentences.length > 0 && (!audio || timed)

  const loadTranscript = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setTranscriptName(file.name)
    setTranscript(await file.text())
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  const create = async () => {
    const id = await store.createLesson({
      title: title.trim(),
      level: level.trim() || undefined,
      sentences,
      media: audio ? { blob: audio, name: audio.name } : undefined,
    })
    navigate(`/lesson/${id}`)
  }

  return (
    <div className="page form">
      <h1>{t.importTitle}</h1>
      <label>
        {t.fieldTitle}
        <input value={title} onChange={(e) => setTitle(e.target.value)} lang="ja" />
      </label>
      <label>
        {t.fieldLevel}
        <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="N5 – N1" />
      </label>
      <label>
        {t.fieldAudio}
        <input type="file" accept="audio/*,video/mp4" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
        <small className="muted">{t.fieldAudioHint}</small>
      </label>
      <label>
        {t.fieldTranscript}
        <textarea
          rows={8}
          lang="ja"
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value)
            setTranscriptName('pasted.txt')
          }}
        />
        <small className="muted">{t.fieldTranscriptHint}</small>
      </label>
      <label className="file-inline">
        {t.loadFile}
        <input type="file" accept=".srt,.vtt,.lrc,.txt" onChange={loadTranscript} />
      </label>
      <label>
        {t.fieldTranslation}
        <textarea rows={4} value={translation} onChange={(e) => setTranslation(e.target.value)} />
        <small className="muted">{t.fieldTranslationHint}</small>
      </label>
      <p className="muted" data-testid="import-preview">
        {t.preview(sentences.length)}
        {audio && !timed && sentences.length > 0 && <span className="error"> · {t.needsTimings}</span>}
      </p>
      <button className="btn primary big" disabled={!valid} onClick={create}>
        {t.create}
      </button>
    </div>
  )
}
