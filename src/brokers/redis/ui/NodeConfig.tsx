import type { RedisScriptedCommand, RedisState, RedisTopology } from '../engine'
// The base `Lesson<RedisTopology, RedisScriptedCommand>`, not a narrower Redis lesson
// type, for the same reason RabbitMQ's `NodeConfig.tsx` gives — the `BrokerModule`
// contract's `NodeConfig` slot (Amendment 3) is typed against the base generic, and
// this component never reads a Redis-lesson-only field, only `lesson.topology`.
import type { Lesson } from '../../../shell/lesson/types'

export function NodeConfig({
  lesson,
  state,
  nodeId,
}: {
  lesson: Lesson<RedisTopology, RedisScriptedCommand>
  state: RedisState
  nodeId: string
}) {
  const server = lesson.topology.server.id === nodeId ? lesson.topology.server : undefined
  const client = lesson.topology.clients.find((c) => c.id === nodeId)

  if (server) {
    return (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <dt>maxmemory</dt>
        <dd className="text-slate-200">{server.maxmemoryBytes ?? '—'}</dd>
        <dt>eviction policy</dt>
        <dd className="text-slate-200">{server.evictionPolicy ?? 'noeviction'}</dd>
        <dt>active-expire every</dt>
        <dd className="text-slate-200">{server.activeExpireEveryMs ?? '—'}</dd>
        <dt>keys</dt>
        <dd className="text-slate-200">{state.metrics.keysCount}</dd>
        <dt>memory used</dt>
        <dd className="text-slate-200">{state.metrics.memoryUsed}</dd>
      </dl>
    )
  }

  if (client) {
    // `RedisState` carries no per-client command counter — `metrics.commands` is a
    // single global total, and `commandCounter` (types.ts) mints BLPOP commandIds,
    // it does not tally per client either. The nearest thing state actually exposes
    // is the journal: every completed command and every resolved BLPOP (woken or
    // timed out) appends one `JournalEntry` stamped with `nodeId: clientId`
    // (see `applyReply` and `applyUnblock` in `engine/index.ts`). Counting journal
    // entries for this client is therefore an undercount, not an exact tally: a
    // command still travelling to the server, or a BLPOP still parked on
    // `state.blocked`, has been issued but not yet journalled. Reporting that gap
    // rather than inventing a counter or widening the engine is deliberate — see
    // the Task 8 report.
    const commandCount = state.journal.filter((entry) => entry.nodeId === client.id).length
    // The half of that undercount worth surfacing. A parked client is the one case
    // where the missing command is the whole point: lesson 03's worker sits on
    // BLPOP for four seconds, and a panel showing only a command count renders it
    // as a client that has gone quiet rather than one that is visibly waiting.
    // A command merely in flight stays uncounted — it resolves within 120ms and
    // `RedisFlight` is keyed by edge rather than by client, so recovering the
    // client would mean parsing an edge id back apart.
    const parked = state.blocked.find((entry) => entry.clientId === client.id)
    return (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <dt>client</dt>
        <dd className="text-slate-200">{client.label}</dd>
        <dt>commands</dt>
        <dd className="text-slate-200">{commandCount}</dd>
        {parked && (
          <>
            <dt>đang chờ</dt>
            <dd className="text-amber-400">BLPOP {parked.keys.join(' ')}</dd>
          </>
        )}
      </dl>
    )
  }

  return <p className="text-[11px] text-slate-500">Node này không có cấu hình.</p>
}
