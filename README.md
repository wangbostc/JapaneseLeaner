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
- **Optional AI assistant (bring your own key).** Add an Anthropic API key in Settings to unlock two features: **Explain**, which streams a short explanation of a sentence's meaning, grammar and nuance in your UI language, and **Translate with AI**, which fills in missing translations for an imported lesson. Both use Claude Opus 5, called directly from the browser. On the static build the key is stored only in this browser and never in backups. With the server, the Worker makes the calls with its own key. Without a key, no AI buttons appear, and the study loop never depends on them.
- **意群 chunking.** Sentences are split into 文節 (natural phrases) using kuromoji's part-of-speech tags: a word plus its particles and auxiliaries, with compounds, prefixes and サ変 verbs kept together. Long sentences (20+ characters) are also split into sense units at commas and clause-linking particles (て, が, けど, から, ので, ば, たら, ながら…) and shown with a ／ between them. In text-only lessons each unit has its own play button; imported audio has no timings per chunk, so it gets none. You can turn this off in Settings.
- **Free practice.** The lesson page lets you run any single step (intensive, shadowing, blind listening, retell, or the hard-sentence drill) on any lesson at any time, including mastered ones. Free practice never completes a round or moves your resume point, so the review schedule stays as it was. Practice time still counts in stats, free intensive listening adds to the words-met count, and a weak shadowing attempt still marks the sentence as hard.
- **Pitch accent.** The word sheet and flashcards show a word's dictionary-form pitch (Tokyo standard): an overline over high morae, a step down where the pitch falls, and a faint が showing whether a following particle stays high. For example, 橋 はし↓ (尾高) is shown differently from 箸 は↓し (頭高) and 端 はし (平板). It covers about 32k common words, using UniDic's `aType`. Accent shifts in compounds and conjugated forms, so the app deliberately doesn't draw a pitch contour for whole sentences.
- **Flashcards in context.** Tap any word to save its dictionary form along with
  the sentence it came from. Cards are scheduled with FSRS (`ts-fsrs`).
- **Reminders (best effort, no server).**
  - **Calendar:** *Add next review to calendar* (on the round-complete screen and the lesson page) saves an .ics event with an alarm at the exact due time. It works on every device, and it's the most reliable option.
  - **Background check:** an installed app in Chrome or Edge on Android or desktop can check for due reviews in the background (Periodic Background Sync) and notify you. The browser decides how often, often every 12 hours or more.
  - **Badge:** the installed app shows the due count on its icon, and Today moves a review to *Due now* the moment it comes due.
  - **Push from your server** (with the backend below): every 15 minutes a cron finds reviews that have come due in your synced progress, and sends one Web Push per review round to each subscribed browser. It works with the app closed, on Android and desktop, and on iPhone once the app is added to the Home Screen (iOS 16.4+).
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
- **UniDic 3.1.0** (cwj) © The UniDic Consortium, used under the BSD 3-Clause licence
  (`public/pitch/UNIDIC-LICENSE.txt`). `public/pitch/accents.json` is derived from it by
  `scripts/build-accents.mjs`; that file's header explains how to regenerate it (the lexicon is a 555 MB download).
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

## Backend (Cloudflare Workers)

The app and its API run as one Cloudflare Worker (`worker/`, `wrangler.jsonc`):
- **Static assets:** the built React app from `dist/`.
- **API:** `/api/*`.
- **D1 (SQLite):** synced data.
- **R2:** large files. That includes the 25.6 MiB ONNX runtime, which is over the static-asset cap; `scripts/large-assets.mjs` handles it.

Each device unlocks once with a setup code you choose. The server stores only a hash of each device's token.

```bash
pnpm dev:worker     # build, apply D1 migrations locally, run the Worker (no Cloudflare account needed;
                    # local secrets such as SETUP_CODE or AZURE_SPEECH_KEY go in .dev.vars, which git ignores)
pnpm worker:smoke   # CI check: app shell, service worker, R2-served files, authenticated API
```

**First deploy (one time):**
1. Create a free Cloudflare account, then run `pnpm exec wrangler login`.
2. Create the database and put its id in `wrangler.jsonc` (`database_id`): `pnpm exec wrangler d1 create kikitori`.
3. Create the bucket: `pnpm exec wrangler r2 bucket create kikitori-files`.
4. Set a setup code: `pnpm exec wrangler secret put SETUP_CODE`. Use a long random one, such as `openssl rand -base64 24`. The guess limit is per IP, so the code's strength is the real protection.
5. For push reminders, generate VAPID keys with `node scripts/vapid-keys.mjs`, then set them: `pnpm exec wrangler secret put VAPID_PUBLIC_KEY` and `pnpm exec wrangler secret put VAPID_PRIVATE_KEY`.
6. For AI explanations and translations, store an Anthropic key on the server: `pnpm exec wrangler secret put ANTHROPIC_API_KEY`. Connected devices then use it, and no key is kept in any browser. (`ANTHROPIC_BASE_URL` is a test-only hook; never set it in production, because the key would be sent wherever it points.)
7. For natural voices (free), create an Azure **Speech** resource on the **Free F0** tier: portal.azure.com, then Create a resource, then Speech. F0 includes 500,000 characters of neural speech a month; a single learner uses a small fraction of that. From its **Keys and Endpoint** page, run `pnpm exec wrangler secret put AZURE_SPEECH_KEY` (key 1) and `pnpm exec wrangler secret put AZURE_SPEECH_REGION` (the location, such as `japaneast`). Connected devices then default to Nanami, and Settings → Japanese voice lists the eight standard ja-JP neural voices. Each sentence is synthesised once per voice, kept in R2 and on the device, so replays are free and work offline. Without these, or once the month's quota is used up, speech falls back to the device's best Japanese voice. (`AZURE_SPEECH_ENDPOINT` is a test-only hook.)
8. Optionally, for free open-source natural voices without Azure, use **AivisSpeech** or **VOICEVOX** on your computer (see below).
9. For automatic deploys, set the `CLOUDFLARE_API_TOKEN` (Workers, D1 and R2 edit) and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Until they exist, `.github/workflows/deploy-worker.yml` skips.

### Voices from your computer: AivisSpeech and VOICEVOX (free, open source)

Two free, open-source Japanese speech engines can run on your own computer (not in the Worker):
- [AivisSpeech](https://aivis-project.com/) (Style-Bert-VITS2) sounds the most human. Its bundled voices まお and コハク are under the Aivis Common Model License 1.0; credit is optional, but Kikitori shows it anyway.
- [VOICEVOX](https://voicevox.hiroshiba.jp/) offers dozens of character voices. It's free with a credit ("VOICEVOX:<character>"), and each character also has its own terms.

AivisSpeech speaks VOICEVOX's API, so Kikitori treats them alike. The computer makes the audio and uploads it, so your phone plays the same voice.

1. Install either app (or both) and keep it open. AivisSpeech serves `http://127.0.0.1:10101`, VOICEVOX `http://127.0.0.1:50021`. The engines alone also run in Docker: `ghcr.io/aivis-project/aivisspeech-engine:cpu-latest` on port 10101, and `voicevox/voicevox_engine:cpu-latest` on port 50021 (publish each as `-p 127.0.0.1:PORT:PORT`).
2. If Kikitori isn't on `localhost` (for example on its workers.dev address), open the engine's `/setting` page, such as `http://127.0.0.1:10101/setting`, and add Kikitori's address to the allowed origins. The app shows the exact address when it can't reach an engine. With Docker, pass `--allow_origin https://your-kikitori.workers.dev` instead, because a /setting change is lost when the container is recreated.
3. On that computer, go to **Settings → Use AivisSpeech / VOICEVOX on this computer**. Their voices appear under **Japanese voice**. The default is AivisSpeech's まお (ノーマル), or VOICEVOX's 青山龍星 (ノーマル) if only VOICEVOX is running.
4. On a lesson page, press **Prepare this voice for your other devices**. Every sentence is made on the computer and uploaded, and sentences you just play there are uploaded too.
5. On your phone, the prepared voice appears under "<engine> (prepared on your computer)". With no Azure, it's the default once anything has been prepared. Sentences that haven't been prepared use the phone's own voice; after one miss, the phone doesn't ask again for 10 minutes.

Kikitori credits the engine and character wherever such a voice can speak: lessons, cards, the word sheet and Settings. The app only contacts the engines after you turn them on, because a page probing `localhost` can make the browser ask for local-network permission.

### Moving from the GitHub Pages site

Browser storage belongs to one web address, so lessons and progress on the old site stay there until you move them:

1. Deploy the Worker (above), connect a device, and check the new address works.
2. Set the repository variable `KIKITORI_URL` to the new address (Settings → Secrets and variables → Actions → Variables). The next Pages deploy then shows a **"Kikitori has moved"** banner with an **Export backup** button and a link to the new address.
3. On each device: export a backup on the old site, open the new address, restore the backup in Settings, and connect sync. If you added the old site to your Home Screen, add the new one and remove the old.

   The old site updates itself in the background, so the banner may only appear after one more reload (or after closing and reopening a Home Screen app). Start with the device you've practised on most. Each device's own lessons have their own ids and merge through sync. The built-in samples share ids on every device, so their review history merges too: progress only goes forward, and the latest review of a card wins.
4. Once everything has moved, you can switch off GitHub Pages.

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

