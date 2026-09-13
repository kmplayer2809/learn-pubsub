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

/** The dialog shuffles, so tests locate an option by its text, never by its position. */
function clickOption(questionIndex: number, text: string | RegExp) {
  const card = screen.getByTestId(`quiz-question-${questionIndex}`)
  const match = [...card.querySelectorAll('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.includes(text) : text.test(b.textContent ?? ''),
  )
  if (!match) throw new Error(`no option matching ${text} in question ${questionIndex}`)
  fireEvent.click(match)
}

function answerAll(correct: boolean) {
  clickOption(0, correct ? 'mọi queue đã bind' : 'Header')
  clickOption(1, correct ? 'chưa ack' : 'đã ack')
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

    clickOption(0, 'mọi queue đã bind')
    expect(submit.disabled).toBe(true)

    clickOption(1, 'chưa ack')
    expect(submit.disabled).toBe(false)
  })

  it('lets an answer be changed before submitting', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    clickOption(0, 'Header')
    clickOption(0, 'mọi queue đã bind')
    clickOption(1, 'chưa ack')

    fireEvent.click(screen.getByTestId('quiz-submit'))
    expect(screen.getByTestId('quiz-score').textContent).toContain('2/2')
  })

  it('reports the score and explains only the wrong answers', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    clickOption(0, 'mọi queue đã bind')
    clickOption(1, 'đã ack')
    fireEvent.click(screen.getByTestId('quiz-submit'))

    expect(screen.getByTestId('quiz-score').textContent).toContain('1/2')
    expect(screen.queryByTestId('quiz-explanation-0')).toBeNull()
    expect(screen.getByTestId('quiz-explanation-1').textContent).toContain('chưa ack')
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
