import { useAppStore, type MobilePane } from '../../store'
import { BookIcon, GaugeIcon, LayoutGridIcon } from '../icons'

const TABS: { id: MobilePane; label: string; Icon: typeof BookIcon }[] = [
  { id: 'lessons', label: 'Bài học', Icon: BookIcon },
  { id: 'canvas', label: 'Canvas', Icon: LayoutGridIcon },
  { id: 'state', label: 'Trạng thái', Icon: GaugeIcon },
]

export function MobileTabBar() {
  const pane = useAppStore((s) => s.mobilePane)
  const setPane = useAppStore((s) => s.setMobilePane)

  return (
    <div
      role="tablist"
      // `pb-safe` là utility tự viết trong `src/index.css`: iPhone có home
      // indicator chiếm ~34px dưới đáy, thiếu padding này thì tab cuối bị nuốt.
      className="flex shrink-0 border-t border-edge bg-surface/95 pb-safe backdrop-blur"
      data-testid="mobile-tabbar"
    >
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={pane === id}
          onClick={() => setPane(id)}
          className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 py-1 text-meta ${
            pane === id
              ? 'border-accent text-accent'
              : 'border-transparent text-content-faint active:bg-surface-hover'
          }`}
        >
          <Icon className={`h-[18px] w-[18px] ${pane === id ? 'text-accent' : 'text-content-faint'}`} />
          {label}
        </button>
      ))}
    </div>
  )
}
