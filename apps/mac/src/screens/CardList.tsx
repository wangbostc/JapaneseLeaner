import { coreRank, isCoreCard } from '@kikitori/core/coreWords'
import { relativeTime } from '@kikitori/core/i18n'
import { toHiragana } from '@kikitori/core/kana'
import type { Flashcard } from '@kikitori/core/model'
import { useMemo, useState } from 'react'
import { useApp, useQuery } from '../context'
import { Choice, Field, TextField } from '../ui/form'
import { Button, Col, Pressable, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'

type Filter = 'all' | 'due' | 'suspended' | 'core' | 'saved'
const FILTERS: Filter[] = ['all', 'due', 'suspended', 'core', 'saved']

/** Rows shown at a time (there can be 3,500 core words). */
const PAGE = 100

const dueAt = (c: Flashcard) => c.card.due.getTime()
const isDue = (c: Flashcard, now: number) => !c.suspendedAt && dueAt(c) <= now

const MATCHES: Record<Filter, (c: Flashcard, now: number) => boolean> = {
  all: () => true,
  due: isDue,
  suspended: (c) => !!c.suspendedAt,
  core: (c) => isCoreCard(c),
  saved: (c) => !isCoreCard(c),
}

/** For search: katakana as hiragana, full-width letters as ASCII, any case. */
const fold = (s: string) => toHiragana(s.normalize('NFKC')).toLowerCase()

/** Due first, then by due date; suspended cards last. */
const byDue = (a: Flashcard, b: Flashcard) => Number(!!a.suspendedAt) - Number(!!b.suspendedAt) || dueAt(a) - dueAt(b) || a.id! - b.id!

/** A card's text, corrected; a core word's spelling is its identity, so it stays. */
function Editor({ card, onDone }: { card: Flashcard; onDone: () => void }) {
  const { t, store } = useApp()
  const core = isCoreCard(card)
  // Set once: the list re-runs on every change, and mustn't reset what's being typed.
  const [front, setFront] = useState(card.front)
  const [reading, setReading] = useState(card.reading)
  const [context, setContext] = useState(card.context)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await store.editCard(card.id!, { ...(core ? {} : { front }), reading, context })
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Col testId="card-editor" style={{ gap: 12 }}>
      <Field label={t.cardFront} hint={core ? t.coreFrontFixed : undefined}>
        <TextField testId="edit-front" value={front} onChange={setFront} readOnly={core} />
      </Field>
      <Field label={t.cardReading}>
        <TextField testId="edit-reading" value={reading} onChange={setReading} />
      </Field>
      <Field label={t.cardContext}>
        <TextField testId="edit-context" value={context} onChange={setContext} />
      </Field>
      <Row style={{ gap: 8 }}>
        <Button testId="save-card" label={t.saveCard} variant="primary" disabled={busy} onPress={() => void save()} />
        <Button testId="cancel-edit" label={t.cancelEdit} variant="ghost" onPress={onDone} />
      </Row>
    </Col>
  )
}

export function CardList() {
  const { t, settings, store, navigate } = useApp()
  // Live: a suspend, edit or delete shows at once. `now` is taken with each run.
  const data = useQuery(async () => ({ cards: (await store.allCards()).sort(byDue), now: Date.now() }), [])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  // One row open at a time, showing its actions, its editor, or a delete awaiting confirmation.
  const [open, setOpen] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const shown = useMemo(() => {
    if (!data) return []
    const q = fold(search.trim())
    return data.cards.filter((c) => MATCHES[filter](c, data.now) && (!q || [c.front, c.reading, c.context].some((s) => fold(s).includes(q))))
  }, [data, search, filter])
  if (!data) return null

  const toggle = (id: number) => {
    setOpen(open === id ? null : id)
    setEditing(false)
    setConfirming(false)
  }
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }
  // The first press asks, the second deletes.
  const remove = (id: number) =>
    confirming
      ? run(async () => {
          await store.removeCard(id)
          setOpen(null)
          setConfirming(false)
        })
      : setConfirming(true)
  const status = (c: Flashcard) =>
    c.suspendedAt
      ? t.suspended
      : c.card.reps === 0
        ? t.newCard
        : dueAt(c) <= data.now
          ? t.dueNow
          : t.dueIn(relativeTime(settings.lang, dueAt(c), data.now))

  return (
    <Col style={{ gap: 14 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <Button testId="back-to-cards" label={`‹ ${t.navCards}`} variant="ghost" onPress={() => navigate({ name: 'cards' })} />
          <Text size={28} weight={700}>
            {t.allCards}
          </Text>
        </Row>
        <Text testId="card-count" color={C.dim}>
          {t.cardCount(shown.length)}
        </Text>
      </Row>
      <TextField
        testId="card-search"
        value={search}
        placeholder={t.searchCards}
        onChange={(v) => {
          setSearch(v)
          setLimit(PAGE)
        }}
      />
      <Choice
        testId="card-filter"
        value={filter}
        onChange={(f) => {
          setFilter(f)
          setLimit(PAGE)
        }}
        options={FILTERS.map((f): [Filter, string] => [f, t.cardFilters[f]])}
      />
      {shown.length === 0 && (
        <Text testId="no-cards" color={C.dim}>
          {t.noMatchingCards}
        </Text>
      )}
      <Col style={{ gap: 6 }}>
        {shown.slice(0, limit).map((c) => {
          const id = c.id!
          const core = isCoreCard(c)
          return (
            <Col key={id} style={{ borderRadius: 10, backgroundColor: C.panel }}>
              <Pressable
                testId={`card-row-${id}`}
                onPress={() => toggle(id)}
                style={{ justifyContent: 'space-between', gap: 16, paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 10, borderRadius: 10 }}
                hover={{ backgroundColor: C.raised }}
              >
                <Row style={{ gap: 10, alignItems: 'center', flexShrink: 1, flexWrap: 'wrap' }}>
                  <Text ja size={16} weight={600}>
                    {c.front}
                  </Text>
                  {c.reading !== c.front && (
                    <Text ja color={C.ruby}>
                      {c.reading}
                    </Text>
                  )}
                </Row>
                <Row style={{ gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  {core && (
                    <Text size={11} color={C.faint}>
                      {t.coreWordLabel(coreRank(c))}
                    </Text>
                  )}
                  <Text size={12} color={c.suspendedAt ? C.danger : C.dim}>
                    {status(c)}
                  </Text>
                </Row>
              </Pressable>
              {open === id && (
                <Col style={{ gap: 8, paddingLeft: 14, paddingRight: 14, paddingBottom: 12, paddingTop: 4 }}>
                  {editing ? (
                    <Editor key={id} card={c} onDone={() => setEditing(false)} />
                  ) : (
                    <>
                      <Row style={{ gap: 8 }}>
                        <Button
                          testId={`suspend-${id}`}
                          label={c.suspendedAt ? t.resume : t.suspend}
                          disabled={busy}
                          onPress={() => void run(() => store.setSuspended(id, !c.suspendedAt))}
                        />
                        <Button testId={`edit-${id}`} label={t.editCard} onPress={() => setEditing(true)} />
                        <Button testId={`delete-${id}`} label={confirming ? t.confirmDeleteCard : t.deleteCard} variant="danger" disabled={busy} onPress={() => void remove(id)} />
                      </Row>
                      {confirming && core && (
                        <Text size={12} color={C.dim}>
                          {t.coreDeleteNote}
                        </Text>
                      )}
                    </>
                  )}
                </Col>
              )}
            </Col>
          )
        })}
      </Col>
      {shown.length > limit && (
        <Row>
          <Button testId="show-more" label={t.showMoreCards(Math.min(PAGE, shown.length - limit))} variant="ghost" onPress={() => setLimit(limit + PAGE)} />
        </Row>
      )}
    </Col>
  )
}
