import { create } from 'zustand'

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

export interface AppState {
  lessonId: string
  /** Set when the sandbox tab is active instead of a lesson. */
  sandbox: boolean
  playing: boolean
  speed: Speed
  virtualTime: number
  selectedNodeId?: string
  /** Incremented whenever the engine must be rebuilt and replayed. */
  replayToken: number
  setLesson(id: string): void
  openSandbox(): void
  play(): void
  pause(): void
  setSpeed(speed: Speed): void
  seek(virtualMs: number): void
  tickTo(virtualMs: number): void
  selectNode(id?: string): void
}

export const useAppStore = create<AppState>((set, get) => ({
  lessonId: '01-hello-world',
  sandbox: false,
  playing: false,
  speed: 1,
  virtualTime: 0,
  replayToken: 0,

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
}))
