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

describe('toFlowNodes narrative highlight', () => {
  const state = () => createSimulation({ topology: lesson.topology, script: [], seed: 1 }).snapshot()

  it('marks exactly the ids in highlight and no others', () => {
    // One id from each of the four node kinds is reachable, so this also proves the flag
    // is set on every kind rather than only the ones that happened to be checked.
    const nodes = toFlowNodes(lesson.topology, state(), ['p1', 'hello'])
    const marked = nodes.filter((n) => n.data.highlighted).map((n) => n.id)
    expect(marked.sort()).toEqual(['hello', 'p1'])
    expect(nodes.find((n) => n.id === 'default')!.data.highlighted).toBe(false)
    expect(nodes.find((n) => n.id === 'c1')!.data.highlighted).toBe(false)
  })

  it('marks the exchange and the consumer when those are the highlighted ids', () => {
    const nodes = toFlowNodes(lesson.topology, state(), ['default', 'c1'])
    const marked = nodes.filter((n) => n.data.highlighted).map((n) => n.id)
    expect(marked.sort()).toEqual(['c1', 'default'])
  })

  it('marks nothing when no highlight is given, which is the sandbox case', () => {
    const nodes = toFlowNodes(lesson.topology, state())
    expect(nodes.every((n) => n.data.highlighted === false)).toBe(true)
    expect(nodes).toHaveLength(4)
  })

  it('ignores a highlight id that matches no node instead of throwing', () => {
    const nodes = toFlowNodes(lesson.topology, state(), ['ghost-node', 'hello'])
    expect(nodes.filter((n) => n.data.highlighted).map((n) => n.id)).toEqual(['hello'])
    expect(nodes).toHaveLength(4)
  })

  it('highlights every id of the active step for every lesson that declares one', () => {
    // Highlight ids are authored by hand in seventeen lesson files. An id that has drifted
    // from the topology silently emphasises nothing, which looks identical to a step that
    // chose not to highlight — so check the whole corpus resolves.
    for (const currentLesson of LESSONS) {
      const sim = createSimulation({ topology: currentLesson.topology, script: [], seed: 1 })
      for (const step of currentLesson.narrative) {
        if (!step.highlight) continue
        const nodes = toFlowNodes(currentLesson.topology, sim.snapshot(), step.highlight)
        const marked = nodes.filter((n) => n.data.highlighted).map((n) => n.id)
        expect(marked.sort()).toEqual([...step.highlight].sort())
      }
    }
  })

  it('keeps node position objects stable when the highlight changes', () => {
    // Same hazard as the tick-stability invariant below: a new position object per render
    // re-layouts the canvas, and the highlight changes on every narrative step boundary.
    const snapshot = state()
    const before = new Map(toFlowNodes(lesson.topology, snapshot, ['p1']).map((n) => [n.id, n.position]))
    for (const node of toFlowNodes(lesson.topology, snapshot, ['hello', 'c1'])) {
      expect(before.get(node.id)).toBe(node.position)
    }
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
