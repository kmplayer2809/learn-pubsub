import { assign, revocationsFor, type Assignment, type AssignorName } from './assignors'
import type { GroupMember, GroupState, KafkaEventType, KafkaState, NodeId, TopicPartition } from '../types'
import { sortedPartitionKeys } from '../types'
import type { SimEvent } from '../../../../shell/kernel/types'

// Real Kafka defaults: `session.timeout.ms` = 10_000, `max.poll.interval.ms` =
// 300_000. `KafkaConsumerSpec` leaves both optional (a lesson only sets them when
// the scenario needs a specific value), so the coordinator falls back to these
// whenever a member didn't specify one — same fallback chain real Kafka clients use.
const DEFAULT_SESSION_TIMEOUT_MS = 10_000
const DEFAULT_MAX_POLL_INTERVAL_MS = 300_000

export interface CoordinatorResult {
  state: KafkaState
  newEvents: SimEvent<KafkaEventType>[]
}

export interface HeartbeatResult extends CoordinatorResult {
  error?: 'ILLEGAL_GENERATION'
}

export interface JoinGroupArgs {
  groupId: string
  memberId: NodeId
  subscriptions: string[]
  /** Chỉ có hiệu lực khi TẠO group mới — member gia nhập một group đã tồn tại
   *  luôn dùng lại `assignor` group đã chọn, giống cách một consumer group thật
   *  không cho từng member tự chọn assignor khác nhau. */
  assignor: AssignorName
  at: number
  sessionTimeoutMs?: number
  maxPollIntervalMs?: number
  /** Bỏ trống thì lấy theo `maxPollIntervalMs`, xem `effectiveRebalanceTimeoutMs`. */
  rebalanceTimeoutMs?: number
}

export interface LeaveGroupArgs {
  groupId: string
  memberId: NodeId
  at: number
}

export interface HeartbeatArgs {
  groupId: string
  memberId: NodeId
  generationId: number
  at: number
}

export interface SyncGroupArgs {
  groupId: string
  generationId: number
  at: number
}

export interface RebalanceCompleteArgs {
  groupId: string
  generationId: number
  at: number
}

// --- Tiện ích thuần nội bộ (cùng khuôn `nextSeq`/`pushJournal` ở produce.ts/
// consume.ts — mỗi file domain giữ bản riêng thay vì export dùng chung, xem
// why-comment ở nhóm placeholder trong engine/index.ts về kỷ luật `seq`). ---

function nextSeq(state: KafkaState): [number, KafkaState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

function effectiveRebalanceTimeoutMs(args: { rebalanceTimeoutMs?: number; maxPollIntervalMs?: number }): number {
  return args.rebalanceTimeoutMs ?? args.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS
}

/**
 * `GroupState` không lưu `rebalanceTimeoutMs` cấp group (declared shape, không
 * reshape thêm cho một giá trị chỉ cần tại lúc SCHEDULE) — khi chính coordinator
 * (không phải một `joinGroup` mới) tự kích hoạt một vòng rebalance (leave chủ
 * động, eviction do timeout), nó suy ra cùng default `joinGroup` dùng: lấy
 * `maxPollIntervalMs` của member đầu tiên theo thứ tự đã sort. Mọi lesson trong
 * phạm vi plan này cấu hình đồng nhất trong một group nên member nào cũng cho
 * cùng kết quả; khác biệt giữa các member (nếu có) không được mô phỏng.
 */
function inferRebalanceTimeoutMs(members: GroupMember[]): number {
  const sortedIds = [...members].map((m) => m.memberId).sort()
  const first = members.find((m) => m.memberId === sortedIds[0])
  return first?.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS
}

function partitionKeyOf(p: TopicPartition): string {
  return `${p.topic}-${p.partition}`
}

/** Toàn bộ partition (đã sort qua `sortedPartitionKeys`) của các topic trong `topics`. */
function partitionsForTopics(state: KafkaState, topics: Set<string>): TopicPartition[] {
  return sortedPartitionKeys(state)
    .map((key) => state.partitions[key]!)
    .filter((p) => topics.has(p.topic))
    .map((p) => ({ topic: p.topic, partition: p.index }))
}

function scheduleRebalanceComplete(
  state: KafkaState,
  groupId: string,
  generationId: number,
  at: number,
): [SimEvent<KafkaEventType>, KafkaState] {
  const [seq, afterSeq] = nextSeq(state)
  return [{ at, seq, type: 'rebalance-complete', payload: { groupId, generationId } }, afterSeq]
}

/**
 * Mọi vòng lặp trên `state.groups` phải đi qua hàm này, không bao giờ lặp thẳng
 * `Object.keys` — cùng lý do `sortedPartitionKeys` tồn tại ở `types.ts`: thứ tự
 * chèn của object là hợp đồng mong manh, một mảng đã sort thì không.
 */
export function sortedGroupIds(state: KafkaState): string[] {
  return Object.keys(state.groups).sort()
}

/**
 * Member đầu tiên theo thứ tự này là leader (`joinGroup`/`completeRebalance`) —
 * dùng CHÍNH hàm này ở cả hai chỗ để "ai là leader" không bao giờ phụ thuộc thứ
 * tự join (vốn phụ thuộc jitter, xem `rng.ts`) mà chỉ phụ thuộc tập `memberId`.
 */
export function sortedMemberIds(group: GroupState): string[] {
  return group.members.map((m) => m.memberId).sort()
}

/**
 * True nếu có ít nhất một member đang thuộc BẤT KỲ group nào, bất kể group đó
 * đang ở state gì (`Empty` sau khi member cuối rời/bị đá vẫn còn NẰM trong
 * `state.groups` — chỉ `members` rỗng — nên đây phải kiểm `members.length`,
 * không phải `sortedGroupIds(state).length`, kẻo coi một group đã rỗng như
 * còn "đang hoạt động").
 *
 * Task 4 fix round: `engine/index.ts` dùng hàm này làm điều kiện DUY NHẤT để
 * quyết định vòng quét `member-timeout` (self-perpetuating, xem
 * `applyMemberTimeout`) còn cần tự hẹn lại hay không — quét một cluster không
 * còn ai là việc thừa, không có deadline nào để bắt, và chính việc hẹn lại VÔ
 * ĐIỀU KIỆN trước đây (bất kể `state.groups` rỗng hay không) là thứ khiến lịch
 * trình một simulation Kafka không bao giờ cạn (không `nextEventTime() ===
 * undefined`), silently vô hiệu hoá auto-pause của shell
 * (`useSimulation.ts:198`) cho MỌI lesson. Ngược lại, "có ít nhất một group
 * còn Stable với member suốt cả run" (đa số lesson) khiến hàm này vẫn trả
 * `true` mãi — đúng ý: vòng quét đó theo dõi một deadline THẬT sự còn treo,
 * không phải một vòng lặp vô nghĩa.
 */
export function hasAnyGroupMember(state: KafkaState): boolean {
  return sortedGroupIds(state).some((groupId) => state.groups[groupId]!.members.length > 0)
}

/**
 * Eager assignor xoá sạch assignment của MỌI member (kể cả những member không
 * mất partition gì) ngay khi vào `PreparingRebalance` — đó là "stop-the-world"
 * lesson 12 dạy: instance thật gọi `onPartitionsRevoked` cho toàn bộ assignment
 * trước khi biết assignment mới sẽ là gì. Cooperative-sticky KHÔNG xoá ở bước
 * này; nó chỉ thu hồi đúng phần cần đổi chủ, tính ở `completeRebalance`.
 */
function clearAssignmentsIfEager(members: GroupMember[], assignor: AssignorName): GroupMember[] {
  if (assignor === 'cooperative-sticky') return members
  return members.map((m) => ({ ...m, assignment: [] }))
}

// --- API công khai (Task 4 nối consumer-join/leave/fetch vào các hàm này) ----

/**
 * Thêm member vào group. Group vắng mặt được coi là "Empty" — join đầu tiên tạo
 * nó thẳng ở `PreparingRebalance` (không có một state "Empty" tồn tại độc lập
 * làm gì với record trong `state.groups`, xem test 1).
 *
 * Coordinator CHỦ ĐỘNG chờ hết `rebalanceTimeoutMs` trước khi chốt
 * `CompletingRebalance`, dù chỉ một member cũng có thể "đủ" ngay lập tức — đây
 * KHÔNG phải một hạn chế mà là lý do rebalance chậm trong Kafka thật: coordinator
 * cố tình gom thêm member đến khi hết cửa sổ, tránh chốt một assignment
 * chỉ vài phần trăm giây trước khi một member khác kịp join.
 */
export function joinGroup(state: KafkaState, args: JoinGroupArgs): CoordinatorResult {
  const { groupId, memberId, subscriptions, assignor, at } = args
  const sessionTimeoutMs = args.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS
  const maxPollIntervalMs = args.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS
  const rebalanceTimeoutMs = effectiveRebalanceTimeoutMs({ rebalanceTimeoutMs: args.rebalanceTimeoutMs, maxPollIntervalMs })

  const member: GroupMember = {
    memberId,
    subscriptions,
    assignment: [],
    lastHeartbeatAt: at,
    lastPollAt: at,
    sessionTimeoutMs,
    maxPollIntervalMs,
  }

  const existing = state.groups[groupId]

  if (existing === undefined) {
    const group: GroupState = {
      groupId,
      state: 'PreparingRebalance',
      generationId: 1,
      leaderMemberId: memberId,
      assignor,
      members: [member],
      committedOffsets: {},
      coordinatorBrokerId: state.controller.brokerId,
    }
    const [event, afterSeq] = scheduleRebalanceComplete(state, groupId, group.generationId, at + rebalanceTimeoutMs)
    return { state: { ...afterSeq, groups: { ...afterSeq.groups, [groupId]: group } }, newEvents: [event] }
  }

  const membersWithNew = [...existing.members, member]

  if (existing.state !== 'Stable' && existing.state !== 'Empty') {
    // Group đang giữa một vòng rebalance khác — member mới nhập CHUNG vòng đang
    // chạy, không mở vòng mới / không hẹn lại `rebalance-complete`: coordinator
    // luôn chờ hết cửa sổ của vòng ĐẦU TIÊN kích hoạt nó, bất kể có thêm member
    // gia nhập giữa chừng (cùng nguyên tắc "chờ hết rebalanceTimeoutMs" ở trên).
    const group: GroupState = { ...existing, members: membersWithNew }
    return { state: { ...state, groups: { ...state.groups, [groupId]: group } }, newEvents: [] }
  }

  const nextGen = existing.generationId + 1
  const group: GroupState = {
    ...existing,
    state: 'PreparingRebalance',
    generationId: nextGen,
    members: clearAssignmentsIfEager(membersWithNew, existing.assignor),
  }
  const [event, afterSeq] = scheduleRebalanceComplete(state, groupId, nextGen, at + rebalanceTimeoutMs)
  return { state: { ...afterSeq, groups: { ...afterSeq.groups, [groupId]: group } }, newEvents: [event] }
}

/**
 * Rời group CHỦ ĐỘNG (LeaveGroupRequest thật) kích hoạt rebalance NGAY LẬP TỨC —
 * khác `checkTimeouts`, vốn chỉ phát hiện một member im lặng SAU khi hết
 * `sessionTimeoutMs`/`maxPollIntervalMs`. Đây chính là khác biệt test 9 kiểm:
 * leave không đợi bất kỳ timeout nào trước khi coordinator biết member đã đi.
 */
export function leaveGroup(state: KafkaState, args: LeaveGroupArgs): CoordinatorResult {
  const { groupId, memberId, at } = args
  const existing = state.groups[groupId]
  if (existing === undefined) return { state, newEvents: [] }

  const remaining = existing.members.filter((m) => m.memberId !== memberId)
  if (remaining.length === existing.members.length) return { state, newEvents: [] } // member không tồn tại — no-op

  if (remaining.length === 0) {
    const group: GroupState = { ...existing, state: 'Empty', members: [], leaderMemberId: null }
    return { state: { ...state, groups: { ...state.groups, [groupId]: group } }, newEvents: [] }
  }

  const nextGen = existing.generationId + 1
  const rebalanceTimeoutMs = inferRebalanceTimeoutMs(remaining)
  const group: GroupState = {
    ...existing,
    state: 'PreparingRebalance',
    generationId: nextGen,
    leaderMemberId: [...remaining].map((m) => m.memberId).sort()[0] ?? null,
    members: clearAssignmentsIfEager(remaining, existing.assignor),
  }
  const [event, afterSeq] = scheduleRebalanceComplete(state, groupId, nextGen, at + rebalanceTimeoutMs)
  return { state: { ...afterSeq, groups: { ...afterSeq.groups, [groupId]: group } }, newEvents: [event] }
}

/**
 * Xử lý event `rebalance-complete` (hẹn bởi `joinGroup`/`leaveGroup`/
 * `checkTimeouts`) — đây là lúc `rebalanceTimeoutMs` đã hết và coordinator CHỐT
 * ai còn trong group để tính assignment. `generationId` trong payload phải khớp
 * generation hiện tại của group: một event hẹn cho generation cũ (group đã đổi
 * khác vì một lần join/leave/eviction khác đã mở vòng MỚI, với `rebalance-complete`
 * riêng của nó) bị bỏ qua an toàn thay vì áp chồng lên vòng đang chạy.
 */
export function completeRebalance(state: KafkaState, args: RebalanceCompleteArgs): CoordinatorResult {
  const { groupId, generationId, at } = args
  const group = state.groups[groupId]
  if (group === undefined || group.state !== 'PreparingRebalance' || group.generationId !== generationId) {
    return { state, newEvents: [] }
  }

  const subscribedTopics = new Set(group.members.flatMap((m) => m.subscriptions))
  const partitions = partitionsForTopics(state, subscribedTopics)
  const target = assign(group.assignor, group.members, partitions)
  const leaderMemberId = sortedMemberIds(group)[0] ?? null

  let members: GroupMember[]
  if (group.assignor === 'cooperative-sticky') {
    const current: Assignment = Object.fromEntries(group.members.map((m) => [m.memberId, m.assignment]))
    const revoked = revocationsFor(current, target)
    // Vòng một: CHỈ thu hồi phần đổi chủ — partition một member không hề mất giữ
    // nguyên object cũ, đúng cái test "giữ nguyên assignment suốt hai vòng" kiểm.
    members = group.members.map((m) => {
      const toRevoke = revoked[m.memberId]
      if (toRevoke === undefined) return m
      const revokedKeys = new Set(toRevoke.map(partitionKeyOf))
      return { ...m, assignment: m.assignment.filter((p) => !revokedKeys.has(partitionKeyOf(p))) }
    })
  } else {
    // Eager: assignment mọi member đã bị xoá sạch từ lúc vào `PreparingRebalance`
    // (`clearAssignmentsIfEager`) — ở đây chỉ việc gán thẳng target vừa tính.
    members = group.members.map((m) => ({ ...m, assignment: target[m.memberId] ?? [] }))
  }

  const [seq, afterSeq] = nextSeq(state)
  const nextGroup: GroupState = { ...group, state: 'CompletingRebalance', leaderMemberId, members }
  const event: SimEvent<KafkaEventType> = { at, seq, type: 'sync-group', payload: { groupId, generationId } }
  return { state: { ...afterSeq, groups: { ...afterSeq.groups, [groupId]: nextGroup } }, newEvents: [event] }
}

/**
 * Xử lý event `sync-group` — coordinator đã có assignment (`completeRebalance`),
 * bước "sync" là ACK cuối cùng đưa group sang `Stable`. `metrics.rebalances` tăng
 * ĐÚNG Ở ĐÂY, không tăng lúc `joinGroup` mở vòng: một vòng chỉ tính là hoàn tất
 * khi group thật sự về `Stable`.
 *
 * Cooperative-sticky mở vòng hai NGAY tại đây — không hẹn thêm một
 * `rebalance-complete` nào nữa (khác vòng một, phải đợi hết `rebalanceTimeoutMs`):
 * phần thu hồi ở vòng một đã đảm bảo không partition nào còn bị hai member cùng
 * giữ, nên phần cấp phát an toàn để chốt trong cùng một nhịp xử lý — "lập tức mở
 * vòng hai" nghĩa đen là không có độ trễ thời gian ảo nào giữa hai vòng.
 */
export function syncGroup(state: KafkaState, args: SyncGroupArgs): CoordinatorResult {
  const { groupId, generationId } = args
  const group = state.groups[groupId]
  if (group === undefined || group.state !== 'CompletingRebalance' || group.generationId !== generationId) {
    return { state, newEvents: [] }
  }

  if (group.assignor === 'cooperative-sticky') {
    const subscribedTopics = new Set(group.members.flatMap((m) => m.subscriptions))
    const partitions = partitionsForTopics(state, subscribedTopics)
    // Tính lại `assign()` trên assignment ĐÃ THU HỒI (vòng một) — phần chưa đổi
    // chủ nằm nguyên trong "owned" của mỗi member nên sticky assignor trả lại
    // đúng target ban đầu; phần vừa được giải phóng giờ mới thật sự vào tay
    // member cần nó. Không cần lưu lại `target` của vòng một ở đâu cả.
    const target = assign(group.assignor, group.members, partitions)
    const members = group.members.map((m) => ({ ...m, assignment: target[m.memberId] ?? [] }))
    const nextGroup: GroupState = { ...group, state: 'Stable', generationId: group.generationId + 1, members }
    return {
      state: {
        ...state,
        groups: { ...state.groups, [groupId]: nextGroup },
        metrics: { ...state.metrics, rebalances: state.metrics.rebalances + 1 },
      },
      newEvents: [],
    }
  }

  const nextGroup: GroupState = { ...group, state: 'Stable' }
  return {
    state: {
      ...state,
      groups: { ...state.groups, [groupId]: nextGroup },
      metrics: { ...state.metrics, rebalances: state.metrics.rebalances + 1 },
    },
    newEvents: [],
  }
}

/**
 * Heartbeat mang generation KHÁC generation hiện tại của group bị từ chối
 * (`ILLEGAL_GENERATION`, đúng response code Kafka thật) — KHÔNG cập nhật
 * `lastHeartbeatAt`. Coordinator không tự ý xoá member khỏi group ở đây: xoá là
 * việc của `checkTimeouts` một khi `sessionTimeoutMs` thật sự trôi qua mà không
 * có heartbeat generation ĐÚNG nào tới — bị từ chối một lần không có nghĩa
 * member đã chết, chỉ có nghĩa nó cần tự gọi lại `joinGroup` (client thật gọi
 * lại JoinGroupRequest ngay khi thấy lỗi này).
 */
export function heartbeat(state: KafkaState, args: HeartbeatArgs): HeartbeatResult {
  const { groupId, memberId, generationId, at } = args
  const group = state.groups[groupId]
  const member = group?.members.find((m) => m.memberId === memberId)
  if (group === undefined || member === undefined) {
    return { state, newEvents: [] } // group/member không tồn tại — coi như đã rời, không có gì để cập nhật
  }

  if (generationId !== group.generationId) {
    return {
      state: {
        ...state,
        journal: [
          ...state.journal,
          { at, type: 'heartbeat', text: `${memberId}: heartbeat generation cũ, bị từ chối (ILLEGAL_GENERATION)`, nodeId: memberId },
        ],
      },
      newEvents: [],
      error: 'ILLEGAL_GENERATION',
    }
  }

  const nextGroup: GroupState = {
    ...group,
    members: group.members.map((m) => (m.memberId === memberId ? { ...m, lastHeartbeatAt: at } : m)),
  }
  return { state: { ...state, groups: { ...state.groups, [groupId]: nextGroup } }, newEvents: [] }
}

/**
 * Chạy định kỳ (Task 4 nối vòng lặp tự hẹn lại qua event `member-timeout`, cùng
 * mẫu `fetch-request` tự hẹn lại ở `engine/index.ts`). Đá một member khi HOẶC
 * `now - lastHeartbeatAt > sessionTimeoutMs`, HOẶC `now - lastPollAt >
 * maxPollIntervalMs` — hai điều kiện TÁCH BIỆT có chủ đích, không gộp thành một
 * "im lặng chung":
 *  - `sessionTimeoutMs` theo dõi luồng heartbeat, chạy trên một thread NỀN riêng
 *    của client thật, độc lập với vòng xử lý chính — đứt heartbeat nghĩa là mất
 *    kết nối thật (crash, network partition).
 *  - `maxPollIntervalMs` theo dõi luồng xử lý CHÍNH: heartbeat vẫn đều (thread
 *    nền không hề biết vòng xử lý đã treo) trong khi client không gọi `poll()`
 *    lại kịp — ví dụ callback xử lý một record chạy quá lâu. Heartbeat KHÔNG
 *    phát hiện được ca này; đó chính là bẫy lesson 16 dạy, và là lý do Kafka
 *    thật tách hai giá trị này thay vì dùng chung một session timeout.
 */
export function checkTimeouts(state: KafkaState, now: number): CoordinatorResult {
  let nextState = state
  const newEvents: SimEvent<KafkaEventType>[] = []

  for (const groupId of sortedGroupIds(nextState)) {
    const group = nextState.groups[groupId]!
    const staleIds = new Set(
      sortedMemberIds(group).filter((id) => {
        const m = group.members.find((mm) => mm.memberId === id)!
        const sessionTimeoutMs = m.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS
        const maxPollIntervalMs = m.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS
        return now - m.lastHeartbeatAt > sessionTimeoutMs || now - m.lastPollAt > maxPollIntervalMs
      }),
    )
    if (staleIds.size === 0) continue

    const remaining = group.members.filter((m) => !staleIds.has(m.memberId))

    if (remaining.length === 0) {
      nextState = {
        ...nextState,
        groups: { ...nextState.groups, [groupId]: { ...group, state: 'Empty', members: [], leaderMemberId: null } },
      }
      continue
    }

    if (group.state !== 'Stable') {
      // Đã giữa một vòng rebalance khác — chỉ rút member ra khỏi danh sách,
      // không mở thêm vòng mới (cùng nguyên tắc "một vòng tại một thời điểm"
      // như `joinGroup` áp dụng khi group không phải Stable/Empty).
      nextState = { ...nextState, groups: { ...nextState.groups, [groupId]: { ...group, members: remaining } } }
      continue
    }

    const nextGen = group.generationId + 1
    const rebalanceTimeoutMs = inferRebalanceTimeoutMs(remaining)
    const nextGroup: GroupState = {
      ...group,
      state: 'PreparingRebalance',
      generationId: nextGen,
      leaderMemberId: [...remaining].map((m) => m.memberId).sort()[0] ?? null,
      members: clearAssignmentsIfEager(remaining, group.assignor),
    }
    const [event, afterSeq] = scheduleRebalanceComplete(nextState, groupId, nextGen, now + rebalanceTimeoutMs)
    nextState = { ...afterSeq, groups: { ...afterSeq.groups, [groupId]: nextGroup } }
    newEvents.push(event)
  }

  return { state: nextState, newEvents }
}
