import { describe, expect, it } from 'vitest'
import { createSimulation } from '../../engine'
import { LESSONS } from '../../lessons/registry'
import { toFlowEdges, toFlowNodes } from './toFlow'

const lesson = LESSONS[0]!

describe('toFlowNodes', () => {
  it('creates one node per topology entity', () => {
    const sim = createSimulation({ topology: lesson.topology, script: [], seed: 1 })
    const nodes = toFlowNodes(lesson.topology, sim.snapshot())
    expect(nodes).toHaveLength(
      lesson.topology.publishers.length +
        lesson.topology.exchanges.length +
        lesson.topology.queues.length +
        lesson.topology.consumers.length,
    )
  })

  it('carries live queue depth into node data', () => {
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(1500)
    const nodes = toFlowNodes(lesson.topology, sim.snapshot())
    const queueNode = nodes.find((n) => n.id === 'hello')!
    expect(queueNode.data).toHaveProperty('depth')
  })
})

describe('toFlowEdges', () => {
  it('uses source->target ids so the message layer can find them', () => {
    const edges = toFlowEdges(lesson.topology)
    expect(edges.some((e) => e.id === 'default->hello')).toBe(true)
    expect(edges.some((e) => e.id === 'p1->default')).toBe(true)
    expect(edges.some((e) => e.id === 'hello->c1')).toBe(true)
  })

  it('adds a dashed edge from a queue to its dead-letter exchange', () => {
    const withDlx = {
      ...lesson.topology,
      exchanges: [
        ...lesson.topology.exchanges,
        { id: 'dlx', label: 'dlx', type: 'fanout' as const, position: { x: 480, y: 320 } },
      ],
      queues: [{ ...lesson.topology.queues[0]!, deadLetterExchange: 'dlx' }],
    }
    const edges = toFlowEdges(withDlx)
    const dlxEdge = edges.find((e) => e.id === 'hello->dlx')!
    expect(dlxEdge).toBeDefined()
    expect(dlxEdge.animated).toBe(false)
  })
})
