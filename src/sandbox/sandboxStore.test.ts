import { beforeEach, describe, expect, it } from 'vitest'
import { validateTopology } from '../engine'
import { emptyTopology, STORAGE_KEY, useSandboxStore } from './sandboxStore'

describe('sandbox store', () => {
  beforeEach(() => {
    localStorage.clear()
    useSandboxStore.setState({ topology: emptyTopology(), script: [] }, false)
  })

  it('starts with an empty, valid-but-empty topology', () => {
    expect(useSandboxStore.getState().topology.queues).toEqual([])
  })

  it('adds a queue and a consumer that references it', () => {
    const s = useSandboxStore.getState()
    s.addNode('queue', { x: 100, y: 100 })
    const queueId = useSandboxStore.getState().topology.queues[0]!.id
    s.addNode('consumer', { x: 300, y: 100 })
    s.updateNode(useSandboxStore.getState().topology.consumers[0]!.id, { queueId })
    const topology = useSandboxStore.getState().topology
    expect(topology.consumers[0]!.queueId).toBe(queueId)
    expect(validateTopology(topology).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('creates a binding when two nodes are connected', () => {
    const s = useSandboxStore.getState()
    s.addNode('exchange', { x: 100, y: 100 })
    s.addNode('queue', { x: 300, y: 100 })
    const { exchanges, queues } = useSandboxStore.getState().topology
    s.addBinding(exchanges[0]!.id, queues[0]!.id, 'key')
    expect(useSandboxStore.getState().topology.bindings).toHaveLength(1)
  })

  it('removes a node and every binding that referenced it', () => {
    const s = useSandboxStore.getState()
    s.addNode('exchange', { x: 100, y: 100 })
    s.addNode('queue', { x: 300, y: 100 })
    const { exchanges, queues } = useSandboxStore.getState().topology
    s.addBinding(exchanges[0]!.id, queues[0]!.id, 'key')
    s.removeNode(queues[0]!.id)
    expect(useSandboxStore.getState().topology.bindings).toEqual([])
    expect(useSandboxStore.getState().topology.queues).toEqual([])
  })

  it('expands a generator into scripted actions over a fixed horizon', () => {
    const s = useSandboxStore.getState()
    s.addNode('exchange', { x: 100, y: 100 })
    const exchangeId = useSandboxStore.getState().topology.exchanges[0]!.id
    s.setGenerator({ ratePerSecond: 2, exchangeId, routingKey: 'go' })
    expect(useSandboxStore.getState().script).toHaveLength(120)
  })

  it('round-trips through localStorage', () => {
    const s = useSandboxStore.getState()
    s.addNode('queue', { x: 10, y: 10 })
    s.save()
    useSandboxStore.setState({ topology: emptyTopology() }, false)
    useSandboxStore.getState().load()
    expect(useSandboxStore.getState().topology.queues).toHaveLength(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()
  })

  it('falls back to an empty topology when stored data is malformed', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    useSandboxStore.getState().load()
    expect(useSandboxStore.getState().topology.queues).toEqual([])
  })
})
