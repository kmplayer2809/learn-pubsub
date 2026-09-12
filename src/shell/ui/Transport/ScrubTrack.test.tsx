import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScrubTrack } from './ScrubTrack'

describe('ScrubTrack', () => {
  it('vẽ một vạch cho mỗi mốc', () => {
    render(<ScrubTrack value={0} max={10000} marks={[1000, 2000, 5000]} onSeek={vi.fn()} />)
    expect(screen.getAllByTestId('scrub-mark')).toHaveLength(3)
  })

  it('gộp mốc trùng thời điểm', () => {
    render(<ScrubTrack value={0} max={10000} marks={[1000, 1000, 1000, 4000]} onSeek={vi.fn()} />)
    expect(screen.getAllByTestId('scrub-mark')).toHaveLength(2)
  })

  it('bỏ mốc nằm ngoài khoảng', () => {
    render(<ScrubTrack value={0} max={10000} marks={[-5, 3000, 99999]} onSeek={vi.fn()} />)
    expect(screen.getAllByTestId('scrub-mark')).toHaveLength(1)
  })

  it('không vẽ vạch nào khi journal rỗng', () => {
    render(<ScrubTrack value={0} max={10000} marks={[]} onSeek={vi.fn()} />)
    expect(screen.queryAllByTestId('scrub-mark')).toHaveLength(0)
  })

  it('đặt vạch đúng tỉ lệ phần trăm', () => {
    render(<ScrubTrack value={0} max={10000} marks={[2500]} onSeek={vi.fn()} />)
    expect(screen.getByTestId('scrub-mark')).toHaveStyle({ left: '25%' })
  })

  it('max bằng 0 không làm vỡ (chia cho 0)', () => {
    render(<ScrubTrack value={0} max={0} marks={[0]} onSeek={vi.fn()} />)
    expect(screen.queryAllByTestId('scrub-mark')).toHaveLength(0)
  })
})
