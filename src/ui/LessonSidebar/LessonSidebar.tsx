import { LESSON_GROUPS, lessonsByGroup } from '../../brokers/rabbitmq/lessons/registry'
import { useAppStore } from '../../sim/store'

export function LessonSidebar() {
  const lessonId = useAppStore((s) => s.lessonId)
  const sandbox = useAppStore((s) => s.sandbox)
  const setLesson = useAppStore((s) => s.setLesson)
  const openSandbox = useAppStore((s) => s.openSandbox)

  return (
    <nav className="flex h-full flex-col overflow-y-auto" data-testid="lesson-sidebar">
      <div className="px-3 py-3 text-sm font-semibold text-slate-200">RabbitMQ Visualizer</div>
      {LESSON_GROUPS.map((group) => (
        <div key={group.id} className="mb-3">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">
            {group.label}
          </div>
          {lessonsByGroup(group.id).map((lesson) => (
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
      <button
        onClick={openSandbox}
        className={`mt-auto border-t border-slate-800 px-3 py-2 text-left text-xs ${
          sandbox ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:bg-slate-900'
        }`}
        data-testid="open-sandbox"
      >
        Sandbox
      </button>
    </nav>
  )
}
