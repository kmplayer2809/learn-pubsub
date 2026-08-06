import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineState, Simulation, Topology } from '../engine'
import * as engineModule from '../engine'
import { LESSONS } from '../lessons/registry'
import type { Lesson } from '../lessons/types'
import { useAppStore } from './store'
import { useSimulation } from './useSimulation'

const EMPTY_TOPOLOGY: Topology = { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] }

// A second, lesson-independent fixture used only for the "switching lessons"
// test. Its script deliberately starts after t=0 so a fresh build's initial
// advanceTo(0) processes nothing, leaving the journal empty at the reset point.
const lessonB: Lesson = {
  id: 'test-lesson-b',
  group: 'basics',
  title: 'Test lesson B',
  summary: 'Fixture lesson for useSimulation tests.',
  seed: 1,
  durationMs: 2_000,
  topology: EMPTY_TOPOLOGY,
  script: [],
  narrative: [],
}
if (!LESSONS.some((l) => l.id === lessonB.id)) LESSONS.push(lessonB)

let frameCallbacks: FrameRequestCallback[] = []
let nowMs = 0

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  frameCallbacks = []
  nowMs = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb)
    return frameCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Advances wall-clock by `ms` and runs every queued frame callback. In normal
 * operation exactly one callback is live at a time (the rAF loop always
 * requests its own next frame); if an effect churn ever leaves a second,
 * stale callback in the queue, it is a no-op because its closure's `stopped`
 * flag was already flipped by the cleanup that superseded it. Draining the
 * whole queue is therefore equivalent to "run exactly one live frame".
 */
function advanceFrame(ms: number) {
  nowMs += ms
  const callbacks = frameCallbacks
  frameCallbacks = []
  act(() => {
    callbacks.forEach((cb) => cb(nowMs))
  })
}

function cloneJournal(state: EngineState) {
  return JSON.parse(JSON.stringify(state.journal)) as EngineState['journal']
}

describe('useSimulation', () => {
  it('paused: driving frames does not advance virtual time or the snapshot now', () => {
    const { result, unmount } = renderHook(() => useSimulation())
    const initialNow = result.current.state.now

    advanceFrame(100)
    advanceFrame(100)

    expect(useAppStore.getState().playing).toBe(false)
    expect(useAppStore.getState().virtualTime).toBe(0)
    expect(result.current.state.now).toBe(initialNow)
    unmount()
  })

  it('playing advances virtual time by elapsed wall-clock times the speed multiplier', () => {
    const { unmount } = renderHook(() => useSimulation())

    act(() => {
      useAppStore.getState().setSpeed(2)
      useAppStore.getState().play()
    })
    advanceFrame(100)

    expect(useAppStore.getState().virtualTime).toBe(200)

    advanceFrame(100)
    expect(useAppStore.getState().virtualTime).toBe(400)
    unmount()
  })

  it('a halted run stops the loop and pauses (engine mocked; see report for the missing seam)', () => {
    // useSimulation hardcodes createSimulation({ ...lesson }) with no maxEvents
    // override and no way to inject a custom topology (lessonId only resolves
    // through the static lesson registry). There is no production seam to
    // drive a real event-ceiling halt through the hook without either
    // processing on the order of 10^5 events across tens of thousands of
    // simulated frames, or reaching into the registry. So this test mocks
    // createSimulation to prove the hook's *reaction* to `snapshot().halted`
    // becoming true; it does not exercise the real ceiling-tripping path
    // (that is already covered at the engine level by
    // src/engine/index.test.ts's "createSimulation runaway guard").
    const haltAtOrAfter = 150
    let now = 0
    let halted = false
    const fakeSim: Simulation = {
      advanceTo(t) {
        now = t
        if (t >= haltAtOrAfter) halted = true
      },
      stepOnce() {},
      reset() {
        now = 0
        halted = false
      },
      nextEventTime() {
        return undefined
      },
      snapshot(): EngineState {
        return {
          now,
          seq: 0,
          rng: { s: 1 },
          topology: EMPTY_TOPOLOGY,
          queues: {},
          unacked: {},
          roundRobin: {},
          inFlight: [],
          metrics: {
            published: 0,
            routed: 0,
            dropped: 0,
            delivered: 0,
            acked: 0,
            nacked: 0,
            deadLettered: 0,
            expired: 0,
            confirmed: 0,
          },
          journal: [],
          halted: halted ? { reason: 'event ceiling of 5 reached; the topology may loop' } : undefined,
          crashed: [],
          crashEpoch: {},
          messageCounter: 0,
        }
      },
      issues: [],
    }
    vi.spyOn(engineModule, 'createSimulation').mockReturnValue(fakeSim)

    const { unmount } = renderHook(() => useSimulation())
    act(() => {
      useAppStore.getState().play()
    })

    advanceFrame(100) // target=100, below threshold
    expect(useAppStore.getState().playing).toBe(true)

    advanceFrame(100) // target=200, trips the mocked halt
    expect(useAppStore.getState().playing).toBe(false)
    const virtualTimeAtHalt = useAppStore.getState().virtualTime
    expect(frameCallbacks.length).toBe(0) // loop did not request another frame

    advanceFrame(100) // nothing queued; must be a no-op
    expect(useAppStore.getState().virtualTime).toBe(virtualTimeAtHalt)
    expect(useAppStore.getState().playing).toBe(false)

    unmount()
  })

  it('reaching the end of the lesson pauses instead of looping forever', () => {
    const { result, unmount } = renderHook(() => useSimulation())

    act(() => {
      useAppStore.getState().setSpeed(4)
      useAppStore.getState().play()
    })

    // 100ms wall-clock * speed 4 = 400ms virtual per frame; hello-world's
    // durationMs is 12_000 and its script finishes well before that, so 35
    // frames (14_000ms virtual) comfortably drives past the end.
    for (let i = 0; i < 35; i++) advanceFrame(100)

    expect(useAppStore.getState().playing).toBe(false)
    expect(useAppStore.getState().virtualTime).toBeGreaterThan(12_000)
    expect(frameCallbacks.length).toBe(0)

    const vt = useAppStore.getState().virtualTime
    const now = result.current.state.now
    advanceFrame(100) // stopped loop must not request/consume another frame
    expect(useAppStore.getState().virtualTime).toBe(vt)
    expect(result.current.state.now).toBe(now)
    unmount()
  })

  it('rewind replays deterministically', () => {
    const { result, unmount } = renderHook(() => useSimulation())

    act(() => {
      useAppStore.getState().play()
    })
    // Advance to T1 = 2000ms virtual at 1x speed (100ms wall-clock per frame).
    for (let i = 0; i < 20; i++) advanceFrame(100)
    expect(useAppStore.getState().virtualTime).toBe(2000)

    act(() => {
      useAppStore.getState().pause()
    })
    const journalAtT1 = cloneJournal(result.current.state)
    const tokenBeforeRewind = useAppStore.getState().replayToken

    act(() => {
      useAppStore.getState().seek(500)
    })
    // A genuine rewind must actually rebuild and replay from zero: prove the
    // intermediate state really moved backwards rather than the seek being a
    // silent no-op that would let a weaker "journals eventually match" check
    // pass for the wrong reason.
    expect(useAppStore.getState().replayToken).toBe(tokenBeforeRewind + 1)
    expect(result.current.state.now).toBeLessThanOrEqual(500)
    expect(result.current.state.journal.length).toBeLessThan(journalAtT1.length)

    act(() => {
      useAppStore.getState().seek(2000)
    })
    expect(useAppStore.getState().virtualTime).toBe(2000)
    expect(cloneJournal(result.current.state)).toEqual(journalAtT1)

    unmount()
  })

  it('switching lessons resets to a clean state', () => {
    const { result, unmount } = renderHook(() => useSimulation())

    act(() => {
      useAppStore.getState().play()
    })
    for (let i = 0; i < 10; i++) advanceFrame(100)
    expect(useAppStore.getState().virtualTime).toBeGreaterThan(0)

    act(() => {
      useAppStore.getState().setLesson(lessonB.id)
    })

    expect(useAppStore.getState().virtualTime).toBe(0)
    expect(useAppStore.getState().playing).toBe(false)
    expect(result.current.state.journal).toEqual([])

    unmount()
  })
})
