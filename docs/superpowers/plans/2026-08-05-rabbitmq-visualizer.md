# RabbitMQ Flow Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only React application that animates RabbitMQ message flow across 17 guided lessons plus a free-form sandbox, driven by a deterministic discrete-event simulation of a broker.

**Architecture:** A pure TypeScript engine in `src/engine/` owns all broker semantics as a discrete-event simulation over a virtual clock; it imports nothing from React. A thin binding layer in `src/sim/` advances that clock from `requestAnimationFrame` and exposes immutable snapshots. The UI renders topology with React Flow and draws in-flight message particles in an SVG overlay whose positions are interpolated from virtual time, so pause, step, and rewind come free.

**Tech Stack:** Vite, React 18, TypeScript (strict), `@xyflow/react`, Zustand, Tailwind CSS, framer-motion (panel transitions only), Vitest.

## Global Constraints

- TypeScript `strict: true`. No `any` in `src/engine/`.
- `src/engine/**` must not import React, Zustand, `@xyflow/react`, or any DOM API. Enforced by a lint test in Task 2.
- No `Math.random()`, `Date.now()`, or `setTimeout` anywhere in `src/engine/**`. All randomness comes from the seeded PRNG in engine state; all time is virtual.
- All engine reducers are pure: never mutate inputs, always return new state.
- Package manager: `npm`.
- Test runner: `vitest`. Every task ends green before commit.
- Commit after every task using Conventional Commits (`feat:`, `test:`, `chore:`).
- **Language: all reader-facing copy is Vietnamese.** Lesson `summary`, every
  `NarrativeStep.title` and `.body`, every `Checkpoint.question`, `.options` and
  `.explanation`, every `LESSON_GROUPS` label, and every UI string (buttons, headings,
  `aria-label`, empty states) are written in Vietnamese. RabbitMQ and programming terms
  stay in English, unchanged and untranslated: exchange, queue, binding, routing key,
  publisher, consumer, ack / nack / requeue, prefetch, QoS, dead-letter exchange (DLX),
  TTL, max-length, drop-head, persistent, durable, publisher confirms, redelivery,
  parking lot, RPC, `replyTo`, `correlationId`, quorum, classic, header names such as
  `x-death-reason`, exchange type names (`direct`, `fanout`, `topic`, `headers`), and all
  identifiers, code spans, and journal text. Do NOT translate identifiers, `data-testid`
  values, node ids, or anything inside backticks. Journal/event-log text emitted by
  `src/engine/**` stays English — the engine is not a presentation layer and tests assert
  on its substrings.
- **Lesson-level `title` is exempt and stays English** when it is the bare name of the
  thing being taught: `Direct exchange`, `Topic exchange`, `Competing consumers`,
  `Publisher confirms`, `Dead-letter exchange`, `RPC`, `Quorum vs classic`, and the
  canonical tutorial name `Hello world`. The sidebar is a technical index; a lesson title
  is the term itself, and the reader needs to recognise it in RabbitMQ's own docs. This
  exemption covers lesson `title` ONLY — `summary`, narrative step `title` and `body`, and
  every checkpoint field are Vietnamese prose with English terms embedded, per the rule
  above. `src/lessons/language.test.ts` encodes exactly this split.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/engine/types.ts` | All engine data types: `Topology`, `Message`, `SimEvent`, `EngineState`, `JournalEntry` |
| `src/engine/rng.ts` | mulberry32 seeded PRNG, pure `next(state)` form |
| `src/engine/clock.ts` | Min-heap event scheduler over virtual milliseconds |
| `src/engine/routing/*.ts` | One matcher per exchange type: direct, fanout, topic, headers |
| `src/engine/broker.ts` | Publish and route: message enters an exchange, produces enqueue events |
| `src/engine/delivery.ts` | Consumer dispatch, prefetch, ack, nack, requeue, redelivery |
| `src/engine/dlx.ts` | TTL expiry, max-length overflow, reject routing to a dead-letter exchange |
| `src/engine/advanced.ts` | Priority ordering, delayed delivery, RPC reply correlation, quorum failover |
| `src/engine/validate.ts` | Pre-run topology validation and runtime runaway guards |
| `src/engine/index.ts` | `createSimulation` façade: `advanceTo`, `snapshot`, `reset`, `journal` |
| `src/sim/store.ts` | Zustand store: transport state, selected node, active lesson, sandbox draft |
| `src/sim/useSimulation.ts` | rAF loop that advances the engine and republishes snapshots |
| `src/ui/App.tsx` | Three-column shell |
| `src/ui/LessonSidebar/` | Grouped lesson list and sandbox entry |
| `src/ui/CanvasView/` | React Flow wrapper, node types, edge derivation from topology |
| `src/ui/canvas/MessageLayer.tsx` | SVG overlay drawing in-flight message particles |
| `src/ui/Inspector/` | Narrative markdown, node config form, metrics, event log |
| `src/ui/Transport/` | Play, pause, step, speed, scrub |
| `src/lessons/` | One data file per lesson plus the registry |
| `src/sandbox/` | Palette, editing handlers, code export |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `src/index.css`, `.gitignore`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` and `npm run dev`

- [ ] **Step 1: Scaffold with Vite**

```bash
cd "/Users/htrongdi/Desktop/test service"
npm create vite@latest . -- --template react-ts
npm install
npm install @xyflow/react zustand framer-motion
npm install -D tailwindcss postcss autoprefixer vitest jsdom @testing-library/react @testing-library/jest-dom
npx tailwindcss init -p
```

- [ ] **Step 2: Configure Tailwind**

`tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

Replace `src/index.css` entirely with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
```

- [ ] **Step 3: Configure Vitest**

`vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Enable strict TypeScript**

In `tsconfig.json` `compilerOptions`, ensure:

```json
"strict": true,
"noUncheckedIndexedAccess": true,
"noUnusedLocals": true
```

- [ ] **Step 5: Write the smoke test**

`src/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Replace App with the three-column shell placeholder**

`src/ui/App.tsx`:

```tsx
export default function App() {
  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800 p-3" data-testid="lesson-sidebar">
        Lessons
      </aside>
      <main className="flex min-w-0 flex-1 flex-col" data-testid="canvas-column">
        <div className="flex-1" data-testid="canvas" />
        <div className="h-14 border-t border-slate-800" data-testid="transport" />
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3" data-testid="inspector">
        Inspector
      </aside>
    </div>
  )
}
```

Point `src/main.tsx` at it and delete `src/App.tsx`, `src/App.css`.

- [ ] **Step 7: Run tests and dev server**

Run: `npm test`
Expected: PASS, 1 test.

Run: `npm run dev`
Expected: server starts, page shows three columns.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite react ts tailwind vitest"
```

---

## Task 2: Engine types, seeded PRNG, and the purity guard

**Files:**
- Create: `src/engine/types.ts`, `src/engine/rng.ts`, `src/engine/rng.test.ts`, `src/engine/purity.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers'`
  - `interface Topology`, `interface Message`, `interface SimEvent`, `interface EngineState`, `interface JournalEntry`
  - `createRng(seed: number): RngState`
  - `nextFloat(rng: RngState): [number, RngState]`
  - `nextInt(rng: RngState, maxExclusive: number): [number, RngState]`

- [ ] **Step 1: Write the failing PRNG test**

`src/engine/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRng, nextFloat, nextInt } from './rng'

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    const [x] = nextFloat(a)
    const [y] = nextFloat(b)
    expect(x).toBe(y)
  })

  it('does not mutate the input state', () => {
    const rng = createRng(7)
    const before = rng.s
    nextFloat(rng)
    expect(rng.s).toBe(before)
  })

  it('advances state so successive draws differ', () => {
    let rng = createRng(1)
    const [first, r1] = nextFloat(rng)
    rng = r1
    const [second] = nextFloat(rng)
    expect(first).not.toBe(second)
  })

  it('bounds nextInt to [0, maxExclusive)', () => {
    let rng = createRng(99)
    for (let i = 0; i < 200; i++) {
      const [n, next] = nextInt(rng, 5)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(5)
      rng = next
    }
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/rng.test.ts`
Expected: FAIL, `Failed to resolve import "./rng"`.

- [ ] **Step 3: Implement the PRNG**

`src/engine/rng.ts`:

```ts
export interface RngState {
  readonly s: number
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 }
}

/** mulberry32, expressed as a pure step so engine state stays immutable. */
export function nextFloat(rng: RngState): [number, RngState] {
  let t = (rng.s + 0x6d2b79f5) >>> 0
  let r = t
  r = Math.imul(r ^ (r >>> 15), r | 1)
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296
  return [value, { s: t }]
}

export function nextInt(rng: RngState, maxExclusive: number): [number, RngState] {
  const [f, next] = nextFloat(rng)
  return [Math.floor(f * maxExclusive), next]
}
```

- [ ] **Step 4: Run the PRNG test**

Run: `npm test -- src/engine/rng.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the engine types**

`src/engine/types.ts`:

```ts
import type { RngState } from './rng'

export type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers'
export type QueueKind = 'classic' | 'quorum'
export type NodeId = string

export interface PublisherSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
}

export interface ExchangeSpec {
  id: NodeId
  label: string
  type: ExchangeType
  position: { x: number; y: number }
}

export interface QueueSpec {
  id: NodeId
  label: string
  kind: QueueKind
  /** Milliseconds before an unconsumed message is dead-lettered. */
  messageTtlMs?: number
  /** Queue length ceiling; overflow dead-letters the oldest message. */
  maxLength?: number
  /** Exchange id that receives dead-lettered messages. */
  deadLetterExchange?: NodeId
  /** Routing key override used when dead-lettering. */
  deadLetterRoutingKey?: string
  /** Enables priority ordering with values 0..maxPriority. */
  maxPriority?: number
  position: { x: number; y: number }
}

export interface ConsumerSpec {
  id: NodeId
  label: string
  queueId: NodeId
  /** Unacked message ceiling. 0 means unlimited. */
  prefetch: number
  autoAck: boolean
  /** Virtual milliseconds of work per message. */
  processingMs: number
  /** Random jitter added to processingMs, drawn from the seeded PRNG. */
  jitterMs: number
  /** Probability in [0,1] that the consumer rejects a message. */
  nackRate: number
  /** Whether a rejected message is requeued or dead-lettered. */
  requeueOnNack: boolean
  position: { x: number; y: number }
}

export interface BindingSpec {
  id: string
  exchangeId: NodeId
  /** Destination is a queue id, or an exchange id for exchange-to-exchange bindings. */
  destinationId: NodeId
  destinationKind: 'queue' | 'exchange'
  routingKey?: string
  headers?: Record<string, string>
  /** Headers exchange match mode. */
  xMatch?: 'all' | 'any'
}

export interface Topology {
  publishers: PublisherSpec[]
  exchanges: ExchangeSpec[]
  queues: QueueSpec[]
  consumers: ConsumerSpec[]
  bindings: BindingSpec[]
}

export interface Message {
  id: string
  body: string
  routingKey: string
  headers: Record<string, string>
  priority: number
  /** Virtual time the message was first published. */
  publishedAt: number
  /** Incremented every time the message is redelivered. */
  redeliveryCount: number
  /** Queue ids the message has been dead-lettered from, oldest first. */
  deathTrail: NodeId[]
  correlationId?: string
  replyTo?: NodeId
  persistent: boolean
  /** Per-message expiry, overriding the queue TTL when smaller. */
  expirationMs?: number
}

export type SimEventType =
  | 'publish'
  | 'route'
  | 'enqueue'
  | 'dispatch'
  | 'deliver'
  | 'consumeDone'
  | 'ack'
  | 'nack'
  | 'ttlExpire'
  | 'deadLetter'
  | 'retryBackoff'
  | 'consumerCrash'
  | 'consumerRecover'

export interface SimEvent {
  /** Virtual milliseconds at which this event fires. */
  at: number
  /** Tie-break so equal timestamps stay deterministic. */
  seq: number
  type: SimEventType
  payload: Record<string, unknown>
}

/** A message currently animating along an edge. */
export interface InFlight {
  messageId: string
  edgeId: string
  fromT: number
  toT: number
  /** Colour class chosen by the lesson to distinguish streams. */
  tone: string
}

export interface QueuedMessage {
  message: Message
  enqueuedAt: number
}

export interface Metrics {
  published: number
  routed: number
  dropped: number
  delivered: number
  acked: number
  nacked: number
  deadLettered: number
  expired: number
}

export interface JournalEntry {
  at: number
  type: SimEventType | 'guard' | 'validation'
  /** Human-readable line rendered in the inspector's event log. */
  text: string
  nodeId?: NodeId
  messageId?: string
}

export interface EngineState {
  now: number
  seq: number
  rng: RngState
  topology: Topology
  /** Queue id to its ordered messages. */
  queues: Record<NodeId, QueuedMessage[]>
  /**
   * Consumer id to the messages it currently holds unacked. This stores whole
   * messages, not ids: a dispatched message is removed from its queue, so the
   * unacked table is the ONLY remaining copy. Storing ids alone would leave a
   * consumer crash with nothing to requeue but a blank placeholder, and
   * recovering the message is the entire point of Lesson 7.
   */
  unacked: Record<NodeId, Message[]>
  /**
   * Per-queue round-robin cursor, advanced on every dispatch. It must not be
   * derived from delivery counts: a delivery lands TRAVEL_MS after its dispatch,
   * so a burst of dispatches would all read the same stale count and hand every
   * message to the same consumer.
   */
  roundRobin: Record<NodeId, number>
  inFlight: InFlight[]
  metrics: Metrics
  journal: JournalEntry[]
  /** Set when a runaway guard halts the run. */
  halted?: { reason: string }
  /** Consumer ids that are currently crashed and not consuming. */
  crashed: NodeId[]
  /** Monotonic counter used to mint message ids deterministically. */
  messageCounter: number
}

export interface ApplyResult {
  state: EngineState
  newEvents: SimEvent[]
}
```

- [ ] **Step 6: Write the purity guard test**

`src/engine/purity.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ENGINE_DIR = join(process.cwd(), 'src/engine')
const FORBIDDEN = [
  /from ['"]react['"]/,
  /from ['"]zustand['"]/,
  /from ['"]@xyflow\/react['"]/,
  /\bimport\s*\(/,      // dynamic import sidesteps the `from '...'` patterns above
  /\brequire\s*\(/,
  /\bMath\.random\s*\(/,
  /\bDate\.now\s*\(/,
  /\bnew Date\s*\(/,
  /\bperformance\.now\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\bprocess\./,        // engine is browser-only; no Node globals
  /\bdocument\./,
  /\bwindow\./,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return []
    return [full]
  })
}

describe('engine purity', () => {
  it('imports no UI library and uses no ambient time or randomness', () => {
    const offences: string[] = []
    for (const file of sourceFiles(ENGINE_DIR)) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offences.push(`${file} matched ${pattern}`)
      }
    }
    expect(offences).toEqual([])
  })
})
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add src/engine
git commit -m "feat: add engine types, seeded prng, and purity guard"
```

---

## Task 3: Virtual clock and event scheduler

**Files:**
- Create: `src/engine/clock.ts`, `src/engine/clock.test.ts`

**Interfaces:**
- Consumes: `SimEvent` from `src/engine/types.ts`
- Produces:
  - `createScheduler(): Scheduler`
  - `push(scheduler: Scheduler, event: SimEvent): Scheduler`
  - `peekTime(scheduler: Scheduler): number | undefined`
  - `popDue(scheduler: Scheduler, upToInclusive: number): [SimEvent[], Scheduler]`

- [ ] **Step 1: Write the failing scheduler test**

`src/engine/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createScheduler, peekTime, popDue, push } from './clock'
import type { SimEvent } from './types'

const ev = (at: number, seq: number, type: SimEvent['type'] = 'publish'): SimEvent => ({
  at,
  seq,
  type,
  payload: {},
})

describe('scheduler', () => {
  it('returns undefined time when empty', () => {
    expect(peekTime(createScheduler())).toBeUndefined()
  })

  it('pops events in time order regardless of insertion order', () => {
    let s = createScheduler()
    s = push(s, ev(300, 1))
    s = push(s, ev(100, 2))
    s = push(s, ev(200, 3))
    const [due] = popDue(s, 1000)
    expect(due.map((e) => e.at)).toEqual([100, 200, 300])
  })

  it('breaks ties by seq so equal timestamps stay deterministic', () => {
    let s = createScheduler()
    s = push(s, ev(100, 9))
    s = push(s, ev(100, 2))
    s = push(s, ev(100, 5))
    const [due] = popDue(s, 100)
    expect(due.map((e) => e.seq)).toEqual([2, 5, 9])
  })

  it('leaves future events in the scheduler', () => {
    let s = createScheduler()
    s = push(s, ev(100, 1))
    s = push(s, ev(500, 2))
    const [due, rest] = popDue(s, 100)
    expect(due).toHaveLength(1)
    expect(peekTime(rest)).toBe(500)
  })

  it('does not mutate the scheduler it is given', () => {
    const s = createScheduler()
    const pushed = push(s, ev(10, 1))
    expect(peekTime(s)).toBeUndefined()
    expect(peekTime(pushed)).toBe(10)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/clock.test.ts`
Expected: FAIL, `Failed to resolve import "./clock"`.

- [ ] **Step 3: Implement the scheduler**

`src/engine/clock.ts`:

```ts
import type { SimEvent } from './types'

/**
 * A binary min-heap ordered by (at, seq). Copy-on-write so engine state stays
 * immutable and rewinding by replay is safe.
 */
export interface Scheduler {
  readonly heap: readonly SimEvent[]
}

export function createScheduler(): Scheduler {
  return { heap: [] }
}

function before(a: SimEvent, b: SimEvent): boolean {
  return a.at !== b.at ? a.at < b.at : a.seq < b.seq
}

function siftUp(heap: SimEvent[], start: number): void {
  let i = start
  while (i > 0) {
    const parent = (i - 1) >> 1
    const node = heap[i]!
    const parentNode = heap[parent]!
    if (!before(node, parentNode)) break
    heap[i] = parentNode
    heap[parent] = node
    i = parent
  }
}

function siftDown(heap: SimEvent[], start: number): void {
  let i = start
  const n = heap.length
  for (;;) {
    const left = i * 2 + 1
    const right = left + 1
    let smallest = i
    if (left < n && before(heap[left]!, heap[smallest]!)) smallest = left
    if (right < n && before(heap[right]!, heap[smallest]!)) smallest = right
    if (smallest === i) break
    const tmp = heap[i]!
    heap[i] = heap[smallest]!
    heap[smallest] = tmp
    i = smallest
  }
}

export function push(scheduler: Scheduler, event: SimEvent): Scheduler {
  const heap = scheduler.heap.slice()
  heap.push(event)
  siftUp(heap, heap.length - 1)
  return { heap }
}

export function pushAll(scheduler: Scheduler, events: readonly SimEvent[]): Scheduler {
  return events.reduce(push, scheduler)
}

export function peekTime(scheduler: Scheduler): number | undefined {
  return scheduler.heap[0]?.at
}

function pop(heap: SimEvent[]): SimEvent | undefined {
  if (heap.length === 0) return undefined
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    siftDown(heap, 0)
  }
  return top
}

/** Removes and returns every event at or before `upToInclusive`, in order. */
export function popDue(scheduler: Scheduler, upToInclusive: number): [SimEvent[], Scheduler] {
  const heap = scheduler.heap.slice()
  const due: SimEvent[] = []
  while (heap.length > 0 && heap[0]!.at <= upToInclusive) {
    due.push(pop(heap)!)
  }
  return [due, { heap }]
}
```

- [ ] **Step 4: Run the scheduler test**

Run: `npm test -- src/engine/clock.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/clock.ts src/engine/clock.test.ts
git commit -m "feat: add virtual clock min-heap scheduler"
```

---

## Task 4: Routing matchers

**Files:**
- Create: `src/engine/routing/direct.ts`, `src/engine/routing/fanout.ts`, `src/engine/routing/topic.ts`, `src/engine/routing/headers.ts`, `src/engine/routing/index.ts`, `src/engine/routing/routing.test.ts`

**Interfaces:**
- Consumes: `BindingSpec`, `Message`, `ExchangeType` from `src/engine/types.ts`
- Produces:
  - `matchTopic(pattern: string, routingKey: string): boolean`
  - `matchBinding(type: ExchangeType, binding: BindingSpec, message: Message): boolean`
  - `resolveDestinations(type: ExchangeType, bindings: BindingSpec[], message: Message): BindingSpec[]`

- [ ] **Step 1: Write the failing routing test**

`src/engine/routing/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchBinding, matchTopic, resolveDestinations } from './index'
import type { BindingSpec, Message } from '../types'

const msg = (routingKey: string, headers: Record<string, string> = {}): Message => ({
  id: 'm1',
  body: 'x',
  routingKey,
  headers,
  priority: 0,
  publishedAt: 0,
  redeliveryCount: 0,
  deathTrail: [],
  persistent: false,
})

const bind = (over: Partial<BindingSpec>): BindingSpec => ({
  id: 'b1',
  exchangeId: 'ex',
  destinationId: 'q1',
  destinationKind: 'queue',
  ...over,
})

describe('topic pattern matching', () => {
  it('matches * against exactly one word', () => {
    expect(matchTopic('order.*.created', 'order.eu.created')).toBe(true)
    expect(matchTopic('order.*.created', 'order.created')).toBe(false)
    expect(matchTopic('order.*.created', 'order.eu.west.created')).toBe(false)
  })

  it('matches # against zero or more words', () => {
    expect(matchTopic('order.#', 'order')).toBe(true)
    expect(matchTopic('order.#', 'order.eu.west.created')).toBe(true)
    expect(matchTopic('#', 'anything.at.all')).toBe(true)
  })

  it('matches literal patterns exactly', () => {
    expect(matchTopic('order.created', 'order.created')).toBe(true)
    expect(matchTopic('order.created', 'order.updated')).toBe(false)
  })
})

describe('matchBinding', () => {
  it('direct requires an exact routing key', () => {
    expect(matchBinding('direct', bind({ routingKey: 'pay' }), msg('pay'))).toBe(true)
    expect(matchBinding('direct', bind({ routingKey: 'pay' }), msg('ship'))).toBe(false)
  })

  it('fanout ignores the routing key', () => {
    expect(matchBinding('fanout', bind({ routingKey: 'ignored' }), msg('anything'))).toBe(true)
  })

  it('headers with x-match all requires every header to match', () => {
    const b = bind({ headers: { format: 'pdf', kind: 'report' }, xMatch: 'all' })
    expect(matchBinding('headers', b, msg('', { format: 'pdf', kind: 'report' }))).toBe(true)
    expect(matchBinding('headers', b, msg('', { format: 'pdf' }))).toBe(false)
  })

  it('headers with x-match any requires one header to match', () => {
    const b = bind({ headers: { format: 'pdf', kind: 'report' }, xMatch: 'any' })
    expect(matchBinding('headers', b, msg('', { format: 'pdf' }))).toBe(true)
    expect(matchBinding('headers', b, msg('', { format: 'csv' }))).toBe(false)
  })
})

describe('resolveDestinations', () => {
  it('returns every matching binding so fanout hits all queues', () => {
    const bindings = [
      bind({ id: 'b1', destinationId: 'q1' }),
      bind({ id: 'b2', destinationId: 'q2' }),
    ]
    expect(resolveDestinations('fanout', bindings, msg('x')).map((b) => b.destinationId)).toEqual([
      'q1',
      'q2',
    ])
  })

  it('deduplicates a queue bound twice to the same exchange', () => {
    const bindings = [
      bind({ id: 'b1', destinationId: 'q1', routingKey: 'a' }),
      bind({ id: 'b2', destinationId: 'q1', routingKey: 'b' }),
    ]
    const hits = resolveDestinations('topic', bindings, msg('a'))
    expect(hits).toHaveLength(1)
  })

  it('returns an empty array when nothing matches', () => {
    expect(resolveDestinations('direct', [bind({ routingKey: 'a' })], msg('z'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/routing`
Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 3: Implement the matchers**

`src/engine/routing/direct.ts`:

```ts
import type { BindingSpec, Message } from '../types'

export function matchDirect(binding: BindingSpec, message: Message): boolean {
  return (binding.routingKey ?? '') === message.routingKey
}
```

`src/engine/routing/fanout.ts`:

```ts
export function matchFanout(): boolean {
  return true
}
```

`src/engine/routing/topic.ts`:

```ts
/**
 * RabbitMQ topic semantics: words are dot-separated, `*` matches exactly one
 * word, `#` matches zero or more words.
 */
export function matchTopic(pattern: string, routingKey: string): boolean {
  const p = pattern.split('.')
  const k = routingKey === '' ? [] : routingKey.split('.')

  // table[i][j] is true when the first i pattern words match the first j key words
  const table: boolean[][] = Array.from({ length: p.length + 1 }, () =>
    new Array<boolean>(k.length + 1).fill(false),
  )
  table[0]![0] = true

  for (let i = 1; i <= p.length; i++) {
    if (p[i - 1] === '#') table[i]![0] = table[i - 1]![0]!
  }

  for (let i = 1; i <= p.length; i++) {
    for (let j = 1; j <= k.length; j++) {
      const word = p[i - 1]!
      if (word === '#') {
        table[i]![j] = table[i - 1]![j]! || table[i]![j - 1]!
      } else if (word === '*' || word === k[j - 1]) {
        table[i]![j] = table[i - 1]![j - 1]!
      }
    }
  }

  return table[p.length]![k.length]!
}
```

`src/engine/routing/headers.ts`:

```ts
import type { BindingSpec, Message } from '../types'

export function matchHeaders(binding: BindingSpec, message: Message): boolean {
  const wanted = Object.entries(binding.headers ?? {})
  const mode = binding.xMatch ?? 'all'
  // RabbitMQ folds the criteria list with an accumulator seeded true for `all`
  // and false for `any`. With no criteria the seed survives: `all` matches
  // everything (vacuous AND), `any` matches nothing (vacuous OR).
  if (wanted.length === 0) return mode === 'all'
  const hit = (k: string, v: string) => message.headers[k] === v
  return mode === 'all' ? wanted.every(([k, v]) => hit(k, v)) : wanted.some(([k, v]) => hit(k, v))
}
```

`src/engine/routing/index.ts`:

```ts
import type { BindingSpec, ExchangeType, Message } from '../types'
import { matchDirect } from './direct'
import { matchFanout } from './fanout'
import { matchHeaders } from './headers'
import { matchTopic } from './topic'

export { matchTopic }

export function matchBinding(
  type: ExchangeType,
  binding: BindingSpec,
  message: Message,
): boolean {
  switch (type) {
    case 'direct':
      return matchDirect(binding, message)
    case 'fanout':
      return matchFanout()
    case 'topic':
      return matchTopic(binding.routingKey ?? '', message.routingKey)
    case 'headers':
      return matchHeaders(binding, message)
  }
}

/** Every matching binding, deduplicated by destination, in binding order. */
export function resolveDestinations(
  type: ExchangeType,
  bindings: readonly BindingSpec[],
  message: Message,
): BindingSpec[] {
  const seen = new Set<string>()
  const hits: BindingSpec[] = []
  for (const binding of bindings) {
    if (!matchBinding(type, binding, message)) continue
    const key = `${binding.destinationKind}:${binding.destinationId}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(binding)
  }
  return hits
}
```

- [ ] **Step 4: Run the routing test**

Run: `npm test -- src/engine/routing`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/routing
git commit -m "feat: add direct, fanout, topic, and headers routing matchers"
```

---

## Task 5: Broker publish and route

**Files:**
- Create: `src/engine/broker.ts`, `src/engine/broker.test.ts`

**Interfaces:**
- Consumes: `resolveDestinations` from `src/engine/routing/index.ts`; all types from `src/engine/types.ts`
- Produces:
  - `createEngineState(topology: Topology, seed: number): EngineState`
  - `applyPublish(state: EngineState, event: SimEvent): ApplyResult`
  - `applyRoute(state: EngineState, event: SimEvent): ApplyResult`
  - `applyEnqueue(state: EngineState, event: SimEvent): ApplyResult`
  - Constants `TRAVEL_MS = 600` (virtual milliseconds a message spends animating along one edge)

- [ ] **Step 1: Write the failing broker test**

`src/engine/broker.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import type { SimEvent, Topology } from './types'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'orders', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [
    { id: 'q1', label: 'pay', kind: 'classic', position: { x: 400, y: 0 } },
    { id: 'q2', label: 'ship', kind: 'classic', position: { x: 400, y: 100 } },
  ],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'pay' },
    { id: 'b2', exchangeId: 'ex', destinationId: 'q2', destinationKind: 'queue', routingKey: 'ship' },
  ],
}

const publishEvent = (routingKey: string): SimEvent => ({
  at: 0,
  seq: 0,
  type: 'publish',
  payload: { publisherId: 'p1', exchangeId: 'ex', routingKey, body: 'order-1', headers: {} },
})

describe('applyPublish', () => {
  it('mints a message, counts it, and schedules a route event', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = applyPublish(state, publishEvent('pay'))
    expect(next.metrics.published).toBe(1)
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]!.type).toBe('route')
  })

  it('adds an in-flight particle on the publisher-to-exchange edge', () => {
    const state = createEngineState(topology, 1)
    const { state: next } = applyPublish(state, publishEvent('pay'))
    expect(next.inFlight).toHaveLength(1)
    expect(next.inFlight[0]!.edgeId).toBe('p1->ex')
  })

  it('does not mutate the state it is given', () => {
    const state = createEngineState(topology, 1)
    applyPublish(state, publishEvent('pay'))
    expect(state.metrics.published).toBe(0)
    expect(state.inFlight).toHaveLength(0)
  })
})

describe('applyRoute', () => {
  it('schedules one enqueue per matching binding', () => {
    const state = createEngineState(topology, 1)
    const published = applyPublish(state, publishEvent('pay'))
    const routeEvent = published.newEvents[0]!
    const { newEvents } = applyRoute(published.state, routeEvent)
    expect(newEvents.map((e) => e.type)).toEqual(['enqueue'])
    expect(newEvents[0]!.payload.queueId).toBe('q1')
  })

  it('drops an unroutable message and records it', () => {
    const state = createEngineState(topology, 1)
    const published = applyPublish(state, publishEvent('nowhere'))
    const { state: next, newEvents } = applyRoute(published.state, published.newEvents[0]!)
    expect(newEvents).toEqual([])
    expect(next.metrics.dropped).toBe(1)
    expect(next.journal.some((j) => j.text.includes('unroutable'))).toBe(true)
  })
})

describe('applyEnqueue', () => {
  it('appends the message to the queue and clears its in-flight particle', () => {
    const state = createEngineState(topology, 1)
    const published = applyPublish(state, publishEvent('pay'))
    const routed = applyRoute(published.state, published.newEvents[0]!)
    const { state: next } = applyEnqueue(routed.state, routed.newEvents[0]!)
    expect(next.queues.q1).toHaveLength(1)
    expect(next.inFlight).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/broker.test.ts`
Expected: FAIL, `Failed to resolve import "./broker"`.

- [ ] **Step 3: Implement the broker**

`src/engine/broker.ts`:

```ts
import { createRng } from './rng'
import { resolveDestinations } from './routing'
import type {
  ApplyResult,
  EngineState,
  JournalEntry,
  Message,
  NodeId,
  QueuedMessage,
  SimEvent,
  Topology,
} from './types'

/** Virtual milliseconds a message spends animating along one edge. */
export const TRAVEL_MS = 600

export function edgeId(from: NodeId, to: NodeId): string {
  return `${from}->${to}`
}

export function createEngineState(topology: Topology, seed: number): EngineState {
  const queues: Record<NodeId, QueuedMessage[]> = {}
  for (const q of topology.queues) queues[q.id] = []
  const unacked: Record<NodeId, Message[]> = {}
  for (const c of topology.consumers) unacked[c.id] = []
  const roundRobin: Record<NodeId, number> = {}
  for (const q of topology.queues) roundRobin[q.id] = 0

  return {
    now: 0,
    seq: 0,
    rng: createRng(seed),
    topology,
    queues,
    unacked,
    roundRobin,
    inFlight: [],
    metrics: {
      published: 0,
      routed: 0,
      dropped: 0,
      delivered: 0,
      acked: 0,
      nacked: 0,
      deadLettered: 0,
      expired: 0,
    },
    journal: [],
    crashed: [],
    messageCounter: 0,
  }
}

export function log(state: EngineState, entry: JournalEntry): EngineState {
  return { ...state, journal: [...state.journal, entry] }
}

/** Allocates the next event sequence number, keeping equal timestamps ordered. */
export function nextSeq(state: EngineState): [number, EngineState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

export function scheduleEvent(
  state: EngineState,
  at: number,
  type: SimEvent['type'],
  payload: Record<string, unknown>,
): [SimEvent, EngineState] {
  const [seq, next] = nextSeq(state)
  return [{ at, seq, type, payload }, next]
}

export function addInFlight(
  state: EngineState,
  messageId: string,
  from: NodeId,
  to: NodeId,
  tone: string,
): EngineState {
  return {
    ...state,
    inFlight: [
      ...state.inFlight,
      { messageId, edgeId: edgeId(from, to), fromT: state.now, toT: state.now + TRAVEL_MS, tone },
    ],
  }
}

export function clearInFlight(state: EngineState, messageId: string, edge: string): EngineState {
  return {
    ...state,
    inFlight: state.inFlight.filter((f) => !(f.messageId === messageId && f.edgeId === edge)),
  }
}

export function applyPublish(state: EngineState, event: SimEvent): ApplyResult {
  const publisherId = event.payload.publisherId as NodeId
  const exchangeId = event.payload.exchangeId as NodeId
  const counter = state.messageCounter + 1
  const message: Message = {
    id: `m${counter}`,
    body: (event.payload.body as string) ?? '',
    routingKey: (event.payload.routingKey as string) ?? '',
    headers: (event.payload.headers as Record<string, string>) ?? {},
    priority: (event.payload.priority as number) ?? 0,
    publishedAt: state.now,
    redeliveryCount: 0,
    deathTrail: [],
    persistent: (event.payload.persistent as boolean) ?? false,
    correlationId: event.payload.correlationId as string | undefined,
    replyTo: event.payload.replyTo as NodeId | undefined,
    expirationMs: event.payload.expirationMs as number | undefined,
  }
  const tone = (event.payload.tone as string) ?? 'sky'

  let next: EngineState = {
    ...state,
    messageCounter: counter,
    metrics: { ...state.metrics, published: state.metrics.published + 1 },
  }
  next = addInFlight(next, message.id, publisherId, exchangeId, tone)
  next = log(next, {
    at: state.now,
    type: 'publish',
    text: `${publisherId} published ${message.id} key="${message.routingKey}"`,
    nodeId: publisherId,
    messageId: message.id,
  })

  const [routeEvent, afterSchedule] = scheduleEvent(next, state.now + TRAVEL_MS, 'route', {
    message,
    exchangeId,
    fromId: publisherId,
    tone,
  })
  return { state: afterSchedule, newEvents: [routeEvent] }
}

export function applyRoute(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const exchangeId = event.payload.exchangeId as NodeId
  const fromId = event.payload.fromId as NodeId
  const tone = (event.payload.tone as string) ?? 'sky'

  let next = clearInFlight(state, message.id, edgeId(fromId, exchangeId))

  const exchange = state.topology.exchanges.find((e) => e.id === exchangeId)
  if (!exchange) {
    next = log(next, {
      at: state.now,
      type: 'route',
      text: `exchange ${exchangeId} does not exist; ${message.id} discarded`,
      messageId: message.id,
    })
    return { state: { ...next, metrics: { ...next.metrics, dropped: next.metrics.dropped + 1 } }, newEvents: [] }
  }

  const bindings = state.topology.bindings.filter((b) => b.exchangeId === exchangeId)
  const hits = resolveDestinations(exchange.type, bindings, message)

  if (hits.length === 0) {
    next = log(next, {
      at: state.now,
      type: 'route',
      text: `${message.id} unroutable at ${exchange.label}; dropped`,
      nodeId: exchangeId,
      messageId: message.id,
    })
    return { state: { ...next, metrics: { ...next.metrics, dropped: next.metrics.dropped + 1 } }, newEvents: [] }
  }

  const events: SimEvent[] = []
  for (const binding of hits) {
    next = addInFlight(next, message.id, exchangeId, binding.destinationId, tone)
    if (binding.destinationKind === 'exchange') {
      const [routeEvent, after] = scheduleEvent(next, state.now + TRAVEL_MS, 'route', {
        message,
        exchangeId: binding.destinationId,
        fromId: exchangeId,
        tone,
      })
      next = after
      events.push(routeEvent)
    } else {
      const [enqueueEvent, after] = scheduleEvent(next, state.now + TRAVEL_MS, 'enqueue', {
        message,
        queueId: binding.destinationId,
        fromId: exchangeId,
        tone,
      })
      next = after
      events.push(enqueueEvent)
    }
  }

  next = log(next, {
    at: state.now,
    type: 'route',
    text: `${exchange.label} routed ${message.id} to ${hits.map((h) => h.destinationId).join(', ')}`,
    nodeId: exchangeId,
    messageId: message.id,
  })
  next = { ...next, metrics: { ...next.metrics, routed: next.metrics.routed + 1 } }
  return { state: next, newEvents: events }
}

export function applyEnqueue(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const queueId = event.payload.queueId as NodeId
  const fromId = event.payload.fromId as NodeId

  let next = clearInFlight(state, message.id, edgeId(fromId, queueId))
  const existing = next.queues[queueId] ?? []
  const entry: QueuedMessage = { message, enqueuedAt: state.now }

  next = { ...next, queues: { ...next.queues, [queueId]: [...existing, entry] } }
  next = log(next, {
    at: state.now,
    type: 'enqueue',
    text: `${message.id} enqueued in ${queueId} (depth ${existing.length + 1})`,
    nodeId: queueId,
    messageId: message.id,
  })
  return { state: next, newEvents: [] }
}
```

- [ ] **Step 4: Run the broker test**

Run: `npm test -- src/engine/broker.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/broker.ts src/engine/broker.test.ts
git commit -m "feat: add broker publish, route, and enqueue reducers"
```

---

## Task 6: Consumer dispatch, prefetch, ack, and nack

**Files:**
- Create: `src/engine/delivery.ts`, `src/engine/delivery.test.ts`
- Modify: `src/engine/broker.ts` — `applyEnqueue` must emit a `dispatch` event after enqueuing

**Interfaces:**
- Consumes: `addInFlight`, `clearInFlight`, `edgeId`, `log`, `scheduleEvent`, `TRAVEL_MS` from `src/engine/broker.ts`; `nextFloat` from `src/engine/rng.ts`
- Produces:
  - `applyDispatch(state: EngineState, event: SimEvent): ApplyResult`
  - `applyDeliver(state: EngineState, event: SimEvent): ApplyResult`
  - `applyConsumeDone(state: EngineState, event: SimEvent): ApplyResult`
  - `applyAck(state: EngineState, event: SimEvent): ApplyResult`
  - `applyNack(state: EngineState, event: SimEvent): ApplyResult`
  - `eligibleConsumers(state: EngineState, queueId: NodeId): ConsumerSpec[]`

**Semantics to implement:**
- `dispatch` is a scheduling decision, not movement: it picks a consumer whose unacked count is below its prefetch (prefetch `0` means unlimited), removes the head message from the queue, marks it `unackedBy`, and schedules a `deliver`.
- Round-robin fairness comes from rotating the eligible consumer list by `state.metrics.delivered`, which is deterministic.
- `deliver` clears the queue-to-consumer particle and schedules `consumeDone` at `now + processingMs + jitter`, where jitter is `floor(nextFloat * jitterMs)`.
- `consumeDone` draws `nextFloat` once against `nackRate` to decide `ack` or `nack`, then schedules that event immediately (`at: now`).
- `ack` removes the message from `unacked` and re-emits `dispatch` for the queue so the next message flows.
- `nack` with `requeueOnNack` puts the message back at the head of the queue with `redeliveryCount + 1`; without it, the message is handed to `dlx.ts` in Task 7 (until then, it is dropped and counted).
- With `autoAck: true`, `deliver` skips the unacked bookkeeping entirely and schedules `consumeDone` that always acks — this is what makes Lesson 7's message-loss demo work when a consumer crashes.

- [ ] **Step 1: Write the failing delivery test**

`src/engine/delivery.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { applyAck, applyDeliver, applyDispatch, applyNack, eligibleConsumers } from './delivery'
import type { ApplyResult, ConsumerSpec, EngineState, SimEvent, Topology } from './types'

const consumer = (over: Partial<ConsumerSpec> & { id: string }): ConsumerSpec => ({
  label: over.id,
  queueId: 'q1',
  prefetch: 1,
  autoAck: false,
  processingMs: 1000,
  jitterMs: 0,
  nackRate: 0,
  requeueOnNack: true,
  position: { x: 600, y: 0 },
  ...over,
})

const topo = (consumers: ConsumerSpec[]): Topology => ({
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'orders', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers,
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
})

/** Publishes n messages straight into q1, bypassing travel time. */
function seedQueue(state: EngineState, n: number): EngineState {
  let s = state
  for (let i = 0; i < n; i++) {
    const pub: SimEvent = {
      at: 0,
      seq: 0,
      type: 'publish',
      payload: { publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: `job-${i}`, headers: {} },
    }
    const published: ApplyResult = applyPublish(s, pub)
    const routed = applyRoute(published.state, published.newEvents[0]!)
    s = applyEnqueue(routed.state, routed.newEvents[0]!).state
  }
  return s
}

describe('eligibleConsumers', () => {
  it('excludes consumers at their prefetch ceiling', () => {
    const state = createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1)
    const busy: EngineState = { ...state, unacked: { c1: ['m1'] } }
    expect(eligibleConsumers(busy, 'q1')).toEqual([])
  })

  it('treats prefetch 0 as unlimited', () => {
    const state = createEngineState(topo([consumer({ id: 'c1', prefetch: 0 })]), 1)
    const busy: EngineState = { ...state, unacked: { c1: ['m1', 'm2', 'm3'] } }
    expect(eligibleConsumers(busy, 'q1').map((c) => c.id)).toEqual(['c1'])
  })

  it('excludes crashed consumers', () => {
    const state = createEngineState(topo([consumer({ id: 'c1' })]), 1)
    expect(eligibleConsumers({ ...state, crashed: ['c1'] }, 'q1')).toEqual([])
  })
})

describe('applyDispatch', () => {
  it('removes the head message and schedules a deliver', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1' })]), 1), 1)
    const { state: next, newEvents } = applyDispatch(state, {
      at: state.now,
      seq: 0,
      type: 'dispatch',
      payload: { queueId: 'q1' },
    })
    expect(next.queues.q1).toHaveLength(0)
    expect(next.unacked.c1).toEqual(['m1'])
    expect(newEvents.map((e) => e.type)).toEqual(['deliver'])
  })

  it('does nothing when every consumer is at its prefetch ceiling', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1), 2)
    const busy: EngineState = { ...state, unacked: { c1: ['m0'] } }
    const { state: next, newEvents } = applyDispatch(busy, {
      at: 0,
      seq: 0,
      type: 'dispatch',
      payload: { queueId: 'q1' },
    })
    expect(next.queues.q1).toHaveLength(2)
    expect(newEvents).toEqual([])
  })

  it('rotates across idle consumers on back-to-back dispatches, before any delivery lands', () => {
    // prefetch 0 means nobody ever becomes ineligible, so only the cursor can
    // spread the load. No deliver event is applied between dispatches here —
    // that is the real event order, and the bug this guards against.
    const state = seedQueue(
      createEngineState(
        topo([
          consumer({ id: 'c1', prefetch: 0 }),
          consumer({ id: 'c2', prefetch: 0 }),
          consumer({ id: 'c3', prefetch: 0 }),
        ]),
        1,
      ),
      6,
    )
    const dispatch: SimEvent = { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } }
    let current = state
    for (let i = 0; i < 6; i++) {
      current = applyDispatch(current, dispatch).state
    }
    expect(current.unacked.c1).toHaveLength(2)
    expect(current.unacked.c2).toHaveLength(2)
    expect(current.unacked.c3).toHaveLength(2)
  })

  it('never advances the cursor when no consumer is eligible', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1), 2)
    const busy: EngineState = { ...state, unacked: { c1: ['m0'] } }
    const { state: next } = applyDispatch(busy, {
      at: 0,
      seq: 0,
      type: 'dispatch',
      payload: { queueId: 'q1' },
    })
    expect(next.roundRobin.q1).toBe(busy.roundRobin.q1)
  })
})

describe('applyDeliver and completion', () => {
  it('schedules consumeDone at now + processingMs', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', processingMs: 800 })]), 1), 1)
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const deliverEvent = dispatched.newEvents[0]!
    const delivered = applyDeliver({ ...dispatched.state, now: deliverEvent.at }, deliverEvent)
    expect(delivered.newEvents[0]!.type).toBe('consumeDone')
    expect(delivered.newEvents[0]!.at).toBe(deliverEvent.at + 800)
    expect(delivered.state.metrics.delivered).toBe(1)
  })
})

describe('applyAck', () => {
  it('clears the unacked slot and re-dispatches the queue', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1' })]), 1), 2)
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const { state: next, newEvents } = applyAck(dispatched.state, {
      at: 0,
      seq: 0,
      type: 'ack',
      payload: { consumerId: 'c1', messageId: 'm1', queueId: 'q1' },
    })
    expect(next.unacked.c1).toEqual([])
    expect(next.metrics.acked).toBe(1)
    expect(newEvents.map((e) => e.type)).toEqual(['dispatch'])
  })
})

describe('applyNack', () => {
  it('requeues at the head with an incremented redelivery count', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1' })]), 1), 2)
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const inFlightMessage = (dispatched.newEvents[0]!.payload as { message: { id: string } }).message
    expect(inFlightMessage.id).toBe('m1')
    const { state: next } = applyNack(dispatched.state, {
      at: 0,
      seq: 0,
      type: 'nack',
      payload: { message: inFlightMessage, consumerId: 'c1', messageId: 'm1', queueId: 'q1', requeue: true },
    })
    expect(next.queues.q1[0]!.message.id).toBe('m1')
    expect(next.queues.q1[0]!.message.redeliveryCount).toBe(1)
    expect(next.metrics.nacked).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/delivery.test.ts`
Expected: FAIL, `Failed to resolve import "./delivery"`.

- [ ] **Step 3: Implement delivery**

`src/engine/delivery.ts`:

```ts
import { addInFlight, clearInFlight, edgeId, log, scheduleEvent, TRAVEL_MS } from './broker'
import { nextFloat } from './rng'
import type { ApplyResult, ConsumerSpec, EngineState, Message, NodeId, SimEvent } from './types'

/** Consumers bound to the queue that are neither crashed nor at their prefetch ceiling. */
export function eligibleConsumers(state: EngineState, queueId: NodeId): ConsumerSpec[] {
  return state.topology.consumers.filter((c) => {
    if (c.queueId !== queueId) return false
    if (state.crashed.includes(c.id)) return false
    const held = state.unacked[c.id]?.length ?? 0
    return c.prefetch === 0 || held < c.prefetch
  })
}

function takeHead(state: EngineState, queueId: NodeId): [Message | undefined, EngineState] {
  const queue = state.queues[queueId] ?? []
  const head = queue[0]
  if (!head) return [undefined, state]
  return [head.message, { ...state, queues: { ...state.queues, [queueId]: queue.slice(1) } }]
}

export function applyDispatch(state: EngineState, event: SimEvent): ApplyResult {
  const queueId = event.payload.queueId as NodeId
  const candidates = eligibleConsumers(state, queueId)
  if (candidates.length === 0) return { state, newEvents: [] }

  const [message, afterTake] = takeHead(state, queueId)
  if (!message) return { state, newEvents: [] }

  // The cursor advances per dispatch, not per delivery. Deliveries land
  // TRAVEL_MS later, so a burst of dispatches would otherwise all read the same
  // stale count and hand every message to the same consumer.
  const cursor = state.roundRobin[queueId] ?? 0
  const consumer = candidates[cursor % candidates.length]!

  let next: EngineState = {
    ...afterTake,
    roundRobin: { ...afterTake.roundRobin, [queueId]: cursor + 1 },
  }
  if (!consumer.autoAck) {
    next = {
      ...next,
      unacked: { ...next.unacked, [consumer.id]: [...(next.unacked[consumer.id] ?? []), message] },
    }
  }
  next = addInFlight(next, message.id, queueId, consumer.id, 'emerald')

  const [deliverEvent, afterSchedule] = scheduleEvent(next, state.now + TRAVEL_MS, 'deliver', {
    message,
    queueId,
    consumerId: consumer.id,
  })
  return { state: afterSchedule, newEvents: [deliverEvent] }
}

export function applyDeliver(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const queueId = event.payload.queueId as NodeId
  const consumerId = event.payload.consumerId as NodeId
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)
  if (!consumer) return { state, newEvents: [] }

  let next = clearInFlight(state, message.id, edgeId(queueId, consumerId))
  next = { ...next, metrics: { ...next.metrics, delivered: next.metrics.delivered + 1 } }
  next = log(next, {
    at: state.now,
    type: 'deliver',
    text: `${consumer.label} received ${message.id}${message.redeliveryCount > 0 ? ' (redelivered)' : ''}`,
    nodeId: consumerId,
    messageId: message.id,
  })

  let jitter = 0
  if (consumer.jitterMs > 0) {
    const [f, rng] = nextFloat(next.rng)
    jitter = Math.floor(f * consumer.jitterMs)
    next = { ...next, rng }
  }

  const [doneEvent, afterSchedule] = scheduleEvent(
    next,
    state.now + consumer.processingMs + jitter,
    'consumeDone',
    { message, queueId, consumerId },
  )
  return { state: afterSchedule, newEvents: [doneEvent] }
}

export function applyConsumeDone(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const queueId = event.payload.queueId as NodeId
  const consumerId = event.payload.consumerId as NodeId
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)
  if (!consumer) return { state, newEvents: [] }

  let next = state
  let reject = false
  // An auto-acked message is already gone from the broker; it cannot be
  // rejected or requeued, so no draw is made and no RNG state is consumed.
  if (!consumer.autoAck && consumer.nackRate > 0) {
    const [f, rng] = nextFloat(next.rng)
    reject = f < consumer.nackRate
    next = { ...next, rng }
  }

  const [outcome, afterSchedule] = scheduleEvent(next, state.now, reject ? 'nack' : 'ack', {
    message,
    queueId,
    consumerId,
    requeue: consumer.requeueOnNack,
  })
  return { state: afterSchedule, newEvents: [outcome] }
}

function releaseUnacked(state: EngineState, consumerId: NodeId, messageId: string): EngineState {
  const held = state.unacked[consumerId] ?? []
  return { ...state, unacked: { ...state.unacked, [consumerId]: held.filter((m) => m.id !== messageId) } }
}

export function applyAck(state: EngineState, event: SimEvent): ApplyResult {
  const messageId = (event.payload.messageId as string) ?? (event.payload.message as Message).id
  const consumerId = event.payload.consumerId as NodeId
  const queueId = event.payload.queueId as NodeId

  let next = releaseUnacked(state, consumerId, messageId)
  next = { ...next, metrics: { ...next.metrics, acked: next.metrics.acked + 1 } }
  next = log(next, {
    at: state.now,
    type: 'ack',
    text: `${consumerId} acked ${messageId}`,
    nodeId: consumerId,
    messageId,
  })

  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  return { state: afterSchedule, newEvents: [dispatchEvent] }
}

export function applyNack(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message | undefined
  const messageId = (event.payload.messageId as string) ?? message?.id ?? ''
  const consumerId = event.payload.consumerId as NodeId
  const queueId = event.payload.queueId as NodeId
  const requeue = (event.payload.requeue as boolean) ?? true

  let next = releaseUnacked(state, consumerId, messageId)
  next = { ...next, metrics: { ...next.metrics, nacked: next.metrics.nacked + 1 } }

  // applyConsumeDone always carries the message; a nack without one cannot be requeued.
  if (requeue && message) {
    const redelivered: Message = { ...message, redeliveryCount: message.redeliveryCount + 1 }
    // Task 8 note: on a priority queue this must go back to the head of its own
    // priority band, not the head of the whole queue — see requeueByPriority.
    const spec = state.topology.queues.find((q) => q.id === queueId)
    next = {
      ...next,
      queues: {
        ...next.queues,
        [queueId]: requeueByPriority(
          next.queues[queueId] ?? [],
          { message: redelivered, enqueuedAt: state.now },
          spec?.maxPriority,
        ),
      },
    }
    next = log(next, {
      at: state.now,
      type: 'nack',
      text: `${consumerId} rejected ${messageId}; requeued (attempt ${redelivered.redeliveryCount + 1})`,
      nodeId: consumerId,
      messageId,
    })
  } else {
    next = log(next, {
      at: state.now,
      type: 'nack',
      text: `${consumerId} rejected ${messageId} without requeue`,
      nodeId: consumerId,
      messageId,
    })
  }

  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  return { state: afterSchedule, newEvents: [dispatchEvent] }
}
```

- [ ] **Step 4: Make enqueue trigger dispatch**

In `src/engine/broker.ts`, change the end of `applyEnqueue` from `return { state: next, newEvents: [] }` to:

```ts
  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  return { state: afterSchedule, newEvents: [dispatchEvent] }
```

Then update the `applyEnqueue` assertion in `src/engine/broker.test.ts` to expect the dispatch event:

```ts
    const enqueued = applyEnqueue(routed.state, routed.newEvents[0]!)
    expect(enqueued.state.queues.q1).toHaveLength(1)
    expect(enqueued.state.inFlight).toHaveLength(0)
    expect(enqueued.newEvents.map((e) => e.type)).toEqual(['dispatch'])
```

- [ ] **Step 5: Run the delivery and broker tests**

Run: `npm test -- src/engine`
Expected: PASS, all engine tests including 9 new delivery tests.

- [ ] **Step 6: Commit**

```bash
git add src/engine
git commit -m "feat: add consumer dispatch, prefetch, ack, and nack"
```

---

## Task 7: TTL, max-length, and dead-lettering

**Files:**
- Create: `src/engine/dlx.ts`, `src/engine/dlx.test.ts`
- Modify: `src/engine/broker.ts` — `applyEnqueue` enforces `maxLength` and schedules `ttlExpire`
- Modify: `src/engine/delivery.ts` — `applyNack` with `requeue: false` routes to the dead-letter exchange

**Interfaces:**
- Consumes: `applyRoute`, `addInFlight`, `log`, `scheduleEvent` from `src/engine/broker.ts`
- Produces:
  - `deadLetter(state: EngineState, message: Message, fromQueueId: NodeId, reason: 'rejected' | 'expired' | 'maxlen'): ApplyResult`
  - `applyTtlExpire(state: EngineState, event: SimEvent): ApplyResult`
  - `applyDeadLetter(state: EngineState, event: SimEvent): ApplyResult`
  - `effectiveTtl(queue: QueueSpec, message: Message): number | undefined`

**Semantics to implement:**
- `effectiveTtl` returns the smaller of the queue's `messageTtlMs` and the message's `expirationMs`; `undefined` when neither is set.
- On enqueue, if a TTL applies, schedule `ttlExpire` at `now + ttl` carrying the message id and queue id. When it fires, the message is dead-lettered only if it is still sitting in that queue — a message already consumed must not expire.
- On enqueue, if the queue's `maxLength` would be exceeded, the **oldest** message is removed and dead-lettered with reason `maxlen`, matching RabbitMQ's default `drop-head` overflow behaviour.
- Dead-lettering appends the source queue id to `message.deathTrail`, resets `redeliveryCount` to `0`, and re-publishes into `deadLetterExchange` using `deadLetterRoutingKey ?? message.routingKey`.
- A queue with no `deadLetterExchange` drops the message and increments `metrics.dropped` instead.

- [ ] **Step 1: Write the failing DLX test**

`src/engine/dlx.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { applyTtlExpire, deadLetter, effectiveTtl } from './dlx'
import type { EngineState, Message, QueueSpec, SimEvent, Topology } from './types'

const queue = (over: Partial<QueueSpec> & { id: string }): QueueSpec => ({
  label: over.id,
  kind: 'classic',
  position: { x: 400, y: 0 },
  ...over,
})

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [
    { id: 'ex', label: 'main', type: 'direct', position: { x: 200, y: 0 } },
    { id: 'dlx', label: 'dlx', type: 'fanout', position: { x: 200, y: 200 } },
  ],
  queues: [
    queue({ id: 'q1', messageTtlMs: 2000, maxLength: 2, deadLetterExchange: 'dlx' }),
    queue({ id: 'dead', position: { x: 400, y: 200 } }),
    queue({ id: 'nodlx' }),
  ],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
    { id: 'b2', exchangeId: 'dlx', destinationId: 'dead', destinationKind: 'queue' },
  ],
}

const message = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  body: 'x',
  routingKey: 'go',
  headers: {},
  priority: 0,
  publishedAt: 0,
  redeliveryCount: 0,
  deathTrail: [],
  persistent: false,
  ...over,
})

function publishInto(state: EngineState, body: string): EngineState {
  const pub: SimEvent = {
    at: state.now,
    seq: 0,
    type: 'publish',
    payload: { publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body, headers: {} },
  }
  const published = applyPublish(state, pub)
  const routed = applyRoute(published.state, published.newEvents[0]!)
  return applyEnqueue(routed.state, routed.newEvents[0]!).state
}

describe('effectiveTtl', () => {
  it('uses the queue ttl when the message has none', () => {
    expect(effectiveTtl(queue({ id: 'q', messageTtlMs: 5000 }), message('m1'))).toBe(5000)
  })

  it('uses the smaller of queue and message expiry', () => {
    expect(effectiveTtl(queue({ id: 'q', messageTtlMs: 5000 }), message('m1', { expirationMs: 1000 }))).toBe(1000)
  })

  it('returns undefined when neither is set', () => {
    expect(effectiveTtl(queue({ id: 'q' }), message('m1'))).toBeUndefined()
  })
})

describe('deadLetter', () => {
  it('records the source queue in the death trail and republishes to the dlx', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = deadLetter(state, message('m1'), 'q1', 'expired')
    expect(next.metrics.deadLettered).toBe(1)
    expect(newEvents.map((e) => e.type)).toEqual(['route'])
    const carried = newEvents[0]!.payload.message as Message
    expect(carried.deathTrail).toEqual(['q1'])
    expect(carried.redeliveryCount).toBe(0)
  })

  it('drops the message when the queue has no dead-letter exchange', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = deadLetter(state, message('m1'), 'nodlx', 'rejected')
    expect(newEvents).toEqual([])
    expect(next.metrics.dropped).toBe(1)
  })
})

describe('max-length overflow', () => {
  it('dead-letters the oldest message when the queue is full', () => {
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    state = publishInto(state, 'b')
    state = publishInto(state, 'c')
    expect(state.queues.q1).toHaveLength(2)
    expect(state.queues.q1!.map((q) => q.message.body)).toEqual(['b', 'c'])
    expect(state.metrics.deadLettered).toBe(1)
  })
})

describe('applyTtlExpire', () => {
  it('dead-letters a message still sitting in the queue', () => {
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    const entry = state.queues.q1![0]!
    const { state: next } = applyTtlExpire({ ...state, now: 2000 }, {
      at: 2000,
      seq: 0,
      type: 'ttlExpire',
      payload: { messageId: entry.message.id, queueId: 'q1', enqueuedAt: entry.enqueuedAt },
    })
    expect(next.queues.q1).toHaveLength(0)
    expect(next.metrics.expired).toBe(1)
  })

  it('is a no-op when the message already left the queue', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = applyTtlExpire(state, {
      at: 2000,
      seq: 0,
      type: 'ttlExpire',
      payload: { messageId: 'gone', queueId: 'q1', enqueuedAt: 0 },
    })
    expect(newEvents).toEqual([])
    expect(next.metrics.expired).toBe(0)
  })

  it('ignores a stale TTL from a previous stay after the message cycles back', () => {
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    const firstEntry = state.queues.q1![0]!

    // The message leaves and re-enters the queue later, keeping its id but
    // taking a new enqueuedAt. The TTL scheduled for the first stay must not
    // touch this second one.
    const requeued = {
      message: firstEntry.message,
      enqueuedAt: firstEntry.enqueuedAt + 5000,
    }
    const cycled: EngineState = { ...state, queues: { ...state.queues, q1: [requeued] } }

    const { state: next, newEvents } = applyTtlExpire({ ...cycled, now: 7000 }, {
      at: 7000,
      seq: 0,
      type: 'ttlExpire',
      payload: {
        messageId: firstEntry.message.id,
        queueId: 'q1',
        enqueuedAt: firstEntry.enqueuedAt,
      },
    })

    expect(next.queues.q1).toHaveLength(1)
    expect(next.metrics.expired).toBe(0)
    expect(newEvents).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/dlx.test.ts`
Expected: FAIL, `Failed to resolve import "./dlx"`.

- [ ] **Step 3: Implement dead-lettering**

`src/engine/dlx.ts`:

```ts
import { addInFlight, log, scheduleEvent, TRAVEL_MS } from './broker'
import type { ApplyResult, EngineState, Message, NodeId, QueueSpec, SimEvent } from './types'

export type DeathReason = 'rejected' | 'expired' | 'maxlen'

export function effectiveTtl(queue: QueueSpec, message: Message): number | undefined {
  const ttls = [queue.messageTtlMs, message.expirationMs].filter(
    (t): t is number => typeof t === 'number',
  )
  return ttls.length === 0 ? undefined : Math.min(...ttls)
}

/**
 * Routes a message out of `fromQueueId` into that queue's dead-letter exchange.
 * Drops it when no dead-letter exchange is configured, matching RabbitMQ.
 */
export function deadLetter(
  state: EngineState,
  message: Message,
  fromQueueId: NodeId,
  reason: DeathReason,
): ApplyResult {
  const queue = state.topology.queues.find((q) => q.id === fromQueueId)
  const target = queue?.deadLetterExchange

  if (!queue || !target) {
    const dropped = log(
      { ...state, metrics: { ...state.metrics, dropped: state.metrics.dropped + 1 } },
      {
        at: state.now,
        type: 'deadLetter',
        text: `${message.id} ${reason} in ${fromQueueId} with no dead-letter exchange; dropped`,
        nodeId: fromQueueId,
        messageId: message.id,
      },
    )
    return { state: dropped, newEvents: [] }
  }

  const carried: Message = {
    ...message,
    routingKey: queue.deadLetterRoutingKey ?? message.routingKey,
    deathTrail: [...message.deathTrail, fromQueueId],
    redeliveryCount: 0,
    headers: {
      ...message.headers,
      'x-death-reason': reason,
      'x-death-count': String(message.deathTrail.length + 1),
    },
  }

  let next: EngineState = {
    ...state,
    metrics: { ...state.metrics, deadLettered: state.metrics.deadLettered + 1 },
  }
  next = addInFlight(next, message.id, fromQueueId, target, 'rose')
  next = log(next, {
    at: state.now,
    type: 'deadLetter',
    text: `${message.id} ${reason}; dead-lettered from ${queue.label} to ${target}`,
    nodeId: fromQueueId,
    messageId: message.id,
  })

  const [routeEvent, afterSchedule] = scheduleEvent(next, state.now + TRAVEL_MS, 'route', {
    message: carried,
    exchangeId: target,
    fromId: fromQueueId,
    tone: 'rose',
  })
  return { state: afterSchedule, newEvents: [routeEvent] }
}

export function applyTtlExpire(state: EngineState, event: SimEvent): ApplyResult {
  const messageId = event.payload.messageId as string
  const queueId = event.payload.queueId as NodeId
  const queue = state.queues[queueId] ?? []
  // Match the exact enqueue this event was scheduled for. Ids survive
  // dead-lettering, so a message that cycles back into this queue would be
  // killed early by the stale TTL event from its previous stay.
  const enqueuedAt = event.payload.enqueuedAt as number
  const entry = queue.find((q) => q.message.id === messageId && q.enqueuedAt === enqueuedAt)

  // The message was consumed before its TTL fired; nothing to expire.
  if (!entry) return { state, newEvents: [] }

  const without: EngineState = {
    ...state,
    queues: { ...state.queues, [queueId]: queue.filter((q) => q.message.id !== messageId) },
    metrics: { ...state.metrics, expired: state.metrics.expired + 1 },
  }
  return deadLetter(without, entry.message, queueId, 'expired')
}

export function applyDeadLetter(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const fromQueueId = event.payload.queueId as NodeId
  const reason = (event.payload.reason as DeathReason) ?? 'rejected'
  return deadLetter(state, message, fromQueueId, reason)
}
```

- [ ] **Step 4: Enforce TTL and max-length on enqueue**

In `src/engine/broker.ts`, import the DLX helpers and replace the body of `applyEnqueue` after the `next = { ...next, queues: ... }` assignment with:

```ts
  const events: SimEvent[] = []

  // drop-head overflow: the oldest message leaves to make room for the new one
  const spec = state.topology.queues.find((q) => q.id === queueId)
  if (spec?.maxLength !== undefined) {
    const current = next.queues[queueId] ?? []
    if (current.length > spec.maxLength) {
      const oldest = current[0]!
      next = { ...next, queues: { ...next.queues, [queueId]: current.slice(1) } }
      const overflow = deadLetter(next, oldest.message, queueId, 'maxlen')
      next = overflow.state
      events.push(...overflow.newEvents)
    }
  }

  // Only schedule a TTL if the message actually survived the overflow check —
  // with maxLength 0 the message we just enqueued is already gone.
  const survived = (next.queues[queueId] ?? []).some((q) => q.message.id === message.id)
  if (spec && survived) {
    const ttl = effectiveTtl(spec, message)
    if (ttl !== undefined) {
      const [expireEvent, afterTtl] = scheduleEvent(next, state.now + ttl, 'ttlExpire', {
        messageId: message.id,
        queueId,
        // Identifies THIS enqueue. A dead-lettered message keeps its id, so a
        // message that cycles back into the same queue would otherwise be killed
        // by the stale TTL event left over from its previous stay.
        enqueuedAt: state.now,
      })
      next = afterTtl
      events.push(expireEvent)
    }
  }

  next = log(next, {
    at: state.now,
    type: 'enqueue',
    text: `${message.id} enqueued in ${queueId} (depth ${(next.queues[queueId] ?? []).length})`,
    nodeId: queueId,
    messageId: message.id,
  })

  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  events.push(dispatchEvent)
  return { state: afterSchedule, newEvents: events }
```

Add at the top of `src/engine/broker.ts`:

```ts
import { deadLetter, effectiveTtl } from './dlx'
```

`broker.ts` and `dlx.ts` import from each other. This is safe because every import is a function called at runtime, not evaluated at module load — but keep `TRAVEL_MS` and the helper functions in `broker.ts` so `dlx.ts` never needs a broker value at module scope.

- [ ] **Step 5: Route rejected messages to the DLX**

In `src/engine/delivery.ts`, replace the `else` branch of `applyNack` (the no-requeue path) with:

```ts
  } else {
    next = log(next, {
      at: state.now,
      type: 'nack',
      text: `${consumerId} rejected ${messageId} without requeue`,
      nodeId: consumerId,
      messageId,
    })
    if (message) {
      const dead = deadLetter(next, message, queueId, 'rejected')
      next = dead.state
      const [dispatchAfterDeath, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
      return { state: afterSchedule, newEvents: [...dead.newEvents, dispatchAfterDeath] }
    }
  }
```

Add the import `import { deadLetter } from './dlx'` to `src/engine/delivery.ts`.

- [ ] **Step 6: Run the engine suite**

Run: `npm test -- src/engine`
Expected: PASS, including 8 new DLX tests.

- [ ] **Step 7: Commit**

```bash
git add src/engine
git commit -m "feat: add ttl expiry, max-length overflow, and dead-lettering"
```

---

## Task 8: Priority, RPC replies, and consumer failure

**Files:**
- Create: `src/engine/advanced.ts`, `src/engine/advanced.test.ts`
- Modify: `src/engine/broker.ts` — priority insertion inside `applyEnqueue`
- Modify: `src/engine/delivery.ts` — emit a reply publish on ack when `replyTo` is set

**Interfaces:**
- Consumes: `scheduleEvent`, `log` from `src/engine/broker.ts`
- Produces:
  - `insertByPriority(queue: QueuedMessage[], entry: QueuedMessage, maxPriority: number | undefined): QueuedMessage[]`
  - `requeueByPriority(queue: QueuedMessage[], entry: QueuedMessage, maxPriority: number | undefined): QueuedMessage[]`
  - `applyConsumerCrash(state: EngineState, event: SimEvent): ApplyResult`
  - `applyConsumerRecover(state: EngineState, event: SimEvent): ApplyResult`
  - `buildReplyEvents(state: EngineState, message: Message, consumerId: NodeId): [SimEvent[], EngineState]`

**Semantics to implement:**
- **Priority:** when a queue sets `maxPriority`, a new message is inserted ahead of every queued message with a strictly lower priority and behind equals, so equal priorities stay FIFO. Queues without `maxPriority` always append.
- **Requeue must respect priority.** Tasks 6 and 8 both return messages to a queue by prepending them (`applyNack` on requeue, `applyConsumerCrash` on held messages). Prepending is correct only on a FIFO queue. On a priority queue it lets a rejected priority-0 message jump ahead of waiting priority-9 messages, which defeats the queue's entire purpose after a single nack. Both paths must instead requeue at the head *of the message's own priority band* via `requeueByPriority`, which inserts ahead of equals (the message was already at the head) but never ahead of anything higher. Queues without `maxPriority` keep the plain prepend.
- **Overflow on a priority queue drops the highest-priority message, and that is correct.** With `maxPriority` set, `insertByPriority` puts the most important message at index 0, so drop-head overflow discards it. This looks wrong and is not: RabbitMQ documents that with `x-max-length` and `drop-head`, "higher priority messages might be dropped to make way for lower priority ones, which might not be what you would expect" — the alternative is `reject-publish`. Keep the behaviour and let Lesson 15 teach the gotcha. Do not "fix" it.
- **Delayed messages** need no new mechanism: a lesson models them as a queue with a TTL and a dead-letter exchange pointing at the real queue. Task 16's lesson uses exactly that, which is how the delayed-message plugin actually behaves.
- **RPC:** when an acked message carries `replyTo` and `correlationId`, the consumer publishes a response into the exchange named by `replyTo`, reusing the same `correlationId`. The reply is an ordinary `publish` event, so it animates like any other message.
- **Consumer crash:** `consumerCrash` adds the consumer to `state.crashed`. Every message it holds unacked is requeued at the head of its queue with `redeliveryCount + 1` — this is the recovery a manual-ack consumer gets. For an `autoAck` consumer there is nothing held, so the in-flight message is lost, which is the whole point of Lesson 7.
- **Quorum queues** (Lesson 17) reuse the crash mechanism: a `quorum` queue survives a crash with its messages intact, while a `classic` queue configured as non-durable in the lesson loses unacked work. The distinction is expressed in lesson data, not in new engine branching.

- [ ] **Step 1: Write the failing advanced test**

`src/engine/advanced.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyConsumerCrash, applyConsumerRecover, buildReplyEvents, insertByPriority, requeueByPriority } from './advanced'
import { createEngineState } from './broker'
import type { EngineState, Message, QueuedMessage, Topology } from './types'

const message = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  body: 'x',
  routingKey: 'go',
  headers: {},
  priority: 0,
  publishedAt: 0,
  redeliveryCount: 0,
  deathTrail: [],
  persistent: false,
  ...over,
})

const entry = (id: string, priority: number): QueuedMessage => ({
  message: message(id, { priority }),
  enqueuedAt: 0,
})

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [
    { id: 'ex', label: 'rpc', type: 'direct', position: { x: 200, y: 0 } },
    { id: 'replies', label: 'replies', type: 'direct', position: { x: 800, y: 0 } },
  ],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [
    {
      id: 'c1',
      label: 'worker',
      queueId: 'q1',
      prefetch: 1,
      autoAck: false,
      processingMs: 500,
      jitterMs: 0,
      nackRate: 0,
      requeueOnNack: true,
      position: { x: 600, y: 0 },
    },
  ],
  bindings: [],
}

describe('insertByPriority', () => {
  it('appends when the queue has no maxPriority', () => {
    const queue = [entry('m1', 0)]
    expect(insertByPriority(queue, entry('m2', 9), undefined).map((q) => q.message.id)).toEqual(['m1', 'm2'])
  })

  it('places a higher priority message ahead of lower ones', () => {
    const queue = [entry('m1', 1), entry('m2', 1)]
    expect(insertByPriority(queue, entry('m3', 5), 10).map((q) => q.message.id)).toEqual(['m3', 'm1', 'm2'])
  })

  it('keeps equal priorities in arrival order', () => {
    const queue = [entry('m1', 5), entry('m2', 5)]
    expect(insertByPriority(queue, entry('m3', 5), 10).map((q) => q.message.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('places a lower priority message behind higher ones', () => {
    const queue = [entry('m1', 9)]
    expect(insertByPriority(queue, entry('m2', 1), 10).map((q) => q.message.id)).toEqual(['m1', 'm2'])
  })
})

describe('requeueByPriority', () => {
  it('prepends when the queue has no maxPriority', () => {
    const queue = [entry('m1', 0), entry('m2', 0)]
    expect(requeueByPriority(queue, entry('m3', 0), undefined).map((q) => q.message.id)).toEqual(['m3', 'm1', 'm2'])
  })

  it('does not let a rejected low-priority message jump ahead of waiting high-priority ones', () => {
    const queue = [entry('m-high', 9), entry('m-mid', 5)]
    expect(requeueByPriority(queue, entry('m-low', 0), 9).map((q) => q.message.id)).toEqual([
      'm-high',
      'm-mid',
      'm-low',
    ])
  })

  it('returns the message to the head of its own priority band, ahead of equals', () => {
    const queue = [entry('m-high', 9), entry('m-peer', 5), entry('m-low', 0)]
    expect(requeueByPriority(queue, entry('m-back', 5), 9).map((q) => q.message.id)).toEqual([
      'm-high',
      'm-back',
      'm-peer',
      'm-low',
    ])
  })
})

describe('applyConsumerCrash', () => {
  it('requeues unacked messages at the head with an incremented redelivery count', () => {
    const base = createEngineState(topology, 1)
    const state: EngineState = {
      ...base,
      unacked: { c1: ['m1'] },
      queues: { q1: [entry('m2', 0)] },
    }
    const held = new Map([['m1', message('m1')]])
    const { state: next } = applyConsumerCrash(
      { ...state, journal: [] },
      { at: 0, seq: 0, type: 'consumerCrash', payload: { consumerId: 'c1', heldMessages: [...held.values()] } },
    )
    expect(next.crashed).toEqual(['c1'])
    expect(next.unacked.c1).toEqual([])
    expect(next.queues.q1!.map((q) => q.message.id)).toEqual(['m1', 'm2'])
    expect(next.queues.q1![0]!.message.redeliveryCount).toBe(1)
  })
})

describe('applyConsumerRecover', () => {
  it('clears the crashed flag and re-dispatches the queue', () => {
    const base = createEngineState(topology, 1)
    const { state: next, newEvents } = applyConsumerRecover(
      { ...base, crashed: ['c1'] },
      { at: 0, seq: 0, type: 'consumerRecover', payload: { consumerId: 'c1' } },
    )
    expect(next.crashed).toEqual([])
    expect(newEvents.map((e) => e.type)).toEqual(['dispatch'])
  })
})

describe('buildReplyEvents', () => {
  it('publishes a reply carrying the same correlationId', () => {
    const state = createEngineState(topology, 1)
    const request = message('m1', { correlationId: 'corr-1', replyTo: 'replies' })
    const [events] = buildReplyEvents(state, request, 'c1')
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('publish')
    expect(events[0]!.payload.correlationId).toBe('corr-1')
    expect(events[0]!.payload.exchangeId).toBe('replies')
  })

  it('produces nothing for a message with no replyTo', () => {
    const state = createEngineState(topology, 1)
    const [events] = buildReplyEvents(state, message('m1'), 'c1')
    expect(events).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/advanced.test.ts`
Expected: FAIL, `Failed to resolve import "./advanced"`.

- [ ] **Step 3: Implement the advanced behaviours**

`src/engine/advanced.ts`:

```ts
import { log, scheduleEvent } from './broker'
import type { ApplyResult, EngineState, Message, NodeId, QueuedMessage, SimEvent } from './types'

/**
 * Inserts ahead of every strictly lower priority entry and behind equals, so
 * messages of equal priority stay first-in-first-out.
 */
export function insertByPriority(
  queue: readonly QueuedMessage[],
  incoming: QueuedMessage,
  maxPriority: number | undefined,
): QueuedMessage[] {
  if (maxPriority === undefined) return [...queue, incoming]
  const index = queue.findIndex((q) => q.message.priority < incoming.message.priority)
  if (index === -1) return [...queue, incoming]
  return [...queue.slice(0, index), incoming, ...queue.slice(index)]
}

/**
 * Returns a rejected or crash-released message to the queue. It goes back to
 * the head, but on a priority queue "the head" means the head of its own
 * priority band: a requeued message must not jump ahead of higher-priority
 * messages that were waiting behind it. Unlike insertByPriority this inserts
 * ahead of equals, because the message had already reached the front once.
 */
export function requeueByPriority(
  queue: readonly QueuedMessage[],
  incoming: QueuedMessage,
  maxPriority: number | undefined,
): QueuedMessage[] {
  if (maxPriority === undefined) return [incoming, ...queue]
  const index = queue.findIndex((q) => q.message.priority <= incoming.message.priority)
  if (index === -1) return [...queue, incoming]
  return [...queue.slice(0, index), incoming, ...queue.slice(index)]
}

export function applyConsumerCrash(state: EngineState, event: SimEvent): ApplyResult {
  const consumerId = event.payload.consumerId as NodeId
  const held = (event.payload.heldMessages as Message[]) ?? []
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)

  let next: EngineState = {
    ...state,
    crashed: state.crashed.includes(consumerId) ? state.crashed : [...state.crashed, consumerId],
    unacked: { ...state.unacked, [consumerId]: [] },
    inFlight: state.inFlight.filter((f) => !f.edgeId.endsWith(`->${consumerId}`)),
  }

  if (consumer && held.length > 0 && !consumer.autoAck) {
    const spec = state.topology.queues.find((q) => q.id === consumer.queueId)
    // Fold from the right so that after each insert-ahead-of-equals the held
    // messages end up in their original order rather than reversed.
    const restored = held.reduceRight<QueuedMessage[]>(
      (acc, m) =>
        requeueByPriority(
          acc,
          { message: { ...m, redeliveryCount: m.redeliveryCount + 1 }, enqueuedAt: state.now },
          spec?.maxPriority,
        ),
      [...(next.queues[consumer.queueId] ?? [])],
    )
    next = { ...next, queues: { ...next.queues, [consumer.queueId]: restored } }
    next = log(next, {
      at: state.now,
      type: 'consumerCrash',
      text: `${consumerId} crashed; ${held.length} unacked message(s) requeued`,
      nodeId: consumerId,
    })
  } else {
    next = log(next, {
      at: state.now,
      type: 'consumerCrash',
      text: consumer?.autoAck
        ? `${consumerId} crashed; in-flight message lost because auto-ack already confirmed it`
        : `${consumerId} crashed with nothing unacked`,
      nodeId: consumerId,
    })
  }

  return { state: next, newEvents: [] }
}

export function applyConsumerRecover(state: EngineState, event: SimEvent): ApplyResult {
  const consumerId = event.payload.consumerId as NodeId
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)

  let next: EngineState = { ...state, crashed: state.crashed.filter((id) => id !== consumerId) }
  next = log(next, {
    at: state.now,
    type: 'consumerRecover',
    text: `${consumerId} recovered and resumed consuming`,
    nodeId: consumerId,
  })

  if (!consumer) return { state: next, newEvents: [] }
  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', {
    queueId: consumer.queueId,
  })
  return { state: afterSchedule, newEvents: [dispatchEvent] }
}

/** Emits the RPC response publish for an acked request, if it asked for one. */
export function buildReplyEvents(
  state: EngineState,
  message: Message,
  consumerId: NodeId,
): [SimEvent[], EngineState] {
  if (!message.replyTo) return [[], state]
  const [replyEvent, next] = scheduleEvent(state, state.now, 'publish', {
    publisherId: consumerId,
    exchangeId: message.replyTo,
    routingKey: message.correlationId ?? '',
    body: `reply to ${message.id}`,
    headers: {},
    correlationId: message.correlationId,
    tone: 'amber',
  })
  return [[replyEvent], next]
}
```

- [ ] **Step 4: Use priority insertion in the broker**

In `src/engine/broker.ts`, replace the plain append

```ts
  next = { ...next, queues: { ...next.queues, [queueId]: [...existing, entry] } }
```

with:

```ts
  const spec = state.topology.queues.find((q) => q.id === queueId)
  next = {
    ...next,
    queues: { ...next.queues, [queueId]: insertByPriority(existing, entry, spec?.maxPriority) },
  }
```

Add `import { insertByPriority } from './advanced'` and delete the later duplicate `const spec = ...` line introduced in Task 7 so `spec` is declared once.

- [ ] **Step 5: Emit RPC replies on ack**

In `src/engine/delivery.ts`, inside `applyAck`, after the metrics update and before scheduling the dispatch event:

```ts
  const message = event.payload.message as Message | undefined
  let replyEvents: SimEvent[] = []
  if (message) {
    const [events, afterReply] = buildReplyEvents(next, message, consumerId)
    replyEvents = events
    next = afterReply
  }
```

and change the return to:

```ts
  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  return { state: afterSchedule, newEvents: [...replyEvents, dispatchEvent] }
```

Add `import { buildReplyEvents } from './advanced'`.

- [ ] **Step 6: Run the engine suite**

Run: `npm test -- src/engine`
Expected: PASS, including 8 new advanced tests.

- [ ] **Step 7: Commit**

```bash
git add src/engine
git commit -m "feat: add priority ordering, rpc replies, and consumer crash recovery"
```

---

## Task 9: Validation, runaway guards, and the simulation façade

**Files:**
- Create: `src/engine/validate.ts`, `src/engine/validate.test.ts`, `src/engine/index.ts`, `src/engine/simulation.test.ts`

**Interfaces:**
- Consumes: every `apply*` reducer from Tasks 5 through 8; `createScheduler`, `pushAll`, `popDue`, `peekTime` from `src/engine/clock.ts`
- Produces:
  - `validateTopology(topology: Topology): ValidationIssue[]`
  - `interface ValidationIssue { nodeId?: NodeId; severity: 'error' | 'warning'; message: string }`
  - `createSimulation(options: SimulationOptions): Simulation`
  - `interface SimulationOptions { topology: Topology; script: ScriptedAction[]; failures?: ScriptedFailure[]; seed: number; maxEvents?: number }`
  - `interface ScriptedAction { at: number; publisherId: NodeId; exchangeId: NodeId; routingKey: string; body: string; headers?: Record<string, string>; priority?: number; correlationId?: string; replyTo?: NodeId; tone?: string }`
  - `interface Simulation { advanceTo(t: number): void; stepOnce(): void; reset(): void; nextEventTime(): number | undefined; snapshot(): EngineState; issues: ValidationIssue[] }`
  - Guard constants `MAX_EVENTS_PER_RUN = 200_000`, `MAX_JOURNAL = 5_000`

**Semantics to implement:**
- `createSimulation` seeds the scheduler with one `publish` event per scripted action plus any `consumerCrash` / `consumerRecover` actions the lesson declares.
- `advanceTo(t)` pops every due event, dispatches on `event.type` to the matching reducer, pushes returned events, and repeats until the heap has nothing at or before `t`. It sets `state.now` to each event's `at` before applying it.
- `stepOnce()` calls `advanceTo(nextEventTime())`, applying exactly the events at that timestamp.
- `reset()` rebuilds from the original topology and seed, which is how rewinding works: the caller resets and advances to the target time.
- The journal is capped at `MAX_JOURNAL` entries by dropping the oldest, so a long run cannot grow without bound.
- Exceeding `MAX_EVENTS_PER_RUN` sets `state.halted` and stops dispatching. This catches a dead-letter cycle that would otherwise spin forever.

- [ ] **Step 1: Write the failing validation test**

`src/engine/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateTopology } from './validate'
import type { Topology } from './types'

const base: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'main', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
}

describe('validateTopology', () => {
  it('accepts a well-formed topology', () => {
    expect(validateTopology(base)).toEqual([])
  })

  it('flags a binding pointing at a missing destination', () => {
    const broken: Topology = {
      ...base,
      bindings: [{ ...base.bindings[0]!, destinationId: 'ghost' }],
    }
    const issues = validateTopology(broken)
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('ghost'))).toBe(true)
  })

  it('flags a dead-letter exchange that does not exist', () => {
    const broken: Topology = {
      ...base,
      queues: [{ ...base.queues[0]!, deadLetterExchange: 'nope' }],
    }
    expect(validateTopology(broken).some((i) => i.message.includes('nope'))).toBe(true)
  })

  it('flags a zero-ttl dead-letter cycle that would never advance time', () => {
    const looping: Topology = {
      ...base,
      queues: [{ ...base.queues[0]!, messageTtlMs: 0, deadLetterExchange: 'ex' }],
      bindings: [
        { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
      ],
    }
    const issues = validateTopology(looping)
    expect(issues.some((i) => i.message.toLowerCase().includes('cycle'))).toBe(true)
  })

  it('warns about a queue no message can reach', () => {
    const orphan: Topology = {
      ...base,
      queues: [...base.queues, { id: 'q2', label: 'orphan', kind: 'classic', position: { x: 400, y: 100 } }],
    }
    const issues = validateTopology(orphan)
    expect(issues.some((i) => i.severity === 'warning' && i.nodeId === 'q2')).toBe(true)
  })

  it('warns about a consumer attached to a queue that does not exist', () => {
    const orphan: Topology = {
      ...base,
      consumers: [
        {
          id: 'c1',
          label: 'worker',
          queueId: 'ghost',
          prefetch: 1,
          autoAck: false,
          processingMs: 500,
          jitterMs: 0,
          nackRate: 0,
          requeueOnNack: true,
          position: { x: 600, y: 0 },
        },
      ],
    }
    expect(validateTopology(orphan).some((i) => i.severity === 'error' && i.nodeId === 'c1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/validate.test.ts`
Expected: FAIL, `Failed to resolve import "./validate"`.

- [ ] **Step 3: Implement validation**

`src/engine/validate.ts`:

```ts
import type { NodeId, Topology } from './types'

export interface ValidationIssue {
  nodeId?: NodeId
  severity: 'error' | 'warning'
  message: string
}

export function validateTopology(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const queueIds = new Set(topology.queues.map((q) => q.id))
  const exchangeIds = new Set(topology.exchanges.map((e) => e.id))

  for (const binding of topology.bindings) {
    if (!exchangeIds.has(binding.exchangeId)) {
      issues.push({
        nodeId: binding.exchangeId,
        severity: 'error',
        message: `binding ${binding.id} starts at exchange ${binding.exchangeId}, which does not exist`,
      })
    }
    const known = binding.destinationKind === 'queue' ? queueIds : exchangeIds
    if (!known.has(binding.destinationId)) {
      issues.push({
        nodeId: binding.destinationId,
        severity: 'error',
        message: `binding ${binding.id} points at ${binding.destinationId}, which does not exist`,
      })
    }
  }

  for (const queue of topology.queues) {
    if (queue.deadLetterExchange && !exchangeIds.has(queue.deadLetterExchange)) {
      issues.push({
        nodeId: queue.id,
        severity: 'error',
        message: `queue ${queue.label} dead-letters to ${queue.deadLetterExchange}, which does not exist`,
      })
    }

    // A zero TTL plus a dead-letter exchange that routes back here loops without advancing time.
    if (queue.messageTtlMs === 0 && queue.deadLetterExchange) {
      const returns = topology.bindings.some(
        (b) =>
          b.exchangeId === queue.deadLetterExchange &&
          b.destinationKind === 'queue' &&
          b.destinationId === queue.id,
      )
      if (returns) {
        issues.push({
          nodeId: queue.id,
          severity: 'error',
          message: `queue ${queue.label} forms a zero-TTL dead-letter cycle; the run would never advance`,
        })
      }
    }

    const reachable = topology.bindings.some(
      (b) => b.destinationKind === 'queue' && b.destinationId === queue.id,
    )
    if (!reachable) {
      issues.push({
        nodeId: queue.id,
        severity: 'warning',
        message: `queue ${queue.label} has no binding, so no message can reach it`,
      })
    }
  }

  for (const consumer of topology.consumers) {
    if (!queueIds.has(consumer.queueId)) {
      issues.push({
        nodeId: consumer.id,
        severity: 'error',
        message: `consumer ${consumer.label} consumes from ${consumer.queueId}, which does not exist`,
      })
    }
  }

  return issues
}
```

- [ ] **Step 4: Write the failing simulation test**

`src/engine/simulation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSimulation } from './index'
import type { ScriptedAction, Topology } from './index'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'orders', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [
    {
      id: 'c1',
      label: 'worker',
      queueId: 'q1',
      prefetch: 1,
      autoAck: false,
      processingMs: 400,
      jitterMs: 200,
      nackRate: 0.3,
      requeueOnNack: true,
      position: { x: 600, y: 0 },
    },
  ],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
}

const script: ScriptedAction[] = Array.from({ length: 6 }, (_, i) => ({
  at: i * 400,
  publisherId: 'p1',
  exchangeId: 'ex',
  routingKey: 'go',
  body: `job-${i}`,
}))

describe('createSimulation', () => {
  it('drains published messages through to acks', () => {
    const sim = createSimulation({ topology, script, seed: 7 })
    sim.advanceTo(30_000)
    const state = sim.snapshot()
    expect(state.metrics.published).toBe(6)
    expect(state.metrics.acked).toBe(6)
    expect(state.queues.q1).toHaveLength(0)
  })

  it('produces an identical journal for the same seed', () => {
    const a = createSimulation({ topology, script, seed: 7 })
    const b = createSimulation({ topology, script, seed: 7 })
    a.advanceTo(30_000)
    b.advanceTo(30_000)
    expect(JSON.stringify(a.snapshot().journal)).toBe(JSON.stringify(b.snapshot().journal))
  })

  it('produces a different journal for a different seed', () => {
    const a = createSimulation({ topology, script, seed: 7 })
    const b = createSimulation({ topology, script, seed: 8 })
    a.advanceTo(30_000)
    b.advanceTo(30_000)
    expect(JSON.stringify(a.snapshot().journal)).not.toBe(JSON.stringify(b.snapshot().journal))
  })

  it('reaches the same state by replay as by advancing directly', () => {
    const direct = createSimulation({ topology, script, seed: 7 })
    direct.advanceTo(3_000)

    const replayed = createSimulation({ topology, script, seed: 7 })
    replayed.advanceTo(30_000)
    replayed.reset()
    replayed.advanceTo(3_000)

    expect(JSON.stringify(replayed.snapshot())).toBe(JSON.stringify(direct.snapshot()))
  })

  it('advances exactly one timestamp per stepOnce', () => {
    const sim = createSimulation({ topology, script, seed: 7 })
    const first = sim.nextEventTime()
    sim.stepOnce()
    expect(sim.snapshot().now).toBe(first)
    expect(sim.nextEventTime()).toBeGreaterThan(first!)
  })

  it('caps the journal so a long run cannot grow without bound', () => {
    const busy: ScriptedAction[] = Array.from({ length: 4000 }, (_, i) => ({
      at: i * 10,
      publisherId: 'p1',
      exchangeId: 'ex',
      routingKey: 'go',
      body: `job-${i}`,
    }))
    const sim = createSimulation({ topology, script: busy, seed: 1 })
    sim.advanceTo(200_000)
    expect(sim.snapshot().journal.length).toBeLessThanOrEqual(5_000)
  })

  it('surfaces validation issues without running', () => {
    const broken: Topology = { ...topology, bindings: [] }
    const sim = createSimulation({ topology: broken, script, seed: 1 })
    expect(sim.issues.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 5: Run it to confirm failure**

Run: `npm test -- src/engine/simulation.test.ts`
Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 6: Implement the façade**

`src/engine/index.ts`:

```ts
import { applyConsumerCrash, applyConsumerRecover } from './advanced'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { createScheduler, peekTime, popDue, pushAll, type Scheduler } from './clock'
import { applyAck, applyConsumeDone, applyDeliver, applyDispatch, applyNack } from './delivery'
import { applyTtlExpire } from './dlx'
import type { ApplyResult, EngineState, NodeId, SimEvent, Topology } from './types'
import { validateTopology, type ValidationIssue } from './validate'

export * from './types'
export { validateTopology, type ValidationIssue }

export const MAX_EVENTS_PER_RUN = 200_000
export const MAX_JOURNAL = 5_000

export interface ScriptedAction {
  at: number
  publisherId: NodeId
  exchangeId: NodeId
  routingKey: string
  body: string
  headers?: Record<string, string>
  priority?: number
  correlationId?: string
  replyTo?: NodeId
  tone?: string
}

export interface ScriptedFailure {
  at: number
  consumerId: NodeId
  kind: 'crash' | 'recover'
}

export interface SimulationOptions {
  topology: Topology
  script: ScriptedAction[]
  failures?: ScriptedFailure[]
  seed: number
  /**
   * Overrides MAX_EVENTS_PER_RUN. The Sandbox lowers it so a user-built runaway
   * topology trips the guard in a fraction of a second instead of grinding, and
   * the guard test uses it to prove the halt without processing 200_000 events.
   */
  maxEvents?: number
}

export interface Simulation {
  advanceTo(virtualMs: number): void
  stepOnce(): void
  reset(): void
  nextEventTime(): number | undefined
  snapshot(): EngineState
  readonly issues: ValidationIssue[]
}

const REDUCERS: Record<SimEvent['type'], (s: EngineState, e: SimEvent) => ApplyResult> = {
  publish: applyPublish,
  route: applyRoute,
  enqueue: applyEnqueue,
  dispatch: applyDispatch,
  deliver: applyDeliver,
  consumeDone: applyConsumeDone,
  ack: applyAck,
  nack: applyNack,
  ttlExpire: applyTtlExpire,
  deadLetter: (s) => ({ state: s, newEvents: [] }),
  retryBackoff: (s) => ({ state: s, newEvents: [] }),
  consumerCrash: applyConsumerCrash,
  consumerRecover: applyConsumerRecover,
}

function seedEvents(options: SimulationOptions): SimEvent[] {
  let seq = 0
  const publishes = options.script.map<SimEvent>((action) => ({
    at: action.at,
    seq: seq++,
    type: 'publish',
    payload: {
      publisherId: action.publisherId,
      exchangeId: action.exchangeId,
      routingKey: action.routingKey,
      body: action.body,
      headers: action.headers ?? {},
      priority: action.priority ?? 0,
      correlationId: action.correlationId,
      replyTo: action.replyTo,
      tone: action.tone ?? 'sky',
    },
  }))

  const failures = (options.failures ?? []).map<SimEvent>((failure) => ({
    at: failure.at,
    seq: seq++,
    type: failure.kind === 'crash' ? 'consumerCrash' : 'consumerRecover',
    payload: { consumerId: failure.consumerId },
  }))

  return [...publishes, ...failures]
}

function capJournal(state: EngineState): EngineState {
  if (state.journal.length <= MAX_JOURNAL) return state
  return { ...state, journal: state.journal.slice(state.journal.length - MAX_JOURNAL) }
}

export function createSimulation(options: SimulationOptions): Simulation {
  const issues = validateTopology(options.topology)
  const fatal = issues.some((i) => i.severity === 'error')

  let state: EngineState = createEngineState(options.topology, options.seed)
  let scheduler: Scheduler = pushAll(createScheduler(), seedEvents(options))
  let processed = 0

  // Crash events need the messages the consumer currently holds, which is only
  // knowable at apply time — so the reducer reads them from live state here.
  function enrich(event: SimEvent, current: EngineState): SimEvent {
    if (event.type !== 'consumerCrash') return event
    const consumerId = event.payload.consumerId as NodeId
    // state.unacked holds whole messages, so this is a straight read. Never
    // synthesise a placeholder message here: a blank stand-in would silently
    // "recover" an empty body and make Lesson 7 teach the opposite of the truth.
    const held = current.unacked[consumerId] ?? []
    return { ...event, payload: { ...event.payload, heldMessages: held } }
  }

  function run(upTo: number): void {
    // Fatal validation errors and a halted run are both terminal: never dispatch.
    if (fatal || state.halted) return
    for (;;) {
      // Drain ONE timestamp per iteration, never the whole span up to `upTo`.
      // Applying an event schedules follow-ups, and those follow-ups are usually
      // earlier than events already sitting in the heap. Popping everything up to
      // `upTo` at once would apply a scripted crash at t=2000 before the route at
      // t=600 that its own publish generated — the journal then runs backwards in
      // time and the message is never delivered at all. Because play advances a
      // frame at a time while scrub does one big jump, that bug makes scrubbing
      // produce a different simulation than playing, which defeats the whole
      // rewind-by-replay design.
      const next = peekTime(scheduler)
      if (next === undefined || next > upTo) return
      const [due, rest] = popDue(scheduler, next)
      scheduler = rest
      for (const event of due) {
        if (processed >= MAX_EVENTS_PER_RUN) {
          state = {
            ...state,
            halted: { reason: `event ceiling of ${MAX_EVENTS_PER_RUN} reached; the topology may loop` },
          }
          return
        }
        processed++
        const at: EngineState = { ...state, now: event.at }
        const result = REDUCERS[event.type](at, enrich(event, at))
        state = capJournal(result.state)
        scheduler = pushAll(scheduler, result.newEvents)
      }
    }
  }

  return {
    advanceTo(virtualMs) {
      run(virtualMs)
      if (!state.halted) state = { ...state, now: Math.max(state.now, virtualMs) }
    },
    stepOnce() {
      const next = peekTime(scheduler)
      if (next === undefined) return
      run(next)
      state = { ...state, now: next }
    },
    reset() {
      state = createEngineState(options.topology, options.seed)
      scheduler = pushAll(createScheduler(), seedEvents(options))
      processed = 0
    },
    nextEventTime() {
      return peekTime(scheduler)
    },
    snapshot() {
      return state
    },
    issues,
  }
}
```

- [ ] **Step 7: Cover `pushAll` and prove the guard stops a non-zero-TTL cycle**

Task 3 shipped `pushAll` without a dedicated test and this task leans on it in three places. Add to `src/engine/clock.test.ts`:

```ts
it('pushAll keeps ordering across a batch pushed at once', () => {
  const s = pushAll(createScheduler(), [
    { at: 300, seq: 1, type: 'publish', payload: {} },
    { at: 100, seq: 2, type: 'publish', payload: {} },
    { at: 300, seq: 0, type: 'publish', payload: {} },
    { at: 200, seq: 3, type: 'publish', payload: {} },
  ])
  const drained = popDue(s, 1000)
  expect(drained.events.map((e) => [e.at, e.seq])).toEqual([[100, 2], [200, 3], [300, 0], [300, 1]])
})

it('pushAll on an empty batch returns an equivalent scheduler', () => {
  const s = pushAll(createScheduler(), [{ at: 50, seq: 1, type: 'publish', payload: {} }])
  expect(peekTime(pushAll(s, []))).toBe(50)
})
```

`validateTopology` only rejects the **zero**-TTL dead-letter cycle. A cycle with a non-zero TTL is legal, advances time, and grows `deathTrail` and `x-death-count` linearly forever — Lesson 13 builds exactly this shape, so the runtime guard is the only thing standing between a mistyped lesson and a hung tab. Prove it actually fires. Add to `src/engine/index.test.ts`:

```ts
it('halts a non-zero-TTL dead-letter cycle instead of running forever', () => {
  const cycle: Topology = {
    publishers: [{ id: 'p1', label: 'P' }],
    exchanges: [{ id: 'ex', label: 'X', type: 'direct' }],
    queues: [{ id: 'q1', label: 'Q', messageTtlMs: 10, deadLetterExchange: 'ex' }],
    consumers: [],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
    ],
  }
  const sim = createSimulation({
    topology: cycle,
    seed: 1,
    script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'loop' }],
    // Reaching the default 200_000 ceiling costs ~60.5M ms of virtual time and
    // ~3s of wall clock. The property under test is that the guard halts an
    // endless cycle, not the default constant's value, so lower the ceiling.
    maxEvents: 2000,
  })
  sim.advanceTo(60 * 60 * 1000)
  const snap = sim.snapshot()
  expect(snap.halted).toBeDefined()
  expect(snap.halted!.reason).toContain('event ceiling')
  expect(snap.journal.length).toBeLessThanOrEqual(MAX_JOURNAL)
})
```

Run: `npx vitest run src/engine/clock.test.ts src/engine/index.test.ts`
Expected: PASS. If this test hangs instead of halting, the guard is not wired into the dispatch loop — fix that, do not raise the ceiling.

- [ ] **Step 8: Prove one big jump equals many small jumps**

Play advances the clock a frame at a time; scrub and rewind do a single large `advanceTo`. If those two paths disagree, scrubbing shows a different simulation than playing and the rewind-by-replay design collapses. This is the test that catches a `run()` loop draining a whole time span per iteration instead of one timestamp. Add to `src/engine/index.test.ts`:

```ts
it('produces the same journal whether advanced in one jump or many', () => {
  const options: SimulationOptions = {
    topology: crashTopology,
    seed: 1,
    script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'PAYLOAD' }],
    failures: [{ at: 2000, consumerId: 'c1', kind: 'crash' }],
  }
  const oneJump = createSimulation(options)
  oneJump.advanceTo(5000)

  const manyJumps = createSimulation(options)
  for (let t = 100; t <= 5000; t += 100) manyJumps.advanceTo(t)

  const a = oneJump.snapshot().journal.map((e) => `${e.at}:${e.type}`)
  expect(a).toEqual(manyJumps.snapshot().journal.map((e) => `${e.at}:${e.type}`))
  // and the journal must never run backwards in virtual time
  const times = oneJump.snapshot().journal.map((e) => e.at)
  expect([...times].sort((x, y) => x - y)).toEqual(times)
})

it('requeues the real message on crash, not a blank placeholder', () => {
  const sim = createSimulation({
    topology: crashTopology,
    seed: 1,
    script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'IMPORTANT' }],
    failures: [{ at: 2000, consumerId: 'c1', kind: 'crash' }],
  })
  sim.advanceTo(1999)
  expect(sim.snapshot().unacked.c1).toHaveLength(1)

  sim.advanceTo(5000)
  const requeued = sim.snapshot().queues.q1 ?? []
  expect(requeued).toHaveLength(1)
  expect(requeued[0]!.message.body).toBe('IMPORTANT')
  expect(requeued[0]!.message.routingKey).toBe('go')
  expect(requeued[0]!.message.redeliveryCount).toBe(1)
})
```

`crashTopology` is the base topology with one manual-ack consumer whose `ackDelayMs` is large enough (100_000) that it is still holding the message unacked when the crash fires.

Run: `npx vitest run src/engine/index.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the whole engine suite**

Run: `npm test -- src/engine`
Expected: PASS, including 6 validation tests and 7 simulation tests.

If the replay test fails, the cause is almost always a reducer that read ambient state or mutated its input. Re-check that every reducer returns fresh objects.

- [ ] **Step 10: Commit**

```bash
git add src/engine
git commit -m "feat: add topology validation, runaway guards, and simulation facade"
```

---

## Task 10: Lesson type, registry, and the first lesson

**Files:**
- Create: `src/lessons/types.ts`, `src/lessons/registry.ts`, `src/lessons/01-hello-world.ts`, `src/lessons/lessons.test.ts`

**Interfaces:**
- Consumes: `Topology`, `ScriptedAction`, `ScriptedFailure`, `createSimulation` from `src/engine`
- Produces:
  - `interface Lesson`, `interface NarrativeStep`, `interface Checkpoint`
  - `LESSONS: Lesson[]`, `LESSON_GROUPS: { id: LessonGroup; label: string }[]`
  - `getLesson(id: string): Lesson | undefined`

- [ ] **Step 1: Write the lesson types**

`src/lessons/types.ts`:

```ts
import type { ScriptedAction, ScriptedFailure, Topology } from '../engine'

export type LessonGroup = 'basics' | 'reliability' | 'dlx' | 'patterns'

export interface NarrativeStep {
  /** Virtual millisecond at which this step becomes the active explanation. */
  at: number
  title: string
  /** Markdown body rendered in the inspector. */
  body: string
  /** Node ids emphasised on the canvas while this step is active. */
  highlight?: string[]
}

export interface Checkpoint {
  at: number
  question: string
  options: string[]
  answerIndex: number
  explanation: string
}

export interface Lesson {
  id: string
  group: LessonGroup
  title: string
  /** One sentence shown under the title in the sidebar. */
  summary: string
  topology: Topology
  script: ScriptedAction[]
  failures?: ScriptedFailure[]
  narrative: NarrativeStep[]
  checkpoints?: Checkpoint[]
  seed: number
  /** Virtual milliseconds the lesson is expected to run for. */
  durationMs: number
}
```

- [ ] **Step 2: Write the registry**

`src/lessons/registry.ts`:

```ts
import type { Lesson, LessonGroup } from './types'
import { helloWorld } from './01-hello-world'

export const LESSON_GROUPS: { id: LessonGroup; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'dlx', label: 'Dead-lettering & retry' },
  { id: 'patterns', label: 'Patterns' },
]

export const LESSONS: Lesson[] = [helloWorld]

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export function lessonsByGroup(group: LessonGroup): Lesson[] {
  return LESSONS.filter((l) => l.group === group)
}
```

- [ ] **Step 3: Write lesson 1**

`src/lessons/01-hello-world.ts`:

```ts
import type { Lesson } from './types'

export const helloWorld: Lesson = {
  id: '01-hello-world',
  group: 'basics',
  title: 'Hello world',
  summary: 'One publisher, one queue, one consumer, and the default exchange.',
  seed: 1,
  durationMs: 12_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 140 } }],
    exchanges: [{ id: 'default', label: '(default)', type: 'direct', position: { x: 260, y: 140 } }],
    queues: [{ id: 'hello', label: 'hello', kind: 'classic', position: { x: 480, y: 140 } }],
    consumers: [
      {
        id: 'c1',
        label: 'Consumer',
        queueId: 'hello',
        prefetch: 1,
        autoAck: false,
        processingMs: 900,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 140 },
      },
    ],
    bindings: [
      {
        id: 'b1',
        exchangeId: 'default',
        destinationId: 'hello',
        destinationKind: 'queue',
        routingKey: 'hello',
      },
    ],
  },
  script: [0, 1500, 3000, 4500].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'default',
    routingKey: 'hello',
    body: `Hello ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'A publisher never writes to a queue',
      body: 'The publisher hands the message to an **exchange**, always. Even the "direct to a queue" case you see in tutorials goes through the *default exchange*, which has an implicit binding to every queue using the queue name as the routing key.',
      highlight: ['p1', 'default'],
    },
    {
      at: 1200,
      title: 'The exchange routes by routing key',
      body: 'This message carries the routing key `hello`. The default exchange is a direct exchange, so it looks for a binding whose key matches exactly, and finds the `hello` queue.',
      highlight: ['default', 'hello'],
    },
    {
      at: 2400,
      title: 'The queue buffers',
      body: 'The queue holds messages until a consumer is ready. Depth grows when publishers outrun consumers — that gap is the entire reason a broker exists.',
      highlight: ['hello'],
    },
    {
      at: 4000,
      title: 'The consumer acknowledges',
      body: 'With `prefetch: 1` and manual ack, the consumer holds exactly one unacked message at a time. Only when it acks does the queue release the next one. Watch the queue drain one message per cycle rather than all at once.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 6000,
      question: 'If the consumer stops acking, what happens to the queue?',
      options: [
        'The queue keeps delivering; messages pile up at the consumer',
        'The queue stops delivering after one message and depth grows',
        'The broker drops the extra messages',
      ],
      answerIndex: 1,
      explanation:
        'Prefetch caps unacked messages. At `prefetch: 1`, one unacked message blocks all further delivery to that consumer, so queue depth grows instead.',
    },
  ],
}
```

- [ ] **Step 4: Write the golden-journal harness and test**

`src/lessons/lessons.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { LESSONS } from './registry'

/** Runs a lesson to completion and returns a compact, comparable journal. */
export function runLesson(id: string): string[] {
  const lesson = LESSONS.find((l) => l.id === id)
  if (!lesson) throw new Error(`unknown lesson ${id}`)
  const sim = createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  sim.advanceTo(lesson.durationMs + 20_000)
  return sim.snapshot().journal.map((j) => `${j.at} ${j.type} ${j.text}`)
}

describe('every lesson', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has a valid topology', (_id, lesson) => {
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    const errors = sim.issues.filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s runs deterministically', (id) => {
    expect(runLesson(id)).toEqual(runLesson(id))
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s narrative stays inside its duration', (_id, lesson) => {
    for (const step of lesson.narrative) {
      expect(step.at).toBeLessThanOrEqual(lesson.durationMs)
    }
  })
})

describe('lesson 01 hello world', () => {
  it('delivers and acks all four messages', () => {
    const sim = createSimulation({
      topology: LESSONS[0]!.topology,
      script: LESSONS[0]!.script,
      seed: LESSONS[0]!.seed,
    })
    sim.advanceTo(30_000)
    const state = sim.snapshot()
    expect(state.metrics.published).toBe(4)
    expect(state.metrics.acked).toBe(4)
    expect(state.metrics.dropped).toBe(0)
  })

  it('never holds more than one unacked message at prefetch 1', () => {
    const sim = createSimulation({
      topology: LESSONS[0]!.topology,
      script: LESSONS[0]!.script,
      seed: LESSONS[0]!.seed,
    })
    let peak = 0
    for (let t = 0; t <= 30_000; t += 100) {
      sim.advanceTo(t)
      peak = Math.max(peak, sim.snapshot().unacked.c1?.length ?? 0)
    }
    expect(peak).toBe(1)
  })
})
```

- [ ] **Step 5: Run the lesson tests**

Run: `npm test -- src/lessons`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lessons
git commit -m "feat: add lesson model, registry, and the hello world lesson"
```

---

## Task 11: Store and the rAF simulation binding

**Files:**
- Create: `src/sim/store.ts`, `src/sim/useSimulation.ts`, `src/sim/store.test.ts`

**Interfaces:**
- Consumes: `createSimulation`, `EngineState` from `src/engine`; `getLesson`, `LESSONS` from `src/lessons/registry`
- Produces:
  - `useAppStore` — Zustand store with `{ lessonId, playing, speed, virtualTime, selectedNodeId, setLesson, play, pause, setSpeed, seek, selectNode }`
  - `useSimulation(): { state: EngineState; issues: ValidationIssue[]; stepOnce(): void }`
  - Constant `SPEEDS = [0.25, 0.5, 1, 2, 4]`

**Semantics to implement:**
- The store holds only transport intent. The engine instance lives in a ref inside `useSimulation`, never in the store, so React never diffs a large mutable object.
- The rAF loop computes `virtualTime += frameDeltaMs * speed`, calls `advanceTo(virtualTime)`, and writes the snapshot into local state.
- `seek(t)` sets `virtualTime` and marks the simulation dirty. On the next frame, `useSimulation` sees the target time is behind the engine's `now`, calls `reset()`, and replays forward. This is the entire rewind implementation.
- Changing `lessonId` or `speed` never resets the simulation; changing `lessonId` rebuilds it.

- [ ] **Step 1: Write the failing store test**

`src/sim/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { SPEEDS, useAppStore } from './store'

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('starts paused on the first lesson at time zero', () => {
    const s = useAppStore.getState()
    expect(s.playing).toBe(false)
    expect(s.virtualTime).toBe(0)
    expect(s.lessonId).toBe('01-hello-world')
  })

  it('play and pause toggle the transport', () => {
    useAppStore.getState().play()
    expect(useAppStore.getState().playing).toBe(true)
    useAppStore.getState().pause()
    expect(useAppStore.getState().playing).toBe(false)
  })

  it('seek moves virtual time and bumps the replay token when going backwards', () => {
    useAppStore.getState().seek(5000)
    const forwardToken = useAppStore.getState().replayToken
    useAppStore.getState().seek(1000)
    expect(useAppStore.getState().virtualTime).toBe(1000)
    expect(useAppStore.getState().replayToken).toBe(forwardToken + 1)
  })

  it('changing lesson resets time, selection, and playback', () => {
    useAppStore.getState().play()
    useAppStore.getState().selectNode('q1')
    useAppStore.getState().seek(4000)
    useAppStore.getState().setLesson('01-hello-world')
    const s = useAppStore.getState()
    expect(s.virtualTime).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.selectedNodeId).toBeUndefined()
  })

  it('exposes an ascending speed ladder including 1x', () => {
    expect(SPEEDS).toContain(1)
    expect([...SPEEDS].sort((a, b) => a - b)).toEqual(SPEEDS)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/sim/store.test.ts`
Expected: FAIL, `Failed to resolve import "./store"`.

- [ ] **Step 3: Implement the store**

`src/sim/store.ts`:

```ts
import { create } from 'zustand'

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

export interface AppState {
  lessonId: string
  /** Set when the sandbox tab is active instead of a lesson. */
  sandbox: boolean
  playing: boolean
  speed: Speed
  virtualTime: number
  selectedNodeId?: string
  /** Incremented whenever the engine must be rebuilt and replayed. */
  replayToken: number
  setLesson(id: string): void
  openSandbox(): void
  play(): void
  pause(): void
  setSpeed(speed: Speed): void
  seek(virtualMs: number): void
  tickTo(virtualMs: number): void
  selectNode(id?: string): void
}

export const useAppStore = create<AppState>((set, get) => ({
  lessonId: '01-hello-world',
  sandbox: false,
  playing: false,
  speed: 1,
  virtualTime: 0,
  replayToken: 0,

  setLesson(id) {
    set((s) => ({
      lessonId: id,
      sandbox: false,
      playing: false,
      virtualTime: 0,
      selectedNodeId: undefined,
      replayToken: s.replayToken + 1,
    }))
  },

  openSandbox() {
    set((s) => ({ sandbox: true, playing: false, virtualTime: 0, replayToken: s.replayToken + 1 }))
  },

  play() {
    set({ playing: true })
  },

  pause() {
    set({ playing: false })
  },

  setSpeed(speed) {
    set({ speed })
  },

  seek(virtualMs) {
    const backwards = virtualMs < get().virtualTime
    set((s) => ({
      virtualTime: virtualMs,
      replayToken: backwards ? s.replayToken + 1 : s.replayToken,
    }))
  },

  tickTo(virtualMs) {
    set({ virtualTime: virtualMs })
  },

  selectNode(id) {
    set({ selectedNodeId: id })
  },
}))
```

- [ ] **Step 4: Implement the rAF binding**

`src/sim/useSimulation.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { createSimulation, type EngineState, type Simulation, type ValidationIssue } from '../engine'
import { getLesson } from '../lessons/registry'
import { useAppStore } from './store'

export interface SimulationView {
  state: EngineState
  issues: ValidationIssue[]
  stepOnce(): void
}

export function useSimulation(): SimulationView {
  const lessonId = useAppStore((s) => s.lessonId)
  const replayToken = useAppStore((s) => s.replayToken)
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const tickTo = useAppStore((s) => s.tickTo)

  const simRef = useRef<Simulation | null>(null)
  const [view, setView] = useState<SimulationView | null>(null)

  // Build (or rebuild) the engine. replayToken changes on seek-backwards and
  // lesson switches, which is exactly when a replay from zero is required.
  useEffect(() => {
    const lesson = getLesson(lessonId)
    if (!lesson) return
    const sim = createSimulation({
      topology: lesson.topology,
      script: lesson.script,
      failures: lesson.failures,
      seed: lesson.seed,
    })
    sim.advanceTo(useAppStore.getState().virtualTime)
    simRef.current = sim
    setView({ state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
  }, [lessonId, replayToken])

  // Advance on seek while paused, so scrubbing updates the canvas immediately.
  useEffect(() => {
    const sim = simRef.current
    if (!sim || playing) return
    sim.advanceTo(virtualTime)
    setView({ state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
  }, [virtualTime, playing])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()

    const loop = (now: number) => {
      const sim = simRef.current
      if (sim) {
        const deltaMs = Math.min(now - last, 100) * speed
        last = now
        const target = useAppStore.getState().virtualTime + deltaMs
        sim.advanceTo(target)
        tickTo(target)
        setView({ state: sim.snapshot(), issues: sim.issues, stepOnce: () => {} })
      } else {
        last = now
      }
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, tickTo])

  const stepOnce = () => {
    const sim = simRef.current
    if (!sim) return
    sim.stepOnce()
    tickTo(sim.snapshot().now)
    setView({ state: sim.snapshot(), issues: sim.issues, stepOnce })
  }

  const lesson = getLesson(lessonId)
  const fallback = createSimulation({
    topology: lesson?.topology ?? { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] },
    script: [],
    seed: 0,
  })

  return view
    ? { ...view, stepOnce }
    : { state: fallback.snapshot(), issues: fallback.issues, stepOnce }
}
```

- [ ] **Step 5: Run the store test**

Run: `npm test -- src/sim`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/sim
git commit -m "feat: add transport store and requestAnimationFrame simulation binding"
```

---

## Task 12: Canvas with React Flow node types

**Files:**
- Create: `src/ui/CanvasView/CanvasView.tsx`, `src/ui/CanvasView/nodes.tsx`, `src/ui/CanvasView/toFlow.ts`, `src/ui/CanvasView/toFlow.test.ts`
- Modify: `src/ui/App.tsx` — mount `CanvasView`

**Interfaces:**
- Consumes: `EngineState`, `Topology` from `src/engine`; `useAppStore` from `src/sim/store`
- Produces:
  - `toFlowNodes(topology: Topology, state: EngineState): Node[]`
  - `toFlowEdges(topology: Topology): Edge[]`
  - `nodeTypes` — React Flow node type map with `publisher`, `exchange`, `queue`, `consumer`

**Semantics to implement:**
- Edge ids must be `${source}->${target}`, matching `edgeId` in the engine, because `MessageLayer` looks edges up by that id.
- Queue nodes show live depth and a stack of up to eight message chips; beyond eight, a `+N` badge.
- Consumer nodes show `prefetch`, unacked count, and a dimmed, struck-through style when crashed.
- Node data is derived on every render from the snapshot. No animation state lives in React Flow.

- [ ] **Step 1: Write the failing conversion test**

`src/ui/CanvasView/toFlow.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/ui/CanvasView`
Expected: FAIL, `Failed to resolve import "./toFlow"`.

- [ ] **Step 3: Implement the conversion**

`src/ui/CanvasView/toFlow.ts`:

```ts
import type { Edge, Node } from '@xyflow/react'
import type { EngineState, Topology } from '../../engine'

export function toFlowNodes(topology: Topology, state: EngineState): Node[] {
  const publishers = topology.publishers.map<Node>((p) => ({
    id: p.id,
    type: 'publisher',
    position: p.position,
    data: { label: p.label },
  }))

  const exchanges = topology.exchanges.map<Node>((e) => ({
    id: e.id,
    type: 'exchange',
    position: e.position,
    data: { label: e.label, exchangeType: e.type },
  }))

  const queues = topology.queues.map<Node>((q) => ({
    id: q.id,
    type: 'queue',
    position: q.position,
    data: {
      label: q.label,
      depth: (state.queues[q.id] ?? []).length,
      messages: (state.queues[q.id] ?? []).slice(0, 8).map((m) => m.message.id),
      maxLength: q.maxLength,
      ttlMs: q.messageTtlMs,
      kind: q.kind,
    },
  }))

  const consumers = topology.consumers.map<Node>((c) => ({
    id: c.id,
    type: 'consumer',
    position: c.position,
    data: {
      label: c.label,
      prefetch: c.prefetch,
      unacked: (state.unacked[c.id] ?? []).length,
      autoAck: c.autoAck,
      crashed: state.crashed.includes(c.id),
    },
  }))

  return [...publishers, ...exchanges, ...queues, ...consumers]
}

function edge(source: string, target: string, label?: string, dashed = false): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    label,
    animated: false,
    style: dashed
      ? { stroke: '#f43f5e', strokeDasharray: '6 4' }
      : { stroke: '#475569' },
  }
}

export function toFlowEdges(topology: Topology): Edge[] {
  const edges: Edge[] = []

  // Publishers connect to every exchange a script could target; the topology
  // does not model that link explicitly, so connect each publisher to each exchange
  // that has at least one binding.
  for (const p of topology.publishers) {
    for (const e of topology.exchanges) {
      if (topology.bindings.some((b) => b.exchangeId === e.id)) edges.push(edge(p.id, e.id))
    }
  }

  for (const binding of topology.bindings) {
    edges.push(edge(binding.exchangeId, binding.destinationId, binding.routingKey))
  }

  for (const consumer of topology.consumers) {
    edges.push(edge(consumer.queueId, consumer.id))
  }

  for (const queue of topology.queues) {
    if (queue.deadLetterExchange) {
      edges.push(edge(queue.id, queue.deadLetterExchange, 'dead-letter', true))
    }
  }

  const seen = new Set<string>()
  return edges.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}
```

- [ ] **Step 4: Implement the node components**

`src/ui/CanvasView/nodes.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'rounded-lg border px-3 py-2 text-xs shadow-lg'

export function PublisherNode({ data, selected }: NodeProps) {
  return (
    <div className={`${SHELL} border-sky-500 bg-sky-950 ${selected ? 'ring-2 ring-sky-300' : ''}`}>
      <div className="font-semibold text-sky-200">{String(data.label)}</div>
      <div className="text-[10px] text-sky-400">publisher</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ExchangeNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-violet-500 bg-violet-950 ${selected ? 'ring-2 ring-violet-300' : ''}`}
      style={{ borderRadius: 999 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-violet-200">{String(data.label)}</div>
      <div className="text-[10px] text-violet-400">{String(data.exchangeType)} exchange</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function QueueNode({ data, selected }: NodeProps) {
  const depth = Number(data.depth)
  const messages = (data.messages as string[]) ?? []
  return (
    <div className={`${SHELL} border-emerald-500 bg-emerald-950 ${selected ? 'ring-2 ring-emerald-300' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className="font-semibold text-emerald-200">{String(data.label)}</span>
        <span className="rounded bg-emerald-800 px-1 text-[10px] text-emerald-100">{depth}</span>
      </div>
      <div className="mt-1 flex gap-[2px]">
        {messages.map((id) => (
          <span key={id} className="h-3 w-2 rounded-sm bg-emerald-400" title={id} />
        ))}
        {depth > messages.length && (
          <span className="ml-1 text-[10px] text-emerald-300">+{depth - messages.length}</span>
        )}
      </div>
      {data.ttlMs !== undefined && (
        <div className="text-[10px] text-amber-300">ttl {String(data.ttlMs)}ms</div>
      )}
      {data.maxLength !== undefined && (
        <div className="text-[10px] text-amber-300">max-length {String(data.maxLength)}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ConsumerNode({ data, selected }: NodeProps) {
  const crashed = Boolean(data.crashed)
  return (
    <div
      className={`${SHELL} border-amber-500 bg-amber-950 ${selected ? 'ring-2 ring-amber-300' : ''} ${
        crashed ? 'opacity-40 line-through' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-amber-200">{String(data.label)}</div>
      <div className="text-[10px] text-amber-400">
        prefetch {String(data.prefetch)} · unacked {String(data.unacked)}
        {data.autoAck ? ' · auto-ack' : ''}
      </div>
    </div>
  )
}

export const nodeTypes = {
  publisher: PublisherNode,
  exchange: ExchangeNode,
  queue: QueueNode,
  consumer: ConsumerNode,
}
```

- [ ] **Step 5: Implement the canvas**

`src/ui/CanvasView/CanvasView.tsx`:

```tsx
import { Background, Controls, ReactFlow, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import type { EngineState, Topology } from '../../engine'
import { useAppStore } from '../../sim/store'
import { MessageLayer } from '../canvas/MessageLayer'
import { nodeTypes } from './nodes'
import { toFlowEdges, toFlowNodes } from './toFlow'

export function CanvasView({ topology, state }: { topology: Topology; state: EngineState }) {
  const selectNode = useAppStore((s) => s.selectNode)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)

  const nodes = useMemo(
    () => toFlowNodes(topology, state).map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [topology, state, selectedNodeId],
  )
  const edges = useMemo(() => toFlowEdges(topology), [topology])

  return (
    <div className="relative h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(undefined)}
      >
        <Background color="#1e293b" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <MessageLayer state={state} />
    </div>
  )
}
```

- [ ] **Step 6: Run the conversion test**

Run: `npm test -- src/ui/CanvasView`
Expected: PASS, 4 tests. `MessageLayer` does not exist yet, so import it only after Task 13 — until then, stub it with `export function MessageLayer() { return null }` in `src/ui/canvas/MessageLayer.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/ui
git commit -m "feat: add react flow canvas with publisher, exchange, queue, and consumer nodes"
```

---

## Task 13: Message particle overlay

**Files:**
- Create: `src/ui/canvas/MessageLayer.tsx`, `src/ui/canvas/geometry.ts`, `src/ui/canvas/geometry.test.ts`

**Interfaces:**
- Consumes: `EngineState`, `InFlight` from `src/engine`
- Produces:
  - `progressOf(flight: InFlight, now: number): number` — clamped to `[0, 1]`
  - `pointOnPath(path: SVGPathElement, progress: number): { x: number; y: number }`
  - `MessageLayer({ state }: { state: EngineState })`

**Semantics to implement:**
- The overlay is an absolutely positioned `<svg>` above the React Flow pane with `pointer-events: none`.
- It reads each edge's rendered path with `document.querySelector('.react-flow__edge[data-id="..."] path')`, then uses `getTotalLength` and `getPointAtLength` to place the particle. Reading geometry from the DOM keeps a single source of truth for edge shape.
- Particle position is a pure function of `state.now`, so pausing freezes particles mid-edge with no extra code.
- The overlay must apply React Flow's current viewport transform, read from the `.react-flow__viewport` element's `transform` style, so particles stay glued to edges while panning and zooming.
- Tone maps to a fill colour: `sky` for published traffic, `emerald` for delivery, `rose` for dead-lettered, `amber` for RPC replies.

- [ ] **Step 1: Write the failing geometry test**

`src/ui/canvas/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { progressOf } from './geometry'
import type { InFlight } from '../../engine'

const flight = (fromT: number, toT: number): InFlight => ({
  messageId: 'm1',
  edgeId: 'a->b',
  fromT,
  toT,
  tone: 'sky',
})

describe('progressOf', () => {
  it('is 0 at the start of travel', () => {
    expect(progressOf(flight(1000, 1600), 1000)).toBe(0)
  })

  it('is 0.5 at the midpoint', () => {
    expect(progressOf(flight(1000, 1600), 1300)).toBeCloseTo(0.5)
  })

  it('is 1 at the end', () => {
    expect(progressOf(flight(1000, 1600), 1600)).toBe(1)
  })

  it('clamps before the start and after the end', () => {
    expect(progressOf(flight(1000, 1600), 500)).toBe(0)
    expect(progressOf(flight(1000, 1600), 9000)).toBe(1)
  })

  it('returns 1 for a zero-length interval instead of dividing by zero', () => {
    expect(progressOf(flight(1000, 1000), 1000)).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/ui/canvas/geometry.test.ts`
Expected: FAIL, `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Implement geometry**

`src/ui/canvas/geometry.ts`:

```ts
import type { InFlight } from '../../engine'

export function progressOf(flight: InFlight, now: number): number {
  const span = flight.toT - flight.fromT
  if (span <= 0) return 1
  const raw = (now - flight.fromT) / span
  return Math.min(1, Math.max(0, raw))
}

export function pointOnPath(path: SVGPathElement, progress: number): { x: number; y: number } {
  const length = path.getTotalLength()
  const point = path.getPointAtLength(length * progress)
  return { x: point.x, y: point.y }
}

export const TONE_FILL: Record<string, string> = {
  sky: '#38bdf8',
  emerald: '#34d399',
  rose: '#fb7185',
  amber: '#fbbf24',
}
```

- [ ] **Step 4: Implement the overlay**

Replace the stub at `src/ui/canvas/MessageLayer.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { EngineState } from '../../engine'
import { pointOnPath, progressOf, TONE_FILL } from './geometry'

interface Particle {
  key: string
  x: number
  y: number
  tone: string
}

/**
 * Draws in-flight messages above the React Flow pane. Positions are derived
 * from virtual time, so pause and rewind need no special handling here.
 */
export function MessageLayer({ state }: { state: EngineState }) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [transform, setTransform] = useState('none')

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    setTransform(viewport?.style.transform || 'none')

    const next: Particle[] = []
    for (const flight of state.inFlight) {
      const selector = `.react-flow__edge[data-id="${flight.edgeId}"] path.react-flow__edge-path`
      const path = document.querySelector<SVGPathElement>(selector)
      if (!path) continue
      const { x, y } = pointOnPath(path, progressOf(flight, state.now))
      next.push({ key: `${flight.messageId}@${flight.edgeId}`, x, y, tone: flight.tone })
    }
    setParticles(next)
  }, [state])

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-testid="message-layer"
    >
      <g style={{ transform, transformOrigin: '0 0' }}>
        {particles.map((p) => (
          <g key={p.key}>
            <circle cx={p.x} cy={p.y} r={9} fill={TONE_FILL[p.tone] ?? '#94a3b8'} opacity={0.25} />
            <circle cx={p.x} cy={p.y} r={5} fill={TONE_FILL[p.tone] ?? '#94a3b8'} />
          </g>
        ))}
      </g>
    </svg>
  )
}
```

- [ ] **Step 5: Run the geometry test**

Run: `npm test -- src/ui/canvas`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/ui/canvas
git commit -m "feat: add svg message particle overlay driven by virtual time"
```

---

## Task 14: Sidebar, transport, inspector, and app wiring

**Files:**
- Create: `src/ui/LessonSidebar/LessonSidebar.tsx`, `src/ui/Transport/Transport.tsx`, `src/ui/Inspector/Inspector.tsx`, `src/ui/Inspector/Markdown.tsx`, `src/ui/Inspector/activeStep.ts`, `src/ui/Inspector/activeStep.test.ts`, `src/ui/App.test.tsx`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `useSimulation` from `src/sim/useSimulation`; `useAppStore`, `SPEEDS` from `src/sim/store`; `LESSONS`, `LESSON_GROUPS`, `getLesson` from `src/lessons/registry`
- Produces:
  - `activeStepIndex(steps: NarrativeStep[], now: number): number`
  - `LessonSidebar()`, `Transport()`, `Inspector()`

**Semantics to implement:**
- `activeStepIndex` returns the index of the last step whose `at` is at or before `now`, and `0` when none has been reached.
- The inspector shows three stacked sections: the active narrative step, the selected node's configuration (or the lesson metrics when nothing is selected), and the last 40 journal entries newest-first.
- `Markdown` supports only what the lesson bodies use: `**bold**`, `` `code` ``, and paragraphs. Rendering a full Markdown library for three constructs is not worth the dependency.
- The transport bar shows a scrubber whose maximum is the lesson's `durationMs + 5000`, so there is room to watch the tail drain.

- [ ] **Step 1: Write the failing narrative-step test**

`src/ui/Inspector/activeStep.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { activeStepIndex } from './activeStep'
import type { NarrativeStep } from '../../lessons/types'

const steps: NarrativeStep[] = [
  { at: 0, title: 'a', body: '' },
  { at: 1200, title: 'b', body: '' },
  { at: 4000, title: 'c', body: '' },
]

describe('activeStepIndex', () => {
  it('picks the first step before anything has happened', () => {
    expect(activeStepIndex(steps, 0)).toBe(0)
  })

  it('picks the last step whose time has passed', () => {
    expect(activeStepIndex(steps, 1500)).toBe(1)
    expect(activeStepIndex(steps, 3999)).toBe(1)
    expect(activeStepIndex(steps, 4000)).toBe(2)
  })

  it('stays on the final step after the lesson ends', () => {
    expect(activeStepIndex(steps, 99_000)).toBe(2)
  })

  it('returns 0 for an empty narrative', () => {
    expect(activeStepIndex([], 5000)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/ui/Inspector`
Expected: FAIL, `Failed to resolve import "./activeStep"`.

- [ ] **Step 3: Implement the step selector**

`src/ui/Inspector/activeStep.ts`:

```ts
import type { NarrativeStep } from '../../lessons/types'

export function activeStepIndex(steps: readonly NarrativeStep[], now: number): number {
  let index = 0
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.at <= now) index = i
  }
  return index
}
```

- [ ] **Step 4: Implement the minimal markdown renderer**

`src/ui/Inspector/Markdown.tsx`:

```tsx
import { Fragment } from 'react'

/** Supports only the constructs lesson bodies use: **bold**, `code`, and paragraphs. */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((paragraph, pIndex) => (
        <p key={pIndex} className="mb-2 text-sm leading-relaxed text-slate-300">
          {paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((chunk, cIndex) => {
            if (chunk.startsWith('**') && chunk.endsWith('**')) {
              return (
                <strong key={cIndex} className="font-semibold text-slate-100">
                  {chunk.slice(2, -2)}
                </strong>
              )
            }
            if (chunk.startsWith('`') && chunk.endsWith('`')) {
              return (
                <code key={cIndex} className="rounded bg-slate-800 px-1 font-mono text-[12px] text-sky-300">
                  {chunk.slice(1, -1)}
                </code>
              )
            }
            return <Fragment key={cIndex}>{chunk}</Fragment>
          })}
        </p>
      ))}
    </>
  )
}
```

- [ ] **Step 5: Implement the sidebar**

`src/ui/LessonSidebar/LessonSidebar.tsx`:

```tsx
import { LESSON_GROUPS, lessonsByGroup } from '../../lessons/registry'
import { useAppStore } from '../../sim/store'

export function LessonSidebar() {
  const lessonId = useAppStore((s) => s.lessonId)
  const sandbox = useAppStore((s) => s.sandbox)
  const setLesson = useAppStore((s) => s.setLesson)
  const openSandbox = useAppStore((s) => s.openSandbox)

  return (
    <nav className="flex h-full flex-col overflow-y-auto" data-testid="lesson-sidebar">
      <div className="px-3 py-3 text-sm font-semibold text-slate-200">RabbitMQ Visualizer</div>
      {LESSON_GROUPS.map((group) => (
        <div key={group.id} className="mb-3">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">
            {group.label}
          </div>
          {lessonsByGroup(group.id).map((lesson) => (
            <button
              key={lesson.id}
              onClick={() => setLesson(lesson.id)}
              className={`block w-full px-3 py-1.5 text-left text-xs ${
                !sandbox && lesson.id === lessonId
                  ? 'bg-slate-800 text-sky-300'
                  : 'text-slate-400 hover:bg-slate-900'
              }`}
            >
              {lesson.title}
            </button>
          ))}
        </div>
      ))}
      <button
        onClick={openSandbox}
        className={`mt-auto border-t border-slate-800 px-3 py-2 text-left text-xs ${
          sandbox ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:bg-slate-900'
        }`}
      >
        Sandbox
      </button>
    </nav>
  )
}
```

- [ ] **Step 6: Implement the transport bar**

`src/ui/Transport/Transport.tsx`:

```tsx
import { SPEEDS, useAppStore, type Speed } from '../../sim/store'

export function Transport({ durationMs, onStep }: { durationMs: number; onStep(): void }) {
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const play = useAppStore((s) => s.play)
  const pause = useAppStore((s) => s.pause)
  const seek = useAppStore((s) => s.seek)
  const setSpeed = useAppStore((s) => s.setSpeed)

  const max = durationMs + 5000

  return (
    <div className="flex items-center gap-3 px-3 py-2" data-testid="transport">
      <button onClick={() => seek(0)} className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
        Restart
      </button>
      <button
        onClick={() => (playing ? pause() : play())}
        className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
        data-testid="play-pause"
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        onClick={() => {
          pause()
          onStep()
        }}
        className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
      >
        Step
      </button>

      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(virtualTime, max)}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 accent-sky-500"
        aria-label="scrub"
      />
      <span className="w-16 text-right font-mono text-[11px] text-slate-400">
        {(virtualTime / 1000).toFixed(1)}s
      </span>

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200"
        aria-label="speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 7: Implement the inspector**

`src/ui/Inspector/Inspector.tsx`:

```tsx
import type { EngineState, ValidationIssue } from '../../engine'
import type { Lesson } from '../../lessons/types'
import { useAppStore } from '../../sim/store'
import { activeStepIndex } from './activeStep'
import { Markdown } from './Markdown'

function NodeConfig({ lesson, state, nodeId }: { lesson: Lesson; state: EngineState; nodeId: string }) {
  const queue = lesson.topology.queues.find((q) => q.id === nodeId)
  const consumer = lesson.topology.consumers.find((c) => c.id === nodeId)
  const exchange = lesson.topology.exchanges.find((e) => e.id === nodeId)

  if (queue) {
    return (
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <dt>kind</dt><dd className="text-slate-200">{queue.kind}</dd>
        <dt>depth</dt><dd className="text-slate-200">{(state.queues[queue.id] ?? []).length}</dd>
        <dt>ttl</dt><dd className="text-slate-200">{queue.messageTtlMs ?? '—'}</dd>
        <dt>max-length</dt><dd className="text-slate-200">{queue.maxLength ?? '—'}</dd>
        <dt>dead-letter</dt><dd className="text-slate-200">{queue.deadLetterExchange ?? '—'}</dd>
        <dt>max-priority</dt><dd className="text-slate-200">{queue.maxPriority ?? '—'}</dd>
      </dl>
    )
  }

  if (consumer) {
    return (
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <dt>queue</dt><dd className="text-slate-200">{consumer.queueId}</dd>
        <dt>prefetch</dt><dd className="text-slate-200">{consumer.prefetch || 'unlimited'}</dd>
        <dt>ack mode</dt><dd className="text-slate-200">{consumer.autoAck ? 'auto' : 'manual'}</dd>
        <dt>unacked</dt><dd className="text-slate-200">{(state.unacked[consumer.id] ?? []).length}</dd>
        <dt>processing</dt><dd className="text-slate-200">{consumer.processingMs}ms</dd>
        <dt>nack rate</dt><dd className="text-slate-200">{consumer.nackRate}</dd>
      </dl>
    )
  }

  if (exchange) {
    const bindings = lesson.topology.bindings.filter((b) => b.exchangeId === exchange.id)
    return (
      <ul className="space-y-1 text-[11px] text-slate-400">
        <li>type: <span className="text-slate-200">{exchange.type}</span></li>
        {bindings.map((b) => (
          <li key={b.id}>
            <span className="font-mono text-sky-300">{b.routingKey ?? JSON.stringify(b.headers)}</span>
            {' → '}
            <span className="text-slate-200">{b.destinationId}</span>
          </li>
        ))}
      </ul>
    )
  }

  return <p className="text-[11px] text-slate-500">No configuration for this node.</p>
}

export function Inspector({
  lesson,
  state,
  issues,
}: {
  lesson: Lesson
  state: EngineState
  issues: ValidationIssue[]
}) {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const step = lesson.narrative[activeStepIndex(lesson.narrative, state.now)]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto" data-testid="inspector">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">{step?.title ?? lesson.title}</h2>
        <Markdown text={step?.body ?? lesson.summary} />
      </section>

      {issues.length > 0 && (
        <section className="rounded border border-rose-700 bg-rose-950 p-2">
          {issues.map((issue, i) => (
            <p key={i} className="text-[11px] text-rose-200">
              {issue.severity}: {issue.message}
            </p>
          ))}
        </section>
      )}

      {state.halted && (
        <p className="rounded border border-amber-700 bg-amber-950 p-2 text-[11px] text-amber-200">
          Run halted: {state.halted.reason}
        </p>
      )}

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          {selectedNodeId ? `Config · ${selectedNodeId}` : 'Metrics'}
        </h3>
        {selectedNodeId ? (
          <NodeConfig lesson={lesson} state={state} nodeId={selectedNodeId} />
        ) : (
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-400">
            {Object.entries(state.metrics).map(([key, value]) => (
              <div key={key} className="contents">
                <dt>{key}</dt>
                <dd className="text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="min-h-0 flex-1">
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Event log</h3>
        <ul className="space-y-0.5 font-mono text-[10px] text-slate-400">
          {state.journal
            .slice(-40)
            .reverse()
            .map((entry, i) => (
              <li key={i}>
                <span className="text-slate-600">{(entry.at / 1000).toFixed(1)}s </span>
                {entry.text}
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 8: Wire the app together**

`src/ui/App.tsx`:

```tsx
import { getLesson } from '../lessons/registry'
import { useAppStore } from '../sim/store'
import { useSimulation } from '../sim/useSimulation'
import { CanvasView } from './CanvasView/CanvasView'
import { Inspector } from './Inspector/Inspector'
import { LessonSidebar } from './LessonSidebar/LessonSidebar'
import { Transport } from './Transport/Transport'

export default function App() {
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = getLesson(lessonId)
  const { state, issues, stepOnce } = useSimulation()

  if (!lesson) return <div className="p-4 text-slate-200">Lesson not found.</div>

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800">
        <LessonSidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <CanvasView topology={lesson.topology} state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={lesson.durationMs} onStep={stepOnce} />
        </div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        <Inspector lesson={lesson} state={state} issues={issues} />
      </aside>
    </div>
  )
}
```

- [ ] **Step 9: Write the app smoke test**

`src/ui/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders all three columns with the first lesson selected', () => {
    render(<App />)
    expect(screen.getByTestId('lesson-sidebar')).toBeTruthy()
    expect(screen.getByTestId('canvas')).toBeTruthy()
    expect(screen.getByTestId('inspector')).toBeTruthy()
    expect(screen.getByText('Hello world')).toBeTruthy()
  })

  it('shows a play button in the transport bar', () => {
    render(<App />)
    expect(screen.getByTestId('play-pause').textContent).toBe('Play')
  })
})
```

Delete `src/smoke.test.ts` — this test supersedes it.

- [ ] **Step 10: Run the suite and the dev server**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run dev`, open the page, press Play.
Expected: four messages travel publisher → exchange → queue → consumer, the queue depth chip rises and falls, and the event log fills. Press Pause mid-flight and confirm a particle freezes on an edge. Drag the scrubber backwards and confirm the canvas rewinds.

- [ ] **Step 11: Commit**

```bash
git add src/ui src/sim
git commit -m "feat: add sidebar, transport, inspector, and app wiring"
```

---

## Task 15: Basics lessons 2 through 6

**Files:**
- Create: `src/lessons/02-direct.ts`, `src/lessons/03-fanout.ts`, `src/lessons/04-topic.ts`, `src/lessons/05-headers.ts`, `src/lessons/06-competing-consumers.ts`, `src/lessons/basics.test.ts`
- Modify: `src/lessons/registry.ts` — add all five to `LESSONS` in order

**Interfaces:**
- Consumes: the `Lesson` interface from `src/lessons/types.ts`
- Produces: `directExchange`, `fanoutExchange`, `topicExchange`, `headersExchange`, `competingConsumers`

Each lesson exports a `Lesson` with the same shape as `01-hello-world.ts`: a topology, a script,
three or four narrative steps, a seed, and a `durationMs`. Positions follow a left-to-right
column layout: publishers at `x: 40`, exchanges at `x: 260`, queues at `x: 480`, consumers at
`x: 700`, with rows 120px apart starting at `y: 60`.

**Lesson 2 — Direct exchange** (`id: '02-direct'`, seed 2, duration 10000)
- Exchange `ex` type `direct`. Queues `pay`, `ship`, `audit`.
- Bindings: `pay` key `payment`, `ship` key `shipping`, `audit` key `payment` (two queues sharing one key is the point).
- Consumers: one per queue, `prefetch: 1`, `processingMs: 700`, manual ack.
- Script at 0, 1200, 2400, 3600, 4800 alternating keys `payment`, `shipping`, `payment`, `refund`, `shipping`.
- The `refund` message is deliberately unroutable — the narrative names it and the metrics show `dropped: 1`.
- Narrative beats: exact-match routing; two queues on one key each get their own copy; an unmatched key is silently discarded, which is why `mandatory` and alternate exchanges exist.

**Lesson 3 — Fanout** (`id: '03-fanout'`, seed 3, duration 9000)
- Exchange `ex` type `fanout`. Queues `email`, `analytics`, `audit`, each with one consumer.
- Bindings carry routing keys `ignored-a`, `ignored-b`, `ignored-c` to demonstrate they are ignored.
- Script: three messages at 0, 2000, 4000 with routing key `whatever`.
- Narrative beats: every bound queue receives a copy; the routing key is not consulted; each queue owns its copy, so a slow consumer on one queue never slows the others.

**Lesson 4 — Topic** (`id: '04-topic'`, seed 4, duration 12000)
- Exchange `ex` type `topic`. Queues `eu-orders` (key `order.eu.*`), `all-orders` (key `order.#`), `created-only` (key `*.*.created`).
- Script keys in order: `order.eu.created`, `order.us.created`, `order.eu.cancelled`, `payment.eu.created`, `order`.
- Narrative beats: `*` is exactly one word; `#` is zero or more; `order` alone matches `order.#` but not `order.eu.*`; a message can land in several queues at once.

**Lesson 5 — Headers** (`id: '05-headers'`, seed 5, duration 10000)
- Exchange `ex` type `headers`. Queues `pdf-reports` (headers `{format: 'pdf', kind: 'report'}`, `xMatch: 'all'`), `anything-pdf` (headers `{format: 'pdf'}`, `xMatch: 'any'`), `csv-or-report` (headers `{format: 'csv', kind: 'report'}`, `xMatch: 'any'`).
- Script messages carry empty routing keys and headers `{format: 'pdf', kind: 'report'}`, `{format: 'pdf'}`, `{format: 'csv'}`, `{kind: 'invoice'}`.
- Narrative beats: routing keys are ignored entirely; `all` needs every header; `any` needs one; the last message matches nothing and is dropped.

**Lesson 6 — Competing consumers** (`id: '06-competing-consumers'`, seed 6, duration 14000)
- Exchange `ex` type `direct`, one queue `work` with key `job`, three consumers `fast` (`processingMs: 400`), `medium` (`900`), `slow` (`2000`), all `prefetch: 1`, manual ack.
- Script: nine messages at 300ms intervals starting at 0.
- Narrative beats: one queue with several consumers splits work rather than duplicating it; delivery rotates while consumers are free; a slow consumer receives fewer messages over time precisely because prefetch caps its outstanding work.

- [ ] **Step 1: Write the failing basics test**

`src/lessons/basics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { getLesson } from './registry'

function run(id: string) {
  const lesson = getLesson(id)!
  const sim = createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  sim.advanceTo(lesson.durationMs + 20_000)
  return sim.snapshot()
}

describe('02 direct exchange', () => {
  it('delivers each key only to its bound queues and drops the unroutable one', () => {
    const state = run('02-direct')
    expect(state.metrics.dropped).toBe(1)
    expect(state.metrics.acked).toBe(6) // 2 payment x 2 queues + 2 shipping x 1 queue
  })
})

describe('03 fanout exchange', () => {
  it('copies every message to all three queues', () => {
    const state = run('03-fanout')
    expect(state.metrics.published).toBe(3)
    expect(state.metrics.acked).toBe(9)
    expect(state.metrics.dropped).toBe(0)
  })
})

describe('04 topic exchange', () => {
  it('matches * as one word and # as zero or more', () => {
    const state = run('04-topic')
    // order.eu.created -> eu-orders, all-orders, created-only  (3)
    // order.us.created -> all-orders, created-only             (2)
    // order.eu.cancelled -> eu-orders, all-orders              (2)
    // payment.eu.created -> created-only                       (1)
    // order -> all-orders                                      (1)
    expect(state.metrics.acked).toBe(9)
    expect(state.metrics.dropped).toBe(0)
  })
})

describe('05 headers exchange', () => {
  it('honours x-match all versus any and drops an unmatched message', () => {
    const state = run('05-headers')
    expect(state.metrics.dropped).toBe(1)
    expect(state.metrics.acked).toBeGreaterThan(0)
  })
})

describe('06 competing consumers', () => {
  it('splits nine messages across three consumers without duplication', () => {
    const state = run('06-competing-consumers')
    expect(state.metrics.published).toBe(9)
    expect(state.metrics.acked).toBe(9)
  })

  it('gives the fast consumer more work than the slow one', () => {
    const lesson = getLesson('06-competing-consumers')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 20_000)
    const journal = sim.snapshot().journal
    const acksBy = (id: string) => journal.filter((j) => j.type === 'ack' && j.nodeId === id).length
    expect(acksBy('fast')).toBeGreaterThan(acksBy('slow'))
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/lessons/basics.test.ts`
Expected: FAIL, `getLesson('02-direct')` returns undefined.

- [ ] **Step 3: Write the five lesson files and register them**

Follow the specifications above. Use `01-hello-world.ts` as the structural template.
Add to `src/lessons/registry.ts`:

```ts
import { helloWorld } from './01-hello-world'
import { directExchange } from './02-direct'
import { fanoutExchange } from './03-fanout'
import { topicExchange } from './04-topic'
import { headersExchange } from './05-headers'
import { competingConsumers } from './06-competing-consumers'

export const LESSONS: Lesson[] = [
  helloWorld,
  directExchange,
  fanoutExchange,
  topicExchange,
  headersExchange,
  competingConsumers,
]
```

- [ ] **Step 4: Run the lesson tests**

Run: `npm test -- src/lessons`
Expected: PASS. If an ack count is off, read the journal to see which binding matched — the
comment block in the topic test lists the expected fan-out per message.

- [ ] **Step 5: Verify visually**

Run: `npm run dev`, open each of lessons 2 through 6, press Play.
Expected: the fanout lesson shows one particle splitting into three at the exchange; the
competing-consumers lesson shows the slow consumer holding one message while the fast one
cycles several times.

- [ ] **Step 6: Commit**

```bash
git add src/lessons
git commit -m "feat: add basics lessons for direct, fanout, topic, headers, and competing consumers"
```

---

## Task 15b: Vietnamese localization of shipped copy

The Global Constraints now require all reader-facing copy to be Vietnamese with RabbitMQ
and programming terms left in English. Lessons 1-6 and the UI chrome were written in
English before that constraint existed. This task retranslates them and adds the guard
that keeps Tasks 16-19 honest. **No behaviour changes**: only string literals move.

**Files:**
- Modify: `src/lessons/01-hello-world.ts`, `src/lessons/02-direct.ts`, `src/lessons/03-fanout.ts`, `src/lessons/04-topic.ts`, `src/lessons/05-headers.ts`, `src/lessons/06-competing-consumers.ts`
- Modify: `src/lessons/registry.ts` (the `LESSON_GROUPS` labels only)
- Modify: `src/ui/LessonSidebar/LessonSidebar.tsx`, `src/ui/Transport/Transport.tsx`, `src/ui/Inspector/Inspector.tsx`, `src/ui/App.tsx`
- Create: `src/lessons/language.test.ts`
- Do NOT touch: `src/engine/**` (its journal text is asserted on by tests and is not
  presentation), `src/lessons/__snapshots__/` beyond the regeneration Step 4 requires.

**Interfaces:**
- Consumes: `LESSONS` from `src/lessons/registry`
- Produces: nothing new. Every lesson id, node id, `data-testid`, and `aria-label` value
  keeps its exact current string — those are selectors, not copy.

**What stays English inside Vietnamese prose.** Copy the term list from Global
Constraints. In particular a sentence reads like: `Exchange kiểu *fanout* sao chép mọi
message tới tất cả queue đã bind, bỏ qua routing key.` — Vietnamese connective tissue,
English nouns.

**Translation rules:**
1. Never translate anything inside backticks. `` `order.eu.*` ``, `` `x-match` ``,
   `` `prefetch: 1` `` stay byte-identical.
2. Keep the existing markdown structure: same number of narrative steps, same `at`
   values, same `highlight` arrays, same paragraph breaks, same bold/italic/code spans in
   the same places. Only the human-language words change.
3. `LESSON_GROUPS` labels become: `basics` → `Cơ bản`, `reliability` → `Độ tin cậy`,
   `dlx` → `Dead-letter & retry`, `patterns` → `Pattern nâng cao`.
4. UI strings: `Restart` → `Chạy lại`, `Play` → `Chạy`, `Pause` → `Tạm dừng`,
   `Step` → `Bước`, `Sandbox (coming soon)` → `Sandbox (sắp có)`, `Metrics` → `Chỉ số`,
   `Event log` → `Nhật ký sự kiện`, `Config · <id>` → `Cấu hình · <id>`,
   `No configuration for this node.` → `Node này không có cấu hình.`,
   `Lesson not found.` → `Không tìm thấy bài học.`,
   `Run halted: <reason>` → `Đã dừng: <reason>` (the reason itself comes from the engine
   and stays English), `unlimited` in the prefetch row → `không giới hạn`.
   The sidebar heading `RabbitMQ Visualizer` is a product name — leave it.
   The `NodeConfig` `<dt>` labels (`kind`, `depth`, `ttl`, `max-length`, `dead-letter`,
   `max-priority`, `queue`, `prefetch`, `ack mode`, `unacked`, `processing`, `nack rate`)
   are AMQP property names — leave them English. Same for the `Object.entries(state.metrics)`
   keys, which come from the engine.
   `aria-label="scrub"` and `aria-label="speed"` are test selectors — leave them.

- [ ] **Step 1: Write the failing language guard**

`src/lessons/language.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LESSONS, LESSON_GROUPS } from './registry'

/** Any Vietnamese letter carrying a diacritic. */
const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i

/**
 * Untranslated English prose reveals itself through function words that have no
 * Vietnamese homograph. Checked outside code spans, because a lesson may legitimately
 * quote English inside backticks.
 */
const ENGLISH_FUNCTION_WORDS = /\b(the|and|with|that|which|from|into|because|however)\b/i

function stripCode(text: string): string {
  return text.replace(/`[^`]*`/g, ' ')
}

describe('reader-facing copy is Vietnamese', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s', (_id, lesson) => {
    // Prose, not individual titles: a title like "Fanout exchange" is legitimately all
    // English terms, so requiring a diacritic per title would distort the copy. Bodies
    // are full sentences and always carry Vietnamese connective tissue.
    const prose = lesson.narrative.map((s) => s.body).join('\n')
    expect(prose).toMatch(VIETNAMESE)
    expect(lesson.summary).toMatch(VIETNAMESE)
    expect(stripCode(lesson.summary), `${lesson.id} summary`).not.toMatch(
      ENGLISH_FUNCTION_WORDS,
    )

    // Each body individually, not just the joined blob: one Vietnamese word in step 1
    // must not vouch for three untranslated steps after it.
    for (const step of lesson.narrative) {
      expect(step.body, `${lesson.id} @${step.at} body`).toMatch(VIETNAMESE)
    }

    for (const step of lesson.narrative) {
      expect(stripCode(step.body), `${lesson.id} @${step.at} body`).not.toMatch(
        ENGLISH_FUNCTION_WORDS,
      )
      expect(stripCode(step.title), `${lesson.id} @${step.at} title`).not.toMatch(
        ENGLISH_FUNCTION_WORDS,
      )
    }

    for (const cp of lesson.checkpoints ?? []) {
      expect(cp.question).toMatch(VIETNAMESE)
      expect(cp.explanation).toMatch(VIETNAMESE)
      for (const text of [cp.question, cp.explanation, ...cp.options]) {
        expect(stripCode(text), `${lesson.id} checkpoint: ${text}`).not.toMatch(
          ENGLISH_FUNCTION_WORDS,
        )
      }
      // Options are short and may legitimately be a bare term ("Fanout exchange"), so
      // they are held to the forbidden-word rule but not to the diacritic rule.
    }
  })

  it('labels the lesson groups in Vietnamese', () => {
    // 'Dead-letter & retry' is a term, not prose, so it is exempt from the diacritic
    // rule; the others must carry one.
    const labels = LESSON_GROUPS.map((g) => g.label)
    expect(labels).toContain('Cơ bản')
    expect(labels).toContain('Độ tin cậy')
    expect(labels).toContain('Pattern nâng cao')
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/lessons/language.test.ts`
Expected: FAIL on every lesson — the bodies are English and contain `the`/`and`.

- [ ] **Step 3: Translate the six lesson files and the group labels**

Rewrite the `summary` and every `narrative` step's `title` and `body` (and any
`checkpoints`, including their `options`) in Vietnamese per the rules above. Leave the
lesson-level `title` in English per the exemption in Global Constraints, and leave
`topology`, `script`, `seed`, `durationMs`, `at`, and `highlight` byte-identical.

- [ ] **Step 4: Run the full suite and refresh snapshots deliberately**

Run: `npm test`
`src/lessons/__snapshots__/` may hold lesson copy. If a snapshot fails, **read the diff
first** and confirm the only change is human-language wording — a changed node id, `at`,
or journal line means the translation touched behaviour and must be reverted. Then
`npm test -- -u` and commit the regenerated snapshot alongside.

Also run `npm run typecheck` (bare `tsc --noEmit` is a no-op in this repo — the root
`tsconfig.json` is references-only).

- [ ] **Step 5: Translate the UI strings**

Apply the Step-4 string table in `LessonSidebar.tsx`, `Transport.tsx`, `Inspector.tsx`,
and `App.tsx`. Run `npm test` again: existing UI tests select by `data-testid` and
`aria-label`, both unchanged, so they must stay green. If a UI test asserts on English
button text, update that assertion to the Vietnamese string — that is the test tracking
the product, not the product bending to the test.

- [ ] **Step 6: Verify visually**

Run `npm run dev`, open lessons 1 and 4. Expected: sidebar groups read `Cơ bản` /
`Độ tin cậy` / `Dead-letter & retry` / `Pattern nâng cao`, transport reads
`Chạy lại` / `Chạy` / `Bước`, and the inspector narrative is Vietnamese prose with
`order.eu.*` still rendered as a code span.

- [ ] **Step 7: Commit**

```bash
git add src/lessons src/ui
git commit -m "feat: translate lesson and UI copy to Vietnamese"
```

---

## Task 16b: A crash must cancel the work it interrupted

**This is a correctness bug found while reviewing Task 16, confirmed by measurement.**

`applyDeliver` schedules a `consumeDone` event `processingMs` into the future.
`applyConsumerCrash` clears the consumer's `unacked` and requeues the held messages, but
nothing cancels that pending `consumeDone`. It fires anyway, `applyConsumeDone` schedules
an `ack`, and `applyAck` increments `metrics.acked` and writes an ack line to the journal —
for work that was never finished.

Measured on lesson 07 at commit `9881e26`:

```
auto:   [m1, m2, m3, m4]
manual: [m1, m1, m2, m3, m4]     <- m1 acked twice
metrics: published 4, delivered 9, acked 9
```

`m1` is requeued by the crash, redelivered after recovery, and acked a second time. Two
consequences, both bad:

1. **The lesson teaches the wrong thing.** The auto-ack lane acks all four messages despite
   being crashed from t=2000 to t=6000, so the "auto-ack loses the message" claim in the
   narrative is a log string with nothing behind it. The manual lane's recovery is
   indistinguishable from a double-count.
2. **Lesson 07's test passes because of the bug.** `reliability.test.ts` asserts
   `manualAcks > autoAcks`, which today reads `5 > 4`. The extra ack IS the duplicate.

**Files:**
- Modify: `src/engine/types.ts` (add `crashEpoch` to `EngineState`), `src/engine/broker.ts` (initial state), `src/engine/delivery.ts` (`applyDeliver`, `applyConsumeDone`), `src/engine/advanced.ts` (`applyConsumerCrash`)
- Modify: `src/lessons/reliability.test.ts` (strengthen the lesson 07 assertions)
- Test: `src/engine/delivery.test.ts`

**Interfaces:**
- Produces: `EngineState.crashEpoch: Record<NodeId, number>`

**Why an epoch and not a `crashed` check.** Reading `state.crashed` inside
`applyConsumeDone` looks simpler, but it is wrong whenever a consumer crashes and recovers
strictly inside one processing window — the consumer is no longer crashed when the stale
event lands, so the stale ack goes through. The epoch is stamped at dispatch and compared
on arrival, so it is exact regardless of recovery timing.

- [ ] **Step 1: Write the failing engine test**

Append to `src/engine/delivery.test.ts` (match the file's existing helpers for building a
topology and running a simulation — read it first rather than inventing new ones):

```ts
describe('a crash cancels the work it interrupted', () => {
  it('does not ack a message whose processing was interrupted by a crash', () => {
    // One manual-ack consumer, processingMs long enough that the crash lands mid-work.
    const sim = createSimulation({
      topology: /* one publisher -> direct ex -> one queue -> one manual consumer,
                   processingMs: 1000 */,
      script: [{ at: 0, kind: 'publish', publisherId: 'p1', routingKey: 'k' }],
      failures: [
        { at: 500, consumerId: 'c1', kind: 'crash' },
        { at: 3000, consumerId: 'c1', kind: 'recover' },
      ],
      seed: 1,
    })
    sim.advanceTo(20_000)
    const state = sim.snapshot()

    const acked = state.journal.filter((j) => j.type === 'ack').map((j) => j.messageId)
    // Exactly one ack: the redelivery after recovery. The interrupted attempt must
    // produce none, or the same message is confirmed twice.
    expect(acked).toEqual(['m1'])
    expect(state.metrics.acked).toBe(1)
  })

  it('does not ack an auto-ack consumer whose work the crash destroyed', () => {
    const sim = createSimulation({
      topology: /* same, but the consumer has autoAck: true */,
      script: [{ at: 0, kind: 'publish', publisherId: 'p1', routingKey: 'k' }],
      failures: [{ at: 500, consumerId: 'c1', kind: 'crash' }],
      seed: 1,
    })
    sim.advanceTo(20_000)
    const state = sim.snapshot()

    // Auto-ack removes the message from the broker at dispatch, so nothing is requeued
    // and nothing is redelivered: the work is simply gone. An ack here would claim the
    // message was handled.
    expect(state.metrics.acked).toBe(0)
    expect(state.queues.q1).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/delivery.test.ts`
Expected: FAIL. The first case reports `['m1', 'm1']`; the second reports `acked` 1, not 0.

- [ ] **Step 3: Add the epoch to engine state**

In `src/engine/types.ts`, inside `EngineState`:

```ts
  /**
   * Per-consumer crash counter, incremented on every crash. A `consumeDone` event is
   * stamped with the epoch that was current when the message was delivered, and is
   * discarded on arrival if the epoch has moved: the work it represents was destroyed
   * by a crash. Reading `crashed` instead would miss a consumer that crashed and
   * recovered inside one processing window.
   */
  crashEpoch: Record<NodeId, number>
```

In `src/engine/broker.ts`'s initial state, beside `crashed: []`:

```ts
    crashEpoch: {},
```

- [ ] **Step 4: Stamp and check the epoch**

In `src/engine/delivery.ts`, `applyDeliver` schedules `consumeDone` — add the epoch to the
payload:

```ts
  const [doneEvent, afterSchedule] = scheduleEvent(
    next,
    state.now + consumer.processingMs + jitter,
    'consumeDone',
    { message, queueId, consumerId, epoch: state.crashEpoch[consumerId] ?? 0 },
  )
```

At the top of `applyConsumeDone`, after resolving `consumer`:

```ts
  // The consumer crashed while this message was being processed. The crash already
  // requeued it (manual ack) or destroyed it (auto ack); acking now would confirm work
  // that never finished, and on the manual path would confirm the same message twice.
  const epoch = (event.payload.epoch as number) ?? 0
  if (epoch !== (state.crashEpoch[consumerId] ?? 0)) return { state, newEvents: [] }
```

In `src/engine/advanced.ts`, `applyConsumerCrash` bumps it in the same object literal that
sets `crashed`:

```ts
    crashEpoch: { ...state.crashEpoch, [consumerId]: (state.crashEpoch[consumerId] ?? 0) + 1 },
```

Do NOT reset the epoch on recover — it must only ever increase, or a crash/recover pair
would restore a stale event's validity.

- [ ] **Step 5: Run the engine suite**

Run: `npm test -- src/engine` and `npm run typecheck`
Expected: PASS, including the two new cases.

- [ ] **Step 6: Re-measure lesson 07 and strengthen its assertions**

The old assertion `manualAcks > autoAcks` cannot stay as the only check — it passed on the
duplicate. Replace the lesson 07 block in `src/lessons/reliability.test.ts`:

```ts
describe('07 ack modes', () => {
  it('recovers the interrupted message on the manual lane and loses it on the auto lane', () => {
    const state = run('07-ack-modes')
    const acksBy = (id: string) =>
      state.journal.filter((j) => j.type === 'ack' && j.nodeId === id).map((j) => j.messageId)

    const manual = acksBy('manual')
    const auto = acksBy('auto')

    // The whole point of manual ack: every message is confirmed, and confirmed once.
    // A duplicate here means a crash failed to cancel the work it interrupted.
    expect(new Set(manual).size).toBe(manual.length)
    expect(manual.length).toBeGreaterThan(auto.length)
    // The auto lane was crashed for most of the run and cannot have confirmed
    // everything the manual lane did.
    expect(auto.length).toBeLessThan(state.script?.length ?? 4)
  })
})
```

If `state.script` is not on `EngineState`, drop that last line and hard-code `4` — read the
type rather than guessing.

- [ ] **Step 7: Re-read lesson 07's narrative against the new behaviour**

`src/lessons/07-ack-modes.ts` was written against the buggy engine. Read every narrative
body and confirm it now describes what actually happens — in particular any sentence
claiming the auto lane confirmed or lost a specific number of messages. Fix the Vietnamese
copy where it disagrees with the run. Do not change `at`, `highlight`, `seed`, `durationMs`,
`topology`, or `script`.

- [ ] **Step 8: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: PASS. If another lesson's assertion moves, that lesson was also reading the
duplicate — report which, do not loosen the assertion to make it pass.

- [ ] **Step 9: Commit**

```bash
git add src/engine src/lessons
git commit -m "fix: a consumer crash cancels the processing it interrupted"
```

---

## Task 15c: Dark toolbar, message labels, and the live in-flight panel

Three gaps a reader hits immediately. React Flow's `<Controls />` ships with a white
button strip that glares against the slate-950 canvas. In-flight particles are anonymous
dots, so a reader watching a fanout cannot tell which copy is which. And there is nowhere
to read what is on the wire *right now* — the event log is a scrolling history, not a
live state view.

**The enabling change is in the engine.** `InFlight` carries only `messageId`, but an
in-flight message has been removed from its queue and is not yet in `unacked`, so nothing
in `EngineState` can resolve that id back to a message. This is the identical defect
already fixed for `unacked`: the record must carry the whole message, because it is the
only copy. Without it the panel cannot show a routing key, a priority, or a redelivery
count.

**Files:**
- Modify: `src/engine/types.ts` (the `InFlight` interface), `src/engine/broker.ts` (`addInFlight`, `clearInFlight`), `src/engine/delivery.ts`, `src/engine/dlx.ts` (call sites only)
- Modify: `src/index.css` (React Flow dark theme overrides)
- Modify: `src/ui/canvas/MessageLayer.tsx` (particle labels)
- Modify: `src/ui/App.tsx` (mount the panel between canvas and transport)
- Create: `src/ui/canvas/InFlightPanel.tsx`, `src/ui/canvas/InFlightPanel.test.tsx`
- Test: `src/engine/broker.test.ts` (existing, must stay green)

**Interfaces:**
- Consumes: `progressOf` and `TONE_FILL` from `src/ui/canvas/geometry`
- Produces: `InFlight.message: Message` replacing `InFlight.messageId`; `<InFlightPanel state={state} />`

- [ ] **Step 1: Widen `InFlight` to carry the message**

In `src/engine/types.ts`, replace the `messageId` field:

```ts
/** A message currently animating along an edge. */
export interface InFlight {
  /**
   * The whole message, not its id. An in-flight message has already been removed
   * from its queue and has not yet landed in `unacked`, so this record is the ONLY
   * copy — the same reason `unacked` stores messages. The in-flight panel reads the
   * routing key, priority, and redelivery count from here; there is nowhere else in
   * `EngineState` to look them up while the message is on the wire.
   */
  message: Message
  edgeId: string
  fromT: number
  toT: number
  /** Colour class chosen by the lesson to distinguish streams. */
  tone: string
}
```

In `src/engine/broker.ts`, take the message instead of the id and store it. `clearInFlight`
keeps taking an id — it only filters:

```ts
export function addInFlight(
  state: EngineState,
  message: Message,
  from: NodeId,
  to: NodeId,
  tone: string,
): EngineState {
  return {
    ...state,
    inFlight: [
      ...state.inFlight,
      { message, edgeId: edgeId(from, to), fromT: state.now, toT: state.now + TRAVEL_MS, tone },
    ],
  }
}

export function clearInFlight(state: EngineState, messageId: string, edge: string): EngineState {
  return {
    ...state,
    inFlight: state.inFlight.filter((f) => !(f.message.id === messageId && f.edgeId === edge)),
  }
}
```

All four `addInFlight` call sites (`broker.ts:123`, `broker.ts:176`, `delivery.ts:48`,
`dlx.ts:56`) already hold `message` in scope: change `message.id` to `message`. Leave every
`clearInFlight` call unchanged.

`src/engine/advanced.ts` filters `inFlight` by `edgeId` only and needs no change.

- [ ] **Step 2: Run the engine suite**

Run: `npm test -- src/engine` and `npm run typecheck`
Expected: PASS. The compiler finds every remaining `flight.messageId` for you — that is
the point of replacing the field rather than adding one beside it.

- [ ] **Step 3: Dark-theme the React Flow chrome**

Append to `src/index.css`. React Flow's controls and minimap are styled by its own
stylesheet, which `CanvasView.tsx` imports; these rules override it:

```css
/* React Flow ships a light control strip. Match the slate-950 canvas instead. */
.react-flow__controls {
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
}

.react-flow__controls-button {
  background: #1e293b;
  border-bottom: 1px solid #334155;
  fill: #cbd5e1;
}

.react-flow__controls-button:hover {
  background: #334155;
  fill: #f1f5f9;
}

.react-flow__controls-button:disabled {
  fill: #475569;
}

.react-flow__attribution {
  background: transparent;
  color: #475569;
}
```

- [ ] **Step 4: Label the particles**

In `src/ui/canvas/MessageLayer.tsx`, carry the label through the `Particle` shape and draw
it above the dot. The label is the message id (`m1`, `m2`, …) — short enough not to collide
at speed, and the same id the panel lists, so the reader can match canvas to table.

```tsx
interface Particle {
  key: string
  x: number
  y: number
  tone: string
  label: string
}
```

In the layout effect, build it from the message and keep the key stable:

```tsx
next.push({
  key: `${flight.message.id}@${flight.edgeId}`,
  x,
  y,
  tone: flight.tone,
  label: flight.message.id,
})
```

And in the render, add the label above each dot. `paintOrder="stroke"` with a dark stroke
gives the text a halo so it stays readable over an edge line:

```tsx
<text
  x={p.x}
  y={p.y - 13}
  textAnchor="middle"
  className="font-mono"
  fontSize={10}
  fill={TONE_FILL[p.tone] ?? '#94a3b8'}
  stroke="#020617"
  strokeWidth={3}
  paintOrder="stroke"
>
  {p.label}
</text>
```

- [ ] **Step 5: Write the failing panel test**

`src/ui/canvas/InFlightPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EngineState, InFlight, Message } from '../../engine'
import { InFlightPanel } from './InFlightPanel'

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    body: 'hello',
    routingKey: 'order.created',
    headers: {},
    priority: 0,
    publishedAt: 0,
    redeliveryCount: 0,
    deathTrail: [],
    persistent: false,
    ...over,
  }
}

function flight(over: Partial<InFlight> = {}): InFlight {
  return { message: message(), edgeId: 'ex->orders', fromT: 0, toT: 1000, tone: 'sky', ...over }
}

function state(inFlight: InFlight[], now = 500): EngineState {
  return { now, inFlight } as unknown as EngineState
}

describe('InFlightPanel', () => {
  it('shows an empty state when nothing is on the wire', () => {
    render(<InFlightPanel state={state([])} />)
    expect(screen.getByTestId('inflight-empty')).toBeTruthy()
    expect(screen.queryByTestId('inflight-row')).toBeNull()
  })

  it('lists each in-flight message with its route and routing key', () => {
    render(<InFlightPanel state={state([flight()])} />)
    const row = screen.getByTestId('inflight-row')
    expect(row.textContent).toContain('m1')
    expect(row.textContent).toContain('ex')
    expect(row.textContent).toContain('orders')
    expect(row.textContent).toContain('order.created')
  })

  it('reports progress from virtual time, not wall-clock', () => {
    // Half-way between fromT and toT at now=500 of a 0..1000 flight.
    render(<InFlightPanel state={state([flight()], 500)} />)
    expect(screen.getByTestId('inflight-progress').getAttribute('aria-valuenow')).toBe('50')
    // Same flight, later virtual time: the bar must move without any timer firing.
    render(<InFlightPanel state={state([flight()], 900)} />)
    expect(screen.getAllByTestId('inflight-progress')[1]!.getAttribute('aria-valuenow')).toBe('90')
  })

  it('badges redelivery, priority, and persistence only when they are set', () => {
    render(
      <InFlightPanel
        state={state([flight({ message: message({ redeliveryCount: 2, priority: 5, persistent: true }) })])}
      />,
    )
    const row = screen.getByTestId('inflight-row')
    expect(row.textContent).toContain('redelivery 2')
    expect(row.textContent).toContain('priority 5')
    expect(row.textContent).toContain('persistent')
  })

  it('omits the badges on a plain message', () => {
    render(<InFlightPanel state={state([flight()])} />)
    const row = screen.getByTestId('inflight-row')
    expect(row.textContent).not.toContain('redelivery')
    expect(row.textContent).not.toContain('priority')
    expect(row.textContent).not.toContain('persistent')
  })

  it('orders rows by departure time so a landing message does not reshuffle the rest', () => {
    const older = flight({ message: message({ id: 'm1' }), fromT: 0 })
    const newer = flight({ message: message({ id: 'm2' }), fromT: 400, edgeId: 'ex->audit' })
    // Deliberately supplied newest-first: the panel must not trust array order.
    render(<InFlightPanel state={state([newer, older], 500)} />)
    const ids = screen.getAllByTestId('inflight-row').map((r) => r.getAttribute('data-message-id'))
    expect(ids).toEqual(['m1', 'm2'])
  })
})
```

- [ ] **Step 6: Run it to confirm failure**

Run: `npm test -- src/ui/canvas/InFlightPanel.test.tsx`
Expected: FAIL, cannot resolve `./InFlightPanel`.

- [ ] **Step 7: Write the panel**

`src/ui/canvas/InFlightPanel.tsx`. It is a presentational read of `state` — no store access,
no effects, no timers. Progress comes from virtual time via `progressOf`, exactly like the
particles, so pause, step, and rewind need no handling here.

```tsx
import type { EngineState } from '../../engine'
import { progressOf, TONE_FILL } from './geometry'

/** `edgeId` is minted as `${from}->${to}`; the panel is the only place that reads it back. */
function routeOf(edgeId: string): [string, string] {
  const [from = edgeId, to = ''] = edgeId.split('->')
  return [from, to]
}

export function InFlightPanel({ state }: { state: EngineState }) {
  // Sorted by departure, not array order: rows must not jump when a message lands.
  const flights = [...state.inFlight].sort(
    (a, b) => a.fromT - b.fromT || a.message.id.localeCompare(b.message.id),
  )

  return (
    <div className="max-h-32 overflow-y-auto px-3 py-2" data-testid="inflight-panel">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Message đang bay</h3>
        <span className="font-mono text-[10px] text-slate-600">{flights.length}</span>
      </div>

      {flights.length === 0 ? (
        <p className="text-[11px] text-slate-600" data-testid="inflight-empty">
          Không có message nào trên đường truyền.
        </p>
      ) : (
        <ul className="space-y-1">
          {flights.map((f) => {
            const [from, to] = routeOf(f.edgeId)
            const pct = Math.round(progressOf(f, state.now) * 100)
            const colour = TONE_FILL[f.tone] ?? '#94a3b8'
            return (
              <li
                key={`${f.message.id}@${f.edgeId}`}
                data-testid="inflight-row"
                data-message-id={f.message.id}
                className="flex items-center gap-2 text-[11px]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                <span className="w-8 shrink-0 font-mono text-slate-200">{f.message.id}</span>
                <span className="w-40 shrink-0 truncate font-mono text-slate-400">
                  {from} <span className="text-slate-600">{'->'}</span> {to}
                </span>
                <span className="w-36 shrink-0 truncate font-mono text-sky-300">
                  {f.message.routingKey || '—'}
                </span>
                <span
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  data-testid="inflight-progress"
                  className="h-1.5 min-w-16 flex-1 overflow-hidden rounded bg-slate-800"
                >
                  <span
                    className="block h-full rounded"
                    style={{ width: `${pct}%`, backgroundColor: colour }}
                  />
                </span>
                <span className="flex shrink-0 gap-1 text-[10px] text-slate-500">
                  {f.message.redeliveryCount > 0 && (
                    <span className="rounded bg-amber-950 px-1 text-amber-300">
                      redelivery {f.message.redeliveryCount}
                    </span>
                  )}
                  {f.message.priority > 0 && (
                    <span className="rounded bg-slate-800 px-1 text-slate-300">
                      priority {f.message.priority}
                    </span>
                  )}
                  {f.message.persistent && (
                    <span className="rounded bg-emerald-950 px-1 text-emerald-300">persistent</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 8: Mount it**

In `src/ui/App.tsx`, put the panel between the canvas and the transport bar so it sits
where the eye already is and never covers the topology:

```tsx
        <div className="border-t border-slate-800">
          <InFlightPanel state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={lesson.durationMs} onStep={stepOnce} />
        </div>
```

- [ ] **Step 9: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: PASS. `src/engine/purity.test.ts` must stay green — nothing added to
`src/engine/**` here imports React or touches the DOM.

- [ ] **Step 10: Verify visually**

Run `npm run dev`, open lesson 3 (fanout) and lesson 4 (topic).
Expected: the zoom control strip is dark slate and legible, not a white block; each moving
dot carries its id above it and stays readable while crossing an edge; the panel lists one
row per moving message with a filling progress bar, and empties to
`Không có message nào trên đường truyền.` between bursts. Scrub backwards — the rows and
bars must follow virtual time backwards with no stale entries.

- [ ] **Step 11: Commit**

```bash
git add src/engine src/index.css src/ui
git commit -m "feat: dark canvas chrome, message id labels, and a live in-flight panel"
```

---

## Task 16: Reliability and dead-lettering lessons 7 through 13

**Language:** every `title`, `summary`, narrative `title`/`body`, and checkpoint below is
written in **Vietnamese**, with RabbitMQ and programming terms left in English exactly as
Global Constraints specifies. The narrative beats described in this task are written in
English here as *specifications of what to say*, not as copy to paste. `src/lessons/language.test.ts`
(Task 15b) enforces this and will fail the task otherwise.

**Files:**
- Create: `src/lessons/07-ack-modes.ts`, `src/lessons/08-prefetch.ts`, `src/lessons/09-nack-requeue.ts`, `src/lessons/10-confirms.ts`, `src/lessons/11-dlx.ts`, `src/lessons/12-ttl-maxlen.ts`, `src/lessons/13-retry-backoff.ts`, `src/lessons/reliability.test.ts`
- Modify: `src/lessons/registry.ts`

**Interfaces:**
- Consumes: `ScriptedFailure` from `src/engine` for the crash lessons
- Produces: `ackModes`, `prefetchQos`, `nackRequeue`, `publisherConfirms`, `dlxBasics`, `ttlAndMaxLength`, `retryWithBackoff`

**Lesson 7 — Ack modes** (`id: '07-ack-modes'`, group `reliability`, seed 7, duration 14000)
- Two independent lanes sharing one exchange: queue `auto-q` with consumer `auto` (`autoAck: true`) and queue `manual-q` with consumer `manual` (`autoAck: false`), both `processingMs: 1500`.
- Exchange `ex` type `fanout` so both lanes receive identical traffic.
- Script: four messages at 0, 800, 1600, 2400.
- `failures`: `{ at: 2000, consumerId: 'auto', kind: 'crash' }` and `{ at: 2000, consumerId: 'manual', kind: 'crash' }`, then both recover at 6000.
- Narrative beats: auto-ack confirms on delivery, so a crash mid-processing loses the message forever; manual ack confirms after work, so the broker requeues everything unacked; the cost of manual ack is bookkeeping, the cost of auto-ack is silent loss.

**Lesson 8 — Prefetch and QoS** (`id: '08-prefetch'`, seed 8, duration 20000)
- Two lanes again: queue `greedy-q` with consumer `greedy` (`prefetch: 0`, unlimited) and queue `fair-q` with consumer `fair-a` and `fair-b` (`prefetch: 1` each). Fanout exchange feeds both.
- All consumers `processingMs: 1200`, `jitterMs: 600`.
- Script: twelve messages at 200ms intervals.
- Narrative beats: unlimited prefetch lets one consumer hoard the whole queue; the queue empties instantly but throughput does not improve; `prefetch: 1` keeps messages in the queue where any free consumer can take them, which is what makes horizontal scaling work.

**Lesson 9 — Nack and requeue** (`id: '09-nack-requeue'`, seed 9, duration 18000)
- One queue `flaky-q`, one consumer `flaky` with `nackRate: 0.5`, `requeueOnNack: true`, `processingMs: 600`.
- Script: five messages at 500ms intervals.
- Narrative beats: a rejected message returns to the head of the queue and is redelivered; `redeliveryCount` climbs and the event log labels redeliveries; with no ceiling, a message that always fails loops forever, which is the setup for Lesson 13.

**Lesson 10 — Durability and confirms** (`id: '10-confirms'`, seed 10, duration 12000)
- One durable queue `orders`, one consumer, all script messages `persistent: true` except the third.
- Narrative beats: `persistent` marks a message for disk; a durable queue survives a broker restart; publisher confirms are the broker telling the publisher it took responsibility — without them a publish is fire-and-forget even to a durable queue. The canvas marks persistent messages with a filled chip and transient ones hollow, driven by the `persistent` flag already carried on `Message`.

**Lesson 11 — DLX basics** (`id: '11-dlx'`, group `dlx`, seed 11, duration 16000)
- Queue `work` with `deadLetterExchange: 'dlx'`, consumer `worker` with `nackRate: 0.6`, `requeueOnNack: false`.
- Exchange `dlx` type `fanout` bound to queue `dead`, which has its own consumer `dead-inspector` with `processingMs: 400`.
- Script: six messages at 600ms intervals.
- Narrative beats: rejecting without requeue routes the message to the dead-letter exchange rather than dropping it; the `x-death-reason` header records why; a DLX is an ordinary exchange, so anything can consume from it.

**Lesson 12 — TTL and max-length** (`id: '12-ttl-maxlen'`, seed 12, duration 16000)
- Queue `short-lived` with `messageTtlMs: 2500`, `maxLength: 3`, `deadLetterExchange: 'dlx'`, and **no consumer**, so messages sit and expire.
- Exchange `dlx` bound to queue `expired` with a consumer.
- Script: six messages at 400ms intervals, so the fourth triggers overflow before the TTL fires.
- Narrative beats: overflow drops the **oldest** message under the default `drop-head` policy; TTL expiry and overflow both dead-letter when a DLX is set and silently drop when it is not; a queue with a TTL and a DLX is the standard delay primitive.

**Lesson 13 — Retry with backoff** (`id: '13-retry-backoff'`, seed 13, duration 30000)
- Chain: `work` (DLX `retry-ex`) → `retry-1s` (`messageTtlMs: 1000`, DLX `main-ex`) → back to `work`, plus `parking-lot` for messages whose `deathTrail.length` reaches 3.
- Consumer `worker` with `nackRate: 0.7`, `requeueOnNack: false`, `processingMs: 400`. Consumer `parking-inspector` on `parking-lot`.
- Script: four messages at 800ms intervals.
- Narrative beats: a delay queue with a TTL and a DLX pointing back at the main exchange produces retry-with-backoff without any timer in the application; each pass appends to the death trail; after a fixed number of deaths the message belongs in a parking lot where a human looks at it, not in an infinite retry loop.
- The engine routes every dead-lettered message to a single target, so the retry chain is
  `work → retry-ex → retry-1s → main-ex → work`, and `parking-lot` is bound to `retry-ex` with
  routing key `parked` for the narrative to point at. The loop terminates because the script
  publishes only four messages and `nackRate` is probabilistic, not because a guard fires.
  The narrative states plainly that a production retry chain needs an explicit death-count
  check — reading `x-death-count` and routing to the parking lot past a threshold — and the
  checkpoint asks the reader what happens without one. Assert `state.halted` is undefined in
  the test so an accidental infinite loop fails CI rather than shipping.

- [ ] **Step 1: Write the failing reliability test**

`src/lessons/reliability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { getLesson } from './registry'

function run(id: string) {
  const lesson = getLesson(id)!
  const sim = createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  sim.advanceTo(lesson.durationMs + 30_000)
  return sim.snapshot()
}

describe('07 ack modes', () => {
  it('loses work on the auto-ack lane and recovers it on the manual lane', () => {
    const state = run('07-ack-modes')
    const autoAcks = state.journal.filter((j) => j.type === 'ack' && j.nodeId === 'auto').length
    const manualAcks = state.journal.filter((j) => j.type === 'ack' && j.nodeId === 'manual').length
    expect(manualAcks).toBeGreaterThan(autoAcks)
  })
})

describe('08 prefetch', () => {
  it('drains the greedy queue immediately while the fair queue holds depth', () => {
    const lesson = getLesson('08-prefetch')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(3_000)
    const state = sim.snapshot()
    expect(state.unacked.greedy!.length).toBeGreaterThan(1)
    expect(state.unacked['fair-a']!.length).toBeLessThanOrEqual(1)
  })
})

describe('09 nack and requeue', () => {
  it('redelivers rejected messages and eventually acks them all', () => {
    const state = run('09-nack-requeue')
    expect(state.metrics.nacked).toBeGreaterThan(0)
    expect(state.metrics.acked).toBe(5)
    expect(state.journal.some((j) => j.text.includes('redelivered'))).toBe(true)
  })
})

describe('11 dlx', () => {
  it('routes rejected messages to the dead-letter queue', () => {
    const state = run('11-dlx')
    expect(state.metrics.deadLettered).toBeGreaterThan(0)
    expect(state.journal.some((j) => j.type === 'deadLetter')).toBe(true)
  })
})

describe('12 ttl and max-length', () => {
  it('dead-letters on both overflow and expiry', () => {
    const state = run('12-ttl-maxlen')
    expect(state.journal.some((j) => j.text.includes('maxlen'))).toBe(true)
    expect(state.journal.some((j) => j.text.includes('expired'))).toBe(true)
    expect(state.metrics.expired).toBeGreaterThan(0)
  })
})

describe('13 retry with backoff', () => {
  it('sends failures through the delay queue and back to the main queue', () => {
    const state = run('13-retry-backoff')
    const trail = state.journal.filter((j) => j.type === 'deadLetter')
    expect(trail.length).toBeGreaterThan(1)
    expect(state.halted).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/lessons/reliability.test.ts`
Expected: FAIL, `getLesson('07-ack-modes')` returns undefined.

- [ ] **Step 3: Write the seven lesson files and register them**

Follow the specifications above and append all seven to `LESSONS` in `src/lessons/registry.ts`,
in numeric order after the basics.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. If lesson 13 reports `halted`, the retry chain is looping — reduce `nackRate`
or add the death-count binding described in the lesson spec, then re-run.

- [ ] **Step 5: Verify visually**

Run: `npm run dev` and open lessons 7, 11, 12, and 13.
Expected: lesson 7 shows the auto-ack consumer greyed out with its message gone while the manual
lane's message returns to the queue; lessons 11 to 13 show rose-coloured particles travelling the
dashed dead-letter edges.

- [ ] **Step 6: Commit**

```bash
git add src/lessons
git commit -m "feat: add reliability and dead-lettering lessons"
```

---

## Task 16c: Persistence, publisher confirms, and lesson 10

Task 16 reported Lesson 10 BLOCKED and skipped it. Three gaps: `ScriptedAction` has no
`persistent` field, so `seedEvents` cannot thread one and every `Message` is born
`persistent: false`; `QueueSpec` has no `durable` flag; and there is no publisher-confirm
event, so the lesson's central claim — that the broker tells the publisher it took
responsibility — has nothing to show. This task closes all three, then writes the lesson.

**Language:** same rule as Tasks 16 and 17. Lesson-level `title` is `Durability and confirms`
and stays English; all other reader-facing copy is Vietnamese with RabbitMQ terms untranslated.

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/index.ts`, `src/engine/broker.ts`,
  `src/ui/canvas/MessageLayer.tsx`
- Create: `src/lessons/10-confirms.ts`
- Modify: `src/lessons/registry.ts`
- Test: `src/engine/confirms.test.ts`, and the existing `src/lessons/reliability.test.ts`

**Interfaces:**
- Consumes: `TRAVEL_MS` from `src/engine/broker.ts`; the existing `applyRoute` /
  `applyEnqueue` reducer shape `(state, event) => { state, newEvents }`
- Produces: `QueueSpec.durable?: boolean`, `ScriptedAction.persistent?: boolean`,
  `SimEventType` member `'confirm'`, `Metrics.confirmed`

### Model

A publisher confirm is the broker saying "I have taken responsibility for this message."
Schedule it from `applyRoute`, not from `applyEnqueue`: route is the single point that
knows the full destination set, so a fanout to three queues still produces exactly one
confirm, and an unroutable message still gets confirmed — both faithful to RabbitMQ.

The delay carries the lesson. A message that is `persistent` landing in a queue that is
`durable` must be written to disk before the broker can promise anything, so it confirms
slowly; anything else is a memory write and confirms fast.

```ts
/** A confirm for a memory-only publish: the broker answers as soon as it has routed. */
export const CONFIRM_MS = 200
/**
 * A persistent message into a durable queue is confirmed only after the broker has
 * written it to disk. The gap between this and CONFIRM_MS is the cost of durability,
 * and lesson 10 exists to make that gap visible on the timeline.
 */
export const CONFIRM_PERSISTENT_MS = 900
```

Durability is per-pair, not per-message: `persistent` on a transient queue and a durable
queue holding a transient message are both lost on restart. Use the slow path only when
the message is `persistent` AND at least one destination queue is `durable`.

- [ ] **Step 1: Write the failing engine test**

`src/engine/confirms.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSimulation } from './index'
import type { Topology } from './types'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'p1', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'ex', type: 'direct', position: { x: 1, y: 0 } }],
  queues: [
    { id: 'durable-q', label: 'durable-q', kind: 'classic', durable: true, position: { x: 2, y: 0 } },
    { id: 'transient-q', label: 'transient-q', kind: 'classic', position: { x: 2, y: 1 } },
  ],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'durable-q', destinationKind: 'queue', routingKey: 'd' },
    { id: 'b2', exchangeId: 'ex', destinationId: 'transient-q', destinationKind: 'queue', routingKey: 't' },
  ],
}

function confirmAt(routingKey: string, persistent: boolean): number {
  const sim = createSimulation({
    topology,
    script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey, body: 'x', persistent }],
    seed: 1,
  })
  sim.advanceTo(10_000)
  const entry = sim.snapshot().journal.find((j) => j.type === 'confirm')
  if (!entry) throw new Error('no confirm was journalled')
  return entry.at
}

describe('publisher confirms', () => {
  it('confirms every published message exactly once, even fanned out', () => {
    const sim = createSimulation({
      topology: { ...topology, exchanges: [{ ...topology.exchanges[0], type: 'fanout' }] },
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'd', body: 'x' }],
      seed: 1,
    })
    sim.advanceTo(10_000)
    const state = sim.snapshot()
    // Fanout puts this message in both queues. RabbitMQ confirms the publish, not the
    // copies, so two enqueues must still produce one confirm.
    expect(state.journal.filter((j) => j.type === 'confirm')).toHaveLength(1)
    expect(state.metrics.confirmed).toBe(1)
  })

  it('confirms an unroutable message', () => {
    const sim = createSimulation({
      topology,
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'nobody', body: 'x' }],
      seed: 1,
    })
    sim.advanceTo(10_000)
    expect(sim.snapshot().metrics.confirmed).toBe(1)
    expect(sim.snapshot().metrics.dropped).toBe(1)
  })

  it('takes longer to confirm a persistent message into a durable queue', () => {
    // The whole point of the lesson: the disk write is visible on the clock.
    expect(confirmAt('d', true)).toBeGreaterThan(confirmAt('d', false))
  })

  it('does not pay the disk cost when only one half of the pair is durable', () => {
    // persistent message, transient queue: nothing is written, so nothing is slower.
    expect(confirmAt('t', true)).toBe(confirmAt('t', false))
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/engine/confirms.test.ts`
Expected: FAIL — `durable` is not a property of `QueueSpec`, `persistent` is not a
property of `ScriptedAction`, and no `confirm` entry is ever journalled.

- [ ] **Step 3: Add the fields and the confirm event**

In `src/engine/types.ts`: add `durable?: boolean` to `QueueSpec` with a comment noting a
durable queue survives a broker restart but only preserves the messages that were
themselves `persistent`; add `'confirm'` to `SimEventType`; add `confirmed: number` to
`Metrics`. Leave `durable` optional — AMQP's own default is non-durable, and making it
required would force a meaningless declaration onto every queue in the twelve shipped
lessons.

In `src/engine/index.ts`: add `persistent?: boolean` to `ScriptedAction` and thread it
into the publish payload as `persistent: action.persistent ?? false`.

In `src/engine/broker.ts`: read `persistent` off the payload when building the `Message`
(it is currently hardcoded), and in `applyRoute` schedule one `confirm` event.

`Metrics.confirmed` needs no UI work: `Inspector.tsx` renders metrics with
`Object.entries(state.metrics)`, so the new counter appears by itself.

- [ ] **Step 4: Run the engine test**

Run: `npm test -- src/engine/confirms.test.ts`
Expected: PASS, four tests.

Also run `npm test -- src/engine/purity.test.ts` — the engine stays free of React,
Zustand, DOM, `Math.random`, `Date.now`, and `setTimeout`.

- [ ] **Step 5: Draw transient messages hollow**

In `src/ui/canvas/MessageLayer.tsx`, `Particle` gains `persistent: boolean`, taken from
`flight.message.persistent`. A persistent particle keeps the current filled dot; a
transient one is drawn as an outline — `fill="none"` with `stroke` set to the same tone
and `strokeWidth={2}` — so the reader can tell at a glance which messages would survive a
restart. The outer glow circle and the id label are unchanged for both.

Add to `src/ui/canvas/MessageLayer.test.tsx` a case asserting that a transient message
renders a circle with `fill="none"` and a persistent one does not.

- [ ] **Step 6: Write lesson 10**

`src/lessons/10-confirms.ts`, `id: '10-confirms'`, group `reliability`, seed 10,
`durationMs: 12000`, `title: 'Durability and confirms'`.

- One queue `orders` with `durable: true`, one consumer `worker` (`prefetch: 1`,
  `autoAck: false`, `processingMs: 900`), fed by a `direct` exchange `ex` on key `order`.
- Script: four messages at 0, 1500, 3000, 4500. All `persistent: true` except the third,
  which is transient — one hollow dot among filled ones is what makes the distinction
  land visually.
- Narrative beats: `persistent` marks a message for disk, and `durable` marks a queue to
  survive a restart, and neither is sufficient alone; a publisher confirm is the broker
  taking responsibility, and without it a publish is fire-and-forget even into a durable
  queue; the third message is the odd one out, and a restart at that moment would lose
  exactly it; the confirm for a persistent message arrives later than for a transient one,
  and that gap is the price of the guarantee.
- One checkpoint asking what survives a broker restart, with the correct answer being
  that only a `persistent` message in a `durable` queue does.

Register it in `src/lessons/registry.ts` between `09-nack-requeue` and `11-dlx`.

- [ ] **Step 7: Assert the lesson's own behaviour**

Append to `src/lessons/reliability.test.ts`:

```ts
describe('10 durability and confirms', () => {
  it('confirms every publish and marks exactly one message transient', () => {
    const lesson = getLesson('10-confirms')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 30_000)
    const state = sim.snapshot()
    expect(state.metrics.confirmed).toBe(4)
    expect(state.metrics.acked).toBe(4)
    expect(lesson.script.filter((a) => a.persistent !== true)).toHaveLength(1)
  })
})
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test` then `npm run typecheck`
Expected: both clean. `npm run typecheck` uses `tsc -b`; bare `tsc --noEmit` is a silent
no-op in this repo because of TypeScript project references.

- [ ] **Step 9: Commit**

```bash
git add src/engine src/lessons src/ui
git commit -m "feat: publisher confirms, message persistence, and lesson 10"
```

---

## Task 17: Pattern lessons 14 through 17

**Language:** same rule as Task 16 — every `title`, `summary`, narrative `title`/`body`,
and checkpoint is written in **Vietnamese** with RabbitMQ and programming terms left in
English. The narrative beats below specify what to say, not the words to paste.

**Files:**
- Create: `src/lessons/14-rpc.ts`, `src/lessons/15-priority.ts`, `src/lessons/16-delayed.ts`, `src/lessons/17-quorum.ts`, `src/lessons/patterns.test.ts`
- Modify: `src/lessons/registry.ts`

**Interfaces:**
- Consumes: `correlationId` and `replyTo` on `ScriptedAction`; `maxPriority` on `QueueSpec`
- Produces: `rpcPattern`, `priorityQueue`, `delayedMessage`, `quorumVsClassic`

**Lesson 14 — RPC** (`id: '14-rpc'`, group `patterns`, seed 14, duration 16000)
- Exchange `rpc-ex` type `direct` bound to queue `rpc-work` with key `compute`. Consumer `worker`, `processingMs: 1200`.
- Exchange `replies` type `direct` bound to queue `reply-q` with routing keys matching each `correlationId`. Consumer `caller` on `reply-q`, `processingMs: 200`.
- Script: three messages with `routingKey: 'compute'`, `replyTo: 'replies'`, and `correlationId: 'corr-1' | 'corr-2' | 'corr-3'`, published at 0, 2000, 4000. Bindings on `replies` use those three keys.
- Narrative beats: RPC over a broker is two one-way messages; `replyTo` names where the answer goes and `correlationId` tells the caller which request it answers; the caller needs a correlation id because replies can arrive out of order.

**Lesson 15 — Priority queue** (`id: '15-priority'`, seed 15, duration 16000)
- Queue `jobs` with `maxPriority: 10`, one consumer `worker`, `processingMs: 1500`, `prefetch: 1`.
- Script: eight messages at 200ms intervals with priorities `0,0,0,9,0,5,0,9`.
- Narrative beats: priority reorders what is still waiting, never what is already delivered; a low prefetch is what makes priority effective, because a consumer holding ten prefetched messages has already fixed their order.

**Lesson 16 — Delayed messages** (`id: '16-delayed'`, seed 16, duration 20000)
- Queue `delay-5s` with `messageTtlMs: 5000`, `deadLetterExchange: 'main-ex'`, `deadLetterRoutingKey: 'now'`, **no consumer**.
- Exchange `main-ex` type `direct` bound to queue `due` with key `now`; consumer `handler` on `due`.
- Script publishes into `delay-ex` (bound to `delay-5s`) at 0, 500, 1000.
- Narrative beats: there is no native delay in core RabbitMQ; a queue with a TTL and no consumer is a timer, and its dead-letter exchange is where the message wakes up; the caveat is head-of-line blocking, because a queue expires messages in order.

**Lesson 17 — Quorum versus classic** (`id: '17-quorum'`, seed 17, duration 20000)
- Two lanes fed by a fanout exchange: queue `classic-q` (`kind: 'classic'`) with consumer `classic-consumer`, queue `quorum-q` (`kind: 'quorum'`) with consumer `quorum-consumer`. Both `prefetch: 2`, `processingMs: 1800`, manual ack.
- Script: six messages at 400ms intervals. `failures`: both consumers crash at 3000 and recover at 7000.
- Narrative beats: both queue types requeue unacked work when a consumer dies, and the visible difference here is nil — because the real difference is what happens when the **broker node** dies. A quorum queue replicates across nodes with a Raft majority, so a node failure loses nothing; a classic non-mirrored queue lives on one node and its contents go with it. The lesson states plainly that this simulation models consumer failure, not node failure, and the checkpoint tests whether the reader can articulate the distinction.

- [ ] **Step 1: Write the failing patterns test**

`src/lessons/patterns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { getLesson } from './registry'

function run(id: string) {
  const lesson = getLesson(id)!
  const sim = createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  sim.advanceTo(lesson.durationMs + 30_000)
  return sim.snapshot()
}

describe('14 rpc', () => {
  it('publishes a reply for every request, carrying the correlation id', () => {
    const state = run('14-rpc')
    const replies = state.journal.filter((j) => j.type === 'publish' && j.nodeId === 'worker')
    expect(replies).toHaveLength(3)
    expect(state.metrics.acked).toBe(6) // 3 requests + 3 replies
  })
})

describe('15 priority', () => {
  it('delivers higher priority messages before lower ones that arrived earlier', () => {
    const lesson = getLesson('15-priority')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 30_000)
    const order = sim
      .snapshot()
      .journal.filter((j) => j.type === 'deliver')
      .map((j) => j.messageId)
    // m4 (priority 9) is published fourth but must be delivered before m3 (priority 0)
    expect(order.indexOf('m4')).toBeLessThan(order.indexOf('m3'))
  })
})

describe('16 delayed message', () => {
  it('holds messages for the ttl before they reach the due queue', () => {
    const lesson = getLesson('16-delayed')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(3_000)
    expect(sim.snapshot().queues.due).toHaveLength(0)
    sim.advanceTo(20_000)
    expect(sim.snapshot().metrics.acked).toBe(3)
  })
})

describe('17 quorum versus classic', () => {
  it('requeues unacked work on both lanes when consumers crash', () => {
    const state = run('17-quorum')
    expect(state.journal.some((j) => j.type === 'consumerCrash')).toBe(true)
    expect(state.metrics.acked).toBe(12) // six messages on each of two lanes
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/lessons/patterns.test.ts`
Expected: FAIL, `getLesson('14-rpc')` returns undefined.

- [ ] **Step 3: Write the four lesson files and register them**

Follow the specifications above and append all four to `LESSONS`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, every lesson test green.

- [ ] **Step 5: Commit**

```bash
git add src/lessons
git commit -m "feat: add rpc, priority, delayed message, and quorum lessons"
```

---

## Task 18: Sandbox editing

**Files:**
- Create: `src/sandbox/sandboxStore.ts`, `src/sandbox/SandboxPanel.tsx`, `src/sandbox/sandboxStore.test.ts`
- Modify: `src/ui/App.tsx` — render the sandbox when `useAppStore.sandbox` is true
- Modify: `src/ui/CanvasView/CanvasView.tsx` — accept `editable` and wire `onNodesChange` and `onConnect`

**Interfaces:**
- Consumes: `Topology`, `validateTopology` from `src/engine`
- Produces:
  - `useSandboxStore` — `{ topology, addNode, updateNode, removeNode, addBinding, publish, generator, setGenerator, load, save, reset }`
  - `emptyTopology(): Topology`
  - `STORAGE_KEY = 'rabbitmq-visualizer.sandbox'`

**Semantics to implement:**
- The sandbox owns its own topology and its own script; the simulation is rebuilt whenever either changes, bumping `replayToken`.
- `publish` appends a `ScriptedAction` at the current virtual time, so hand-published messages appear immediately.
- `setGenerator({ ratePerSecond, exchangeId, routingKey })` expands to scripted actions covering 60 virtual seconds at that rate — the engine has no concept of an open-ended stream, and a fixed horizon keeps runs replayable.
- Node dragging updates positions in the sandbox topology so layouts persist.
- `save` writes to `localStorage` under `STORAGE_KEY`; `load` reads and validates it, falling back to `emptyTopology()` when the payload is malformed.

- [ ] **Step 1: Write the failing sandbox store test**

`src/sandbox/sandboxStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/sandbox`
Expected: FAIL, `Failed to resolve import "./sandboxStore"`.

- [ ] **Step 3: Implement the sandbox store**

`src/sandbox/sandboxStore.ts`:

```ts
import { create } from 'zustand'
import type { ScriptedAction, Topology } from '../engine'

export const STORAGE_KEY = 'rabbitmq-visualizer.sandbox'
/** Virtual seconds a load generator covers; a fixed horizon keeps runs replayable. */
const GENERATOR_HORIZON_S = 60

export type SandboxNodeKind = 'publisher' | 'exchange' | 'queue' | 'consumer'

export interface Generator {
  ratePerSecond: number
  exchangeId: string
  routingKey: string
}

export function emptyTopology(): Topology {
  return { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] }
}

interface SandboxState {
  topology: Topology
  script: ScriptedAction[]
  generator?: Generator
  addNode(kind: SandboxNodeKind, position: { x: number; y: number }): void
  updateNode(id: string, patch: Record<string, unknown>): void
  removeNode(id: string): void
  addBinding(exchangeId: string, destinationId: string, routingKey: string): void
  publish(action: ScriptedAction): void
  setGenerator(generator: Generator): void
  save(): void
  load(): void
  reset(): void
}

let counter = 0
const mintId = (kind: string) => `${kind}-${++counter}`

export const useSandboxStore = create<SandboxState>((set, get) => ({
  topology: emptyTopology(),
  script: [],

  addNode(kind, position) {
    const id = mintId(kind)
    set((s) => {
      const t = s.topology
      if (kind === 'publisher') {
        return { topology: { ...t, publishers: [...t.publishers, { id, label: id, position }] } }
      }
      if (kind === 'exchange') {
        return {
          topology: {
            ...t,
            exchanges: [...t.exchanges, { id, label: id, type: 'direct' as const, position }],
          },
        }
      }
      if (kind === 'queue') {
        return {
          topology: { ...t, queues: [...t.queues, { id, label: id, kind: 'classic' as const, position }] },
        }
      }
      return {
        topology: {
          ...t,
          consumers: [
            ...t.consumers,
            {
              id,
              label: id,
              queueId: t.queues[0]?.id ?? '',
              prefetch: 1,
              autoAck: false,
              processingMs: 800,
              jitterMs: 0,
              nackRate: 0,
              requeueOnNack: true,
              position,
            },
          ],
        },
      }
    })
  },

  updateNode(id, patch) {
    set((s) => {
      const apply = <T extends { id: string }>(list: T[]) =>
        list.map((item) => (item.id === id ? { ...item, ...patch } : item))
      return {
        topology: {
          publishers: apply(s.topology.publishers),
          exchanges: apply(s.topology.exchanges),
          queues: apply(s.topology.queues),
          consumers: apply(s.topology.consumers),
          bindings: s.topology.bindings,
        },
      }
    })
  },

  removeNode(id) {
    set((s) => ({
      topology: {
        publishers: s.topology.publishers.filter((n) => n.id !== id),
        exchanges: s.topology.exchanges.filter((n) => n.id !== id),
        queues: s.topology.queues.filter((n) => n.id !== id),
        consumers: s.topology.consumers.filter((n) => n.id !== id),
        bindings: s.topology.bindings.filter(
          (b) => b.exchangeId !== id && b.destinationId !== id,
        ),
      },
    }))
  },

  addBinding(exchangeId, destinationId, routingKey) {
    const isExchange = get().topology.exchanges.some((e) => e.id === destinationId)
    set((s) => ({
      topology: {
        ...s.topology,
        bindings: [
          ...s.topology.bindings,
          {
            id: mintId('binding'),
            exchangeId,
            destinationId,
            destinationKind: isExchange ? ('exchange' as const) : ('queue' as const),
            routingKey,
          },
        ],
      },
    }))
  },

  publish(action) {
    set((s) => ({ script: [...s.script, action] }))
  },

  setGenerator(generator) {
    const intervalMs = 1000 / generator.ratePerSecond
    const count = Math.floor(GENERATOR_HORIZON_S * generator.ratePerSecond)
    const script = Array.from({ length: count }, (_, i) => ({
      at: Math.round(i * intervalMs),
      publisherId: get().topology.publishers[0]?.id ?? 'p1',
      exchangeId: generator.exchangeId,
      routingKey: generator.routingKey,
      body: `generated-${i}`,
    }))
    set({ generator, script })
  },

  save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ topology: get().topology, script: get().script }),
    )
  },

  load() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { topology?: Topology; script?: ScriptedAction[] }
      if (!parsed.topology || !Array.isArray(parsed.topology.queues)) throw new Error('bad shape')
      set({ topology: parsed.topology, script: parsed.script ?? [] })
    } catch {
      set({ topology: emptyTopology(), script: [] })
    }
  },

  reset() {
    set({ topology: emptyTopology(), script: [], generator: undefined })
  },
}))
```

- [ ] **Step 4: Build the sandbox panel and wire it into the app**

`src/sandbox/SandboxPanel.tsx` renders the palette (four buttons calling `addNode`), a config form
for the selected node calling `updateNode`, a publish form calling `publish`, and a rate slider
calling `setGenerator`. In `src/ui/App.tsx`, branch on `useAppStore(s => s.sandbox)`: when true,
feed `CanvasView` the sandbox topology with `editable`, and render `SandboxPanel` in place of
`Inspector`. In `CanvasView`, when `editable` is set, pass `onNodesChange` (persisting drag
positions through `updateNode`) and `onConnect` (calling `addBinding`).

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, 7 new sandbox tests.

- [ ] **Step 6: Verify visually**

Run: `npm run dev`, open Sandbox, add a publisher, exchange, queue, and consumer, connect them,
publish a message, and press Play.
Expected: the message animates through the topology you just built; a reload restores it after Save.

- [ ] **Step 7: Commit**

```bash
git add src/sandbox src/ui
git commit -m "feat: add sandbox topology editing, publishing, and persistence"
```

---

## Task 19: Export topology as code

**Files:**
- Create: `src/sandbox/export/amqplib.ts`, `src/sandbox/export/nestjs.ts`, `src/sandbox/export/export.test.ts`, `src/sandbox/ExportDialog.tsx`
- Modify: `src/sandbox/SandboxPanel.tsx` — add an Export button

**Interfaces:**
- Consumes: `Topology` from `src/engine`
- Produces:
  - `toAmqplib(topology: Topology): string`
  - `toNestjs(topology: Topology): string`

- [ ] **Step 1: Write the failing export test**

`src/sandbox/export/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Topology } from '../../engine'
import { toAmqplib } from './amqplib'
import { toNestjs } from './nestjs'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'api', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'orders', label: 'orders', type: 'topic', position: { x: 0, y: 0 } }],
  queues: [
    {
      id: 'payments',
      label: 'payments',
      kind: 'classic',
      messageTtlMs: 30000,
      maxLength: 1000,
      deadLetterExchange: 'dlx',
      position: { x: 0, y: 0 },
    },
  ],
  consumers: [
    {
      id: 'c1',
      label: 'payment-worker',
      queueId: 'payments',
      prefetch: 5,
      autoAck: false,
      processingMs: 100,
      jitterMs: 0,
      nackRate: 0,
      requeueOnNack: true,
      position: { x: 0, y: 0 },
    },
  ],
  bindings: [
    {
      id: 'b1',
      exchangeId: 'orders',
      destinationId: 'payments',
      destinationKind: 'queue',
      routingKey: 'order.*.paid',
    },
  ],
}

describe('toAmqplib', () => {
  it('declares the exchange with its type', () => {
    expect(toAmqplib(topology)).toContain("assertExchange('orders', 'topic'")
  })

  it('carries queue arguments across', () => {
    const code = toAmqplib(topology)
    expect(code).toContain("'x-message-ttl': 30000")
    expect(code).toContain("'x-max-length': 1000")
    expect(code).toContain("'x-dead-letter-exchange': 'dlx'")
  })

  it('binds with the routing key and sets prefetch', () => {
    const code = toAmqplib(topology)
    expect(code).toContain("bindQueue('payments', 'orders', 'order.*.paid')")
    expect(code).toContain('prefetch(5)')
  })
})

describe('toNestjs', () => {
  it('emits a RabbitSubscribe decorator per consumer', () => {
    const code = toNestjs(topology)
    expect(code).toContain('@RabbitSubscribe(')
    expect(code).toContain("exchange: 'orders'")
    expect(code).toContain("routingKey: 'order.*.paid'")
    expect(code).toContain("queue: 'payments'")
  })

  it('marks manual ack when the consumer does not auto-ack', () => {
    expect(toNestjs(topology)).toContain('allowNonJsonMessages')
  })
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -- src/sandbox/export`
Expected: FAIL, `Failed to resolve import "./amqplib"`.

- [ ] **Step 3: Implement the amqplib generator**

`src/sandbox/export/amqplib.ts`:

```ts
import type { Topology } from '../../engine'

function queueArguments(topology: Topology, queueId: string): string {
  const queue = topology.queues.find((q) => q.id === queueId)
  if (!queue) return '{}'
  const args: string[] = []
  if (queue.messageTtlMs !== undefined) args.push(`      'x-message-ttl': ${queue.messageTtlMs},`)
  if (queue.maxLength !== undefined) args.push(`      'x-max-length': ${queue.maxLength},`)
  if (queue.deadLetterExchange) args.push(`      'x-dead-letter-exchange': '${queue.deadLetterExchange}',`)
  if (queue.deadLetterRoutingKey) args.push(`      'x-dead-letter-routing-key': '${queue.deadLetterRoutingKey}',`)
  if (queue.maxPriority !== undefined) args.push(`      'x-max-priority': ${queue.maxPriority},`)
  if (queue.kind === 'quorum') args.push(`      'x-queue-type': 'quorum',`)
  return args.length === 0 ? '{}' : `{\n${args.join('\n')}\n    }`
}

export function toAmqplib(topology: Topology): string {
  const lines: string[] = [
    "import amqp from 'amqplib'",
    '',
    'export async function setup() {',
    "  const connection = await amqp.connect('amqp://localhost')",
    '  const channel = await connection.createChannel()',
    '',
  ]

  for (const exchange of topology.exchanges) {
    lines.push(
      `  await channel.assertExchange('${exchange.id}', '${exchange.type}', { durable: true })`,
    )
  }
  lines.push('')

  for (const queue of topology.queues) {
    lines.push(
      `  await channel.assertQueue('${queue.id}', {`,
      '    durable: true,',
      `    arguments: ${queueArguments(topology, queue.id)},`,
      '  })',
    )
  }
  lines.push('')

  for (const binding of topology.bindings) {
    const call = binding.destinationKind === 'queue' ? 'bindQueue' : 'bindExchange'
    lines.push(
      `  await channel.${call}('${binding.destinationId}', '${binding.exchangeId}', '${binding.routingKey ?? ''}')`,
    )
  }
  lines.push('')

  for (const consumer of topology.consumers) {
    lines.push(
      `  await channel.prefetch(${consumer.prefetch})`,
      `  await channel.consume('${consumer.queueId}', async (message) => {`,
      '    if (!message) return',
      '    try {',
      `      // handle ${consumer.label}`,
      consumer.autoAck ? '      // auto-ack: nothing to confirm' : '      channel.ack(message)',
      '    } catch (error) {',
      `      channel.nack(message, false, ${consumer.requeueOnNack})`,
      '    }',
      `  }, { noAck: ${consumer.autoAck} })`,
      '',
    )
  }

  lines.push('  return { connection, channel }', '}')
  return lines.join('\n')
}
```

- [ ] **Step 4: Implement the NestJS generator**

`src/sandbox/export/nestjs.ts`:

```ts
import type { Topology } from '../../engine'

function pascal(id: string): string {
  return id
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function toNestjs(topology: Topology): string {
  const lines: string[] = [
    "import { Injectable } from '@nestjs/common'",
    "import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'",
    '',
    '@Injectable()',
    'export class MessagingHandlers {',
  ]

  for (const consumer of topology.consumers) {
    const binding = topology.bindings.find(
      (b) => b.destinationKind === 'queue' && b.destinationId === consumer.queueId,
    )
    lines.push(
      '  @RabbitSubscribe({',
      `    exchange: '${binding?.exchangeId ?? ''}',`,
      `    routingKey: '${binding?.routingKey ?? ''}',`,
      `    queue: '${consumer.queueId}',`,
      '    queueOptions: {',
      '      durable: true,',
      `      arguments: { 'x-max-priority': undefined },`,
      '    },',
      '    allowNonJsonMessages: true,',
      '  })',
      `  async handle${pascal(consumer.label)}(message: unknown): Promise<void> {`,
      `    // ${consumer.label} consumes ${consumer.queueId} with prefetch ${consumer.prefetch}`,
      '  }',
      '',
    )
  }

  lines.push('}')
  lines.push('')
  lines.push('// Register the exchanges in your module:')
  lines.push('// RabbitMQModule.forRoot({ exchanges: [')
  for (const exchange of topology.exchanges) {
    lines.push(`//   { name: '${exchange.id}', type: '${exchange.type}' },`)
  }
  lines.push("// ], uri: 'amqp://localhost' })")

  return lines.join('\n')
}
```

- [ ] **Step 5: Add the export dialog**

`src/sandbox/ExportDialog.tsx` renders a modal with two tabs, `amqplib` and `NestJS`, showing the
generated string in a `<pre>` with a copy-to-clipboard button. Wire an Export button in
`SandboxPanel.tsx` to open it.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS, 5 new export tests.

- [ ] **Step 7: Verify visually**

Run: `npm run dev`, build a topology in the Sandbox, click Export.
Expected: both tabs show code matching the topology on screen.

- [ ] **Step 8: Commit**

```bash
git add src/sandbox
git commit -m "feat: export sandbox topology as amqplib and nestjs code"
```

---

## Task 20: Final verification pass

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS, every test across engine, lessons, sim, ui, and sandbox.

- [ ] **Step 2: Type-check and build**

Run: `npm run typecheck && npm run build`
Expected: no errors, `dist/` produced.

The root `tsconfig.json` is references-only, so a bare `npx tsc --noEmit` compiles zero files
and exits 0 no matter what is broken. Always use the `typecheck` script, which runs `tsc -b`.

- [ ] **Step 3: Walk every lesson**

Run: `npm run dev` and open all 17 lessons, pressing Play on each.
Expected for each: particles animate, the narrative advances with the clock, the event log fills,
and no lesson shows a validation error or a halt banner.

- [ ] **Step 4: Write the README**

`README.md` covering: what the app is, `npm install`, `npm run dev`, `npm test`, the engine's
determinism contract (same seed produces the same journal), and how to add a lesson (create a file
in `src/lessons/`, export a `Lesson`, add it to `registry.ts` — the golden-journal tests pick it up
automatically).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add readme covering setup, testing, and adding lessons"
```

---

## Self-Review Notes

**Spec coverage** — every spec section maps to a task: architecture (Tasks 2–9), lesson model
(Task 10), the 17 lessons (Tasks 10, 15, 16, 17), sandbox (Task 18), code export (Task 19),
validation and guards (Task 9), testing strategy (every task, with golden-journal harness in
Task 10), stack (Task 1).

**Known simplifications, stated rather than hidden:**
- Publisher-to-exchange edges are inferred in `toFlowEdges` because the topology does not model
  which publisher targets which exchange. Every publisher connects to every bound exchange.
- Lesson 17 models consumer failure, not broker-node failure. The lesson narrative says so
  explicitly rather than implying the simulation proves something it does not.
- The load generator expands to a fixed 60-second horizon instead of streaming indefinitely,
  because an unbounded stream would break replay.

