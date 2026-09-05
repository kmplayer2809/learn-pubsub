import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function DesktopLayout(props: LayoutProps) {
  const { broker, topology, state, script, highlight, editable, durationMs, onStep } = props
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full bg-ink-950 text-ink-100">
      <aside className="w-64 shrink-0 border-r border-ink-800/80 bg-ink-950">
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
        <div className="border-t border-ink-800/80 bg-ink-950">
          <StatePanel state={state} />
        </div>
        <Transport durationMs={durationMs} onStep={onStep} />
      </main>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-ink-800/80 bg-ink-950 p-3.5">
        <SidePanel {...props} />
      </aside>
    </div>
  )
}
