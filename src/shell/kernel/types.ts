import type { RngState } from './rng'

export interface SimEvent<T extends string = string> {
  at: number
  seq: number
  type: T
  payload: Record<string, unknown>
}

export interface JournalEntry {
  at: number
  type: string
  text: string
  nodeId?: string
  messageId?: string
}

export interface FlightMessage {
  id: string
  /** Short label drawn beside the particle. Defaults to `id` when omitted. */
  label?: string
  /** Filled particle when true, outlined when false. */
  solid: boolean
}

export interface InFlight {
  message: FlightMessage
  edgeId: string
  fromT: number
  toT: number
  tone: string
}

export interface ValidationIssueBase {
  nodeId?: string
  severity: 'error' | 'warning'
  message: string
}

export interface KernelState {
  now: number
  seq: number
  rng: RngState
  journal: JournalEntry[]
  halted?: { reason: string }
}
