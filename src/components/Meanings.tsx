import { useDictionary } from '../app/useDictionary'
import { useSettings } from '../app/useSettings'

/** JMdict meanings for a dictionary form; renders nothing if the dictionary is unavailable. */
export function Meanings({ word, reading }: { word: string; reading?: string }) {
  const { t } = useSettings()
  const dict = useDictionary()
  // Reserve the space while loading so the card doesn't jump; render nothing if the file is absent.
  if (dict === undefined) return <div className="meanings loading" aria-hidden="true" />
  if (!dict) return null
  const entries = dict.lookup(word, reading)
  if (!entries.length) return <p className="muted small">{t.noMeaning}</p>
  return (
    <div className="meanings" data-testid="meanings">
      <ol>
        {entries[0].senses.map((s, i) => (
          <li key={i}>
            {s.glosses.join('; ')}
            {s.pos.length > 0 && <span className="pos"> · {s.pos.map(dict.describePos).join(', ')}</span>}
          </li>
        ))}
      </ol>
      {entries.length > 1 && (
        <p className="muted small" lang="ja">
          {entries.slice(1).map((e) => `${e.kanji[0] ?? e.kana[0]}（${e.kana[0]}）${e.senses[0]?.glosses[0] ?? ''}`).join(' / ')}
        </p>
      )}
      <p className="meanings-note">{t.meaningsNote}</p>
    </div>
  )
}
