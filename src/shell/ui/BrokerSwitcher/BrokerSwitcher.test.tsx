import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BROKERS } from '../../../brokers/registry'
import { useAppStore } from '../../store'
import { BrokerSwitcher } from './BrokerSwitcher'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

describe('BrokerSwitcher', () => {
  it('renders one tab per registered broker', () => {
    render(<BrokerSwitcher />)
    expect(screen.getAllByTestId('broker-tab')).toHaveLength(BROKERS.length)
  })

  it('marks the active broker with aria-current', () => {
    render(<BrokerSwitcher />)
    const active = screen.getByTestId('broker-switcher').querySelector('[aria-current="true"]')
    expect(active?.getAttribute('data-broker-id')).toBe('rabbitmq')
  })

  // Asserting only that brokerId equals the clicked tab's id would pass with an
  // onClick that does nothing at all, because `rabbitmq` is the sole registered
  // broker and is already active. So put the store somewhere setBroker must move
  // it from, and assert the move — this stays honest once Redis joins BROKERS.
  it('clicking a tab runs setBroker, not just a no-op handler', () => {
    act(() => {
      useAppStore.getState().openSandbox()
      useAppStore.getState().selectNode('q1')
    })
    const before = useAppStore.getState().replayToken
    render(<BrokerSwitcher />)
    const tab = screen.getAllByTestId('broker-tab')[0]!
    act(() => tab.click())
    const after = useAppStore.getState()
    expect(after.brokerId).toBe(tab.getAttribute('data-broker-id'))
    expect(after.sandbox).toBe(false)
    expect(after.selectedNodeId).toBeUndefined()
    expect(after.replayToken).toBe(before + 1)
  })
})
