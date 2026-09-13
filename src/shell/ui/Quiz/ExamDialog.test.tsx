import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExamSource } from '../../quiz/exam'
import { ExamDialog } from './ExamDialog'

function source(id: string, title: string, n: number): ExamSource {
  return {
    id,
    title,
    quiz: Array.from({ length: n }, (_, i) => ({
      question: `Câu ${i} của ${id}?`,
      options: ['Một', 'Hai', 'Ba'],
      answerIndex: 0,
      explanation: `Giải thích câu ${i} của ${id}.`,
    })),
  }
}

const lessons = [source('01-a', 'Bài A', 12), source('02-b', 'Bài B', 12)]

/** Answer every question; `rightAnswer` picks option 0, the correct one in the fixture. */
function answerAll(rightAnswer: boolean) {
  for (const card of screen.getAllByTestId(/^exam-question-/)) {
    const buttons = [...card.querySelectorAll('button')]
    fireEvent.click(buttons[rightAnswer ? 0 : 1]!)
  }
}

describe('ExamDialog', () => {
  it('asks twenty questions', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getAllByTestId(/^exam-question-/)).toHaveLength(20)
  })

  it('keeps submit disabled until every question is answered', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(true)
    answerAll(true)
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(false)
  })

  it('scores a perfect run and shows no review list', () => {
    const onSubmit = vi.fn()
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={onSubmit}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(true)
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('20/20')
    expect(onSubmit).toHaveBeenCalledWith({ correct: 20, total: 20 })
    expect(screen.queryByTestId('exam-review')).toBeNull()
  })

  it('lists every miss with the lesson it came from', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(false)
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('0/20')
    expect(screen.getAllByTestId(/^exam-review-/)).toHaveLength(20)
    expect(screen.getByTestId('exam-review').textContent).toContain('Bài A')
  })

  it('jumps to a missed question’s lesson and closes', () => {
    const onJumpToLesson = vi.fn()
    const onClose = vi.fn()
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={onJumpToLesson}
        onClose={onClose}
      />,
    )
    answerAll(false)
    fireEvent.click(screen.getByTestId('exam-submit'))
    fireEvent.click(screen.getAllByTestId(/^exam-jump-/)[0]!)

    expect(onJumpToLesson).toHaveBeenCalledTimes(1)
    expect(['01-a', '02-b']).toContain(onJumpToLesson.mock.calls[0]![0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('draws a fresh exam on retry', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(false)
    fireEvent.click(screen.getByTestId('exam-submit'))
    fireEvent.click(screen.getByTestId('exam-retry'))

    expect(screen.queryByTestId('exam-score')).toBeNull()
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(true)
  })
})
