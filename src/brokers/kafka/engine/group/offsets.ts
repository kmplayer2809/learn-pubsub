import { resolvePosition } from '../consume'
import { sortedGroupIds } from './coordinator'
import { partitionKey } from '../types'
import type { GroupState, KafkaConsumerSpec, KafkaEventType, KafkaState, NodeId, TopicPartition } from '../types'
import type { SimEvent } from '../../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Commit offset, auto-commit, lag.
//
// `GroupState.committedOffsets` mô hình hoá `__consumer_offsets` — topic nội bộ
// Kafka thật dùng để lưu offset đã commit của mọi group — nhưng KHÔNG dựng một
// partition/log thật cho nó: nó chỉ là một `Record` phẳng sống ngay trên
// `GroupState`, không có log riêng, không có replication riêng, không có
// compaction riêng như `__consumer_offsets` thật (vốn chỉ là một topic Kafka
// bình thường, đặc biệt ở chỗ broker tự quản lý nó). Hệ quả: engine này không
// mô phỏng được những sự cố gắn với chính cơ chế lưu trữ đó (mất offset vì
// `__consumer_offsets` mất replica, hay bị nén compact ra sao) — chỉ mô phỏng
// đúng ngữ nghĩa commit/lag nhìn từ phía consumer. Giới hạn này phải nêu lại ở
// narrative lesson 14 (§B5.4 của spec).
// ---------------------------------------------------------------------------

/** Kafka thật: `auto.offset.reset` mặc định `'latest'`. File này không có
 *  `KafkaConsumerSpec` trong tay ở `lagFor`/`totalLag` (chữ ký chỉ nhận
 *  `state`/`groupId`/khoá partition, đúng theo interface của task) nên không
 *  biết consumer nào override gì khác — dùng đúng default Kafka thật dùng khi
 *  không có gì override, cùng giá trị `consume.ts` dùng (không import được hằng
 *  số private của nó, nên khai lại ở đây — cùng khuôn `nextSeq` mỗi file domain
 *  giữ bản riêng, xem `coordinator.ts`). */
const DEFAULT_AUTO_OFFSET_RESET: 'earliest' | 'latest' = 'latest'

/** Kafka thật: `enable.auto.commit` mặc định `true`, `auto.commit.interval.ms` mặc định `5000`. */
const DEFAULT_ENABLE_AUTO_COMMIT = true
const DEFAULT_AUTO_COMMIT_INTERVAL_MS = 5_000

function partitionKeyOf(p: TopicPartition): string {
  return partitionKey(p.topic, p.partition)
}

/** Partition (đã dedupe + sort) mà ít nhất một member của group đang giữ trong
 *  assignment HIỆN TẠI — "đang giữ" nghĩa là được phân công lúc này, không phải
 *  "đã từng commit". Một partition có thể còn nằm trong `committedOffsets` từ
 *  trước khi bị rebalance thu hồi; `totalLag` không tính nó nữa, đúng cách
 *  Kafka thật chỉ báo lag cho những gì consumer group còn thật sự đọc. */
function assignedPartitionKeys(group: GroupState): string[] {
  const keys = new Set<string>()
  for (const member of group.members) {
    for (const p of member.assignment) keys.add(partitionKeyOf(p))
  }
  return [...keys].sort()
}

/**
 * Offset group đã commit gần nhất cho một partition — `undefined` khi CHƯA
 * commit lần nào. `undefined` khác `0` một cách có chủ đích: partition 0 là một
 * offset commit hợp lệ (record đầu tiên đã đọc xong), còn "chưa commit" mới là
 * thứ kích hoạt `auto.offset.reset` ở `lagFor` bên dưới — gộp hai cái làm một
 * bằng `?? 0` ở bất kỳ đâu quanh hàm này là bug.
 */
export function committedOffset(group: GroupState, key: string): number | undefined {
  return group.committedOffsets[key]?.offset
}

/**
 * Lag của một partition trong một group — `highWatermark` trừ vị trí đọc hiệu
 * lực. Partition CHƯA commit lần nào không lag bằng `highWatermark - 0` (sẽ
 * phóng đại backlog: coi mọi record từ đầu log là "nợ", kể cả khi consumer chưa
 * từng đọc và, theo default Kafka thật, sẽ không bao giờ đọc lại chúng) — thay
 * vào đó dùng lại đúng `resolvePosition` (`consume.ts`) để suy ra vị trí đọc
 * theo `auto.offset.reset` sẽ chọn, giống hệt consumer thật sẽ làm ở lần poll
 * đầu tiên.
 */
export function lagFor(state: KafkaState, groupId: string, key: string): number {
  const partition = state.partitions[key]
  if (!partition) return 0
  const group = state.groups[groupId]
  const committed = group ? committedOffset(group, key) : undefined
  const position = resolvePosition({
    position: committed,
    logStartOffset: partition.logStartOffset,
    highWatermark: partition.highWatermark,
    autoOffsetReset: DEFAULT_AUTO_OFFSET_RESET,
  })
  return partition.highWatermark - position
}

/** Tổng lag của mọi partition group đang giữ (xem `assignedPartitionKeys`) —
 *  không phải mọi partition từng xuất hiện trong `committedOffsets`. */
export function totalLag(state: KafkaState, groupId: string): number {
  const group = state.groups[groupId]
  if (!group) return 0
  return assignedPartitionKeys(group).reduce((sum, key) => sum + lagFor(state, groupId, key), 0)
}

/** `metrics.lagTotal` là một gauge TOÀN CLUSTER — một số duy nhất trên
 *  `KafkaMetrics`, không tách theo group — nên cộng `totalLag` của MỌI group
 *  đang tồn tại, qua `sortedGroupIds` (`coordinator.ts`) chứ không lặp thẳng
 *  `Object.keys(state.groups)`. */
function recomputeLagTotal(state: KafkaState): number {
  return sortedGroupIds(state).reduce((sum, groupId) => sum + totalLag(state, groupId), 0)
}

export interface CommitOffsetsArgs {
  groupId: string
  memberId: NodeId
  /**
   * Offset SẼ ĐỌC TIẾP cho từng partition — tức offset của record cuối cùng đã
   * xử lý CỘNG 1, không phải offset của chính record đó. Đây đúng ngữ nghĩa
   * committed offset Kafka thật dùng ("the committed offset should be the next
   * message your application will consume"), và đúng thứ `ConsumerRuntime.position`
   * (`consume.ts`) đã giữ sau `fetchRecords` — nơi vị trí được advance bằng
   * `position + fetched.length`, KHÔNG dừng ở offset của record cuối. Quên +1
   * (commit thẳng offset của record vừa xử lý) là lỗi phổ biến nhất khi tự quản
   * lý offset thủ công — nó khiến consumer đọc lại đúng một record mỗi lần khởi
   * động lại. Hàm `commitOffsets` KHÔNG tự "sửa" giá trị truyền vào — nó tin
   * caller đã đưa đúng offset kế tiếp; bảo đảm đó nằm ở phía gọi (`fetchRecords`
   * qua `ConsumerRuntime.position`), không phải ở đây.
   */
  offsets: Record<string, number>
  at: number
}

/**
 * Ghi `committedOffsets` cho một group — chỉ khi `groupId`/`memberId` thật sự
 * tồn tại trong `state.groups`. Commit từ một member không thuộc group (đã rời,
 * hoặc chưa từng join) bị bỏ qua HOÀN TOÀN: không tạo group mới, không tạo
 * record committedOffsets mồ côi, không tăng `metrics.commits`/`metrics.lagTotal`
 * — coi như request đó chưa từng xảy ra, giống Kafka thật trả lỗi
 * UNKNOWN_MEMBER_ID mà không ghi gì xuống `__consumer_offsets`.
 */
export function commitOffsets(state: KafkaState, args: CommitOffsetsArgs): KafkaState {
  const { groupId, memberId, offsets, at } = args
  const group = state.groups[groupId]
  if (group === undefined) return state
  const isMember = group.members.some((m) => m.memberId === memberId)
  if (!isMember) return state

  // Sort khoá trước khi ghi — cùng lý do `sortedPartitionKeys` tồn tại: object
  // không đảm bảo thứ tự chèn ổn định, dù ở đây kết quả cuối `committedOffsets`
  // không phụ thuộc thứ tự (mỗi khoá ghi độc lập); giữ đồng nhất với quy ước còn
  // lại của engine cho dễ review hơn là vì cần cho tính đúng đắn.
  const keys = Object.keys(offsets).sort()
  const committedOffsets = { ...group.committedOffsets }
  for (const key of keys) {
    const offset = offsets[key]
    if (offset === undefined) continue // key đến từ chính Object.keys(offsets) nên luôn có mặt — rào chắn cho noUncheckedIndexedAccess
    committedOffsets[key] = { offset, committedAt: at }
  }

  const nextGroup: GroupState = { ...group, committedOffsets }
  const withCommit: KafkaState = {
    ...state,
    groups: { ...state.groups, [groupId]: nextGroup },
    metrics: { ...state.metrics, commits: state.metrics.commits + 1 },
    journal: [
      ...state.journal,
      { at, type: 'commit', text: `${memberId} commit ${keys.length} partition (group ${groupId})`, nodeId: memberId },
    ],
  }

  // Tính lại TOÀN BỘ `lagTotal` từ state mới, không cộng dồn một delta — mỗi
  // lần commit là một điểm tự nhiên để đồng bộ gauge này với `highWatermark`
  // hiện tại của mọi partition (kể cả partition vừa được append thêm record
  // SAU lần commit trước, xem test "cập nhật sau mỗi lần commit và mỗi lần
  // append"). Việc GHI lagTotal ngay sau một `append` thật (không đi qua commit)
  // là phần Task 4 nối vào reducer `append` — file này chỉ đảm bảo `totalLag`
  // luôn đúng khi được gọi, bất kể ai gọi.
  return { ...withCommit, metrics: { ...withCommit.metrics, lagTotal: recomputeLagTotal(withCommit) } }
}

/**
 * Hẹn `commit` event kế tiếp cho auto-commit — TÁI SỬ DỤNG event `'commit'` sẵn
 * có (nhánh script `KafkaScriptedCommand['kind'] === 'commit'` đã có) thay vì
 * thêm một `KafkaEventType` mới: auto-commit chỉ khác commit thủ công ở CHỖ nó
 * được kích hoạt (đồng hồ, không phải script), không khác ở NÓ LÀM GÌ — đúng
 * cách Kafka thật tự gọi lại y hệt route `commitAsync` từ một thread nền định
 * kỳ. Hàm này KHÔNG tự lặp lại (không tự hẹn lần kế tiếp sau khi event bắn) —
 * nối vòng lặp định kỳ đó vào reducer thật, và nối event `'commit'` sinh ra ở
 * đây với `commitOffsets` phía trên, là việc của Task 4 (nối `group/` vào
 * engine), giống `member-timeout` đã làm với `checkTimeouts`.
 */
export function scheduleAutoCommit(state: KafkaState, consumer: KafkaConsumerSpec, at: number): SimEvent<KafkaEventType>[] {
  const enableAutoCommit = consumer.enableAutoCommit ?? DEFAULT_ENABLE_AUTO_COMMIT
  if (!enableAutoCommit) return []
  const intervalMs = consumer.autoCommitIntervalMs ?? DEFAULT_AUTO_COMMIT_INTERVAL_MS
  return [{ at: at + intervalMs, seq: state.seq + 1, type: 'commit', payload: { consumerId: consumer.id } }]
}
