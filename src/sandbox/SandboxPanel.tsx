import { type FormEvent, useEffect, useState } from 'react'
import type { EngineState, Topology, ValidationIssue } from '../engine'
import { EventLog, HaltedBanner, IssuesList, MetricsGrid } from '../ui/Inspector/Inspector'
import { useAppStore } from '../sim/store'
import { type SandboxNodeKind, useSandboxStore } from './sandboxStore'

const PALETTE: { kind: SandboxNodeKind; label: string }[] = [
  { kind: 'publisher', label: 'Publisher' },
  { kind: 'exchange', label: 'Exchange' },
  { kind: 'queue', label: 'Queue' },
  { kind: 'consumer', label: 'Consumer' },
]

const EXCHANGE_TYPES = ['direct', 'fanout', 'topic', 'headers'] as const
const QUEUE_KINDS = ['classic', 'quorum'] as const

/** Spreads new nodes out in a simple grid so they don't all land on top of each other. */
function nextPosition(topology: Topology): { x: number; y: number } {
  const count =
    topology.publishers.length + topology.exchanges.length + topology.queues.length + topology.consumers.length
  return { x: 80 + (count % 4) * 180, y: 60 + Math.floor(count / 4) * 140 }
}

const fieldRow = 'flex items-center justify-between gap-2'
const selectClass = 'rounded bg-slate-800 px-1.5 py-0.5 text-slate-200'

function SelectedNodeConfig() {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const selectNode = useAppStore((s) => s.selectNode)
  const topology = useSandboxStore((s) => s.topology)
  const updateNode = useSandboxStore((s) => s.updateNode)
  const removeNode = useSandboxStore((s) => s.removeNode)
  const updateBinding = useSandboxStore((s) => s.updateBinding)
  const removeBinding = useSandboxStore((s) => s.removeBinding)

  const exchange = topology.exchanges.find((e) => e.id === selectedNodeId)
  const queue = topology.queues.find((q) => q.id === selectedNodeId)
  const consumer = topology.consumers.find((c) => c.id === selectedNodeId)
  const publisher = topology.publishers.find((p) => p.id === selectedNodeId)

  // Also covers a stale selection left over from a node that was just removed.
  if (!exchange && !queue && !consumer && !publisher) {
    return <p className="text-[11px] text-slate-500">Chọn một node trên canvas để cấu hình.</p>
  }

  const remove = () => {
    removeNode(selectedNodeId!)
    selectNode(undefined)
  }

  return (
    <div className="space-y-1.5 text-[11px] text-slate-300">
      {exchange && (
        <>
          <label className={fieldRow}>
            <span>type</span>
            <select
              value={exchange.type}
              onChange={(e) => updateNode(exchange.id, { type: e.target.value })}
              className={selectClass}
            >
              {EXCHANGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1 pt-1">
            <p className="text-slate-500">bindings</p>
            {topology.bindings.filter((b) => b.exchangeId === exchange.id).length === 0 && (
              <p className="text-slate-500">
                Chưa có binding nào. Kéo từ handle của exchange này tới một queue để tạo binding.
              </p>
            )}
            {topology.bindings
              .filter((b) => b.exchangeId === exchange.id)
              .map((b) => (
                <div key={b.id} className="flex items-center gap-1.5" data-testid={`binding-${b.id}`}>
                  <span className="w-16 shrink-0 truncate text-slate-500" title={b.destinationId}>
                    → {b.destinationId}
                  </span>
                  <input
                    value={b.routingKey ?? ''}
                    onChange={(e) => updateBinding(b.id, { routingKey: e.target.value })}
                    placeholder="routing key"
                    aria-label={`routing key cho binding tới ${b.destinationId}`}
                    className="w-24 flex-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
                  />
                  <button
                    onClick={() => removeBinding(b.id)}
                    aria-label={`xóa binding tới ${b.destinationId}`}
                    className="shrink-0 rounded border border-rose-800 px-1.5 text-rose-300 hover:bg-rose-950"
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
        </>
      )}

      {queue && (
        <>
          <label className={fieldRow}>
            <span>kind</span>
            <select
              value={queue.kind}
              onChange={(e) => updateNode(queue.id, { kind: e.target.value })}
              className={selectClass}
            >
              {QUEUE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldRow}>
            <span>durable</span>
            <input
              type="checkbox"
              checked={queue.durable ?? false}
              onChange={(e) => updateNode(queue.id, { durable: e.target.checked })}
            />
          </label>
          <label className={fieldRow}>
            <span>ttl (ms)</span>
            <input
              type="number"
              min={0}
              value={queue.messageTtlMs ?? ''}
              onChange={(e) =>
                updateNode(queue.id, {
                  messageTtlMs: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              className="w-20 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
            />
          </label>
          <label className={fieldRow}>
            <span>dead-letter</span>
            <select
              value={queue.deadLetterExchange ?? ''}
              onChange={(e) => updateNode(queue.id, { deadLetterExchange: e.target.value || undefined })}
              className={selectClass}
            >
              <option value="">— không —</option>
              {topology.exchanges.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {consumer && (
        <>
          <label className={fieldRow}>
            <span>queue</span>
            <select
              value={consumer.queueId}
              onChange={(e) => updateNode(consumer.id, { queueId: e.target.value })}
              className={selectClass}
            >
              <option value="">— chọn queue —</option>
              {topology.queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldRow}>
            <span>prefetch</span>
            <input
              type="number"
              min={0}
              value={consumer.prefetch}
              onChange={(e) => updateNode(consumer.id, { prefetch: Number(e.target.value) })}
              className="w-16 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
            />
          </label>
          <label className={fieldRow}>
            <span>auto-ack</span>
            <input
              type="checkbox"
              checked={consumer.autoAck}
              onChange={(e) => updateNode(consumer.id, { autoAck: e.target.checked })}
            />
          </label>
        </>
      )}

      {publisher && <p className="text-slate-500">Publisher không có cấu hình bổ sung.</p>}

      <button
        onClick={remove}
        className="mt-1 w-full rounded border border-rose-800 px-2 py-1 text-rose-300 hover:bg-rose-950"
      >
        Xóa node
      </button>
    </div>
  )
}

export function SandboxPanel({ state, issues }: { state: EngineState; issues: ValidationIssue[] }) {
  const topology = useSandboxStore((s) => s.topology)
  const addNode = useSandboxStore((s) => s.addNode)
  const publish = useSandboxStore((s) => s.publish)
  const generator = useSandboxStore((s) => s.generator)
  const setGenerator = useSandboxStore((s) => s.setGenerator)
  const save = useSandboxStore((s) => s.save)
  const reset = useSandboxStore((s) => s.reset)
  const load = useSandboxStore((s) => s.load)
  const virtualTime = useAppStore((s) => s.virtualTime)

  const [exchangeId, setExchangeId] = useState('')
  const [routingKey, setRoutingKey] = useState('')
  const [body, setBody] = useState('')
  const [rate, setRate] = useState(generator?.ratePerSecond ?? 0)

  // Restore a previous session's build the first time the sandbox opens with
  // nothing in it yet. A topology already under construction this session
  // (SandboxPanel merely remounting after a round trip through a lesson)
  // must never be clobbered by a stale save, so this only fires when the
  // in-memory topology is still pristine.
  useEffect(() => {
    const t = useSandboxStore.getState().topology
    const pristine =
      t.publishers.length === 0 && t.exchanges.length === 0 && t.queues.length === 0 && t.consumers.length === 0
    if (pristine) load()
    // Intentionally once-per-mount: this is a startup restore, not a live sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeExchangeId = topology.exchanges.some((e) => e.id === exchangeId) ? exchangeId : ''
  const activePublisherId = topology.publishers[0]?.id
  const canPublish = Boolean(activeExchangeId && activePublisherId)

  const handlePublish = (e: FormEvent) => {
    e.preventDefault()
    if (!canPublish || !activePublisherId) return
    publish({
      at: virtualTime,
      publisherId: activePublisherId,
      exchangeId: activeExchangeId,
      routingKey,
      body: body || 'hello',
    })
  }

  const handleRate = (next: number) => {
    setRate(next)
    if (!activeExchangeId) return
    setGenerator({ ratePerSecond: next, exchangeId: activeExchangeId, routingKey })
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto" data-testid="sandbox-panel">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Sandbox</h2>
        <p className="text-[11px] text-slate-500">
          Tự xây topology của riêng bạn: thêm node, kéo để connect, rồi publish message.
        </p>
      </section>

      <IssuesList issues={issues} />
      <HaltedBanner halted={state.halted} />

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Thêm node</h3>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map(({ kind, label }) => (
            <button
              key={kind}
              onClick={() => addNode(kind, nextPosition(topology))}
              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
            >
              + {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Cấu hình node đã chọn</h3>
        <SelectedNodeConfig />
      </section>

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Chỉ số</h3>
        <MetricsGrid metrics={state.metrics} />
      </section>

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Publish message</h3>
        {!activePublisherId && (
          <p className="mb-1 text-[11px] text-slate-500">Thêm một publisher trước khi publish.</p>
        )}
        <form onSubmit={handlePublish} className="space-y-1.5 text-[11px]">
          <label className={fieldRow}>
            <span>exchange</span>
            <select value={activeExchangeId} onChange={(e) => setExchangeId(e.target.value)} className={selectClass}>
              <option value="">— chọn exchange —</option>
              {topology.exchanges.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldRow}>
            <span>routing key</span>
            <input
              value={routingKey}
              onChange={(e) => setRoutingKey(e.target.value)}
              className="w-28 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
            />
          </label>
          <label className={fieldRow}>
            <span>nội dung</span>
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="hello"
              className="w-28 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
            />
          </label>
          <button
            type="submit"
            disabled={!canPublish}
            className="w-full rounded bg-sky-600 px-2 py-1 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            Publish
          </button>
        </form>
      </section>

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          Generator ({rate} msg/s trong 60s)
        </h3>
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={rate}
          onChange={(e) => handleRate(Number(e.target.value))}
          disabled={!canPublish}
          className="w-full accent-sky-500"
          aria-label="generator rate"
        />
      </section>

      <section className="min-h-0 flex-1">
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Nhật ký sự kiện</h3>
        <EventLog journal={state.journal} />
      </section>

      <section className="mt-auto flex gap-2 border-t border-slate-800 pt-3">
        <button
          onClick={save}
          className="flex-1 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
        >
          Lưu
        </button>
        <button
          onClick={reset}
          className="flex-1 rounded border border-rose-800 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950"
        >
          Đặt lại
        </button>
      </section>
    </div>
  )
}
