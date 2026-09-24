import { useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../app/useSettings'
import type { Sentence } from '../lib/db'
import { store } from '../lib/store'
import { parseTranscript } from '../lib/subtitles'
import { WHISPER_MODELS, type WhisperModelId } from '../lib/transcribe'
import { transcribeToSrt, type TranscribeProgress } from '../lib/transcriber'

export function Import() {
  const { t, settings } = useSettings()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('')
  const [audio, setAudio] = useState<File | null>(null)
  const [transcript, setTranscript] = useState('')
  const [transcriptName, setTranscriptName] = useState('pasted.txt')
  const [translation, setTranslation] = useState('')
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<WhisperModelId>(WHISPER_MODELS[0].id)
  const [asr, setAsr] = useState<TranscribeProgress | 'done' | null>(null)
  const [asrError, setAsrError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const transcribe = async () => {
    if (!audio) return
    setAsrError(null)
    try {
      const srt = await transcribeToSrt(audio, model, setAsr)
      setTranscript(srt)
      setTranscriptName('transcribed.srt')
      setAsr('done')
    } catch (e) {
      setAsrError(e instanceof Error ? e.message : String(e))
      setAsr(null)
    }
  }
  const asrRunning = asr !== null && asr !== 'done'

  const create = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const id = await store.createLesson({
        title: title.trim(),
        level: level.trim() || undefined,
        sentences,
        media: audio ? { blob: audio, name: audio.name } : undefined,
      })
      navigate(`/lesson/${id}`)
    } catch (e) {
      // e.g. an IndexedDB quota error for a large audio file on iOS.
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
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
      {audio && !timed && (
        <div className="transcribe" data-testid="transcribe">
          <h2 className="section-label">{t.transcribeTitle}</h2>
          <p className="muted small">{t.transcribeHint}</p>
          <div className="row">
            <select aria-label={t.transcribeModel} value={model} onChange={(e) => setModel(e.target.value as WhisperModelId)} disabled={asrRunning}>
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {t.transcribeModelSize(m.label, m.sizeMb)}
                </option>
              ))}
            </select>
            <button className="btn" onClick={transcribe} disabled={asrRunning}>
              {t.transcribeRun}
            </button>
          </div>
          {asr && asr !== 'done' && (
            <p className="muted small" role="status">
              {asr.phase === 'decoding' && t.transcribeDecoding}
              {asr.phase === 'downloading' && t.transcribeDownloading(Math.round(asr.fraction * 100))}
              {asr.phase === 'transcribing' && t.transcribeWorking}
            </p>
          )}
          {asrError && <p className="error small">{asrError}</p>}
        </div>
      )}
      {asr === 'done' && <p className="ok small">{t.transcribeDone}</p>}
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary big" disabled={!valid || busy} onClick={create}>
        {t.create}
      </button>
    </div>
  )
}
