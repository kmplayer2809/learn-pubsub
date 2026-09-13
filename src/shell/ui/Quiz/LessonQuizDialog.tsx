import { useEffect, useMemo, useState } from 'react'
import type { QuizQuestion } from '../../lesson/types'
import { gradeQuiz, type QuizResult } from '../../quiz/grade'
import { shuffle } from '../../quiz/shuffle'
import { Markdown, MarkdownInline } from '../Inspector/Markdown'

/**
 * The graded quiz at the end of a lesson. Unlike a checkpoint it grades a whole set at
 * once: every question is on screen, answers can be changed freely, and nothing is marked
 * until "Nộp bài". That is the difference between a comprehension beat and a test — the
 * learner should be able to think about question 4 and go back to change question 1.
 *
 * The overlay is built the way `ExportDialog` is: fixed backdrop, click-outside and
 * Escape both close, the inner panel stops propagation.
 */
export function LessonQuizDialog({
  title,
  questions,
  onSubmit,
  onClose,
}: {
  /** Shown in the header so the learner knows which lesson they are being tested on. */
  title: string
  questions: QuizQuestion[]
  onSubmit(result: { correct: number; total: number }): void
  onClose(): void
}) {
  // A new seed per attempt, so "Làm lại" reshuffles instead of replaying the same order
  // the learner has just memorised. `Date.now` is fine here: this is the UI layer, which
  // the determinism guard does not cover — the engine never sees this value.
  const [seed, setSeed] = useState(() => Date.now())
  const [answers, setAnswers] = useState<(number | undefined)[]>([])
  const [result, setResult] = useState<QuizResult | undefined>(undefined)

  // Shuffle each question's *options*, not the question order: question 0 stays the
  // lesson author's question 0 (its `data-testid` and position on screen are stable),
  // only which option sits first changes, so the correct answer can't be memorised by
  // position. `answerIndex` is remapped to follow the option it pointed at.
  const ordered = useMemo(
    () =>
      questions.map((q, i) => {
        const optionOrder = shuffle(
          q.options.map((_, j) => j),
          seed + i,
        )
        return {
          ...q,
          options: optionOrder.map((j) => q.options[j]!),
          answerIndex: optionOrder.indexOf(q.answerIndex),
        }
      }),
    [questions, seed],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const answeredAll = ordered.every((_, i) => answers[i] !== undefined)
  const graded = result !== undefined

  const choose = (questionIndex: number, optionIndex: number) => {
    if (graded) return
    setAnswers((previous) => {
      const next = [...previous]
      next[questionIndex] = optionIndex
      return next
    })
  }

  const submit = () => {
    const scored = gradeQuiz(ordered, answers)
    setResult(scored)
    onSubmit({ correct: scored.correct, total: scored.total })
  }

  const retry = () => {
    setSeed(Date.now())
    setAnswers([])
    setResult(undefined)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="lesson-quiz"
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-ui font-semibold text-content-strong">Bài test cuối bài</h2>
            <p className="text-meta text-content-faint">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            {graded && (
              <span
                data-testid="quiz-score"
                className={`rounded-md px-2 py-1 text-meta font-semibold ${
                  result.correct === result.total ? 'bg-ok-bg text-ok-fg' : 'bg-warn-bg text-warn-fg'
                }`}
              >
                Đúng {result.correct}/{result.total}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              data-testid="quiz-close"
              className="min-h-11 rounded-md border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Đóng
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {ordered.map((question, i) => {
            const chosen = answers[i]
            const isWrong = graded && result.wrongIndexes.includes(i)
            return (
              <div
                key={`${seed}:${i}`}
                data-testid={`quiz-question-${i}`}
                className="rounded-lg border border-edge bg-surface-raised p-3"
              >
                <p className="mb-2 text-narrative leading-relaxed text-content">
                  <span className="mr-1 font-mono text-meta text-content-faint">{i + 1}.</span>
                  <MarkdownInline text={question.question} />
                </p>
                <ul className="space-y-1.5">
                  {question.options.map((option, j) => {
                    const isAnswer = j === question.answerIndex
                    const isChosen = j === chosen
                    return (
                      <li key={j}>
                        <button
                          type="button"
                          disabled={graded}
                          onClick={() => choose(i, j)}
                          data-testid={`quiz-option-${i}-${j}`}
                          className={`w-full rounded-md border px-2.5 py-1.5 text-left text-meta leading-relaxed transition-colors ${
                            graded
                              ? isAnswer
                                ? 'border-ok-line bg-ok-bg text-ok-fg'
                                : isChosen
                                  ? 'border-danger-line bg-danger-bg text-danger-fg'
                                  : 'border-edge text-content-faint'
                              : isChosen
                                ? 'border-accent bg-accent-soft text-accent'
                                : 'border-edge-strong text-content hover:bg-surface-hover'
                          }`}
                        >
                          <MarkdownInline text={option} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {/* Only the wrong answers get an explanation: re-reading why the answer the
                    learner already picked is right teaches nothing and buries the misses. */}
                {isWrong && (
                  <div
                    data-testid={`quiz-explanation-${i}`}
                    className="mt-2 rounded-md border-l-2 border-danger-line bg-danger-bg p-2 text-content"
                  >
                    <Markdown text={question.explanation} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-3">
          {graded ? (
            <button
              type="button"
              onClick={retry}
              data-testid="quiz-retry"
              className="min-h-11 rounded-md border border-edge-strong px-3 py-1.5 text-ui font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Làm lại
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!answeredAll}
              data-testid="quiz-submit"
              className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0"
            >
              Nộp bài
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
