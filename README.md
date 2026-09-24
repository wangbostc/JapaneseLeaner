# Kikitori · 聞き取り

**Try it:** https://wangbostc.github.io/JapaneseLeaner/ (deployed from `main` by GitHub Pages)

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
- **Meanings from JMdict.** The word sheet and flashcards show English glosses from JMdict's common-words set (about 22k entries). It's lazy-loaded (about 0.8 MB over the wire) and cached for offline use. JMdict has no Chinese glosses, so the Chinese UI shows English meanings too.
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
Use **Settings → Your data** to export a backup (a JSON file, audio included) and to restore it on another device.

After the first visit, the app works offline. A service worker precaches the app shell, and it caches the dictionary the first time a lesson loads it.

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

## Credits and licences

- **JMdict** © Electronic Dictionary Research and Development Group, used under
  [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html). The JSON conversion is
  from [jmdict-simplified](https://github.com/scriptin/jmdict-simplified). It's
  downloaded at build time, pinned to a release and verified by checksum.
- **kuromoji.js** (Apache 2.0) with **IPADIC** © NAIST.
- **ts-fsrs** (MIT).
- The app lists these under **Settings → About & sources**.

### Updating JMdict

JMdict is revised regularly. EDRDG asks apps to keep their copy current, and to refresh it at least every few months.

1. Pick the newest release at https://github.com/scriptin/jmdict-simplified/releases.
2. Write its tag and the sha256 of `jmdict-eng-common-<tag>.json.tgz` into
   `scripts/jmdict-release.json`. That file is the only place the version lives. The build
   script and the service-worker cache name (so returning visitors get the new data) both
   read it.
3. Run `pnpm install` (or `node scripts/build-jmdict.mjs`). The script sees that the built
   file is from a different release and rebuilds it.
4. Run `pnpm test && pnpm e2e`, then open a PR.

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
- Automatic transcription of imported audio (Whisper)
