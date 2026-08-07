import type { ScriptedAction, ScriptedFailure, Topology } from '../engine'
import type { Lesson as BaseLesson } from '../../../shell/lesson/types'

export type { Checkpoint, NarrativeStep } from '../../../shell/lesson/types'

export type LessonGroup = 'basics' | 'reliability' | 'dlx' | 'patterns'

/** AMQP adds scripted consumer failures, which no other broker has. */
export interface Lesson extends BaseLesson<Topology, ScriptedAction> {
  group: LessonGroup
  failures?: ScriptedFailure[]
}
