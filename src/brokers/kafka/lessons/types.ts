import type { Lesson } from '../../../shell/lesson/types'
import type { KafkaFault, KafkaScriptedCommand, KafkaTopology } from '../engine'

export type { KafkaFault } from '../engine'

export type KafkaLessonGroup = 'basics' | 'producer' | 'consumer' | 'durability' | 'advanced'

/** Thu hẹp `group: string` của `Lesson` về đúng năm nhóm sidebar dựng, nên một
 *  lesson xếp nhầm nhóm là lỗi compile chứ không phải một bài không ai mở được. */
export interface KafkaLesson extends Lesson<KafkaTopology, KafkaScriptedCommand> {
  group: KafkaLessonGroup
  /** Tên `failures`, không phải `faults`: `src/shell/useSimulation.ts` đọc trường
   *  này một cách generic và đó là thứ giữ `src/shell/` broker-agnostic. */
  failures?: KafkaFault[]
}

/** Node dùng chung cho mọi lesson trừ khi file của nó nói khác. Frozen và dùng
 *  chung một reference: `createSimulation` coi topology là đầu vào bất biến, và
 *  một object duy nhất qua mọi lesson là cách rẻ nhất giữ điều đó thành thật —
 *  engine ghi vào nó sẽ làm hỏng mọi lesson khác chứ không chỉ lesson của nó. */
export const BROKER_1 = Object.freeze({ id: 'b1', label: 'Broker 1', position: { x: 340, y: 60 } })
export const BROKER_2 = Object.freeze({ id: 'b2', label: 'Broker 2', position: { x: 340, y: 240 } })
export const BROKER_3 = Object.freeze({ id: 'b3', label: 'Broker 3', position: { x: 340, y: 420 } })
export const PRODUCER = Object.freeze({ id: 'p1', label: 'Producer', position: { x: 40, y: 220 } })

/** `maxPollIntervalMs: 5_000` — mặc định cho mọi lesson dùng chung ba consumer
 *  này, trừ khi lesson tự override. `group/coordinator.ts` CHỦ ĐỘNG chờ hết
 *  `rebalanceTimeoutMs` (mặc định lấy theo `maxPollIntervalMs`, và
 *  `maxPollIntervalMs` không set thì rơi về 300_000ms — 5 phút thời gian ảo,
 *  y hệt default `max.poll.interval.ms` của Kafka thật) trước khi một group
 *  MỚI về `Stable` và member có `assignment` thật, dù chỉ một member "đủ" ngay
 *  từ đầu (xem why-comment ở `joinGroup`, đây là hành vi được duyệt của Task 2,
 *  không phải bug). 300_000ms vượt xa `durationMs` của mọi lesson trong app
 *  này, nên không override giá trị này thì consumer không bao giờ đọc được gì
 *  trong khung giờ của lesson. 5_000ms là một giá trị THẬT của
 *  `max.poll.interval.ms` (Kafka thật cho phép tune thấp hơn 300_000ms mặc
 *  định để rebalance nhanh hơn khi biết callback xử lý không bao giờ chạy lâu
 *  — đúng tình huống dạy học ở đây), không phải một con số bịa ra cho vừa test. */
const DEFAULT_MAX_POLL_INTERVAL_MS = 5_000

export const CONSUMER_A = Object.freeze({
  id: 'c1',
  label: 'Consumer A',
  position: { x: 700, y: 120 },
  maxPollIntervalMs: DEFAULT_MAX_POLL_INTERVAL_MS,
})
export const CONSUMER_B = Object.freeze({
  id: 'c2',
  label: 'Consumer B',
  position: { x: 700, y: 260 },
  maxPollIntervalMs: DEFAULT_MAX_POLL_INTERVAL_MS,
})
export const CONSUMER_C = Object.freeze({
  id: 'c3',
  label: 'Consumer C',
  position: { x: 700, y: 400 },
  maxPollIntervalMs: DEFAULT_MAX_POLL_INTERVAL_MS,
})
