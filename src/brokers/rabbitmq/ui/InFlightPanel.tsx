import type { EngineState } from '../engine'
import { progressOf, TONE_FILL } from '../../../shell/ui/canvas/geometry'

/** `edgeId` is minted as `${from}->${to}`; the panel is the only place that reads it back. */
function routeOf(edgeId: string): [string, string] {
  const [from = edgeId, to = ''] = edgeId.split('->')
  return [from, to]
}

export function InFlightPanel({ state, dense = false }: { state: EngineState; dense?: boolean }) {
  // Sorted by departure, not array order: rows must not jump when a message lands.
  const flights = [...state.inFlight].sort(
    (a, b) => a.fromT - b.fromT || a.message.id.localeCompare(b.message.id),
  )

  return (
    <div className={`overflow-y-auto px-3 py-2 ${dense ? 'max-h-24' : 'max-h-32'}`} data-testid="inflight-panel">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-section text-content-faint">Message đang bay</h3>
        <span className="font-mono text-code text-content-faint">{flights.length}</span>
      </div>

      {flights.length === 0 ? (
        <p className="text-meta text-content-faint" data-testid="inflight-empty">
          Không có message nào trên đường truyền.
        </p>
      ) : (
        <ul className="space-y-1">
          {flights.map((f) => {
            const [from, to] = routeOf(f.edgeId)
            const pct = Math.round(progressOf(f, state.now) * 100)
            // `TONE_FILL` returns `undefined` for a tone it doesn't carry a mapping for — the
            // fallback has to be the same `rgb(var(--x))` shape as every other entry (see
            // `geometry.ts`), not a hex literal, or it would be the one color on this canvas
            // that doesn't move with the theme. Matches the identical fallback in the shell's
            // `MessageLayer.tsx`.
            const colour = TONE_FILL[f.tone] ?? 'rgb(var(--text-muted))'
            return (
              <li
                key={`${f.message.id}@${f.edgeId}`}
                data-testid="inflight-row"
                data-message-id={f.message.id}
                className="flex items-center gap-2 text-meta"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                <span className="w-8 shrink-0 font-mono text-content">{f.message.id}</span>
                <span className="w-40 shrink-0 truncate font-mono text-content-muted">
                  {from} <span className="text-content-faint">{'->'}</span> {to}
                </span>
                <span className="w-36 shrink-0 truncate font-mono text-role-sky-fg">
                  {f.message.routingKey || '—'}
                </span>
                <span
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  data-testid="inflight-progress"
                  className="h-1.5 min-w-16 flex-1 overflow-hidden rounded bg-surface-hover"
                >
                  <span
                    className="block h-full rounded"
                    style={{ width: `${pct}%`, backgroundColor: colour }}
                  />
                </span>
                <span className="flex shrink-0 gap-1 text-code text-content-faint">
                  {f.message.redeliveryCount > 0 && (
                    <span className="rounded bg-warn-bg px-1 text-warn-fg">
                      redelivery {f.message.redeliveryCount}
                    </span>
                  )}
                  {f.message.priority > 0 && (
                    <span className="rounded bg-surface-hover px-1 text-content">
                      priority {f.message.priority}
                    </span>
                  )}
                  {f.message.persistent && (
                    <span className="rounded bg-ok-bg px-1 text-ok-fg">persistent</span>
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
