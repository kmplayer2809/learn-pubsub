import type { EngineState, ScriptedAction, Topology } from '../engine'
// The base `Lesson<Topology, ScriptedAction>`, not RabbitMQ's own narrower `Lesson`
// (lessons/types.ts, which tightens `group` to `LessonGroup`): the `BrokerModule`
// contract's `NodeConfig` slot is typed against the base generic, and this component
// never reads `lesson.group` — only `lesson.topology`, which is identical either way.
import type { Lesson } from '../../../shell/lesson/types'

export function NodeConfig({
  lesson,
  state,
  nodeId,
}: {
  lesson: Lesson<Topology, ScriptedAction>
  state: EngineState
  nodeId: string
}) {
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
        <dt>prefetch</dt><dd className="text-slate-200">{consumer.prefetch || 'không giới hạn'}</dd>
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

  return <p className="text-[11px] text-slate-500">Node này không có cấu hình.</p>
}
