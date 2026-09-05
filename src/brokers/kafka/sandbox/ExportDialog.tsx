import { useEffect, useState } from 'react'
import type { KafkaTopology } from '../engine'
import { toKafkaJs } from './export/kafkajs'
import { toNestJs } from './export/nestjs'

type ExportTarget = 'kafkajs' | 'nestjs'

const TABS: { key: ExportTarget; label: string }[] = [
  { key: 'kafkajs', label: 'KafkaJS' },
  { key: 'nestjs', label: 'NestJS' },
]

/**
 * A read-only code preview for the topology currently on screen — either a lesson's
 * fixed topology or whatever the user has built in the Sandbox. Mirrors RabbitMQ's own
 * `sandbox/ExportDialog.tsx` (full screen on mobile, a centered modal from `md` up).
 */
export function ExportDialog({ topology, onClose }: { topology: KafkaTopology; onClose: () => void }) {
  const [tab, setTab] = useState<ExportTarget>('kafkajs')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const isEmpty = topology.topics.length === 0 && topology.producers.length === 0 && topology.consumers.length === 0
  const code = tab === 'kafkajs' ? toKafkaJs(topology) : toNestJs(topology)

  // `navigator.clipboard` only exists in a secure context, so serving this build over
  // plain HTTP on a LAN address makes writeText reject — see the same note on
  // RabbitMQ's `ExportDialog`. A failure says so rather than looking inert.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="fixed inset-0 flex flex-col overflow-hidden bg-slate-900 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-[42rem] md:max-w-[90vw] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded md:border md:border-slate-700"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Xuất code"
        data-testid="export-dialog"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-100">Xuất code</h2>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="min-h-11 rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:min-h-0"
          >
            ×
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-800 px-3 pt-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-current={tab === key}
              data-testid={`export-tab-${key}`}
              className={`min-h-11 rounded-t px-3 py-1.5 text-xs font-medium md:min-h-0 ${
                tab === key
                  ? 'border border-b-0 border-slate-700 bg-slate-950 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-3">
          {isEmpty ? (
            <p className="text-[11px] text-slate-500">
              Topology chưa có topic, producer hay consumer nào — chưa có gì để xuất thành code.
            </p>
          ) : (
            <pre
              className="min-w-0 font-mono text-[11px] leading-relaxed whitespace-pre text-slate-200"
              data-testid="export-code"
            >
              {code}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-3 py-2">
          <button
            onClick={handleCopy}
            disabled={isEmpty}
            className="min-h-11 rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent md:min-h-0"
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
