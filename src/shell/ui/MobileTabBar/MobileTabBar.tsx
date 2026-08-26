import { useAppStore, type MobilePane } from '../../store'

const TABS: { id: MobilePane; label: string }[] = [
  { id: 'lessons', label: 'Bài học' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'state', label: 'Trạng thái' },
]

export function MobileTabBar() {
  const pane = useAppStore((s) => s.mobilePane)
  const setPane = useAppStore((s) => s.setMobilePane)

  return (
    <div
      role="tablist"
      // `pb-safe` là utility tự viết trong `src/index.css`: iPhone có home
      // indicator chiếm ~34px dưới đáy, thiếu padding này thì tab cuối bị nuốt.
      className="flex shrink-0 border-t border-slate-800 pb-safe"
      data-testid="mobile-tabbar"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={pane === tab.id}
          onClick={() => setPane(tab.id)}
          className={`min-h-11 flex-1 text-xs ${
            pane === tab.id ? 'bg-slate-800 text-sky-300' : 'text-slate-400'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
