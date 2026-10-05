# Phase 0: can Kikitori run as a gpuix macOS app?

A throwaway spike (2026-10-06) for the macOS app plan. Verdict: **go**.

```bash
(cd gpuix && bun install)
cd gpuix && bun run dev        # the spike window, from source
./build-app.sh                 # build/Kikitori.app, ad-hoc signed
open build/Kikitori.app
```

- `gpuix/spike.tsx`: one window with furigana, an IME input, and buttons that drive the helper. It uses the web app's own `src/lib` tokenizer, furigana and scoring, unchanged.
- `gpuix/entry.ts`: the entry point for the compiled app (see "Packaging").
- `helper/main.swift`: the audio helper. Bun starts it and sends one JSON command per line: `auth`, `speak`, `synth`, `record`, `play`, `stop`, `recognize`.
- `gpuix/shot.ts`, `gpuix/shot-app.ts`: run the spike (or the built app) in the background and save a screenshot.

## Results

| Check | Result |
|---|---|
| (a) Furigana | Pass. Each word is a two-line block (reading over kanji), laid out in rows that wrap; Hiragino renders cleanly. A reading wider than its kanji (わたし over 私) leaves a gap where CSS ruby would overhang. |
| (b) Japanese IME in `<input>` | Pass. The candidate list appears next to the text and conversion works. |
| (c) speak → record → recognize → score | Works. The weak spots are listed below. |
| (d) Permissions from an unsigned `.app` | Pass. Ad-hoc signed, with usage strings in Info.plist: microphone and speech recognition were both granted. |
| Shared logic on Bun | Pass. The tokenizer, furigana and scoring run unchanged (the dictionary is read from disk). |

The test that speaks into a file and recognizes it (no mic) scored 88 (A), not about 100. Shadowing with the mic scored 38 (C).

## Fix in the real app

- **Digits.** Apple's recognizer writes 六時 as `6時`, and kuromoji gives "6" no reading. Convert digits to kanji numbers before scoring. The web app probably has the same gap.
- **Lost start of an attempt.** The spike records first and recognizes the file afterwards. Recording starts only after the voice finishes, so the start of the attempt was lost ("6時に起きます"). Recognize live from one microphone stream (AVAudioEngine → `SFSpeechAudioBufferRecognitionRequest`), as the web app does, with a clear "go" cue.
- **Server recognition.** Recognition ran on Apple's servers (`onDevice=false`, "No Assistant asset for language ja-JP"). The offline model comes with Japanese dictation (System Settings → Keyboard → Dictation). Prefer it when installed, and say so in Settings.

## gpuix notes (0.10.0)

- Pin `@gpuix/react` and `@gpuix/native` to the same exact version.
- A layout box needs `display: 'flex'`; `flexDirection` alone is ignored.
- The published 0.10.0 lacks `Button`, although the starter template uses it. A `div` with `onClick` and `hover` works.
- Give every `<text>` a `color`.
- **Packaging.** `bun build --compile` doesn't embed the native renderer (`gpuix-native.darwin-arm64.node`, 22.5 MB). `build-app.sh` ships it in `Contents/Frameworks`, and `entry.ts` sets `NAPI_RS_NATIVE_LIBRARY_PATH` before gpuix loads.
- The app is 99 MB: a 60 MB Bun binary, the 22.5 MB renderer, the 17 MB dictionary and a 116 KB helper.
