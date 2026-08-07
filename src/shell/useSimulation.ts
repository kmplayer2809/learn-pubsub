import { useEffect, useRef, useState } from 'react'
import { createSimulation, type EngineState, type Simulation, type ValidationIssue } from '../brokers/rabbitmq/engine'
import { getLesson } from '../brokers/rabbitmq/lessons/registry'
import { useSandboxStore } from '../brokers/rabbitmq/sandbox/sandboxStore'
import { useAppStore } from './store'

export interface SimulationView {
  state: EngineState
  issues: ValidationIssue[]
  stepOnce(): void
}

const EMPTY_TOPOLOGY = { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] }

// A user-built topology can loop (a DLX pointing back into its own source
// exchange is one keystroke away), and unlike a lesson script the sandbox has
// no author vetting it. Lowering the ceiling here means a runaway trips and
// surfaces state.halted well before it can bog down the tab.
const SANDBOX_MAX_EVENTS = 20_000

export function useSimulation(): SimulationView {
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const replayToken = useAppStore((s) => s.replayToken)
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const tickTo = useAppStore((s) => s.tickTo)
  const pause = useAppStore((s) => s.pause)

  const sandboxTopology = useSandboxStore((s) => s.topology)
  const sandboxScript = useSandboxStore((s) => s.script)

  const simRef = useRef<(Simulation<EngineState> & { readonly issues: ValidationIssue[] }) | null>(null)
  const [view, setView] = useState<SimulationView | null>(null)

  // Build (or rebuild) the engine. replayToken changes on seek-backwards and
  // lesson switches, which is exactly when a replay from zero is required.
  // This is the entire rewind implementation: reset() then advanceTo(target).
  //
  // In sandbox mode there is no replayToken bump on every edit — the sandbox
  // topology/script object identity changes on every store mutation instead
  // (Zustand's `set` always produces a new object), so listing them as deps
  // here is what makes "rebuild whenever either changes" happen.
  useEffect(() => {
    const sim = sandbox
      ? createSimulation({
          topology: sandboxTopology,
          script: sandboxScript,
          seed: 1,
          maxEvents: SANDBOX_MAX_EVENTS,
        })
      : (() => {
          const lesson = getLesson(lessonId)
          if (!lesson) return undefined
          return createSimulation({
            topology: lesson.topology,
            script: lesson.script,
            failures: lesson.failures,
            seed: lesson.seed,
          })
        })()
    if (!sim) return
    sim.advanceTo(useAppStore.getState().virtualTime)
    simRef.current = sim
    setView({ state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
  }, [sandbox, lessonId, replayToken, sandboxTopology, sandboxScript])

  // Advance on seek while paused, so scrubbing updates the canvas immediately.
  useEffect(() => {
    const sim = simRef.current
    if (!sim || playing) return
    sim.advanceTo(virtualTime)
    setView({ state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
  }, [virtualTime, playing])

  // The rAF loop: virtual time only ever moves forward here. Pausing simply
  // stops calling advanceTo, which freezes particle positions since they are
  // derived from virtual time rather than any wall-clock CSS animation.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    let stopped = false

    // Sandbox runs are open-ended: nothing "finishes" a free-form topology,
    // so there is no duration past which the loop should auto-pause.
    const lesson = getLesson(lessonId)
    const durationMs = sandbox ? Infinity : (lesson?.durationMs ?? Infinity)

    const loop = (now: number) => {
      if (stopped) return
      const sim = simRef.current
      if (sim) {
        const deltaMs = Math.min(now - last, 100) * speed
        last = now
        const target = useAppStore.getState().virtualTime + deltaMs
        sim.advanceTo(target)
        const snapshot = sim.snapshot()
        tickTo(target)
        setView({ state: snapshot, issues: sim.issues, stepOnce: () => {} })

        // A halted run (event ceiling tripped) must stop the loop rather than
        // spin forever repainting a frozen simulation.
        if (snapshot.halted) {
          stopped = true
          pause()
          return
        }
        // Reaching the end of the lesson pauses rather than keeps running;
        // the user can still scrub back with seek().
        if (target > durationMs && sim.nextEventTime() === undefined) {
          stopped = true
          pause()
          return
        }
      } else {
        last = now
      }
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [playing, speed, lessonId, sandbox, tickTo, pause])

  const stepOnce = () => {
    const sim = simRef.current
    if (!sim) return
    sim.stepOnce()
    tickTo(sim.snapshot().now)
    setView({ state: sim.snapshot(), issues: sim.issues, stepOnce })
  }

  if (view) return { ...view, stepOnce }

  const lesson = getLesson(lessonId)
  const fallback = sandbox
    ? createSimulation({
        topology: sandboxTopology,
        script: sandboxScript,
        seed: 1,
        maxEvents: SANDBOX_MAX_EVENTS,
      })
    : createSimulation({
        topology: lesson?.topology ?? EMPTY_TOPOLOGY,
        script: [],
        seed: 0,
      })
  return { state: fallback.snapshot(), issues: fallback.issues, stepOnce }
}
