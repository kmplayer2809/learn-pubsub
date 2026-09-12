import { getBroker } from '../../brokers/registry'
import { useAppStore } from '../store'
import { useSimulation } from '../useSimulation'
import { activeStepIndex } from '../lesson/activeStep'
import { DesktopLayout } from './layouts/DesktopLayout'
import { MobileLayout } from './layouts/MobileLayout'
import { TabletLayout } from './layouts/TabletLayout'
import type { LayoutProps } from './layouts/types'
import { useIsMobile, useIsTablet } from './useMediaQuery'

export default function App() {
  const brokerId = useAppStore((s) => s.brokerId)
  const broker = getBroker(brokerId)
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = broker.lessons.find((l) => l.id === lessonId)
  const { state, issues, stepOnce, topology: simTopology, script: simScript } = useSimulation()
  // Hai hook media query gọi vô điều kiện, trước mọi nhánh return: số hook tại
  // call site này không được đổi theo broker hay theo viewport.
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  const inSandbox = sandbox && Boolean(broker.sandbox)

  if (!inSandbox && !lesson) return <div className="p-4 text-content">Không tìm thấy bài học.</div>

  const topology = inSandbox ? simTopology : lesson!.topology
  const script = inSandbox ? simScript : lesson!.script
  const durationMs = inSandbox ? broker.sandbox!.transportDurationMs : lesson!.durationMs
  // The canvas emphasises whatever the narrative step currently on screen names. Resolved
  // here for the same reason `topology`/`script` are: this is the one place that knows
  // whether a lesson or the sandbox is driving, and the sandbox has no narrative at all.
  const highlight = inSandbox
    ? undefined
    : lesson!.narrative[activeStepIndex(lesson!.narrative, state.now)]?.highlight

  const marks = state.journal.map((entry) => entry.at)

  const props: LayoutProps = {
    broker,
    lesson,
    state,
    issues,
    topology,
    script,
    highlight,
    durationMs,
    editable: inSandbox,
    inSandbox,
    onStep: stepOnce,
    marks,
  }

  if (isMobile) return <MobileLayout {...props} />
  if (isTablet) return <TabletLayout {...props} />
  return <DesktopLayout {...props} />
}
