import { getBroker } from '../../../brokers/registry'
import { useAppStore } from '../../store'
import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'

export function LessonSidebar() {
  const broker = getBroker(useAppStore((s) => s.brokerId))
  const lessonId = useAppStore((s) => s.lessonId)
  const sandbox = useAppStore((s) => s.sandbox)
  const setLesson = useAppStore((s) => s.setLesson)
  const openSandbox = useAppStore((s) => s.openSandbox)

  return (
    <nav className="flex h-full flex-col overflow-y-auto" data-testid="lesson-sidebar">
      <BrokerSwitcher />
      <div className="px-3 py-3 text-sm font-semibold text-slate-200">{broker.label}</div>
      {broker.lessonGroups.map((group) => (
        <div key={group.id} className="mb-3">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">
            {group.label}
          </div>
          {broker.lessons.filter((l) => l.group === group.id).map((lesson) => (
            <button
              key={lesson.id}
              onClick={() => setLesson(lesson.id)}
              className={`block w-full px-3 py-1.5 text-left text-xs ${
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
