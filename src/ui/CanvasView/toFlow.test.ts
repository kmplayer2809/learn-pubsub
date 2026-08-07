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

      const drawn = new Set(toFlowEdges(currentLesson.topology, currentLesson.script).map((e) => e.id))
      expect([...travelled].filter((id) => !drawn.has(id))).toEqual([])
    },
  )

  it.each(LESSONS.map((l) => [l.id, l] as const))(
    '%s: draws no edge that is neither declared in the topology nor actually travelled',
    (_id, currentLesson) => {
      // The invariant above is one-directional: it catches edges that are travelled
      // but not drawn, and stays green no matter how many edges are invented. Two
      // cross-product heuristics exploited exactly that — the consumer one fabricated
      // four of eleven edges on 11-dlx, and the publisher one survived that fix and
      // still fabricated `p1->main-ex` on 16-delayed, whose whole point is that
      // `main-ex` is reachable ONLY by dead-lettering.
      //
      // This covers every edge family at once rather than one at a time. An edge is
      // legitimate if the topology declares it (a binding, a consumer's queue, a
      // dead-letter link) — those are drawn whether or not this lesson's script
      // happens to exercise them, which is correct: 13-retry-backoff really does
      // bind `retry-ex->parking-lot` and never sends anything down it. Every OTHER
      // edge is inferred, so it must correspond to traffic that actually happened.
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

      const declared = new Set<string>()
      for (const b of currentLesson.topology.bindings) declared.add(`${b.exchangeId}->${b.destinationId}`)
      for (const c of currentLesson.topology.consumers) declared.add(`${c.queueId}->${c.id}`)
      for (const q of currentLesson.topology.queues) {
        if (q.deadLetterExchange) declared.add(`${q.id}->${q.deadLetterExchange}`)
      }

      const drawn = toFlowEdges(currentLesson.topology, currentLesson.script)
      const fabricated = drawn.filter((e) => !declared.has(e.id) && !travelled.has(e.id))
      expect(fabricated.map((e) => e.id)).toEqual([])
    },
  )

  it('draws only the exchanges a publisher actually publishes to', () => {
    const delayed = LESSONS.find((l) => l.id === '16-delayed')!
    const ids = toFlowEdges(delayed.topology, delayed.script).map((e) => e.id)
    // `p1` publishes to `delay-ex` only. `main-ex` is reachable exclusively by
    // dead-lettering out of `delay-5s`, and drawing a solid publisher arrow into it
    // contradicts the lesson standing next to it.
    expect(ids).toContain('p1->delay-ex')
    expect(ids).not.toContain('p1->main-ex')
  })

  it('falls back to the binding heuristic for a publisher with no scripted actions', () => {
    // A node just dropped on the Sandbox canvas has published nothing yet. It still
    // needs an edge, or it floats disconnected and the user cannot see what it feeds.
    const ids = toFlowEdges(lesson.topology, []).map((e) => e.id)
    expect(ids).toContain('p1->default')
  })

  it('draws the rpc reply edge for the consumer that actually answers', () => {
    const rpc = LESSONS.find((l) => l.id === '14-rpc')!
    const ids = toFlowEdges(rpc.topology, rpc.script).map((e) => e.id)
    // `worker` consumes the request, so `worker` publishes the reply. `caller`
    // consumes the reply and answers nothing, so it gets no outbound edge.
    expect(ids).toContain('worker->replies')
    expect(ids).not.toContain('caller->replies')
    expect(ids).not.toContain('caller->rpc-ex')
    expect(ids).not.toContain('worker->rpc-ex')
  })
})
