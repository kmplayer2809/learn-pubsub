import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { TopBar } from '../TopBar/TopBar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function DesktopLayout(props: LayoutProps) {
  const { broker, lesson, topology, state, script, highlight, editable, durationMs, onStep, inSandbox } = props
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full flex-col bg-canvas text-content">
      <TopBar title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')} showBrand />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[272px] shrink-0 border-r border-edge bg-surface">
          <LessonSidebar hideBrokerSwitcher />
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
          <div className="border-t border-edge bg-surface">
            <StatePanel state={state} />
          </div>
          <Transport durationMs={durationMs} onStep={onStep} />
        </main>
        <aside className="w-96 shrink-0 border-l border-edge bg-surface p-3.5">
          <SidePanel {...props} />
        </aside>
      </div>
    </div>
  )
}
