import { getLesson } from '../lessons/registry'
import { SandboxPanel } from '../sandbox/SandboxPanel'
import { useSandboxStore } from '../sandbox/sandboxStore'
import { useAppStore } from '../sim/store'
import { useSimulation } from '../sim/useSimulation'
import { CanvasView } from './CanvasView/CanvasView'
import { InFlightPanel } from './canvas/InFlightPanel'
import { Inspector } from './Inspector/Inspector'
import { LessonSidebar } from './LessonSidebar/LessonSidebar'
import { Transport } from './Transport/Transport'

// Sandbox runs are open-ended (see useSimulation), but the transport scrubber
// still needs a finite range to draw; this matches the generator's fixed
// 60-second horizon plus headroom, mirroring how a lesson's own durationMs
// sizes the same control.
const SANDBOX_TRANSPORT_DURATION_MS = 60_000

export default function App() {
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = getLesson(lessonId)
  const { state, issues, stepOnce } = useSimulation()
  const sandboxTopology = useSandboxStore((s) => s.topology)
  const sandboxScript = useSandboxStore((s) => s.script)

  if (!sandbox && !lesson) return <div className="p-4 text-slate-200">Không tìm thấy bài học.</div>

  const topology = sandbox ? sandboxTopology : lesson!.topology
  const script = sandbox ? sandboxScript : lesson!.script
  const durationMs = sandbox ? SANDBOX_TRANSPORT_DURATION_MS : lesson!.durationMs

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800">
        <LessonSidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <CanvasView topology={topology} state={state} script={script} editable={sandbox} />
        </div>
        <div className="border-t border-slate-800">
          <InFlightPanel state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={durationMs} onStep={stepOnce} />
        </div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        {sandbox ? (
          <SandboxPanel state={state} issues={issues} />
        ) : (
          <Inspector lesson={lesson!} state={state} issues={issues} />
        )}
      </aside>
    </div>
  )
}
