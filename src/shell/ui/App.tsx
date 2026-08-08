import { getBroker } from '../../brokers/registry'
import { useAppStore } from '../store'
import { useSimulation } from '../useSimulation'
import { CanvasView } from './CanvasView/CanvasView'
import { activeStepIndex } from '../lesson/activeStep'
import { Inspector } from './Inspector/Inspector'
import { LessonSidebar } from './LessonSidebar/LessonSidebar'
import { Transport } from './Transport/Transport'

export default function App() {
  const brokerId = useAppStore((s) => s.brokerId)
  const broker = getBroker(brokerId)
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = broker.lessons.find((l) => l.id === lessonId)
  const { state, issues, stepOnce, topology: simTopology, script: simScript } = useSimulation()
  const inSandbox = sandbox && Boolean(broker.sandbox)

  if (!inSandbox && !lesson) return <div className="p-4 text-slate-200">Không tìm thấy bài học.</div>

  const topology = inSandbox ? simTopology : lesson!.topology
  const script = inSandbox ? simScript : lesson!.script
  const durationMs = inSandbox ? broker.sandbox!.transportDurationMs : lesson!.durationMs
  // The canvas emphasises whatever the narrative step currently on screen names. Resolved
  // here for the same reason `topology`/`script` are: this is the one place that knows
  // whether a lesson or the sandbox is driving, and the sandbox has no narrative at all.
  const highlight = inSandbox
    ? undefined
    : lesson!.narrative[activeStepIndex(lesson!.narrative, state.now)]?.highlight
  const StatePanel = broker.StatePanel
  const SandboxPanel = broker.sandbox?.Panel

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
            editable={inSandbox}
          />
        </div>
        <div className="border-t border-slate-800">
          <StatePanel state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={durationMs} onStep={stepOnce} />
        </div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        {inSandbox && SandboxPanel ? (
          <SandboxPanel state={state} issues={issues} />
        ) : (
          <Inspector broker={broker} lesson={lesson!} state={state} issues={issues} />
        )}
      </aside>
    </div>
  )
}
