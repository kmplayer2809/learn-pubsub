import { useState } from 'react'
import type { AnyBrokerModule } from '../../../brokers/types'
import type { JournalEntry, KernelState, ValidationIssueBase } from '../../kernel/types'
import type { Lesson } from '../../lesson/types'
import { useAppStore } from '../../store'
import { activeStepIndex } from '../../lesson/activeStep'
import { CheckpointSection } from './CheckpointCard'
import { Markdown, MarkdownInline } from './Markdown'

/** Vietnamese label for a severity shared by every broker's `ValidationIssueBase`. */
const SEVERITY_LABEL: Record<ValidationIssueBase['severity'], string> = {
  error: 'lỗi',
  warning: 'cảnh báo',
}

/**
 * Shared with SandboxPanel so a topology's validation errors/warnings render identically
 * in both places. `issueText` renders the broker-specific sentence; this component and
 * its caller never know what shape an issue's own fields take beyond the shared base.
 */
export function IssuesList({
  issues,
  issueText,
}: {
  issues: ValidationIssueBase[]
  // Method shorthand (not `issueText: (issue: ValidationIssueBase) => string`)
  // deliberately: TypeScript checks method-shaped parameters bivariantly, which is what
  // lets a broker's own narrower issue-rendering function (e.g. RabbitMQ's
  // `vietnameseIssueMessage(issue: ValidationIssue)`, which `switch`es on a `code` field
  // `ValidationIssueBase` doesn't have) satisfy this prop without a cast. A strict
  // property-typed function here would reject that assignment outright.
  issueText(issue: ValidationIssueBase): string
}) {
  if (issues.length === 0) return null
  return (
    <section className="rounded border border-rose-700 bg-rose-950 p-2">
      {issues.map((issue, i) => (
        <p key={i} className="text-[11px] text-rose-200">
          {SEVERITY_LABEL[issue.severity]}: {issueText(issue)}
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
export function MetricsGrid({ metrics }: { metrics: Record<string, number> }) {
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
  broker,
  lesson,
  state,
  issues,
}: {
  broker: AnyBrokerModule
  lesson: Lesson<any, any>
  state: KernelState
  issues: ValidationIssueBase[]
}) {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const step = lesson.narrative[activeStepIndex(lesson.narrative, state.now)]
  const [exportOpen, setExportOpen] = useState(false)
  const { NodeConfig, ExportDialog } = broker

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto" data-testid="inspector">
      <section>
        <div className="flex items-start justify-between gap-2">
          <h2 className="mb-1 text-sm font-semibold text-slate-100">
            <MarkdownInline text={step?.title ?? lesson.title} />
          </h2>
          {ExportDialog && (
            <button
              onClick={() => setExportOpen(true)}
              data-testid="export-button"
              className="min-h-11 shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 md:min-h-0"
            >
              Xuất code
            </button>
          )}
        </div>
        <Markdown text={step?.body ?? lesson.summary} />
      </section>

      {exportOpen && ExportDialog && (
        <ExportDialog topology={lesson.topology} onClose={() => setExportOpen(false)} />
      )}

      {/* Lesson-only: the sandbox has no narrative and no checkpoints, so SandboxPanel
          deliberately does not render this the way it shares IssuesList/MetricsGrid. */}
      <CheckpointSection lessonId={lesson.id} checkpoints={lesson.checkpoints} now={state.now} />

      <IssuesList issues={issues} issueText={broker.issueText} />

      <HaltedBanner halted={state.halted} />

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          {selectedNodeId ? `Cấu hình · ${selectedNodeId}` : 'Chỉ số'}
        </h3>
        {selectedNodeId ? (
          <NodeConfig lesson={lesson} state={state} nodeId={selectedNodeId} />
        ) : (
          <MetricsGrid metrics={broker.metrics(state)} />
        )}
      </section>

      <section className="min-h-0 flex-1">
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Nhật ký sự kiện</h3>
        <EventLog journal={state.journal} />
      </section>
    </div>
  )
}
