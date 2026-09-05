import { getBroker } from '../../../brokers/registry'
import { useAppStore } from '../../store'
import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'

export function LessonSidebar({
  hideBrokerSwitcher = false,
}: {
  /**
   * Mobile và tablet đã có `BrokerSwitcher` riêng ở `TopBar` — `LessonSidebar` của
   * chúng (pane `lessons` trên mobile, drawer trên tablet) phải tắt bản của mình đi,
   * nếu không màn hình có hai broker picker sống cùng lúc (mobile: cả hai luôn hiện
   * chung một lượt; tablet: cả hai cùng hiện khi mở drawer ở 820px). Desktop không
   * có `TopBar`, nên không truyền prop này — mặc định `false` giữ nguyên y hệt bản
   * cũ, không đổi một pixel nào.
   */
  hideBrokerSwitcher?: boolean
} = {}) {
  const broker = getBroker(useAppStore((s) => s.brokerId))
  const lessonId = useAppStore((s) => s.lessonId)
  const sandbox = useAppStore((s) => s.sandbox)
  const setLesson = useAppStore((s) => s.setLesson)
  const openSandbox = useAppStore((s) => s.openSandbox)

  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-ink-950" data-testid="lesson-sidebar">
      {!hideBrokerSwitcher && <BrokerSwitcher />}
      <div className="flex-1 py-2">
        {broker.lessonGroups.map((group) => (
          <div key={group.id} className="mb-2">
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {group.label}
            </div>
            {broker.lessons.filter((l) => l.group === group.id).map((lesson) => {
              const active = !sandbox && lesson.id === lessonId
              return (
                <button
                  key={lesson.id}
                  onClick={() => setLesson(lesson.id)}
                  className={`block min-h-11 w-full border-l-2 px-3 py-1.5 text-left text-xs leading-snug md:min-h-0 ${
                    active
                      ? 'border-accent-400 bg-accent-500/10 font-medium text-accent-300'
                      : 'border-transparent text-ink-400 hover:border-ink-700 hover:bg-ink-900 hover:text-ink-200'
                  }`}
                >
                  {lesson.title}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {broker.sandbox && (
        <button
          onClick={openSandbox}
          className={`min-h-11 shrink-0 border-t border-ink-800/80 px-3 py-2 text-left text-xs font-medium md:min-h-0 ${
            sandbox ? 'bg-accent-500/10 text-accent-300' : 'text-ink-400 hover:bg-ink-900 hover:text-ink-200'
          }`}
          data-testid="open-sandbox"
        >
          Sandbox
        </button>
      )}
    </nav>
  )
}
