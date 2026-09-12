import { useState } from 'react'
import { sortedPartitionKeys, type GroupState, type KafkaState, type LogEntry } from '../engine'

/** Trạng thái tab nội bộ — Log tab và Group tab đọc chung `state`, không có logic
 *  cross-broker nào cần đẩy lên `useSimulation`, nên `useState` cục bộ ở đây là đủ. */
type Tab = 'log' | 'group'

function reclaimedRow(entry: LogEntry, logStartOffset: number): boolean {
  return entry.offset < logStartOffset
}

function uncommittedRow(entry: LogEntry, highWatermark: number): boolean {
  return entry.offset >= highWatermark
}

/**
 * Log tab: một khối cho mỗi partition, `sortedPartitionKeys` chứ không lặp thẳng
 * `Object.keys(state.partitions)` (xem comment trên `sortedPartitionKeys` trong
 * `engine/types.ts` — thứ tự lặp của object là hợp đồng mong manh).
 *
 * Mỗi dòng record được đánh dấu theo hai ranh giới có thật của engine, không phải
 * một trạng thái bịa ra:
 *   - dưới `logStartOffset`: record đã bị retention xoá (`segments.ts`'s
 *     `applyRetention` splice thẳng nó khỏi `partition.log` trong luồng bình
 *     thường — dòng này chỉ còn xuất hiện nếu state được dựng trực tiếp, và panel
 *     phải tự vệ đúng cách thay vì giả định điều đó không bao giờ xảy ra).
 *   - từ `highWatermark` trở lên: record đã ghi ở leader nhưng chưa được xác nhận
 *     trên đủ ISR — tồn tại trong log nhưng consumer chưa đọc được.
 */
function LogTab({ state }: { state: KafkaState }) {
  const keys = sortedPartitionKeys(state)
  if (keys.length === 0) {
    return (
      <p className="text-meta text-content-faint" data-testid="log-panel-empty">
        Chưa có partition nào.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {keys.map((key) => {
        const partition = state.partitions[key]!
        return (
          <div key={key} data-testid="partition-block" data-partition={key} className="space-y-1">
            <span className="font-mono text-meta text-role-teal-fg">{key}</span>
            <dl className="grid grid-cols-1 gap-x-2 gap-y-0.5 text-code text-content-muted sm:grid-cols-2">
              <dt>leader</dt>
              <dd className="truncate text-content">{partition.leader}</dd>
              <dt>isr</dt>
              <dd className="truncate text-content">{partition.isr.join(', ') || '—'}</dd>
              <dt>log start offset</dt>
              <dd className="text-content">{partition.logStartOffset}</dd>
              <dt>high watermark</dt>
              <dd className="text-ok-fg">{partition.highWatermark}</dd>
              <dt>LEO</dt>
              <dd className="text-role-sky-fg">{partition.leo}</dd>
            </dl>
            {partition.log.length === 0 ? (
              <p className="text-code text-content-faint">chưa có record nào</p>
            ) : (
              <ul className="space-y-0.5">
                {partition.log.map((entry) => {
                  const reclaimed = reclaimedRow(entry, partition.logStartOffset)
                  const uncommitted = uncommittedRow(entry, partition.highWatermark)
                  return (
                    <li
                      key={entry.offset}
                      data-testid="log-entry"
                      data-offset={entry.offset}
                      data-reclaimed={reclaimed ? 'true' : undefined}
                      data-uncommitted={uncommitted ? 'true' : undefined}
                      className={`flex items-center gap-2 font-mono text-code ${
                        reclaimed ? 'opacity-40 text-content-faint' : uncommitted ? 'text-warn-fg' : 'text-content'
                      }`}
                    >
                      <span className="w-6 shrink-0">{entry.offset}</span>
                      <span className="w-16 shrink-0 truncate">{entry.key ?? '—'}</span>
                      <span className="flex-1 truncate">{entry.value === null ? '(tombstone)' : entry.value}</span>
                      {reclaimed && <span className="shrink-0 text-content-faint">đã bị retention xoá</span>}
                      {!reclaimed && uncommitted && (
                        <span className="shrink-0 text-warn-fg/80">chưa qua high watermark</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Tổng lag của một group trên từng partition group đó đã commit — đọc thẳng
 * `GroupState.committedOffsets`, KHÔNG đi qua `resolvePosition` như `toFlow.ts`/
 * `NodeConfig.tsx` làm cho lag của một consumer đơn lẻ: `LogPanel` không nhận
 * `topology` (chỉ nhận `state`), nên không biết `autoOffsetReset` của từng
 * consumer để resolve một vị trí CHƯA từng commit — và bịa ra một giả định
 * `autoOffsetReset` mặc định ở đây đúng là kiểu lỗi CLAUDE.md cảnh báo. Offset
 * ĐÃ commit thì không cần biết `autoOffsetReset` gì cả — nó là dữ liệu thật,
 * không phải suy luận.
 */
function committedLagRows(state: KafkaState, group: GroupState): { key: string; lag: number }[] {
  return Object.keys(group.committedOffsets)
    .sort()
    .flatMap((key) => {
      const committed = group.committedOffsets[key]
      const partition = state.partitions[key]
      if (!committed || !partition) return []
      return [{ key, lag: partition.highWatermark - committed.offset }]
    })
}

/**
 * Group tab: mỗi group một khối, member liệt kê thật (memberId, subscriptions,
 * lastHeartbeatAt) — `assignment` cố tình không hiện thành mảng rỗng. `applyConsumerJoin`
 * (`engine/index.ts`) gán `assignment: []` một cách vô điều kiện vì group coordinator/
 * rebalance chưa tồn tại ở plan này (`fetchRecords` đọc thẳng `consumer.subscriptions`,
 * chưa bao giờ đọc `assignment`) — một mảng rỗng không nhãn trông như một bug, một chỗ
 * trống có tên "chưa gán" thì đọc đúng là một lời hứa chưa tới lượt.
 */
function GroupTab({ state }: { state: KafkaState }) {
  const groupIds = Object.keys(state.groups).sort()
  if (groupIds.length === 0) {
    return (
      <p className="text-meta text-content-faint" data-testid="group-panel-empty">
        Chưa có consumer group nào.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {groupIds.map((groupId) => {
        const group = state.groups[groupId]!
        const lagRows = committedLagRows(state, group)
        return (
          <div key={groupId} data-testid="group-block" data-group={groupId} className="space-y-1">
            <div className="flex items-center gap-2 text-meta">
              <span className="font-mono text-role-orange-fg">{groupId}</span>
              <span className="text-content-faint">
                {group.state} · gen {group.generationId}
              </span>
            </div>
            <ul className="space-y-0.5">
              {group.members.map((member) => (
                <li
                  key={member.memberId}
                  data-testid="group-member"
                  data-member={member.memberId}
                  className="flex items-center gap-2 text-code text-content-muted"
                >
                  <span className="w-16 shrink-0 truncate font-mono text-content">{member.memberId}</span>
                  <span className="flex-1 truncate">{member.subscriptions.join(', ') || '—'}</span>
                  <span data-testid="member-assignment" className="shrink-0 text-content-faint">
                    chưa gán
                  </span>
                </li>
              ))}
            </ul>
            {lagRows.length === 0 ? (
              <p className="text-code text-content-faint" data-testid="group-lag-empty">
                chưa commit offset nào
              </p>
            ) : (
              <ul className="space-y-0.5 text-code text-content-muted">
                {lagRows.map((row) => (
                  <li key={row.key} data-testid="group-lag-row" data-partition={row.key}>
                    {/* Qualified "lag đã commit", not bare "lag": this is
                        highWatermark - committedOffset, a DIFFERENT number from the
                        fetch-position lag ("lag" bare, unqualified — Kafka's own usage)
                        shown on the canvas' ConsumerNode (toFlow.ts's consumerLag) and
                        in NodeConfig.tsx's consumer branch. The two disagree whenever a
                        consumer has fetched past its last commit, and both appearing
                        unqualified on the same screen for the same consumer is exactly
                        the misreading lesson 05 exists to correct — so this label stays
                        qualified even though it reads slightly redundant on its own. */}
                    <span className="font-mono">{row.key}</span>: lag đã commit{' '}
                    <span className="text-warn-fg">{row.lag}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

const TAB_BUTTON = 'rounded px-1.5 py-0.5 text-code'

/**
 * Kafka's `StatePanel`, chiếm slot RabbitMQ's `InFlightPanel`/Redis' `KeyspacePanel`
 * chiếm. Hai tab thay vì một danh sách phẳng — log của mọi partition VÀ trạng thái
 * group cùng cần một chỗ hiện, và gộp chung một danh sách sẽ không phân biệt được
 * "record trên một partition" với "member trong một group".
 */
export function LogPanel({ state, dense = false }: { state: KafkaState; dense?: boolean }) {
  const [tab, setTab] = useState<Tab>('log')
  return (
    <div className={`overflow-y-auto px-3 py-2 ${dense ? 'max-h-24' : 'max-h-32'}`} data-testid="log-panel">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-section text-content-faint">Kafka</h3>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="log-panel-tab-log"
            onClick={() => setTab('log')}
            className={`${TAB_BUTTON} ${tab === 'log' ? 'bg-surface-hover text-content-strong' : 'text-content-faint'}`}
          >
            Log
          </button>
          <button
            type="button"
            data-testid="log-panel-tab-group"
            onClick={() => setTab('group')}
            className={`${TAB_BUTTON} ${tab === 'group' ? 'bg-surface-hover text-content-strong' : 'text-content-faint'}`}
          >
            Group
          </button>
        </div>
      </div>

      {tab === 'log' ? <LogTab state={state} /> : <GroupTab state={state} />}
    </div>
  )
}
