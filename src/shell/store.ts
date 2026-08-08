import { create } from 'zustand'
import { BROKER_CATALOG, DEFAULT_BROKER_ID, catalogEntry } from '../brokers/catalog'

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
  const brokerId = DEFAULT_BROKER_ID
  const lessonId = catalogEntry(DEFAULT_BROKER_ID).defaultLessonId

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
      if (!BROKER_CATALOG.some((b) => b.id === id)) return
      set((s) => ({
        brokerId: id,
        lessonId: catalogEntry(id).defaultLessonId,
        sandbox: false,
        playing: false,
        virtualTime: 0,
        selectedNodeId: undefined,
        replayToken: s.replayToken + 1,
      }))
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
