import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyState } from '../engine/testState'
import type { KeyRecord, RedisState, RedisValue } from '../engine'
import { KeyspacePanel } from './KeyspacePanel'

function record(value: RedisValue, over: Partial<KeyRecord> = {}): KeyRecord {
  return { value, lastAccessAt: 0, hits: 0, createdAt: 0, bytes: 10, ...over }
}

function withKeys(entries: Record<string, KeyRecord>, keyOrder: string[], over: Partial<RedisState> = {}): RedisState {
  const base = emptyState()
  return {
    ...base,
    keys: entries,
    keyOrder,
    metrics: { ...base.metrics, keysCount: keyOrder.length, memoryUsed: 42 },
    ...over,
  }
}

describe('KeyspacePanel', () => {
  it('shows the empty state when the keyspace has no keys', () => {
    render(<KeyspacePanel state={emptyState()} />)
    expect(screen.getByTestId('keyspace-empty')).toBeTruthy()
    expect(screen.getByTestId('keyspace-empty').textContent).toBe('Keyspace đang trống.')
    expect(screen.queryByTestId('keyspace-row')).toBeNull()
  })

  it('renders one row per live key, in keyOrder', () => {
    const state = withKeys(
      {
        b: record({ type: 'string', value: 'x' }),
        a: record({ type: 'string', value: 'y' }),
      },
      ['b', 'a'],
    )
    render(<KeyspacePanel state={state} />)
    const rows = screen.getAllByTestId('keyspace-row')
    expect(rows.map((r) => r.getAttribute('data-key'))).toEqual(['b', 'a'])
  })

  it('does not render a key past its expiry, even though it is still present in state.keys', () => {
    // Lazy expiry (see keyspace.ts readKey): the record can outlive its own deadline in
    // `state.keys`/`keyOrder` until something reads it. The panel must show what a client
    // would actually see, not what the map still happens to hold.
    const state = withKeys(
      { gone: record({ type: 'string', value: 'x' }, { expiresAt: 100 }) },
      ['gone'],
      { now: 500 },
    )
    render(<KeyspacePanel state={state} />)
    expect(screen.queryByTestId('keyspace-row')).toBeNull()
    expect(screen.getByTestId('keyspace-empty')).toBeTruthy()
  })

  it('renders a live key whose TTL has not yet passed', () => {
    const state = withKeys(
      { alive: record({ type: 'string', value: 'x' }, { expiresAt: 5000 }) },
      ['alive'],
      { now: 500 },
    )
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row')).toBeTruthy()
  })

  it('shows the TTL in remaining whole seconds', () => {
    const state = withKeys(
      { k: record({ type: 'string', value: 'x' }, { expiresAt: 7999 }) },
      ['k'],
      { now: 2000 },
    )
    render(<KeyspacePanel state={state} />)
    // (7999 - 2000) / 1000 = 5.999 -> floors to 5, not rounds to 6.
    expect(screen.getByTestId('keyspace-row').textContent).toContain('5')
  })

  it('shows — for a key with no TTL', () => {
    const state = withKeys({ k: record({ type: 'string', value: 'x' }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain('—')
  })

  it('truncates a string value longer than 24 characters with an ellipsis', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz' // 26 chars
    const state = withKeys({ k: record({ type: 'string', value: long }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain('abcdefghijklmnopqrstuvwx…')
    expect(screen.getByTestId('keyspace-row').textContent).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })

  it('does not truncate a string value at or under 24 characters', () => {
    const exact = 'abcdefghijklmnopqrstuvwx' // exactly 24 chars
    const state = withKeys({ k: record({ type: 'string', value: exact }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain(exact)
    expect(screen.getByTestId('keyspace-row').textContent).not.toContain('…')
  })

  it('summarises a hash by field count', () => {
    const state = withKeys(
      { k: record({ type: 'hash', value: { a: '1', b: '2', c: '3' }, fieldOrder: ['a', 'b', 'c'] }) },
      ['k'],
    )
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain('3 fields')
  })

  it('summarises a list by item count', () => {
    const state = withKeys({ k: record({ type: 'list', value: ['a', 'b'] }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain('2 items')
  })

  it('summarises a set by member count', () => {
    const state = withKeys({ k: record({ type: 'set', value: ['a', 'b', 'c'] }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain('3 members')
  })

  it('summarises a zset by member count', () => {
    const state = withKeys(
      { k: record({ type: 'zset', value: [{ member: 'a', score: 1 }] }) },
      ['k'],
    )
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').textContent).toContain('1 members')
  })

  it('shows keysCount and memoryUsed in the header', () => {
    const state = withKeys({ k: record({ type: 'string', value: 'x' }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-panel').textContent).toContain('1')
    expect(screen.getByTestId('keyspace-panel').textContent).toContain('42')
  })

  // The TTL lesson's whole point, and it has to be legible rather than look like
  // a rendering bug. `metrics.keysCount` counts every record the keyspace holds,
  // including one that is past its deadline but not yet reaped; the rows show
  // only live keys. So the header can honestly read "2" above zero rows, and
  // without a word saying why, that reads as broken.
  it('names the gap when expired records are still holding memory', () => {
    const state = withKeys(
      {
        dead: record({ type: 'string', value: 'x' }, { expiresAt: 1000 }),
        alive: record({ type: 'string', value: 'y' }),
      },
      ['dead', 'alive'],
      { now: 5000 }, // `dead` is well past its deadline, and nothing has reaped it
    )
    render(<KeyspacePanel state={state} />)

    expect(screen.getAllByTestId('keyspace-row').map((r) => r.getAttribute('data-key'))).toEqual([
      'alive',
    ])
    const header = screen.getByTestId('keyspace-header').textContent ?? ''
    expect(header).toContain('1/2 keys')
    expect(header).toContain('1 hết hạn chưa thu hồi')
  })

  it('says nothing about reclamation when every record is live', () => {
    const state = withKeys({ k: record({ type: 'string', value: 'x' }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    const header = screen.getByTestId('keyspace-header').textContent ?? ''
    expect(header).toContain('1 keys')
    expect(header).not.toContain('hết hạn')
  })

  it('marks a key expiring within 1000ms with data-expiring="true"', () => {
    const state = withKeys(
      { k: record({ type: 'string', value: 'x' }, { expiresAt: 1000 }) },
      ['k'],
      { now: 200 }, // 800ms remaining
    )
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').getAttribute('data-expiring')).toBe('true')
  })

  it('does not mark a key with more than 1000ms of TTL remaining', () => {
    const state = withKeys(
      { k: record({ type: 'string', value: 'x' }, { expiresAt: 5000 }) },
      ['k'],
      { now: 200 }, // 4800ms remaining
    )
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').getAttribute('data-expiring')).toBeNull()
  })

  it('does not mark a key with no TTL as expiring', () => {
    const state = withKeys({ k: record({ type: 'string', value: 'x' }) }, ['k'])
    render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-row').getAttribute('data-expiring')).toBeNull()
  })

  it('dense siết chiều cao lại cho màn hình nhỏ', () => {
    const state = withKeys({ k: record({ type: 'string', value: 'x' }) }, ['k'])
    const { rerender } = render(<KeyspacePanel state={state} />)
    expect(screen.getByTestId('keyspace-panel').className).toContain('max-h-32')

    rerender(<KeyspacePanel state={state} dense />)
    expect(screen.getByTestId('keyspace-panel').className).toContain('max-h-24')
    expect(screen.getByTestId('keyspace-panel').className).not.toContain('max-h-32')
  })
})
