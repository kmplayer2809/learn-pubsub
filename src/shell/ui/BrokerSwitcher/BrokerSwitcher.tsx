import { BROKERS } from '../../../brokers/registry'
import { useAppStore } from '../../store'

/**
 * The one control that swaps the entire workspace: lessons, canvas, state panel, and
 * sandbox all come from the selected module.
 *
 * Segmented control chứ không phải ba nút rời: đây là một lựa chọn loại trừ trên một
 * trục. Bản cũ chỉ khác nhau màu chữ nên đọc như ba link độc lập.
 */
export function BrokerSwitcher() {
  const brokerId = useAppStore((s) => s.brokerId)
  const setBroker = useAppStore((s) => s.setBroker)

  return (
    <div
      className="flex shrink-0 gap-0.5 rounded-lg bg-surface-raised p-0.5"
      aria-label="Chọn broker"
      data-testid="broker-switcher"
    >
      {BROKERS.map((broker) => (
        <button
          key={broker.id}
          aria-pressed={broker.id === brokerId}
          data-testid="broker-tab"
          data-broker-id={broker.id}
          onClick={() => setBroker(broker.id)}
          className={`min-h-11 rounded-md px-3 text-ui font-medium md:min-h-8 ${
            broker.id === brokerId
              ? 'bg-accent text-accent-fg'
              : 'text-content-muted hover:bg-surface-hover hover:text-content-strong'
          }`}
        >
          {broker.label}
        </button>
      ))}
    </div>
  )
}
