"""Builds e2e/fixtures/clip.wav + clip.srt with macOS `say` (Kyoko).

Each sentence is synthesised separately and joined with 600 ms of silence,
so the SRT timings are exact. Also the positive control for transcription.
Run: python3 scripts/make-audio-fixture.py
"""
import os, subprocess, tempfile, wave

SENTENCES = ['おはようございます。', '今日はいい天気ですね。', '一緒に散歩しましょう。']
RATE, GAP = 16000, 0.6
out = os.path.join(os.path.dirname(__file__), '..', 'e2e', 'fixtures')

def stamp(t):
    ms = round(t * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'

frames, cues, t = b'', [], GAP
silence = b'\0\0' * int(RATE * GAP)
with tempfile.TemporaryDirectory() as tmp:
    for i, text in enumerate(SENTENCES):
        path = os.path.join(tmp, f'{i}.wav')
        subprocess.run(['say', '-v', 'Kyoko', '-o', path, f'--data-format=LEI16@{RATE}', text], check=True)
        with wave.open(path) as w:
            data = w.readframes(w.getnframes())
        dur = len(data) / 2 / RATE
        cues.append((t, t + dur, text))
        frames += silence + data
        t += dur + GAP
    frames += silence

with wave.open(os.path.join(out, 'clip.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(frames)
with open(os.path.join(out, 'clip.srt'), 'w') as f:
    for n, (a, b, text) in enumerate(cues, 1):
        f.write(f'{n}\n{stamp(a)} --> {stamp(b)}\n{text}\n\n')
print(open(os.path.join(out, 'clip.srt')).read())
