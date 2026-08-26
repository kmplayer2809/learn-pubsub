import { render, screen } from '@testing-library/react'
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
    const rows = screen.getAllByRole('button').filter((el) => el.getAttribute('data-testid') !== 'open-sandbox')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.className).toContain('min-h-11')
      expect(row.className).toContain('md:min-h-0')
    }
  })
})
