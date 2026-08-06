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
