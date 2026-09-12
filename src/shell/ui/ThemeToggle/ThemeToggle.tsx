import { useAppStore } from '../../store'
import { MoonIcon, SunIcon } from '../icons'

/**
 * `aria-pressed` chứ không phải hai nút riêng: đây là một công tắc hai trạng thái,
 * và screen reader đọc được trạng thái hiện tại mà không cần chữ phụ. Icon hiển
 * thị là icon của theme sẽ chuyển tới, không phải theme đang dùng — nút cho biết
 * bấm vào sẽ được gì.
 */
export function ThemeToggle() {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  return (
    <button
      onClick={toggleTheme}
      aria-label="Đổi giao diện sáng/tối"
      aria-pressed={theme === 'dark'}
      data-testid="theme-toggle"
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-content-muted hover:bg-surface-hover hover:text-content-strong active:bg-surface-hover md:min-h-9 md:min-w-9"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
