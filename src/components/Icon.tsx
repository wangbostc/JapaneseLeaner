const PATHS = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  replay: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  slow: 'M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6zm-1 3v6l5 3 .9-1.6-3.9-2.3V7z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z',
  stop: 'M7 7h10v10H7z',
  eye: 'M12 5C7 5 3 9 2 12c1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  flag: 'M6 3v18h2v-7h9l-2-3.5L17 7H8V3z',
  next: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  book: 'M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zm2 2v10a2 2 0 0 0 2 2h7V8a2 2 0 0 0-2-2z',
  cards: 'M4 7h12v13H4zM8 4h12v13h-2V6H8z',
  chart: 'M4 20V10h3v10zm6 0V4h3v16zm6 0v-7h3v7z',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-3.6l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-1.8-3.1L4.6 13a7 7 0 0 1 0-2L3 9.8l1.8-3.1 1.9.7a7 7 0 0 1 1.7-1l.3-2h3.6l.3 2a7 7 0 0 1 1.7 1l1.9-.7L21 9.8 19.4 11a7 7 0 0 1 0 2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-6h6z',
  check: 'M9 16.2l-4.2-4.2L3.4 13.4 9 19 21 7l-1.4-1.4z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  trash: 'M6 7h12l-1 13H7zM9 4h6l1 2H8z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const stroke = name === 'next' || name === 'back'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="icon">
      <path d={PATHS[name]} fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : 'none'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
