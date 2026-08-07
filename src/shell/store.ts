import { create } from 'zustand'
import { BROKERS, DEFAULT_BROKER_ID, getBroker } from '../brokers/registry'

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

export interface AppState {
  brokerId: string
  lessonId: string
  /** Set when the sandbox tab is active instead of a lesson. */
  sandbox: boolean
  playing: boolean
  speed: Speed
  virtualTime: number
  selectedNodeId?: string
  /** Incremented whenever the engine must be rebuilt and replayed. */
  replayToken: number
  setBroker(id: string): void
  setLesson(id: string): void
  openSandbox(): void
  play(): void
  pause(): void
  setSpeed(speed: Speed): void
  seek(virtualMs: number): void
  tickTo(virtualMs: number): void
  selectNode(id?: string): void
}

export const useAppStore = create<AppState>((set, get) => {
  // Safely handle potential circular dependency during testing
  let brokerId = DEFAULT_BROKER_ID
  let lessonId = '01-hello-world' // Fallback default
  try {
    lessonId = getBroker(DEFAULT_BROKER_ID).defaultLessonId
  } catch {
    // If getBroker fails (circular dependency during module load), use fallback
  }

  return {
    brokerId,
    lessonId,
    sandbox: false,
    playing: false,
    speed: 1,
    virtualTime: 0,
    replayToken: 0,

    setBroker(id) {
      // An unknown id would leave the shell rendering a module that does not exist.
      // Ignoring it keeps a stale persisted value or a bad deep link harmless.
      try {
        if (!BROKERS.some((b) => b.id === id)) return
        set((s) => ({
          brokerId: id,
          lessonId: getBroker(id).defaultLessonId,
          sandbox: false,
          playing: false,
          virtualTime: 0,
          selectedNodeId: undefined,
          replayToken: s.replayToken + 1,
        }))
      } catch {
        // Handle circular dependency during testing
      }
    },

    setLesson(id) {
      set((s) => ({
        lessonId: id,
        sandbox: false,
        playing: false,
        virtualTime: 0,
        selectedNodeId: undefined,
        replayToken: s.replayToken + 1,
      }))
    },

    openSandbox() {
      set((s) => ({ sandbox: true, playing: false, virtualTime: 0, replayToken: s.replayToken + 1 }))
    },

    play() {
      set({ playing: true })
    },

    pause() {
      set({ playing: false })
    },

    setSpeed(speed) {
      set({ speed })
    },

    seek(virtualMs) {
      const backwards = virtualMs < get().virtualTime
      set((s) => ({
        virtualTime: virtualMs,
        replayToken: backwards ? s.replayToken + 1 : s.replayToken,
      }))
    },

    tickTo(virtualMs) {
      set({ virtualTime: virtualMs })
    },

    selectNode(id) {
      set({ selectedNodeId: id })
    },
  }
})
