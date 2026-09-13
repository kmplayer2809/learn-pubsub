import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QuizQuestion } from '../../lesson/types'
import { LessonQuizDialog } from './LessonQuizDialog'

const questions: QuizQuestion[] = [
  {
    question: 'Fanout exchange định tuyến theo gì?',
    options: ['Routing key', 'Không theo gì, gửi tới mọi queue đã bind', 'Header'],
    answerIndex: 1,
    explanation: 'Fanout bỏ qua routing key, mọi queue đã bind đều nhận bản sao.',
  },
  {
    question: '`prefetch` đếm loại message nào?',
    options: ['Message đã ack', 'Message đã đẩy đi mà chưa ack', 'Message trong DLX'],
    answerIndex: 1,
    explanation: 'Prefetch giới hạn số message chưa ack mà broker đẩy cho một consumer.',
  },
]

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
  })

  it('passes the result to onSubmit', () => {
    const onSubmit = vi.fn()
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={onSubmit} onClose={() => {}} />,
    )

    answerAll(true)
    fireEvent.click(screen.getByTestId('quiz-submit'))

    expect(onSubmit).toHaveBeenCalledWith({ correct: 2, total: 2 })
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
