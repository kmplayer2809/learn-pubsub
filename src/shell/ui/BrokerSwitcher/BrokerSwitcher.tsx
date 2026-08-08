import { BROKERS } from '../../../brokers/registry'
import { useAppStore } from '../../store'

/**
 * The one control that swaps the entire workspace: lessons, canvas, state panel, and
 * sandbox all come from the selected module. It sits above the lesson list because the
 * lesson list is meaningless until a broker is chosen.
 */
export function BrokerSwitcher() {
  const brokerId = useAppStore((s) => s.brokerId)
  const setBroker = useAppStore((s) => s.setBroker)

  return (
    <div
      className="flex gap-1 border-b border-slate-800 px-2 py-2"
      role="tablist"
      aria-label="Chọn broker"
      data-testid="broker-switcher"
    >
      {BROKERS.map((broker) => (
        <button
          key={broker.id}
          role="tab"
          aria-current={broker.id === brokerId}
          data-testid="broker-tab"
          data-broker-id={broker.id}
          onClick={() => setBroker(broker.id)}
          className={`flex-1 rounded px-2 py-1 text-xs ${
            broker.id === brokerId
              ? 'bg-slate-800 text-sky-300'
              : 'text-slate-400 hover:bg-slate-900'
          }`}
        >
          {broker.label}
        </button>
      ))}
    </div>
  )
}
