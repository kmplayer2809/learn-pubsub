import { useCallback, useSyncExternalStore } from 'react'

export const MOBILE_QUERY = '(max-width: 767px)'
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'

/**
 * `useSyncExternalStore` chứ không phải `useState` + `useEffect`: cách sau render
 * lượt đầu bằng giá trị mặc định rồi mới sửa trong effect, nên ở mobile màn hình
 * chớp qua desktop layout một frame — và ở test, lượt render đầu trả sai.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  // Snapshot cho server: app này chỉ chạy trong browser, nhưng đối số thứ ba là
  // bắt buộc và trả `false` giữ desktop làm mặc định an toàn nhất.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

export function useIsTablet(): boolean {
  return useMediaQuery(TABLET_QUERY)
}
