import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyState } from '../engine/testState'
import type { RedisScriptedCommand, RedisState, RedisTopology } from '../engine'
import type { Lesson } from '../../../shell/lesson/types'
import { NodeConfig } from './NodeConfig'

function lesson(topology: RedisTopology): Lesson<RedisTopology, RedisScriptedCommand> {
  return {
    id: 'l1',
    group: 'basics',
    title: 'Test lesson',
    summary: 'summary',
    topology,
    script: [],
    narrative: [],
    seed: 1,
    durationMs: 1000,
  }
}

function stateWithJournal(clientIds: string[]): RedisState {
  const base = emptyState()
  return {
    ...base,
    journal: clientIds.map((nodeId, i) => ({ at: i, type: 'reply', text: 'x', nodeId })),
  }
}

describe('NodeConfig', () => {
  it('renders the server config with spec fields from lesson.topology and live numbers from state', () => {
    const topology: RedisTopology = {
      clients: [],
      server: {
        id: 'redis',
        label: 'Redis',
        position: { x: 0, y: 0 },
        maxmemoryBytes: 2048,
        evictionPolicy: 'allkeys-lru',
        activeExpireEveryMs: 100,
      },
    }
    const state = emptyState()
    const liveState: RedisState = { ...state, metrics: { ...state.metrics, keysCount: 3, memoryUsed: 900 } }
    render(<NodeConfig lesson={lesson(topology)} state={liveState} nodeId="redis" />)
    const text = document.body.textContent!
    expect(text).toContain('2048')
    expect(text).toContain('allkeys-lru')
    expect(text).toContain('100')
    expect(text).toContain('3')
    expect(text).toContain('900')
  })

  it('says so rather than rendering undefined when the server has no maxmemory limit', () => {
    const topology: RedisTopology = {
      clients: [],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    render(<NodeConfig lesson={lesson(topology)} state={emptyState()} nodeId="redis" />)
    expect(document.body.textContent).not.toContain('undefined')
  })

  it('renders the client label and its command count derived from the journal', () => {
    const topology: RedisTopology = {
      clients: [{ id: 'c1', label: 'Client One', position: { x: 0, y: 0 } }],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    const state = stateWithJournal(['c1', 'c1', 'other', 'c1'])
    render(<NodeConfig lesson={lesson(topology)} state={state} nodeId="c1" />)
    const text = document.body.textContent!
    expect(text).toContain('Client One')
    expect(text).toContain('3')
  })

  it('counts zero commands for a client with no journal entries yet', () => {
    const topology: RedisTopology = {
      clients: [{ id: 'c1', label: 'Client One', position: { x: 0, y: 0 } }],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    render(<NodeConfig lesson={lesson(topology)} state={emptyState()} nodeId="c1" />)
    expect(screen.getByText('0')).toBeTruthy()
  })

  // A client parked on BLPOP has issued a command that has not journalled yet, so
  // the command count alone renders a worker that is visibly waiting as one that
  // has simply gone quiet — which is the opposite of what the List lesson teaches.
  it('says the client is blocked while it sits on state.blocked', () => {
    const topology: RedisTopology = {
      clients: [{ id: 'worker', label: 'Worker', position: { x: 0, y: 0 } }],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    const base = emptyState()
    const state: RedisState = {
      ...base,
      blocked: [
        { clientId: 'worker', keys: ['jobs'], args: ['jobs', '10'], since: 0, commandId: 'cmd-0' },
      ],
    }
    render(<NodeConfig lesson={lesson(topology)} state={state} nodeId="worker" />)
    expect(document.body.textContent).toContain('BLPOP jobs')
  })

  it('says nothing about blocking for a client that is not parked', () => {
    const topology: RedisTopology = {
      clients: [{ id: 'worker', label: 'Worker', position: { x: 0, y: 0 } }],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    render(<NodeConfig lesson={lesson(topology)} state={emptyState()} nodeId="worker" />)
    expect(document.body.textContent).not.toContain('BLPOP')
  })

  it('falls back to the Vietnamese sentence for a node id matching neither the server nor a client', () => {
    const topology: RedisTopology = {
      clients: [{ id: 'c1', label: 'Client One', position: { x: 0, y: 0 } }],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    render(<NodeConfig lesson={lesson(topology)} state={emptyState()} nodeId="ghost" />)
    expect(document.body.textContent).toBe('Node này không có cấu hình.')
  })
})
