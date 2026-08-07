import { create } from 'zustand'
import type { BindingSpec, ScriptedAction, Topology } from '../engine'

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
  /**
   * Everything the simulation should run, in time order. Derived: it is always
   * `manualScript` merged with `generatorScript`, never written to directly.
   * Kept as its own field because App and useSimulation read it on every render
   * and rebuild the engine when its identity changes.
   */
  script: ScriptedAction[]
  /** Messages the user published by hand. Survives every generator change. */
  manualScript: ScriptedAction[]
  /** Expansion of the current generator. Emptied, not merged away, at rate 0. */
  generatorScript: ScriptedAction[]
  generator?: Generator
  addNode(kind: SandboxNodeKind, position: { x: number; y: number }): void
  updateNode(id: string, patch: Record<string, unknown>): void
  removeNode(id: string): void
  addBinding(exchangeId: string, destinationId: string, routingKey: string): void
  updateBinding(id: string, patch: Partial<Pick<BindingSpec, 'routingKey'>>): void
  removeBinding(id: string): void
  publish(action: ScriptedAction): void
  setGenerator(generator: Generator): void
  save(): void
  load(): void
  reset(): void
}

let counter = 0
const mintId = (kind: string) => `${kind}-${++counter}`

/**
 * Lifts the id counter above every id already present in a restored topology.
 * The counter lives in module scope and is reset by a page reload, but `load()`
 * restores ids minted by an earlier session — so without this, the very next
 * addNode re-mints `publisher-1` and two nodes share an id. Self-healing, so it
 * also repairs saves written before the counter was tracked at all.
 */
function seedCounterFrom(topology: Topology): void {
  const ids = [
    ...topology.publishers,
    ...topology.exchanges,
    ...topology.queues,
    ...topology.consumers,
    ...topology.bindings,
  ].map((n) => Number(n.id.split('-').pop()) || 0)
  counter = Math.max(counter, ...ids, 0)
}

/** Merges the two script sources into the single time-ordered list the engine runs. */
function mergeScript(manual: ScriptedAction[], generated: ScriptedAction[]): ScriptedAction[] {
  return [...manual, ...generated].sort((a, b) => a.at - b.at)
}

function expandGenerator(generator: Generator, publisherId: string): ScriptedAction[] {
  // Rate 0 means "no generator actions", not "no script": the rate slider calls
  // setGenerator on every step including 0, and treating that as an empty script
  // silently deleted everything the user had published by hand.
  if (generator.ratePerSecond <= 0) return []
  const intervalMs = 1000 / generator.ratePerSecond
  const count = Math.floor(GENERATOR_HORIZON_S * generator.ratePerSecond)
  return Array.from({ length: count }, (_, i) => ({
    at: Math.round(i * intervalMs),
    publisherId,
    exchangeId: generator.exchangeId,
    routingKey: generator.routingKey,
    body: `generated-${i}`,
  }))
}

export const useSandboxStore = create<SandboxState>((set, get) => ({
  topology: emptyTopology(),
  script: [],
  manualScript: [],
  generatorScript: [],

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

  updateBinding(id, patch) {
    set((s) => ({
      topology: {
        ...s.topology,
        bindings: s.topology.bindings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      },
    }))
  },

  removeBinding(id) {
    set((s) => ({
      topology: { ...s.topology, bindings: s.topology.bindings.filter((b) => b.id !== id) },
    }))
  },

  publish(action) {
    set((s) => {
      const manualScript = [...s.manualScript, action]
      return { manualScript, script: mergeScript(manualScript, s.generatorScript) }
    })
  },

  setGenerator(generator) {
    // Generator actions live in their own list. Replacing the whole script here
    // meant touching the rate slider at all discarded every message the user had
    // published by hand, with no warning and no undo.
    const generatorScript = expandGenerator(generator, get().topology.publishers[0]?.id ?? 'p1')
    set((s) => ({ generator, generatorScript, script: mergeScript(s.manualScript, generatorScript) }))
  },

  save() {
    const s = get()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        topology: s.topology,
        // `script` stays in the blob for older readers; `manualScript` and
        // `generator` are what a restore actually rebuilds from, so a saved
        // generator does not come back baked into the manual publishes.
        script: s.script,
        manualScript: s.manualScript,
        generator: s.generator,
      }),
    )
  },

  load() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as {
        topology?: Topology
        script?: ScriptedAction[]
        manualScript?: ScriptedAction[]
        generator?: Generator
      }
      if (!parsed.topology || !Array.isArray(parsed.topology.queues)) throw new Error('bad shape')
      // A blob written before manualScript existed only has the merged script.
      const manualScript = parsed.manualScript ?? parsed.script ?? []
      const generator = parsed.generator
      const generatorScript = generator
        ? expandGenerator(generator, parsed.topology.publishers[0]?.id ?? 'p1')
        : []
      seedCounterFrom(parsed.topology)
      set({
        topology: parsed.topology,
        manualScript,
        generatorScript,
        generator,
        script: mergeScript(manualScript, generatorScript),
      })
    } catch {
      set({ topology: emptyTopology(), script: [], manualScript: [], generatorScript: [], generator: undefined })
    }
  },

  reset() {
    set({
      topology: emptyTopology(),
      script: [],
      manualScript: [],
      generatorScript: [],
      generator: undefined,
    })
  },
}))
