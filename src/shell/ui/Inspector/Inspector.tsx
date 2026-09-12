import { useState } from 'react'
import type { AnyBrokerModule } from '../../../brokers/types'
import type { JournalEntry, KernelState, ValidationIssueBase } from '../../kernel/types'
import type { Lesson } from '../../lesson/types'
import { activeStepIndex } from '../../lesson/activeStep'
import { CheckpointSection } from './CheckpointCard'
import { InspectorTabs } from './InspectorTabs'
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
    <section className="space-y-1 rounded-lg border border-danger-line bg-danger-bg p-2.5">
      {issues.map((issue, i) => (
        <p key={i} className="text-meta leading-relaxed text-danger-fg">
          <span className="font-semibold uppercase tracking-wide text-danger-fg">{SEVERITY_LABEL[issue.severity]}</span>
          {': '}
          {issueText(issue)}
        </p>
      ))}
    </section>
  )
}

/** Shared with SandboxPanel: a user-built topology can loop, so both surfaces need the same halted message. */
export function HaltedBanner({ halted }: { halted?: { reason: string } }) {
  if (!halted) return null
  return (
    <p className="rounded-lg border border-warn-line bg-warn-bg p-2.5 text-meta leading-relaxed text-warn-fg">
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
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-edge bg-surface-raised p-2.5 text-meta text-content-muted">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="truncate">{key}</dt>
          <dd className="text-right font-mono font-medium text-content">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Shared with SandboxPanel: the last 40 journal entries, newest first. */
export function EventLog({ journal }: { journal: JournalEntry[] }) {
  return (
    <ul className="space-y-0.5 rounded-lg border border-edge bg-surface-raised p-2.5 font-mono text-code leading-relaxed text-content-muted">
      {journal
        .slice(-40)
        .reverse()
        .map((entry, i) => (
          <li key={i} className="truncate">
            <span className="text-content-faint">{(entry.at / 1000).toFixed(1)}s </span>
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
  const step = lesson.narrative[activeStepIndex(lesson.narrative, state.now)]
  const [exportOpen, setExportOpen] = useState(false)
  const { ExportDialog } = broker

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
      {/* Vùng 1: narrative, cuộn riêng. Tách khỏi vùng dữ liệu bên dưới để đọc
          narrative không làm mất dấu nhật ký đang chạy. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        <section className="max-w-[68ch]">
          <div className="flex items-start justify-between gap-2">
            <h2 className="mb-1 text-ui font-semibold leading-snug text-content-strong">
              <MarkdownInline text={step?.title ?? lesson.title} />
            </h2>
            {ExportDialog && (
              <button
                onClick={() => setExportOpen(true)}
                data-testid="export-button"
                className="min-h-11 shrink-0 rounded-lg border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover active:bg-surface-hover md:min-h-0"
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
      </div>

      {/* Vùng 2: chỉ số / nhật ký / cấu hình, cuộn riêng, chiều cao cố định. */}
      <InspectorTabs broker={broker} lesson={lesson} state={state} />
    </div>
  )
}
