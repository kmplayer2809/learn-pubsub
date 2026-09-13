import { beforeEach, describe, expect, it } from 'vitest'
import { lessonKey, readProgress } from './quiz/progress'
import { SPEEDS, useAppStore } from './store'

// Progress is read out of localStorage when the store is created, so a leftover entry
// from a previous test — in this file or any earlier one — would seed the next one's
// "best" score. Every describe block below creates the store fresh, so every one needs
// a clean localStorage, not just the first.
beforeEach(() => {
  localStorage.clear()
})

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('starts paused on the first lesson at time zero', () => {
    const s = useAppStore.getState()
    expect(s.playing).toBe(false)
    expect(s.virtualTime).toBe(0)
    expect(s.lessonId).toBe('01-hello-world')
  })

  it('play and pause toggle the transport', () => {
    useAppStore.getState().play()
    expect(useAppStore.getState().playing).toBe(true)
    useAppStore.getState().pause()
    expect(useAppStore.getState().playing).toBe(false)
  })

  it('seek moves virtual time and bumps the replay token when going backwards', () => {
    useAppStore.getState().seek(5000)
    const forwardToken = useAppStore.getState().replayToken
    useAppStore.getState().seek(1000)
    expect(useAppStore.getState().virtualTime).toBe(1000)
    expect(useAppStore.getState().replayToken).toBe(forwardToken + 1)
  })

  it('changing lesson resets time, selection, and playback', () => {
    useAppStore.getState().play()
    useAppStore.getState().selectNode('q1')
    useAppStore.getState().seek(4000)
    useAppStore.getState().setLesson('01-hello-world')
    const s = useAppStore.getState()
    expect(s.virtualTime).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.selectedNodeId).toBeUndefined()
  })

  it('exposes an ascending speed ladder including 1x', () => {
    expect(SPEEDS).toContain(1)
    expect([...SPEEDS].sort((a, b) => a - b)).toEqual(SPEEDS)
  })

  it('records a lesson quiz score under the active broker and persists it', () => {
    useAppStore.getState().setBroker('redis')
    useAppStore.getState().recordLessonQuiz('08-prefetch', { correct: 3, total: 4 })

    const record = useAppStore.getState().progress.lessons[lessonKey('redis', '08-prefetch')]
    expect(record).toEqual({ best: 3, total: 4, attempts: 1 })
    expect(readProgress().lessons[lessonKey('redis', '08-prefetch')]).toEqual(record)
    expect(useAppStore.getState().progress.lessons[lessonKey('rabbitmq', '08-prefetch')]).toBeUndefined()
  })

  it('keeps the best lesson score across attempts', () => {
    useAppStore.getState().recordLessonQuiz('08-prefetch', { correct: 4, total: 4 })
    useAppStore.getState().recordLessonQuiz('08-prefetch', { correct: 1, total: 4 })

    expect(useAppStore.getState().progress.lessons[lessonKey('rabbitmq', '08-prefetch')]).toEqual({
      best: 4,
      total: 4,
      attempts: 2,
    })
  })

  it('records an exam score under the active broker', () => {
    useAppStore.getState().setBroker('redis')
    useAppStore.getState().recordExam({ correct: 16, total: 20 })

    expect(useAppStore.getState().progress.exams['redis']).toEqual({
      best: 16,
      total: 20,
      attempts: 1,
    })
    expect(useAppStore.getState().progress.exams['rabbitmq']).toBeUndefined()
  })
})

describe('broker selection', () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

  it('starts on the default broker and its default lesson', () => {
    expect(useAppStore.getState().brokerId).toBe('rabbitmq')
    expect(useAppStore.getState().lessonId).toBe('01-hello-world')
  })

  it('switching broker selects that broker default lesson and leaves the sandbox', () => {
    useAppStore.getState().openSandbox()
    useAppStore.getState().setBroker('rabbitmq')
    const s = useAppStore.getState()
    expect(s.brokerId).toBe('rabbitmq')
    expect(s.lessonId).toBe('01-hello-world')
    expect(s.sandbox).toBe(false)
  })

  it('switching broker rewinds the transport and forces a replay', () => {
    useAppStore.getState().seek(5000)
    useAppStore.getState().play()
    const before = useAppStore.getState().replayToken
    useAppStore.getState().setBroker('rabbitmq')
    const s = useAppStore.getState()
    expect(s.virtualTime).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.selectedNodeId).toBeUndefined()
    expect(s.replayToken).toBe(before + 1)
  })

  it('ignores an unknown broker id rather than stranding the app on a missing module', () => {
    useAppStore.getState().setBroker('not-a-real-broker')
    expect(useAppStore.getState().brokerId).toBe('rabbitmq')
  })
})

describe('mobilePane', () => {
  beforeEach(() => {
    useAppStore.setState({ mobilePane: 'canvas', drawerOpen: false, sandbox: false })
  })

  it('mặc định là canvas — người học mở app là muốn thấy mô phỏng', () => {
    expect(useAppStore.getState().mobilePane).toBe('canvas')
  })

  it('setMobilePane đổi pane', () => {
    useAppStore.getState().setMobilePane('state')
    expect(useAppStore.getState().mobilePane).toBe('state')
  })

  it('chọn lesson đẩy pane về canvas và đóng drawer', () => {
    useAppStore.setState({ mobilePane: 'lessons', drawerOpen: true })
    useAppStore.getState().setLesson('02-direct')
    expect(useAppStore.getState().mobilePane).toBe('canvas')
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('mở sandbox cũng đẩy pane về canvas và đóng drawer', () => {
    useAppStore.setState({ mobilePane: 'lessons', drawerOpen: true })
    useAppStore.getState().openSandbox()
    expect(useAppStore.getState().mobilePane).toBe('canvas')
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('đổi broker đóng drawer', () => {
    useAppStore.setState({ drawerOpen: true })
    useAppStore.getState().setBroker('redis')
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })
})
