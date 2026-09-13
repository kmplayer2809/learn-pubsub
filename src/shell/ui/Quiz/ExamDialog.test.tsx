import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EXAM_QUESTION_COUNT, type ExamSource } from '../../quiz/exam'
import { ExamDialog } from './ExamDialog'

/** One lesson, one question, with the right option always labelled "Đúng" and every
 *  wrong option labelled "Sai <j>". `correct` (0-2) varies the answer's position so a
 *  grading pass that desyncs `answers` from `questions` (e.g. by reversing one of the
 *  two arrays) cannot pass just because every question happens to sit at index 0. */
function source(id: string, title: string, correct: number): ExamSource {
  return {
    id,
    title,
    quiz: [
      {
        question: `Câu riêng của ${id}?`,
        options: [0, 1, 2].map((j) => (j === correct ? 'Đúng' : `Sai ${j}`)),
        answerIndex: correct,
        explanation: `Giải thích của ${id}.`,
      },
    ],
  }
}

// Twenty lessons, one question apiece — the bank is exactly `EXAM_QUESTION_COUNT`, so
// `buildExam` draws the whole thing (just shuffled) and every rendered question maps to
// a distinct lesson. That distinctness is what makes miss-attribution checkable: a
// review row naming the wrong lesson can never coincidentally look right, the way it
// could with a two-lesson fixture where several questions share a title.
const lessons = Array.from({ length: EXAM_QUESTION_COUNT }, (_, k) =>
  source(`l-${k}`, `Bài ${k}`, k % 3),
)

function optionButtons(card: HTMLElement): HTMLButtonElement[] {
  return [...card.querySelectorAll('button')] as HTMLButtonElement[]
}

function correctButton(card: HTMLElement): HTMLButtonElement {
  return optionButtons(card).find((b) => b.textContent === 'Đúng')!
}

function wrongButton(card: HTMLElement): HTMLButtonElement {
  return optionButtons(card).find((b) => b.textContent !== 'Đúng')!
}

/** Click one option — right or wrong per `pick` — on every rendered question card. */
function answerAll(pick: (card: HTMLElement) => HTMLButtonElement) {
  for (const card of screen.getAllByTestId(/^exam-question-/)) {
    fireEvent.click(pick(card))
  }
}

/** The lesson title shown on a question card, read off its own `{n}. {title}` line —
 *  independent of anything the review section does with the same question later. */
function cardLessonTitle(card: HTMLElement): string {
  const line = card.querySelector('p')!.textContent!
  return line.replace(/^\d+\.\s*/, '')
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
    answerAll((card) => optionButtons(card)[0]!)
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
    answerAll(correctButton)
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('20/20')
    expect(onSubmit).toHaveBeenCalledWith({ correct: 20, total: 20 })
    expect(screen.queryByTestId('exam-review')).toBeNull()
  })

  it('lists every miss when every question is missed', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(wrongButton)
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('0/20')
    expect(screen.getAllByTestId(/^exam-review-/)).toHaveLength(20)
  })

  /**
   * The mutation-catching test. Answers exactly one question right, the rest wrong, and
   * checks two properties that a passing review list must have: (1) the miss list omits
   * precisely the question that was answered right — index-coupled, so grading against a
   * differently-ordered array (e.g. `[...questions].reverse()`) desyncs `answers[i]` from
   * the wrong `questions[i]` and this goes wrong; and (2) every review row names the same
   * lesson its own question card names — so a row built from a neighbouring question
   * (e.g. `questions[(i + 1) % questions.length]`) is caught, because with twenty
   * one-question lessons no neighbour ever shares a title by coincidence.
   */
  it('marks exactly the question answered right, and attributes every miss to its own lesson', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    const cards = screen.getAllByTestId(/^exam-question-/)
    const trueLessonTitle = cards.map((card) => cardLessonTitle(card))
    const rightIndex = 7

    cards.forEach((card, i) => {
      fireEvent.click(i === rightIndex ? correctButton(card) : wrongButton(card))
    })
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('1/20')
    expect(screen.getAllByTestId(/^exam-review-/)).toHaveLength(19)
    expect(screen.queryByTestId(`exam-review-${rightIndex}`)).toBeNull()

    for (let i = 0; i < cards.length; i++) {
      if (i === rightIndex) continue
      expect(screen.getByTestId(`exam-review-${i}`).textContent).toContain(trueLessonTitle[i])
    }
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
    answerAll(wrongButton)
    fireEvent.click(screen.getByTestId('exam-submit'))
    fireEvent.click(screen.getAllByTestId(/^exam-jump-/)[0]!)

    expect(onJumpToLesson).toHaveBeenCalledTimes(1)
    expect(lessons.map((l) => l.id)).toContain(onJumpToLesson.mock.calls[0]![0])
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
    const before = screen.getAllByTestId(/^exam-question-/).map((card) => card.textContent)

    answerAll(wrongButton)
    fireEvent.click(screen.getByTestId('exam-submit'))
    fireEvent.click(screen.getByTestId('exam-retry'))

    expect(screen.queryByTestId('exam-score')).toBeNull()
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(true)

    const after = screen.getAllByTestId(/^exam-question-/).map((card) => card.textContent)
    expect(after).not.toEqual(before)
  })
})
