import type { NarrativeStep } from '../../lessons/types'

export function activeStepIndex(steps: readonly NarrativeStep[], now: number): number {
  let index = 0
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.at <= now) index = i
  }
  return index
}
