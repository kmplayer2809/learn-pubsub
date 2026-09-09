import { useState } from 'react'
import type { Checkpoint } from '../../lesson/types'
import { Markdown, MarkdownInline } from './Markdown'

/**
 * One checkpoint quiz. The chosen answer is local state with no reset logic of its own —
 * see `CheckpointSection`, which keys each card so React discards the state instead.
 *
 * Answering is one-way on purpose: the checkpoint is a comprehension beat inside a lesson,
 * not a graded exercise, so there is no score and no retry. Once an option is clicked the
 * whole set is disabled, the chosen option is marked right or wrong, the correct option is
 * marked regardless of what was chosen, and the explanation appears.
 */
export function CheckpointCard({ checkpoint }: { checkpoint: Checkpoint }) {
  const [chosen, setChosen] = useState<number | undefined>(undefined)
  const answered = chosen !== undefined
  const isCorrect = chosen === checkpoint.answerIndex

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-3 shadow-sm" data-testid="checkpoint-card">
      <p className="mb-2 text-narrative leading-relaxed text-content">
        <MarkdownInline text={checkpoint.question} />
      </p>

      <ul className="space-y-1.5">
        {checkpoint.options.map((option, i) => {
          const isAnswer = i === checkpoint.answerIndex
          const isChosen = i === chosen
          return (
            <li key={i}>
              <button
                type="button"
                disabled={answered}
                onClick={() => setChosen(i)}
                data-testid={`checkpoint-option-${i}`}
                className={`w-full rounded-md border px-2.5 py-1.5 text-left text-meta leading-relaxed transition-colors ${
                  answered
                    ? isAnswer
                      ? 'border-ok-line bg-ok-bg text-ok-fg'
                      : isChosen
                        ? 'border-danger-line bg-danger-bg text-danger-fg'
                        : 'border-edge text-content-faint'
                    : 'border-edge-strong text-content hover:border-edge-strong hover:bg-surface-hover'
                }`}
              >
                <MarkdownInline text={option} />
                {answered && isAnswer && (
                  <span className="ml-1 text-meta font-medium text-ok-fg">· Đáp án đúng</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {answered && (
        <div className={`mt-2 rounded-md border-l-2 p-2 ${isCorrect ? 'border-ok-line bg-ok-bg' : 'border-danger-line bg-danger-bg'}`}>
          <p
            data-testid="checkpoint-verdict"
            className={`mb-1 text-meta font-semibold ${isCorrect ? 'text-ok-fg' : 'text-danger-fg'}`}
          >
            {isCorrect ? 'Đúng' : 'Chưa đúng'}
          </p>
          <div data-testid="checkpoint-explanation" className="text-content">
            <Markdown text={checkpoint.explanation} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Every checkpoint the run has reached, oldest first. A checkpoint appears once
 * `now >= at` and stays for the rest of the run.
 *
 * The `key` is the whole reset mechanism, and it has to cover two cases the brief calls
 * out. Switching lesson changes `lessonId`, so every card is a different element and React
 * throws the old answers away. Scrubbing backward past a checkpoint's `at` drops it from
 * `visible` entirely, which unmounts it — so when time moves forward again it mounts
 * fresh, unanswered. Neither path needs an effect that writes state during render.
 *
 * The index in the key is the checkpoint's index in the lesson's own array, not its
 * position in `visible`, so revealing an earlier checkpoint cannot shift a later card's
 * identity and hand it someone else's answer.
 */
export function CheckpointSection({
  lessonId,
  checkpoints = [],
  now,
}: {
  lessonId: string
  checkpoints?: Checkpoint[]
  now: number
}) {
  const visible = checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) => now >= checkpoint.at)
    .sort((a, b) => a.checkpoint.at - b.checkpoint.at)

  if (visible.length === 0) return null

  return (
    <section className="space-y-2" data-testid="checkpoints">
      <h3 className="text-section font-semibold uppercase tracking-wider text-content-faint">Câu hỏi kiểm tra</h3>
      {visible.map(({ checkpoint, index }) => (
        <CheckpointCard key={`${lessonId}:${index}`} checkpoint={checkpoint} />
      ))}
    </section>
  )
}
