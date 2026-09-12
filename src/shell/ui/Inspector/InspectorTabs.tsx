import { useEffect, useState } from 'react'
import type { AnyBrokerModule } from '../../../brokers/types'
import type { KernelState } from '../../kernel/types'
import type { Lesson } from '../../lesson/types'
import { useAppStore } from '../../store'
import { EventLog, MetricsGrid } from './Inspector'

type TabId = 'metrics' | 'journal' | 'config'

const TABS: { id: TabId; label: string }[] = [
  { id: 'metrics', label: 'Chỉ số' },
  { id: 'journal', label: 'Nhật ký' },
  { id: 'config', label: 'Cấu hình' },
]

/**
 * Ba mặt dữ liệu của một lượt chạy, trước đây xếp dọc trong cùng một vùng cuộn với
 * narrative. Nhật ký khi đó luôn nằm dưới đáy màn — mà nó là thứ đổi mỗi tick.
 *
 * Việc "chọn node làm biến mất bảng chỉ số" ở bản cũ là một lần chuyển chế độ ngầm.
 * Tab hoá làm nó hiện rõ, và cho phép xem lại chỉ số mà không phải bỏ chọn node.
 */
export function InspectorTabs({
  broker,
  lesson,
  state,
}: {
  broker: AnyBrokerModule
  lesson: Lesson<any, any>
  state: KernelState
}) {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const [tab, setTab] = useState<TabId>('metrics')
  const { NodeConfig } = broker

  // Chọn node trên canvas là một hành động ở nơi khác trên màn hình; nếu tab không
  // tự theo, cấu hình node hiện ra ở một chỗ người dùng đang không nhìn.
  useEffect(() => {
    setTab(selectedNodeId ? 'config' : 'metrics')
  }, [selectedNodeId])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const next = event.key === 'ArrowRight' ? index + 1 : index - 1
    const target = TABS[(next + TABS.length) % TABS.length]
    if (target) setTab(target.id)
  }

  return (
    <div className="flex min-h-0 shrink-0 basis-2/5 flex-col border-t border-edge pt-2">
      <div role="tablist" aria-label="Dữ liệu mô phỏng" onKeyDown={onKeyDown} className="flex shrink-0 gap-0.5">
        {TABS.map(({ id, label }) => {
          const disabled = id === 'config' && !selectedNodeId
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              // `aria-disabled` chứ không phải `disabled`: nút `disabled` biến mất khỏi
              // thứ tự tab, người dùng bàn phím không biết nó tồn tại.
              aria-disabled={disabled || undefined}
              onClick={() => !disabled && setTab(id)}
              className={`rounded-md px-2.5 py-1 text-meta font-medium ${
                tab === id
                  ? 'bg-accent-soft text-accent'
                  : disabled
                    ? 'text-content-faint/50'
                    : 'text-content-muted hover:bg-surface-hover hover:text-content'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
        {tab === 'metrics' && <MetricsGrid metrics={broker.metrics(state)} />}
        {tab === 'journal' && <EventLog journal={state.journal} />}
        {tab === 'config' && selectedNodeId && (
          <NodeConfig lesson={lesson} state={state} nodeId={selectedNodeId} />
        )}
      </div>
    </div>
  )
}
