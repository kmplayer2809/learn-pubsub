import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getBroker } from '../brokers/registry'
import type { AnyBrokerModule } from '../brokers/types'
import type { Simulation } from './kernel/run'
import type { KernelState, ValidationIssueBase } from './kernel/types'
import { useAppStore } from './store'

export interface SimulationView {
  state: KernelState
  issues: ValidationIssueBase[]
  /**
   * The topology/script actually driving the current run — a lesson's fixed pair, or
   * the sandbox draft. `App` reads these instead of resolving sandbox state itself:
   * that resolution already happens once per render here (`useRunInput`, via a fixed
   * pair of `useSyncExternalStore` calls), so exposing it avoids a second, App-owned
   * hook whose count would vary with whether the active broker has a sandbox.
   */
  topology: unknown
  script: unknown[]
  stepOnce(): void
}

// A broker with no sandbox at all still has to fill this hook slot: `useSyncExternalStore`
// below is called unconditionally on every render regardless of which broker is active, so
// there must always be *some* subscribe/getter pair to hand it. This one never notifies and
// always reads back "nothing" — indistinguishable, from the caller's point of view, from a
// broker that genuinely has no sandbox.
// Hoisted so `getScript` below always returns this exact reference: `useSyncExternalStore`
// compares successive snapshots with `Object.is`, and a fresh `[]` literal returned on every
// call would never be `Object.is`-equal to the previous one, forcing React into an infinite
// re-render loop the moment a broker with no sandbox becomes active.
// The same reference is also the "no lesson script" fallback in `useRunInput` below, for the
// same reason applied to an effect dependency array instead of a snapshot comparison.
const EMPTY_SCRIPT: never[] = []

const NO_SANDBOX = {
  subscribe: () => () => {},
  getTopology: () => undefined,
  getScript: () => EMPTY_SCRIPT,
}

/**
 * Resolves what the engine should run: a lesson's fixed script, or the sandbox draft.
 *
 * Reads the sandbox draft through `useSyncExternalStore` rather than a broker-supplied hook.
 * `BrokerSandbox` used to expose `useTopology()`/`useScript()` as hooks and this function
 * called them behind `broker.sandbox?.`; that is a call whose *contents* change shape when
 * `broker.sandbox` flips between present and absent (a real broker's hook calls its own
 * internal primitives — Zustand's `useStore` alone is two `useCallback`s, a
 * `useSyncExternalStore`, and a `useDebugValue` — while a no-op placeholder calls nothing).
 * Two renders of the *same* useSimulation instance are exactly the case a broker switch
 * produces (see the "rebuilds when the broker changes" test, which mutates the store on an
 * already-mounted hook, no unmount in between) so "the tree remounts on a broker switch" is
 * not something this function can lean on.
 *
 * `useSyncExternalStore(subscribe, getSnapshot)` sidesteps the problem instead of arguing it
 * away: it is called exactly twice, unconditionally, at the same two call sites, on every
 * render, for the entire lifetime of this hook instance. Only the `subscribe`/`getSnapshot`
 * *values* passed in change when the active broker changes — precisely the same thing that
 * happens when a `useSelector` call site is pointed at a different slice, which every React
 * app already relies on being safe. The broker no longer supplies a hook, only plain
 * functions, so it can no longer vary the number of hooks this call site costs.
 */
function useRunInput(broker: AnyBrokerModule) {
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)

  const accessors = broker.sandbox ?? NO_SANDBOX
  const sandboxTopology = useSyncExternalStore(accessors.subscribe, accessors.getTopology) ?? broker.emptyTopology
  const sandboxScript = useSyncExternalStore(accessors.subscribe, accessors.getScript)

  const lesson = broker.lessons.find((l) => l.id === lessonId)

  if (sandbox && broker.sandbox) {
    return {
      topology: sandboxTopology,
      script: sandboxScript,
      failures: undefined,
      seed: 1,
      maxEvents: broker.sandbox.maxEvents,
      durationMs: Infinity,
    }
  }
  return {
    topology: lesson?.topology ?? broker.emptyTopology,
    // EMPTY_SCRIPT, not a fresh `[]`: this value lands in the rebuild effect's dependency
    // array below, so a new array identity on every render rebuilds the simulation on
    // every render, forever. React's "Maximum update depth exceeded" guard does not catch
    // it either — the `setView` sits in a passive effect whose deps genuinely changed — so
    // it runs until the heap dies. `lesson` is undefined whenever `lessonId` names no
    // lesson in the active broker (`Lesson.script` is required, so a lesson without a
    // script cannot exist), and `App`'s "Không tìm thấy bài học." early return does not
    // protect this: `useSimulation()` is called before it.
    script: lesson?.script ?? EMPTY_SCRIPT,
    failures: (lesson as { failures?: unknown[] } | undefined)?.failures,
    seed: lesson?.seed ?? 0,
    maxEvents: undefined,
    durationMs: lesson?.durationMs ?? Infinity,
  }
}

export function useSimulation(): SimulationView {
  const broker = getBroker(useAppStore((s) => s.brokerId))
  const sandbox = useAppStore((s) => s.sandbox)
  const replayToken = useAppStore((s) => s.replayToken)
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const tickTo = useAppStore((s) => s.tickTo)
  const pause = useAppStore((s) => s.pause)

  const input = useRunInput(broker)

  const simRef = useRef<(Simulation<KernelState> & { readonly issues: ValidationIssueBase[] }) | null>(null)
  // Deliberately narrower than SimulationView: topology/script come from `input`, which
  // is already recomputed every render, so there's no need to carry a copy through state.
  //
  // `brokerId` rides along with the snapshot because the two are only ever produced
  // together, by the same `broker.createSimulation` call below. Without it, a broker
  // switch renders once with the *new* broker (recomputed synchronously above) paired
  // with `view.state` still holding the *previous* broker's snapshot — the rebuild only
  // happens in the effect below, which fires after this render, not before it. Every
  // consumer of this hook's return value (`CanvasView.toNodes`/`.toEdges`/`.inFlight`,
  // `StatePanel`, `Inspector.metrics`) takes the *current* broker as a separate argument,
  // so a mismatch here means the wrong module is asked to interpret a snapshot it never
  // produced.
  const [view, setView] = useState<{
    brokerId: string
    state: KernelState
    issues: ValidationIssueBase[]
    stepOnce(): void
  } | null>(null)

  // Build (or rebuild) the engine. replayToken changes on seek-backwards, lesson switches,
  // and broker switches, which is exactly when a replay from zero is required. This is the
  // entire rewind implementation: reset() then advanceTo(target).
  //
  // In sandbox mode there is no replayToken bump on every edit — the sandbox
  // topology/script object identity changes on every store mutation instead (the store
  // behind `useSyncExternalStore` always produces a new object on `set`), so listing them
  // as deps here is what makes "rebuild whenever either changes" happen.
  useEffect(() => {
    const sim = broker.createSimulation({
      topology: input.topology,
      script: input.script,
      failures: input.failures,
      seed: input.seed,
      maxEvents: input.maxEvents,
    })
    sim.advanceTo(useAppStore.getState().virtualTime)
    simRef.current = sim
    setView({ brokerId: broker.id, state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
  }, [broker, sandbox, replayToken, input.topology, input.script, input.failures, input.seed, input.maxEvents])

  // Advance on seek while paused, so scrubbing updates the canvas immediately.
  useEffect(() => {
    const sim = simRef.current
    if (!sim || playing) return
    sim.advanceTo(virtualTime)
    setView({ brokerId: broker.id, state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
  }, [virtualTime, playing, broker.id])

  // The rAF loop: virtual time only ever moves forward here. Pausing simply
  // stops calling advanceTo, which freezes particle positions since they are
  // derived from virtual time rather than any wall-clock CSS animation.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    let stopped = false

    // Sandbox runs are open-ended: nothing "finishes" a free-form topology, so
    // useRunInput reports Infinity for it, and there is no duration past which
    // the loop should auto-pause.
    const durationMs = input.durationMs

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
        setView({ brokerId: broker.id, state: snapshot, issues: sim.issues, stepOnce: () => {} })

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
  }, [playing, speed, input.durationMs, tickTo, pause, broker.id])

  const stepOnce = () => {
    const sim = simRef.current
    if (!sim) return
    sim.stepOnce()
    tickTo(sim.snapshot().now)
    setView({ brokerId: broker.id, state: sim.snapshot(), issues: sim.issues, stepOnce })
  }

  // A mismatch here (view built for a broker that is no longer active) is exactly the
  // "nothing built yet" case below: fall through to a fresh build from the *current*
  // broker/input so this render never hands one module's state to another's components.
  // The rebuild effect above will supersede it with the persisted view on the next render.
  if (view && view.brokerId === broker.id) {
    return { ...view, stepOnce, topology: input.topology, script: input.script }
  }

  const fallback = broker.createSimulation(sandbox ? input : { ...input, script: [], seed: 0 })
  return {
    state: fallback.snapshot(),
    issues: fallback.issues,
    stepOnce,
    topology: input.topology,
    script: input.script,
  }
}
