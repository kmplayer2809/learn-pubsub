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

export interface LessonGroupSpec {
  id: string
  label: string
}

export interface Lesson<TTopology, TAction> {
  id: string
  group: string
  title: string
  /** One sentence shown under the title in the sidebar. */
  summary: string
  topology: TTopology
  script: TAction[]
  narrative: NarrativeStep[]
  checkpoints?: Checkpoint[]
  seed: number
  /** Virtual milliseconds the lesson is expected to run for. */
  durationMs: number
}
