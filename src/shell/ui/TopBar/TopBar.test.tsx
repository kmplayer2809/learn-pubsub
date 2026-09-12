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

  it('hiện brand khi showBrand bật', () => {
    render(<TopBar title="Hello world" showBrand />)
    expect(screen.getByText('Broker Visualizer')).toBeInTheDocument()
  })

  it('không hiện brand mặc định', () => {
    render(<TopBar title="Hello world" />)
    expect(screen.queryByText('Broker Visualizer')).not.toBeInTheDocument()
  })

  it('luôn có theme toggle', () => {
    render(<TopBar title="Hello world" />)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('luôn có broker switcher', () => {
    render(<TopBar title="Hello world" />)
    expect(screen.getByTestId('broker-switcher')).toBeInTheDocument()
  })
})
