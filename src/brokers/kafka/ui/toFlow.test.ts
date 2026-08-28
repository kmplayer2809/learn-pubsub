import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, type KafkaTopology } from '../engine'
import { toFlowEdges, toFlowNodes } from './toFlow'

function topology(overrides: Partial<KafkaTopology> = {}): KafkaTopology {
  return {
    brokers: [
      { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
      { id: 'b2', label: 'Broker 2', position: { x: 300, y: 0 } },
    ],
    topics: [{ name: 'orders', partitions: 2, replicationFactor: 2 }],
    producers: [{ id: 'p1', label: 'Producer 1', position: { x: 0, y: 250 } }],
    consumers: [
      { id: 'c1', label: 'Consumer 1', position: { x: 300, y: 250 }, groupId: 'g1', subscriptions: ['orders'] },
    ],
    controllerBrokerId: 'b1',
    ...overrides,
  }
}

function snapshotFor(topo: KafkaTopology) {
  return createKafkaSimulation({ topology: topo, script: [], seed: 1 }).snapshot()
}

describe('toFlowNodes', () => {
  it('mỗi partition là một node con của broker đang làm leader', () => {
    const topo = topology()
    const state = snapshotFor(topo)
    const nodes = toFlowNodes(topo, state)
    const p0 = nodes.find((n) => n.id === 'orders-0')
    expect(p0?.type).toBe('partition')
    expect(p0?.parentId).toBe(state.partitions['orders-0']!.leader)
  })

  it('node partition xếp theo thứ tự sort, không theo thứ tự chèn', () => {
    // `zeta` chèn trước `alpha` trong topology, nhưng sort theo tên đưa `alpha-0` lên trước.
    const topo = topology({
      topics: [
        { name: 'zeta', partitions: 1, replicationFactor: 1 },
        { name: 'alpha', partitions: 1, replicationFactor: 1 },
      ],
      consumers: [],
    })
    const state = snapshotFor(topo)
    const ids = toFlowNodes(topo, state)
      .filter((n) => n.type === 'partition')
      .map((n) => n.id)
    expect(ids).toEqual([...ids].sort())
    expect(ids).toEqual(['alpha-0', 'zeta-0'])
  })

  it('consumer là node con của consumer group của nó', () => {
    const topo = topology()
    const state = snapshotFor(topo)
    const c1 = toFlowNodes(topo, state).find((n) => n.id === 'c1')
    expect(c1?.type).toBe('consumer')
    expect(c1?.parentId).toBe('g1')
  })

  it('consumerGroup node được suy ra từ topology.consumers[].groupId, khử trùng và sort', () => {
    const topo = topology({
      consumers: [
        { id: 'c1', label: 'C1', position: { x: 0, y: 0 }, groupId: 'zeta-group', subscriptions: ['orders'] },
        { id: 'c2', label: 'C2', position: { x: 0, y: 100 }, groupId: 'alpha-group', subscriptions: ['orders'] },
        { id: 'c3', label: 'C3', position: { x: 0, y: 200 }, groupId: 'zeta-group', subscriptions: ['orders'] },
      ],
    })
    const state = snapshotFor(topo)
    const groupIds = toFlowNodes(topo, state)
      .filter((n) => n.type === 'consumerGroup')
      .map((n) => n.id)
    expect(groupIds).toEqual(['alpha-group', 'zeta-group'])
  })

  it('sinh node theo đúng thứ tự broker -> partition -> consumerGroup -> consumer -> producer', () => {
    const topo = topology()
    const state = snapshotFor(topo)
    const types = toFlowNodes(topo, state).map((n) => n.type)
    expect(types).toEqual(['broker', 'broker', 'partition', 'partition', 'consumerGroup', 'consumer', 'producer'])
  })

  it('mỗi node xuất hiện sau node cha của nó trong mảng — React Flow yêu cầu vậy để định vị được', () => {
    const topo = topology()
    const state = snapshotFor(topo)
    const nodes = toFlowNodes(topo, state)
    const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
    for (const node of nodes) {
      if (node.parentId === undefined) continue
      expect(indexOf.get(node.parentId)).toBeLessThan(indexOf.get(node.id)!)
    }
  })

  it('highlight đánh dấu đúng node được nêu tên, không đánh dấu node khác', () => {
    const topo = topology()
    const state = snapshotFor(topo)
    const nodes = toFlowNodes(topo, state, ['b1', 'c1'])
    const marked = nodes.filter((n) => n.data.highlighted).map((n) => n.id)
    expect(marked.sort()).toEqual(['b1', 'c1'])
    expect(nodes.find((n) => n.id === 'b2')!.data.highlighted).toBe(false)
  })

  it('bỏ qua id highlight không khớp node nào thay vì ném lỗi', () => {
    const topo = topology()
    const state = snapshotFor(topo)
    expect(() => toFlowNodes(topo, state, ['ghost-node'])).not.toThrow()
    const nodes = toFlowNodes(topo, state, ['ghost-node', 'p1'])
    expect(nodes.filter((n) => n.data.highlighted).map((n) => n.id)).toEqual(['p1'])
  })

  it('giữ tham chiếu position ổn định qua các tick với node có spec object riêng', () => {
    const topo = topology()
    const sim = createKafkaSimulation({ topology: topo, script: [], seed: 1 })
    const first = new Map(toFlowNodes(topo, sim.snapshot()).map((n) => [n.id, n.position]))
    sim.advanceTo(500)
    for (const node of toFlowNodes(topo, sim.snapshot())) {
      if (node.type === 'broker' || node.type === 'producer' || node.type === 'consumer') {
        expect(first.get(node.id)).toBe(node.position)
      }
    }
  })
})

describe('toFlowEdges', () => {
  it('edge producer nối tới từng partition của topic nó ghi', () => {
    const topo = topology()
    const edges = toFlowEdges(topo)
    expect(edges.find((e) => e.id === 'p1->orders-0')).toBeDefined()
    expect(edges.find((e) => e.id === 'p1->orders-1')).toBeDefined()
  })

  // Brief's own test list says "edge consumer chỉ nối tới partition đang được giao cho
  // nó" (assignment), nhưng `toFlowEdges(topology)` chỉ nhận topology — assignment sống
  // trong `GroupMember.assignment`, một trường của STATE mà hàm này không nhận, và group
  // coordinator/rebalance chưa được implement ở plan này. Test dưới đây khẳng định đúng
  // những gì chữ ký hàm cho phép: cạnh tới mọi partition của mọi topic trong
  // `subscriptions`. Partition nào "đang sống" tại một thời điểm là việc của `inFlight`.
  it('edge consumer nối tới mọi partition của mọi topic nó subscribe', () => {
    const topo = topology({ topics: [{ name: 'orders', partitions: 2, replicationFactor: 2 }] })
    const edges = toFlowEdges(topo)
    expect(edges.find((e) => e.id === 'orders-0->c1')).toBeDefined()
    expect(edges.find((e) => e.id === 'orders-1->c1')).toBeDefined()
  })

  it('không vẽ cạnh tới partition của topic consumer không subscribe', () => {
    const topo = topology({
      topics: [
        { name: 'orders', partitions: 1, replicationFactor: 1 },
        { name: 'payments', partitions: 1, replicationFactor: 1 },
      ],
      consumers: [
        { id: 'c1', label: 'Consumer 1', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'] },
      ],
    })
    const edges = toFlowEdges(topo)
    expect(edges.find((e) => e.id === 'payments-0->c1')).toBeUndefined()
  })

  it('toFlowEdges chỉ phụ thuộc topology — gọi hai lần với cùng topology cho cùng kết quả', () => {
    const topo = topology()
    const first = toFlowEdges(topo)
    const second = toFlowEdges(topo)
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id))
  })

  it('không sinh cạnh nào khi topology không có producer/consumer', () => {
    const topo = topology({ producers: [], consumers: [] })
    expect(toFlowEdges(topo)).toEqual([])
  })
})
