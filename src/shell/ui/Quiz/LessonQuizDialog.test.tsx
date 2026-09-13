import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QuizQuestion } from '../../lesson/types'
import { LessonQuizDialog } from './LessonQuizDialog'

// The two questions deliberately have *different* `answerIndex` values (0 and 1).
// If they matched, `gradeQuiz(ordered, answers)` (correct — grades against the shuffled
// array the learner actually saw) and `gradeQuiz(questions, answers)` (a real bug this
// suite caught during review — grades against the original, unshuffled array) would be
// mathematically indistinguishable: a question-order swap only changes the result of
// scoring when it moves a rendered answer next to a *different* threshold to compare
// against. Same reasoning for pinning the shuffle seed in the grading tests below —
// the bug is invisible whenever the shuffle happens not to move anything.
const questions: QuizQuestion[] = [
  {
    question: 'Fanout exchange định tuyến theo gì?',
    options: ['Không theo gì, gửi tới mọi queue đã bind', 'Routing key', 'Header'],
    answerIndex: 0,
    explanation: 'Fanout bỏ qua routing key, mọi queue đã bind đều nhận bản sao.',
  },
  {
    question: '`prefetch` đếm loại message nào?',
    options: ['Message đã ack', 'Message đã đẩy đi mà chưa ack', 'Message trong DLX'],
    answerIndex: 1,
    explanation: 'Prefetch giới hạn số message chưa ack mà broker đẩy cho một consumer.',
  },
]

// Seeds verified against the real `shuffle` (mulberry32 via `createRng`/`nextInt` in
// `src/shell/kernel/rng.ts`) for this exact two-question fixture: seed 1 keeps the
// authored order [Fanout, prefetch]; seed 7 swaps it to [prefetch, Fanout]. Recompute
// if the fixture's question count or order ever changes — these are not "any two
// different numbers", they are the specific values that produce those two orders.
const SEED_AUTHORED_ORDER = 1
const SEED_SWAPPED_ORDER = 7

// The dialog shuffles *question order* (`shuffle(questions, seed)` in
// LessonQuizDialog), so "question 0" is not reliably the Fanout question across
// renders — it is a coin flip with only two questions. Tests therefore locate a
// question by a distinctive text fragment, never by its rendered `quiz-question-<i>`
// index, and only read the index back off the DOM once a card has already been found
// by content (for the explanation test id).

/** Finds the `quiz-question-<i>` card whose text contains `fragment`, wherever the
 *  shuffle put it. */
function findQuestionCard(fragment: string) {
  const card = screen.getAllByTestId(/^quiz-question-/).find((c) => c.textContent?.includes(fragment))
  if (!card) throw new Error(`no question card matching ${fragment}`)
  return card
}

/** The `<i>` a card actually rendered at, read off its own test id — used only to
 *  address that same card's `quiz-explanation-<i>`, never to predict layout. */
function questionIndexOf(card: HTMLElement) {
  const testId = card.getAttribute('data-testid') ?? ''
  const match = /^quiz-question-(\d+)$/.exec(testId)
  if (!match?.[1]) throw new Error(`unexpected question test id "${testId}"`)
  return Number(match[1])
}

/** The dialog shuffles, so tests locate a question (by a text fragment) and then an
 *  option within it (by its text), never by position. */
function clickOption(questionFragment: string, optionText: string) {
  const card = findQuestionCard(questionFragment)
  const match = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes(optionText))
  if (!match) throw new Error(`no option matching ${optionText} in question "${questionFragment}"`)
  fireEvent.click(match)
}

function answerAll(correct: boolean) {
  clickOption('Fanout', correct ? 'mọi queue đã bind' : 'Header')
  clickOption('prefetch', correct ? 'chưa ack' : 'đã ack')
}

describe('LessonQuizDialog', () => {
  it('renders every question at once, ungraded', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    expect(screen.getAllByTestId(/^quiz-question-/)).toHaveLength(2)
    expect(screen.queryByTestId('quiz-score')).toBeNull()
    expect(screen.queryByTestId('quiz-explanation-0')).toBeNull()
  })

  it('keeps submit disabled until every question is answered', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    const submit = screen.getByTestId('quiz-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    clickOption('Fanout', 'mọi queue đã bind')
    expect(submit.disabled).toBe(true)

    clickOption('prefetch', 'chưa ack')
    expect(submit.disabled).toBe(false)
  })

  it('lets an answer be changed before submitting', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    clickOption('Fanout', 'Header')
    clickOption('Fanout', 'mọi queue đã bind')
    clickOption('prefetch', 'chưa ack')

    fireEvent.click(screen.getByTestId('quiz-submit'))
    expect(screen.getByTestId('quiz-score').textContent).toContain('2/2')
  })

  it('reports the score and explains only the wrong answers', () => {
    // Pinned to the swapping seed: with the authored (unswapped) order, `ordered[i]`
    // and `questions[i]` are the same question, so a grader that accidentally reads
    // `questions` instead of `ordered` would score exactly the same and this test
    // would not catch it. See the comment above `questions`.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(SEED_SWAPPED_ORDER)
    try {
      render(
        <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
      )

      clickOption('Fanout', 'mọi queue đã bind')
      clickOption('prefetch', 'đã ack')
      fireEvent.click(screen.getByTestId('quiz-submit'))

      expect(screen.getByTestId('quiz-score').textContent).toContain('1/2')

      // Resolve each card's *own* index after the fact — grading doesn't move cards
      // around, but the shuffle already placed them somewhere the test can't predict.
      const rightIndex = questionIndexOf(findQuestionCard('Fanout'))
      const wrongIndex = questionIndexOf(findQuestionCard('prefetch'))
      expect(screen.queryByTestId(`quiz-explanation-${rightIndex}`)).toBeNull()
      expect(screen.getByTestId(`quiz-explanation-${wrongIndex}`).textContent).toContain('chưa ack')
    } finally {
      dateSpy.mockRestore()
    }
  })

  it('passes the result to onSubmit', () => {
    // Same reasoning as above: pin to the swapping seed so a grader reading the
    // wrong (unshuffled) array is guaranteed to score this wrong, not just sometimes.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(SEED_SWAPPED_ORDER)
    try {
      const onSubmit = vi.fn()
      render(
        <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={onSubmit} onClose={() => {}} />,
      )

      answerAll(true)
      fireEvent.click(screen.getByTestId('quiz-submit'))

      expect(onSubmit).toHaveBeenCalledWith({ correct: 2, total: 2 })
    } finally {
      dateSpy.mockRestore()
    }
  })

  it('reshuffles the question order on retry', () => {
    // The spec requires "Làm lại" to reshuffle *question order* by drawing a new
    // seed — this is the one test that would notice if that shuffle were ever
    // deleted (`const ordered = questions`), which otherwise passes every other
    // test in this file unchanged.
    //
    // `mockReturnValueOnce` chained twice does NOT reliably give "call 1 = mount,
    // call 2 = retry": React's own internals call `Date.now()` an unpredictable
    // number of times per render (observed 1-3+ calls just for the initial mount
    // in this suite), so the two queued once-values get consumed by that noise
    // before the component's own `useState`/`retry` calls ever see them — flaky
    // in a way that isn't about timing, it reproduces every run once triggered.
    // A *persistent* `mockReturnValue` per phase sidesteps this: React can call
    // `Date.now()` as many times as it wants during mount and the answer/submit
    // interactions and every call still sees the same seed, because the seed is
    // only switched (not "consumed") right before the retry click — the one call
    // that matters (`setSeed(Date.now())` inside `retry`) reads whatever the
    // mock currently returns, regardless of how many other calls came before it.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(SEED_AUTHORED_ORDER)
    try {
      render(
        <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
      )

      const before = screen.getAllByTestId(/^quiz-question-/).map((c) => c.textContent)
      answerAll(true)
      fireEvent.click(screen.getByTestId('quiz-submit'))

      dateSpy.mockReturnValue(SEED_SWAPPED_ORDER)
      fireEvent.click(screen.getByTestId('quiz-retry'))

      expect(screen.getAllByTestId(/^quiz-question-/).map((c) => c.textContent)).not.toEqual(before)
    } finally {
      dateSpy.mockRestore()
    }
  })

  it('clears every answer on retry', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    answerAll(false)
    fireEvent.click(screen.getByTestId('quiz-submit'))
    fireEvent.click(screen.getByTestId('quiz-retry'))

    expect(screen.queryByTestId('quiz-score')).toBeNull()
    expect((screen.getByTestId('quiz-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes on the close button and on Escape', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={onClose} />,
    )

    fireEvent.click(screen.getByTestId('quiz-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
  })
})
