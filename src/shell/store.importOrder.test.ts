import { describe, expect, it } from 'vitest'
// Regression test for a real import cycle: store.ts -> registry.ts ->
// rabbitmq/index.ts -> SandboxPanel.tsx -> Inspector.tsx -> store.ts. Importing
// registry.ts before store.ts, as this file does, used to leave `brokerId`
// silently `undefined` (reading a binding across an unresolved cycle yields
// `undefined` rather than throwing, so a try/catch around it never fired).
// store.ts now gets its defaults from src/brokers/catalog.ts, which imports
// nothing, so the cycle no longer touches it. Every other test file in this
// suite imports store.ts as its own graph root and would never observe this.
import '../brokers/registry'
import { useAppStore } from './store'

describe('store initialisation is independent of import order', () => {
  it('initialises brokerId and lessonId correctly even when registry.ts loads first', () => {
    expect(useAppStore.getState().brokerId).toBe('rabbitmq')
    expect(useAppStore.getState().lessonId).toBe('01-hello-world')
  })
})
