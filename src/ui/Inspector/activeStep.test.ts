import { describe, expect, it } from 'vitest'
import { activeStepIndex } from './activeStep'
import type { NarrativeStep } from '../../brokers/rabbitmq/lessons/types'

const steps: NarrativeStep[] = [
  { at: 0, title: 'a', body: '' },
  { at: 1200, title: 'b', body: '' },
  { at: 4000, title: 'c', body: '' },
]

describe('activeStepIndex', () => {
  it('picks the first step before anything has happened', () => {
    expect(activeStepIndex(steps, 0)).toBe(0)
  })

  it('picks the last step whose time has passed', () => {
    expect(activeStepIndex(steps, 1500)).toBe(1)
    expect(activeStepIndex(steps, 3999)).toBe(1)
    expect(activeStepIndex(steps, 4000)).toBe(2)
  })

  it('stays on the final step after the lesson ends', () => {
    expect(activeStepIndex(steps, 99_000)).toBe(2)
  })

  it('returns 0 for an empty narrative', () => {
    expect(activeStepIndex([], 5000)).toBe(0)
  })
})
