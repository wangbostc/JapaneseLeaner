import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { relativeTime } from '@kikitori/core/i18n'
import { toHiragana } from '@kikitori/core/kana'
import { type Flashcard } from '@kikitori/core/model'
import { coreRank, isCoreCard } from '@kikitori/core/coreWords'
import { useSettings } from '../app/useSettings'
import { Icon } from '../components/Icon'
import { db } from '../lib/db'
import { store } from '../lib/store'

type Filter = 'all' | 'due' | 'suspended' | 'core' | 'saved'
const FILTERS: Filter[] = ['all', 'due', 'suspended', 'core', 'saved']

/** Rows shown at first, and added by each "Show more" (there can be 3,500 core cards). */
const PAGE = 100

/** For search: case, width and katakana/hiragana don't matter. */
const fold = (s: string) => toHiragana(s.normalize('NFKC')).toLowerCase()

/** A synced row may hold its due date as a string. */
const dueOf = (c: Flashcard) => +new Date(c.card.due)

const matches = (filter: Filter, c: Flashcard, now: number) =>
  filter === 'all' ||
  (filter === 'due' && !c.suspendedAt && dueOf(c) <= now) ||
  (filter === 'suspended' && !!c.suspendedAt) ||
  (filter === 'core' && isCoreCard(c)) ||
  (filter === 'saved' && !isCoreCard(c))

/** Every card, to find one and suspend, correct or delete it. */
export function CardBrowser() {
  const { t, settings } = useSettings()
  // Straight from the table, so it follows every change (and new core words coming in). `now` is
  // taken with the data, so a card added a moment after this page opened still counts as due.
  const data = useLiveQuery(async () => ({ cards: await db.cards.toArray(), now: Date.now() }), [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  // One row open at a time; editing and confirming a delete belong to it. While open, it keeps its
  // place (as if still suspended or not, as when opened), so suspending it doesn't send it, and its
  // Resume button, off the page.
  const [open, setOpen] = useState<{ id: number; suspended: boolean } | null>(null)
  const openId = open?.id ?? null
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Due first (soonest first), then the rest by due date, suspended last.
  const sorted = useMemo(() => {
    const suspended = (c: Flashcard) => (open && c.id === open.id ? open.suspended : !!c.suspendedAt)
    return [...(data?.cards ?? [])].sort((a, b) => Number(suspended(a)) - Number(suspended(b)) || dueOf(a) - dueOf(b))
  }, [data, open])
  const now = data?.now ?? 0
  const shown = useMemo(() => {
    const q = fold(query.trim())
    return sorted.filter(
      (c) => (c.id === open?.id || matches(filter, c, now)) && (!q || [c.front, c.reading, c.context].some((s) => fold(s).includes(q))),
    )
  }, [sorted, now, query, filter, open])

  if (!data) return null

  // A new search or filter is a new list: the open row closes (and so takes its usual place).
  const narrow = (next: () => void) => {
    next()
    setLimit(PAGE)
    setOpen(null)
  }
  const toggle = (c: Flashcard) => {
    setOpen((o) => (o?.id === c.id ? null : { id: c.id!, suspended: !!c.suspendedAt }))
    setEditing(false)
    setConfirming(false)
  }

  const status = (c: Flashcard) => {
    if (c.suspendedAt) return t.suspended
    if (c.card.reps === 0) return t.newCard
    const due = dueOf(c)
    return due <= now ? t.dueNow : t.dueIn(relativeTime(settings.lang, due, now))
  }

  return (
    <div className="page">
      <Link to="/cards" className="btn ghost back-link" data-testid="back-to-cards">
        <Icon name="back" /> {t.navCards}
      </Link>
      <div className="page-head">
        <h1>{t.allCards}</h1>
        <span className="muted" data-testid="card-count">
          {t.cardCount(shown.length)}
        </span>
      </div>
      <div className="form card-search">
        <input
          type="search"
          value={query}
          placeholder={t.searchCards}
          aria-label={t.searchCards}
          data-testid="card-search"
          onChange={(e) => narrow(() => setQuery(e.target.value))}
        />
      </div>
      <div className="card-filters" role="group">
        {FILTERS.map((f) => (
          <button key={f} type="button" className="btn" aria-pressed={filter === f} data-testid={`card-filter-${f}`} onClick={() => narrow(() => setFilter(f))}>
            {t.cardFilters[f]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty">{t.noMatchingCards}</p>
      ) : (
        <ul className="list card-list">
          {shown.slice(0, limit).map((c) => {
            const isOpen = openId === c.id
            return (
              <li key={c.id} className={`card-row ${c.suspendedAt ? 'is-suspended' : ''}`} data-testid={`card-row-${c.id}`}>
                <button type="button" className="card-row-main" aria-expanded={isOpen} onClick={() => toggle(c)}>
                  <span className="card-row-text">
                    <span className="card-row-front" lang="ja">
                      {c.front}
                    </span>
                    {c.reading && c.reading !== c.front && (
                      <span className="muted" lang="ja">
                        {c.reading}
                      </span>
                    )}
                  </span>
                  <span className="card-row-side">
                    <span className="small" data-testid="card-status">
                      {status(c)}
                    </span>
                    {isCoreCard(c) && <small className="muted">{t.coreWordLabel(coreRank(c))}</small>}
                  </span>
                </button>
                {isOpen &&
                  (editing ? (
                    <CardEditor card={c} onDone={() => setEditing(false)} />
                  ) : (
                    <div className="card-row-actions">
                      <button type="button" className="btn" data-testid={`suspend-${c.id}`} onClick={() => store.setSuspended(c.id!, !c.suspendedAt)}>
                        {c.suspendedAt ? t.resume : t.suspend}
                      </button>
                      <button type="button" className="btn" data-testid={`edit-${c.id}`} onClick={() => setEditing(true)}>
                        {t.editCard}
                      </button>
                      <button
                        type="button"
                        className={`btn danger ${confirming ? 'confirm' : ''}`}
                        data-testid={`delete-${c.id}`}
                        onClick={async () => {
                          if (!confirming) return setConfirming(true)
                          await store.removeCard(c.id!)
                          setOpen(null)
                          setConfirming(false)
                        }}
                        onBlur={() => setConfirming(false)}
                      >
                        <Icon name="trash" size={16} /> {confirming ? t.confirmDeleteCard : t.deleteCard}
                      </button>
                      {confirming && isCoreCard(c) && <p className="muted small">{t.coreDeleteNote}</p>}
                    </div>
                  ))}
              </li>
            )
          })}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" className="btn" data-testid="show-more" onClick={() => setLimit((l) => l + PAGE)}>
          {t.showMoreCards(Math.min(PAGE, shown.length - limit))}
        </button>
      )}
    </div>
  )
}

/**
 * Corrects a card's reading, or a saved word's spelling. A core word's spelling, a sentence card's
 * text and the sentence a card came from stay as they are (see store.editCard).
 */
function CardEditor({ card, onDone }: { card: Flashcard; onDone: () => void }) {
  const { t } = useSettings()
  const fixed = isCoreCard(card) ? t.coreFrontFixed : card.kind === 'sentence' ? t.sentenceFrontFixed : null
  const [front, setFront] = useState(card.front)
  const [reading, setReading] = useState(card.reading)
  const [duplicate, setDuplicate] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if ((await store.editCard(card.id!, { ...(fixed ? {} : { front }), reading })) === 'duplicate') return setDuplicate(true)
    onDone()
  }
  return (
    <form className="form card-editor" onSubmit={save}>
      <label>
        {t.cardFront}
        <input lang="ja" value={front} disabled={!!fixed} data-testid="edit-front" onChange={(e) => (setFront(e.target.value), setDuplicate(false))} />
        {fixed && <small className="muted">{fixed}</small>}
        {duplicate && (
          <small className="error" data-testid="duplicate-front">
            {t.duplicateFront}
          </small>
        )}
      </label>
      <label>
        {t.cardReading}
        <input lang="ja" value={reading} data-testid="edit-reading" onChange={(e) => setReading(e.target.value)} />
      </label>
      {card.context && card.context !== card.front && (
        <p className="muted small" lang="ja">
          {t.cardContext}: {card.context}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn primary" data-testid="save-card">
          {t.saveCard}
        </button>
        <button type="button" className="btn ghost" data-testid="cancel-edit" onClick={onDone}>
          {t.cancelEdit}
        </button>
      </div>
    </form>
  )
}
