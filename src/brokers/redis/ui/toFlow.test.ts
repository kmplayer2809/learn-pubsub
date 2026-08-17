import { describe, expect, it } from 'vitest'
import { createRedisSimulation, type RedisTopology } from '../engine'
import { toFlowEdges, toFlowNodes } from './toFlow'

function topology(overrides: Partial<RedisTopology> = {}): RedisTopology {
  return {
    clients: [
      { id: 'c1', label: 'Client 1', position: { x: 0, y: 0 } },
      { id: 'c2', label: 'Client 2', position: { x: 0, y: 200 } },
    ],
    server: { id: 'redis', label: 'Redis', position: { x: 300, y: 100 } },
    ...overrides,
  }
}

describe('toFlowNodes', () => {
  it('creates one node per client plus one for the server', () => {
    const topo = topology()
    const sim = createRedisSimulation({ topology: topo, script: [], seed: 1 })
    const nodes = toFlowNodes(topo, sim.snapshot())
    expect(nodes).toHaveLength(3)
    expect(nodes.map((n) => n.id).sort()).toEqual(['c1', 'c2', 'redis'])
    expect(nodes.find((n) => n.id === 'c1')!.type).toBe('client')
    expect(nodes.find((n) => n.id === 'redis')!.type).toBe('server')
  })

  it("carries the server's live keysCount, memoryUsed, maxmemoryBytes, and evictionPolicy", () => {
    const topo = topology({
      server: {
        id: 'redis',
        label: 'Redis',
        position: { x: 0, y: 0 },
        maxmemoryBytes: 1000,
        evictionPolicy: 'allkeys-lru',
      },
    })
    const sim = createRedisSimulation({
      topology: topo,
      script: [{ at: 0, clientId: 'c1', name: 'SET', args: ['k', 'v'] }],
      seed: 1,
    })
    sim.advanceTo(500)
    const serverNode = toFlowNodes(topo, sim.snapshot()).find((n) => n.id === 'redis')!
    expect(serverNode.data.keysCount).toBe(1)
    expect(typeof serverNode.data.memoryUsed).toBe('number')
    expect(serverNode.data.memoryUsed).toBeGreaterThan(0)
    expect(serverNode.data.maxmemoryBytes).toBe(1000)
    expect(serverNode.data.evictionPolicy).toBe('allkeys-lru')
  })

  it('marks exactly the ids in highlight and no others', () => {
    const topo = topology()
    const sim = createRedisSimulation({ topology: topo, script: [], seed: 1 })
    const nodes = toFlowNodes(topo, sim.snapshot(), ['c1', 'redis'])
    const marked = nodes.filter((n) => n.data.highlighted).map((n) => n.id)
    expect(marked.sort()).toEqual(['c1', 'redis'])
    expect(nodes.find((n) => n.id === 'c2')!.data.highlighted).toBe(false)
  })

  it('marks nothing when no highlight is given', () => {
    const topo = topology()
    const sim = createRedisSimulation({ topology: topo, script: [], seed: 1 })
    const nodes = toFlowNodes(topo, sim.snapshot())
    expect(nodes.every((n) => n.data.highlighted === false)).toBe(true)
  })

  it('ignores a highlight id that matches no node instead of throwing', () => {
    const topo = topology()
    const sim = createRedisSimulation({ topology: topo, script: [], seed: 1 })
    expect(() => toFlowNodes(topo, sim.snapshot(), ['ghost-node'])).not.toThrow()
    const nodes = toFlowNodes(topo, sim.snapshot(), ['ghost-node', 'c1'])
    expect(nodes.filter((n) => n.data.highlighted).map((n) => n.id)).toEqual(['c1'])
  })

  it('keeps node position objects referentially stable across simulation ticks', () => {
    const topo = topology()
    const sim = createRedisSimulation({
      topology: topo,
      script: [{ at: 0, clientId: 'c1', name: 'SET', args: ['k', 'v'] }],
      seed: 1,
    })
    sim.advanceTo(50)
    const first = new Map(toFlowNodes(topo, sim.snapshot()).map((n) => [n.id, n.position]))

    let ticks = 0
    for (let t = 150; t <= 2000; t += 100) {
      sim.advanceTo(t)
      for (const node of toFlowNodes(topo, sim.snapshot())) {
        expect(first.get(node.id)).toBe(node.position)
      }
      ticks++
    }
    expect(ticks).toBeGreaterThan(10)
  })

  it('includes a node per replica and per sentinel when the topology declares them', () => {
    const topo = topology({
      replicas: [{ id: 'r1', label: 'Replica 1', position: { x: 0, y: 300 }, lagMs: 200 }],
      sentinels: [{ id: 's1', label: 'Sentinel 1', position: { x: 300, y: 300 } }],
    })
    const sim = createRedisSimulation({ topology: topo, script: [], seed: 1 })
    const nodes = toFlowNodes(topo, sim.snapshot())
    const replicaNode = nodes.find((n) => n.id === 'r1')
    const sentinelNode = nodes.find((n) => n.id === 's1')
    expect(replicaNode?.type).toBe('replica')
    expect(sentinelNode?.type).toBe('sentinel')
  })
})

describe('toFlowEdges', () => {
  it('gives one edge per client in each direction', () => {
    const topo = topology()
    const edges = toFlowEdges(topo)
    const ids = edges.map((e) => e.id).sort()
    expect(ids).toEqual(['c1->redis', 'c2->redis', 'redis->c1', 'redis->c2'])
  })

  it('produces no edges for a topology with no clients', () => {
    const topo = topology({ clients: [] })
    expect(toFlowEdges(topo)).toEqual([])
  })

  it('returns a referentially stable edge list shape across calls with the same topology object', () => {
    // Not identity of the array itself (a fresh call always returns a fresh array — the
    // caller memoizes on the topology reference), but each edge's own id/source/target must
    // not vary between calls, since CanvasView's useMemo re-derives from this every time the
    // topology reference changes.
    const topo = topology()
    const first = toFlowEdges(topo)
    const second = toFlowEdges(topo)
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id))
  })

  it('adds a dashed server->replica edge and a sentinel->server edge', () => {
    const topo = topology({
      replicas: [{ id: 'r1', label: 'Replica 1', position: { x: 0, y: 300 }, lagMs: 200 }],
      sentinels: [{ id: 's1', label: 'Sentinel 1', position: { x: 300, y: 300 } }],
    })
    const edges = toFlowEdges(topo)
    const replicaEdge = edges.find((e) => e.id === 'redis->r1')
    expect(replicaEdge).toBeDefined()
    expect(replicaEdge?.style).toMatchObject({ strokeDasharray: '4 4' })
    expect(edges.find((e) => e.id === 's1->redis')).toBeDefined()
  })
})
