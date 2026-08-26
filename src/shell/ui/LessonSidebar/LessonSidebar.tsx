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
    <nav className="flex h-full flex-col overflow-y-auto" data-testid="lesson-sidebar">
      {!hideBrokerSwitcher && <BrokerSwitcher />}
      {broker.lessonGroups.map((group) => (
        <div key={group.id} className="mb-3">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">
            {group.label}
          </div>
          {broker.lessons.filter((l) => l.group === group.id).map((lesson) => (
            <button
              key={lesson.id}
              onClick={() => setLesson(lesson.id)}
              className={`block min-h-11 w-full px-3 py-1.5 text-left text-xs md:min-h-0 ${
                !sandbox && lesson.id === lessonId
                  ? 'bg-slate-800 text-sky-300'
                  : 'text-slate-400 hover:bg-slate-900'
              }`}
            >
              {lesson.title}
            </button>
          ))}
        </div>
      ))}
      {broker.sandbox && (
        <button
          onClick={openSandbox}
          className={`mt-auto border-t border-slate-800 px-3 py-2 text-left text-xs ${
            sandbox ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:bg-slate-900'
          }`}
          data-testid="open-sandbox"
        >
          Sandbox
        </button>
      )}
    </nav>
  )
}
