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

describe('canvas invariants that later tasks depend on', () => {
  it('keeps node position objects referentially stable across simulation ticks', () => {
    // The engine emits a fresh EngineState every animation frame. React Flow
    // re-runs layout when a node's position object changes, so rebuilding
    // positions each tick would re-layout the canvas 60 times a second and make
    // it visibly jitter. Task 13 also reads edge geometry from React Flow, so
    // unstable geometry breaks message particles too.
    const sim = createSimulation({
      topology: lesson.topology,
      script: lesson.script,
      failures: lesson.failures,
      seed: lesson.seed,
    })
    sim.advanceTo(1000)
    const first = new Map(toFlowNodes(lesson.topology, sim.snapshot()).map((n) => [n.id, n.position]))

    let ticks = 0
    for (let t = 1100; t <= 8000; t += 100) {
      sim.advanceTo(t)
      for (const node of toFlowNodes(lesson.topology, sim.snapshot())) {
        // Identity, not equality: a new object with the same x/y still re-layouts.
        expect(first.get(node.id)).toBe(node.position)
      }
      ticks++
    }
    expect(ticks).toBeGreaterThan(50)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))(
    '%s: every edge the engine animates over is drawn on the canvas',
    (_id, currentLesson) => {
      // Task 13 positions particles by looking up the React Flow edge named
      // `${fromId}->${toId}`. toFlowEdges derives publisher edges heuristically
      // (a publisher connects to each exchange that has at least one binding),
      // so a lesson publishing to an unbound exchange would animate over an edge
      // that was never drawn. Lessons 2-17 land across three later tasks; this
      // catches that mismatch at the lesson that introduces it.
      const sim = createSimulation({
        topology: currentLesson.topology,
        script: currentLesson.script,
        failures: currentLesson.failures,
        seed: currentLesson.seed,
      })
      const travelled = new Set<string>()
      for (let t = 0; t <= currentLesson.durationMs + 20_000; t += 100) {
        sim.advanceTo(t)
        for (const flight of sim.snapshot().inFlight) travelled.add(flight.edgeId)
      }
      expect(travelled.size).toBeGreaterThan(0)

      const drawn = new Set(toFlowEdges(currentLesson.topology).map((e) => e.id))
      expect([...travelled].filter((id) => !drawn.has(id))).toEqual([])
    },
  )
})
