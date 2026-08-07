import type { EngineState } from '../../brokers/rabbitmq/engine'
import { progressOf, TONE_FILL } from './geometry'

/** `edgeId` is minted as `${from}->${to}`; the panel is the only place that reads it back. */
function routeOf(edgeId: string): [string, string] {
  const [from = edgeId, to = ''] = edgeId.split('->')
  return [from, to]
}

export function InFlightPanel({ state }: { state: EngineState }) {
  // Sorted by departure, not array order: rows must not jump when a message lands.
  const flights = [...state.inFlight].sort(
    (a, b) => a.fromT - b.fromT || a.message.id.localeCompare(b.message.id),
  )

  return (
    <div className="max-h-32 overflow-y-auto px-3 py-2" data-testid="inflight-panel">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Message đang bay</h3>
        <span className="font-mono text-[10px] text-slate-600">{flights.length}</span>
      </div>

      {flights.length === 0 ? (
        <p className="text-[11px] text-slate-600" data-testid="inflight-empty">
          Không có message nào trên đường truyền.
        </p>
      ) : (
        <ul className="space-y-1">
          {flights.map((f) => {
            const [from, to] = routeOf(f.edgeId)
            const pct = Math.round(progressOf(f, state.now) * 100)
            const colour = TONE_FILL[f.tone] ?? '#94a3b8'
            return (
              <li
                key={`${f.message.id}@${f.edgeId}`}
                data-testid="inflight-row"
                data-message-id={f.message.id}
                className="flex items-center gap-2 text-[11px]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                <span className="w-8 shrink-0 font-mono text-slate-200">{f.message.id}</span>
                <span className="w-40 shrink-0 truncate font-mono text-slate-400">
                  {from} <span className="text-slate-600">{'->'}</span> {to}
                </span>
                <span className="w-36 shrink-0 truncate font-mono text-sky-300">
                  {f.message.routingKey || '—'}
                </span>
                <span
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  data-testid="inflight-progress"
                  className="h-1.5 min-w-16 flex-1 overflow-hidden rounded bg-slate-800"
                >
                  <span
                    className="block h-full rounded"
                    style={{ width: `${pct}%`, backgroundColor: colour }}
                  />
                </span>
                <span className="flex shrink-0 gap-1 text-[10px] text-slate-500">
                  {f.message.redeliveryCount > 0 && (
                    <span className="rounded bg-amber-950 px-1 text-amber-300">
                      redelivery {f.message.redeliveryCount}
                    </span>
                  )}
                  {f.message.priority > 0 && (
                    <span className="rounded bg-slate-800 px-1 text-slate-300">
                      priority {f.message.priority}
                    </span>
                  )}
                  {f.message.persistent && (
                    <span className="rounded bg-emerald-950 px-1 text-emerald-300">persistent</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
