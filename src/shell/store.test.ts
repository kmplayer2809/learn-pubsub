import { beforeEach, describe, expect, it } from 'vitest'
import { SPEEDS, useAppStore } from './store'

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
    useAppStore.getState().setBroker('kafka')
    expect(useAppStore.getState().brokerId).toBe('rabbitmq')
  })
})
