import { getLesson } from '../lessons/registry'
import { useAppStore } from '../sim/store'
import { useSimulation } from '../sim/useSimulation'
import { CanvasView } from './CanvasView/CanvasView'
import { InFlightPanel } from './canvas/InFlightPanel'
import { Inspector } from './Inspector/Inspector'
import { LessonSidebar } from './LessonSidebar/LessonSidebar'
import { Transport } from './Transport/Transport'

export default function App() {
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = getLesson(lessonId)
  const { state, issues, stepOnce } = useSimulation()

  if (!lesson) return <div className="p-4 text-slate-200">Không tìm thấy bài học.</div>

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800">
        <LessonSidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <CanvasView topology={lesson.topology} state={state} script={lesson.script} />
        </div>
        <div className="border-t border-slate-800">
          <InFlightPanel state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={lesson.durationMs} onStep={stepOnce} />
        </div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        <Inspector lesson={lesson} state={state} issues={issues} />
      </aside>
    </div>
  )
}
