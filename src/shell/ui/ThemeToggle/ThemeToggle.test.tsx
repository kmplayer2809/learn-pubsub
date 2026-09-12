import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../store'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    useAppStore.getState().setTheme('dark')
  })

  it('mang nhãn tiếng Việt và aria-pressed theo theme hiện tại', () => {
    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Đổi giao diện sáng/tối' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('bấm thì đổi theme trong store và đổi data-theme', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Đổi giao diện sáng/tối' }))
    expect(useAppStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
