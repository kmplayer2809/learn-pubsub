import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineState, ValidationIssue } from '../engine'
import { useAppStore } from '../../../sim/store'
import { SandboxPanel } from './SandboxPanel'
import { emptyTopology, useSandboxStore } from './sandboxStore'

function engineState(over: Partial<EngineState> = {}): EngineState {
  return {
    now: 0,
    seq: 0,
    rng: { s: 1 },
    topology: emptyTopology(),
    queues: {},
    unacked: {},
    roundRobin: {},
    inFlight: [],
    metrics: {
      published: 0,
      routed: 0,
      dropped: 0,
      delivered: 0,
      acked: 0,
      nacked: 0,
      deadLettered: 0,
      expired: 0,
      confirmed: 0,
    },
    journal: [],
    crashed: [],
    crashEpoch: {},
    messageCounter: 0,
    ...over,
  }
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  // reset() clears the derived script plus both of its sources; setting `script`
  // alone would leave a previous test's manual publishes in manualScript.
  useSandboxStore.getState().reset()
})

describe('SandboxPanel', () => {
  it('renders the metrics grid, driven generically like Inspector', () => {
    const state = engineState({
      metrics: {
        published: 3,
        routed: 2,
        dropped: 1,
        delivered: 2,
        acked: 2,
        nacked: 0,
        deadLettered: 0,
        expired: 0,
        confirmed: 3,
      },
    })
    render(<SandboxPanel state={state} issues={[]} />)

    expect(screen.getByText('Chỉ số')).toBeTruthy()
    expect(screen.getByText('published').nextElementSibling?.textContent).toBe('3')
    expect(screen.getByText('dropped').nextElementSibling?.textContent).toBe('1')
  })

  it('renders the event log with the same entries Inspector would show', () => {
    const state = engineState({
      journal: [
        { at: 0, type: 'publish', text: 'p1 published m1 key=""' },
        { at: 600, type: 'route', text: 'exchange-2 routed m1 to queue-3' },
      ],
    })
    render(<SandboxPanel state={state} issues={[]} />)

    expect(screen.getByText('Nhật ký sự kiện')).toBeTruthy()
    expect(screen.getByText(/p1 published m1/)).toBeTruthy()
    expect(screen.getByText(/routed m1 to queue-3/)).toBeTruthy()
  })

  it('shows no issues banner when the list is empty and shows one when populated', () => {
    const state = engineState()
    const issues: ValidationIssue[] = [
      { severity: 'warning', code: 'queue-unreachable', message: 'x', queueId: 'q1', queueLabel: 'q1' },
    ]
    const { rerender } = render(<SandboxPanel state={state} issues={[]} />)
    expect(screen.queryByText(/chưa có binding/)).toBeNull()

    rerender(<SandboxPanel state={state} issues={issues} />)
    expect(screen.getByText(/chưa có binding/)).toBeTruthy()
  })

  it('lets the user edit a drag-created binding routing key from the exchange config panel', () => {
    useSandboxStore.setState(
      {
        topology: {
          publishers: [],
          exchanges: [{ id: 'ex1', label: 'ex1', type: 'direct', position: { x: 0, y: 0 } }],
          queues: [{ id: 'q1', label: 'q1', kind: 'classic', position: { x: 100, y: 0 } }],
          consumers: [],
          bindings: [{ id: 'b1', exchangeId: 'ex1', destinationId: 'q1', destinationKind: 'queue', routingKey: '' }],
        },
        script: [],
      },
      false,
    )
    useAppStore.setState({ selectedNodeId: 'ex1' })

    render(<SandboxPanel state={engineState()} issues={[]} />)

    const input = screen.getByLabelText('routing key cho binding tới q1') as HTMLInputElement
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'demo' } })

    expect(useSandboxStore.getState().topology.bindings[0]!.routingKey).toBe('demo')
  })

  it('lets the user delete a binding from the exchange config panel', () => {
    useSandboxStore.setState(
      {
        topology: {
          publishers: [],
          exchanges: [{ id: 'ex1', label: 'ex1', type: 'direct', position: { x: 0, y: 0 } }],
          queues: [{ id: 'q1', label: 'q1', kind: 'classic', position: { x: 100, y: 0 } }],
          consumers: [],
          bindings: [{ id: 'b1', exchangeId: 'ex1', destinationId: 'q1', destinationKind: 'queue', routingKey: '' }],
        },
        script: [],
      },
      false,
    )
    useAppStore.setState({ selectedNodeId: 'ex1' })

    render(<SandboxPanel state={engineState()} issues={[]} />)

    fireEvent.click(screen.getByLabelText('xóa binding tới q1'))

    expect(useSandboxStore.getState().topology.bindings).toEqual([])
  })
})
