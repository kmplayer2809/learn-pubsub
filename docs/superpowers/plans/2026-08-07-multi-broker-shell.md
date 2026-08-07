# Multi-broker Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app into a broker-agnostic shell plus self-contained broker modules, so that a second broker (Redis) and a third (Kafka) are additive rather than a fork of the shell.

**Architecture:** Timing machinery (seeded RNG, min-heap scheduler, run loop, event ceiling, journal cap) moves to `src/shell/kernel/` and is generic over a `KernelState` base. Everything AMQP-specific moves to `src/brokers/rabbitmq/`. A `BrokerModule` object is the only thing the shell knows about a broker: its lessons, its `createSimulation`, its React Flow node types, its `toFlow`, its state panel, and an optional sandbox. `src/brokers/registry.ts` lists the modules; a switcher at the top of the sidebar selects one.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, `@xyflow/react` 12, Vite 8, Vitest 4, Tailwind 3, oxlint.

**Source spec:** `docs/superpowers/specs/2026-08-07-multi-broker-redis-design.md` (sections 3.1–3.3, delivery phases 1–2).

## Global Constraints

- **Behaviour must not change in this plan.** Every one of the 397 existing tests stays green from the first commit to the last. This plan moves and generalises code; it does not rewrite RabbitMQ behaviour, lesson content, or copy.
- **Typecheck command is `npm run typecheck`** (runs `tsc -b`). Never `npx tsc --noEmit` — the root `tsconfig.json` is project-references only and compiles zero files, so it exits 0 regardless of errors.
- **Determinism contract holds:** no `Math.random`, `Date.now`, `new Date`, `setTimeout`, `setInterval`, `performance.now`, no `document.`/`window.`/`process.`, no dynamic `import(`/`require(`, and no imports of `react`, `zustand`, or `@xyflow/react` anywhere under `src/shell/kernel/**` or `src/brokers/*/engine/**` (excluding `*.test.ts`).
- **User-facing copy is Vietnamese**; RabbitMQ/Redis/programming terms stay English. New UI strings in this plan follow that rule.
- **Use `git mv` for every file move** so history follows the file.
- **Commit after every task**, with the test suite green.
- **No new runtime dependencies.** `package.json` dependencies stay exactly: `@xyflow/react`, `react`, `react-dom`, `zustand`.

---

## Amendment (2026-08-08): no hooks in the BrokerModule contract

Task 9's implementation and review superseded the sandbox-accessor design in
Tasks 7, 9, 10, and 11. The plan originally had `BrokerSandbox` expose hooks —
`useTopology()`, `useScript()`, `useEditing(topology)` — and had the shell call
them behind `broker.sandbox?....` with a `NO_SANDBOX` / `NO_EDITING` fallback.

That is unsound. React requires the hook count and order to be stable across
renders of the same component instance; it does not care that switching brokers
will rebuild the tree. `useRabbitEditing` calls three hooks and `NO_EDITING`
calls none, so selecting a broker without a sandbox changes the hook count of a
mounted component. The plan's justification ("a broker change already forces a
full rebuild") argued the wrong thing.

**The contract carries no hooks.** `BrokerSandbox` exposes plain functions:

```ts
export interface BrokerSandbox<S extends KernelState, T, A, I extends ValidationIssueBase> {
  Panel: ComponentType<{ state: S; issues: I[] }>
  getTopology(): T
  getScript(): A[]
  /** Zustand's subscribe: registers a listener, returns the unsubscribe. */
  subscribe(onStoreChange: () => void): () => void
  reset(): void
  maxEvents: number
  transportDurationMs: number
  /** Canvas edit handlers. Plain functions, not hooks: they are event handlers
   *  and read the broker's store through getState() when they fire. */
  editing: {
    onNodesChange(topology: T, changes: NodeChange[]): void
    onConnect(topology: T, connection: Connection): void
  }
}
```

The shell reads sandbox state through exactly one `useSyncExternalStore` call per
value, at a fixed call site, so the hook count never varies.

**Every `getSnapshot` must return a stable reference.** `useSyncExternalStore`
compares snapshots with `Object.is`, so a `getSnapshot` returning a fresh object
or array literal re-renders forever. The no-sandbox fallback therefore returns
module-scope constants (`EMPTY_SCRIPT`, `undefined`), never literals. This bug
shipped once in Task 9 and was caught only because a reviewer looked for it;
`src/shell/useSimulation.test.tsx` now carries a regression test that blanks the
registered module's `sandbox` and asserts the hook settles.

Consequences for the remaining tasks:

- **Task 10:** `CanvasView` must not call `broker.sandbox?.useEditing(topology)`.
  It calls `broker.sandbox?.editing.onNodesChange` / `.onConnect` inside its own
  `useCallback`s, or passes them straight to React Flow. `NO_EDITING` disappears.
  `src/brokers/rabbitmq/ui/editing.ts` becomes plain functions taking the topology
  and reading `useSandboxStore.getState()`.
- **Task 10:** `App` takes sandbox topology/script from `useSimulation`'s own
  resolution rather than calling accessors itself, so it gains no new hook.
- **Task 11:** unchanged; the switcher touches no sandbox accessor.

## Amendment (2026-08-08): the store must not import the broker registry

Task 8's review found a real import cycle:
`store.ts -> registry.ts -> rabbitmq/index.ts -> SandboxPanel.tsx -> Inspector.tsx -> store.ts`.
Reading `DEFAULT_BROKER_ID` while that cycle is unresolved yields `undefined`
rather than throwing, so `brokerId` silently initialised to `undefined` whenever
something imported `registry.ts` first. A `try/catch` cannot fix this: nothing is
thrown, and whether the wrong branch runs depends on module evaluation order,
which differs between Vite dev, the production bundle, and Vitest.

The cycle is broken by splitting the broker *catalog* — the plain data the shell
needs before any component exists — out of the module that pulls in components:

`src/brokers/catalog.ts` (imports nothing but types):

```ts
/**
 * Plain broker facts the shell needs at module-evaluation time. This file must
 * never import a component, an engine, or `registry.ts` — importing any of them
 * would recreate the cycle this file exists to break.
 */
export interface BrokerCatalogEntry {
  id: string
  label: string
  defaultLessonId: string
}

export const BROKER_CATALOG: BrokerCatalogEntry[] = [
  { id: 'rabbitmq', label: 'RabbitMQ', defaultLessonId: '01-hello-world' },
]

export const DEFAULT_BROKER_ID = 'rabbitmq'

export function catalogEntry(id: string): BrokerCatalogEntry {
  return BROKER_CATALOG.find((b) => b.id === id)
    ?? BROKER_CATALOG.find((b) => b.id === DEFAULT_BROKER_ID)!
}
```

Consequences, which supersede the corresponding text in Tasks 7, 8, and 11:

- `src/shell/store.ts` imports **only** `./brokers/catalog`, never `registry.ts`.
  Its initial `lessonId` is `catalogEntry(DEFAULT_BROKER_ID).defaultLessonId` and
  `setBroker` validates against `BROKER_CATALOG`. No `try/catch`, no fallback
  literals: with the cycle gone there is nothing to fall back from.
- `src/brokers/registry.ts` re-exports `DEFAULT_BROKER_ID` from the catalog rather
  than declaring its own, so there is one definition.
- `src/brokers/registry.test.ts` gains a case asserting the two agree — every
  catalog entry has a module with the same `label` and `defaultLessonId`, and
  every module has a catalog entry. That test is what keeps the split honest.
- `BrokerSwitcher` (Task 11) may render from either; prefer `BROKERS` so it shows
  what is actually loadable.

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/shell/kernel/rng.ts` | mulberry32 seeded PRNG (moved verbatim). |
| `src/shell/kernel/clock.ts` | min-heap event scheduler, generic over event type. |
| `src/shell/kernel/types.ts` | `SimEvent`, `JournalEntry`, `InFlight`, `KernelState`, `ValidationIssueBase`. |
| `src/shell/kernel/run.ts` | `createKernel` — the drain loop, event ceiling, journal cap. |
| `src/shell/kernel/purity.test.ts` | Greps kernel + every `src/brokers/*/engine/**`. |
| `src/shell/lesson/types.ts` | `Lesson<T, A>`, `NarrativeStep`, `Checkpoint`, `LessonGroupSpec`. |
| `src/shell/lesson/activeStep.ts` | `activeStepIndex` (moved). |
| `src/shell/store.ts` | Zustand: `brokerId`, `lessonId`, `sandbox`, transport state. |
| `src/shell/useSimulation.ts` | Drives the active broker module's simulation from rAF. |
| `src/shell/ui/App.tsx` | Three-column layout; resolves everything through the active module. |
| `src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx` | Broker tab row at the top of the sidebar. |
| `src/shell/ui/LessonSidebar/LessonSidebar.tsx` | Groups + lessons of the active broker, Sandbox button. |
| `src/shell/ui/CanvasView/CanvasView.tsx` | React Flow shell; takes `nodeTypes`/`toFlow`/`inFlight` from the module. |
| `src/shell/ui/canvas/{MessageLayer,geometry}.ts(x)` | Particle overlay, generic over `InFlight`. |
| `src/shell/ui/Inspector/*` | Narrative, checkpoints, journal, issues. Renders issue text via the module. |
| `src/shell/ui/Transport/Transport.tsx` | Play/step/speed/scrub (moved unchanged). |
| `src/brokers/types.ts` | `BrokerModule` interface. |
| `src/brokers/registry.ts` | `BROKERS`, `getBroker`, `DEFAULT_BROKER_ID`. |
| `src/brokers/rabbitmq/engine/**` | Everything from `src/engine/` except rng/clock/run/shared types. |
| `src/brokers/rabbitmq/lessons/**` | The 17 lessons + registry + tests. |
| `src/brokers/rabbitmq/sandbox/**` | Sandbox panel, store, export. |
| `src/brokers/rabbitmq/ui/nodes.tsx` | Publisher/Exchange/Queue/Consumer node components. |
| `src/brokers/rabbitmq/ui/toFlow.ts` | AMQP topology → React Flow nodes/edges. |
| `src/brokers/rabbitmq/ui/InFlightPanel.tsx` | The AMQP state panel. |
| `src/brokers/rabbitmq/ui/issueText.ts` | Vietnamese text per AMQP `ValidationIssueCode`. |
| `src/brokers/rabbitmq/index.ts` | The `BrokerModule` object for RabbitMQ. |

---

### Task 1: Move the RabbitMQ domain code under `src/brokers/rabbitmq/`

Pure relocation. No file contents change except import specifiers.

**Files:**
- Move: `src/engine/` → `src/brokers/rabbitmq/engine/`
- Move: `src/lessons/` → `src/brokers/rabbitmq/lessons/`
- Move: `src/sandbox/` → `src/brokers/rabbitmq/sandbox/`
- Modify: every file that imported them (`src/sim/*`, `src/ui/**`)

**Interfaces:**
- Consumes: nothing.
- Produces: `src/brokers/rabbitmq/engine/index.ts` exporting `createSimulation`, `validateTopology`, and all types exactly as `src/engine/index.ts` does today.

- [ ] **Step 1: Move the three directories**

```bash
mkdir -p src/brokers/rabbitmq
git mv src/engine src/brokers/rabbitmq/engine
git mv src/lessons src/brokers/rabbitmq/lessons
git mv src/sandbox src/brokers/rabbitmq/sandbox
```

- [ ] **Step 2: Fix the purity test's directory constant**

`src/brokers/rabbitmq/engine/purity.test.ts` line 5 currently reads `join(process.cwd(), 'src/engine')`. Change to:

```ts
const ENGINE_DIR = join(process.cwd(), 'src/brokers/rabbitmq/engine')
```

- [ ] **Step 3: Rewrite the import specifiers that crossed the moved boundary**

Inside the moved trees, relative imports between `engine`/`lessons`/`sandbox` keep working (they moved together, preserving relative depth). Only files *outside* the move need fixing:

```bash
# src/sim/*.ts(x) and src/ui/**: '../engine' -> '../brokers/rabbitmq/engine', etc.
grep -rln "from '\(\.\./\)\+\(engine\|lessons\|sandbox\)" src/sim src/ui
```

Apply, in `src/sim/useSimulation.ts`, `src/sim/useSimulation.test.tsx`, `src/sim/store.test.ts`, `src/ui/App.tsx`, `src/ui/App.test.tsx`, `src/ui/CanvasView/*`, `src/ui/canvas/*`, `src/ui/Inspector/*`:

- `'../engine'` → `'../brokers/rabbitmq/engine'` (one level up from `src/sim`)
- `'../../engine'` → `'../../brokers/rabbitmq/engine'` (two levels up, e.g. `src/ui/canvas/`)
- same substitution for `lessons` and `sandbox`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output. If a path is still wrong, `tsc` names the exact file and specifier — fix and rerun.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass, same count as before the move (397).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move the RabbitMQ engine, lessons, and sandbox under src/brokers/rabbitmq"
```

---

### Task 2: Split the UI into shell and broker halves

`src/ui/` today mixes shell chrome (transport, inspector, sidebar, React Flow wrapper) with AMQP-specific rendering (node components, `toFlow`, the in-flight panel, issue text). Separate them.

**Files:**
- Move: `src/sim/store.ts(+test)` → `src/shell/store.ts(+test)`
- Move: `src/sim/useSimulation.ts(+test)` → `src/shell/useSimulation.ts(+test)`
- Move: `src/ui/App.tsx(+test)`, `Transport/`, `Inspector/`, `LessonSidebar/`, `canvas/geometry.ts(+test)`, `canvas/MessageLayer.tsx(+test)`, `CanvasView/CanvasView.tsx` → `src/shell/ui/...`
- Move: `src/ui/CanvasView/nodes.tsx(+test)`, `src/ui/CanvasView/toFlow.ts(+test)`, `src/ui/canvas/InFlightPanel.tsx(+test)`, `src/ui/Inspector/issueText.ts(+test)` → `src/brokers/rabbitmq/ui/`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Task 1's `src/brokers/rabbitmq/engine`.
- Produces: `src/shell/ui/App.tsx` (default export `App`), `src/shell/store.ts` (`useAppStore`), `src/brokers/rabbitmq/ui/{nodes,toFlow,InFlightPanel,issueText}`.

- [ ] **Step 1: Move the shell files**

```bash
mkdir -p src/shell/ui
git mv src/sim/store.ts src/shell/store.ts
git mv src/sim/store.test.ts src/shell/store.test.ts
git mv src/sim/useSimulation.ts src/shell/useSimulation.ts
git mv src/sim/useSimulation.test.tsx src/shell/useSimulation.test.tsx
rmdir src/sim
git mv src/ui/App.tsx src/shell/ui/App.tsx
git mv src/ui/App.test.tsx src/shell/ui/App.test.tsx
git mv src/ui/Transport src/shell/ui/Transport
git mv src/ui/Inspector src/shell/ui/Inspector
git mv src/ui/LessonSidebar src/shell/ui/LessonSidebar
git mv src/ui/CanvasView src/shell/ui/CanvasView
git mv src/ui/canvas src/shell/ui/canvas
rmdir src/ui
```

- [ ] **Step 2: Move the broker-specific UI out of the shell**

```bash
mkdir -p src/brokers/rabbitmq/ui
git mv src/shell/ui/CanvasView/nodes.tsx src/brokers/rabbitmq/ui/nodes.tsx
git mv src/shell/ui/CanvasView/nodes.test.tsx src/brokers/rabbitmq/ui/nodes.test.tsx
git mv src/shell/ui/CanvasView/toFlow.ts src/brokers/rabbitmq/ui/toFlow.ts
git mv src/shell/ui/CanvasView/toFlow.test.ts src/brokers/rabbitmq/ui/toFlow.test.ts
git mv src/shell/ui/canvas/InFlightPanel.tsx src/brokers/rabbitmq/ui/InFlightPanel.tsx
git mv src/shell/ui/canvas/InFlightPanel.test.tsx src/brokers/rabbitmq/ui/InFlightPanel.test.tsx
git mv src/shell/ui/Inspector/issueText.ts src/brokers/rabbitmq/ui/issueText.ts
git mv src/shell/ui/Inspector/issueText.test.ts src/brokers/rabbitmq/ui/issueText.test.ts
```

- [ ] **Step 3: Point `main.tsx` at the new App path**

In `src/main.tsx`, change the App import to:

```ts
import App from './shell/ui/App'
```

- [ ] **Step 4: Fix every remaining import specifier**

Run `npm run typecheck` and fix each error it names. The substitutions are mechanical:

- In `src/shell/**`: `'../sim/store'` / `'./store'` → `'../store'` or `'../../store'` by depth; `'../../engine'` → `'../../brokers/rabbitmq/engine'`.
- `src/shell/ui/CanvasView/CanvasView.tsx` imports `nodes` and `toFlow` from `'../../../brokers/rabbitmq/ui/nodes'` and `'.../toFlow'` — a temporary direct dependency that Task 8 removes.
- `src/shell/ui/Inspector/Inspector.tsx` imports `issueText` from `'../../../brokers/rabbitmq/ui/issueText'` — a temporary direct dependency that Task 9 removes.
- `src/brokers/rabbitmq/ui/*.tsx` import the engine as `'../engine'` and the sandbox store as `'../sandbox/sandboxStore'`.
- `src/brokers/rabbitmq/ui/InFlightPanel.tsx` imports `progressOf`/`TONE_FILL` from `'../../../shell/ui/canvas/geometry'`.

Repeat typecheck until it exits 0.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: 397 passing, unchanged.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add -A
git commit -m "refactor: separate the broker-agnostic shell from the RabbitMQ-specific UI"
```

---

### Task 3: Extract the kernel types

`SimEvent`, `JournalEntry`, and `InFlight` are timing/rendering plumbing, not AMQP concepts. Move them to a kernel that is generic over the broker's event-type union and its message payload.

**Files:**
- Create: `src/shell/kernel/types.ts`
- Create: `src/shell/kernel/types.test.ts`
- Modify: `src/brokers/rabbitmq/engine/types.ts`

**Interfaces:**
- Produces:

```ts
export interface SimEvent<T extends string = string> {
  at: number
  seq: number
  type: T
  payload: Record<string, unknown>
}

export interface JournalEntry {
  at: number
  type: string
  text: string
  nodeId?: string
  messageId?: string
}

export interface FlightMessage {
  id: string
  /** Short label drawn beside the particle. Defaults to `id` when omitted. */
  label?: string
  /** Filled particle when true, outlined when false. */
  solid: boolean
}

export interface InFlight {
  message: FlightMessage
  edgeId: string
  fromT: number
  toT: number
  tone: string
}

export interface ValidationIssueBase {
  nodeId?: string
  severity: 'error' | 'warning'
  message: string
}

export interface KernelState {
  now: number
  seq: number
  rng: RngState
  journal: JournalEntry[]
  halted?: { reason: string }
}
```

- [ ] **Step 1: Write the failing test**

Create `src/shell/kernel/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import type { InFlight, KernelState } from './types'

describe('kernel types', () => {
  it('lets a broker state satisfy KernelState while adding its own fields', () => {
    interface MyState extends KernelState {
      keys: string[]
    }
    const state: MyState = {
      now: 0,
      seq: 0,
      rng: createRng(1),
      journal: [{ at: 0, type: 'command', text: 'SET a 1 -> OK' }],
      keys: ['a'],
    }
    expect(state.journal[0]!.text).toBe('SET a 1 -> OK')
  })

  it('describes a flight without naming any broker concept', () => {
    const flight: InFlight = {
      message: { id: 'm1', solid: true },
      edgeId: 'a->b',
      fromT: 0,
      toT: 100,
      tone: 'sky',
    }
    expect(flight.message.label ?? flight.message.id).toBe('m1')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/kernel/types.test.ts`
Expected: FAIL — `Cannot find module './rng'` / `'./types'`.

- [ ] **Step 3: Move rng and clock, then write the types module**

```bash
mkdir -p src/shell/kernel
git mv src/brokers/rabbitmq/engine/rng.ts src/shell/kernel/rng.ts
git mv src/brokers/rabbitmq/engine/rng.test.ts src/shell/kernel/rng.test.ts
git mv src/brokers/rabbitmq/engine/clock.ts src/shell/kernel/clock.ts
git mv src/brokers/rabbitmq/engine/clock.test.ts src/shell/kernel/clock.test.ts
```

Create `src/shell/kernel/types.ts` with exactly the interfaces listed under **Interfaces** above, prefixed by `import type { RngState } from './rng'`.

Then change `src/shell/kernel/clock.ts` line 1 from `import type { SimEvent } from './types'` to the same specifier now resolving to the kernel's own `types.ts` — no edit needed, the path is already `'./types'`.

- [ ] **Step 4: Re-point the RabbitMQ engine at the kernel**

In `src/brokers/rabbitmq/engine/types.ts`:

- Delete the local `SimEvent`, `JournalEntry`, and `InFlight` declarations.
- Add at the top:

```ts
import type { InFlight, JournalEntry, KernelState, SimEvent } from '../../../shell/kernel/types'
export type { InFlight, JournalEntry }
export type AmqpEvent = SimEvent<SimEventType>
```

- Make `EngineState` extend `KernelState`, keeping every AMQP field and dropping the `now`/`seq`/`rng`/`journal`/`halted` declarations it now inherits:

```ts
export interface EngineState extends KernelState {
  topology: Topology
  queues: Record<NodeId, QueuedMessage[]>
  unacked: Record<NodeId, Message[]>
  roundRobin: Record<NodeId, number>
  inFlight: AmqpInFlight[]
  metrics: Metrics
  crashed: NodeId[]
  crashEpoch: Record<NodeId, number>
  messageCounter: number
}
```

- Keep the AMQP flight record as its own type, because the panel reads AMQP fields off it:

```ts
export interface AmqpInFlight {
  message: Message
  edgeId: string
  fromT: number
  toT: number
  tone: string
}
```

- In `src/brokers/rabbitmq/engine/index.ts`, re-export the kernel's rng/clock so existing importers keep working:

```ts
export { createRng, nextFloat, nextInt, type RngState } from '../../../shell/kernel/rng'
```

- [ ] **Step 5: Fix the remaining import paths**

Run `npm run typecheck`. Files under `src/brokers/rabbitmq/engine/` that imported `'./rng'` or `'./clock'` now import `'../../../shell/kernel/rng'` and `'../../../shell/kernel/clock'`. Fix each until exit 0.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: all pass, including the new `types.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: lift the event, journal, and flight types into the shell kernel"
```

---

### Task 4: Extract the run loop into `createKernel`

The loop in `createSimulation` — drain one timestamp per iteration, enforce the event ceiling, cap the journal — has no AMQP in it. Generalise it so Redis reuses it verbatim.

**Files:**
- Create: `src/shell/kernel/run.ts`
- Create: `src/shell/kernel/run.test.ts`
- Modify: `src/brokers/rabbitmq/engine/index.ts`

**Interfaces:**
- Consumes: `SimEvent`, `KernelState` (Task 3); `Scheduler` helpers from `./clock`.
- Produces:

```ts
export const MAX_EVENTS_PER_RUN = 200_000
export const MAX_JOURNAL = 5_000

export interface Simulation<S> {
  advanceTo(t: number): void
  stepOnce(): void
  reset(): void
  nextEventTime(): number | undefined
  snapshot(): S
}

export interface KernelOptions<S extends KernelState, T extends string> {
  createState(): S
  seedEvents(): SimEvent<T>[]
  reducers: Record<T, (state: S, event: SimEvent<T>) => { state: S; newEvents: SimEvent<T>[] }>
  /** Fills in payload fields only knowable from live state (AMQP crash handling). */
  enrich?(event: SimEvent<T>, current: S): SimEvent<T>
  /** True when validation found a fatal issue: the kernel then never dispatches. */
  fatal?: boolean
  maxEvents?: number
}

export function createKernel<S extends KernelState, T extends string>(
  options: KernelOptions<S, T>,
): Simulation<S>
```

- [ ] **Step 1: Write the failing test**

Create `src/shell/kernel/run.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import { createKernel } from './run'
import type { KernelState, SimEvent } from './types'

type TickType = 'tick'

interface CounterState extends KernelState {
  count: number
}

function base(): CounterState {
  return { now: 0, seq: 0, rng: createRng(1), journal: [], count: 0 }
}

/** Each tick counts once and schedules the next one 10ms later, forever. */
const reducers = {
  tick: (state: CounterState, event: SimEvent<TickType>) => ({
    state: { ...state, count: state.count + 1, journal: [...state.journal, { at: event.at, type: 'tick', text: 'tick' }] },
    newEvents: [{ at: event.at + 10, seq: state.count + 1, type: 'tick' as const, payload: {} }],
  }),
}

describe('createKernel', () => {
  it('applies every event due at or before the target time', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
    })
    sim.advanceTo(25)
    expect(sim.snapshot().count).toBe(3) // 0, 10, 20
    expect(sim.snapshot().now).toBe(25)
  })

  it('stepOnce advances exactly to the next event time', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
    })
    sim.stepOnce()
    sim.stepOnce()
    expect(sim.snapshot().now).toBe(10)
    expect(sim.snapshot().count).toBe(2)
  })

  it('halts with a reason once the event ceiling is reached', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
      maxEvents: 5,
    })
    sim.advanceTo(10_000)
    expect(sim.snapshot().halted?.reason).toContain('event ceiling of 5')
    expect(sim.snapshot().count).toBe(5)
  })

  it('never dispatches when validation was fatal', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
      fatal: true,
    })
    sim.advanceTo(1000)
    expect(sim.snapshot().count).toBe(0)
  })

  it('reset returns to the seeded state and replays identically', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
    })
    sim.advanceTo(50)
    const first = sim.snapshot().count
    sim.reset()
    sim.advanceTo(50)
    expect(sim.snapshot().count).toBe(first)
  })

  it('caps the journal at MAX_JOURNAL entries', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
      maxEvents: 6000,
    })
    sim.advanceTo(100_000)
    expect(sim.snapshot().journal.length).toBeLessThanOrEqual(5000)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/kernel/run.test.ts`
Expected: FAIL — `Cannot find module './run'`.

- [ ] **Step 3: Write `src/shell/kernel/run.ts`**

```ts
import { createScheduler, peekTime, popDue, pushAll, type Scheduler } from './clock'
import type { KernelState, SimEvent } from './types'

export const MAX_EVENTS_PER_RUN = 200_000
export const MAX_JOURNAL = 5_000

export interface Simulation<S> {
  advanceTo(t: number): void
  stepOnce(): void
  reset(): void
  nextEventTime(): number | undefined
  snapshot(): S
}

export interface KernelOptions<S extends KernelState, T extends string> {
  createState(): S
  seedEvents(): SimEvent<T>[]
  reducers: Record<T, (state: S, event: SimEvent<T>) => { state: S; newEvents: SimEvent<T>[] }>
  enrich?(event: SimEvent<T>, current: S): SimEvent<T>
  fatal?: boolean
  maxEvents?: number
}

function capJournal<S extends KernelState>(state: S): S {
  if (state.journal.length <= MAX_JOURNAL) return state
  return { ...state, journal: state.journal.slice(state.journal.length - MAX_JOURNAL) }
}

export function createKernel<S extends KernelState, T extends string>(
  options: KernelOptions<S, T>,
): Simulation<S> {
  let state = options.createState()
  let scheduler: Scheduler<T> = pushAll(createScheduler<T>(), options.seedEvents())
  let processed = 0
  const ceiling = options.maxEvents ?? MAX_EVENTS_PER_RUN

  function run(upTo: number): void {
    // A fatal validation error and a halted run are both terminal: never dispatch.
    if (options.fatal || state.halted) return
    for (;;) {
      // Drain exactly one timestamp per iteration. Events generated while applying
      // "due" land in the scheduler at their own time with a higher seq, so the next
      // iteration picks them up in order instead of leaving them stranded until the
      // whole batch up to `upTo` has been applied.
      const nextTime = peekTime(scheduler)
      if (nextTime === undefined || nextTime > upTo) return
      const [due, rest] = popDue(scheduler, nextTime)
      scheduler = rest
      for (const event of due) {
        // The ceiling counts events across the whole run and must be checked inside
        // this inner loop: a cycle can regenerate events within one popDue batch.
        if (processed >= ceiling) {
          state = { ...state, halted: { reason: `event ceiling of ${ceiling} reached; the topology may loop` } }
          return
        }
        processed++
        const at = { ...state, now: event.at }
        const enriched = options.enrich ? options.enrich(event, at) : event
        const result = options.reducers[event.type](at, enriched)
        state = capJournal(result.state)
        scheduler = pushAll(scheduler, result.newEvents)
      }
    }
  }

  return {
    advanceTo(t) {
      run(t)
      if (!state.halted) state = { ...state, now: Math.max(state.now, t) }
    },
    stepOnce() {
      const next = peekTime(scheduler)
      if (next === undefined) return
      run(next)
      if (!state.halted) state = { ...state, now: next }
    },
    reset() {
      state = options.createState()
      scheduler = pushAll(createScheduler<T>(), options.seedEvents())
      processed = 0
    },
    nextEventTime() {
      return peekTime(scheduler)
    },
    snapshot() {
      return state
    },
  }
}
```

- [ ] **Step 4: Make the scheduler generic over the event type**

In `src/shell/kernel/clock.ts`, parameterise every signature:

```ts
export interface Scheduler<T extends string = string> {
  readonly heap: readonly SimEvent<T>[]
}
export function createScheduler<T extends string = string>(): Scheduler<T> { return { heap: [] } }
export function push<T extends string>(scheduler: Scheduler<T>, event: SimEvent<T>): Scheduler<T> { /* body unchanged */ }
export function pushAll<T extends string>(scheduler: Scheduler<T>, events: readonly SimEvent<T>[]): Scheduler<T> {
  return events.reduce<Scheduler<T>>(push, scheduler)
}
export function peekTime<T extends string>(scheduler: Scheduler<T>): number | undefined { return scheduler.heap[0]?.at }
export function popDue<T extends string>(scheduler: Scheduler<T>, upToInclusive: number): [SimEvent<T>[], Scheduler<T>] { /* body unchanged */ }
```

The internal `before`, `siftUp`, `siftDown`, and `pop` helpers take `SimEvent<T>[]` with the same parameterisation; their bodies do not change.

- [ ] **Step 5: Run the kernel tests**

Run: `npx vitest run src/shell/kernel/`
Expected: PASS — `run.test.ts`, `clock.test.ts`, `rng.test.ts`, `types.test.ts`.

- [ ] **Step 6: Rewrite `createSimulation` on top of the kernel**

In `src/brokers/rabbitmq/engine/index.ts`, replace the body of `createSimulation` (keeping its exported signature and the `issues` property) with:

```ts
export function createSimulation(options: SimulationOptions): Simulation<EngineState> & {
  readonly issues: ValidationIssue[]
} {
  const issues = validateTopology(options.topology)
  const sim = createKernel<EngineState, SimEventType>({
    createState: () => createEngineState(options.topology, options.seed),
    seedEvents: () => seedEvents(options),
    reducers: REDUCERS,
    enrich,
    fatal: issues.some((i) => i.severity === 'error'),
    maxEvents: options.maxEvents,
  })
  return Object.assign(sim, { issues })
}
```

`enrich` moves to module scope (it only needs the event and the state passed in):

```ts
// Crash events need the messages the consumer currently holds, which is only
// knowable at apply time — so it is read from live state here. Never synthesise a
// placeholder message: a blank stand-in would silently "recover" an empty body and
// make Lesson 7 teach the opposite of the truth.
function enrich(event: SimEvent<SimEventType>, current: EngineState): SimEvent<SimEventType> {
  if (event.type !== 'consumerCrash') return event
  const consumerId = event.payload.consumerId as NodeId
  const held = current.unacked[consumerId] ?? []
  return { ...event, payload: { ...event.payload, heldMessages: held } }
}
```

Delete the now-duplicated `capJournal`, `run`, and the local `MAX_EVENTS_PER_RUN`/`MAX_JOURNAL` constants, re-exporting the kernel's instead:

```ts
export { MAX_EVENTS_PER_RUN, MAX_JOURNAL, type Simulation } from '../../../shell/kernel/run'
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all 397+ pass. The engine's own `index.test.ts`, `simulation.test.ts`, and the lesson determinism/snapshot tests are the proof that the extraction changed no behaviour — a snapshot diff here means the loop was altered, not merely moved.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add -A
git commit -m "refactor: extract the discrete-event run loop into the shell kernel"
```

---

### Task 5: Generalise the purity test across all broker engines

**Files:**
- Move: `src/brokers/rabbitmq/engine/purity.test.ts` → `src/shell/kernel/purity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a test that covers `src/shell/kernel/**` and every `src/brokers/*/engine/**` without editing when a broker is added.

- [ ] **Step 1: Write the failing test**

```bash
git mv src/brokers/rabbitmq/engine/purity.test.ts src/shell/kernel/purity.test.ts
```

Replace the file with:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN = [
  /from ['"]react['"]/,
  /from ['"]zustand['"]/,
  /from ['"]@xyflow\/react['"]/,
  /\bMath\.random\s*\(/,
  /\bDate\.now\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bdocument\./,
  /\bwindow\./,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bperformance\.now\s*\(/,
  /\bnew Date\s*\(/,
  /\bsetInterval\s*\(/,
  /\bprocess\./,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return []
    return [full]
  })
}

/** The kernel plus every broker's engine directory, discovered rather than listed. */
function pureDirs(): string[] {
  const brokersDir = join(process.cwd(), 'src/brokers')
  const engines = readdirSync(brokersDir)
    .map((broker) => join(brokersDir, broker, 'engine'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
  return [join(process.cwd(), 'src/shell/kernel'), ...engines]
}

describe('engine purity', () => {
  it('covers the kernel and every broker engine', () => {
    const dirs = pureDirs()
    expect(dirs.some((d) => d.endsWith('src/shell/kernel'))).toBe(true)
    expect(dirs.some((d) => d.endsWith('rabbitmq/engine'))).toBe(true)
  })

  it('imports no UI library and uses no ambient time or randomness', () => {
    const offences: string[] = []
    for (const dir of pureDirs()) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, 'utf8')
        for (const pattern of FORBIDDEN) {
          if (pattern.test(text)) offences.push(`${file} matched ${pattern}`)
        }
      }
    }
    expect(offences).toEqual([])
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/shell/kernel/purity.test.ts`
Expected: PASS both cases. A failure naming a kernel file means Task 4 introduced a forbidden construct — fix the source, not the test.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: extend the purity guard to the kernel and every broker engine"
```

---

### Task 6: Make the `Lesson` type broker-agnostic

**Files:**
- Create: `src/shell/lesson/types.ts`
- Move: `src/shell/ui/Inspector/activeStep.ts(+test)` → `src/shell/lesson/activeStep.ts(+test)`
- Modify: `src/brokers/rabbitmq/lessons/types.ts`
- Create: `src/shell/lesson/types.test.ts`

**Interfaces:**
- Produces:

```ts
export interface NarrativeStep { at: number; title: string; body: string; highlight?: string[] }
export interface Checkpoint { at: number; question: string; options: string[]; answerIndex: number; explanation: string }
export interface LessonGroupSpec { id: string; label: string }

export interface Lesson<TTopology, TAction> {
  id: string
  group: string
  title: string
  summary: string
  topology: TTopology
  script: TAction[]
  narrative: NarrativeStep[]
  checkpoints?: Checkpoint[]
  seed: number
  durationMs: number
}
```

- [ ] **Step 1: Write the failing test**

Create `src/shell/lesson/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Lesson } from './types'

describe('Lesson', () => {
  it('carries a broker-specific topology and script without the shell knowing either', () => {
    interface KeyspaceTopology { keys: string[] }
    interface SetCommand { at: number; key: string; value: string }

    const lesson: Lesson<KeyspaceTopology, SetCommand> = {
      id: '01-strings',
      group: 'basics',
      title: 'String',
      summary: 'Key và value đơn giản nhất.',
      topology: { keys: ['user:1'] },
      script: [{ at: 0, key: 'user:1', value: 'alice' }],
      narrative: [{ at: 0, title: 'SET ghi đè', body: 'Lệnh `SET` ghi đè không cần hỏi.' }],
      seed: 1,
      durationMs: 5000,
    }

    expect(lesson.script[0]!.key).toBe('user:1')
    expect(lesson.narrative[0]!.highlight).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/lesson/types.test.ts`
Expected: FAIL — `Cannot find module './types'`.

- [ ] **Step 3: Write the shell lesson types and re-point RabbitMQ at them**

Create `src/shell/lesson/types.ts` with exactly the interfaces above, each keeping its existing doc comment from `src/brokers/rabbitmq/lessons/types.ts` (`at` is a virtual millisecond; `body` is markdown; `highlight` names canvas node ids; `summary` is the one sentence under the sidebar title).

Then rewrite `src/brokers/rabbitmq/lessons/types.ts` to:

```ts
import type { ScriptedAction, ScriptedFailure, Topology } from '../engine'
import type { Lesson as BaseLesson } from '../../../shell/lesson/types'

export type { Checkpoint, NarrativeStep } from '../../../shell/lesson/types'

export type LessonGroup = 'basics' | 'reliability' | 'dlx' | 'patterns'

/** AMQP adds scripted consumer failures, which no other broker has. */
export interface Lesson extends BaseLesson<Topology, ScriptedAction> {
  group: LessonGroup
  failures?: ScriptedFailure[]
}
```

- [ ] **Step 4: Move `activeStep` into the shell lesson module**

```bash
mkdir -p src/shell/lesson
git mv src/shell/ui/Inspector/activeStep.ts src/shell/lesson/activeStep.ts
git mv src/shell/ui/Inspector/activeStep.test.ts src/shell/lesson/activeStep.test.ts
```

Change its `NarrativeStep` import to `'./types'`, and update the importers named by `npm run typecheck` (`src/shell/ui/App.tsx`, `src/shell/ui/Inspector/Inspector.tsx`) to `'../../lesson/activeStep'`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass, including the new `src/shell/lesson/types.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: make Lesson generic over the broker's topology and script"
```

---

### Task 7: Define the `BrokerModule` contract and the registry

**Files:**
- Create: `src/brokers/types.ts`
- Create: `src/brokers/registry.ts`
- Create: `src/brokers/registry.test.ts`
- Create: `src/brokers/rabbitmq/index.ts`

**Interfaces:**
- Consumes: `Simulation<S>` (Task 4), `Lesson` (Task 6), `InFlight`/`ValidationIssueBase` (Task 3).
- Produces:

```ts
export interface BrokerModule<S extends KernelState, T, A, I extends ValidationIssueBase> {
  id: string
  label: string
  lessonGroups: LessonGroupSpec[]
  lessons: Lesson<T, A>[]
  defaultLessonId: string
  createSimulation(options: {
    topology: T
    script: A[]
    /** Scripted consumer failures. Only AMQP lessons carry them; other brokers ignore this. */
    failures?: unknown[]
    seed: number
    maxEvents?: number
  }): Simulation<S> & { readonly issues: I[] }
  emptyTopology: T
  nodeTypes: NodeTypes
  toFlow(topology: T, state: S, script: A[], highlight?: string[]): { nodes: Node[]; edges: Edge[] }
  inFlight(state: S): InFlight[]
  StatePanel: ComponentType<{ state: S }>
  issueText(issue: I): string
  sandbox?: BrokerSandbox<S, T, A, I>
}

export interface BrokerSandbox<S extends KernelState, T, A, I extends ValidationIssueBase> {
  Panel: ComponentType<{ state: S; issues: I[] }>
  useTopology(): T
  useScript(): A[]
  reset(): void
  maxEvents: number
  transportDurationMs: number
  /** Canvas drag/connect behaviour. Editing an AMQP binding and editing a Redis
   *  subscription share no logic, so the canvas delegates both to the broker. */
  useEditing(topology: T): { onNodesChange: OnNodesChange; onConnect: OnConnect }
}

export type AnyBrokerModule = BrokerModule<any, any, any, any>
```

`AnyBrokerModule` is deliberately loose: the shell stores one selected module in Zustand and renders it, and no shell code inspects `S`, `T`, or `A`. The type parameters exist so each broker's own module file is checked against its real types at definition.

There is deliberately **no** `validate` member. Validation issues already reach the shell as the `issues` property of the returned simulation, and a second entry point would let the two disagree.

- [ ] **Step 1: Write the failing test**

Create `src/brokers/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BROKERS, DEFAULT_BROKER_ID, getBroker } from './registry'

describe('broker registry', () => {
  it('lists RabbitMQ', () => {
    expect(BROKERS.map((b) => b.id)).toContain('rabbitmq')
  })

  it('gives every broker a unique id', () => {
    expect(new Set(BROKERS.map((b) => b.id)).size).toBe(BROKERS.length)
  })

  it('resolves a broker by id and falls back to the default for an unknown one', () => {
    expect(getBroker('rabbitmq').label).toBe('RabbitMQ')
    expect(getBroker('nope').id).toBe(DEFAULT_BROKER_ID)
  })

  it("points every broker's defaultLessonId at a lesson it actually ships", () => {
    for (const broker of BROKERS) {
      expect(broker.lessons.map((l) => l.id)).toContain(broker.defaultLessonId)
    }
  })

  it('declares a group for every lesson it ships', () => {
    for (const broker of BROKERS) {
      const groups = new Set(broker.lessonGroups.map((g) => g.id))
      for (const lesson of broker.lessons) expect(groups.has(lesson.group)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/brokers/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write `src/brokers/types.ts`**

Exactly the interfaces under **Interfaces** above, with these imports:

```ts
import type { ComponentType } from 'react'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import type { Simulation } from '../shell/kernel/run'
import type { InFlight, KernelState, ValidationIssueBase } from '../shell/kernel/types'
import type { Lesson, LessonGroupSpec } from '../shell/lesson/types'
```

- [ ] **Step 4: Write `src/brokers/rabbitmq/index.ts`**

```ts
import { createSimulation, type EngineState, type ScriptedAction, type Topology, type ValidationIssue } from './engine'
import { LESSONS, LESSON_GROUPS } from './lessons/registry'
import { SandboxPanel } from './sandbox/SandboxPanel'
import { useSandboxStore } from './sandbox/sandboxStore'
import { InFlightPanel } from './ui/InFlightPanel'
import { issueText } from './ui/issueText'
import { ConsumerNode, ExchangeNode, PublisherNode, QueueNode } from './ui/nodes'
import { toFlowEdges, toFlowNodes } from './ui/toFlow'
import type { BrokerModule } from '../types'

// A user-built topology can loop (a DLX pointing back into its own source exchange is
// one keystroke away) and, unlike a lesson script, nobody vetted it. A lower ceiling
// makes a runaway surface `state.halted` before it can bog the tab down.
const SANDBOX_MAX_EVENTS = 20_000

// Sandbox runs are open-ended, but the transport scrubber still needs a finite range to
// draw; this matches the generator's fixed 60-second horizon plus headroom.
const SANDBOX_TRANSPORT_DURATION_MS = 60_000

export const rabbitmq: BrokerModule<EngineState, Topology, ScriptedAction, ValidationIssue> = {
  id: 'rabbitmq',
  label: 'RabbitMQ',
  lessonGroups: LESSON_GROUPS,
  lessons: LESSONS,
  defaultLessonId: '01-hello-world',
  emptyTopology: { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] },
  createSimulation: (options) =>
    createSimulation({
      topology: options.topology,
      script: options.script,
      // The shell carries `failures` opaquely (it is AMQP-only); this is the one
      // place that knows what shape it really has.
      failures: options.failures as ScriptedFailure[] | undefined,
      seed: options.seed,
      maxEvents: options.maxEvents,
    }),
  nodeTypes: { publisher: PublisherNode, exchange: ExchangeNode, queue: QueueNode, consumer: ConsumerNode },
  toFlow: (topology, state, script, highlight) => ({
    nodes: toFlowNodes(topology, state, highlight),
    edges: toFlowEdges(topology, script),
  }),
  inFlight: (state) =>
    state.inFlight.map((f) => ({
      message: { id: f.message.id, solid: f.message.persistent },
      edgeId: f.edgeId,
      fromT: f.fromT,
      toT: f.toT,
      tone: f.tone,
    })),
  StatePanel: InFlightPanel,
  issueText,
  sandbox: {
    Panel: SandboxPanel,
    useTopology: () => useSandboxStore((s) => s.topology),
    useScript: () => useSandboxStore((s) => s.script),
    reset: () => useSandboxStore.getState().reset(),
    maxEvents: SANDBOX_MAX_EVENTS,
    transportDurationMs: SANDBOX_TRANSPORT_DURATION_MS,
    useEditing: useRabbitEditing,
  },
}
```

`useRabbitEditing` does not exist yet — Task 10 Step 4 creates it in `src/brokers/rabbitmq/ui/editing.ts` by moving `handleNodesChange`/`handleConnect` out of `CanvasView`. Until then, satisfy the contract with the direct implementation:

```ts
import { useCallback } from 'react'
import type { Connection, NodeChange } from '@xyflow/react'

export function useRabbitEditing(topology: Topology) {
  const updateNode = useSandboxStore((s) => s.updateNode)
  const addBinding = useSandboxStore((s) => s.addBinding)

  // Nodes are always derived from `topology`, so a drag has nowhere to live unless it
  // is written back into the sandbox topology here.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updateNode(change.id, { position: change.position })
        }
      }
    },
    [updateNode],
  )

  // A connection dragged from an exchange's source handle becomes a binding. One from a
  // queue to a consumer instead rewires which queue that consumer reads from — the
  // topology has no other way to express "this edge exists" for that pair.
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      if (topology.exchanges.some((e) => e.id === connection.source)) {
        addBinding(connection.source, connection.target, '')
        return
      }
      if (topology.queues.some((q) => q.id === connection.source)) {
        updateNode(connection.target, { queueId: connection.source })
      }
    },
    [topology, addBinding, updateNode],
  )

  return { onNodesChange, onConnect }
}
```

Put this in `src/brokers/rabbitmq/ui/editing.ts` now (a straight move of the two callbacks currently in `CanvasView.tsx`), and import it here. Task 10 then deletes the originals from `CanvasView`.

- [ ] **Step 5: Write `src/brokers/registry.ts`**

```ts
import { rabbitmq } from './rabbitmq'
import type { AnyBrokerModule } from './types'

export const BROKERS: AnyBrokerModule[] = [rabbitmq]

export const DEFAULT_BROKER_ID = 'rabbitmq'

export function getBroker(id: string): AnyBrokerModule {
  return BROKERS.find((b) => b.id === id) ?? BROKERS.find((b) => b.id === DEFAULT_BROKER_ID)!
}
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run src/brokers/registry.test.ts`
Expected: PASS all five cases.

- [ ] **Step 7: Typecheck, full suite, commit**

```bash
npm run typecheck
npm test
npm run lint
git add -A
git commit -m "feat: add the BrokerModule contract and register RabbitMQ through it"
```

---

### Task 8: Put `brokerId` in the store

**Files:**
- Modify: `src/shell/store.ts`
- Modify: `src/shell/store.test.ts`

**Interfaces:**
- Consumes: `getBroker`, `DEFAULT_BROKER_ID` (Task 7).
- Produces: `AppState.brokerId: string`, `AppState.setBroker(id: string): void`; `setLesson` and `openSandbox` unchanged in behaviour.

- [ ] **Step 1: Write the failing test**

Append to `src/shell/store.test.ts`:

```ts
describe('broker selection', () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

  it('starts on the default broker and its default lesson', () => {
    expect(useAppStore.getState().brokerId).toBe('rabbitmq')
    expect(useAppStore.getState().lessonId).toBe('01-hello-world')
  })

  it('switching broker selects that broker default lesson and leaves the sandbox', () => {
    useAppStore.getState().openSandbox()
    useAppStore.getState().setBroker('rabbitmq')
    const s = useAppStore.getState()
    expect(s.brokerId).toBe('rabbitmq')
    expect(s.lessonId).toBe('01-hello-world')
    expect(s.sandbox).toBe(false)
  })

  it('switching broker rewinds the transport and forces a replay', () => {
    useAppStore.getState().seek(5000)
    useAppStore.getState().play()
    const before = useAppStore.getState().replayToken
    useAppStore.getState().setBroker('rabbitmq')
    const s = useAppStore.getState()
    expect(s.virtualTime).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.selectedNodeId).toBeUndefined()
    expect(s.replayToken).toBe(before + 1)
  })

  it('ignores an unknown broker id rather than stranding the app on a missing module', () => {
    useAppStore.getState().setBroker('kafka')
    expect(useAppStore.getState().brokerId).toBe('rabbitmq')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/store.test.ts`
Expected: FAIL — `setBroker is not a function`.

- [ ] **Step 3: Implement**

In `src/shell/store.ts`, add to the interface and the store:

```ts
import { BROKERS, DEFAULT_BROKER_ID, getBroker } from '../brokers/registry'

// ...inside AppState:
  brokerId: string
  setBroker(id: string): void

// ...inside create<AppState>:
  brokerId: DEFAULT_BROKER_ID,
  lessonId: getBroker(DEFAULT_BROKER_ID).defaultLessonId,

  setBroker(id) {
    // An unknown id would leave the shell rendering a module that does not exist.
    // Ignoring it keeps a stale persisted value or a bad deep link harmless.
    if (!BROKERS.some((b) => b.id === id)) return
    set((s) => ({
      brokerId: id,
      lessonId: getBroker(id).defaultLessonId,
      sandbox: false,
      playing: false,
      virtualTime: 0,
      selectedNodeId: undefined,
      replayToken: s.replayToken + 1,
    }))
  },
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shell/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat(store): track the selected broker alongside the selected lesson"
```

---

### Task 9: Drive `useSimulation` from the active broker module

**Files:**
- Modify: `src/shell/useSimulation.ts`
- Modify: `src/shell/useSimulation.test.tsx`

**Interfaces:**
- Consumes: `getBroker` (Task 7), `brokerId` (Task 8).
- Produces:

```ts
export interface SimulationView {
  state: KernelState
  issues: ValidationIssueBase[]
  stepOnce(): void
}
export function useSimulation(): SimulationView
```

- [ ] **Step 1: Write the failing test**

Append to `src/shell/useSimulation.test.tsx`:

```ts
it('builds the simulation from the active broker module, not a hard-coded engine', () => {
  const { result } = renderHook(() => useSimulation())
  // 01-hello-world publishes at 0, 1500, 3000, 4500 — advancing past the first two
  // must show the module's own engine having produced journal entries.
  act(() => useAppStore.getState().seek(2000))
  expect(result.current.state.journal.length).toBeGreaterThan(0)
  expect(result.current.state.now).toBe(2000)
})

it('rebuilds when the broker changes', () => {
  const { result } = renderHook(() => useSimulation())
  act(() => useAppStore.getState().seek(4000))
  act(() => useAppStore.getState().setBroker('rabbitmq'))
  expect(result.current.state.now).toBe(0)
  expect(result.current.state.journal).toEqual([])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/useSimulation.test.tsx`
Expected: FAIL on the second case — the hook does not depend on `brokerId`, so the rebuild never happens.

- [ ] **Step 3: Implement**

Rewrite the top of `src/shell/useSimulation.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { getBroker } from '../brokers/registry'
import type { AnyBrokerModule } from '../brokers/types'
import type { KernelState, ValidationIssueBase } from './kernel/types'
import { useAppStore } from './store'

export interface SimulationView {
  state: KernelState
  issues: ValidationIssueBase[]
  stepOnce(): void
}

/** Resolves what the engine should run: a lesson's fixed script, or the sandbox draft. */
function useRunInput(broker: AnyBrokerModule) {
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const sandboxTopology = broker.sandbox?.useTopology() ?? broker.emptyTopology
  const sandboxScript = broker.sandbox?.useScript() ?? []
  const lesson = broker.lessons.find((l) => l.id === lessonId)

  if (sandbox && broker.sandbox) {
    return {
      topology: sandboxTopology,
      script: sandboxScript,
      failures: undefined,
      seed: 1,
      maxEvents: broker.sandbox.maxEvents,
      durationMs: Infinity,
    }
  }
  return {
    topology: lesson?.topology ?? broker.emptyTopology,
    script: lesson?.script ?? [],
    failures: (lesson as { failures?: unknown[] } | undefined)?.failures,
    seed: lesson?.seed ?? 0,
    maxEvents: undefined,
    durationMs: lesson?.durationMs ?? Infinity,
  }
}
```

Then in the hook body, replace every `createSimulation({...})` call with `broker.createSimulation(input)` where `broker = getBroker(useAppStore((s) => s.brokerId))`, and add `brokerId` to the rebuild effect's dependency array alongside `sandbox`, `lessonId`, `replayToken`, `sandboxTopology`, `sandboxScript`. Replace the `getLesson(lessonId)` lookup in the rAF loop with the `durationMs` returned by `useRunInput`.

Hooks must not be called conditionally: `useRunInput` calls `broker.sandbox?.useTopology()`, which is a hook call behind an optional. Make it unconditional by requiring every `BrokerSandbox` to provide both accessors (RabbitMQ already does) and by giving the shell a stable no-op pair when a broker has no sandbox:

```ts
// Module scope, so the identity is stable across renders and never retriggers the effect.
const NO_SANDBOX = { useTopology: () => undefined, useScript: () => [] as never[] }
const accessors = broker.sandbox ?? NO_SANDBOX
const sandboxTopology = accessors.useTopology() ?? broker.emptyTopology
const sandboxScript = accessors.useScript()
```

`accessors` changes only when `brokerId` changes, and a broker change already forces a full rebuild, so the hook-order rule is not violated in practice for the module set this app ships.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shell/useSimulation.test.tsx`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Full suite and commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: drive the simulation through the active broker module"
```

---

### Task 10: Render the canvas, state panel, and inspector through the module

**Files:**
- Modify: `src/shell/ui/CanvasView/CanvasView.tsx`
- Modify: `src/shell/ui/canvas/MessageLayer.tsx`
- Modify: `src/shell/ui/canvas/geometry.ts`
- Modify: `src/shell/ui/Inspector/Inspector.tsx`
- Modify: `src/shell/ui/App.tsx`

**Interfaces:**
- Consumes: `BrokerModule.nodeTypes`, `.toFlow`, `.inFlight`, `.StatePanel`, `.issueText`, `.sandbox` (Task 7).
- Produces: `CanvasView` props become `{ broker, topology, state, script, highlight, editable }`; `MessageLayer` props become `{ flights: InFlight[], now: number }`.

- [ ] **Step 1: Write the failing test**

Append to `src/shell/ui/App.test.tsx`:

```ts
it('renders the active broker state panel, not a hard-coded one', () => {
  render(<App />)
  expect(screen.getByTestId('inflight-panel')).toBeTruthy()
})

it('hides the Sandbox button for a broker that ships without one', () => {
  const broker = getBroker('rabbitmq')
  const original = broker.sandbox
  try {
    // A Redis-shaped module may legitimately have no sandbox; the shell must not
    // render a button that leads nowhere.
    ;(broker as { sandbox?: unknown }).sandbox = undefined
    render(<App />)
    expect(screen.queryByTestId('open-sandbox')).toBeNull()
  } finally {
    ;(broker as { sandbox?: unknown }).sandbox = original
  }
})
```

Import `getBroker` from `'../../brokers/registry'` at the top of the test file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/ui/App.test.tsx`
Expected: FAIL on the second case — the sidebar renders the Sandbox button unconditionally.

- [ ] **Step 3: Make `MessageLayer` and `geometry` generic**

`src/shell/ui/canvas/geometry.ts`: change the import to `import type { InFlight } from '../../kernel/types'`. `progressOf`, `pointOnPath`, and `TONE_FILL` are unchanged.

`src/shell/ui/canvas/MessageLayer.tsx`: change the signature to `export function MessageLayer({ flights, now }: { flights: InFlight[]; now: number })`, iterate `flights` instead of `state.inFlight`, call `progressOf(flight, now)`, and read the particle's label and fill style from the kernel flight:

```ts
next.push({
  key: `${flight.message.id}@${flight.edgeId}`,
  x,
  y,
  tone: flight.tone,
  label: flight.message.label ?? flight.message.id,
  solid: flight.message.solid,
})
```

Rename the `persistent` field of the local `Particle` interface to `solid` and use it in the same ternary. Change the `useLayoutEffect` dependency array from `[state]` to `[flights, now]`.

Update `src/shell/ui/canvas/MessageLayer.test.tsx` to pass `flights`/`now` instead of `state`, constructing kernel `InFlight` values directly.

- [ ] **Step 4: Make `CanvasView` take its rendering from the module**

```tsx
export function CanvasView({ broker, topology, state, script = [], highlight, editable = false }: {
  broker: AnyBrokerModule
  topology: unknown
  state: KernelState
  script?: unknown[]
  highlight?: string[]
  editable?: boolean
}) {
  const selectNode = useAppStore((s) => s.selectNode)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)

  const { nodes: rawNodes, edges } = useMemo(
    () => broker.toFlow(topology, state, script, highlight),
    [broker, topology, state, script, highlight],
  )
  const nodes = useMemo(
    () => rawNodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [rawNodes, selectedNodeId],
  )
  const flights = useMemo(() => broker.inFlight(state), [broker, state])
  // ...ReactFlow with nodeTypes={broker.nodeTypes}
  // ...<MessageLayer flights={flights} now={state.now} />
}
```

The drag/connect handlers already moved to `src/brokers/rabbitmq/ui/editing.ts` in Task 7; delete the originals from `CanvasView.tsx` now. `CanvasView` gets them from the module:

```tsx
// Called unconditionally to respect the rules of hooks. A broker with no sandbox gets
// the no-op pair, and the result is ignored entirely when `editable` is false.
const editing = (broker.sandbox?.useEditing ?? NO_EDITING)(topology)
// ...
nodesDraggable={editable}
nodesConnectable={editable}
onNodesChange={editable ? editing.onNodesChange : undefined}
onConnect={editable ? editing.onConnect : undefined}
```

with, at module scope:

```ts
const NO_EDITING = () => ({ onNodesChange: () => {}, onConnect: () => {} })
```

- [ ] **Step 5: Make the Inspector render issue text through the module**

In `src/shell/ui/Inspector/Inspector.tsx`, replace the direct `import { issueText } from '.../rabbitmq/ui/issueText'` with a required prop `issueText: (issue: ValidationIssueBase) => string`, passed down by `App` as `broker.issueText`.

- [ ] **Step 6: Rewrite `App` around the module**

```tsx
export default function App() {
  const brokerId = useAppStore((s) => s.brokerId)
  const broker = getBroker(brokerId)
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = broker.lessons.find((l) => l.id === lessonId)
  const { state, issues, stepOnce } = useSimulation()
  const sandboxTopology = broker.sandbox?.useTopology() ?? broker.emptyTopology
  const sandboxScript = broker.sandbox?.useScript() ?? []
  const inSandbox = sandbox && Boolean(broker.sandbox)

  if (!inSandbox && !lesson) return <div className="p-4 text-slate-200">Không tìm thấy bài học.</div>

  const topology = inSandbox ? sandboxTopology : lesson!.topology
  const script = inSandbox ? sandboxScript : lesson!.script
  const durationMs = inSandbox ? broker.sandbox!.transportDurationMs : lesson!.durationMs
  const highlight = inSandbox
    ? undefined
    : lesson!.narrative[activeStepIndex(lesson!.narrative, state.now)]?.highlight
  const StatePanel = broker.StatePanel
  const SandboxPanel = broker.sandbox?.Panel

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800">
        <LessonSidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <CanvasView broker={broker} topology={topology} state={state} script={script} highlight={highlight} editable={inSandbox} />
        </div>
        <div className="border-t border-slate-800"><StatePanel state={state} /></div>
        <div className="border-t border-slate-800"><Transport durationMs={durationMs} onStep={stepOnce} /></div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        {inSandbox && SandboxPanel ? (
          <SandboxPanel state={state} issues={issues} />
        ) : (
          <Inspector lesson={lesson!} state={state} issues={issues} issueText={broker.issueText} />
        )}
      </aside>
    </div>
  )
}
```

The `SANDBOX_TRANSPORT_DURATION_MS` constant and its comment are deleted here — they now live on the RabbitMQ module (Task 7).

- [ ] **Step 7: Gate the Sandbox button in the sidebar**

In `src/shell/ui/LessonSidebar/LessonSidebar.tsx`, read groups and lessons from the active broker and render the Sandbox button only when the module has one:

```tsx
const broker = getBroker(useAppStore((s) => s.brokerId))
// ...replace LESSON_GROUPS with broker.lessonGroups
// ...replace lessonsByGroup(group.id) with broker.lessons.filter((l) => l.group === group.id)
// ...replace the fixed title with {broker.label}
{broker.sandbox && (
  <button onClick={openSandbox} /* ...unchanged classes and data-testid... */>Sandbox</button>
)}
```

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: all pass. The four existing narrative-highlight and checkpoint cases in `App.test.tsx` are the proof that routing rendering through the module changed nothing.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: render the canvas, state panel, and inspector through the active broker module"
```

---

### Task 11: The broker switcher

**Files:**
- Create: `src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx`
- Create: `src/shell/ui/BrokerSwitcher/BrokerSwitcher.test.tsx`
- Modify: `src/shell/ui/LessonSidebar/LessonSidebar.tsx`

**Interfaces:**
- Consumes: `BROKERS`, `getBroker` (Task 7); `brokerId`, `setBroker` (Task 8).
- Produces: `<BrokerSwitcher />`, rendered at the top of the sidebar with `data-testid="broker-switcher"`; one button per broker with `data-testid="broker-tab"` and `data-broker-id="<id>"`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/ui/BrokerSwitcher/BrokerSwitcher.test.tsx`:

```ts
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BROKERS } from '../../../brokers/registry'
import { useAppStore } from '../../store'
import { BrokerSwitcher } from './BrokerSwitcher'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

describe('BrokerSwitcher', () => {
  it('renders one tab per registered broker', () => {
    render(<BrokerSwitcher />)
    expect(screen.getAllByTestId('broker-tab')).toHaveLength(BROKERS.length)
  })

  it('marks the active broker with aria-current', () => {
    render(<BrokerSwitcher />)
    const active = screen.getByTestId('broker-switcher').querySelector('[aria-current="true"]')
    expect(active?.getAttribute('data-broker-id')).toBe('rabbitmq')
  })

  it('clicking a tab selects that broker', () => {
    render(<BrokerSwitcher />)
    const tab = screen.getAllByTestId('broker-tab')[0]!
    act(() => tab.click())
    expect(useAppStore.getState().brokerId).toBe(tab.getAttribute('data-broker-id'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/ui/BrokerSwitcher/BrokerSwitcher.test.tsx`
Expected: FAIL — `Cannot find module './BrokerSwitcher'`.

- [ ] **Step 3: Implement**

```tsx
import { BROKERS } from '../../../brokers/registry'
import { useAppStore } from '../../store'

/**
 * The one control that swaps the entire workspace: lessons, canvas, state panel, and
 * sandbox all come from the selected module. It sits above the lesson list because the
 * lesson list is meaningless until a broker is chosen.
 */
export function BrokerSwitcher() {
  const brokerId = useAppStore((s) => s.brokerId)
  const setBroker = useAppStore((s) => s.setBroker)

  return (
    <div
      className="flex gap-1 border-b border-slate-800 px-2 py-2"
      role="tablist"
      aria-label="Chọn broker"
      data-testid="broker-switcher"
    >
      {BROKERS.map((broker) => (
        <button
          key={broker.id}
          role="tab"
          aria-current={broker.id === brokerId}
          data-testid="broker-tab"
          data-broker-id={broker.id}
          onClick={() => setBroker(broker.id)}
          className={`flex-1 rounded px-2 py-1 text-xs ${
            broker.id === brokerId
              ? 'bg-slate-800 text-sky-300'
              : 'text-slate-400 hover:bg-slate-900'
          }`}
        >
          {broker.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Mount it in the sidebar**

In `src/shell/ui/LessonSidebar/LessonSidebar.tsx`, replace the static title line

```tsx
<div className="px-3 py-3 text-sm font-semibold text-slate-200">RabbitMQ Visualizer</div>
```

with

```tsx
<BrokerSwitcher />
<div className="px-3 py-3 text-sm font-semibold text-slate-200">{broker.label}</div>
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass. Note `App.test.tsx`'s first case asserts `screen.getByText('Hello world')`, which is a lesson title and is unaffected; if a case asserted the old sidebar heading text, update it to `broker.label`.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat(ui): add the broker switcher to the top of the sidebar"
```

---

### Task 12: Update the documentation

**Files:**
- Modify: `README.md`
- Modify: `package.json` (the `name` field)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Rename the package**

In `package.json`, change `"name": "rabbitmq-visualizer"` to `"name": "broker-visualizer"`. Nothing imports the package by name; `npm test` proves it.

- [ ] **Step 2: Rewrite the README's structure and "add a lesson" sections**

Replace the "Cấu trúc thư mục" block with:

```
src/shell/kernel/   bộ máy thời gian dùng chung (rng, scheduler, run loop, guard)
src/shell/lesson/   kiểu Lesson, narrative, checkpoint dùng chung
src/shell/ui/       App, broker switcher, sidebar, canvas, inspector, transport
src/brokers/        registry.ts + mỗi broker một thư mục
src/brokers/rabbitmq/  engine, lessons, sandbox, ui của RabbitMQ
```

Replace "Thêm một lesson mới" step 1 with: `Tạo file mới trong src/brokers/<broker>/lessons/`, and step 3 with: thêm vào `LESSONS` của broker đó. Add a new section:

```markdown
## Thêm một broker mới

1. Tạo `src/brokers/<id>/` với `engine/`, `lessons/`, `ui/`, và `index.ts`.
2. `index.ts` export một object kiểu `BrokerModule` (định nghĩa ở `src/brokers/types.ts`).
3. Thêm object đó vào `BROKERS` trong `src/brokers/registry.ts`.

Shell không cần sửa một dòng nào: broker switcher, sidebar, canvas, transport, và
inspector đều đọc từ module. `purity.test.ts` tự động soi `src/brokers/<id>/engine/**`
ngay khi thư mục đó tồn tại.
```

Also update the intro paragraph: the app now teaches more than one broker, and the title line becomes "Broker Visualizer".

- [ ] **Step 3: Verify the documented commands still work**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three exit 0. Confirm the test count reported by vitest and write the real number into the README line that currently says "322 test trên 30 file".

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: describe the multi-broker structure and how to add a broker"
```

---

## Verification

After Task 12, all of the following must hold:

- `npm test` — every test passes, including the pre-existing 397.
- `npm run typecheck` — exit 0.
- `npm run lint` — exit 0.
- `npm run build` — exit 0.
- `npm run dev`, then in the browser: the sidebar shows a broker switcher with one tab (RabbitMQ), every lesson still selects and plays, the sandbox still opens and edits, and message particles still animate.
- `grep -rn "rabbitmq" src/shell/` returns nothing. The shell must not name a broker anywhere.
