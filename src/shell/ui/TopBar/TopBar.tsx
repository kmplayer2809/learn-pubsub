import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'
import { MenuIcon } from '../icons'

export function TopBar({ title, onOpenDrawer }: { title: string; onOpenDrawer?: () => void }) {
  return (
    <header
      // `pt-safe` bù cho Dynamic Island / notch khi trang chạy full-bleed.
      className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 bg-slate-950/95 px-2 pt-safe backdrop-blur"
      data-testid="top-bar"
    >
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          aria-label="Mở danh sách bài học"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 active:bg-slate-700"
        >
          <MenuIcon />
        </button>
      )}
      <BrokerSwitcher />
      <span className="min-w-0 flex-1 truncate text-right text-xs font-medium text-slate-400">{title}</span>
    </header>
  )
}
