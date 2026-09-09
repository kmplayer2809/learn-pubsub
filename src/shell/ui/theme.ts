/**
 * Đọc/ghi theme. Tách khỏi store và khỏi React vì cùng một logic phải chạy ở hai
 * nơi: script đồng bộ trong `index.html` (bản chép tay, không import được) và
 * store lúc khởi tạo. Giữ nó thuần để test được mà không dựng component.
 */
export type Theme = 'light' | 'dark'

const KEY = 'theme'

/**
 * `localStorage` ném `SecurityError` ở Safari private mode. Mọi lần chạm vào nó
 * trong file này đều phải bọc try/catch — một exception chưa bắt lúc khởi tạo
 * store làm trắng cả trang.
 */
export function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

export function resolveInitialTheme(): Theme {
  const stored = readStoredTheme()
  if (stored) return stored
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  // DOM trước, storage sau: nếu storage ném lỗi thì giao diện vẫn đổi đúng.
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* private mode — lựa chọn không sống qua reload, giao diện vẫn đúng */
  }
}
