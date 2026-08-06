import type { EngineState, JournalEntry, Metrics, ValidationIssue } from '../../engine'
import type { Lesson } from '../../lessons/types'
import { useAppStore } from '../../sim/store'
import { activeStepIndex } from './activeStep'
import { vietnameseIssueMessage, vietnameseSeverityLabel } from './issueText'
import { Markdown, MarkdownInline } from './Markdown'

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

/** Shared with SandboxPanel so a topology's validation errors/warnings render identically in both places. */
export function IssuesList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null
  return (
    <section className="rounded border border-rose-700 bg-rose-950 p-2">
      {issues.map((issue, i) => (
        <p key={i} className="text-[11px] text-rose-200">
          {vietnameseSeverityLabel(issue.severity)}: {vietnameseIssueMessage(issue)}
        </p>
      ))}
    </section>
  )
}

/** Shared with SandboxPanel: a user-built topology can loop, so both surfaces need the same halted message. */
export function HaltedBanner({ halted }: { halted?: { reason: string } }) {
  if (!halted) return null
  return (
    <p className="rounded border border-amber-700 bg-amber-950 p-2 text-[11px] text-amber-200">
      Đã dừng: {halted.reason}
    </p>
  )
}

/**
 * Shared with SandboxPanel: driven generically by `Object.entries`, so a new
 * counter in `Metrics` appears in both surfaces with no per-counter work.
 * Metric keys (`published`, `routed`, ...) stay English, matching lesson mode.
 */
export function MetricsGrid({ metrics }: { metrics: Metrics }) {
  return (
    <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-400">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key} className="contents">
          <dt>{key}</dt>
          <dd className="text-slate-200">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Shared with SandboxPanel: the last 40 journal entries, newest first. */
export function EventLog({ journal }: { journal: JournalEntry[] }) {
  return (
    <ul className="space-y-0.5 font-mono text-[10px] text-slate-400">
      {journal
        .slice(-40)
        .reverse()
        .map((entry, i) => (
          <li key={i}>
            <span className="text-slate-600">{(entry.at / 1000).toFixed(1)}s </span>
            {entry.text}
          </li>
        ))}
    </ul>
  )
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
        <h2 className="mb-1 text-sm font-semibold text-slate-100">
          <MarkdownInline text={step?.title ?? lesson.title} />
        </h2>
        <Markdown text={step?.body ?? lesson.summary} />
      </section>

      <IssuesList issues={issues} />

      <HaltedBanner halted={state.halted} />

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          {selectedNodeId ? `Cấu hình · ${selectedNodeId}` : 'Chỉ số'}
        </h3>
        {selectedNodeId ? (
          <NodeConfig lesson={lesson} state={state} nodeId={selectedNodeId} />
        ) : (
          <MetricsGrid metrics={state.metrics} />
        )}
      </section>

      <section className="min-h-0 flex-1">
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Nhật ký sự kiện</h3>
        <EventLog journal={state.journal} />
      </section>
    </div>
  )
}
