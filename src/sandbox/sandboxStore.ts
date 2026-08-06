import { create } from 'zustand'
import type { ScriptedAction, Topology } from '../engine'

export const STORAGE_KEY = 'rabbitmq-visualizer.sandbox'
/** Virtual seconds a load generator covers; a fixed horizon keeps runs replayable. */
const GENERATOR_HORIZON_S = 60

export type SandboxNodeKind = 'publisher' | 'exchange' | 'queue' | 'consumer'

export interface Generator {
  ratePerSecond: number
  exchangeId: string
  routingKey: string
}

export function emptyTopology(): Topology {
  return { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] }
}

interface SandboxState {
  topology: Topology
  script: ScriptedAction[]
  generator?: Generator
  addNode(kind: SandboxNodeKind, position: { x: number; y: number }): void
  updateNode(id: string, patch: Record<string, unknown>): void
  removeNode(id: string): void
  addBinding(exchangeId: string, destinationId: string, routingKey: string): void
  publish(action: ScriptedAction): void
  setGenerator(generator: Generator): void
  save(): void
  load(): void
  reset(): void
}

let counter = 0
const mintId = (kind: string) => `${kind}-${++counter}`

export const useSandboxStore = create<SandboxState>((set, get) => ({
  topology: emptyTopology(),
  script: [],

  addNode(kind, position) {
    const id = mintId(kind)
    set((s) => {
      const t = s.topology
      if (kind === 'publisher') {
        return { topology: { ...t, publishers: [...t.publishers, { id, label: id, position }] } }
      }
      if (kind === 'exchange') {
        return {
          topology: {
            ...t,
            exchanges: [...t.exchanges, { id, label: id, type: 'direct' as const, position }],
          },
        }
      }
      if (kind === 'queue') {
        return {
          topology: { ...t, queues: [...t.queues, { id, label: id, kind: 'classic' as const, position }] },
        }
      }
      return {
        topology: {
          ...t,
          consumers: [
            ...t.consumers,
            {
              id,
              label: id,
              queueId: t.queues[0]?.id ?? '',
              prefetch: 1,
              autoAck: false,
              processingMs: 800,
              jitterMs: 0,
              nackRate: 0,
              requeueOnNack: true,
              position,
            },
          ],
        },
      }
    })
  },

  updateNode(id, patch) {
    set((s) => {
      const apply = <T extends { id: string }>(list: T[]) =>
        list.map((item) => (item.id === id ? { ...item, ...patch } : item))
      return {
        topology: {
          publishers: apply(s.topology.publishers),
          exchanges: apply(s.topology.exchanges),
          queues: apply(s.topology.queues),
          consumers: apply(s.topology.consumers),
          bindings: s.topology.bindings,
        },
      }
    })
  },

  removeNode(id) {
    set((s) => ({
      topology: {
        publishers: s.topology.publishers.filter((n) => n.id !== id),
        exchanges: s.topology.exchanges.filter((n) => n.id !== id),
        queues: s.topology.queues.filter((n) => n.id !== id),
        consumers: s.topology.consumers.filter((n) => n.id !== id),
        bindings: s.topology.bindings.filter(
          (b) => b.exchangeId !== id && b.destinationId !== id,
        ),
      },
    }))
  },

  addBinding(exchangeId, destinationId, routingKey) {
    const isExchange = get().topology.exchanges.some((e) => e.id === destinationId)
    set((s) => ({
      topology: {
        ...s.topology,
        bindings: [
          ...s.topology.bindings,
          {
            id: mintId('binding'),
            exchangeId,
            destinationId,
            destinationKind: isExchange ? ('exchange' as const) : ('queue' as const),
            routingKey,
          },
        ],
      },
    }))
  },

  publish(action) {
    set((s) => ({ script: [...s.script, action] }))
  },

  setGenerator(generator) {
    const intervalMs = 1000 / generator.ratePerSecond
    const count = Math.floor(GENERATOR_HORIZON_S * generator.ratePerSecond)
    const script = Array.from({ length: count }, (_, i) => ({
      at: Math.round(i * intervalMs),
      publisherId: get().topology.publishers[0]?.id ?? 'p1',
      exchangeId: generator.exchangeId,
      routingKey: generator.routingKey,
      body: `generated-${i}`,
    }))
    set({ generator, script })
  },

  save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ topology: get().topology, script: get().script }),
    )
  },

  load() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { topology?: Topology; script?: ScriptedAction[] }
      if (!parsed.topology || !Array.isArray(parsed.topology.queues)) throw new Error('bad shape')
      set({ topology: parsed.topology, script: parsed.script ?? [] })
    } catch {
      set({ topology: emptyTopology(), script: [] })
    }
  },

  reset() {
    set({ topology: emptyTopology(), script: [], generator: undefined })
  },
}))
