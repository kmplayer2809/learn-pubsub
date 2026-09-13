import { useCallback, useEffect, useState } from 'react'
import type { Checkpoint } from '../../lesson/types'
import { Markdown, MarkdownInline } from './Markdown'

/**
 * One checkpoint quiz. The chosen answer is local state with no reset logic of its own —
 * see `CheckpointSection`, which keys each card so React discards the state instead.
 *
 * A wrong answer can be retried: the checkpoint is a comprehension beat, so the useful
 * move after getting it wrong is reading the explanation and trying again. A right
 * answer gets no retry button — there is nothing left to learn from re-picking it.
 *
 * The card owns whether it has been answered; the section owns the score. The card
 * reports each change through `onResult` and withdraws its result on unmount, so
 * scrubbing backward past `at` takes the answer out of the tally along with the card.
 */
export function CheckpointCard({
  checkpoint,
  index,
  onResult,
}: {
  checkpoint: Checkpoint
  /** The checkpoint's index in the lesson's own array — the key the section scores by. */
  index: number
  onResult(index: number, correct: boolean | undefined): void
}) {
  const [chosen, setChosen] = useState<number | undefined>(undefined)
  const answered = chosen !== undefined
  const isCorrect = chosen === checkpoint.answerIndex

  // Withdraw on unmount only. `onResult` is a stable useCallback in the section and
  // `index` never changes for a given card, so this cleanup runs exactly once, when the
  // card leaves the screen — not on every render.
  useEffect(() => () => onResult(index, undefined), [index, onResult])

  const choose = (i: number) => {
    setChosen(i)
    onResult(index, i === checkpoint.answerIndex)
  }

  const retry = () => {
    setChosen(undefined)
    onResult(index, undefined)
  }

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
                onClick={() => choose(i)}
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
          {!isCorrect && (
            <button
              type="button"
              onClick={retry}
              data-testid="checkpoint-retry"
              className="mt-2 min-h-11 rounded-md border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Thử lại
            </button>
          )}
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
 *
 * The score is kept here rather than in the cards because it sums across them, and it is
 * keyed by the same lesson-array index for the same reason. `results` can only ever hold
 * entries for mounted cards: each card withdraws its own on unmount.
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
  const [results, setResults] = useState<Record<number, boolean>>({})

  // Stable identity: the cards' unmount cleanup depends on it, and a fresh function each
  // render would make that cleanup fire on every render and wipe the score.
  const onResult = useCallback((index: number, correct: boolean | undefined) => {
    setResults((previous) => {
      if (correct === undefined) {
        if (!(index in previous)) return previous
        const next = { ...previous }
        delete next[index]
        return next
      }
      return { ...previous, [index]: correct }
    })
  }, [])

  const visible = checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) => now >= checkpoint.at)
    .sort((a, b) => a.checkpoint.at - b.checkpoint.at)

  if (visible.length === 0) return null

  const answered = visible.filter(({ index }) => index in results)
  const correct = answered.filter(({ index }) => results[index]).length

  return (
    <section className="space-y-2" data-testid="checkpoints">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-section font-semibold uppercase tracking-wider text-content-faint">Câu hỏi kiểm tra</h3>
        {answered.length > 0 && (
          <span data-testid="checkpoint-score" className="text-meta font-medium text-content-muted">
            Đúng {correct}/{visible.length}
          </span>
        )}
      </div>
      {visible.map(({ checkpoint, index }) => (
        <CheckpointCard
          key={`${lessonId}:${index}`}
          checkpoint={checkpoint}
          index={index}
          onResult={onResult}
        />
      ))}
    </section>
  )
}
