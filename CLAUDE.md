# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Broker Visualizer** — a browser-only teaching app for message brokers. A discrete-event
simulation runs entirely in the browser (no real broker, no backend) and is drawn on a
React Flow canvas with a scrubbable virtual clock and a Vietnamese narrative panel.
Two brokers ship today: RabbitMQ (17 lessons + free-form Sandbox + code export) and
Redis (17 lessons, no sandbox, no export).

`README.md` is authoritative and detailed — read it before adding a lesson or a broker.

## Commands

```bash
npm run dev        # Vite dev server (default http://localhost:5173, auto-picks a free port)
npm test           # vitest run — whole suite (~68 files, ~910 tests, ~6s)
npm run test:watch # vitest watch
npm run typecheck  # tsc -b --noEmit — MUST use this script (see below)
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```

Single test file / single test:

```bash
npx vitest run src/brokers/redis/lessons/lessons.test.ts
npx vitest run -t 'name of the test'
```

**Never run `npx tsc --noEmit` directly.** Root `tsconfig.json` is project-references only
with `"files": []`, so a bare `tsc --noEmit` compiles zero files and always exits 0 even
when the code is broken. `npm run typecheck` runs `tsc -b`, which walks
`tsconfig.app.json` / `tsconfig.node.json` / `tsconfig.test.json` and actually checks types.
Note `tsconfig.app.json` *excludes* `*.test.ts(x)`; tests are typechecked by
`tsconfig.test.json`.

## Architecture

Three layers, strictly separated:

```
src/shell/kernel/   virtual-time engine: rng, scheduler (clock.ts), run loop, purity guard
src/shell/lesson/   Lesson / NarrativeStep / Checkpoint types, activeStep, language guard
src/shell/ui/       App, BrokerSwitcher, LessonSidebar, CanvasView, Inspector, Transport
src/shell/store.ts  Zustand app state; useSimulation.ts drives the engine from React
src/brokers/        types.ts (BrokerModule), registry.ts, catalog.ts, one dir per broker
```

### Kernel (`src/shell/kernel/run.ts`)

`createKernel({ createState, seedEvents, reducers, enrich?, fatal?, maxEvents? })` returns a
`Simulation<S>`: `advanceTo(t)` / `stepOnce()` / `reset()` / `nextEventTime()` / `snapshot()`.
It drains **exactly one timestamp per iteration** so events generated while applying a batch
are picked up in order. `MAX_EVENTS_PER_RUN` (200k) halts a looping topology; the journal is
capped at `MAX_JOURNAL` (5k). Every broker state extends `KernelState`
(`now`, `seq`, `rng`, `journal`, `halted?`).

Rewind is `reset()` then `advanceTo(target)` — there is no snapshot history.

### Broker plugin contract (`src/brokers/types.ts`)

A broker is one object of type `BrokerModule<S, T, A, I>` exporting `createSimulation`,
`toNodes`/`toEdges`, `nodeTypes`, `StatePanel`, `NodeConfig`, `metrics`, `issueText`,
`emptyTopology`, plus optional `sandbox` and `ExportDialog`. The shell renders whatever the
module provides — a broker without `sandbox` gets no Sandbox button, without `ExportDialog`
gets no export button. **Adding a broker requires zero changes under `src/shell/`.**

Annotate your module with the *concrete* `BrokerModule<S, T, A, I>`. `AnyBrokerModule`
(`= BrokerModule<any, any, any, any>`) is a shell-only escape hatch for the heterogeneous
`BROKERS` array; using it on your own module erases every type check and turns compile errors
into render-time crashes.

`BrokerSandbox` exposes `getTopology`/`getScript`/`subscribe` as **plain functions, not
hooks**, and `editing.onNodesChange`/`onConnect` likewise. `useSimulation` feeds them to a
fixed pair of `useSyncExternalStore` calls, so the hook count at that call site cannot vary
with which broker is active. Adding a broker-authored hook there breaks the Rules of Hooks
on a broker switch.

### Registry vs catalog — do not merge them

`src/brokers/catalog.ts` holds plain broker facts (`id`, `label`, `defaultLessonId`) and
imports **nothing**. `src/shell/store.ts` reads it. `src/brokers/registry.ts` holds the real
`BROKERS` modules and imports components. The split exists because
`store.ts → registry.ts → rabbitmq/index.ts → SandboxPanel → Inspector → store.ts` was a real
import cycle that resolved `brokerId` to `undefined` at runtime instead of throwing.
`src/shell/store.importOrder.test.ts` guards it. Registering a new broker means editing
**both** files.

### `useSimulation` (`src/shell/useSimulation.ts`)

The React↔engine bridge, and the most subtle file in the repo. It owns the rAF loop
(virtual time only moves forward), the rebuild effect keyed on `replayToken` +
topology/script identity, and a `brokerId` tag carried alongside the snapshot so one
broker's state is never handed to another's components mid-switch. Its comments explain
each constraint (`EMPTY_SCRIPT` identity, the `useSyncExternalStore` pair) — read them before
touching the effects; several encode fixed infinite-loop bugs.

## Non-negotiable invariants

**Determinism.** Same seed ⇒ byte-identical journal. Inside `src/shell/kernel/**` and every
`src/brokers/<id>/engine/**`: no `Math.random`, no `Date.now`/`new Date`, no
`setTimeout`/`setInterval`/`performance.now`, no `window`/`document`/`process`, no dynamic
`import()`/`require()`, and no importing `react`, `zustand`, or `@xyflow/react`. All randomness
goes through `src/shell/kernel/rng.ts` (mulberry32), which returns `[value, nextRngState]` —
no hidden state. `src/shell/kernel/purity.test.ts` greps for all of it and auto-discovers new
brokers, and fails loudly if a broker has neither `engine/` nor `engine.ts`.

**Topology is immutable input.** `emptyTopology` and the shared lesson node singletons
(`APP`/`WORKER`/`SERVER`, `Object.freeze`d) are one reference reused across every run. An
engine that mutates its topology corrupts every later run.

**Vietnamese copy.** Lesson `summary`, narrative bodies, checkpoint questions/explanations
must contain Vietnamese diacritics and must not contain English function words
(`the|and|with|that|which|from|into|because|however`) outside backticks. `title` may stay
English when it is the bare name of the concept (`Direct exchange`, `RPC`). Broker terminology
(exchange, queue, routing key, ack/nack, prefetch, DLX, TTL, `SCAN`, `maxmemory`, eviction,
cache-aside…) is never translated. Enforced by `src/shell/lesson/language.test.ts` across
every broker in `BROKERS`.

## Adding a lesson

New file in `src/brokers/<broker>/lessons/`, export a `Lesson`-shaped object, add it to that
broker's `LESSONS` array in `lessons/registry.ts`. Nothing else — `lessons.test.ts` iterates
`LESSONS` with `it.each`, so the new lesson is automatically checked for topology validity
(no `error`-severity `ValidationIssue`), determinism (run twice, compare journals), and
per-broker invariants. Both brokers narrow `group` to a union type
(RabbitMQ: `basics|reliability|dlx|patterns`; Redis: `basics|cache|messaging|advanced`), so a
bad group is a compile error. `failures?` is the field name the shell reads generically for
scripted faults — keep that name, not `faults`.

RabbitMQ lessons have snapshot coverage in `lessons/__snapshots__/lessons.test.ts.snap`.

## Style notes

- Comments in this codebase explain *why*, and frequently document a bug that was already
  fixed. Preserve them; match their density when adding code.
- Strict TS settings are on, including `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly`. Use `import type` for type-only imports.
- Design docs and plans live in `docs/superpowers/{specs,plans}/`.
