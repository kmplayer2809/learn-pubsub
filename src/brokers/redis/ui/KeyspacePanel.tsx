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
export function KeyspacePanel({ state, dense = false }: { state: RedisState; dense?: boolean }) {
  const liveKeys = state.keyOrder.filter((key) => livesAt(state, key, state.now))

  // `metrics.keysCount` counts every record the keyspace holds; the rows show only
  // the live ones. The two disagree exactly when a key is past its deadline and
  // nothing has reaped it yet, which is not a glitch — it is what lazy expiry
  // *is*, and lesson 06 is built on being able to see it. Left unlabelled the
  // header would simply read "2 keys" above zero rows and look broken, so the
  // gap gets named whenever it exists, and stays out of the way when it doesn't.
  const unreclaimed = state.metrics.keysCount - liveKeys.length

  return (
    <div className={`overflow-y-auto px-3 py-2 ${dense ? 'max-h-24' : 'max-h-32'}`} data-testid="keyspace-panel">
      <div className="mb-1 flex items-baseline gap-2" data-testid="keyspace-header">
        <h3 className="text-section text-content-faint">Keyspace</h3>
        <span className="font-mono text-code text-content-faint">
          {unreclaimed > 0 ? `${liveKeys.length}/${state.metrics.keysCount}` : state.metrics.keysCount} keys ·{' '}
          {state.metrics.memoryUsed}B
        </span>
        {unreclaimed > 0 && (
          <span className="text-code text-warn-fg/80">{unreclaimed} hết hạn chưa thu hồi</span>
        )}
      </div>

      {liveKeys.length === 0 ? (
        <p className="text-meta text-content-faint" data-testid="keyspace-empty">
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
                className={`flex items-center gap-2 text-meta ${expiring ? 'animate-pulse' : ''}`}
              >
                <span className="w-24 shrink-0 truncate font-mono text-content">{key}</span>
                <span className="w-10 shrink-0 font-mono text-content-faint">
                  {ttlText(record.expiresAt, state.now)}
                </span>
                <span className="flex-1 truncate font-mono text-role-sky-fg">
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
