import { useLiveQuery } from 'dexie-react-hooks'
import { formatDuration } from '../app/i18n'
import { useSettings } from '../app/settings'
import { store } from '../lib/store'

export function Stats() {
  const { t, settings } = useSettings()
  const s = useLiveQuery(() => store.stats(), [])
  if (!s) return null
  const max = Math.max(...s.lastWeek.map((d) => d.ms), 60_000)
  const inputPct = s.totalMs ? Math.round((s.inputMs / s.totalMs) * 100) : 50
  const dayName = new Intl.DateTimeFormat(settings.lang === 'zh' ? 'zh-CN' : 'en', { weekday: 'short', timeZone: 'UTC' })

  return (
    <div className="page">
      <h1>{t.navStats}</h1>
      <div className="stat-grid">
        <div className="stat">
          <strong>{formatDuration(s.totalMs)}</strong>
          <span>{t.statsTime}</span>
        </div>
        <div className="stat">
          <strong>{s.streak}</strong>
          <span>{t.statsStreak}</span>
        </div>
        <div className="stat">
          <strong>{s.words}</strong>
          <span>{t.statsWords}</span>
        </div>
        <div className="stat">
          <strong>{s.cards}</strong>
          <span>{t.statsCards}</span>
        </div>
      </div>

      <h2 className="section-label">{t.statsInputOutput}</h2>
      <div className="io-bar" role="img" aria-label={`${inputPct}% / ${100 - inputPct}%`}>
        <span className="in" style={{ width: `${inputPct}%` }} />
        <span className="out" style={{ width: `${100 - inputPct}%` }} />
      </div>
      <div className="io-legend muted small">
        <span>
          <i className="in" /> {formatDuration(s.inputMs)}
        </span>
        <span>
          <i className="out" /> {formatDuration(s.outputMs)}
        </span>
      </div>

      <h2 className="section-label">{t.statsWeek}</h2>
      <div className="week">
        {s.lastWeek.map((d) => (
          <div key={d.day} className="week-col">
            <div className="week-bar" style={{ height: `${(d.ms / max) * 100}%` }} title={formatDuration(d.ms)} />
            <span className="muted small">{dayName.format(new Date(d.day * 86_400_000))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
