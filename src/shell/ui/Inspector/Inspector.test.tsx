import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getBroker } from '../../../brokers/registry'
import type { Lesson } from '../../lesson/types'
import { useAppStore } from '../../store'
import { lessonKey } from '../../quiz/progress'
import { Inspector } from './Inspector'

const broker = getBroker('rabbitmq')

/** A minimal lesson: the Inspector only reads narrative, checkpoints, quiz and ids. */
const lesson = {
  id: '99-quiz-fixture',
  group: 'basics',
  title: 'Fixture',
  summary: 'Bài dùng cho test.',
  topology: broker.emptyTopology,
  script: [],
  narrative: [{ at: 0, title: 'Mở đầu', body: 'Nội dung mở đầu.' }],
  checkpoints: [],
  quiz: [
    {
      question: 'Fanout exchange định tuyến theo gì?',
      options: ['Routing key', 'Không theo gì, gửi tới mọi queue đã bind', 'Header'],
      answerIndex: 1,
      explanation: 'Fanout bỏ qua routing key.',
    },
  ],
  seed: 1,
  durationMs: 10_000,
} as unknown as Lesson<unknown, unknown>

function stateAt(now: number) {
  return { now, seq: 0, rng: { s: 1 }, journal: [] } as never
}

function renderAt(now: number, l: Lesson<unknown, unknown> = lesson) {
  return render(<Inspector broker={broker} lesson={l} state={stateAt(now)} issues={[]} />)
}

describe('Inspector end-of-lesson quiz', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('hides the prompt while the lesson is still running', () => {
    renderAt(9_999)
    expect(screen.queryByTestId('lesson-quiz-prompt')).toBeNull()
  })

  it('offers the quiz once the run reaches durationMs', () => {
    renderAt(10_000)
    expect(screen.getByTestId('lesson-quiz-prompt').textContent).toContain('Bài test cuối bài')
    expect(screen.getByTestId('lesson-quiz-prompt').textContent).toContain('1 câu')
    expect(screen.getByTestId('lesson-quiz-start').textContent).toBe('Bắt đầu')
  })

  it('hides the prompt when the lesson has no quiz', () => {
    const lessonWithoutQuiz = { ...lesson, quiz: undefined } as unknown as Lesson<unknown, unknown>
    renderAt(10_000, lessonWithoutQuiz)
    expect(screen.queryByTestId('lesson-quiz-prompt')).toBeNull()
  })

  it('opens the dialog and files the score under the lesson', () => {
    renderAt(10_000)
    fireEvent.click(screen.getByTestId('lesson-quiz-start'))

    const correct = [...screen.getByTestId('quiz-question-0').querySelectorAll('button')].find((b) =>
      b.textContent?.includes('mọi queue đã bind'),
    )!
    fireEvent.click(correct)
    fireEvent.click(screen.getByTestId('quiz-submit'))

    expect(useAppStore.getState().progress.lessons[lessonKey('rabbitmq', '99-quiz-fixture')]).toEqual({
      best: 1,
      total: 1,
      attempts: 1,
    })
  })

  // SidePanel renders <Inspector> with no key, so a lesson switch does not remount this
  // component — `quizOpen` is component-local state that must be reset by hand or it
  // survives `setLesson`/`setBroker` and reopens on the next lesson.
  it('closes the dialog instead of reopening it when switching directly to another quiz-bearing lesson', () => {
    const lessonB = { ...lesson, id: '99b-quiz-fixture' } as unknown as Lesson<unknown, unknown>
    const { rerender } = renderAt(10_000)

    fireEvent.click(screen.getByTestId('lesson-quiz-start'))
    expect(screen.getByTestId('lesson-quiz')).toBeTruthy()

    rerender(<Inspector broker={broker} lesson={lessonB} state={stateAt(10_000)} issues={[]} />)
    expect(screen.queryByTestId('lesson-quiz')).toBeNull()
  })

  it('does not silently pop the dialog open after passing through a lesson with no quiz', () => {
    const lessonWithoutQuiz = { ...lesson, id: '99c-no-quiz', quiz: undefined } as unknown as Lesson<unknown, unknown>
    const { rerender } = renderAt(10_000)

    fireEvent.click(screen.getByTestId('lesson-quiz-start'))
    expect(screen.getByTestId('lesson-quiz')).toBeTruthy()

    rerender(<Inspector broker={broker} lesson={lessonWithoutQuiz} state={stateAt(10_000)} issues={[]} />)
    expect(screen.queryByTestId('lesson-quiz')).toBeNull()
    expect(screen.queryByTestId('lesson-quiz-prompt')).toBeNull()

    // Back onto a quiz-bearing lesson: the dialog must stay closed until clicked again.
    rerender(<Inspector broker={broker} lesson={lesson} state={stateAt(10_000)} issues={[]} />)
    expect(screen.queryByTestId('lesson-quiz')).toBeNull()
    expect(screen.getByTestId('lesson-quiz-prompt')).toBeTruthy()
  })
})
