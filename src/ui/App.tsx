import { CanvasView } from './CanvasView/CanvasView'
import { useSimulation } from '../sim/useSimulation'

export default function App() {
  const { state } = useSimulation()

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800 p-3" data-testid="lesson-sidebar">
        Lessons
      </aside>
      <main className="flex min-w-0 flex-1 flex-col" data-testid="canvas-column">
        <div className="flex-1">
          <CanvasView topology={state.topology} state={state} />
        </div>
        <div className="h-14 border-t border-slate-800" data-testid="transport" />
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3" data-testid="inspector">
        Inspector
      </aside>
    </div>
  )
}
