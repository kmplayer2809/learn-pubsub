import { sortedPartitionKeys } from './types'
import type { ConsumerRuntime, KafkaEventType, KafkaState, PartitionState } from './types'
import type { SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Ba fault chưa có reducer riêng khi Task 1-3 khai `KafkaFault`/`KafkaEventType`:
// `consumer-stall`, `processing-error`, `replica-lag`. `broker-down`/`broker-up`/
// `produce-error`/`ack-lost` đã có reducer riêng ở `engine/index.ts` từ một plan
// trước (kafka-core) — KHÔNG đụng tới ở đây (Ruling A, xem task-4-brief). File
// này chỉ thêm ba nhánh còn thiếu, đúng quy ước đã có: một `KafkaEventType`
// cùng tên `KafkaFault['kind']`, một reducer kích hoạt tại đúng `at` của fault,
// không có một "applyFault" tổng hợp nào gộp cả sáu loại — cơ chế đó không tồn
// tại ở đâu trong codebase này.
//
// `consumer-stall`/`processing-error` chỉ cần đọc/ghi `state.consumers` (không
// cần `KafkaTopology`) — giống `applyProduceErrorArm`/`applyAckLossArm`
// (`engine/index.ts`) không nhận `topology`. `replica-lag` chỉ cần
// `state.partitions`. Phần TIÊU ngân sách `pendingProcessingErrors` (cần
// `processingMs` từ `KafkaConsumerSpec`, tức cần `topology`) nằm ở
// `applyProcessDone` (`engine/index.ts`, đã có sẵn topology qua closure) —
// cùng nguyên tắc "nơi arm khác nơi tiêu" như `pendingErrors`/`pendingAckLosses`.
// ---------------------------------------------------------------------------

// --- Tiện ích thuần nội bộ (bản riêng của file này — cùng khuôn `nextSeq` lặp
// lại ở `consume.ts`/`coordinator.ts`/`offsets.ts`, xem why-comment ở nhóm
// placeholder trong `engine/index.ts` về kỷ luật đó). ---

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`kafka engine: payload.${field} is not a string`)
  return value
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`kafka engine: payload.${field} is not a number`)
  return value
}

type ReduceResult = { state: KafkaState; newEvents: SimEvent<KafkaEventType>[] }

/**
 * Kích hoạt fault `consumer-stall` — đặt `ConsumerRuntime.stalledUntil` của
 * consumer NÀY, KHÔNG đụng gì khác. `applyFetchRequest` (engine/index.ts) là
 * nơi DUY NHẤT đọc field này: còn trong khoảng treo thì bỏ qua hẳn lượt fetch,
 * không cập nhật `GroupMember.lastPollAt` — đúng cái `checkTimeouts`
 * (`group/coordinator.ts`) cần để phát hiện `maxPollIntervalMs` bị vượt trong
 * khi heartbeat (vòng lặp độc lập) vẫn đều, mô phỏng callback xử lý treo.
 * Consumer không tồn tại (chưa join / đã rời) — no-op an toàn, không throw.
 */
export function applyConsumerStall(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const durationMs = asNumber(event.payload.durationMs, 'durationMs')
  const runtime = state.consumers[consumerId]
  if (!runtime) return { state, newEvents: [] } // không có gì để tác động — an toàn no-op

  const nextRuntime: ConsumerRuntime = { ...runtime, stalledUntil: event.at + durationMs }
  return {
    state: {
      ...state,
      consumers: { ...state.consumers, [consumerId]: nextRuntime },
      journal: [
        ...state.journal,
        { at: event.at, type: 'consumer-stall', text: `${consumerId}: treo xử lý trong ${durationMs}ms`, nodeId: consumerId },
      ],
    },
    newEvents: [],
  }
}

/**
 * Kích hoạt fault `processing-error` — cộng `times` vào ngân sách
 * `pendingProcessingErrors` của consumer NÀY, KHÔNG trừ/đọc gì ở đây.
 * `applyProcessDone` (engine/index.ts) là nơi DUY NHẤT tiêu ngân sách này, mỗi
 * lần một lượt xử lý bị buộc phải làm lại — cùng cặp arm/consume như
 * `pendingErrors`/`flushBatch` (produce.ts). Consumer không tồn tại — no-op.
 */
export function applyProcessingErrorArm(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const times = asNumber(event.payload.times, 'times')
  const runtime = state.consumers[consumerId]
  if (!runtime) return { state, newEvents: [] } // không có gì để tác động — an toàn no-op

  const nextRuntime: ConsumerRuntime = { ...runtime, pendingProcessingErrors: (runtime.pendingProcessingErrors ?? 0) + times }
  return {
    state: {
      ...state,
      consumers: { ...state.consumers, [consumerId]: nextRuntime },
      journal: [
        ...state.journal,
        { at: event.at, type: 'processing-error', text: `${consumerId}: kích hoạt xử lý lỗi cho ${times} lần xử lý kế tiếp`, nodeId: consumerId },
      ],
    },
    newEvents: [],
  }
}

/**
 * Fault `replica-lag` (Ruling B, task-4-brief) — CHƯA có `replication.ts`
 * (Task 6) nào thật sự đọc follower fetch định kỳ, nên đây chỉ trang bị tiền
 * đề bằng cách thật duy nhất đang có trong tay: kéo lùi
 * `PartitionState.replicaState[brokerId].lastFetchAt` ra sau `now` đúng `ms`,
 * cho MỌI partition mà broker này có mặt trong `replicas` (kể cả khi nó đang
 * là leader — giữ đúng nghĩa đen "mọi partition nó là replica", không loại trừ
 * gì). Task 6's ISR-shrink (đọc `now - lastFetchAt > replicaLagTimeMaxMs`) sẽ
 * có sẵn giá trị thật để hành động — file này KHÔNG tự rút ISR. Broker không
 * là replica của partition nào — no-op an toàn, không throw.
 */
export function applyReplicaLag(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const brokerId = asString(event.payload.brokerId, 'brokerId')
  const ms = asNumber(event.payload.ms, 'ms')

  let nextPartitions = state.partitions
  let touched = false
  for (const key of sortedPartitionKeys(state)) {
    const partition = nextPartitions[key]
    if (!partition || !partition.replicas.includes(brokerId)) continue
    const existing = partition.replicaState[brokerId]
    if (!existing) continue
    touched = true
    const updated: PartitionState = {
      ...partition,
      replicaState: { ...partition.replicaState, [brokerId]: { ...existing, lastFetchAt: event.at - ms } },
    }
    nextPartitions = { ...nextPartitions, [key]: updated }
  }
  if (!touched) return { state, newEvents: [] } // broker không phải replica của partition nào — an toàn no-op

  return {
    state: {
      ...state,
      partitions: nextPartitions,
      journal: [...state.journal, { at: event.at, type: 'replica-lag', text: `${brokerId}: giả lập trễ replicate ${ms}ms`, nodeId: brokerId }],
    },
    newEvents: [],
  }
}
