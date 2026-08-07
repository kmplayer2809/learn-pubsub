import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateTopology } from '../engine'
import { emptyTopology, STORAGE_KEY, useSandboxStore } from './sandboxStore'

describe('sandbox store', () => {
  beforeEach(() => {
    localStorage.clear()
    useSandboxStore.getState().reset()
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

  it('updates a binding routing key without touching other bindings', () => {
    const s = useSandboxStore.getState()
    s.addNode('exchange', { x: 100, y: 100 })
    s.addNode('queue', { x: 300, y: 100 })
    s.addNode('queue', { x: 300, y: 300 })
    const { exchanges, queues } = useSandboxStore.getState().topology
    s.addBinding(exchanges[0]!.id, queues[0]!.id, '')
    s.addBinding(exchanges[0]!.id, queues[1]!.id, 'other')
    const [b1, b2] = useSandboxStore.getState().topology.bindings

    s.updateBinding(b1!.id, { routingKey: 'demo' })

    const bindings = useSandboxStore.getState().topology.bindings
    expect(bindings.find((b) => b.id === b1!.id)!.routingKey).toBe('demo')
    expect(bindings.find((b) => b.id === b2!.id)!.routingKey).toBe('other')
  })

  it('removes a binding without touching the nodes it connected', () => {
    const s = useSandboxStore.getState()
    s.addNode('exchange', { x: 100, y: 100 })
    s.addNode('queue', { x: 300, y: 100 })
    const { exchanges, queues } = useSandboxStore.getState().topology
    s.addBinding(exchanges[0]!.id, queues[0]!.id, 'key')
    const binding = useSandboxStore.getState().topology.bindings[0]!

    s.removeBinding(binding.id)

    expect(useSandboxStore.getState().topology.bindings).toEqual([])
    expect(useSandboxStore.getState().topology.exchanges).toHaveLength(1)
    expect(useSandboxStore.getState().topology.queues).toHaveLength(1)
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

  it('never mints an id that collides with one restored from a previous session', async () => {
    // Two fresh module instances, so both sessions start their id counter at 0 —
    // that is what a page reload does, and it is why the module-level counter has
    // to be reseeded from what was restored. Importing once would leave session B
    // sharing this file's already-advanced counter and hide the collision.
    vi.resetModules()
    const sessionA = await import('./sandboxStore')
    sessionA.useSandboxStore.getState().addNode('publisher', { x: 0, y: 0 })
    sessionA.useSandboxStore.getState().addNode('queue', { x: 0, y: 0 })
    sessionA.useSandboxStore.getState().save()
    expect(sessionA.useSandboxStore.getState().topology.publishers[0]!.id).toBe('publisher-1')

    vi.resetModules()
    const sessionB = await import('./sandboxStore')
    sessionB.useSandboxStore.getState().load()
    sessionB.useSandboxStore.getState().addNode('publisher', { x: 50, y: 50 })

    // Duplicate ids make updateNode patch both, removeNode delete both, and
    // EngineState.queues/unacked collapse two nodes into one record.
    const t = sessionB.useSandboxStore.getState().topology
    const ids = [...t.publishers, ...t.exchanges, ...t.queues, ...t.consumers].map((n) => n.id)
    expect(t.publishers).toHaveLength(2)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps manual publishes when the generator rate changes, including back to zero', () => {
    const s = useSandboxStore.getState()
    s.addNode('publisher', { x: 0, y: 0 })
    s.addNode('exchange', { x: 100, y: 100 })
    const { publishers, exchanges } = useSandboxStore.getState().topology
    const exchangeId = exchanges[0]!.id

    s.publish({
      at: 0,
      publisherId: publishers[0]!.id,
      exchangeId,
      routingKey: 'manual',
      body: 'by hand',
    })
    expect(useSandboxStore.getState().script).toHaveLength(1)

    // The rate slider fires setGenerator on every step. Replacing the script
    // destroyed the hand-published message with no warning and no undo.
    s.setGenerator({ ratePerSecond: 2, exchangeId, routingKey: 'go' })
    expect(useSandboxStore.getState().script).toHaveLength(121)

    // Rate 0 means "no generator actions", not "no script": dragging back to zero
    // used to empty the script entirely and the simulation went silent.
    s.setGenerator({ ratePerSecond: 0, exchangeId, routingKey: 'go' })
    const script = useSandboxStore.getState().script
    expect(script).toHaveLength(1)
    expect(script[0]!.body).toBe('by hand')
  })

  it('merges generated and manual actions in time order', () => {
    const s = useSandboxStore.getState()
    s.addNode('publisher', { x: 0, y: 0 })
    s.addNode('exchange', { x: 100, y: 100 })
    const { publishers, exchanges } = useSandboxStore.getState().topology
    const exchangeId = exchanges[0]!.id

    s.setGenerator({ ratePerSecond: 1, exchangeId, routingKey: 'go' })
    s.publish({ at: 2500, publisherId: publishers[0]!.id, exchangeId, routingKey: 'manual', body: 'by hand' })

    const ats = useSandboxStore.getState().script.map((a) => a.at)
    expect([...ats].sort((a, b) => a - b)).toEqual(ats)
    expect(useSandboxStore.getState().script.find((a) => a.body === 'by hand')!.at).toBe(2500)
  })
})
