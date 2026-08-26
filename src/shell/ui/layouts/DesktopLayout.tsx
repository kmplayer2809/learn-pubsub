import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function DesktopLayout(props: LayoutProps) {
  const { broker, topology, state, script, highlight, editable, durationMs, onStep } = props
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800">
        <LessonSidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <CanvasView
            broker={broker}
            topology={topology}
            state={state}
            script={script}
            highlight={highlight}
            editable={editable}
          />
        </div>
        <div className="border-t border-slate-800">
          <StatePanel state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={durationMs} onStep={onStep} />
        </div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        <SidePanel {...props} />
      </aside>
    </div>
  )
}
