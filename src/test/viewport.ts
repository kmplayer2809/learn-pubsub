// jsdom không có `window.matchMedia`. `useMediaQuery` gọi nó ở mọi lần render, nên
// mọi test mount `App` sẽ throw nếu thiếu. Stub này parse `min-width`/`max-width`
// của query so với một chiều rộng giả đổi được bằng `setViewportWidth`, nên test
// mô phỏng được iPhone mà không cần môi trường trình duyệt thật.
let currentWidth = 1280
const listeners = new Set<() => void>()

/** Chiều rộng mặc định — desktop. Mọi test cũ vì thế không phải sửa một dòng nào. */
const DEFAULT_WIDTH = 1280

function queryMatches(query: string): boolean {
  const min = query.match(/min-width:\s*(\d+)px/)
  const max = query.match(/max-width:\s*(\d+)px/)
  if (min && currentWidth < Number(min[1])) return false
  if (max && currentWidth > Number(max[1])) return false
  return true
}

export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    // Getter, không phải giá trị chốt lúc tạo: `useSyncExternalStore` gọi
    // `matchMedia(query).matches` mỗi lần lấy snapshot, và phải thấy chiều rộng
    // hiện tại chứ không phải chiều rộng lúc object này ra đời.
    get matches() {
      return queryMatches(query)
    },
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: () => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: () => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** Gọi trong `act(...)` — nó bắn listener và làm React render lại. */
export function setViewportWidth(width: number): void {
  currentWidth = width
  for (const listener of listeners) listener()
}

export function resetViewport(): void {
  setViewportWidth(DEFAULT_WIDTH)
}
