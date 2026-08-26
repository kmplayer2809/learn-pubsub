import { useAppStore } from '../../store'
import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { TopBar } from '../TopBar/TopBar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function TabletLayout(props: LayoutProps) {
  const { broker, lesson, topology, state, script, highlight, editable, durationMs, onStep, inSandbox } = props
  const drawerOpen = useAppStore((s) => s.drawerOpen)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <TopBar
        title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
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
            <StatePanel state={state} dense />
          </div>
          <div className="border-t border-slate-800">
            <Transport durationMs={durationMs} onStep={onStep} />
          </div>
        </main>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-800 p-3">
          <SidePanel {...props} />
        </aside>
      </div>

      {drawerOpen && (
        <>
          {/* Backdrop nhận chạm để đóng. `aria-hidden` vì nó không mang nội dung —
              nút đóng thật là hamburger ở TopBar và bản thân việc chọn lesson. */}
          <div
            aria-hidden
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-10 bg-slate-950/70"
          />
          <aside className="fixed inset-y-0 left-0 z-20 w-64 border-r border-slate-800 bg-slate-950">
            <LessonSidebar hideBrokerSwitcher />
          </aside>
        </>
      )}
    </div>
  )
}
