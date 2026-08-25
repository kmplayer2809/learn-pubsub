import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetViewport, setViewportWidth } from '../../test/viewport'
import { useIsMobile, useIsTablet, useMediaQuery } from './useMediaQuery'

describe('useMediaQuery', () => {
  beforeEach(() => resetViewport())

  it('đọc đúng giá trị ngay lần render đầu, không nhấp nháy qua một lượt sai', () => {
    setViewportWidth(393)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('cập nhật khi viewport đổi', () => {
    setViewportWidth(1280)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => setViewportWidth(393))
    expect(result.current).toBe(true)
  })

  it('393px và 430px là mobile, 768px là tablet, 1024px là desktop', () => {
    const { result } = renderHook(() => ({ mobile: useIsMobile(), tablet: useIsTablet() }))

    act(() => setViewportWidth(393))
    expect(result.current).toEqual({ mobile: true, tablet: false })

    act(() => setViewportWidth(430))
    expect(result.current).toEqual({ mobile: true, tablet: false })

    act(() => setViewportWidth(768))
    expect(result.current).toEqual({ mobile: false, tablet: true })

    act(() => setViewportWidth(1024))
    expect(result.current).toEqual({ mobile: false, tablet: false })
  })

  it('gỡ listener khi unmount, không rò rỉ qua các test sau', () => {
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 500px)'))
    expect(result.current).toBe(false)
    unmount()
    // Không throw, và listener đã bị gỡ — nếu còn, React sẽ cảnh báo set state
    // trên component đã unmount ở dòng dưới.
    act(() => setViewportWidth(400))
  })
})
