import type { Lesson } from '@kikitori/core/model'
import type { Player } from '../../lib/player'
import type { Analyzer } from '@kikitori/core/tokenizer'

export interface StepProps {
  lesson: Lesson & { id: number }
  analyzer: Analyzer
  player: Player
  /** Position inside this step, for resume. */
  position: number
  onPosition: (position: number) => void
  onDone: () => void
}
