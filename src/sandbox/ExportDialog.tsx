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
  const [copied, setCopied] = useState(false)

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
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
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
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
              className={`rounded-t px-3 py-1.5 text-xs font-medium ${
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
              Topology chưa có exchange, queue hay consumer nào — chưa có gì để xuất thành code.
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
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
          >
            {copied ? 'Đã sao chép' : 'Sao chép đoạn code này'}
          </button>
        </div>
      </div>
    </div>
  )
}
