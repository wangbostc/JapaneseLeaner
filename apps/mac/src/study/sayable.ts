import type { Lesson, UiLang } from '@kikitori/core/model'

/** A sentence's meaning to say it from: in the interface language, else in English (private lessons have only English). */
export const promptOf = (s: Lesson['sentences'][number], lang: UiLang) => s.translations?.[lang] || s.translations?.en || null

/** The sentences that can be said from their meaning: those with a translation. */
export const sayable = (lesson: Lesson, lang: UiLang) => lesson.sentences.flatMap((s, i) => (promptOf(s, lang) ? [i] : []))
