import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EngineState, InFlight, Message } from '../../brokers/rabbitmq/engine'
import { InFlightPanel } from './InFlightPanel'

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    body: 'hello',
    routingKey: 'order.created',
    headers: {},
    priority: 0,
    publishedAt: 0,
    redeliveryCount: 0,
    deathTrail: [],
    persistent: false,
    ...over,
  }
}

function flight(over: Partial<InFlight> = {}): InFlight {
  return { message: message(), edgeId: 'ex->orders', fromT: 0, toT: 1000, tone: 'sky', ...over }
}

function state(inFlight: InFlight[], now = 500): EngineState {
  return { now, inFlight } as unknown as EngineState
}

describe('InFlightPanel', () => {
  it('shows an empty state when nothing is on the wire', () => {
    render(<InFlightPanel state={state([])} />)
    expect(screen.getByTestId('inflight-empty')).toBeTruthy()
    expect(screen.queryByTestId('inflight-row')).toBeNull()
  })

  it('lists each in-flight message with its route and routing key', () => {
    render(<InFlightPanel state={state([flight()])} />)
    const row = screen.getByTestId('inflight-row')
    expect(row.textContent).toContain('m1')
    expect(row.textContent).toContain('ex')
    expect(row.textContent).toContain('orders')
    expect(row.textContent).toContain('order.created')
  })

  it('reports progress from virtual time, not wall-clock', () => {
    // Half-way between fromT and toT at now=500 of a 0..1000 flight.
    render(<InFlightPanel state={state([flight()], 500)} />)
    expect(screen.getByTestId('inflight-progress').getAttribute('aria-valuenow')).toBe('50')
    // Same flight, later virtual time: the bar must move without any timer firing.
    render(<InFlightPanel state={state([flight()], 900)} />)
    expect(screen.getAllByTestId('inflight-progress')[1]!.getAttribute('aria-valuenow')).toBe('90')
  })

  it('badges redelivery, priority, and persistence only when they are set', () => {
    render(
      <InFlightPanel
        state={state([flight({ message: message({ redeliveryCount: 2, priority: 5, persistent: true }) })])}
      />,
    )
    const row = screen.getByTestId('inflight-row')
    expect(row.textContent).toContain('redelivery 2')
    expect(row.textContent).toContain('priority 5')
    expect(row.textContent).toContain('persistent')
  })

  it('omits the badges on a plain message', () => {
    render(<InFlightPanel state={state([flight()])} />)
    const row = screen.getByTestId('inflight-row')
    expect(row.textContent).not.toContain('redelivery')
    expect(row.textContent).not.toContain('priority')
    expect(row.textContent).not.toContain('persistent')
  })

  it('orders rows by departure time so a landing message does not reshuffle the rest', () => {
    const older = flight({ message: message({ id: 'm1' }), fromT: 0 })
    const newer = flight({ message: message({ id: 'm2' }), fromT: 400, edgeId: 'ex->audit' })
    // Deliberately supplied newest-first: the panel must not trust array order.
    render(<InFlightPanel state={state([newer, older], 500)} />)
    const ids = screen.getAllByTestId('inflight-row').map((r) => r.getAttribute('data-message-id'))
    expect(ids).toEqual(['m1', 'm2'])
  })
})
