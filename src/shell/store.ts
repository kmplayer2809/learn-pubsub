import { create } from 'zustand'
import { BROKER_CATALOG, DEFAULT_BROKER_ID, catalogEntry } from '../brokers/catalog'
import { readProgress, recordScore, writeProgress, type Progress } from './quiz/progress'
import { applyTheme, resolveInitialTheme, type Theme } from './ui/theme'

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

export type MobilePane = 'lessons' | 'canvas' | 'state'

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
  /** Pane đang hiển thị ở layout mobile. Sống ở store chứ không phải `useState`
   *  trong `App` vì `setLesson`/`openSandbox` phải đẩy nó về `'canvas'` — một
   *  action của store không với tới được state cục bộ của component. */
  mobilePane: MobilePane
  /** Drawer sidebar ở layout tablet. */
  drawerOpen: boolean
  /** Giao diện sáng/tối. `applyTheme` là nơi duy nhất chạm vào `data-theme` và
   *  `localStorage`; store chỉ giữ giá trị để component render lại. */
  theme: Theme
  /** Điểm quiz tốt nhất, đọc từ `localStorage` lúc dựng store. Sống trong store chứ
   *  không phải trong dialog vì badge ở `LessonSidebar` nằm ở nhánh cây khác và phải
   *  vẽ lại ngay khi người học vừa nộp bài. */
  progress: Progress
  setBroker(id: string): void
  setLesson(id: string): void
  openSandbox(): void
  play(): void
  pause(): void
  setSpeed(speed: Speed): void
  seek(virtualMs: number): void
  tickTo(virtualMs: number): void
  selectNode(id?: string): void
  setMobilePane(pane: MobilePane): void
  setDrawerOpen(open: boolean): void
  setTheme(theme: Theme): void
  toggleTheme(): void
  recordLessonQuiz(lessonId: string, result: { correct: number; total: number }): void
  recordExam(result: { correct: number; total: number }): void
}

export const useAppStore = create<AppState>((set, get) => {
  const brokerId = DEFAULT_BROKER_ID
  const lessonId = catalogEntry(DEFAULT_BROKER_ID).defaultLessonId
  const theme = resolveInitialTheme()

  return {
    brokerId,
    lessonId,
    sandbox: false,
    playing: false,
    speed: 1,
    virtualTime: 0,
    replayToken: 0,
    mobilePane: 'canvas',
    drawerOpen: false,
    theme,
    progress: readProgress(),

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
        drawerOpen: false,
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
        // Vừa chọn bài xong thì thứ người học muốn thấy là mô phỏng, không phải
        // danh sách bài — ở mobile, đứng nguyên tab `lessons` trông như bấm hụt.
        mobilePane: 'canvas',
        drawerOpen: false,
      }))
    },

    openSandbox() {
      set((s) => ({
        sandbox: true,
        playing: false,
        virtualTime: 0,
        replayToken: s.replayToken + 1,
        mobilePane: 'canvas',
        drawerOpen: false,
      }))
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

    setMobilePane(pane) {
      set({ mobilePane: pane })
    },

    setDrawerOpen(open) {
      set({ drawerOpen: open })
    },

    setTheme(theme) {
      applyTheme(theme)
      set({ theme })
    },

    toggleTheme() {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
    },

    recordLessonQuiz(lessonId, result) {
      // brokerId comes from state, not from the caller: a dialog that is open while the
      // broker switches must not file its score under the broker now on screen.
      const { brokerId, progress } = get()
      const next = recordScore(progress, { kind: 'lesson', brokerId, lessonId }, result)
      writeProgress(next)
      set({ progress: next })
    },

    recordExam(result) {
      const { brokerId, progress } = get()
      const next = recordScore(progress, { kind: 'exam', brokerId }, result)
      writeProgress(next)
      set({ progress: next })
    },
  }
})
