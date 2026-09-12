import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'
import { ThemeToggle } from '../ThemeToggle/ThemeToggle'
import { MenuIcon } from '../icons'

export function TopBar({
  title,
  onOpenDrawer,
  showBrand = false,
}: {
  title: string
  onOpenDrawer?: () => void
  /** Chỉ desktop. Ở 390px, brand + switcher + tiêu đề + toggle không đủ chỗ, và
   *  tiêu đề bài học là thứ người học cần thấy hơn tên app. */
  showBrand?: boolean
}) {
  return (
    <header
      // `pt-safe` bù cho Dynamic Island / notch khi trang chạy full-bleed.
      className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-surface/95 px-2 pt-safe backdrop-blur"
      data-testid="top-bar"
    >
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          aria-label="Mở danh sách bài học"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-content-muted hover:bg-surface-hover active:bg-surface-hover"
        >
          <MenuIcon />
        </button>
      )}
      {showBrand && (
        <span className="shrink-0 px-1 text-ui font-semibold text-content-strong">Broker Visualizer</span>
      )}
      <BrokerSwitcher />
      <span className="min-w-0 flex-1 truncate text-right text-meta font-medium text-content-muted">{title}</span>
      <ThemeToggle />
    </header>
  )
}
