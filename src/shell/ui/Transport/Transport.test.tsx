import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Transport } from './Transport'

describe('Transport', () => {
  it('chế độ thường hiện đủ chữ trên nút', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Chạy lại' })).toHaveTextContent('Chạy lại')
    expect(screen.getByRole('button', { name: 'Bước' })).toHaveTextContent('Bước')
  })

  it('chế độ compact vẫn tìm được nút bằng accessible name dù chữ đã thành icon', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    expect(screen.getByRole('button', { name: 'Chạy lại' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bước' })).toBeInTheDocument()
    expect(screen.getByTestId('play-pause')).toBeInTheDocument()
  })

  it('chế độ compact cho mọi nút tap target tối thiểu 44px', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11')
    }
  })

  it('slider scrub luôn có mặt ở cả hai chế độ', () => {
    const { rerender } = render(<Transport durationMs={10_000} onStep={vi.fn()} />)
    expect(screen.getByLabelText('scrub')).toBeInTheDocument()
    rerender(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    expect(screen.getByLabelText('scrub')).toBeInTheDocument()
  })
})
