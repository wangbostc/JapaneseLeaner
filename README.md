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
- **Optional AI assistant (bring your own key).** Add an Anthropic API key in Settings to unlock two features: **Explain**, which streams a short explanation of a sentence's meaning, grammar and nuance in your UI language, and **Translate with AI**, which fills in missing translations for an imported lesson. Both use Claude Opus 5, called directly from the browser. The key is stored only in this browser and never in backups. Without a key, no AI buttons appear, and the study loop never depends on them.
- **意群 chunking.** Sentences are split into 文節 (natural phrases) using kuromoji's part-of-speech tags: a word plus its particles and auxiliaries, with compounds, prefixes and サ変 verbs kept together. Long sentences (20+ characters) are also split into sense units at commas and clause-linking particles (て, が, けど, から, ので, ば, たら, ながら…) and shown with a ／ between them. In text-only lessons each unit has its own play button; imported audio has no timings per chunk, so it gets none. You can turn this off in Settings.
- **Free practice.** The lesson page lets you run any single step (intensive, shadowing, blind listening, retell, or the hard-sentence drill) on any lesson at any time, including mastered ones. Free practice never completes a round or moves your resume point, so the review schedule stays as it was. Practice time still counts in stats, and a weak shadowing attempt still marks the sentence as hard.
- **Flashcards in context.** Tap any word to save its dictionary form along with
  the sentence it came from. Cards are scheduled with FSRS (`ts-fsrs`).
- **Reminders (best effort, no server).**
  - **Calendar:** *Add next review to calendar* (on the round-complete screen and the lesson page) saves an .ics event with an alarm at the exact due time. It works on every device, and it's the most reliable option.
  - **Background check:** an installed app in Chrome or Edge on Android or desktop can check for due reviews in the background (Periodic Background Sync) and notify you. The browser decides how often, often every 12 hours or more.
  - **Badge:** the installed app shows the due count on its icon, and Today moves a review to *Due now* the moment it comes due.
  - iOS can't notify a closed web app without a push server. Use the calendar there.
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

**No subtitles?** Import can transcribe the audio on your device with Whisper
([Transformers.js](https://github.com/huggingface/transformers.js), running in a Web Worker).
The model downloads once, when you first ask for it: Base is about 80 MB and Small about 250 MB.
The ONNX runtime is served from the app's own origin. After that first download it works offline, and the audio never leaves the device. Audio up to 20 minutes is accepted, because decoding happens in memory. The result fills the
transcript box as timed SRT for you to review. Whisper's chunks are split into sentences, and
timings are shared out by sentence length.

Measured on the synthetic fixture `e2e/fixtures/clip.wav` (three sentences in macOS's Kyoko
voice, so a best case; real recordings will be worse):

| Model | Character error rate | Notes |
|---|---|---|
| tiny (not offered) | 6.9% | 天気 → 点気, 散歩 → 3歩 |
| **base** (default) | 6.9% | 散歩 → 参考; a separate timestamp for each sentence |
| small | 0% | one timestamp chunk for the whole clip |

`WHISPER_E2E=1 pnpm e2e` re-runs the base measurement in a real browser.

Everything is stored locally in IndexedDB. There's no account and no server. The one exception is the optional AI assistant: if you add an API key, those requests go from your browser to Anthropic.
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

- Pitch-accent display
- A free-practice mode outside the scheduled rounds
