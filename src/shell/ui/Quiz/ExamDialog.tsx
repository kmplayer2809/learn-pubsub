import { useEffect, useMemo, useState } from 'react'
import { buildExam, type ExamSource } from '../../quiz/exam'
import { gradeQuiz, type QuizResult } from '../../quiz/grade'
import { Markdown, MarkdownInline } from '../Inspector/Markdown'

/**
 * The per-broker final exam: twenty questions drawn from every lesson's quiz, with no
 * lesson running behind it. That is why `QuizQuestion` carries no `at` — these questions
 * are read cold.
 *
 * The result screen is the point of the exam: each miss links back to the lesson that
 * teaches it, so the score turns into a reading list instead of a number.
 */
export function ExamDialog({
  brokerLabel,
  lessons,
  onSubmit,
  onJumpToLesson,
  onClose,
}: {
  brokerLabel: string
  lessons: readonly ExamSource[]
  onSubmit(result: { correct: number; total: number }): void
  onJumpToLesson(lessonId: string): void
  onClose(): void
}) {
  // `Date.now()` seeds the first draw so different sittings differ, but retry cannot
  // reuse the clock: two retries inside the same millisecond would leave `seed`
  // unchanged, and `useMemo` would hand back the identical twenty questions in the
  // identical order with no sign anything happened. Incrementing is monotonic and
  // clock-independent, so every retry is guaranteed a different seed.
  const [seed, setSeed] = useState(() => Date.now())
  const [answers, setAnswers] = useState<(number | undefined)[]>([])
  const [result, setResult] = useState<QuizResult | undefined>(undefined)

  const questions = useMemo(() => buildExam(lessons, seed), [lessons, seed])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const graded = result !== undefined
  const answeredAll = questions.length > 0 && questions.every((_, i) => answers[i] !== undefined)

  const choose = (questionIndex: number, optionIndex: number) => {
    if (graded) return
    setAnswers((previous) => {
      const next = [...previous]
      next[questionIndex] = optionIndex
      return next
    })
  }

  const submit = () => {
    const scored = gradeQuiz(questions, answers)
    setResult(scored)
    onSubmit({ correct: scored.correct, total: scored.total })
  }

  const retry = () => {
    setSeed((previous) => previous + 1)
    setAnswers([])
    setResult(undefined)
  }

  const jump = (lessonId: string) => {
    onJumpToLesson(lessonId)
    onClose()
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
        data-testid="exam"
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-ui font-semibold text-content-strong">Thi tổng kết · {brokerLabel}</h2>
            <p className="text-meta text-content-faint">{questions.length} câu rút từ mọi bài học</p>
          </div>
          <div className="flex items-center gap-2">
            {graded && (
              <span
                data-testid="exam-score"
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
              data-testid="exam-close"
              className="min-h-11 rounded-md border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Đóng
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {graded && result.wrongIndexes.length > 0 && (
            <section
              data-testid="exam-review"
              className="space-y-1.5 rounded-lg border border-warn-line bg-warn-bg p-3"
            >
              <h3 className="text-section font-semibold uppercase tracking-wider text-warn-fg">Cần xem lại</h3>
              {result.wrongIndexes.map((i) => {
                const question = questions[i]!
                return (
                  <div key={i} data-testid={`exam-review-${i}`} className="text-meta text-content">
                    <button
                      type="button"
                      onClick={() => jump(question.lessonId)}
                      data-testid={`exam-jump-${question.lessonId}`}
                      className="text-left font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {question.lessonTitle}
                    </button>
                    <span className="text-content-faint"> · câu {i + 1}</span>
                  </div>
                )
              })}
            </section>
          )}

          {questions.map((question, i) => {
            const chosen = answers[i]
            const isWrong = graded && result.wrongIndexes.includes(i)
            return (
              <div
                key={`${seed}:${i}`}
                data-testid={`exam-question-${i}`}
                className="rounded-lg border border-edge bg-surface-raised p-3"
              >
                <p className="mb-1 text-meta text-content-faint">
                  {i + 1}. {question.lessonTitle}
                </p>
                <p className="mb-2 text-narrative leading-relaxed text-content">
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
                {isWrong && (
                  <div className="mt-2 rounded-md border-l-2 border-danger-line bg-danger-bg p-2 text-content">
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
              data-testid="exam-retry"
              className="min-h-11 rounded-md border border-edge-strong px-3 py-1.5 text-ui font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Đề khác
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!answeredAll}
              data-testid="exam-submit"
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
