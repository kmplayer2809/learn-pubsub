import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../store'
import { MobileTabBar } from './MobileTabBar'

describe('MobileTabBar', () => {
  beforeEach(() => useAppStore.setState({ mobilePane: 'canvas' }))

  it('có ba tab tiếng Việt', () => {
    render(<MobileTabBar />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Bài học', 'Canvas', 'Trạng thái'])
  })

  it('đánh dấu tab đang chọn bằng aria-selected', () => {
    render(<MobileTabBar />)
    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Bài học' })).toHaveAttribute('aria-selected', 'false')
  })

  it('bấm tab đổi mobilePane trong store', async () => {
    render(<MobileTabBar />)
    await userEvent.click(screen.getByRole('tab', { name: 'Trạng thái' }))
    expect(useAppStore.getState().mobilePane).toBe('state')
  })

  it('mỗi tab đạt tap target 44px', () => {
    render(<MobileTabBar />)
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('min-h-11')
    }
  })
})
