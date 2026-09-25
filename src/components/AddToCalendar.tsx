import { nextReviewEvent, saveIcs } from '../app/reminders'
import { useSettings } from '../app/useSettings'
import type { Lesson } from '../lib/db'
import { Icon } from './Icon'

/** Saves the lesson's next review as a calendar event with an alarm; hidden when none is scheduled. */
export function AddToCalendar({ lesson }: { lesson: Lesson & { id: number } }) {
  const { t } = useSettings()
  const ics = nextReviewEvent(lesson, { title: t.calendarTitle, body: t.calendarBody })
  if (!ics) return null
  return (
    <button className="btn" onClick={() => saveIcs(ics, `kikitori-review-${lesson.id}.ics`)} data-testid="add-to-calendar">
      <Icon name="calendar" /> {t.addToCalendar}
    </button>
  )
}
