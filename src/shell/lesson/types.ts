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

/**
 * An untimed review question. Deliberately has no `at`: unlike `Checkpoint`, which is
 * anchored to a moment in the run and may ask about what is on screen right then, a
 * quiz question also appears in the per-broker exam where no simulation is playing, so
 * it has to read correctly with no run behind it.
 */
export interface QuizQuestion {
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
  /** Optional in the type so a half-written lesson still compiles; `quiz.test.ts` is what
   *  requires every registered lesson to carry a full set. Same arrangement as
   *  `checkpoints?` and `checkpoints.test.ts`. */
  quiz?: QuizQuestion[]
  seed: number
  /** Virtual milliseconds the lesson is expected to run for. */
  durationMs: number
}
