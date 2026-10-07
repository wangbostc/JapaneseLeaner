/**
 * A one-event iCalendar file with an alarm at the start time, for "add the
 * next review to my calendar". Follows RFC 5545: CRLF line endings, UTC
 * timestamps, and lines folded at 75 octets without splitting a character.
 */

export interface CalendarEvent {
  /** Stable per lesson and round, so re-adding updates rather than duplicates. */
  uid: string
  start: Date
  durationMinutes: number
  title: string
  description?: string
  url?: string
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

const encoder = new TextEncoder()

/** Folds one content line to 75-octet pieces, breaking only between characters. */
export function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let octets = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    // Continuation lines start with a space, which counts toward their 75.
    const limit = out.length === 0 ? 75 : 74
    if (octets + size > limit) {
      out.push(current)
      current = ''
      octets = 0
    }
    current += ch
    octets += size
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildIcs(event: CalendarEvent, now = new Date()): string {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kikitori//Review reminder//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
