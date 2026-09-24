import type { Lesson } from '../../lib/db'
import type { Player } from '../../lib/player'
import type { Analyzer } from '../../lib/tokenizer'

export interface StepProps {
  lesson: Lesson & { id: number }
  analyzer: Analyzer
  player: Player
  /** Position inside this step, for resume. */
  position: number
  onPosition: (position: number) => void
  onDone: () => void
}
