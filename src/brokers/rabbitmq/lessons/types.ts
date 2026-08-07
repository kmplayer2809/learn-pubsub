import type { ScriptedAction, ScriptedFailure, Topology } from '../engine'

export type LessonGroup = 'basics' | 'reliability' | 'dlx' | 'patterns'

export interface NarrativeStep {
  /** Virtual millisecond at which this step becomes the active explanation. */
  at: number
  title: string
  /** Markdown body rendered in the inspector. */
  body: string
  /** Node ids emphasised on the canvas while this step is active. */
  highlight?: string[]
}

export interface Checkpoint {
  at: number
  question: string
  options: string[]
  answerIndex: number
  explanation: string
}

export interface Lesson {
  id: string
  group: LessonGroup
  title: string
  /** One sentence shown under the title in the sidebar. */
  summary: string
  topology: Topology
  script: ScriptedAction[]
  failures?: ScriptedFailure[]
  narrative: NarrativeStep[]
  checkpoints?: Checkpoint[]
  seed: number
  /** Virtual milliseconds the lesson is expected to run for. */
  durationMs: number
}
