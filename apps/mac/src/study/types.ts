import type { Lesson } from '@kikitori/core/model'
import type { Player } from '../audio/player'

export interface StepProps {
  lesson: Lesson & { id: number }
  player: Player
  /** Position inside this step, for resume. */
  position: number
  onPosition: (position: number) => void
  onDone: () => void
}
