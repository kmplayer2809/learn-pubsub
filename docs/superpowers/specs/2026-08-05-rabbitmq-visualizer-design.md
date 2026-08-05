# RabbitMQ Flow Visualizer — Design

**Date:** 2026-08-05
**Status:** Approved

## 1. Purpose

An interactive React application that teaches RabbitMQ by animating message flow between
publishers, exchanges, queues, and consumers. It covers material from first principles
(what a routing key does) through advanced operational topics (dead-letter retry loops,
RPC correlation, quorum queue failover).

The application is a teaching tool, not an operations dashboard. Every design decision
favours comprehension — the ability to pause mid-delivery, step one event at a time, and
rewind — over fidelity to a live broker's wire protocol.

## 2. Key decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Data source | Simulated broker in the browser | No Docker, runs offline, and supports pause/step/rewind, which a real broker cannot. |
| Backend | None | NestJS appears only as generated snippet output in the Sandbox, not as a running service. |
| Interaction | Guided lessons plus a free-form Sandbox | Lessons give beginners a path; Sandbox lets them test hypotheses. |
| Layout | Three columns: lessons, canvas, inspector | Canvas gets the largest area; narrative and metrics stay visible beside it. |
| Engine | Discrete-event simulation, pure TypeScript | Deterministic, unit-testable without a DOM, decoupled from rendering. |
| Rendering | React Flow plus an SVG overlay | React Flow supplies nodes, edges, and Sandbox drag-and-drop; the overlay draws in-flight message particles. |

## 3. Architecture

```
src/
  engine/                 pure TypeScript, no React import anywhere
    clock.ts              virtual clock and min-heap event scheduler
    broker.ts             exchanges, queues, bindings, channels
    routing/              direct.ts | fanout.ts | topic.ts | headers.ts
    delivery.ts           ack, nack, prefetch, redelivery, round-robin dispatch
    dlx.ts                TTL, max-length, dead-lettering
    rng.ts                seeded PRNG (mulberry32)
    types.ts              Topology, Message, SimEvent, EngineState
    index.ts              createSimulation(topology, seed)
  sim/
    useSimulation.ts      drives the engine from requestAnimationFrame
    store.ts              Zustand: transport state, selection, sandbox draft
  ui/
    LessonSidebar/ CanvasView/ Inspector/ Transport/
    canvas/nodes/         PublisherNode ExchangeNode QueueNode ConsumerNode DlxNode
    canvas/MessageLayer   SVG overlay for message particles
  lessons/<id>/lesson.ts
  sandbox/
```

### 3.1 Simulation engine

The engine is a discrete-event simulation, not a fixed-interval tick loop. Every action
with a duration is an event held in a min-heap ordered by virtual time: `publish`,
`route`, `enqueue`, `deliver`, `ackTimeout`, `ttlExpire`, `retryBackoff`, `consumeDone`.

```ts
applyEvent(state: EngineState, event: SimEvent): {
  state: EngineState
  newEvents: SimEvent[]
  journal: JournalEntry[]
}

advanceTo(virtualMs: number): void   // pops and applies every event at or before virtualMs
```

`applyEvent` is a pure reducer. It never mutates its input and never touches the DOM,
timers, or `Math.random`. All randomness — consumer processing jitter, nack probability —
comes from a seeded PRNG stored in engine state, so a given `(topology, script, seed)`
triple always produces a byte-identical journal.

That determinism is what makes rewind cheap: scrubbing backwards re-runs the simulation
from `t=0` with the same seed rather than restoring snapshots. A 30-second lesson is a few
thousand events and replays in well under a millisecond.

### 3.2 Transport controls

Play, pause, speed, step, and scrub are all expressed through the virtual clock. None of
them touch broker logic.

- **Play / speed** — multiply elapsed wall-clock milliseconds per animation frame by the
  speed factor and call `advanceTo`.
- **Pause** — stop advancing. Particles freeze mid-edge because their position is derived
  from virtual time, not from a CSS animation.
- **Step** — `advanceTo(nextEventTime)`, applying exactly one event.
- **Scrub** — re-run from `t=0` to the target time.

### 3.3 Animation model

Each in-flight message carries `{ edgeId, fromT, toT }`. `MessageLayer` computes each
particle's position by interpolating virtual time along the edge's SVG path via
`getPointAtLength`. Because position is a pure function of virtual time, pause, step, and
rewind produce correct intermediate frames for free.

React Flow owns node layout and edge geometry. The overlay reads edge paths from React
Flow and renders particles above them, so particle rendering never triggers a React Flow
re-layout.

## 4. Lesson model

Lessons are data, not bespoke components. Adding a lesson means adding one file.

```ts
interface Lesson {
  id: string
  group: 'basics' | 'reliability' | 'dlx' | 'patterns'
  title: string
  topology: Topology          // nodes, bindings, canvas positions
  script: ScriptedAction[]    // { at, exchange, routingKey, headers, body }
  consumers: ConsumerBehavior[] // { ackDelay, nackRate, prefetch }
  narrative: NarrativeStep[]  // markdown keyed to virtual timestamps
  highlights: Highlight[]     // node or edge ids emphasised at each step
  checkpoints?: Checkpoint[]  // inline "what happens if…" questions
}
```

As the simulation crosses a `NarrativeStep`'s timestamp, the inspector scrolls to that
step's markdown and the canvas highlights the referenced nodes.

### 4.1 Lesson list

**Basics**

1. Hello world — default exchange, one queue, one consumer
2. Direct exchange and exact routing-key matching
3. Fanout exchange — one message, every bound queue
4. Topic exchange — `*` versus `#` pattern semantics
5. Headers exchange — `x-match: all` versus `any`
6. Competing consumers — round-robin dispatch across consumers

**Reliability**

7. Auto-ack versus manual ack — demonstrates message loss on consumer crash
8. Prefetch and QoS — demonstrates unfair dispatch when prefetch is unbounded
9. Nack and requeue — the `redelivered` flag and redelivery ordering
10. Durability and publisher confirms — persistent messages, confirm callbacks

**Dead-lettering and retry**

11. Dead Letter Exchange — a rejected message routed to the DLX
12. TTL and max-length — expiry and overflow both dead-letter
13. Retry with backoff — delay queues, a parking lot queue, poison-message handling

**Patterns**

14. RPC — `reply-to` and `correlationId` round trip
15. Priority queue — priority ordering versus arrival ordering
16. Delayed message — scheduled delivery via a TTL delay queue
17. Quorum versus classic queue — replication and failover behaviour

## 5. Sandbox

The Sandbox reuses the lesson canvas with editing enabled.

- A palette adds publishers, exchanges, queues, and consumers.
- Connecting two nodes creates a binding; the inspector edits its routing key or headers.
- The inspector edits the selected node's configuration: exchange type, prefetch, TTL,
  DLX target, max-length, priority support.
- A publish panel sends a single hand-written message or starts a load generator at a
  chosen rate in messages per second.
- Topologies save to `localStorage` and export as JSON.
- **Export as code** generates equivalent `amqplib` and `@nestjs/microservices` snippets
  from the current topology. This is the only place NestJS appears, and it is generated
  text rather than a running service.

## 6. Validation and error handling

Topologies are validated before a run starts. Validation errors appear inline in the
inspector, attached to the offending node.

- A queue with no binding that can ever receive a message
- A DLX target that does not exist
- A dead-letter cycle whose TTL is zero, which would loop without advancing time

The engine also enforces runtime guards so a pathological topology cannot hang the tab:
a ceiling on events processed per virtual second and a ceiling on journal length. When a
guard trips, the run halts and the inspector explains which guard fired and why.

## 7. Testing

- **Engine unit tests** cover each routing type, ack and prefetch behaviour, requeue
  ordering, TTL expiry, max-length overflow, and dead-lettering.
- **A determinism test** runs the same seed twice and asserts the journals are identical.
- **Golden journal tests** run each lesson for 30 virtual seconds and snapshot the
  journal, so an engine change that breaks a lesson fails CI rather than shipping.
- **UI smoke tests** confirm the app renders, a lesson loads, and transport controls
  advance the clock.

Vitest is the runner. The engine's freedom from React means its tests need no DOM.

## 8. Stack

Vite, React 18, TypeScript in strict mode, `@xyflow/react`, Zustand, Tailwind CSS,
framer-motion for panel transitions only, and Vitest. Message particles use raw SVG
rather than framer-motion, because hundreds of simultaneous particles must not each carry
an animation controller.

No backend, no Docker, no network calls at runtime.

## 9. Delivery phases

| Phase | Scope | Depends on |
| --- | --- | --- |
| 1 | Engine core: clock, broker, routing, types, RNG, tests | — |
| 2 | App shell, canvas, transport, MessageLayer, inspector | 1 |
| 3 | Lessons 1–6 (basics) | 2 |
| 4 | Delivery and DLX engine features, lessons 7–13 | 3 |
| 5 | Patterns engine features, lessons 14–17 | 4 |
| 6 | Sandbox editing and code export | 5 |
