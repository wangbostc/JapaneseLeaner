# Kikitori · 聞き取り

A Japanese listening and speaking trainer. Pick a passage, and the app takes you
through the whole loop: **intensive listening → shadowing → blind listening →
retelling**, then seven spaced reviews, until you can understand it at full speed
and say it yourself.

The training method (the stages and the review intervals) is inspired by
[Echo Loop](https://github.com/echo-loop/Echo-Loop), an English trainer. Kikitori
is an independent, clean-room implementation for Japanese. It shares no code or
assets with Echo Loop and isn't affiliated with it.

## The loop

| Round | After the previous round | Steps |
|---|---|---|
| First study | — | Intensive → Shadowing → Blind → Retell |
| Review 1 | 6 hours | Hard sentences → Retell |
| Reviews 2–7 | 1, 2, 4, 7, 14, 28 days | Blind → Hard sentences → Retell |

Each interval counts from when you actually finished the previous round, so a late
review pushes every later one back. Due reviews are listed before new lessons.

## What's Japanese-specific

- **Furigana over kanji only.** kuromoji (IPADIC) tokenizes the text in the browser,
  and the ruby is aligned to the kanji: 食(た)べる, 取(と)り消(け)し.
- **Shadowing is scored on sound, not spelling.** The script and the recognized
  speech are both reduced to hiragana, then compared with a kana-level edit
  distance. A recognizer that writes きょう for 今日 still scores 100. Kana you
  missed are highlighted.
- **Retell coverage uses dictionary forms.** 会った counts for 会う. Particles,
  auxiliaries and light verbs (する, ある…) don't count as key words. Words spoken
  in kana also count when the passage wrote them in kanji.
- **Hard sentences manage themselves.** A shadowing attempt graded C marks the
  sentence as hard. Scoring A or better in the hard-sentence drill clears the mark.
- **Flashcards in context.** Tap any word to save its dictionary form along with
  the sentence it came from. Cards are scheduled with FSRS (`ts-fsrs`).
- **Stats:** practice time, the listening/speaking split, unique words met, and
  your day streak.

## Lessons

Three original starter lessons (N5–N3, with English and Chinese translations) are
read aloud by the device's Japanese voice. To add your own, go to **Library →
Import**:

- Audio plus an SRT / VTT / LRC transcript: the audio is split into sentences by
  the timings.
- Or plain Japanese text, voiced by TTS. It's split at 。！？ and line breaks.
- An optional translation, one line per sentence.

Everything is stored locally in IndexedDB. There's no account and no server.

## Browser support

| Feature | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Study loop, furigana, cards | ✅ | ✅ | ✅ |
| Speech scoring (`SpeechRecognition`, ja-JP) | ✅ (needs network) | ✅ | ❌ → self-rating |
| Recording your attempt | ✅ webm | ✅ mp4 | ✅ |
| TTS for text-only lessons | needs a Japanese voice installed | ✅ | depends on OS |

Where a feature is missing, the app falls back: you rate yourself instead of being
scored, and you read the text when no voice is available. **Settings** shows what
your browser supports.

## Development

```bash
pnpm install        # also copies the kuromoji dictionary into public/dict
pnpm dev
pnpm test           # unit tests (vitest), using the real IPADIC dictionary
pnpm e2e            # Playwright: a full first-study round on mobile and desktop
pnpm build          # static site in dist/, deployable at any path
```

Code layout:

- `src/lib/`: framework-free logic, including `schedule` (rounds and due times),
  `scoring` (kana alignment, retell coverage), `tokenizer`, `furigana`,
  `subtitles`, `srs`, `store` (Dexie) and `speech` / `player` (browser adapters).
- `src/components/steps/`: one component per study step.
- `src/pages/`: Today, Library, Lesson, Study, Import, Cards, Stats and Settings.

The mic and speech recognition can't run headless, so the e2e tests swap them
out through `window.__kikitoriFake`. Real-device speech needs checking by hand.

The kuromoji dictionary is served gzipped. The loader checks the gzip magic bytes
itself, so it works whether or not the host also sends `Content-Encoding: gzip`
(`vite preview` does).

## Roadmap

- AI explanations, translations for imported lessons, and an optional
  Claude-backed "why is this sentence like this?" feature
- Pitch-accent display and feedback
- A bundled offline dictionary (JMdict) for meanings on word cards
- Automatic transcription of imported audio (Whisper)
- PWA offline caching, and export/import of progress
