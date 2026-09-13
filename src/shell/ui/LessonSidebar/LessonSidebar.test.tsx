import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../store'
import { LessonSidebar } from './LessonSidebar'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

describe('LessonSidebar', () => {
  it('renders its own BrokerSwitcher by default', () => {
    render(<LessonSidebar />)
    expect(screen.getByTestId('broker-switcher')).toBeInTheDocument()
  })

  it('suppresses BrokerSwitcher when hideBrokerSwitcher is set — mobile/tablet already show one in TopBar', () => {
    render(<LessonSidebar hideBrokerSwitcher />)
    expect(screen.queryByTestId('broker-switcher')).toBeNull()
  })

  it('lesson rows meet the 44px mobile tap target and shrink back down from md', () => {
    render(<LessonSidebar />)
    const rows = screen
      .getAllByRole('button')
      .filter((el) => !['open-sandbox', 'broker-tab'].includes(el.getAttribute('data-testid') ?? ''))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.className).toContain('min-h-11')
      expect(row.className).toContain('md:min-h-0')
    }
  })

  it('đánh số lesson liên tục toàn broker, không reset theo nhóm', () => {
    render(<LessonSidebar hideBrokerSwitcher />)
    expect(screen.getByText('01')).toBeInTheDocument()
    // RabbitMQ có 17 lesson; số cuối phải là 17, không phải số nhỏ hơn do reset theo nhóm.
    expect(screen.getByText('17')).toBeInTheDocument()
  })
})

describe('LessonSidebar quiz progress', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('shows no badge for a lesson never quizzed', () => {
    render(<LessonSidebar />)
    expect(screen.queryByTestId('lesson-score-01-hello-world')).toBeNull()
  })

  it('shows the best score for a lesson already quizzed', () => {
    useAppStore.getState().recordLessonQuiz('01-hello-world', { correct: 3, total: 4 })
    render(<LessonSidebar />)
    expect(screen.getByTestId('lesson-score-01-hello-world').textContent).toBe('3/4')
  })

  it('marks a perfect score with a tick instead of a number', () => {
    useAppStore.getState().recordLessonQuiz('01-hello-world', { correct: 4, total: 4 })
    render(<LessonSidebar />)
    expect(screen.getByTestId('lesson-score-01-hello-world').textContent).toBe('✓')
  })

  // Sandbox is RabbitMQ-only; the exam is not — every broker has a quiz bank.
  it('offers the exam and opens it', () => {
    render(<LessonSidebar />)
    fireEvent.click(screen.getByTestId('open-exam'))
    expect(screen.getByTestId('exam')).toBeTruthy()
  })

  it('offers the exam on a broker without a sandbox', () => {
    useAppStore.getState().setBroker('redis')
    render(<LessonSidebar />)
    expect(screen.getByTestId('open-exam')).toBeTruthy()
    expect(screen.queryByTestId('open-sandbox')).toBeNull()
  })
})
