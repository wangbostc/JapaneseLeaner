export interface Cue {
  /** Seconds; null for text-only lessons played with TTS. */
  start: number | null
  end: number | null
  text: string
}

const TIMESTAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/

function seconds(stamp: string): number {
  const m = TIMESTAMP.exec(stamp)
  if (!m) throw new Error(`bad timestamp: ${stamp}`)
  const [, h = '0', min, s, frac] = m
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / 1000
}

/** SRT and WebVTT: blocks separated by blank lines, with an `a --> b` line. */
function parseBlocks(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const timing = lines.findIndex((l) => l.includes('-->'))
    if (timing < 0) continue
    const [a, b] = lines[timing].split('-->')
    const body = lines
      .slice(timing + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (body) cues.push({ start: seconds(a), end: seconds(b), text: body })
  }
  return cues
}

/** LRC: `[mm:ss.xx] text`; each line ends where the next begins. */
function parseLrc(text: string): Cue[] {
  const lines: { start: number; text: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\[(\d+:\d{2}[.:]\d{1,3})\](.*)$/.exec(raw.trim())
    if (!m) continue
    const body = m[2].trim()
    if (body) lines.push({ start: seconds(m[1].replace(/:(\d+)$/, '.$1')), text: body })
  }
  return lines.map((l, i) => ({ start: l.start, end: lines[i + 1]?.start ?? null, text: l.text }))
}

/** Plain text: one sentence per cue, split after 。！？ and at line breaks. */
export function splitSentences(text: string): Cue[] {
  return text
    .split(/\r?\n|(?<=[。！？!?])/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ start: null, end: null, text: s }))
}

export function parseTranscript(fileName: string, text: string): Cue[] {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'lrc') return parseLrc(text)
  if (ext === 'srt' || ext === 'vtt' || text.includes('-->')) return parseBlocks(text)
  return splitSentences(text)
}
