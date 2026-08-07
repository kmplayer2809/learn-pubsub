import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Checkpoint } from '../../lessons/types'
import { CheckpointSection } from './CheckpointCard'

const prefetch: Checkpoint = {
  at: 6000,
  question: 'Nếu consumer ngừng ack, điều gì xảy ra với `prefetch: 1`?',
  options: ['Delivery tiếp tục như thường', 'Delivery dừng lại sau một message', 'Broker drop message'],
  answerIndex: 1,
  explanation: 'Một message chưa ack chiếm hết `prefetch`, nên consumer không nhận thêm.',
}

const later: Checkpoint = {
  at: 9000,
  question: 'Dead-letter exchange nhận message khi nào?',
  options: ['Khi consumer ack', 'Khi message bị reject, hết TTL, hoặc vượt max-length'],
  answerIndex: 1,
  explanation: 'Ba đường dẫn tới `x-dead-letter-exchange` là reject/nack, TTL, và max-length.',
}

function optionButton(index: number): HTMLButtonElement {
  return screen.getByTestId(`checkpoint-option-${index}`) as HTMLButtonElement
}

describe('CheckpointSection visibility', () => {
  it('renders nothing before the run reaches the checkpoint at', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={5999} />)

    expect(screen.queryByTestId('checkpoints')).toBeNull()
    expect(screen.queryByText(/Câu hỏi kiểm tra/)).toBeNull()
    expect(screen.queryByText(/ngừng ack/)).toBeNull()
  })

  it('renders the question and one button per option once at is reached', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />)

    expect(screen.getByText('Câu hỏi kiểm tra')).toBeTruthy()
    expect(screen.getByText(/Nếu consumer ngừng ack/)).toBeTruthy()
    expect(screen.getAllByTestId(/^checkpoint-option-/)).toHaveLength(3)
    expect(optionButton(0).textContent).toContain('Delivery tiếp tục như thường')
    expect(optionButton(2).textContent).toContain('Broker drop message')
  })

  it('renders backtick code spans through Markdown instead of showing the backticks', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />)

    const question = screen.getByText(/Nếu consumer ngừng ack/)
    expect(question.textContent).not.toContain('`')
    expect(question.querySelector('code')?.textContent).toBe('prefetch: 1')
  })

  it('shows only the checkpoints already reached, oldest first', () => {
    const { rerender } = render(
      <CheckpointSection lessonId="03-dlx" checkpoints={[later, prefetch]} now={6000} />,
    )
    expect(screen.getAllByTestId('checkpoint-card')).toHaveLength(1)
    expect(screen.queryByText(/Dead-letter exchange nhận message/)).toBeNull()

    rerender(<CheckpointSection lessonId="03-dlx" checkpoints={[later, prefetch]} now={9000} />)
    const cards = screen.getAllByTestId('checkpoint-card')
    expect(cards).toHaveLength(2)
    // Declared out of order in the lesson array; rendered in `at` order.
    expect(cards[0]!.textContent).toContain('Nếu consumer ngừng ack')
    expect(cards[1]!.textContent).toContain('Dead-letter exchange nhận message')
  })
})

describe('CheckpointSection answering', () => {
  it('marks a correct answer correct and reveals the explanation', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />)
    expect(screen.queryByTestId('checkpoint-verdict')).toBeNull()
    expect(screen.queryByTestId('checkpoint-explanation')).toBeNull()

    fireEvent.click(optionButton(1))

    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Đúng')
    expect(screen.getByTestId('checkpoint-explanation').textContent).toContain('chưa ack chiếm hết')
  })

  it('marks a wrong answer wrong, still marks the correct option, and reveals the explanation', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />)

    fireEvent.click(optionButton(2))

    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Chưa đúng')
    // The answer the reader did NOT pick is still identified, or a wrong answer teaches
    // nothing about which one was right.
    expect(optionButton(1).textContent).toContain('Đáp án đúng')
    expect(optionButton(2).textContent).not.toContain('Đáp án đúng')
    expect(optionButton(0).textContent).not.toContain('Đáp án đúng')
    expect(screen.getByTestId('checkpoint-explanation').textContent).toContain('chưa ack chiếm hết')
  })

  it('locks every option once one is clicked, with no re-answering', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />)
    expect(optionButton(0).disabled).toBe(false)

    fireEvent.click(optionButton(0))
    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Chưa đúng')

    expect(optionButton(0).disabled).toBe(true)
    expect(optionButton(1).disabled).toBe(true)
    expect(optionButton(2).disabled).toBe(true)

    // A click on the right answer after the fact must not turn the verdict green.
    fireEvent.click(optionButton(1))
    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Chưa đúng')
  })

  it('renders explanation code spans through Markdown', () => {
    render(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />)
    fireEvent.click(optionButton(1))

    const explanation = screen.getByTestId('checkpoint-explanation')
    expect(explanation.textContent).not.toContain('`')
    expect(explanation.querySelector('code')?.textContent).toBe('prefetch')
  })
})

describe('CheckpointSection answer reset', () => {
  it('comes back unanswered after scrubbing back before at and forward again', () => {
    const { rerender } = render(
      <CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />,
    )
    fireEvent.click(optionButton(1))
    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Đúng')

    // Scrub backward past `at`: the checkpoint leaves visibility entirely.
    rerender(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={2000} />)
    expect(screen.queryByTestId('checkpoint-card')).toBeNull()

    // Forward again: same checkpoint, but the previous answer must be gone.
    rerender(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={7000} />)
    expect(screen.getByTestId('checkpoint-card')).toBeTruthy()
    expect(screen.queryByTestId('checkpoint-verdict')).toBeNull()
    expect(screen.queryByTestId('checkpoint-explanation')).toBeNull()
    expect(optionButton(1).disabled).toBe(false)
    expect(optionButton(1).textContent).not.toContain('Đáp án đúng')
  })

  it('keeps the answer while time only moves forward past at', () => {
    const { rerender } = render(
      <CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />,
    )
    fireEvent.click(optionButton(1))

    rerender(<CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={11_000} />)

    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Đúng')
  })

  it('discards the answer when the reader switches lesson', () => {
    const { rerender } = render(
      <CheckpointSection lessonId="01-hello-world" checkpoints={[prefetch]} now={6000} />,
    )
    fireEvent.click(optionButton(1))
    expect(screen.getByTestId('checkpoint-verdict').textContent).toBe('Đúng')

    // Same `now` and same checkpoint shape, different lesson: without the lessonId in the
    // key React would keep the old answer and show the next lesson pre-solved.
    rerender(<CheckpointSection lessonId="02-work-queues" checkpoints={[prefetch]} now={6000} />)

    expect(screen.queryByTestId('checkpoint-verdict')).toBeNull()
    expect(optionButton(1).disabled).toBe(false)
  })

  it('does not hand a later checkpoint the answer given to an earlier one', () => {
    const { rerender } = render(
      <CheckpointSection lessonId="03-dlx" checkpoints={[prefetch, later]} now={6000} />,
    )
    fireEvent.click(screen.getByTestId('checkpoint-option-0'))

    rerender(<CheckpointSection lessonId="03-dlx" checkpoints={[prefetch, later]} now={9000} />)

    const verdicts = screen.getAllByTestId('checkpoint-verdict')
    expect(verdicts).toHaveLength(1)
    expect(screen.getAllByTestId('checkpoint-card')[1]!.textContent).not.toContain('Chưa đúng')
  })

  it('renders nothing at all for a lesson with no checkpoints', () => {
    render(<CheckpointSection lessonId="01-hello-world" now={99_000} />)
    expect(screen.queryByTestId('checkpoints')).toBeNull()
  })
})
