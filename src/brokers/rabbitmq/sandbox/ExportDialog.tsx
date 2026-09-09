import { useEffect, useState } from 'react'
import type { Topology } from '../engine'
import { toAmqplib } from './export/amqplib'
import { toNestjs } from './export/nestjs'

type ExportTarget = 'amqplib' | 'nestjs'

const TABS: { key: ExportTarget; label: string }[] = [
  { key: 'amqplib', label: 'amqplib' },
  { key: 'nestjs', label: 'NestJS' },
]

/**
 * A read-only code preview for the topology currently on screen — either a
 * lesson's fixed topology or whatever the user has built in the Sandbox.
 * Shared between `Inspector` and `SandboxPanel` so both surfaces stay in
 * sync on one implementation instead of two.
 */
export function ExportDialog({ topology, onClose }: { topology: Topology; onClose: () => void }) {
  const [tab, setTab] = useState<ExportTarget>('amqplib')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const isEmpty =
    topology.exchanges.length === 0 && topology.queues.length === 0 && topology.consumers.length === 0
  const code = tab === 'amqplib' ? toAmqplib(topology) : toNestjs(topology)

  // `navigator.clipboard` only exists in a secure context, so serving this build
  // over plain HTTP on a LAN address makes writeText reject. Swallowing that left
  // the button looking inert with no explanation, so a failure says so and points
  // the user at the code they can still select by hand.
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    window.setTimeout(() => setCopyState('idle'), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="fixed inset-0 flex flex-col overflow-hidden bg-surface shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-[42rem] md:max-w-[90vw] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded md:border md:border-edge-strong"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Xuất code"
        data-testid="export-dialog"
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <h2 className="text-ui font-semibold text-content-strong">Xuất code</h2>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="min-h-11 rounded px-2 py-1 text-content-muted hover:bg-surface-hover hover:text-content md:min-h-0"
          >
            ×
          </button>
        </div>

        <div className="flex gap-1 border-b border-edge px-3 pt-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-current={tab === key}
              data-testid={`export-tab-${key}`}
              className={`min-h-11 rounded-t px-3 py-1.5 text-ui font-medium md:min-h-0 ${
                tab === key
                  ? 'border border-b-0 border-edge-strong bg-canvas text-content-strong'
                  : 'text-content-faint hover:text-content'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-canvas p-3">
          {isEmpty ? (
            <p className="text-meta text-content-faint">
              Topology chưa có exchange, queue hay consumer nào — chưa có gì để xuất thành code.
            </p>
          ) : (
            <pre
              className="min-w-0 font-mono text-meta leading-relaxed whitespace-pre text-content"
              data-testid="export-code"
            >
              {code}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-3 py-2">
          <button
            onClick={handleCopy}
            disabled={isEmpty}
            className="min-h-11 rounded border border-edge-strong px-3 py-1 text-ui text-content hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-content-faint disabled:hover:bg-transparent md:min-h-0"
          >
            {copyState === 'copied'
              ? 'Đã sao chép'
              : copyState === 'failed'
                ? 'Không sao chép được — hãy bôi đen đoạn code ở trên'
                : 'Sao chép đoạn code này'}
          </button>
        </div>
      </div>
    </div>
  )
}
