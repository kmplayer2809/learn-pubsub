import type { ComponentType } from 'react'
import type { Edge, Node, NodeTypes, OnConnect, OnNodesChange } from '@xyflow/react'
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
  /** Canvas drag/connect behaviour. Editing an AMQP binding and editing a Redis
   *  subscription share no logic, so the canvas delegates both to the broker. */
  useEditing(topology: T): { onNodesChange: OnNodesChange; onConnect: OnConnect }
}

export type AnyBrokerModule = BrokerModule<any, any, any, any>
