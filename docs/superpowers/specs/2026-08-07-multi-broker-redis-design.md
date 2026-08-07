# Multi-broker shell + Redis learning module — Design

**Date:** 2026-08-07
**Status:** Approved

## 1. Purpose

The application today teaches exactly one broker. `src/engine/` models AMQP, `src/lessons/`
holds seventeen RabbitMQ lessons, and `src/ui/` draws publishers, exchanges, queues, and
consumers. Nothing in the shell is written to host a second broker.

This project does two things:

1. Restructures the application into a **broker-agnostic shell** plus **broker modules**, so
   that adding Kafka later is adding one directory and one registry entry — not a second
   fork of the shell.
2. Delivers a **Redis learning module** of the same depth as the RabbitMQ one: twenty-one
   guided lessons across four groups, a Redis-specific canvas and keyspace panel, and a free
   Sandbox with a command console and code export.

The teaching stance from the original design carries over unchanged: comprehension over
wire fidelity, pause/step/rewind over realism, no broker and no backend.

## 2. Key decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Broker selection | Switcher pinned to the top of the left sidebar | One click to switch, no extra navigation layer, no router. A new broker is one more entry. |
| Code layout | `src/shell/` + `src/brokers/<id>/` | `src/engine` naming already lies (it is AMQP-only); with Kafka added it would lie permanently. |
| Engine sharing | Extract a shared kernel, keep domain reducers separate | Only the timing machinery is common. AMQP routing and Redis command semantics share nothing but "events have timestamps". |
| Redis visualisation | React Flow canvas + Keyspace panel | Commands and replies animate on edges (reusing `MessageLayer`); the keyspace panel is where Redis state is actually legible. |
| Redis expiry model | Lazy on access **and** an active expire cycle | The gap between the two is the lesson. A single model would teach the wrong thing. |
| Redis Sandbox parser | Shares the engine's command handler table | One source of truth for command semantics; a second parser would drift from the engine. |
| Determinism | Unchanged contract, now enforced across all broker engines | `purity.test.ts` is generalised rather than duplicated. |

## 3. Architecture

```
src/
  shell/
    kernel/          rng.ts, clock.ts, run.ts (run loop + event ceiling + journal cap)
    lesson/          Lesson<T,A>, NarrativeStep, Checkpoint, activeStep
    store.ts         Zustand: brokerId, lessonId, sandbox, transport state
    ui/              App, BrokerSwitcher, LessonSidebar, Transport, Inspector,
                     CanvasView (React Flow shell), canvas/MessageLayer, canvas/geometry
  brokers/
    registry.ts      BROKERS: BrokerModule[]  — the only place both brokers are named
    rabbitmq/        engine/ lessons/ sandbox/ ui/     (moved, behaviour unchanged)
    redis/           engine/ lessons/ sandbox/ ui/     (new)
```

### 3.1 The BrokerModule contract

The shell knows this interface and nothing else. It never mentions an exchange or a key.

```ts
export interface BrokerModule<S, T, A> {
  id: string                                    // 'rabbitmq' | 'redis'
  label: string                                 // 'RabbitMQ' | 'Redis'
  lessonGroups: { id: string; label: string }[]
  lessons: Lesson<T, A>[]
  defaultLessonId: string
  createSimulation(options: SimulationOptions<T, A>): Simulation<S>
  validate(topology: T): ValidationIssue[]
  nodeTypes: NodeTypes                          // React Flow node components
  toFlow(topology: T, state: S, highlight?: string[]): { nodes: Node[]; edges: Edge[] }
  inFlight(state: S): InFlight[]                // drives MessageLayer
  StatePanel: FC<{ state: S }>                  // InFlightPanel | KeyspacePanel
  sandbox?: BrokerSandbox<S, T, A>              // optional: a broker may ship without one
}
```

`Simulation<S>` keeps its current shape — `advanceTo`, `stepOnce`, `reset`, `nextEventTime`,
`snapshot`, `issues` — so `useSimulation` becomes generic over `S` with no behaviour change.

`InFlight` moves to `src/shell/kernel/types.ts` unchanged: `{ message: { id, label, tone }, edgeId, fromT, toT }`.
RabbitMQ maps its AMQP `Message` into that shape; Redis maps a command or a reply into it.
Neither the message layer nor the geometry helpers learn anything broker-specific.

### 3.2 Shared kernel

Moved out of `src/engine/` with no semantic change:

- `rng.ts` — mulberry32, `[value, nextRngState]`, no hidden state.
- `clock.ts` — min-heap scheduler, `peekTime`/`popDue`/`pushAll`.
- `run.ts` — the drain-one-timestamp-per-iteration loop, the `MAX_EVENTS_PER_RUN` ceiling,
  `capJournal` at `MAX_JOURNAL`. It takes a reducer table and a seed-event function from the
  broker and is otherwise identical to today's `createSimulation`.

Each broker supplies its own `EngineState` shape, reducer table, `seedEvents`, and
`validate`. `Metrics` is per-broker: AMQP's counters do not describe Redis and vice versa.

### 3.3 Determinism contract

Unchanged and now broader. `purity.test.ts` moves to `src/shell/kernel/` and greps
`src/shell/kernel/**` plus every `src/brokers/*/engine/**` (excluding `*.test.ts`) for
`Math.random`, `Date.now`, `new Date`, `setTimeout`, `setInterval`, `performance.now`, and
imports of React, Zustand, or `@xyflow/react`. A new broker is covered the moment its
directory exists — no test edit required.

## 4. The Redis engine

### 4.1 Topology

```ts
interface RedisTopology {
  clients: { id, label, position }[]
  server: {
    id, label, position
    maxmemoryBytes?: number
    evictionPolicy?: 'noeviction' | 'allkeys-lru' | 'allkeys-lfu' | 'volatile-lru' | 'volatile-ttl' | 'allkeys-random'
    persistence?: { rdb?: { everySec: number; changes: number }; aof?: 'always' | 'everysec' | 'no' }
    activeExpireEveryMs?: number   // default 100, Redis' own cycle
  }
  replicas?: { id, label, position, lagMs: number }[]
  sentinels?: { id, label, position }[]
  channels?: { id, pattern?: string }[]              // Pub/Sub
  streams?: { id, maxLen?: number }[]
  groups?: { id, streamId, consumers: { id, label, position, idleTimeoutMs? }[] }[]
  subscriptions?: { clientId, channelId, kind: 'channel' | 'pattern' }[]
}
```

### 4.2 Script

```ts
interface RedisCommand {
  at: number
  clientId: NodeId
  name: RedisCommandName
  args: string[]
  tone?: string
}
```

`RedisCommandName` is a string-literal union, not `string`: an unknown command must be a
type error in a lesson and a console reply in the Sandbox, never a silent no-op. It grows
one phase at a time — phase 3 adds the data-structure and keyspace commands (`SET`, `GET`,
`DEL`, `INCR`, `EXPIRE`, `TTL`, `PERSIST`, `HSET`, `HGETALL`, `LPUSH`, `RPUSH`, `LPOP`,
`RPOP`, `BLPOP`, `LRANGE`, `SADD`, `SREM`, `SINTER`, `SMEMBERS`, `ZADD`, `ZRANGE`,
`ZINCRBY`, `SCAN`, `KEYS`, `TYPE`, `EXISTS`, `DBSIZE`, `CONFIG SET`), phase 5 adds
`PUBLISH`/`SUBSCRIBE`/`PSUBSCRIBE`/`XADD`/`XREAD`/`XREADGROUP`/`XACK`/`XAUTOCLAIM`/`XPENDING`,
and phase 6 adds `MULTI`/`EXEC`/`DISCARD`/`WATCH`/`EVAL`/`BGSAVE`/`BGREWRITEAOF`/`REPLICAOF`/
`FAILOVER`/`CLUSTER KEYSLOT`. Every name added in a phase ships with its handler and tests
in that same phase.

### 4.3 Events and reducers

| Event | Meaning |
| --- | --- |
| `command` | A client's command arrives at the server; dispatched to its handler. |
| `reply` | The server's response travels back to the client (animates on the edge). |
| `activeExpire` | The periodic expire cycle samples keys and removes the dead ones. |
| `evict` | `memoryUsed` exceeded `maxmemory`; the policy picks a victim. |
| `deliver` | A Pub/Sub message reaches one subscriber. |
| `streamDeliver` | A stream entry is handed to a consumer-group member (enters the PEL). |
| `claim` | `XAUTOCLAIM` moves an idle pending entry to another consumer. |
| `replicate` | A write reaches a replica after its `lagMs`. |
| `failover` | Sentinel promotes a replica. |
| `snapshotWrite` | RDB save point / AOF fsync boundary, used by the persistence lesson. |

Command handlers live in `src/brokers/redis/engine/commands/{string,hash,list,set,zset,keyspace,pubsub,stream,tx,script,server}.ts`,
mirroring how `engine/routing/{direct,fanout,topic,headers}.ts` is organised on the
RabbitMQ side. Each is a pure `(state, command) => { state, newEvents }`.

### 4.4 Key semantics that the lessons depend on

- **Expiry.** A key past its expiry is removed *lazily* the first time any command touches
  it, and *actively* by the `activeExpire` cycle which samples up to twenty keys per pass.
  A key can therefore sit dead-but-present in the keyspace panel for a visible interval —
  the lesson names that interval.
- **Eviction.** Writes recompute `memoryUsed` from an approximate per-type size model. When
  it exceeds `maxmemory`, the configured policy selects victims until it fits, or the write
  fails with OOM under `noeviction`. `volatile-*` policies consider only keys with a TTL,
  and fail the same way when none exist — that failure mode is a lesson.
- **Pub/Sub.** Fire-and-forget. A `PUBLISH` with no current subscriber is delivered to
  nobody and is not stored. `metrics.delivered` counting zero on a published message is the
  point of the lesson, contrasted directly with a RabbitMQ queue.
- **Streams.** Entries persist. A consumer group tracks a `last-delivered-id` and a Pending
  Entries List per consumer; `XACK` removes from the PEL; `XAUTOCLAIM` reassigns entries
  idle beyond a threshold. This is the closest Redis analogue to a RabbitMQ queue and is
  taught as such.
- **Transactions.** `MULTI` queues commands and `EXEC` applies them as one atomic step;
  `WATCH` aborts `EXEC` if a watched key changed in between. `EVAL` applies a Lua script as
  a single indivisible event — no other command interleaves.

### 4.5 Metrics

`commands`, `hits`, `misses`, `expired`, `evicted`, `keysCount`, `memoryUsed`, `published`,
`delivered`, `pendingEntries`, `replicaLagMs`.

### 4.6 Journal

Entries render as redis-cli transcript lines: `SET user:1 "alice" EX 60 → OK`,
`GET user:1 → (nil)  # expired lazily`. The Inspector's existing event log renders them with
no change beyond taking text from the broker's journal.

### 4.7 Validation

`validateRedisTopology` returns the same `ValidationIssue` shape the Inspector already
renders: a client referencing a missing server; a subscription to an undeclared channel; a
consumer group on an undeclared stream; `maxmemory` set with `noeviction` and a script that
only writes; a replica with no primary; `activeExpireEveryMs` of zero.

## 5. Redis UI

- **Nodes:** `ClientNode`, `ServerNode` (shows `memoryUsed / maxmemory` and policy),
  `ReplicaNode` (lag), `ChannelNode` (subscriber count), `StreamNode` (length, last id),
  `ConsumerGroupNode` (PEL depth), `SentinelNode`.
- **Edges:** client↔server (commands and replies), server→replica (replication, dashed),
  server→channel→subscriber (Pub/Sub), stream→group→consumer.
- **KeyspacePanel** replaces `InFlightPanel` when Redis is active: key | type | value summary |
  TTL countdown | approximate size. Insertion-ordered, filterable by prefix. Keys near
  expiry pulse; evicted keys fade out for one transport frame before leaving the table.
- **Inspector** is unchanged: narrative markdown, checkpoint quiz, validation issues, journal.
  Narrative `highlight` targets Redis node ids exactly as it targets AMQP node ids today.

## 6. Lessons

Twenty-one lessons in four groups. Every lesson is a fixed topology plus a scripted command
sequence, a narrative, and at least one checkpoint — the same `Lesson` shape as RabbitMQ,
parameterised by topology and script type.

**Cơ bản (7)** — keyspace & String/INCR · Hash · List as queue vs stack (`BLPOP`) ·
Set (`SADD`/`SINTER`) · Sorted Set leaderboard · TTL & expiry (lazy vs active) · `SCAN` vs `KEYS`.

**Cache (4)** — cache-aside · write-through vs write-behind · cache stampede and the lock
that prevents it · `maxmemory` with LRU/LFU and `allkeys` vs `volatile`.

**Messaging (4)** — Pub/Sub fire-and-forget · Streams `XADD`/`XREAD` · consumer group with
`XACK` and the PEL · `XAUTOCLAIM` after a consumer dies. The last lesson compares the group
to a RabbitMQ queue directly.

**Nâng cao (6)** — `MULTI`/`EXEC`/`WATCH` · Lua atomicity · distributed lock `SET NX PX` and
why Redlock is contested · sliding-window rate limiting · RDB vs AOF (what a crash loses) ·
replication, Sentinel failover, and cluster hash slots.

Copy rules are inherited from `language.test.ts`: narrative bodies and summaries in
Vietnamese, Redis and programming terms left in English (key, TTL, eviction, keyspace,
stream, consumer group, pipeline, transaction, replica, hash slot, pending entries list).
Titles may stay English when they are the plain name of the concept being taught.

## 7. Redis Sandbox

- Drag-and-drop canvas for clients, server, replicas, channels, streams, and consumer groups.
- **Command console:** a text input that parses one redis-cli line and feeds it to the same
  handler table the engine uses. Unknown commands and arity errors surface as console
  replies, not exceptions.
- Editable server settings: `maxmemory`, eviction policy, persistence mode, active-expire
  interval.
- Live keyspace panel, persisted to `localStorage` the way the RabbitMQ sandbox persists its
  topology.
- **Export** to `ioredis` and to NestJS (`@nestjs/cache-manager` with an ioredis store),
  following the structure of `src/brokers/rabbitmq/sandbox/export/`.

## 8. Testing

- `purity.test.ts` (kernel) covers both engines and every future one.
- `it.each` over `BROKERS` × their lessons: topology validates without an `error` issue, the
  run is deterministic across two passes, every command receives a reply, and the journal
  snapshot is stable.
- Per-group Redis behaviour tests mirroring `basics.test.ts` / `reliability.test.ts` /
  `patterns.test.ts`: expiry timing, eviction victim choice per policy, PEL lifecycle,
  `WATCH` abort, Lua atomicity, replication lag.
- Shell tests: the broker switcher changes lessons, canvas, and state panel together; a
  broker without a sandbox hides the Sandbox button; switching brokers resets transport
  state and replays from zero.
- The existing 322 RabbitMQ tests must stay green through the restructure. They move with
  their code; only import paths change in phase 1.

## 9. Delivery phases

Each phase ends with `npm test`, `npm run typecheck`, and `npm run lint` green, and is
committed on its own.

1. **Kernel + contract + move.** Extract `src/shell/kernel/`, define `BrokerModule`, move
   RabbitMQ into `src/brokers/rabbitmq/`. No behaviour change.
2. **Generic shell.** `brokerId` in the store, `BrokerSwitcher` in the sidebar, `CanvasView`
   takes `nodeTypes`/`toFlow` from the module, `StatePanel` slot, optional sandbox.
3. **Redis engine core.** Topology, command dispatch, data-structure handlers, TTL, eviction.
4. **Lessons: Cơ bản + Cache** (11 lessons).
5. **Pub/Sub + Streams** engine support and the Messaging lessons (4).
6. **Nâng cao** engine support (tx, Lua, persistence, replication) and its lessons (6).
7. **Redis Sandbox** and code export.

## 10. Out of scope

- A real Redis connection or any backend.
- RESP protocol fidelity, real memory accounting, real cluster resharding.
- Kafka. The contract is built so Kafka is additive; no Kafka code ships here.
- Changing any RabbitMQ lesson's content. Phase 1 moves that code; it does not rewrite it.
