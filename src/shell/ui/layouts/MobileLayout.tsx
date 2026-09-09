import { useAppStore } from '../../store'
import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { MobileTabBar } from '../MobileTabBar/MobileTabBar'
import { TopBar } from '../TopBar/TopBar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function MobileLayout(props: LayoutProps) {
  const { broker, lesson, topology, state, script, highlight, editable, durationMs, onStep, inSandbox } = props
  const pane = useAppStore((s) => s.mobilePane)
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full flex-col bg-canvas text-content-strong">
      <TopBar title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')} />

      <div className="min-h-0 flex-1">
        {pane === 'lessons' && <LessonSidebar hideBrokerSwitcher />}

        {pane === 'canvas' && (
          <div className="flex h-full flex-col">
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
            <div className="border-t border-edge">
              <StatePanel state={state} dense />
            </div>
          </div>
        )}

        {pane === 'state' && (
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="border-b border-edge">
              <StatePanel state={state} />
            </div>
            <div className="min-h-0 flex-1 p-3">
              <SidePanel {...props} />
            </div>
          </div>
        )}
      </div>

      {/* Transport nằm ngoài khối pane: tua thời gian ảo là hành động xuyên suốt,
          ẩn nó ở tab `lessons`/`state` là lấy mất khả năng điều khiển mô phỏng
          đang xem. */}
      <Transport durationMs={durationMs} onStep={onStep} compact />
      <MobileTabBar />
    </div>
  )
}
