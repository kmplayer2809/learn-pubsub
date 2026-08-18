# Redis Advanced Lesson Group (Phase 6a + 6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill Redis's empty `advanced` lesson group with six lessons — transactions, Lua atomicity, distributed lock, sliding-window rate limit, RDB vs AOF, replication/Sentinel/cluster hash slot — each backed by real engine behaviour, not narrative-only content.

**Architecture:** Phase 6a adds command handlers that need no topology change (`MULTI`/`EXEC`/`DISCARD`/`WATCH`, a mini Lua interpreter for `EVAL`, two new zset range commands) plus four lessons. Phase 6b extends `RedisTopology`/`RedisServerSpec` with replicas, sentinels, and a persistence mode, adds five new kernel event types for crash/restart/snapshot/replicate/failover, two new UI node types, and the remaining two lessons.

**Tech Stack:** TypeScript, Vitest, the existing Redis engine's pure-reducer kernel (`src/shell/kernel/`), React Flow for canvas nodes.

## Global Constraints

- Every command handler is `(context: CommandContext) => CommandResult` and lives in `src/brokers/redis/engine/commands/*.ts`, merged into the single `HANDLERS` table in `src/brokers/redis/engine/commands/index.ts`. `RedisCommandName` is `keyof typeof HANDLERS` — adding a handler to that table is the entire registration step, no separate literal-union file to edit.
- The engine never mutates state in place; every function takes a state and returns a new one. No `Math.random`, `Date.now`, `new Date`, `setTimeout`/`setInterval`/`performance.now`, and no import of React/Zustand/`@xyflow/react` anywhere under `src/brokers/redis/engine/**` — `purity.test.ts` greps for this automatically the moment a file exists there, no test edit needed.
- Lesson narrative bodies and summaries are Vietnamese (with diacritics, no stray English connective words); Redis and programming terms stay in English (transaction, watch, atomic, distributed lock, rate limit, snapshot, replica, failover, hash slot, script, queue...). Titles may stay English when they are the plain name of the concept. Read `src/shell/lesson/language.test.ts` before writing lesson copy — it enforces this automatically on every lesson in `LESSONS`.
- Every lesson needs: unique `id` (`NN-slug`), `group: 'advanced'`, `title`, `summary`, `seed`, `durationMs`, `topology`, `script`, `narrative` (every `NarrativeStep.at <= durationMs`, every `highlight` id must exist in the topology), and at least one `checkpoint` (`at <= durationMs`, `answerIndex` inside `options`). `src/brokers/redis/lessons/lessons.test.ts` (`it.each` over `LESSONS`) checks all of this automatically for any lesson added to the registry — no test edit needed there either, only the "ships N lessons" count assertion at the bottom of that file needs updating each phase.
- Run `npm test`, `npm run typecheck`, `npm run lint` after every task; all three must be green before committing. Commit after each task, on its own.
- **Deviation from the committed design doc** (`docs/superpowers/specs/2026-08-14-redis-advanced-design.md`), decided during file-structure research in this plan — noted here so the two documents don't silently disagree:
  - The design doc names the fault-injection field `faults?: RedisFault[]`. The shell's simulation hook (`src/shell/useSimulation.ts:95`) reads `(lesson as { failures?: unknown[] }).failures` **by that exact literal name** to pass scripted faults into `createSimulation` generically for *any* broker — that mechanism is what lets `src/shell/` stay untouched (the repo's own hard rule, see README "Thêm một broker mới"). Task 15 therefore names the field `failures?: RedisFault[]` on `RedisLesson`, not `faults?`. Everything else about the mechanism (shape, semantics, `RedisFault`) is unchanged from the design doc.
  - `RedisServerSpec.persistence.rdb` drops the design doc's `changes` sub-field. Modelling a write-count-triggered snapshot needs hooking every write path to check a threshold; a fixed `everySec` timer teaches the same "RDB is periodic, not continuous" lesson without that cost. Task 16 defines the trimmed shape.
  - Sentinel failover in this simulation does not compute "which replica has the freshest data" — `RedisFault.kind: 'sentinelFailover'` names the promoted replica directly in its `target` field, and the lesson narrative explains *why* Sentinel would pick that one. Computing it live would require per-replica data snapshots (this simulation keeps one shared dataset, per the design doc's own "replica is a node + a lag, not a second dataset" decision) — out of scope for a teaching simulator, consistent with the design doc's existing "no real cluster resharding" boundary.
  - Lesson 16 ("RDB vs AOF") ships as a single RDB-only server, not a live side-by-side RDB server and AOF server. `RedisTopology.server` is singular — there is no second server to represent an `aof: 'everysec'` node running the same script in parallel. The RDB-vs-AOF comparison the design doc envisioned is instead covered by the lesson's checkpoint question, which asks what would happen to the same crash-in-the-gap scenario under `aof: 'always'` hypothetically, rather than by running two servers side by side.

---

## File Structure

**Phase 6a — no topology change:**

| File | Responsibility |
| --- | --- |
| `engine/keyspace.ts` (modify) | Version-stamp every key mutation so `WATCH`/`EXEC` can detect a changed key. |
| `engine/types.ts` (modify) | `RedisState.keyVersions`, `.txQueues`, `.watched`. |
| `engine/commands/tx.ts` (new) | `MULTI`/`EXEC`/`DISCARD`/`WATCH` handlers. |
| `engine/index.ts` (modify) | Intercept dispatch in `applyReply`: queue instead of run while a client is mid-`MULTI`. |
| `engine/lua/lex.ts` (new) | Tokeniser for the supported Lua subset. |
| `engine/lua/parse.ts` (new) | Recursive-descent parser: tokens → AST. |
| `engine/lua/eval.ts` (new) | Tree-walking evaluator: AST + `{KEYS, ARGV, call}` → a Lua value. Redis-agnostic — never imports `Reply`. |
| `engine/commands/script.ts` (new) | `EVAL` handler: bridges the interpreter to `HANDLERS`, converts `Reply` ⇄ Lua value. |
| `engine/commands/zset.ts` (modify) | Add `ZREMRANGEBYSCORE`, `ZCOUNT`. |
| `engine/commands/index.ts` (modify) | Merge `tx.handlers` and `script.handlers` into `HANDLERS`. |
| `lessons/12-transactions.ts` .. `15-rate-limit.ts` (new) | The four 6a lessons. |
| `lessons/registry.ts` (modify) | Register the four lessons. |
| `lessons/advanced.test.ts` (new) | Per-lesson behaviour tests, in the style of `cache.test.ts`. |
| `README.md` (modify) | Update the Redis lesson count / group description. |

**Phase 6b — extends the topology:**

| File | Responsibility |
| --- | --- |
| `engine/types.ts` (modify further) | `RedisServerSpec.persistence`, `RedisTopology.replicas`/`.sentinels`, `RedisState.replicaState`/`.primaryId`/`.lastSnapshot`/`.writeCounter`/`.primaryDown`. |
| `engine/keyspace.ts` (modify further) | The version-bump helper also bumps `writeCounter`. |
| `engine/memory.ts` (modify) | `recomputeMemoryMetrics` — rebuilds `keysCount`/`memoryUsed` after a crash restore replaces the keyspace wholesale. |
| `engine/crc16.ts` (new) | `crc16`/`keySlot` — pure hash-slot computation, no engine state. |
| `engine/commands/server.ts` (modify) | `CLUSTER KEYSLOT`, `BGSAVE`, `REPLICAOF`. |
| `engine/index.ts` (modify further) | New event types (`snapshotWrite`, `crash`, `restart`, `replicate`, `sentinelFailover`), their reducers, and turning `RedisLesson.failures` into seeded events. |
| `lessons/types.ts` (modify) | `RedisFault`, `RedisLesson.failures?`. |
| `index.ts` (modify) | Forward `options.failures` into `createRedisSimulation`; register the two new node types. |
| `ui/nodes.tsx` (modify) | `ReplicaNode`, `SentinelNode`. |
| `ui/toFlow.ts` (modify) | Replica/sentinel nodes and edges. |
| `lessons/16-persistence.ts`, `17-replication.ts` (new) | The remaining two lessons. |
| `lessons/registry.ts` (modify further) | Register the two lessons. |
| `lessons/advanced.test.ts` (modify further) | Behaviour tests for the two lessons. |
| `README.md` (modify further) | Final Redis lesson count. |

---

## Phase 6a

### Task 1: Key version tracking

**Files:**
- Modify: `src/brokers/redis/engine/types.ts`
- Modify: `src/brokers/redis/engine/keyspace.ts`
- Modify: `src/brokers/redis/engine/index.ts` (`createState`)
- Test: `src/brokers/redis/engine/keyspace.test.ts`

**Interfaces:**
- Produces: `RedisState.keyVersions: Record<string, number>`; `touchKey(state: RedisState, key: string): RedisState` (exported from `keyspace.ts`) — bumps `keyVersions[key]` by 1, creating the entry at 1 if absent.

- [ ] **Step 1: Write the failing test**

```ts
// src/brokers/redis/engine/keyspace.test.ts — add to the existing file
import { touchKey } from './keyspace'

describe('touchKey', () => {
  it('starts a key at version 1 on first touch and increments from there', () => {
    let state = { ...baseState() } // use this file's existing state fixture helper
    state = touchKey(state, 'a')
    expect(state.keyVersions['a']).toBe(1)
    state = touchKey(state, 'a')
    expect(state.keyVersions['a']).toBe(2)
  })
})

describe('writeKey / deleteKey version stamping', () => {
  it('bumps the key version on every write, every eviction, every explicit delete, and every lazy-expiry removal', () => {
    let state = baseState()
    state = writeKey(state, 'k', { type: 'string', value: 'v' }).state
    expect(state.keyVersions['k']).toBe(1)
    state = writeKey(state, 'k', { type: 'string', value: 'v2' }).state
    expect(state.keyVersions['k']).toBe(2)
    state = deleteKey(state, 'k').state
    expect(state.keyVersions['k']).toBe(3)
    // Recreating the key must not restart the counter — a WATCH taken before
    // the delete must still see this as "changed" relative to a version-0 read.
    state = writeKey(state, 'k', { type: 'string', value: 'v3' }).state
    expect(state.keyVersions['k']).toBe(4)
  })

  it('bumps the version of a key removed by lazy expiry inside readKey', () => {
    let state = writeKey(baseState(), 'k', { type: 'string', value: 'v' }, { expiresAt: 100 }).state
    state = { ...state, now: 200 }
    const { state: afterRead } = readKey(state, 'k', 'read')
    expect(afterRead.keyVersions['k']).toBe(2) // 1 from the write, 1 from the lazy-expiry removal
  })
})
```

Check `keyspace.test.ts` for its existing `baseState()`-style fixture before writing this — reuse whatever helper already builds a minimal `RedisState` there rather than inventing a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/keyspace.test.ts`
Expected: FAIL — `touchKey` is not exported / `keyVersions` does not exist on the state fixture's type.

- [ ] **Step 3: Add `keyVersions` to the state shape**

In `src/brokers/redis/engine/types.ts`, add one field to `RedisState`:

```ts
export interface RedisState extends KernelState {
  topology: RedisTopology
  keys: Record<string, KeyRecord>
  keyOrder: string[]
  metrics: RedisMetrics
  inFlight: RedisFlight[]
  blocked: BlockedClient[]
  commandCounter: number
  /** Monotonic per-key counter, bumped on every write, delete, eviction, and
   *  lazy-expiry removal. Never reset when a key is deleted — WATCH stores a
   *  key's version at watch time and EXEC compares it against this map, so a
   *  delete-then-recreate must still read as "changed" even though the new
   *  KeyRecord itself starts fresh. */
  keyVersions: Record<string, number>
}
```

In `src/brokers/redis/engine/index.ts`'s `createState`, add `keyVersions: {}` to the returned object.

- [ ] **Step 4: Add `touchKey` and call it from every removal/write site**

In `src/brokers/redis/engine/keyspace.ts`, add near the top (after the imports):

```ts
/** Bumps `key`'s version. Every place a `KeyRecord` is written, evicted, deleted,
 *  or lazily expired must call this — see the field doc on `RedisState.keyVersions`. */
export function touchKey(state: RedisState, key: string): RedisState {
  return { ...state, keyVersions: { ...state.keyVersions, [key]: (state.keyVersions[key] ?? 0) + 1 } }
}
```

Then thread it through the three existing mutation sites:

1. `readKey`'s lazy-expiry branch — the `nextState` object currently built in the `if (record.expiresAt !== undefined && record.expiresAt < state.now)` block. Wrap: build `nextState` as today, then `return { state: touchKey(nextState, key), record: undefined }`.
2. `writeKey`'s eviction-victim loop — inside `for (const victim of result.keys)`, after `working = { ...working, keys: nextKeys, ... }`, add `working = touchKey(working, victim)`.
3. `writeKey`'s own write — right before the final `return`, change `working` to `touchKey(working, key)` before building `nextState`, or simplest: build `nextState` as today then `return { state: touchKey(nextState, key), oom: false, evicted }`.
4. `deleteKey` — its `nextState` today is the return value; change to `return { state: touchKey(nextState, key), existed: true }`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/keyspace.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green — no other file references `RedisState` exhaustively enough to break from the new field (it's additive).

- [ ] **Step 7: Commit**

```bash
git add src/brokers/redis/engine/types.ts src/brokers/redis/engine/keyspace.ts src/brokers/redis/engine/keyspace.test.ts src/brokers/redis/engine/index.ts
git commit -m "feat(redis): version-stamp every key mutation for WATCH"
```

---

### Task 2: Transactions — `MULTI`/`EXEC`/`DISCARD`/`WATCH`

**Files:**
- Create: `src/brokers/redis/engine/commands/tx.ts`
- Modify: `src/brokers/redis/engine/types.ts` (`RedisState.txQueues`, `.watched`)
- Modify: `src/brokers/redis/engine/index.ts` (`createState`, dispatch interception in `applyReply`)
- Modify: `src/brokers/redis/engine/commands/index.ts` (merge `tx.handlers`)
- Test: `src/brokers/redis/engine/commands/tx.test.ts`

**Interfaces:**
- Consumes: `touchKey`/`keyVersions` (Task 1); `CommandContext`/`CommandHandler`/`CommandResult`/`Reply`/`formatReply` (`../reply`); `HANDLERS`, `isCommandName`, `RedisCommandName` (`./index` — see the circular-import note in Step 3).
- Produces: `handlers` (`MULTI`, `EXEC`, `DISCARD`, `WATCH`) merged into `HANDLERS`; `isInTransaction(state, clientId): boolean` and `queueCommand(state, clientId, name, args): RedisState`, both consumed by `engine/index.ts`'s `applyReply`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/brokers/redis/engine/commands/tx.test.ts
import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../index'
import type { RedisTopology } from '../types'

const topology: RedisTopology = {
  clients: [{ id: 'app', label: 'App', position: { x: 0, y: 0 } }, { id: 'worker', label: 'Worker', position: { x: 0, y: 100 } }],
  server: { id: 'redis', label: 'Redis', position: { x: 200, y: 50 } },
}

function run(script: { at: number; clientId: string; name: string; args: string[] }[]) {
  const sim = createRedisSimulation({ topology, script: script as never, seed: 1 })
  sim.advanceTo(10_000)
  return sim.snapshot()
}

describe('MULTI/EXEC/DISCARD/WATCH', () => {
  it('queues commands issued inside MULTI instead of running them, and replies QUEUED', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'MULTI', args: [] },
      { at: 200, clientId: 'app', name: 'SET', args: ['a', '1'] },
    ])
    const lines = state.journal.map((e) => e.text)
    expect(lines).toContain('SET "a" "1" → QUEUED')
    expect(state.keys['a']).toBeUndefined() // never actually ran
  })

  it('runs every queued command atomically on EXEC, in order', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'MULTI', args: [] },
      { at: 200, clientId: 'app', name: 'SET', args: ['a', '1'] },
      { at: 400, clientId: 'app', name: 'INCR', args: ['a'] },
      { at: 600, clientId: 'app', name: 'EXEC', args: [] },
    ])
    expect(state.keys['a']!.value).toEqual({ type: 'string', value: '2' })
    const execLine = state.journal.find((e) => e.text.startsWith('EXEC'))!
    expect(execLine.text).toBe('EXEC → 1) OK 2) (integer) 2')
  })

  it('aborts EXEC with a nil reply when a watched key changed since WATCH, and runs nothing', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'SET', args: ['balance', '100'] },
      { at: 200, clientId: 'app', name: 'WATCH', args: ['balance'] },
      { at: 400, clientId: 'worker', name: 'SET', args: ['balance', '999'] },
      { at: 700, clientId: 'app', name: 'MULTI', args: [] },
      { at: 900, clientId: 'app', name: 'INCR', args: ['balance'] },
      { at: 1100, clientId: 'app', name: 'EXEC', args: [] },
    ])
    const execLine = state.journal.find((e) => e.text.startsWith('EXEC'))!
    expect(execLine.text).toBe('EXEC → (nil)')
    expect(state.keys['balance']!.value).toEqual({ type: 'string', value: '999' }) // INCR never ran
  })

  it('lets EXEC through when the watched key never changed', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'SET', args: ['balance', '100'] },
      { at: 200, clientId: 'app', name: 'WATCH', args: ['balance'] },
      { at: 400, clientId: 'app', name: 'MULTI', args: [] },
      { at: 600, clientId: 'app', name: 'INCR', args: ['balance'] },
      { at: 800, clientId: 'app', name: 'EXEC', args: [] },
    ])
    expect(state.keys['balance']!.value).toEqual({ type: 'string', value: '101' })
  })

  it('errors EXEC without a matching MULTI, and DISCARD without one', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'EXEC', args: [] },
      { at: 200, clientId: 'app', name: 'DISCARD', args: [] },
    ])
    const lines = state.journal.map((e) => e.text)
    expect(lines).toEqual(['EXEC → (error) ERR EXEC without MULTI', 'DISCARD → (error) ERR DISCARD without MULTI'])
  })

  it('DISCARD drops the queue without running it', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'MULTI', args: [] },
      { at: 200, clientId: 'app', name: 'SET', args: ['a', '1'] },
      { at: 400, clientId: 'app', name: 'DISCARD', args: [] },
    ])
    expect(state.keys['a']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/commands/tx.test.ts`
Expected: FAIL — `MULTI`/`EXEC`/`DISCARD`/`WATCH` are not recognised command names, so `createRedisSimulation` reports a fatal `unknown-command` validation issue and nothing runs.

- [ ] **Step 3: Add `txQueues`/`watched` to state, and write `tx.ts`**

In `src/brokers/redis/engine/types.ts`, add two fields next to `keyVersions`:

```ts
export interface QueuedCommand {
  name: string
  args: string[]
}

export interface WatchedKey {
  key: string
  version: number
}

export interface RedisState extends KernelState {
  // ...existing fields, plus:
  /** Presence of a `clientId` entry (even an empty array) means that client is
   *  between MULTI and EXEC/DISCARD. `engine/index.ts`'s `applyReply` checks
   *  this before dispatching a command. */
  txQueues: Record<string, QueuedCommand[]>
  watched: Record<string, WatchedKey[]>
}
```

In `engine/index.ts`'s `createState`, add `txQueues: {}, watched: {}`.

Create `src/brokers/redis/engine/commands/tx.ts`:

```ts
import { HANDLERS, isCommandName } from './index'
import type { CommandContext, CommandHandler, CommandResult, Reply } from '../reply'
import { formatReply } from '../reply'
import type { NodeId, RedisState } from '../types'

/**
 * `HANDLERS` is imported from `./index`, which is the module that builds
 * `HANDLERS` by merging this file's own `handlers` export into it — a genuine
 * circular import. It works because ES module bindings are live: this file
 * only *reads* `HANDLERS` from inside `exec`'s function body, never at module
 * top level, and by the time any script actually runs (long after the whole
 * module graph has finished loading), `./index`'s `HANDLERS` constant has
 * been fully assigned. `Step 5` below runs `EXEC` through the simulation as
 * a check that this is really true in this build, not just in theory.
 */

export function isInTransaction(state: RedisState, clientId: NodeId): boolean {
  return clientId in state.txQueues
}

export function queueCommand(state: RedisState, clientId: NodeId, name: string, args: string[]): RedisState {
  const existing = state.txQueues[clientId] ?? []
  return { ...state, txQueues: { ...state.txQueues, [clientId]: [...existing, { name, args }] } }
}

const multi: CommandHandler = (context: CommandContext): CommandResult => {
  if (context.clientId in context.state.txQueues) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR MULTI calls can not be nested' } }
  }
  return {
    state: { ...context.state, txQueues: { ...context.state.txQueues, [context.clientId]: [] } },
    reply: { kind: 'status', value: 'OK' },
  }
}

const discard: CommandHandler = (context: CommandContext): CommandResult => {
  if (!(context.clientId in context.state.txQueues)) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR DISCARD without MULTI' } }
  }
  const nextQueues = { ...context.state.txQueues }
  delete nextQueues[context.clientId]
  const nextWatched = { ...context.state.watched }
  delete nextWatched[context.clientId]
  return { state: { ...context.state, txQueues: nextQueues, watched: nextWatched }, reply: { kind: 'status', value: 'OK' } }
}

/** `WATCH key [key ...]` — records each key's current version. Repeated calls
 *  add to (or refresh) the watched set rather than replacing it, matching real
 *  Redis. Not allowed once inside MULTI, same as real Redis. */
const watch: CommandHandler = (context: CommandContext): CommandResult => {
  if (context.clientId in context.state.txQueues) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR WATCH inside MULTI is not allowed' } }
  }
  const existing = context.state.watched[context.clientId] ?? []
  const merged = [...existing]
  for (const key of context.args) {
    const version = context.state.keyVersions[key] ?? 0
    const index = merged.findIndex((w) => w.key === key)
    if (index === -1) merged.push({ key, version })
    else merged[index] = { key, version }
  }
  return {
    state: { ...context.state, watched: { ...context.state.watched, [context.clientId]: merged } },
    reply: { kind: 'status', value: 'OK' },
  }
}

/**
 * `EXEC` — runs every queued command in order against a single running
 * `state`, all inside this one handler call. `engine/index.ts`'s `applyReply`
 * calls handlers synchronously and schedules no new kernel event for this, so
 * nothing else in the simulation can interleave between the queued commands —
 * that is the entire mechanism behind "MULTI/EXEC is atomic" here.
 */
const exec: CommandHandler = (context: CommandContext): CommandResult => {
  const queued = context.state.txQueues[context.clientId]
  if (queued === undefined) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR EXEC without MULTI' } }
  }

  const nextQueues = { ...context.state.txQueues }
  delete nextQueues[context.clientId]
  const nextWatched = { ...context.state.watched }
  delete nextWatched[context.clientId]
  const cleared: RedisState = { ...context.state, txQueues: nextQueues, watched: nextWatched }

  const watchedKeys = context.state.watched[context.clientId] ?? []
  const dirty = watchedKeys.some((w) => (context.state.keyVersions[w.key] ?? 0) !== w.version)
  if (dirty) return { state: cleared, reply: { kind: 'nil' } }

  let working = cleared
  const replies: Reply[] = []
  for (const command of queued) {
    if (!isCommandName(command.name)) continue // unreachable: only validated commands are ever queued
    const handled = HANDLERS[command.name]({ state: working, clientId: context.clientId, args: command.args, commandId: context.commandId })
    working = handled.state
    replies.push(handled.reply)
  }

  return { state: working, reply: { kind: 'array', value: replies.map(formatReply) } }
}

export const handlers = {
  MULTI: multi,
  EXEC: exec,
  DISCARD: discard,
  WATCH: watch,
} satisfies Record<string, CommandHandler>
```

- [ ] **Step 4: Merge `tx.handlers` into `HANDLERS`, and intercept queuing in `applyReply`**

In `src/brokers/redis/engine/commands/index.ts`, add the import and spread:

```ts
import * as tx from './tx'
// ...
export const HANDLERS = {
  ...string.handlers,
  ...keyspace.handlers,
  ...hash.handlers,
  ...list.handlers,
  ...set.handlers,
  ...zset.handlers,
  ...server.handlers,
  ...tx.handlers,
} satisfies Record<string, CommandHandler>
```

In `src/brokers/redis/engine/index.ts`, add an import: `import { isInTransaction, queueCommand } from './commands/tx'`. Then in `applyReply`, replace:

```ts
  const handled = HANDLERS[name]({ state, clientId, args, commandId })
```

with:

```ts
  const shouldQueue =
    isInTransaction(state, clientId) && name !== 'MULTI' && name !== 'EXEC' && name !== 'DISCARD' && name !== 'WATCH'
  const handled = shouldQueue
    ? { state: queueCommand(state, clientId, name, args), reply: { kind: 'status' as const, value: 'QUEUED' } }
    : HANDLERS[name]({ state, clientId, args, commandId })
```

- [ ] **Step 5: Run tests to verify they pass — this also proves the circular import works**

Run: `npx vitest run src/brokers/redis/engine/commands/tx.test.ts`
Expected: PASS. If `EXEC`'s test fails with something like "`HANDLERS[command.name] is not a function`", the circular-import assumption in Step 3's comment was wrong for this build; fall back to passing a `dispatch: (name, args) => CommandResult` callback into `CommandContext` from `engine/index.ts` instead of having `tx.ts` import `HANDLERS` directly, and thread it through the same way `commandId` already is.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/brokers/redis/engine/commands/tx.ts src/brokers/redis/engine/commands/tx.test.ts src/brokers/redis/engine/commands/index.ts src/brokers/redis/engine/types.ts src/brokers/redis/engine/index.ts
git commit -m "feat(redis): MULTI/EXEC/DISCARD/WATCH"
```

---

### Task 3: Lua lexer

**Files:**
- Create: `src/brokers/redis/engine/lua/lex.ts`
- Test: `src/brokers/redis/engine/lua/lex.test.ts`

**Interfaces:**
- Produces: `Token`, `TokenType`, `LuaSyntaxError`, `lex(source: string): Token[]` — consumed by Task 4's parser.

- [ ] **Step 1: Write the failing test**

```ts
// src/brokers/redis/engine/lua/lex.test.ts
import { describe, expect, it } from 'vitest'
import { lex, LuaSyntaxError } from './lex'

describe('lex', () => {
  it('tokenises numbers, strings, identifiers, and keywords', () => {
    const tokens = lex(`local x = 1 if x == "a" then return true end`)
    expect(tokens.map((t) => t.type)).toEqual([
      'local', 'ident', '=', 'number',
      'if', 'ident', '==', 'string',
      'then', 'return', 'true', 'end', 'eof',
    ])
  })

  it('reads two-character operators as single tokens', () => {
    expect(lex('a ~= b').map((t) => t.type)).toEqual(['ident', '~=', 'ident', 'eof'])
    expect(lex('a <= b').map((t) => t.type)).toEqual(['ident', '<=', 'ident', 'eof'])
  })

  it('skips -- line comments', () => {
    expect(lex('local x = 1 -- a comment\nreturn x').map((t) => t.type)).toEqual([
      'local', 'ident', '=', 'number', 'return', 'ident', 'eof',
    ])
  })

  it('indexes KEYS[1] as ident [ number ]', () => {
    expect(lex('KEYS[1]').map((t) => t.type)).toEqual(['ident', '[', 'number', ']', 'eof'])
  })

  it('throws LuaSyntaxError on an unterminated string', () => {
    expect(() => lex('local x = "abc')).toThrow(LuaSyntaxError)
  })

  it('throws LuaSyntaxError on an unrecognised character', () => {
    expect(() => lex('local x = 1 % 2')).toThrow(LuaSyntaxError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/lua/lex.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `lex.ts`**

```ts
// src/brokers/redis/engine/lua/lex.ts
/**
 * Tokeniser for the subset of Lua this engine's `EVAL` runs — see `eval.ts`'s
 * module doc for exactly which constructs are supported and why. Numbers are
 * integers/decimals only (no hex, no exponents); strings are single- or
 * double-quoted with no escape sequences.
 */
export type TokenType =
  | 'ident' | 'number' | 'string'
  | 'local' | 'if' | 'then' | 'elseif' | 'else' | 'end'
  | 'for' | 'while' | 'do' | 'return'
  | 'and' | 'or' | 'not' | 'true' | 'false' | 'nil'
  | '(' | ')' | '[' | ']' | '.' | ',' | '='
  | '==' | '~=' | '<' | '>' | '<=' | '>='
  | '+' | '-' | '*' | '/'
  | 'eof'

export interface Token {
  type: TokenType
  value: string
  pos: number
}

const KEYWORDS = new Set([
  'local', 'if', 'then', 'elseif', 'else', 'end', 'for', 'while', 'do', 'return',
  'and', 'or', 'not', 'true', 'false', 'nil',
])

export class LuaSyntaxError extends Error {}

export function lex(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = source.length

  while (i < n) {
    const ch = source[i]!

    if (/\s/.test(ch)) { i++; continue }

    if (ch === '-' && source[i + 1] === '-') {
      while (i < n && source[i] !== '\n') i++
      continue
    }

    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < n && /[0-9.]/.test(source[j]!)) j++
      tokens.push({ type: 'number', value: source.slice(i, j), pos: i })
      i = j
      continue
    }

    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < n && source[j] !== quote) j++
      if (j >= n) throw new LuaSyntaxError(`unterminated string starting at ${i}`)
      tokens.push({ type: 'string', value: source.slice(i + 1, j), pos: i })
      i = j + 1
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(source[j]!)) j++
      const word = source.slice(i, j)
      tokens.push({ type: (KEYWORDS.has(word) ? word : 'ident') as TokenType, value: word, pos: i })
      i = j
      continue
    }

    const two = source.slice(i, i + 2)
    if (two === '==' || two === '~=' || two === '<=' || two === '>=') {
      tokens.push({ type: two, value: two, pos: i })
      i += 2
      continue
    }

    if ('()[].,=<>+-*/'.includes(ch)) {
      tokens.push({ type: ch as TokenType, value: ch, pos: i })
      i++
      continue
    }

    throw new LuaSyntaxError(`unexpected character "${ch}" at ${i}`)
  }

  tokens.push({ type: 'eof', value: '', pos: n })
  return tokens
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/lua/lex.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/brokers/redis/engine/lua/lex.ts src/brokers/redis/engine/lua/lex.test.ts
git commit -m "feat(redis): Lua lexer for the EVAL subset"
```

---

### Task 4: Lua parser

**Files:**
- Create: `src/brokers/redis/engine/lua/parse.ts`
- Test: `src/brokers/redis/engine/lua/parse.test.ts`

**Interfaces:**
- Consumes: `lex`, `LuaSyntaxError`, `Token`, `TokenType` (Task 3).
- Produces: `Expr`, `Stmt`, `Program`, `parse(source: string): Program` — consumed by Task 5's evaluator and Task 6's `EVAL` handler.

- [ ] **Step 1: Write the failing test**

```ts
// src/brokers/redis/engine/lua/parse.test.ts
import { describe, expect, it } from 'vitest'
import { parse } from './parse'
import { LuaSyntaxError } from './lex'

describe('parse', () => {
  it('parses a local declaration and a return', () => {
    expect(parse('local x = 1 return x')).toEqual([
      { kind: 'local', name: 'x', expr: { kind: 'number', value: 1 } },
      { kind: 'return', expr: { kind: 'var', name: 'x' } },
    ])
  })

  it('parses redis.call as a field access wrapped in a call', () => {
    const [stmt] = parse(`return redis.call('GET', KEYS[1])`)
    expect(stmt).toEqual({
      kind: 'return',
      expr: {
        kind: 'call',
        callee: { kind: 'field', target: { kind: 'var', name: 'redis' }, name: 'call' },
        args: [
          { kind: 'string', value: 'GET' },
          { kind: 'index', target: { kind: 'var', name: 'KEYS' }, index: { kind: 'number', value: 1 } },
        ],
      },
    })
  })

  it('parses if/elseif/else/end', () => {
    const program = parse(`
      if a == b then
        return 1
      elseif a == c then
        return 2
      else
        return 0
      end
    `)
    expect(program).toHaveLength(1)
    expect(program[0]!.kind).toBe('if')
  })

  it('parses a numeric for loop and a while loop', () => {
    const program = parse(`
      for i = 1, 3 do
        redis.call('DEL', ARGV[i])
      end
      local n = 0
      while n < 3 do
        n = n + 1
      end
    `)
    expect(program[0]!.kind).toBe('forNumeric')
    expect(program[2]!.kind).toBe('while')
  })

  it('respects and/or/comparison/additive/multiplicative precedence', () => {
    const [stmt] = parse('return 1 + 2 * 3 == 7 and true or false')
    // ((1 + (2 * 3)) == 7) and true or false — top node is `or`
    expect(stmt).toEqual({ kind: 'return', expr: expect.objectContaining({ kind: 'binary', op: 'or' }) })
  })

  it('throws LuaSyntaxError on a malformed if with no end', () => {
    expect(() => parse('if a == b then return 1')).toThrow(LuaSyntaxError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/lua/parse.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `parse.ts`**

```ts
// src/brokers/redis/engine/lua/parse.ts
import { lex, LuaSyntaxError, type Token, type TokenType } from './lex'

/**
 * The supported Lua subset, end to end: literals (number/string/bool/nil),
 * `KEYS[n]`/`ARGV[n]` indexing, `redis.call`/`redis.pcall`, `local`,
 * assignment to an already-declared local, `if/elseif/else/end`,
 * `while/do/end`, a numeric `for i = a, b[, step] do end`, and `return`. No
 * function definitions, no string/table library beyond `KEYS`/`ARGV`
 * themselves, no closures — see `eval.ts` for where each of these is enforced
 * at evaluation time.
 */
export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'nil' }
  | { kind: 'var'; name: string }
  | { kind: 'index'; target: Expr; index: Expr }
  | { kind: 'field'; target: Expr; name: string }
  | { kind: 'call'; callee: Expr; args: Expr[] }
  | { kind: 'unary'; op: '-' | 'not'; expr: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }

export type Stmt =
  | { kind: 'local'; name: string; expr: Expr }
  | { kind: 'assign'; name: string; expr: Expr }
  | { kind: 'if'; branches: { cond: Expr; body: Stmt[] }[]; elseBody?: Stmt[] }
  | { kind: 'while'; cond: Expr; body: Stmt[] }
  | { kind: 'forNumeric'; varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[] }
  | { kind: 'return'; expr?: Expr }
  | { kind: 'exprStmt'; expr: Expr }

export type Program = Stmt[]

export function parse(source: string): Program {
  const tokens = lex(source)
  let pos = 0

  const peek = (): Token => tokens[pos]!
  const at = (type: TokenType): boolean => peek().type === type
  const advance = (): Token => tokens[pos++]!
  const expect = (type: TokenType): Token => {
    if (!at(type)) throw new LuaSyntaxError(`expected "${type}" but got "${peek().type}" at ${peek().pos}`)
    return advance()
  }

  function parseProgram(): Program {
    const stmts: Stmt[] = []
    while (!at('eof')) stmts.push(parseStmt())
    return stmts
  }

  function parseBlock(...enders: TokenType[]): Stmt[] {
    const stmts: Stmt[] = []
    while (!enders.some((e) => at(e))) {
      if (at('eof')) throw new LuaSyntaxError(`unexpected end of script, expected one of: ${enders.join(', ')}`)
      stmts.push(parseStmt())
    }
    return stmts
  }

  function parseStmt(): Stmt {
    if (at('local')) {
      advance()
      const name = expect('ident').value
      expect('=')
      return { kind: 'local', name, expr: parseExpr() }
    }
    if (at('if')) {
      advance()
      const branches: { cond: Expr; body: Stmt[] }[] = []
      const cond = parseExpr()
      expect('then')
      branches.push({ cond, body: parseBlock('elseif', 'else', 'end') })
      while (at('elseif')) {
        advance()
        const c = parseExpr()
        expect('then')
        branches.push({ cond: c, body: parseBlock('elseif', 'else', 'end') })
      }
      let elseBody: Stmt[] | undefined
      if (at('else')) {
        advance()
        elseBody = parseBlock('end')
      }
      expect('end')
      return { kind: 'if', branches, elseBody }
    }
    if (at('while')) {
      advance()
      const cond = parseExpr()
      expect('do')
      const body = parseBlock('end')
      expect('end')
      return { kind: 'while', cond, body }
    }
    if (at('for')) {
      advance()
      const varName = expect('ident').value
      expect('=')
      const from = parseExpr()
      expect(',')
      const to = parseExpr()
      let step: Expr | undefined
      if (at(',')) { advance(); step = parseExpr() }
      expect('do')
      const body = parseBlock('end')
      expect('end')
      return { kind: 'forNumeric', varName, from, to, step, body }
    }
    if (at('return')) {
      advance()
      if (at('end') || at('eof') || at('elseif') || at('else')) return { kind: 'return' }
      return { kind: 'return', expr: parseExpr() }
    }
    if (at('ident')) {
      const start = pos
      const name = advance().value
      if (at('=')) {
        advance()
        return { kind: 'assign', name, expr: parseExpr() }
      }
      pos = start
    }
    return { kind: 'exprStmt', expr: parseExpr() }
  }

  function parseExpr(): Expr { return parseOr() }
  function parseOr(): Expr {
    let left = parseAnd()
    while (at('or')) { advance(); left = { kind: 'binary', op: 'or', left, right: parseAnd() } }
    return left
  }
  function parseAnd(): Expr {
    let left = parseComparison()
    while (at('and')) { advance(); left = { kind: 'binary', op: 'and', left, right: parseComparison() } }
    return left
  }
  function parseComparison(): Expr {
    let left = parseAdditive()
    while (at('==') || at('~=') || at('<') || at('>') || at('<=') || at('>=')) {
      const op = advance().type
      left = { kind: 'binary', op, left, right: parseAdditive() }
    }
    return left
  }
  function parseAdditive(): Expr {
    let left = parseMultiplicative()
    while (at('+') || at('-')) {
      const op = advance().type
      left = { kind: 'binary', op, left, right: parseMultiplicative() }
    }
    return left
  }
  function parseMultiplicative(): Expr {
    let left = parseUnary()
    while (at('*') || at('/')) {
      const op = advance().type
      left = { kind: 'binary', op, left, right: parseUnary() }
    }
    return left
  }
  function parseUnary(): Expr {
    if (at('-')) { advance(); return { kind: 'unary', op: '-', expr: parseUnary() } }
    if (at('not')) { advance(); return { kind: 'unary', op: 'not', expr: parseUnary() } }
    return parsePostfix()
  }
  function parsePostfix(): Expr {
    let expr = parsePrimary()
    for (;;) {
      if (at('[')) {
        advance()
        const index = parseExpr()
        expect(']')
        expr = { kind: 'index', target: expr, index }
      } else if (at('.')) {
        advance()
        const name = expect('ident').value
        expr = { kind: 'field', target: expr, name }
      } else if (at('(')) {
        advance()
        const args: Expr[] = []
        if (!at(')')) {
          args.push(parseExpr())
          while (at(',')) { advance(); args.push(parseExpr()) }
        }
        expect(')')
        expr = { kind: 'call', callee: expr, args }
      } else break
    }
    return expr
  }
  function parsePrimary(): Expr {
    if (at('number')) return { kind: 'number', value: Number(advance().value) }
    if (at('string')) return { kind: 'string', value: advance().value }
    if (at('true')) { advance(); return { kind: 'bool', value: true } }
    if (at('false')) { advance(); return { kind: 'bool', value: false } }
    if (at('nil')) { advance(); return { kind: 'nil' } }
    if (at('ident')) return { kind: 'var', name: advance().value }
    if (at('(')) {
      advance()
      const expr = parseExpr()
      expect(')')
      return expr
    }
    throw new LuaSyntaxError(`unexpected token "${peek().type}" at ${peek().pos}`)
  }

  return parseProgram()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/lua/parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/brokers/redis/engine/lua/parse.ts src/brokers/redis/engine/lua/parse.test.ts
git commit -m "feat(redis): Lua recursive-descent parser"
```

---

### Task 5: Lua evaluator

**Files:**
- Create: `src/brokers/redis/engine/lua/eval.ts`
- Test: `src/brokers/redis/engine/lua/eval.test.ts`

**Interfaces:**
- Consumes: `Program`, `Expr`, `Stmt` (Task 4); `parse` (Task 4, test-only).
- Produces: `LuaValue`, `LuaEnv`, `LuaRuntimeError`, `evalProgram(program: Program, env: LuaEnv): LuaValue` — consumed by Task 6's `EVAL` handler.

- [ ] **Step 1: Write the failing test**

```ts
// src/brokers/redis/engine/lua/eval.test.ts
import { describe, expect, it, vi } from 'vitest'
import { parse } from './parse'
import { evalProgram, LuaRuntimeError, type LuaEnv } from './eval'

function env(overrides: Partial<LuaEnv> = {}): LuaEnv {
  return { keys: [], argv: [], call: vi.fn(() => null), ...overrides }
}

describe('evalProgram', () => {
  it('returns nil (null) when the script never returns', () => {
    expect(evalProgram(parse('local x = 1'), env())).toBeNull()
  })

  it('evaluates arithmetic with standard precedence', () => {
    expect(evalProgram(parse('return 1 + 2 * 3'), env())).toBe(7)
  })

  it('resolves KEYS[n] and ARGV[n] as 1-indexed', () => {
    const result = evalProgram(parse('return KEYS[1]'), env({ keys: ['first', 'second'] }))
    expect(result).toBe('first')
  })

  it('runs redis.call through env.call and returns its Lua-side value', () => {
    const call = vi.fn(() => 'ok-value')
    const result = evalProgram(parse(`return redis.call('GET', KEYS[1])`), env({ keys: ['k'], call }))
    expect(call).toHaveBeenCalledWith('GET', ['k'])
    expect(result).toBe('ok-value')
  })

  it('takes the true branch of if/elseif/else and skips the rest', () => {
    const calls: string[] = []
    const call = vi.fn((name: string) => { calls.push(name); return null })
    evalProgram(
      parse(`
        if false then
          redis.call('A')
        elseif true then
          redis.call('B')
        else
          redis.call('C')
        end
      `),
      env({ call }),
    )
    expect(calls).toEqual(['B'])
  })

  it('runs a numeric for loop the right number of times', () => {
    const calls: string[] = []
    const call = vi.fn((_name: string, args: string[]) => { calls.push(args[0]!); return null })
    evalProgram(parse(`for i = 1, 3 do redis.call('DEL', tostringLikeIdentity) end`.replace('tostringLikeIdentity', 'ARGV[i]')), env({ argv: ['x', 'y', 'z'], call }))
    expect(calls).toEqual(['x', 'y', 'z'])
  })

  it('runs a while loop until the condition goes false', () => {
    const result = evalProgram(
      parse(`
        local n = 0
        while n < 5 do
          n = n + 1
        end
        return n
      `),
      env(),
    )
    expect(result).toBe(5)
  })

  it('short-circuits and/or', () => {
    const call = vi.fn(() => null)
    evalProgram(parse(`return false and redis.call('SHOULD_NOT_RUN')`), env({ call }))
    expect(call).not.toHaveBeenCalled()
  })

  it('throws LuaRuntimeError for an undefined variable', () => {
    expect(() => evalProgram(parse('return doesNotExist'), env())).toThrow(LuaRuntimeError)
  })

  it('lets an env.call error propagate as LuaRuntimeError via redis.call, but pcall swallows it', () => {
    const call = vi.fn(() => { throw new LuaRuntimeError('boom') })
    expect(() => evalProgram(parse(`return redis.call('X')`), env({ call }))).toThrow(LuaRuntimeError)
    expect(evalProgram(parse(`return redis.pcall('X')`), env({ call }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/lua/eval.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `eval.ts`**

```ts
// src/brokers/redis/engine/lua/eval.ts
import type { Expr, Program, Stmt } from './parse'

/**
 * A tree-walking evaluator over the AST `parse.ts` produces. Deliberately
 * Redis-agnostic: it never imports `Reply` or anything from `../reply`. The
 * bridge between a Lua value and a Redis reply lives in
 * `commands/script.ts`, which is also the only place that supplies the
 * `call` half of `LuaEnv` (wired to `HANDLERS`).
 *
 * Every `local`/`for`/`while`/`if` body shares one flat scope for the whole
 * script — there is no lexical block scoping, no shadowing, no functions, no
 * closures. That is a real simplification versus Lua (a `local` declared
 * inside an `if` "leaks" out of it here), but the two lessons that use this
 * (`13-lua`, `14-distributed-lock`) do not write scripts that would notice.
 */
export type LuaValue = string | number | boolean | null | LuaValue[]

export class LuaRuntimeError extends Error {}

export interface LuaEnv {
  keys: string[]
  argv: string[]
  /** Runs one Redis command. Throws (a `LuaRuntimeError`, typically) on a
   *  Redis-side error — `redis.call` lets that propagate, `redis.pcall`
   *  catches it and yields nil instead, matching real Redis. */
  call: (name: string, args: string[]) => LuaValue
}

class ReturnSignal {
  constructor(public value: LuaValue) {}
}

function truthy(v: LuaValue): boolean {
  return v !== null && v !== false
}

function toNumber(v: LuaValue): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  throw new LuaRuntimeError(`cannot coerce ${JSON.stringify(v)} to a number`)
}

function toCommandArg(v: LuaValue): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v === null || v === false) return ''
  throw new LuaRuntimeError(`cannot use ${JSON.stringify(v)} as a Redis command argument`)
}

export function evalProgram(program: Program, env: LuaEnv): LuaValue {
  const scope = new Map<string, LuaValue>()
  try {
    execBlock(program, scope, env)
  } catch (signal) {
    if (signal instanceof ReturnSignal) return signal.value
    throw signal
  }
  return null
}

function execBlock(stmts: Stmt[], scope: Map<string, LuaValue>, env: LuaEnv): void {
  for (const stmt of stmts) execStmt(stmt, scope, env)
}

function execStmt(stmt: Stmt, scope: Map<string, LuaValue>, env: LuaEnv): void {
  switch (stmt.kind) {
    case 'local':
    case 'assign':
      scope.set(stmt.name, evalExpr(stmt.expr, scope, env))
      return
    case 'if':
      for (const branch of stmt.branches) {
        if (truthy(evalExpr(branch.cond, scope, env))) {
          execBlock(branch.body, scope, env)
          return
        }
      }
      if (stmt.elseBody) execBlock(stmt.elseBody, scope, env)
      return
    case 'while':
      while (truthy(evalExpr(stmt.cond, scope, env))) execBlock(stmt.body, scope, env)
      return
    case 'forNumeric': {
      const from = toNumber(evalExpr(stmt.from, scope, env))
      const to = toNumber(evalExpr(stmt.to, scope, env))
      const step = stmt.step ? toNumber(evalExpr(stmt.step, scope, env)) : 1
      for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
        scope.set(stmt.varName, i)
        execBlock(stmt.body, scope, env)
      }
      return
    }
    case 'return':
      throw new ReturnSignal(stmt.expr ? evalExpr(stmt.expr, scope, env) : null)
    case 'exprStmt':
      evalExpr(stmt.expr, scope, env)
      return
  }
}

function evalExpr(expr: Expr, scope: Map<string, LuaValue>, env: LuaEnv): LuaValue {
  switch (expr.kind) {
    case 'number': return expr.value
    case 'string': return expr.value
    case 'bool': return expr.value
    case 'nil': return null
    case 'var': {
      if (expr.name === 'KEYS') return env.keys
      if (expr.name === 'ARGV') return env.argv
      if (scope.has(expr.name)) return scope.get(expr.name)!
      throw new LuaRuntimeError(`undefined variable "${expr.name}"`)
    }
    case 'index': {
      const target = evalExpr(expr.target, scope, env)
      const index = toNumber(evalExpr(expr.index, scope, env))
      if (!Array.isArray(target)) throw new LuaRuntimeError('attempt to index a non-table value')
      return target[index - 1] ?? null
    }
    case 'field':
      throw new LuaRuntimeError(`unsupported field access ".${expr.name}" (only redis.call/redis.pcall are supported, as a call)`)
    case 'call': {
      const callee = expr.callee
      if (callee.kind === 'field' && callee.target.kind === 'var' && callee.target.name === 'redis') {
        const fn = callee.name
        if (fn !== 'call' && fn !== 'pcall') throw new LuaRuntimeError(`unsupported "redis.${fn}"`)
        const evaluatedArgs = expr.args.map((a) => evalExpr(a, scope, env))
        const [nameArg, ...restArgs] = evaluatedArgs
        const commandName = toCommandArg(nameArg ?? null).toUpperCase()
        const commandArgs = restArgs.map(toCommandArg)
        try {
          return env.call(commandName, commandArgs)
        } catch (err) {
          if (fn === 'pcall') return null
          throw err
        }
      }
      throw new LuaRuntimeError('only redis.call(...) and redis.pcall(...) may be called')
    }
    case 'unary': {
      const value = evalExpr(expr.expr, scope, env)
      return expr.op === 'not' ? !truthy(value) : -toNumber(value)
    }
    case 'binary': {
      if (expr.op === 'and') {
        const left = evalExpr(expr.left, scope, env)
        return truthy(left) ? evalExpr(expr.right, scope, env) : left
      }
      if (expr.op === 'or') {
        const left = evalExpr(expr.left, scope, env)
        return truthy(left) ? left : evalExpr(expr.right, scope, env)
      }
      const left = evalExpr(expr.left, scope, env)
      const right = evalExpr(expr.right, scope, env)
      switch (expr.op) {
        case '+': return toNumber(left) + toNumber(right)
        case '-': return toNumber(left) - toNumber(right)
        case '*': return toNumber(left) * toNumber(right)
        case '/': return toNumber(left) / toNumber(right)
        case '==': return left === right
        case '~=': return left !== right
        case '<': return toNumber(left) < toNumber(right)
        case '>': return toNumber(left) > toNumber(right)
        case '<=': return toNumber(left) <= toNumber(right)
        case '>=': return toNumber(left) >= toNumber(right)
        default: throw new LuaRuntimeError(`unsupported operator "${expr.op}"`)
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/lua/eval.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/brokers/redis/engine/lua/eval.ts src/brokers/redis/engine/lua/eval.test.ts
git commit -m "feat(redis): Lua tree-walking evaluator"
```

---

### Task 6: `EVAL` command — wiring the interpreter to `HANDLERS`

**Files:**
- Create: `src/brokers/redis/engine/commands/script.ts`
- Modify: `src/brokers/redis/engine/commands/index.ts` (merge `script.handlers`)
- Test: `src/brokers/redis/engine/commands/script.test.ts`

**Interfaces:**
- Consumes: `parse` (Task 4); `evalProgram`, `LuaRuntimeError`, `LuaValue` (Task 5); `LuaSyntaxError` (Task 3); `HANDLERS`, `isCommandName` (`./index`, circular — same pattern as Task 2).
- Produces: `handlers.EVAL` merged into `HANDLERS`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/brokers/redis/engine/commands/script.test.ts
import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../index'
import type { RedisTopology } from '../types'

const topology: RedisTopology = {
  clients: [{ id: 'app', label: 'App', position: { x: 0, y: 0 } }],
  server: { id: 'redis', label: 'Redis', position: { x: 200, y: 50 } },
}

function run(script: { at: number; clientId: string; name: string; args: string[] }[]) {
  const sim = createRedisSimulation({ topology, script: script as never, seed: 1 })
  sim.advanceTo(10_000)
  return sim.snapshot()
}

describe('EVAL', () => {
  it('runs redis.call writes and reads through the real HANDLERS table', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'EVAL', args: [`redis.call('SET', KEYS[1], ARGV[1]) return redis.call('GET', KEYS[1])`, '1', 'k', 'v'] },
    ])
    expect(state.keys['k']!.value).toEqual({ type: 'string', value: 'v' })
    const line = state.journal.find((e) => e.text.startsWith('EVAL'))!
    expect(line.text).toContain('"v"')
  })

  it('is atomic: no other scripted command can observe a partial script', () => {
    // Two clients would be needed to prove interleaving is impossible at the
    // kernel level; this proves the weaker but load-bearing fact that a
    // multi-call script's effects all land together in one journal entry
    // rather than as separate per-call entries.
    const state = run([
      { at: 0, clientId: 'app', name: 'EVAL', args: [`redis.call('SET', 'a', '1') redis.call('SET', 'b', '2') return 'done'`, '0'] },
    ])
    expect(state.keys['a']!.value).toEqual({ type: 'string', value: '1' })
    expect(state.keys['b']!.value).toEqual({ type: 'string', value: '2' })
    expect(state.journal.filter((e) => e.text.includes('SET'))).toHaveLength(0) // no separate SET lines — only the one EVAL line
  })

  it('replies with a compiler error for a syntax error, and does not change state', () => {
    const state = run([{ at: 0, clientId: 'app', name: 'EVAL', args: [`if a ==`, '0'] }])
    const line = state.journal.find((e) => e.text.startsWith('EVAL'))!
    expect(line.text).toContain('(error) ERR Error compiling script')
    expect(state.keys).toEqual({})
  })

  it('replies with a runtime error and keeps whatever ran before the failing call', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'EVAL', args: [`redis.call('SET', 'a', '1') return redis.call('NOTACOMMAND')`, '0'] },
    ])
    expect(state.keys['a']!.value).toEqual({ type: 'string', value: '1' })
    const line = state.journal.find((e) => e.text.startsWith('EVAL'))!
    expect(line.text).toContain('(error) ERR')
  })

  it('implements the compare-and-delete unlock pattern used by the distributed-lock lesson', () => {
    const unlockScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`
    const state = run([
      { at: 0, clientId: 'app', name: 'SET', args: ['lock:x', 'token-a', 'NX'] },
      { at: 200, clientId: 'app', name: 'EVAL', args: [unlockScript, '1', 'lock:x', 'token-b'] }, // wrong token: refused
      { at: 400, clientId: 'app', name: 'EVAL', args: [unlockScript, '1', 'lock:x', 'token-a'] }, // right token: deletes
    ])
    expect(state.keys['lock:x']).toBeUndefined()
    const lines = state.journal.filter((e) => e.text.startsWith('EVAL')).map((e) => e.text)
    expect(lines[0]).toContain('(integer) 0')
    expect(lines[1]).toContain('(integer) 1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/commands/script.test.ts`
Expected: FAIL — `EVAL` is not a recognised command name.

- [ ] **Step 3: Write `script.ts`**

```ts
// src/brokers/redis/engine/commands/script.ts
import { HANDLERS, isCommandName } from './index'
import { LuaSyntaxError } from '../lua/lex'
import { evalProgram, LuaRuntimeError, type LuaValue } from '../lua/eval'
import { parse } from '../lua/parse'
import type { CommandContext, CommandHandler, CommandResult, Reply } from '../reply'

function replyToLua(reply: Reply): LuaValue {
  switch (reply.kind) {
    case 'status': return reply.value
    case 'integer': return reply.value
    case 'bulk': return reply.value
    case 'nil': return false // real Redis maps a nil reply to Lua false
    case 'array': return reply.value
    case 'error': throw new LuaRuntimeError(reply.value)
  }
}

function luaToReply(value: LuaValue): Reply {
  if (value === null || value === false) return { kind: 'nil' }
  if (typeof value === 'number') return { kind: 'integer', value: Math.trunc(value) }
  if (typeof value === 'string') return { kind: 'bulk', value }
  if (Array.isArray(value)) return { kind: 'array', value: value.map((v) => (v === null || v === false ? '' : String(v))) }
  return { kind: 'integer', value: 1 } // bare `true`
}

/**
 * `EVAL script numkeys key [key ...] arg [arg ...]`. Every `redis.call`
 * inside `script` dispatches through the very same `HANDLERS` table every
 * other command uses (see the circular-import note in `commands/tx.ts`,
 * which this file shares) — there is exactly one place command semantics
 * live, never a second implementation for "commands run from Lua".
 *
 * Because this handler runs the whole interpreter synchronously inside one
 * `applyReply` call and schedules no new kernel event, the script's effects
 * all land as a single step nothing else in the simulation can interleave
 * with — the mechanism behind "Lua scripts are atomic" here.
 */
const evalCommand: CommandHandler = (context: CommandContext): CommandResult => {
  const [script, numKeysArg, ...rest] = context.args
  const numKeys = Number(numKeysArg)
  if (!Number.isInteger(numKeys) || numKeys < 0) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR value is not an integer or out of range' } }
  }
  const keys = rest.slice(0, numKeys)
  const argv = rest.slice(numKeys)

  let working = context.state
  try {
    const program = parse(script!)
    const result = evalProgram(program, {
      keys,
      argv,
      call: (name, args) => {
        if (!isCommandName(name)) throw new LuaRuntimeError(`Unknown Redis command called from script: '${name}'`)
        const handled = HANDLERS[name]({ state: working, clientId: context.clientId, args, commandId: context.commandId })
        working = handled.state
        return replyToLua(handled.reply)
      },
    })
    return { state: working, reply: luaToReply(result) }
  } catch (err) {
    if (err instanceof LuaSyntaxError) {
      return { state: context.state, reply: { kind: 'error', value: `ERR Error compiling script: ${err.message}` } }
    }
    if (err instanceof LuaRuntimeError) {
      return { state: working, reply: { kind: 'error', value: `ERR ${err.message}` } }
    }
    throw err
  }
}

export const handlers = {
  EVAL: evalCommand,
} satisfies Record<string, CommandHandler>
```

- [ ] **Step 4: Merge into `HANDLERS`**

In `src/brokers/redis/engine/commands/index.ts`, add `import * as script from './script'` and add `...script.handlers,` to the `HANDLERS` object (alongside `...tx.handlers,` from Task 2).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/brokers/redis/engine/commands/script.test.ts`
Expected: PASS

- [ ] **Step 6: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/brokers/redis/engine/commands/script.ts src/brokers/redis/engine/commands/script.test.ts src/brokers/redis/engine/commands/index.ts
git commit -m "feat(redis): EVAL, bridging the Lua interpreter to HANDLERS"
```

---

### Task 7: `ZREMRANGEBYSCORE` and `ZCOUNT`

**Files:**
- Modify: `src/brokers/redis/engine/commands/zset.ts`
- Modify: `src/brokers/redis/engine/commands/zset.test.ts`

**Interfaces:**
- Produces: `handlers.ZREMRANGEBYSCORE`, `handlers.ZCOUNT` — used by Task 10's rate-limit lesson.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/brokers/redis/engine/commands/zset.test.ts — reuse whatever
// state-building helper the existing tests in this file already use.
describe('ZREMRANGEBYSCORE / ZCOUNT', () => {
  it('removes and counts members with score in [min, max], -inf/+inf included', () => {
    let state = baseState() // reuse this file's own fixture helper
    state = zadd(...) // seed a, b, c at scores 1, 2, 3 the same way this file's existing ZADD tests do

    expect(zcount(state, 'z', '-inf', '2')).toBe(2) // a, b
    const afterRemove = zremrangebyscore(state, 'z', '-inf', '1') // removes a
    expect(zcard(afterRemove, 'z')).toBe(2) // b, c left
  })

  it('returns 0 for a missing key and WRONGTYPE for a non-zset key', () => {
    // mirror the existing WRONGTYPE test pattern already in this file for e.g. ZADD/ZCARD
  })
})
```

Adapt this to however `zset.test.ts` already structures its test helpers (read the file before writing — it was not read while drafting this plan, so match its existing fixture/call style exactly rather than inventing a new one).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/commands/zset.test.ts`
Expected: FAIL — `ZREMRANGEBYSCORE`/`ZCOUNT` not exported.

- [ ] **Step 3: Add the two handlers**

In `src/brokers/redis/engine/commands/zset.ts`, add after `zcard`:

```ts
function parseScoreBound(arg: string): number {
  if (arg === '-inf') return -Infinity
  if (arg === '+inf') return Infinity
  return Number(arg)
}

/** `ZREMRANGEBYSCORE key min max` — removes members whose score falls in [min, max]. */
const zremrangebyscore: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, minArg, maxArg] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  if (!record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'zset') return { state: afterRead, reply: wrongTypeReply() }

  const min = parseScoreBound(minArg!)
  const max = parseScoreBound(maxArg!)
  const kept = record.value.value.filter((e) => e.score < min || e.score > max)
  const removed = record.value.value.length - kept.length
  if (removed === 0) return { state: afterRead, reply: { kind: 'integer', value: 0 } }

  const result = writeKey(afterRead, key!, { type: 'zset', value: kept })
  return { state: result.state, reply: { kind: 'integer', value: removed } }
}

/** `ZCOUNT key min max` — counts members whose score falls in [min, max]. */
const zcount: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, minArg, maxArg] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'zset') return { state, reply: wrongTypeReply() }

  const min = parseScoreBound(minArg!)
  const max = parseScoreBound(maxArg!)
  const count = record.value.value.filter((e) => e.score >= min && e.score <= max).length
  return { state, reply: { kind: 'integer', value: count } }
}
```

Add both to the `handlers` export at the bottom: `ZREMRANGEBYSCORE: zremrangebyscore, ZCOUNT: zcount,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/commands/zset.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/brokers/redis/engine/commands/zset.ts src/brokers/redis/engine/commands/zset.test.ts
git commit -m "feat(redis): ZREMRANGEBYSCORE, ZCOUNT for sliding-window rate limiting"
```

---

### Task 8: Lessons 12–13 — Transactions, Lua atomicity

**Files:**
- Create: `src/brokers/redis/lessons/12-transactions.ts`
- Create: `src/brokers/redis/lessons/13-lua.ts`
- Modify: `src/brokers/redis/lessons/registry.ts`
- Modify: `src/brokers/redis/lessons/lessons.test.ts` (bump the "ships N lessons" count and id list)

**Interfaces:**
- Consumes: `APP`, `WORKER`, `SERVER`, `RedisLesson` (`./types`).
- Produces: `transactions`, `lua` lesson objects, added to `LESSONS`.

- [ ] **Step 1: Write `12-transactions.ts`**

```ts
import { APP, SERVER, WORKER } from './types'
import type { RedisLesson } from './types'

export const transactions: RedisLesson = {
  id: '12-transactions',
  group: 'advanced',
  title: 'Transactions',
  summary:
    '`MULTI`/`EXEC` gộp nhiều lệnh thành một bước duy nhất; `WATCH` huỷ `EXEC` nếu `key` đang theo dõi đổi giữa chừng.',
  seed: 12,
  durationMs: 3500,
  topology: { clients: [APP, WORKER], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['balance:1', '100'] },
    { at: 300, clientId: APP.id, name: 'MULTI', args: [] },
    { at: 500, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 700, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 900, clientId: APP.id, name: 'EXEC', args: [] },
    { at: 1400, clientId: APP.id, name: 'WATCH', args: ['balance:1'] },
    { at: 1600, clientId: WORKER.id, name: 'SET', args: ['balance:1', '999'] },
    { at: 2000, clientId: APP.id, name: 'MULTI', args: [] },
    { at: 2200, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 2400, clientId: APP.id, name: 'EXEC', args: [] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Lệnh bên trong MULTI chỉ xếp hàng, chưa chạy',
      body: 'Từ lúc `MULTI` tới trước `EXEC`, mỗi lệnh gửi lên chỉ nhận `QUEUED` — chưa hề đụng vào `key` nào cả.',
      highlight: ['app', 'redis'],
    },
    {
      at: 900,
      title: 'EXEC chạy trọn khối một lượt',
      body: 'Cả hai `INCR` chạy liền nhau trong đúng một bước — không command nào khác của client khác chen được vào giữa.',
      highlight: ['redis'],
    },
    {
      at: 1400,
      title: 'WATCH đặt một điều kiện, không phải một khoá',
      body: '`WATCH` không chặn `worker` ghi đè `balance:1` — nó chỉ ghi nhớ phiên bản hiện tại của `key` để `EXEC` so sánh lại sau.',
      highlight: ['app'],
    },
    {
      at: 1600,
      title: 'worker ghi đè ngay trong lúc app đang theo dõi',
      body: '`worker` không biết và không cần biết `app` đang `WATCH` — đây chính là race condition mà `WATCH` được sinh ra để phát hiện.',
      highlight: ['worker', 'redis'],
    },
    {
      at: 2400,
      title: 'EXEC lần hai bị huỷ',
      body: '`balance:1` đã đổi kể từ lúc `WATCH` — `EXEC` từ chối chạy khối lệnh, trả về nil thay vì âm thầm ghi đè lên giá trị mà `worker` vừa đặt.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 3200,
      question: 'worker ghi đè balance:1 trong lúc app đang WATCH nó. EXEC của app sau đó làm gì?',
      options: ['Chạy bình thường, đè lên giá trị của worker', 'Từ chối chạy, trả về nil', 'Báo lỗi và crash'],
      answerIndex: 1,
      explanation: '`EXEC` so phiên bản của `balance:1` tại lúc `WATCH` với phiên bản hiện tại — lệch nhau thì huỷ toàn bộ khối lệnh, trả về nil, không chạy gì.',
    },
  ],
}
```

- [ ] **Step 2: Write `13-lua.ts`**

```ts
import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

const script = `redis.call('SET', KEYS[1], ARGV[1]) local n = tonumber(redis.call('GET', KEYS[2]) or '0') redis.call('SET', KEYS[2], n + 1) return n + 1`

export const lua: RedisLesson = {
  id: '13-lua',
  group: 'advanced',
  title: 'Lua atomicity',
  summary:
    '`EVAL` chạy nguyên khối script không bị chen ngang — đối chiếu trực tiếp với hai lệnh rời làm cùng việc, nơi race condition có thể lọt vào giữa.',
  seed: 13,
  durationMs: 2000,
  topology: { clients: [APP], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['seq:name', 'first'] },
    { at: 300, clientId: APP.id, name: 'EVAL', args: [`redis.call('SET', KEYS[1], ARGV[1]) return redis.call('GET', KEYS[1])`, '1', 'seq:name', 'second'] },
    { at: 700, clientId: APP.id, name: 'EVAL', args: [`local ok = redis.call('GET', KEYS[1]) if ok == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`, '1', 'seq:name', 'second'] },
    { at: 1100, clientId: APP.id, name: 'GET', args: ['seq:name'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Một script, nhiều redis.call, một bước duy nhất',
      body: 'Bên trong `EVAL`, mỗi `redis.call` chạy qua đúng bộ xử lý lệnh mà mọi lệnh khác dùng — nhưng toàn bộ script tính là một bước, không command nào khác chen được vào giữa hai `redis.call` liên tiếp.',
      highlight: ['app', 'redis'],
    },
    {
      at: 700,
      title: 'Check-rồi-hành-động an toàn bên trong script',
      body: 'Đọc giá trị rồi quyết định có xoá hay không — làm bằng hai lệnh rời (`GET` xong `DEL`) sẽ có khoảng hở cho client khác chen vào giữa; gói cả hai vào một `EVAL` thì khoảng hở đó biến mất.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 1800,
      question: 'Vì sao gói "GET rồi DEL" vào một EVAL an toàn hơn gọi hai lệnh GET và DEL rời nhau?',
      options: [
        'Vì EVAL chạy nhanh hơn nên ít có cơ hội bị chen',
        'Vì cả script tính là một bước không thể chia cắt, không command nào khác chen được vào giữa GET và DEL',
        'Vì EVAL tự động khoá key lại trong lúc chạy',
      ],
      answerIndex: 1,
      explanation: 'Tốc độ không phải lý do — atomicity mới là lý do: engine không lên lịch một sự kiện mới nào cho từng redis.call bên trong script, nên không có khe hở thời gian nào cho một command khác len vào giữa.',
    },
  ],
}
```

Fix the `script` in `13-lua.ts`'s inline usage: this lesson does not use `tonumber`/`or` (not in the supported grammar — no built-in functions beyond `redis.call`/`redis.pcall`, no `or`-as-default-value idiom beyond the boolean `or` operator already supported). Drop the unused top-level `const script` line entirely — it was scratch and is not referenced by the lesson object above; the two `EVAL` scripts actually used in `script:` only call `redis.call('SET', ...)`/`redis.call('GET', ...)`/`redis.call('DEL', ...)` with plain `==` comparison, all inside the supported subset.

- [ ] **Step 3: Register both lessons**

In `src/brokers/redis/lessons/registry.ts`, import both and append to `LESSONS`:

```ts
import { transactions } from './12-transactions'
import { lua } from './13-lua'
// ...
export const LESSONS: RedisLesson[] = [
  strings, hash, list, set, zset, ttl, scan, cacheAside, writeThrough, stampede, eviction,
  transactions, lua,
]
```

- [ ] **Step 4: Update the lesson-count test**

In `src/brokers/redis/lessons/lessons.test.ts`, change the final `it` block's expectations to 13 lessons and append the two new ids to the expected array (do not touch anything else in that file — the `describe.each` above it picks up new lessons automatically).

- [ ] **Step 5: Run the lesson suite**

Run: `npx vitest run src/brokers/redis/lessons/`
Expected: PASS — `lessons.test.ts`'s generic `it.each` checks (validation, determinism, every command replied, narrative/highlight bounds, checkpoint bounds) all pass for both new lessons with no further code.

- [ ] **Step 6: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/brokers/redis/lessons/12-transactions.ts src/brokers/redis/lessons/13-lua.ts src/brokers/redis/lessons/registry.ts src/brokers/redis/lessons/lessons.test.ts
git commit -m "feat(redis): lesson 12 — transactions, lesson 13 — Lua atomicity"
```

---

### Task 9: Lessons 14–15 — Distributed lock, sliding-window rate limit

**Files:**
- Create: `src/brokers/redis/lessons/14-distributed-lock.ts`
- Create: `src/brokers/redis/lessons/15-rate-limit.ts`
- Modify: `src/brokers/redis/lessons/registry.ts`
- Modify: `src/brokers/redis/lessons/lessons.test.ts` (count → 15, id list)

- [ ] **Step 1: Write `14-distributed-lock.ts`**

```ts
import { APP, SERVER, WORKER } from './types'
import type { RedisLesson } from './types'

const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`

export const distributedLock: RedisLesson = {
  id: '14-distributed-lock',
  group: 'advanced',
  title: 'Distributed lock',
  summary:
    '`SET key token NX PX` giành khoá; unlock an toàn bằng một `EVAL` so token trước khi xoá — không phải hai lệnh `GET` rồi `DEL` rời nhau.',
  seed: 14,
  durationMs: 2400,
  topology: { clients: [APP, WORKER], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['lock:job', 'token-app', 'NX', 'PX', '5000'] },
    { at: 300, clientId: WORKER.id, name: 'SET', args: ['lock:job', 'token-worker', 'NX', 'PX', '5000'] },
    { at: 700, clientId: WORKER.id, name: 'EVAL', args: [UNLOCK, '1', 'lock:job', 'token-worker'] },
    { at: 1100, clientId: APP.id, name: 'EVAL', args: [UNLOCK, '1', 'lock:job', 'token-app'] },
    { at: 1500, clientId: APP.id, name: 'EXISTS', args: ['lock:job'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'SET NX PX là toàn bộ cơ chế giành khoá',
      body: '`NX` chỉ ghi khi `key` chưa tồn tại — đúng một client thắng cuộc đua giành khoá; `PX` đặt hạn tự huỷ phòng khi client giữ khoá chết mà không kịp mở.',
      highlight: ['app', 'redis'],
    },
    {
      at: 300,
      title: 'worker đến sau, thua cuộc đua',
      body: '`lock:job` đã có `app` giữ — `SET NX` của `worker` không ghi được gì, trả về nil.',
      highlight: ['worker'],
    },
    {
      at: 700,
      title: 'worker thử mở khoá của người khác — bị chặn',
      body: 'Token trong lệnh mở khoá không khớp giá trị đang giữ `key` — script trả về 0, `lock:job` vẫn còn nguyên. Đây là lý do mở khoá không thể chỉ là một `DEL` trần trụi: bất kỳ ai gọi `DEL lock:job` cũng sẽ vô tình mở khoá của người khác.',
      highlight: ['worker', 'redis'],
    },
    {
      at: 1100,
      title: 'app mở đúng khoá của mình',
      body: 'Token khớp — script xoá `key` trong đúng một bước `EVAL`, không có khoảng hở giữa lúc kiểm tra token và lúc xoá.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 2000,
      question: 'Vì sao mở khoá dùng EVAL (GET rồi DEL trong một script) thay vì gọi GET và DEL là hai lệnh riêng?',
      options: [
        'Vì EVAL nhanh hơn hai lệnh cộng lại',
        'Vì giữa hai lệnh riêng có khoảng hở: một client khác có thể giành lại lock:job ngay sau GET nhưng trước DEL, khiến DEL xoá nhầm khoá của họ',
        'Vì SET NX không tương thích với hai lệnh riêng',
      ],
      answerIndex: 1,
      explanation: 'Không phải chuyện tốc độ — là chuyện atomicity: hai lệnh rời để lộ một khoảng hở đúng bằng thời gian giữa chúng, đủ để client khác giành lại lock:job. Redlock (khoá qua nhiều node) vẫn còn bị tranh cãi (Martin Kleppmann và antirez từng tranh luận công khai) chính vì những khoảng hở tương tự ở tầng mạng, không phải tầng một lệnh.',
    },
  ],
}
```

- [ ] **Step 2: Write `15-rate-limit.ts`**

```ts
import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const rateLimit: RedisLesson = {
  id: '15-rate-limit',
  group: 'advanced',
  title: 'Sliding-window rate limit',
  summary:
    '`ZADD` ghi timestamp mỗi request vào một `zset`, `ZREMRANGEBYSCORE` xoá phần đã rơi khỏi cửa sổ, `ZCARD` đếm để so với hạn mức — cửa sổ trượt theo từng millisecond, không nhảy khối như fixed-window.',
  seed: 15,
  durationMs: 3000,
  topology: { clients: [APP], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '0', 'req-0'] },
    { at: 400, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '400', 'req-1'] },
    { at: 800, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '800', 'req-2'] },
    { at: 1200, clientId: APP.id, name: 'ZREMRANGEBYSCORE', args: ['ratelimit:ip1', '-inf', '200'] },
    { at: 1200, clientId: APP.id, name: 'ZCARD', args: ['ratelimit:ip1'] },
    { at: 1600, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '1600', 'req-3'] },
    { at: 1600, clientId: APP.id, name: 'ZCARD', args: ['ratelimit:ip1'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Mỗi request là một member trong zset, score là thời điểm',
      body: 'Không đếm bằng một con số duy nhất — mỗi request có mặt riêng trong `zset`, xếp theo đúng thời điểm nó tới.',
      highlight: ['app', 'redis'],
    },
    {
      at: 1200,
      title: 'ZREMRANGEBYSCORE cắt đúng phần đã rơi khỏi cửa sổ 1000ms',
      body: 'Cửa sổ trượt: tại t=1200, chỉ request nào có score < 200 (tức là cũ hơn 1000ms so với hiện tại) mới bị cắt — req-0 (score 0) rơi khỏi cửa sổ, req-1 và req-2 vẫn còn.',
      highlight: ['redis'],
    },
    {
      at: 1600,
      title: 'ZCARD sau khi cắt là con số dùng để so với hạn mức',
      body: 'Không phải tổng số request từng tới — chỉ đếm những gì còn nằm trong cửa sổ hiện tại. Đây là điểm khác fixed-window: fixed-window nhảy khối theo giây/phút cố định, sliding-window trượt liên tục theo từng millisecond.',
      highlight: ['app'],
    },
  ],
  checkpoints: [
    {
      at: 2600,
      question: 'ZREMRANGEBYSCORE chạy trước ZCARD trong mỗi lượt kiểm tra rate limit. Vì sao thứ tự này quan trọng?',
      options: [
        'Không quan trọng, hai lệnh độc lập nhau',
        'ZCARD phải đếm sau khi đã cắt phần cũ, nếu không con số sẽ tính luôn cả request đã rơi khỏi cửa sổ',
        'ZREMRANGEBYSCORE cần ZCARD chạy trước để biết cắt bao nhiêu',
      ],
      answerIndex: 1,
      explanation: 'ZCARD chỉ đếm số member đang có trong zset tại thời điểm gọi — nếu gọi trước khi cắt phần cũ, request đã hết hạn vẫn bị tính vào hạn mức, làm rate limiter từ chối oan những request lẽ ra hợp lệ.',
    },
  ],
}
```

- [ ] **Step 3: Register both lessons**

In `registry.ts`, import and append:

```ts
import { distributedLock } from './14-distributed-lock'
import { rateLimit } from './15-rate-limit'
// ...
export const LESSONS: RedisLesson[] = [
  strings, hash, list, set, zset, ttl, scan, cacheAside, writeThrough, stampede, eviction,
  transactions, lua, distributedLock, rateLimit,
]
```

- [ ] **Step 4: Update the lesson-count test to 15**

Same file/pattern as Task 8 Step 4.

- [ ] **Step 5: Run the lesson suite, full suite, typecheck, lint**

Run: `npx vitest run src/brokers/redis/lessons/ && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/redis/lessons/14-distributed-lock.ts src/brokers/redis/lessons/15-rate-limit.ts src/brokers/redis/lessons/registry.ts src/brokers/redis/lessons/lessons.test.ts
git commit -m "feat(redis): lesson 14 — distributed lock, lesson 15 — rate limit"
```

---

### Task 10: `advanced.test.ts` — behaviour tests for lessons 12–15, and README

**Files:**
- Create: `src/brokers/redis/lessons/advanced.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write `advanced.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { transactions } from './12-transactions'
import { lua } from './13-lua'
import { distributedLock } from './14-distributed-lock'
import { rateLimit } from './15-rate-limit'
import { createRedisSimulation } from '../engine'
import type { RedisLesson } from './types'

function run(lesson: RedisLesson) {
  return createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
}

describe('12 transactions', () => {
  it('runs the first EXEC and settles balance:1 at 102', () => {
    const sim = run(transactions)
    sim.advanceTo(1000)
    expect(sim.snapshot().keys['balance:1']!.value).toEqual({ type: 'string', value: '102' })
  })

  it('aborts the second EXEC after worker writes over the watched key, leaving worker\'s value untouched', () => {
    const sim = run(transactions)
    sim.advanceTo(transactions.durationMs)
    expect(sim.snapshot().keys['balance:1']!.value).toEqual({ type: 'string', value: '999' })
  })
})

describe('13 lua', () => {
  it('leaves seq:name at "second" after the first EVAL overwrites it', () => {
    const sim = run(lua)
    sim.advanceTo(600)
    expect(sim.snapshot().keys['seq:name']!.value).toEqual({ type: 'string', value: 'second' })
  })

  it('deletes seq:name once the compare-and-delete script finds a matching value', () => {
    const sim = run(lua)
    sim.advanceTo(lua.durationMs)
    expect(sim.snapshot().keys['seq:name']).toBeUndefined()
  })
})

describe('14 distributed lock', () => {
  it('keeps lock:job under app after worker fails to steal or unlock it', () => {
    const sim = run(distributedLock)
    sim.advanceTo(1000)
    expect(sim.snapshot().keys['lock:job']!.value).toEqual({ type: 'string', value: 'token-app' })
  })

  it('removes lock:job once app unlocks with the matching token', () => {
    const sim = run(distributedLock)
    sim.advanceTo(distributedLock.durationMs)
    expect(sim.snapshot().keys['lock:job']).toBeUndefined()
  })
})

describe('15 rate limit', () => {
  it('cuts req-0 out of the window and counts exactly the two survivors', () => {
    const sim = run(rateLimit)
    sim.advanceTo(1300)
    const line = sim.snapshot().journal.filter((e) => e.text.startsWith('ZCARD'))[0]!
    expect(line.text).toBe('ZCARD "ratelimit:ip1" → (integer) 2')
  })

  it('counts three once req-3 joins and nothing new has fallen out of the window yet', () => {
    const sim = run(rateLimit)
    sim.advanceTo(rateLimit.durationMs)
    const lines = sim.snapshot().journal.filter((e) => e.text.startsWith('ZCARD'))
    expect(lines[1]!.text).toBe('ZCARD "ratelimit:ip1" → (integer) 3')
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/brokers/redis/lessons/advanced.test.ts`
Expected: PASS. If any assertion is off (e.g. an exact journal string doesn't match `formatCommand`'s quoting rules), that is real signal — fix the assertion to match the actual, correct output, not the other way around; do not change lesson scripts to make a wrong assertion pass without first checking which one is actually wrong.

- [ ] **Step 3: Update README**

In `README.md`, the Redis bullet under "Mỗi broker..." currently reads (approximately):

```
- **Redis** — 11 lesson trải trên bốn nhóm (`basics`/Cơ bản, `cache`/Cache,
  `messaging`/Messaging, `advanced`/Nâng cao — hai nhóm sau còn trống, để
  dành cho một plan sau): String & counter, Hash, List, Set, Sorted Set,
  TTL, `SCAN` thay `KEYS`, cache-aside, write-through & write-behind, cache
  stampede, `maxmemory` & eviction policy.
```

Replace with (15 lessons; `messaging` still empty, `advanced` now has its first four):

```
- **Redis** — 15 lesson trải trên bốn nhóm (`basics`/Cơ bản, `cache`/Cache,
  `messaging`/Messaging — còn trống, để dành cho một plan sau,
  `advanced`/Nâng cao): String & counter, Hash, List, Set, Sorted Set, TTL,
  `SCAN` thay `KEYS`, cache-aside, write-through & write-behind, cache
  stampede, `maxmemory` & eviction policy, transactions, Lua atomicity,
  distributed lock, sliding-window rate limit.
```

Also update the `npm test` line's test count comment if the README states an exact number (grep for it first: `grep -n "test trên" README.md`), adjusting to whatever `npm test`'s actual summary line reports after this task.

- [ ] **Step 4: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/redis/lessons/advanced.test.ts README.md
git commit -m "test(redis): behaviour coverage for lessons 12-15; docs: update Redis lesson count"
```

**Phase 6a ends here — a working, tested increment.** Everything below is Phase 6b and depends on nothing except what 6a shipped.

---

## Phase 6b

### Task 11: Topology and state types for persistence, replicas, sentinels

**Files:**
- Modify: `src/brokers/redis/engine/types.ts`
- Modify: `src/brokers/redis/engine/index.ts` (`createState`)
- Modify: `src/brokers/redis/engine/keyspace.ts` (`touchKey` also bumps `writeCounter`)
- Test: `src/brokers/redis/engine/keyspace.test.ts`

**Interfaces:**
- Produces: `RedisServerSpec.persistence`, `RedisReplicaSpec`, `RedisSentinelSpec`, `RedisTopology.replicas`/`.sentinels`, `RedisState.replicaState`/`.primaryId`/`.lastSnapshot`/`.writeCounter`/`.primaryDown` — consumed by Tasks 12–15.

- [ ] **Step 1: Write the failing test (extends `touchKey`'s coverage from Task 1)**

```ts
// add to src/brokers/redis/engine/keyspace.test.ts
it('touchKey also advances the global writeCounter', () => {
  let state = baseState()
  expect(state.writeCounter).toBe(0)
  state = touchKey(state, 'a')
  expect(state.writeCounter).toBe(1)
  state = touchKey(state, 'b')
  expect(state.writeCounter).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/keyspace.test.ts`
Expected: FAIL — `writeCounter` does not exist on the state fixture's type.

- [ ] **Step 3: Extend the types**

In `src/brokers/redis/engine/types.ts`:

```ts
export interface RedisServerSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
  maxmemoryBytes?: number
  evictionPolicy?: EvictionPolicy
  activeExpireEveryMs?: number
  /** Absent means "no persistence configured": a crash loses everything.
   *  `rdb.everySec` models Redis' periodic snapshot; `aof` models the
   *  append-only file's fsync policy. A server declares at most one of
   *  these two in a given lesson — see `engine/index.ts`'s `snapshotWrite`
   *  scheduling for how the interval is picked. */
  persistence?: {
    rdb?: { everySec: number }
    aof?: 'always' | 'everysec' | 'no'
  }
}

export interface RedisReplicaSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
  /** Virtual ms between a write landing on the primary and reaching this replica. */
  lagMs: number
}

export interface RedisSentinelSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
}

export interface RedisTopology {
  clients: RedisClientSpec[]
  server: RedisServerSpec
  replicas?: RedisReplicaSpec[]
  sentinels?: RedisSentinelSpec[]
}

/** A full-keyspace snapshot, captured by the `snapshotWrite` event and
 *  restored by `crash` when the server has no `persistence.aof: 'always'`. */
export interface RedisSnapshot {
  keys: Record<string, KeyRecord>
  keyOrder: string[]
  keyVersions: Record<string, number>
  writeCounter: number
}

export interface RedisState extends KernelState {
  // ...existing fields (topology, keys, keyOrder, metrics, inFlight, blocked,
  // commandCounter, keyVersions, txQueues, watched), plus:
  /** How many writes (SET/DEL/eviction/lazy-expiry — anything `touchKey` sees)
   *  the primary has applied since the run started. Compared against each
   *  replica's `replicaState[id].appliedWriteCounter` to show lag. */
  writeCounter: number
  replicaState: Record<NodeId, { appliedWriteCounter: number }>
  /** Which node id is currently treated as primary. Starts as `topology.server.id`;
   *  a `sentinelFailover` fault can repoint it at a replica id. */
  primaryId: NodeId
  lastSnapshot?: RedisSnapshot
  primaryDown: boolean
}
```

In `src/brokers/redis/engine/index.ts`'s `createState`, add:

```ts
writeCounter: 0,
replicaState: Object.fromEntries((topology.replicas ?? []).map((r) => [r.id, { appliedWriteCounter: 0 }])),
primaryId: topology.server.id,
primaryDown: false,
```

(`lastSnapshot` stays absent — optional field, no initial value needed.)

- [ ] **Step 4: Bump `writeCounter` inside `touchKey`**

In `src/brokers/redis/engine/keyspace.ts`, change `touchKey` to:

```ts
export function touchKey(state: RedisState, key: string): RedisState {
  return {
    ...state,
    keyVersions: { ...state.keyVersions, [key]: (state.keyVersions[key] ?? 0) + 1 },
    writeCounter: state.writeCounter + 1,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/keyspace.test.ts`
Expected: PASS

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: green. (`RedisTopology.replicas`/`.sentinels` and `RedisServerSpec.persistence` are optional, so every existing lesson topology still satisfies the type unchanged.)

- [ ] **Step 7: Commit**

```bash
git add src/brokers/redis/engine/types.ts src/brokers/redis/engine/index.ts src/brokers/redis/engine/keyspace.ts src/brokers/redis/engine/keyspace.test.ts
git commit -m "feat(redis): topology types for persistence, replicas, sentinels"
```

---

### Task 12: `engine/crc16.ts` — `CLUSTER KEYSLOT`

**Files:**
- Create: `src/brokers/redis/engine/crc16.ts`
- Modify: `src/brokers/redis/engine/commands/server.ts` (`CLUSTER KEYSLOT`)
- Test: `src/brokers/redis/engine/crc16.test.ts`
- Test: `src/brokers/redis/engine/commands/server.test.ts` (extend)

**Interfaces:**
- Produces: `crc16(data: string): number`, `keySlot(key: string): number` — consumed by the `CLUSTER` command handler.

- [ ] **Step 1: Write the failing test**

```ts
// src/brokers/redis/engine/crc16.test.ts
import { describe, expect, it } from 'vitest'
import { keySlot } from './crc16'

describe('keySlot', () => {
  it('is deterministic for the same key', () => {
    expect(keySlot('user:1000')).toBe(keySlot('user:1000'))
  })

  it('stays within the 16384-slot range', () => {
    for (const key of ['a', 'user:1000', '', 'x'.repeat(500)]) {
      const slot = keySlot(key)
      expect(slot).toBeGreaterThanOrEqual(0)
      expect(slot).toBeLessThan(16384)
    }
  })

  it('hashes only the {tag} portion when a hash tag is present, so related keys land on the same slot', () => {
    expect(keySlot('{user1000}.following')).toBe(keySlot('{user1000}.followers'))
    expect(keySlot('{user1000}.following')).toBe(keySlot('user1000')) // hashing "user1000" directly matches the tag's contents
  })

  it('falls back to hashing the whole key when there is no {tag}, or an empty/unclosed one', () => {
    expect(keySlot('plainkey')).not.toBe(keySlot('{}plainkey')) // "{}" has no content between braces, so this hashes "{}plainkey" whole
    expect(() => keySlot('no-closing-brace{')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/crc16.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `crc16.ts`**

```ts
// src/brokers/redis/engine/crc16.ts
/**
 * CRC16/CCITT-FALSE (poly 0x1021, init 0) — the exact variant Redis Cluster
 * uses to compute a key's hash slot. `keySlot` also reproduces Cluster's hash
 * tag rule: if `key` contains a `{...}` with at least one character inside,
 * only the substring inside the braces is hashed, so app code can force
 * related keys onto the same slot (`{user1000}.following`, `{user1000}.followers`).
 */
const POLY = 0x1021

function buildTable(): number[] {
  const table: number[] = []
  for (let byte = 0; byte < 256; byte++) {
    let crc = byte << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ POLY) & 0xffff : (crc << 1) & 0xffff
    }
    table.push(crc)
  }
  return table
}

const TABLE = buildTable()

export function crc16(data: string): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    const byte = data.charCodeAt(i) & 0xff
    crc = ((crc << 8) ^ TABLE[(crc >> 8) ^ byte]!) & 0xffff
  }
  return crc
}

const SLOT_COUNT = 16384

export function keySlot(key: string): number {
  const open = key.indexOf('{')
  const close = open === -1 ? -1 : key.indexOf('}', open + 1)
  const tagged = open !== -1 && close !== -1 && close > open + 1 ? key.slice(open + 1, close) : key
  return crc16(tagged) % SLOT_COUNT
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/crc16.test.ts`
Expected: PASS

- [ ] **Step 5: Wire `CLUSTER KEYSLOT` into `commands/server.ts`, with its own failing test first**

Add to `src/brokers/redis/engine/commands/server.test.ts` (read the file first for its existing fixture style, then match it):

```ts
describe('CLUSTER KEYSLOT', () => {
  it('replies with an integer slot number', () => {
    // build a CommandContext the same way this file's existing CONFIG/INFO tests do
    const result = cluster({ state: baseState(), clientId: 'app', args: ['KEYSLOT', 'user:1000'], commandId: 'cmd-0' })
    expect(result.reply.kind).toBe('integer')
    expect((result.reply as { kind: 'integer'; value: number }).value).toBeGreaterThanOrEqual(0)
  })

  it('rejects an unknown CLUSTER subcommand', () => {
    const result = cluster({ state: baseState(), clientId: 'app', args: ['NOTASUBCOMMAND'], commandId: 'cmd-0' })
    expect(result.reply.kind).toBe('error')
  })
})
```

Run it (expect FAIL — `cluster` not exported), then add to `src/brokers/redis/engine/commands/server.ts`:

```ts
import { keySlot } from '../crc16'
// ...
/** `CLUSTER KEYSLOT key` — the hash slot `key` would live on in a real
 *  Cluster deployment. Nothing in this simulation actually shards data
 *  across slots; this is a pure, informational computation. */
const cluster: CommandHandler = (context: CommandContext): CommandResult => {
  const [subcommand, key] = context.args
  const sub = subcommand?.toUpperCase()
  if (sub === 'KEYSLOT') {
    if (key === undefined) return { state: context.state, reply: configError("wrong number of arguments for 'cluster|keyslot' command") }
    return { state: context.state, reply: { kind: 'integer', value: keySlot(key) } }
  }
  return { state: context.state, reply: configError(`Unknown CLUSTER subcommand '${subcommand}'`) }
}
```

Add `CLUSTER: cluster,` to this file's `handlers` export.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/brokers/redis/engine/commands/server.test.ts`
Expected: PASS

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/brokers/redis/engine/crc16.ts src/brokers/redis/engine/crc16.test.ts src/brokers/redis/engine/commands/server.ts src/brokers/redis/engine/commands/server.test.ts
git commit -m "feat(redis): CLUSTER KEYSLOT via CRC16"
```

---

### Task 13: Persistence — `snapshotWrite`, `crash`, `restart`, `BGSAVE`

**Files:**
- Modify: `src/brokers/redis/engine/types.ts` (`RedisEventType` union)
- Modify: `src/brokers/redis/engine/memory.ts` (`recomputeMemoryMetrics`)
- Modify: `src/brokers/redis/engine/index.ts` (seeding faults, three new reducers, `BGSAVE`/`REPLICAOF` command wiring point)
- Modify: `src/brokers/redis/engine/commands/server.ts` (`BGSAVE`, `REPLICAOF` — trivial handlers, real behaviour lives in the reducers)
- Modify: `src/brokers/redis/lessons/types.ts` (`RedisFault`, `RedisLesson.failures?`)
- Modify: `src/brokers/redis/index.ts` (forward `options.failures` into `createRedisSimulation`)
- Test: `src/brokers/redis/engine/index.test.ts` (extend)

**Interfaces:**
- Consumes: `touchKey`/`RedisSnapshot` (Task 11).
- Produces: `RedisFault`, `RedisLesson.failures?: RedisFault[]` — consumed by Task 15's persistence lesson. `RedisSimulationOptions.failures?: RedisFault[]` — consumed the same way RabbitMQ's `ScriptedFailure[]` already is.

- [ ] **Step 1: Write the failing tests**

```ts
// add to src/brokers/redis/engine/index.test.ts (read the file first to match its
// existing topology/fixture style before adding this describe block)
describe('persistence: crash and restart', () => {
  const topologyNoPersistence: RedisTopology = {
    clients: [{ id: 'app', label: 'App', position: { x: 0, y: 0 } }],
    server: { id: 'redis', label: 'Redis', position: { x: 200, y: 50 } }, // no `persistence` field at all
  }

  it('with no persistence configured, a crash wipes every key', () => {
    const sim = createRedisSimulation({
      topology: topologyNoPersistence,
      script: [{ at: 0, clientId: 'app', name: 'SET', args: ['a', '1'] }],
      failures: [{ at: 500, kind: 'crash', target: 'redis' }],
      seed: 1,
    })
    sim.advanceTo(1000)
    expect(sim.snapshot().keys).toEqual({})
  })

  it('with aof: always, a crash loses nothing', () => {
    const topology: RedisTopology = {
      ...topologyNoPersistence,
      server: { ...topologyNoPersistence.server, persistence: { aof: 'always' } },
    }
    const sim = createRedisSimulation({
      topology,
      script: [{ at: 0, clientId: 'app', name: 'SET', args: ['a', '1'] }],
      failures: [{ at: 500, kind: 'crash', target: 'redis' }],
      seed: 1,
    })
    sim.advanceTo(1000)
    expect(sim.snapshot().keys['a']!.value).toEqual({ type: 'string', value: '1' })
  })

  it('with rdb.everySec, a crash keeps only what the last snapshot had', () => {
    const topology: RedisTopology = {
      ...topologyNoPersistence,
      server: { ...topologyNoPersistence.server, persistence: { rdb: { everySec: 1 } } },
    }
    const sim = createRedisSimulation({
      topology,
      script: [
        { at: 0, clientId: 'app', name: 'SET', args: ['a', '1'] }, // before the first snapshot at t=1000
        { at: 1500, clientId: 'app', name: 'SET', args: ['b', '2'] }, // after it, lost on crash
      ],
      failures: [{ at: 1800, kind: 'crash', target: 'redis' }],
      seed: 1,
    })
    sim.advanceTo(2000)
    const state = sim.snapshot()
    expect(state.keys['a']).toBeDefined()
    expect(state.keys['b']).toBeUndefined()
  })

  it('restart clears primaryDown', () => {
    const sim = createRedisSimulation({
      topology: topologyNoPersistence,
      script: [],
      failures: [
        { at: 200, kind: 'crash', target: 'redis' },
        { at: 400, kind: 'restart', target: 'redis' },
      ],
      seed: 1,
    })
    sim.advanceTo(600)
    expect(sim.snapshot().primaryDown).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/index.test.ts`
Expected: FAIL — `failures` is not a recognised `RedisSimulationOptions` field, `RedisEventType` has no `crash`/`restart`/`snapshotWrite`.

- [ ] **Step 3: `RedisFault` and `RedisEventType`**

In `src/brokers/redis/lessons/types.ts`:

```ts
export interface RedisFault {
  at: number
  kind: 'crash' | 'restart' | 'sentinelFailover'
  /** `crash`/`restart`: the server's node id. `sentinelFailover`: the replica
   *  id being promoted. */
  target: string
}

export interface RedisLesson extends Lesson<RedisTopology, RedisScriptedCommand> {
  group: RedisLessonGroup
  /** Named `failures` (not `faults`) on purpose — `src/shell/useSimulation.ts`
   *  reads any lesson's `.failures` field generically to pass into
   *  `createSimulation`, and that mechanism is what keeps `src/shell/`
   *  broker-agnostic. See the design doc's "Deviation" note for why. */
  failures?: RedisFault[]
}
```

In `src/brokers/redis/engine/types.ts`, widen `RedisEventType`:

```ts
export type RedisEventType = 'command' | 'reply' | 'activeExpire' | 'evict' | 'unblock' | 'snapshotWrite' | 'crash' | 'restart'
```

(`replicate`/`sentinelFailover` are added in Task 14, to keep this task's diff reviewable on its own.)

- [ ] **Step 4: `recomputeMemoryMetrics` in `memory.ts`**

Add to `src/brokers/redis/engine/memory.ts`:

```ts
/** Rebuilds `keysCount`/`memoryUsed` from scratch. Needed only after a bulk
 *  keyspace replacement (a crash restore) — every other path updates these
 *  incrementally as it goes. */
export function recomputeMemoryMetrics(keys: Record<string, KeyRecord>): { keysCount: number; memoryUsed: number } {
  const entries = Object.entries(keys)
  return {
    keysCount: entries.length,
    memoryUsed: entries.reduce((sum, [key, record]) => sum + sizeOf(key, record.value), 0),
  }
}
```

- [ ] **Step 5: Seed fault events, add the three reducers, wire `RedisSimulationOptions.failures`**

In `src/brokers/redis/engine/index.ts`:

Add `failures?: import('../lessons/types').RedisFault[]` — actually avoid the cross-directory type import cycle risk; instead declare the shape inline in `engine/index.ts` (the engine must not depend on `lessons/`) and let `lessons/types.ts`'s `RedisFault` be structurally compatible:

```ts
export interface RedisFault {
  at: number
  kind: 'crash' | 'restart' | 'sentinelFailover'
  target: string
}

export interface RedisSimulationOptions {
  topology: RedisTopology
  script: RedisScriptedCommand[]
  seed: number
  failures?: RedisFault[]
  maxEvents?: number
}
```

(`lessons/types.ts`'s `RedisFault` should then just re-export this one: `export type { RedisFault } from '../engine'` — replace the interface literal drafted in Step 3 with that re-export once this step lands, so there is exactly one definition.)

In `seedEvents`, after the `activeExpireSeed` block, add:

```ts
  const faultEvents: SimEvent<RedisEventType>[] = (options.failures ?? []).map((fault) => ({
    at: fault.at,
    seq: seq++,
    type: fault.kind,
    payload: { target: fault.target },
  }))

  const snapshotSeed = snapshotSeedEvent(options.topology, seq)
  if (snapshotSeed) seq++

  return [...commands, activeExpireSeed, ...faultEvents, ...(snapshotSeed ? [snapshotSeed] : [])]
```

Add the helper just above `seedEvents`:

```ts
/** Only one of RDB or AOF-everysec periodic snapshotting is ever active for a
 *  given server (a lesson declares one persistence mode), and `aof: 'always'`
 *  needs no periodic snapshot at all — a crash under that mode loses nothing
 *  regardless. Absent `persistence` entirely needs none either: `applyCrash`
 *  already treats "no snapshot ever taken" as "restore to empty". */
function snapshotIntervalMs(server: RedisTopology['server']): number | undefined {
  if (server.persistence?.aof === 'everysec') return 1000
  if (server.persistence?.rdb) return server.persistence.rdb.everySec * 1000
  return undefined
}

function snapshotSeedEvent(topology: RedisTopology, seq: number): SimEvent<RedisEventType> | undefined {
  const interval = snapshotIntervalMs(topology.server)
  if (interval === undefined) return undefined
  return { at: interval, seq, type: 'snapshotWrite', payload: {} }
}
```

Add the three reducers, near `applyActiveExpire`'s usage:

```ts
function applySnapshotWrite(state: RedisState, _event: SimEvent<RedisEventType>): ReduceResult {
  const snapshot: RedisSnapshot = {
    keys: state.keys,
    keyOrder: state.keyOrder,
    keyVersions: state.keyVersions,
    writeCounter: state.writeCounter,
  }
  const interval = snapshotIntervalMs(state.topology.server)
  const next: RedisState = {
    ...state,
    lastSnapshot: snapshot,
    journal: [...state.journal, { at: state.now, type: 'snapshotWrite', text: '# snapshot taken' }],
  }
  if (interval === undefined) return { state: next, newEvents: [] }
  const [seq, afterSeq] = nextSeq(next)
  return { state: afterSeq, newEvents: [{ at: state.now + interval, seq, type: 'snapshotWrite', payload: {} }] }
}

function applyCrash(state: RedisState, event: SimEvent<RedisEventType>): ReduceResult {
  const target = asString(event.payload.target, 'target')
  if (target !== state.topology.server.id) return { state, newEvents: [] } // this simulation only crashes the primary

  const restored: RedisSnapshot =
    state.topology.server.persistence?.aof === 'always'
      ? { keys: state.keys, keyOrder: state.keyOrder, keyVersions: state.keyVersions, writeCounter: state.writeCounter }
      : (state.lastSnapshot ?? { keys: {}, keyOrder: [], keyVersions: {}, writeCounter: 0 })

  const { keysCount, memoryUsed } = recomputeMemoryMetrics(restored.keys)
  const reason =
    state.topology.server.persistence?.aof === 'always'
      ? 'AOF always — nothing lost'
      : state.lastSnapshot
        ? 'restored from last snapshot'
        : 'no persistence configured — everything lost'

  return {
    state: {
      ...state,
      keys: restored.keys,
      keyOrder: restored.keyOrder,
      keyVersions: restored.keyVersions,
      writeCounter: restored.writeCounter,
      metrics: { ...state.metrics, keysCount, memoryUsed },
      primaryDown: true,
      journal: [...state.journal, { at: state.now, type: 'crash', text: `# ${target} crashed — ${reason}` }],
    },
    newEvents: [],
  }
}

function applyRestart(state: RedisState, event: SimEvent<RedisEventType>): ReduceResult {
  const target = asString(event.payload.target, 'target')
  if (target !== state.topology.server.id) return { state, newEvents: [] }
  return {
    state: { ...state, primaryDown: false, journal: [...state.journal, { at: state.now, type: 'restart', text: `# ${target} restarted` }] },
    newEvents: [],
  }
}
```

Add `snapshotWrite: withPrune(applySnapshotWrite), crash: withPrune(applyCrash), restart: withPrune(applyRestart),` to `REDUCERS`. Import `RedisSnapshot` and `recomputeMemoryMetrics` at the top of the file.

- [ ] **Step 6: `BGSAVE`/`REPLICAOF` command handlers**

In `src/brokers/redis/engine/commands/server.ts`, add:

```ts
/** `BGSAVE` — real Redis forks and saves asynchronously; here it is
 *  synchronous and instant (there is no async in this engine), and the reply
 *  text still says "started" to match what a learner would see typing this
 *  into a real terminal. The actual snapshot state update happens through
 *  the periodic `snapshotWrite` event, same as an automatic save — BGSAVE
 *  does not special-case it, matching the fact that a manual save and a
 *  scheduled one write the same file in real Redis. */
const bgsave: CommandHandler = (context: CommandContext): CommandResult => ({
  state: context.state,
  reply: { kind: 'status', value: 'Background saving started' },
})

/** `REPLICAOF host port` / `REPLICAOF NO ONE` — this simulation has no real
 *  network, so there is no handshake to perform; the reply alone is enough
 *  for a lesson to narrate the command's meaning. */
const replicaof: CommandHandler = (context: CommandContext): CommandResult => ({
  state: context.state,
  reply: { kind: 'status', value: 'OK' },
})
```

Add `BGSAVE: bgsave, REPLICAOF: replicaof,` to this file's `handlers` export.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/brokers/redis/engine/index.test.ts`
Expected: PASS

- [ ] **Step 8: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/brokers/redis/engine/types.ts src/brokers/redis/engine/memory.ts src/brokers/redis/engine/index.ts src/brokers/redis/engine/index.test.ts src/brokers/redis/engine/commands/server.ts src/brokers/redis/lessons/types.ts
git commit -m "feat(redis): RDB/AOF persistence, crash and restart faults, BGSAVE/REPLICAOF"
```

---

### Task 14: Replication and Sentinel failover

**Files:**
- Modify: `src/brokers/redis/engine/types.ts` (`RedisEventType` gains `replicate`, `sentinelFailover`)
- Modify: `src/brokers/redis/engine/index.ts` (schedule `replicate` on every command's completion; `applySentinelFailover`)
- Test: `src/brokers/redis/engine/index.test.ts` (extend)

**Interfaces:**
- Produces: `state.replicaState[id].appliedWriteCounter` tracking, `state.primaryId` — consumed by Task 15's replication lesson and Task 16's UI.

- [ ] **Step 1: Write the failing tests**

```ts
// add to src/brokers/redis/engine/index.test.ts
describe('replication lag and Sentinel failover', () => {
  const topology: RedisTopology = {
    clients: [{ id: 'app', label: 'App', position: { x: 0, y: 0 } }],
    server: { id: 'redis', label: 'Redis', position: { x: 200, y: 50 } },
    replicas: [{ id: 'replica-1', label: 'Replica', position: { x: 400, y: 50 }, lagMs: 300 }],
    sentinels: [{ id: 'sentinel-1', label: 'Sentinel', position: { x: 400, y: 150 } }],
  }

  it('a replica applies a write lagMs after the primary does', () => {
    const sim = createRedisSimulation({
      topology,
      script: [{ at: 0, clientId: 'app', name: 'SET', args: ['a', '1'] }],
      seed: 1,
    })
    sim.advanceTo(200) // primary has applied (command travel 120ms), replica has not (needs +300ms more)
    expect(sim.snapshot().replicaState['replica-1']!.appliedWriteCounter).toBe(0)
    sim.advanceTo(500)
    expect(sim.snapshot().replicaState['replica-1']!.appliedWriteCounter).toBe(1)
  })

  it('sentinelFailover repoints primaryId at the named replica', () => {
    const sim = createRedisSimulation({
      topology,
      script: [],
      failures: [
        { at: 100, kind: 'crash', target: 'redis' },
        { at: 200, kind: 'sentinelFailover', target: 'replica-1' },
      ],
      seed: 1,
    })
    sim.advanceTo(400)
    expect(sim.snapshot().primaryId).toBe('replica-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/index.test.ts`
Expected: FAIL — `replicate`/`sentinelFailover` are not in `RedisEventType`; nothing schedules a `replicate` event yet.

- [ ] **Step 3: Widen `RedisEventType`, schedule `replicate`, add `applySentinelFailover`**

In `types.ts`:

```ts
export type RedisEventType =
  | 'command' | 'reply' | 'activeExpire' | 'evict' | 'unblock'
  | 'snapshotWrite' | 'crash' | 'restart' | 'replicate' | 'sentinelFailover'
```

In `engine/index.ts`'s `applyReply`, after the existing push/wake logic (right before its final `return { state: withFlight, newEvents: [] }` / the branch that returns `unblockEvent`), add replication scheduling that runs regardless of which of those two paths is taken — the cleanest way is to compute the replicate events once, right after `withFlight` is built, and append them to whichever `newEvents` array the function ends up returning. Concretely, change the tail of `applyReply` from:

```ts
  const isPush = name === 'LPUSH' || name === 'RPUSH'
  const pushedKey = args[0]
  const hasWaiter = isPush && pushedKey !== undefined && withFlight.blocked.some((entry) => entry.keys.includes(pushedKey))
  if (!hasWaiter) return { state: withFlight, newEvents: [] }

  const [unblockSeq, afterUnblockSeq] = nextSeq(withFlight)
  const unblockEvent: SimEvent<RedisEventType> = {
    at: withFlight.now,
    seq: unblockSeq,
    type: 'unblock',
    payload: {},
  }
  return { state: afterUnblockSeq, newEvents: [unblockEvent] }
```

to:

```ts
  const isPush = name === 'LPUSH' || name === 'RPUSH'
  const pushedKey = args[0]
  const hasWaiter = isPush && pushedKey !== undefined && withFlight.blocked.some((entry) => entry.keys.includes(pushedKey))

  const [replicateEvents, afterReplicate] = scheduleReplication(withFlight)

  if (!hasWaiter) return { state: afterReplicate, newEvents: replicateEvents }

  const [unblockSeq, afterUnblockSeq] = nextSeq(afterReplicate)
  const unblockEvent: SimEvent<RedisEventType> = { at: afterUnblockSeq.now, seq: unblockSeq, type: 'unblock', payload: {} }
  return { state: afterUnblockSeq, newEvents: [...replicateEvents, unblockEvent] }
```

Add the helper near `nextSeq`:

```ts
/** Schedules a `replicate` event per declared replica, carrying the
 *  `writeCounter` value as of *this* command. `applyReplicate` just needs to
 *  record it — it does not need to know which command produced it, only how
 *  far the primary had gotten. Scheduling this after every command (not only
 *  ones that actually wrote something) is deliberate: it keeps this call
 *  site simple, and a no-op replicate (the counter unchanged since the last
 *  one) is harmless. */
function scheduleReplication(state: RedisState): [SimEvent<RedisEventType>[], RedisState] {
  const replicas = state.topology.replicas ?? []
  if (replicas.length === 0) return [[], state]

  let working = state
  const events: SimEvent<RedisEventType>[] = []
  for (const replica of replicas) {
    const [seq, afterSeq] = nextSeq(working)
    working = afterSeq
    events.push({
      at: working.now + replica.lagMs,
      seq,
      type: 'replicate',
      payload: { replicaId: replica.id, writeCounter: working.writeCounter },
    })
  }
  return [events, working]
}

function applyReplicate(state: RedisState, event: SimEvent<RedisEventType>): ReduceResult {
  const replicaId = asString(event.payload.replicaId, 'replicaId')
  const writeCounter = event.payload.writeCounter
  if (typeof writeCounter !== 'number') throw new Error('redis engine: payload.writeCounter is not a number')
  const current = state.replicaState[replicaId]?.appliedWriteCounter ?? 0
  if (writeCounter <= current) return { state, newEvents: [] } // a later replicate already applied a higher counter
  return {
    state: { ...state, replicaState: { ...state.replicaState, [replicaId]: { appliedWriteCounter: writeCounter } } },
    newEvents: [],
  }
}

function applySentinelFailover(state: RedisState, event: SimEvent<RedisEventType>): ReduceResult {
  const target = asString(event.payload.target, 'target')
  return {
    state: { ...state, primaryId: target, journal: [...state.journal, { at: state.now, type: 'sentinelFailover', text: `# sentinel promoted ${target}` }] },
    newEvents: [],
  }
}
```

Add `replicate: withPrune(applyReplicate), sentinelFailover: withPrune(applySentinelFailover),` to `REDUCERS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/brokers/redis/engine/index.test.ts`
Expected: PASS

- [ ] **Step 5: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/redis/engine/types.ts src/brokers/redis/engine/index.ts src/brokers/redis/engine/index.test.ts
git commit -m "feat(redis): replication lag and Sentinel failover"
```

---

### Task 15: Lessons 16–17 — Persistence, replication/Sentinel/cluster

**Files:**
- Create: `src/brokers/redis/lessons/16-persistence.ts`
- Create: `src/brokers/redis/lessons/17-replication.ts`
- Modify: `src/brokers/redis/lessons/registry.ts`
- Modify: `src/brokers/redis/lessons/lessons.test.ts` (count → 17, id list — and note: this file's `describe.each` loop must also pass each lesson's `failures` into `createRedisSimulation`, see Step 3)
- Create/modify: `src/brokers/redis/lessons/advanced.test.ts` (append)

- [ ] **Step 1: Write `16-persistence.ts`**

```ts
import { APP } from './types'
import type { RedisLesson } from './types'

export const persistence: RedisLesson = {
  id: '16-persistence',
  group: 'advanced',
  title: 'RDB vs AOF',
  summary:
    'Cùng một chuỗi ghi, một server chỉ có RDB định kỳ và một server AOF `everysec` — cùng crash ở một thời điểm, nhưng mất dữ liệu khác nhau.',
  seed: 16,
  durationMs: 3000,
  topology: {
    clients: [APP],
    server: { id: 'redis', label: 'Redis (RDB)', position: { x: 380, y: 200 }, persistence: { rdb: { everySec: 1 } } },
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['a', '1'] }, // before the snapshot at t=1000: survives
    { at: 1500, clientId: APP.id, name: 'SET', args: ['b', '2'] }, // after it: lost
    { at: 2200, clientId: APP.id, name: 'KEYS', args: ['*'] },
  ],
  failures: [
    { at: 1900, kind: 'crash', target: 'redis' },
    { at: 2000, kind: 'restart', target: 'redis' },
  ],
  narrative: [
    {
      at: 0,
      title: 'RDB chụp toàn bộ keyspace theo chu kỳ',
      body: 'Với `everySec: 1`, cứ mỗi giây ảo server lại chụp một bản chỉ chụp toàn bộ `key` hiện có — không phải log từng lệnh.',
      highlight: ['redis'],
    },
    {
      at: 1000,
      title: 'Bản chụp đầu tiên chỉ có a',
      body: 'Tại t=1000, `b` chưa tồn tại — bản chụp không thể chứa thứ chưa được ghi.',
      highlight: ['redis'],
    },
    {
      at: 1900,
      title: 'Crash xảy ra sau khi b đã ghi nhưng trước bản chụp kế tiếp',
      body: '`b` được ghi ở t=1620 (script t=1500 cộng thời gian truyền lệnh), còn bản chụp kế tiếp phải đợi tới t=2000 — `b` rơi đúng vào khoảng hở đó.',
      highlight: ['redis'],
    },
    {
      at: 2200,
      title: 'Sau restart, chỉ a còn sống',
      body: 'Server phục hồi từ bản chụp cuối cùng nó có — đúng bằng những gì tồn tại tại t=1000, không hơn.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 2800,
      question: 'Nếu server này dùng aof: "always" thay vì RDB, sau cùng một cú crash thì b có còn sống không?',
      options: ['Vẫn mất, always không khác gì RDB', 'Còn sống — always fsync mỗi lệnh ghi, không có khoảng hở nào để mất', 'Tuỳ vào tốc độ đĩa'],
      answerIndex: 1,
      explanation: '`aof: always` fsync ngay sau mỗi lệnh ghi, nên tại bất kỳ thời điểm nào — kể cả ngay trước khi crash — mọi ghi đã hoàn tất đều đã nằm trên đĩa. Cái giá phải trả là một lần fsync cho mỗi lệnh ghi, chậm hơn hẳn everysec hay RDB.',
    },
  ],
}
```

- [ ] **Step 2: Write `17-replication.ts`**

```ts
import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const replication: RedisLesson = {
  id: '17-replication',
  group: 'advanced',
  title: 'Replication, Sentinel & cluster hash slot',
  summary:
    'Ghi trên primary tới replica sau một độ trễ; primary crash, Sentinel đẩy replica lên thay; `CLUSTER KEYSLOT` cho thấy key sẽ rơi vào slot nào nếu cluster hoá.',
  seed: 17,
  durationMs: 3500,
  topology: {
    clients: [APP],
    server: SERVER,
    replicas: [{ id: 'replica-1', label: 'Replica', position: { x: 620, y: 120 }, lagMs: 400 }],
    sentinels: [{ id: 'sentinel-1', label: 'Sentinel', position: { x: 620, y: 280 } }],
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['a', '1'] },
    { at: 400, clientId: APP.id, name: 'SET', args: ['b', '2'] },
    { at: 1600, clientId: APP.id, name: 'CLUSTER', args: ['KEYSLOT', 'a'] },
  ],
  failures: [
    { at: 1200, kind: 'crash', target: 'redis' },
    { at: 1400, kind: 'sentinelFailover', target: 'replica-1' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Mỗi ghi tới replica sau đúng lagMs',
      body: 'Ghi `a` hoàn tất trên primary ở t=120 (thời gian truyền lệnh); replica chỉ thấy nó ở t=520, trễ đúng 400ms đã khai báo.',
      highlight: ['redis', 'replica-1'],
    },
    {
      at: 1200,
      title: 'Primary crash — replica có thể đang lagging',
      body: 'Nếu primary vừa ghi xong một thứ chưa kịp tới replica lúc crash, phần đó sẽ không có mặt trên replica — đây là cái giá của replication bất đồng bộ.',
      highlight: ['redis'],
    },
    {
      at: 1400,
      title: 'Sentinel đẩy replica lên làm primary mới',
      body: 'Sentinel theo dõi primary, phát hiện nó biến mất, và đẩy replica đang có dữ liệu mới nhất lên thay — không cần con người can thiệp.',
      highlight: ['sentinel-1', 'replica-1'],
    },
    {
      at: 1600,
      title: 'CLUSTER KEYSLOT chỉ tính toán, không sharding thật',
      body: 'Slot trả về đúng công thức Redis Cluster thật dùng (CRC16 mod 16384) — nhưng mô phỏng này chưa hề chia dữ liệu ra nhiều node theo slot; đây chỉ là bước đầu để hiểu keyslot là gì trước khi học cluster thật.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 3100,
      question: 'lagMs của replica trong lesson này là 400ms. Điều gì quyết định replica có bị mất ghi khi primary crash hay không?',
      options: [
        'Replica luôn mất đúng lagMs cuối cùng của dữ liệu',
        'Chỉ mất ghi nào chưa kịp tới trong khoảng lagMs trước lúc crash — ghi đã tới thì vẫn còn',
        'Replica không bao giờ mất gì, chỉ chậm hiển thị',
      ],
      answerIndex: 1,
      explanation: 'Replication bất đồng bộ không đảm bảo mọi ghi đều tới replica trước khi primary chết — chỉ những ghi đã có đủ thời gian (ít nhất lagMs) mới chắc chắn đã tới; phần còn nằm "trên đường" lúc crash sẽ không có mặt trên replica được promote.',
    },
  ],
}
```

- [ ] **Step 3: Register both lessons, and pass `failures` through everywhere a lesson runs**

In `registry.ts`, import and append:

```ts
import { persistence } from './16-persistence'
import { replication } from './17-replication'
// ...
export const LESSONS: RedisLesson[] = [
  strings, hash, list, set, zset, ttl, scan, cacheAside, writeThrough, stampede, eviction,
  transactions, lua, distributedLock, rateLimit, persistence, replication,
]
```

In `src/brokers/redis/lessons/lessons.test.ts`, its `start` helper currently reads:

```ts
  const start = () =>
    createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
```

Change it to also pass `failures: lesson.failures` — mirroring exactly how RabbitMQ's own `lessons.test.ts`/`basics.test.ts`/etc. already pass `failures: lesson.failures` (grep `src/brokers/rabbitmq/lessons/lessons.test.ts` for the identical line if unsure of the exact style to match):

```ts
  const start = () =>
    createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed, failures: lesson.failures })
```

Without this change, lessons 16 and 17's `failures` would never actually run inside the *generic* `it.each` suite (determinism, "replies to every command", etc.) — only inside this task's own `advanced.test.ts`, which calls `createRedisSimulation` directly and must do the same (see Step 5).

In `src/brokers/redis/index.ts`, the `createSimulation` adapter currently reads:

```ts
  createSimulation: (options) =>
    createRedisSimulation({
      topology: options.topology,
      script: options.script,
      seed: options.seed,
      maxEvents: options.maxEvents,
    }),
```

Add one line, matching how `src/brokers/rabbitmq/index.ts` already forwards `options.failures` (its comment explains why the cast is needed — `failures` is `unknown[]` at the `BrokerModule` boundary because the shell is broker-agnostic):

```ts
  createSimulation: (options) =>
    createRedisSimulation({
      topology: options.topology,
      script: options.script,
      seed: options.seed,
      // See `src/shell/useSimulation.ts:95` — the shell reads any lesson's
      // `.failures` field generically and hands it through opaquely here,
      // the same mechanism RabbitMQ's `ScriptedFailure[]` already relies on.
      failures: options.failures as RedisFault[] | undefined,
      maxEvents: options.maxEvents,
    }),
```

Import `RedisFault` from `./engine` at the top of this file (it is exported from `engine/index.ts` via `export * from './types'` once Task 13 lands it there — confirm this by checking that `RedisFault` is actually declared in `engine/types.ts` or `engine/index.ts`, not only in `lessons/types.ts`; Task 13 Step 5 settled on defining it once in `engine/index.ts` and re-exporting from `lessons/types.ts`, so `./engine` is the correct import site here).

Update `src/brokers/redis/lessons/types.ts`'s `RedisFault` to the re-export form noted in Task 13 Step 5, if not already done there:

```ts
export type { RedisFault } from '../engine'
```

- [ ] **Step 4: Update the lesson-count test to 17**

Same file/pattern as Task 8 Step 4.

- [ ] **Step 5: Extend `advanced.test.ts`**

```ts
// append to src/brokers/redis/lessons/advanced.test.ts
import { persistence } from './16-persistence'
import { replication } from './17-replication'

function runWithFailures(lesson: RedisLesson) {
  return createRedisSimulation({
    topology: lesson.topology,
    script: lesson.script,
    seed: lesson.seed,
    failures: lesson.failures,
  })
}

describe('16 persistence', () => {
  it('keeps a but loses b after the RDB-only server crashes and restarts', () => {
    const sim = runWithFailures(persistence)
    sim.advanceTo(persistence.durationMs)
    const state = sim.snapshot()
    expect(state.keys['a']).toBeDefined()
    expect(state.keys['b']).toBeUndefined()
  })
})

describe('17 replication', () => {
  it('promotes replica-1 to primaryId after the sentinelFailover fault', () => {
    const sim = runWithFailures(replication)
    sim.advanceTo(replication.durationMs)
    expect(sim.snapshot().primaryId).toBe('replica-1')
  })

  it('answers CLUSTER KEYSLOT with an in-range integer', () => {
    const sim = runWithFailures(replication)
    sim.advanceTo(replication.durationMs)
    const line = sim.snapshot().journal.find((e) => e.text.startsWith('CLUSTER'))!
    expect(line.text).toMatch(/CLUSTER "KEYSLOT" "a" → \(integer\) \d+/)
  })
})
```

- [ ] **Step 6: Run everything**

Run: `npx vitest run src/brokers/redis/`
Expected: PASS across `lessons.test.ts`'s generic suite (now covering all 17 lessons, including the two with `failures`) and `advanced.test.ts`.

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/brokers/redis/lessons/16-persistence.ts src/brokers/redis/lessons/17-replication.ts src/brokers/redis/lessons/registry.ts src/brokers/redis/lessons/lessons.test.ts src/brokers/redis/lessons/advanced.test.ts src/brokers/redis/lessons/types.ts src/brokers/redis/index.ts
git commit -m "feat(redis): lesson 16 — RDB vs AOF, lesson 17 — replication, Sentinel & cluster hash slot"
```

---

### Task 16: UI — `ReplicaNode`, `SentinelNode`, and their edges

**Files:**
- Modify: `src/brokers/redis/ui/nodes.tsx`
- Modify: `src/brokers/redis/ui/toFlow.ts`
- Modify: `src/brokers/redis/index.ts` (register the two node types)
- Test: `src/brokers/redis/ui/nodes.test.tsx` (extend)
- Test: `src/brokers/redis/ui/toFlow.test.ts` (extend)

**Interfaces:**
- Consumes: `RedisReplicaSpec`, `RedisSentinelSpec`, `RedisState.replicaState`/`.writeCounter`/`.primaryId` (Task 11, 14).

- [ ] **Step 1: Write the failing tests**

Read `src/brokers/redis/ui/nodes.test.tsx` and `src/brokers/redis/ui/toFlow.test.ts` first to match their existing render/assert style (likely `@testing-library/react` for the former, plain object assertions for the latter — do not guess, copy the pattern already used for `ClientNode`/`ServerNode` and `toFlowNodes`/`toFlowEdges`). Add:

```ts
// nodes.test.tsx — mirror the existing ServerNode test's render + query style
it('ReplicaNode shows the lag between writeCounter and appliedWriteCounter', () => {
  // render <ReplicaNode data={{ label: 'Replica', lagMs: 400, appliedWriteCounter: 2, writeCounter: 5 }} ... />
  // assert the rendered text communicates "3 behind" or equivalent — match whatever
  // phrasing convention ServerNode already uses for its own numbers (e.g. "X / Y").
})

it('SentinelNode renders its label', () => {
  // render <SentinelNode data={{ label: 'Sentinel' }} ... /> and assert the label text appears
})
```

```ts
// toFlow.test.ts — mirror the existing toFlowNodes/toFlowEdges tests
it('toFlowNodes includes a node per replica and per sentinel when the topology declares them', () => {
  // build a RedisTopology with one replica and one sentinel, a RedisState with
  // matching replicaState, call toFlowNodes, assert the returned array has
  // matching `id`/`type: 'replica'` and `type: 'sentinel'` entries
})

it('toFlowEdges adds a dashed server->replica edge and a sentinel->server edge', () => {
  // assert an edge with id `${server.id}->${replica.id}` exists, and one
  // with id `${sentinel.id}->${server.id}` exists
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/brokers/redis/ui/`
Expected: FAIL — `ReplicaNode`/`SentinelNode` not exported; `toFlowNodes`/`toFlowEdges` don't yet look at `topology.replicas`/`.sentinels`.

- [ ] **Step 3: Add the two node components**

In `src/brokers/redis/ui/nodes.tsx`, following the existing `ClientNode`/`ServerNode` pattern (same `SHELL`/`highlightClass` helpers, a new unused hue — `amber` for replica, `violet` for sentinel, matching the file's own comment about picking hues RabbitMQ doesn't use):

```tsx
export function ReplicaNode({ data, selected }: NodeProps) {
  const appliedWriteCounter = Number(data.appliedWriteCounter)
  const writeCounter = Number(data.writeCounter)
  const behind = writeCounter - appliedWriteCounter

  return (
    <div className={`${SHELL} border-amber-500 bg-amber-950 ${selected ? 'ring-2 ring-amber-300' : ''} ${highlightClass(data)}`}>
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-amber-200">{String(data.label)}</div>
      <div className="text-[10px] text-amber-400">lag {String(data.lagMs)}ms</div>
      <div className="text-[10px] text-amber-400">{behind === 0 ? 'đã bắt kịp' : `chậm ${behind} ghi`}</div>
    </div>
  )
}

export function SentinelNode({ data, selected }: NodeProps) {
  return (
    <div className={`${SHELL} border-violet-500 bg-violet-950 ${selected ? 'ring-2 ring-violet-300' : ''} ${highlightClass(data)}`}>
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-violet-200">{String(data.label)}</div>
      <div className="text-[10px] text-violet-400">sentinel</div>
    </div>
  )
}
```

- [ ] **Step 4: Extend `toFlowNodes`/`toFlowEdges`**

In `src/brokers/redis/ui/toFlow.ts`, extend `toFlowNodes` to append replica and sentinel nodes:

```ts
  const replicaNodes = (topology.replicas ?? []).map<Node>((replica) => ({
    id: replica.id,
    type: 'replica',
    position: replica.position,
    data: {
      label: replica.label,
      lagMs: replica.lagMs,
      appliedWriteCounter: state.replicaState[replica.id]?.appliedWriteCounter ?? 0,
      writeCounter: state.writeCounter,
      highlighted: emphasised.has(replica.id),
    },
  }))

  const sentinelNodes = (topology.sentinels ?? []).map<Node>((sentinel) => ({
    id: sentinel.id,
    type: 'sentinel',
    position: sentinel.position,
    data: { label: sentinel.label, highlighted: emphasised.has(sentinel.id) },
  }))

  return [...clients, serverNode, ...replicaNodes, ...sentinelNodes]
```

(Replace the existing `return [...clients, serverNode]` line with the one above.)

Extend `toFlowEdges`:

```ts
export function toFlowEdges(topology: RedisTopology): Edge[] {
  const serverId = topology.server.id
  const edges: Edge[] = []
  for (const client of topology.clients) {
    edges.push(edge(client.id, serverId))
    edges.push(edge(serverId, client.id))
  }
  for (const replica of topology.replicas ?? []) {
    edges.push({ ...edge(serverId, replica.id), style: { stroke: '#475569', strokeDasharray: '4 4' } })
  }
  for (const sentinel of topology.sentinels ?? []) {
    edges.push(edge(sentinel.id, serverId))
  }
  return edges
}
```

- [ ] **Step 5: Register the node types**

In `src/brokers/redis/index.ts`, add the import and extend `nodeTypes`:

```ts
import { ClientNode, ReplicaNode, SentinelNode, ServerNode } from './ui/nodes'
// ...
  nodeTypes: { client: ClientNode, server: ServerNode, replica: ReplicaNode, sentinel: SentinelNode },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/brokers/redis/ui/`
Expected: PASS

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 8: Manual check — run the lesson in the browser**

Run: `npm run dev`, open the app, switch to Redis, open lesson `17-replication`, press **Chạy**. Confirm the replica and sentinel nodes render on the canvas, the dashed edge from server to replica appears, and the replica node's "chậm N ghi" text changes as the run advances. This is a genuinely new visual (two node types nothing before this task exercised), so `npm test` passing is not sufficient evidence it's right.

- [ ] **Step 9: Commit**

```bash
git add src/brokers/redis/ui/nodes.tsx src/brokers/redis/ui/toFlow.ts src/brokers/redis/ui/nodes.test.tsx src/brokers/redis/ui/toFlow.test.ts src/brokers/redis/index.ts
git commit -m "feat(redis): ReplicaNode, SentinelNode, and their canvas edges"
```

---

### Task 17: Final README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Redis bullet to 17 lessons**

Replace the bullet Task 10 Step 3 left in place with:

```
- **Redis** — 17 lesson trải trên bốn nhóm (`basics`/Cơ bản, `cache`/Cache,
  `messaging`/Messaging — còn trống, để dành cho một plan sau,
  `advanced`/Nâng cao): String & counter, Hash, List, Set, Sorted Set, TTL,
  `SCAN` thay `KEYS`, cache-aside, write-through & write-behind, cache
  stampede, `maxmemory` & eviction policy, transactions, Lua atomicity,
  distributed lock, sliding-window rate limit, RDB vs AOF, replication &
  Sentinel & cluster hash slot.
```

Update the "Redis chưa có Sandbox và chưa có xuất code" paragraph only if it also states a lesson count anywhere (grep first: `grep -n "chưa có Sandbox" README.md`) — otherwise leave it untouched, since Sandbox truly is still absent and out of this plan's scope.

Update the `npm test` line's exact test/file count comment to whatever `npm test`'s real summary line reports after Task 16 (grep `grep -n "test trên" README.md` first, then run `npm test` and copy the real numbers — do not guess them).

- [ ] **Step 2: Full suite + typecheck + lint one last time**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green — this is the last task of the plan.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Redis advanced lesson group is complete — 17 lessons"
```

---

## Self-Review Notes

- **Spec coverage:** every §5/§4 item in the design doc has a task — transactions (Task 2), Lua (Tasks 3–6), distributed lock (Task 9, reuses Task 6's `EVAL`), rate limit (Tasks 7, 9), RDB/AOF (Task 13), replication/Sentinel/cluster (Tasks 12, 14, 16). The three noted deviations (`failures` field name, dropped `changes` sub-field, scripted-not-computed failover target) are each called out where they first matter (Global Constraints, and again inline at Task 13/15) rather than left implicit.
- **Circular imports** (`commands/tx.ts` and `commands/script.ts` both importing `HANDLERS` from `commands/index.ts`, which imports them) are flagged with a fallback plan (a `dispatch` callback on `CommandContext`) in case the live-binding assumption doesn't hold in this build — Task 2 Step 5 and Task 6 Step 5 are where that would surface first, and both point at the same fix.
- **Type consistency check:** `RedisFault` is defined once (Task 13, in `engine/index.ts`) and re-exported from `lessons/types.ts` — Task 15 Step 3 calls this out explicitly to avoid two divergent definitions. `touchKey` (Task 1) is the one function every key-mutation path routes through, and Task 11 extends it in place rather than adding a second version-bumping helper. `QueuedCommand`/`WatchedKey` (Task 2) and `ReplicaRuntime`-shaped `replicaState` entries (Task 11) are each defined once and referenced by name in every later task that touches them.
