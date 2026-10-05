/**
 * Phase 0 spike: can Kikitori's core loop run as a gpuix macOS app?
 *   (a) furigana built from word blocks that wrap, (b) Japanese IME in <input>,
 *   (c) speak → record → recognize → score through the Swift helper,
 *   (d) permission prompts from inside a .app (see build-app.sh).
 * The tokenizer and scoring are the web app's own src/lib code, unchanged.
 */
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { useEffect, useState } from 'react'
import { render } from '@gpuix/react'
import { rubySegments } from '../../src/lib/furigana'
import { readingOf, scoreShadowing } from '../../src/lib/scoring'
import { loadAnalyzer, type Analyzer, type Token } from '../../src/lib/tokenizer'
import { sampleLessons } from '../../src/content/samples'

const FONT = 'Hiragino Sans'
const C = { bg: '#16181d', card: '#1f232b', text: '#e8e6e3', dim: '#9aa0a6', ruby: '#8fb8ff', accent: '#4f8cff', good: '#5fd38d', bad: '#ff7b72' }

// Inside Kikitori.app the helper and dictionary sit next to the binary; in dev, in the repo.
const standalone = typeof Bun !== 'undefined' && Bun.isStandaloneExecutable
const appDir = dirname(process.execPath)
const HELPER = process.env.KIKITORI_HELPER ?? (standalone ? join(appDir, 'kikitori-audio') : join(import.meta.dir, '../helper/build/kikitori-audio'))
const DICT = process.env.KIKITORI_DICT ?? (standalone ? join(appDir, '../Resources/dict') : join(import.meta.dir, '../../node_modules/kuromoji/dict'))

type Reply = { id: number; ok: boolean; error?: string; [k: string]: unknown }

/** The Swift helper: one JSON command per line, answered by id. */
function startHelper() {
  if (!existsSync(HELPER)) throw new Error(`helper not found at ${HELPER}`)
  const proc = Bun.spawn([HELPER], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  const waiting = new Map<number, (r: Reply) => void>()
  let next = 1
  ;(async () => {
    let buf = ''
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const msg = JSON.parse(line) as Reply
        waiting.get(msg.id)?.(msg)
        waiting.delete(msg.id)
      }
    }
  })()
  return (cmd: string, args: Record<string, unknown> = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const id = next++
      waiting.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(r.error))))
      proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n')
      proc.stdin.flush()
    })
}

const helper = typeof Bun !== 'undefined' ? startHelper() : null

/** (a) One word: its reading above the kanji, an empty line of the same height elsewhere. */
function Word({ token }: { token: Pick<Token, 'surface' | 'reading'> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row' }}>
      {rubySegments(token).map((seg, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <text style={{ fontSize: 11, lineHeight: 14, color: C.ruby, fontFamily: FONT }}>{seg.ruby ?? ' '}</text>
          <text style={{ fontSize: 24, lineHeight: 32, color: C.text, fontFamily: FONT }}>{seg.text}</text>
        </div>
      ))}
    </div>
  )
}

function Sentence({ analyzer, text }: { analyzer: Analyzer; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
      {analyzer.tokenize(text).map((t, i) => (
        <Word key={i} token={t} />
      ))}
    </div>
  )
}

const lessons = sampleLessons()
const SHORT = lessons[0].sentences[0].text
// The longest sentence at the highest level: the hardest case for wrapping.
const LONG = lessons.at(-1)!.sentences.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text

function Spike() {
  const [analyzer, setAnalyzer] = useState<Analyzer | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => console.log(`[ime] ${JSON.stringify(draft)}`), [draft])
  const [status, setStatusState] = useState('Loading the dictionary…')
  // Also logged, so a run can be read back from the app's stdout.
  const setStatus = (s: string) => (console.log(`[status] ${s.replace(/\n/g, ' | ')}`), setStatusState(s))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadAnalyzer((f) => Bun.file(join(DICT, f)).arrayBuffer())
      .then((a) => (setAnalyzer(a), setStatus('Ready.')))
      .catch((e) => setStatus(`Dictionary failed: ${e}`))
  }, [])

  const run = (label: string, task: () => Promise<string>) => async () => {
    setBusy(true)
    setStatus(`${label}…`)
    try {
      setStatus(await task())
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const score = (spoken: string) => {
    const r = scoreShadowing(readingOf(analyzer!, SHORT), readingOf(analyzer!, spoken))
    return `Heard: ${spoken}\nScore ${r.score} (${r.grade})`
  }
  const file = (name: string) => join(tmpdir(), `kikitori-spike-${name}`)

  const speak = run('Speaking', async () => (await helper!('speak', { text: SHORT }), 'Spoke the sentence.'))
  const selfTest = run('Self-test', async () => {
    const path = file('synth.caf')
    await helper!('synth', { text: SHORT, path })
    const r = await helper!('recognize', { path })
    return `Self-test (TTS → recognizer, no mic). onDevice=${r.onDevice}\n${score(String(r.text))}`
  })
  const shadow = run('Shadowing', async () => {
    await helper!('speak', { text: SHORT })
    setStatus('Recording 6 s — say the sentence now')
    const path = file('rec.m4a')
    await helper!('record', { path, seconds: 6 })
    await helper!('play', { path })
    const r = await helper!('recognize', { path })
    return `Shadowing. onDevice=${r.onDevice}\n${score(String(r.text))}`
  })
  const perms = run('Asking permission', async () => {
    const r = await helper!('auth', { request: true })
    return `Microphone: ${r.mic}, speech recognition: ${r.speech}`
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 28, height: '100%', backgroundColor: C.bg, overflowY: 'scroll' }}>
      <text style={{ fontSize: 13, color: C.dim, fontFamily: FONT }}>Kikitori · gpuix spike</text>
      {analyzer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 20, borderRadius: 12, backgroundColor: C.card }}>
          <Sentence analyzer={analyzer} text={SHORT} />
          <Sentence analyzer={analyzer} text={LONG} />
        </div>
      )}
      <input
        testId="ime"
        value={draft}
        placeholder="日本語で入力してみてください (IME test)"
        onChange={(e) => setDraft(e.value ?? '')}
        theme={{ caret: C.accent }}
        style={{ fontSize: 18, fontFamily: FONT, color: C.text, padding: 10, borderRadius: 8, backgroundColor: C.card }}
      />
      {analyzer && draft.trim() && <Sentence analyzer={analyzer} text={draft} />}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        {(
          [
            ['perms', 'Ask permissions', perms],
            ['speak', 'Speak', speak],
            ['self-test', 'Self-test (no mic)', selfTest],
            ['shadow', 'Shadow (mic)', shadow],
          ] as const
        ).map(([id, label, onClick]) => (
          <div
            key={id}
            testId={id}
            onClick={busy || !analyzer ? undefined : onClick}
            style={{ display: 'flex', padding: 10, borderRadius: 8, cursor: 'pointer', backgroundColor: busy ? '#3a4150' : C.accent, hover: { backgroundColor: '#6a9dff' } }}
          >
            <text style={{ fontSize: 14, color: '#ffffff', fontFamily: FONT }}>{label}</text>
          </div>
        ))}
      </div>
      <text testId="status" style={{ fontSize: 14, color: C.text, fontFamily: FONT }}>
        {status}
      </text>
    </div>
  )
}

const isEntryPoint = typeof Bun !== 'undefined' && (Bun.isStandaloneExecutable || Bun.main === import.meta.path)
if (isEntryPoint) {
  render(<Spike />, {
    title: 'Kikitori spike',
    width: 760,
    height: 640,
    focus: process.env.GPUIX_BACKGROUND !== '1',
  })
}
