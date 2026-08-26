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
    // Bản cũ chỉ khẳng định `setViewportWidth` sau `unmount()` không throw — điều
    // này đúng y hệt cả khi hàm cleanup của effect bị xoá hẳn, vì `installMatchMedia`
    // bắn listener bằng cách lặp qua `Set`, và `Set.forEach` không throw dù listener
    // gọi `setState` trên component đã unmount. Bọc `addEventListener`/
    // `removeEventListener` của mock để bắt đúng listener nào được gỡ, thay vì suy
    // luận gián tiếp qua việc không throw.
    const original = window.matchMedia
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    window.matchMedia = ((query: string) => {
      const list = original(query)
      const realAdd = list.addEventListener.bind(list)
      const realRemove = list.removeEventListener.bind(list)
      list.addEventListener = (...args: Parameters<typeof realAdd>) => {
        addEventListener(...args)
        realAdd(...args)
      }
      list.removeEventListener = (...args: Parameters<typeof realRemove>) => {
        removeEventListener(...args)
        realRemove(...args)
      }
      return list
    }) as typeof window.matchMedia

    try {
      const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 500px)'))
      expect(result.current).toBe(false)
      expect(addEventListener).toHaveBeenCalledTimes(1)
      const [, handler] = addEventListener.mock.calls[0] ?? []

      unmount()

      expect(removeEventListener).toHaveBeenCalledTimes(1)
      const [, removedHandler] = removeEventListener.mock.calls[0] ?? []
      expect(removedHandler).toBe(handler)

      // Không throw, và listener đã thực sự bị gỡ khỏi `Set` bên dưới — nếu còn,
      // React sẽ cảnh báo set state trên component đã unmount ở dòng dưới.
      act(() => setViewportWidth(400))
    } finally {
      window.matchMedia = original
    }
  })
})
