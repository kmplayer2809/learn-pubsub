import type { ComponentType } from 'react'
import type { Connection, Edge, Node, NodeChange, NodeTypes } from '@xyflow/react'
import type { Simulation } from '../shell/kernel/run'
import type { InFlight, KernelState, ValidationIssueBase } from '../shell/kernel/types'
import type { Lesson, LessonGroupSpec } from '../shell/lesson/types'

export interface BrokerModule<S extends KernelState, T, A, I extends ValidationIssueBase> {
  id: string
  label: string
  lessonGroups: LessonGroupSpec[]
  lessons: Lesson<T, A>[]
  defaultLessonId: string
  createSimulation(options: {
    topology: T
    script: A[]
    /** Scripted consumer failures. Only AMQP lessons carry them; other brokers ignore this. */
    failures?: unknown[]
    seed: number
    maxEvents?: number
  }): Simulation<S> & { readonly issues: I[] }
  emptyTopology: T
  nodeTypes: NodeTypes
  toFlow(topology: T, state: S, script: A[], highlight?: string[]): { nodes: Node[]; edges: Edge[] }
  inFlight(state: S): InFlight[]
  StatePanel: ComponentType<{ state: S }>
  issueText(issue: I): string
  /** Counters for the inspector's metrics grid. Keys render verbatim, so each
   *  broker names its own — the grid stays driven by Object.entries. */
  metrics(state: S): Record<string, number>
  /** Detail pane for the selected canvas node. Required: every broker has nodes,
   *  and the shell has nothing generic to fall back on. */
  NodeConfig: ComponentType<{ lesson: Lesson<T, A>; state: S; nodeId: string }>
  /** Code export for a lesson's topology. Optional: a broker without one gets no
   *  "Xuất code" button, exactly as a broker without a sandbox gets no Sandbox button. */
  ExportDialog?: ComponentType<{ topology: T; onClose(): void }>
  sandbox?: BrokerSandbox<S, T, A, I>
}

export interface BrokerSandbox<S extends KernelState, T, A, I extends ValidationIssueBase> {
  Panel: ComponentType<{ state: S; issues: I[] }>
  /**
   * Plain reads, not hooks: `getTopology`/`getScript` + `subscribe` are meant to be driven
   * through `useSyncExternalStore` by whoever consumes them (see `shell/useSimulation.ts`).
   * That keeps the *number* of hooks called at the call site fixed regardless of which
   * broker is active or whether it has a sandbox at all — a broker-authored hook (e.g. a
   * bound Zustand selector) is free to call a different number of primitive hooks
   * internally, which a plain getter can't do.
   */
  getTopology(): T
  getScript(): A[]
  subscribe(onStoreChange: () => void): () => void
  reset(): void
  maxEvents: number
  transportDurationMs: number
  /**
   * Canvas drag/connect behaviour. Editing an AMQP binding and editing a Redis
   * subscription share no logic, so the canvas delegates both to the broker.
   * Plain functions, not hooks: they are event handlers React Flow calls
   * directly, and they read the broker's own store through `getState()` when
   * they fire — see the `editing.ts` amendment note on `getTopology` above for
   * why this contract carries no hooks at all.
   */
  editing: {
    onNodesChange(topology: T, changes: NodeChange[]): void
    onConnect(topology: T, connection: Connection): void
  }
}

export type AnyBrokerModule = BrokerModule<any, any, any, any>
