import { beforeEach, describe, expect, it } from 'vitest'
import { useSandboxStore } from '../sandbox/sandboxStore'
import { onConnect, onNodesChange } from './editing'

describe('editing', () => {
  beforeEach(() => {
    useSandboxStore.getState().reset()
  })

  it('persists a dragged node position into the sandbox topology', () => {
    const s = useSandboxStore.getState()
    s.addNode('queue', { x: 10, y: 10 })
    const queueId = useSandboxStore.getState().topology.queues[0]!.id

    onNodesChange(useSandboxStore.getState().topology, [
      { id: queueId, type: 'position', position: { x: 240, y: 360 } },
    ])

    expect(useSandboxStore.getState().topology.queues[0]!.position).toEqual({ x: 240, y: 360 })
  })

  it('creates a binding with an empty routing key when the connection starts at an exchange', () => {
    const s = useSandboxStore.getState()
    s.addNode('exchange', { x: 0, y: 0 })
    s.addNode('queue', { x: 100, y: 0 })
    const { exchanges, queues } = useSandboxStore.getState().topology

    onConnect(useSandboxStore.getState().topology, {
      source: exchanges[0]!.id,
      target: queues[0]!.id,
      sourceHandle: null,
      targetHandle: null,
    })

    const bindings = useSandboxStore.getState().topology.bindings
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.exchangeId).toBe(exchanges[0]!.id)
    expect(bindings[0]!.destinationId).toBe(queues[0]!.id)
    expect(bindings[0]!.routingKey).toBe('')
  })

  it('rewires a consumer to a new queue when the connection starts at a queue', () => {
    const s = useSandboxStore.getState()
    s.addNode('queue', { x: 0, y: 0 })
    s.addNode('queue', { x: 0, y: 200 })
    s.addNode('consumer', { x: 200, y: 0 })
    const { queues, consumers } = useSandboxStore.getState().topology
    // addNode('consumer') already points the new consumer at queues[0] by default —
    // connect from the *other* queue, so the assertion cannot pass on the initial value.
    expect(consumers[0]!.queueId).toBe(queues[0]!.id)

    onConnect(useSandboxStore.getState().topology, {
      source: queues[1]!.id,
      target: consumers[0]!.id,
      sourceHandle: null,
      targetHandle: null,
    })

    expect(useSandboxStore.getState().topology.consumers[0]!.queueId).toBe(queues[1]!.id)
  })
})
