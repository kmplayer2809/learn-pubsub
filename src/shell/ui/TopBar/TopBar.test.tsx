import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  it('hiện tên bài đang mở', () => {
    render(<TopBar title="Direct exchange" />)
    expect(screen.getByText('Direct exchange')).toBeInTheDocument()
  })

  it('không có nút hamburger khi không truyền onOpenDrawer', () => {
    render(<TopBar title="Direct exchange" />)
    expect(screen.queryByRole('button', { name: 'Mở danh sách bài học' })).toBeNull()
  })

  it('bấm hamburger gọi onOpenDrawer', async () => {
    const onOpenDrawer = vi.fn()
    render(<TopBar title="Direct exchange" onOpenDrawer={onOpenDrawer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở danh sách bài học' }))
    expect(onOpenDrawer).toHaveBeenCalledOnce()
  })
})
