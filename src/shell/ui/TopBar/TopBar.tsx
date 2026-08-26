import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'

export function TopBar({ title, onOpenDrawer }: { title: string; onOpenDrawer?: () => void }) {
  return (
    <header
      // `pt-safe` bù cho Dynamic Island / notch khi trang chạy full-bleed.
      className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-2 pt-safe"
      data-testid="top-bar"
    >
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          aria-label="Mở danh sách bài học"
          className="min-h-11 min-w-11 rounded text-slate-300 hover:bg-slate-800"
        >
          ☰
        </button>
      )}
      <BrokerSwitcher />
      <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{title}</span>
    </header>
  )
}
