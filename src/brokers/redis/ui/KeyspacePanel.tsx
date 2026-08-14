import { livesAt, type RedisState, type RedisValue } from '../engine'

/** A key whose TTL falls within this window of `state.now` gets the pulsing `data-expiring` flag. */
const EXPIRING_WITHIN_MS = 1000

const STRING_TRUNCATE_LENGTH = 24

function summariseValue(value: RedisValue): string {
  switch (value.type) {
    case 'string':
      return value.value.length > STRING_TRUNCATE_LENGTH
        ? `${value.value.slice(0, STRING_TRUNCATE_LENGTH)}…`
        : value.value
    case 'hash':
      return `${value.fieldOrder.length} fields`
    case 'list':
      return `${value.value.length} items`
    case 'set':
      return `${value.value.length} members`
    case 'zset':
      return `${value.value.length} members`
  }
}

function ttlText(expiresAt: number | undefined, now: number): string {
  if (expiresAt === undefined) return '—'
  return String(Math.floor((expiresAt - now) / 1000))
}

/**
 * Redis' `StatePanel`, occupying the slot RabbitMQ's `InFlightPanel` fills. Rows come
 * from `keyOrder`, not `Object.keys(state.keys)` — `keyOrder` is the engine's own
 * insertion order, and `state.keys` is never reordered (see the comment on `RedisState`).
 *
 * A key past its expiry is filtered by `livesAt`, not by re-deriving liveness from
 * `expiresAt` here: `state.keys` can still hold an expired record (Redis removes it
 * lazily, on the next read — see `keyspace.ts`'s `readKey`), so comparing `expiresAt`
 * to `now` inline would silently duplicate the engine's own liveness rule instead of
 * deferring to it, and the two are exactly the kind of thing that drifts apart later.
 */
export function KeyspacePanel({ state }: { state: RedisState }) {
  const liveKeys = state.keyOrder.filter((key) => livesAt(state, key, state.now))

  return (
    <div className="max-h-32 overflow-y-auto px-3 py-2" data-testid="keyspace-panel">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Keyspace</h3>
        <span className="font-mono text-[10px] text-slate-600">
          {state.metrics.keysCount} keys · {state.metrics.memoryUsed}B
        </span>
      </div>

      {liveKeys.length === 0 ? (
        <p className="text-[11px] text-slate-600" data-testid="keyspace-empty">
          Keyspace đang trống.
        </p>
      ) : (
        <ul className="space-y-1">
          {liveKeys.map((key) => {
            const record = state.keys[key]!
            const expiring =
              record.expiresAt !== undefined && record.expiresAt - state.now <= EXPIRING_WITHIN_MS
            return (
              <li
                key={key}
                data-testid="keyspace-row"
                data-key={key}
                data-expiring={expiring ? 'true' : undefined}
                className={`flex items-center gap-2 text-[11px] ${expiring ? 'animate-pulse' : ''}`}
              >
                <span className="w-24 shrink-0 truncate font-mono text-slate-200">{key}</span>
                <span className="w-10 shrink-0 font-mono text-slate-500">
                  {ttlText(record.expiresAt, state.now)}
                </span>
                <span className="flex-1 truncate font-mono text-sky-300">
                  {summariseValue(record.value)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
