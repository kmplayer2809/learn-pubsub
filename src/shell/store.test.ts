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
