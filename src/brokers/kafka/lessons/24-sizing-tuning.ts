import { BROKER_1, BROKER_2, BROKER_3 } from './types'
import type { KafkaLesson } from './types'

// Checklist production nằm ngay trong cấu hình dưới đây, không chỉ trong lời
// văn: `replicationFactor: 3`, `minInsyncReplicas: 2`, `acks: 'all'`,
// `idempotent: true`, `assignor: 'cooperative-sticky'` — narrative chỉ đọc lại
// những gì topology này đã thật sự dựng.
const PRODUCER_WORKLOAD = Object.freeze({
  id: 'p1',
  label: 'Producer workload',
  position: { x: 40, y: 220 },
  acks: 'all' as const,
  idempotent: true,
  retries: 3,
  lingerMs: 0,
})

const CONSUMER_1P = Object.freeze({
  id: 'c1',
  label: 'Consumer (1 partition)',
  position: { x: 700, y: 100 },
  groupId: 'g24-1p',
  subscriptions: ['orders-1p'],
  autoOffsetReset: 'earliest' as const,
  maxPollIntervalMs: 5_000,
})

const CONSUMER_6P_A = Object.freeze({
  id: 'c2',
  label: 'Consumer A (6 partition)',
  position: { x: 700, y: 260 },
  groupId: 'g24-6p',
  subscriptions: ['orders-6p'],
  autoOffsetReset: 'earliest' as const,
  assignor: 'cooperative-sticky' as const,
  maxPollIntervalMs: 5_000,
})

const CONSUMER_6P_B = Object.freeze({
  id: 'c3',
  label: 'Consumer B (6 partition)',
  position: { x: 700, y: 380 },
  groupId: 'g24-6p',
  subscriptions: ['orders-6p'],
  autoOffsetReset: 'earliest' as const,
  assignor: 'cooperative-sticky' as const,
  maxPollIntervalMs: 5_000,
})

const CONSUMER_6P_C = Object.freeze({
  id: 'c4',
  label: 'Consumer C (6 partition)',
  position: { x: 700, y: 500 },
  groupId: 'g24-6p',
  subscriptions: ['orders-6p'],
  autoOffsetReset: 'earliest' as const,
  assignor: 'cooperative-sticky' as const,
  maxPollIntervalMs: 5_000,
})

// Cùng một chuỗi key/value, gửi song song vào cả hai topic ở đúng cùng mốc
// thời gian — "cùng workload trên hai topic" là một sự thật của kịch bản, không
// phải một câu mô tả cần tin suông.
const KEYS = ['user-1', 'user-2', 'user-3']
const workloadScript = Array.from({ length: 9 }, (_, i) => {
  const at = 1000 * (i + 1)
  const key = KEYS[i % KEYS.length]
  const value = `v${i + 1}`
  return [
    { at, kind: 'produce' as const, producerId: 'p1', topic: 'orders-1p', key, value },
    { at, kind: 'produce' as const, producerId: 'p1', topic: 'orders-6p', key, value },
  ]
}).flat()

export const sizingTuning: KafkaLesson = {
  id: '24-sizing-tuning',
  group: 'advanced',
  title: 'Sizing và tuning',
  summary:
    'Số partition là trần song song của một topic — không thể tăng lên rồi giảm xuống, và tăng nó phá vỡ bảo đảm thứ tự theo key vì ánh xạ hash đổi; đánh đổi ordering lấy parallelism là một quyết định thiết kế, không phải một tham số chỉnh cho vừa tải.',
  seed: 24,
  durationMs: 26_000,
  topology: {
    brokers: [BROKER_1, BROKER_2, BROKER_3],
    topics: [
      { name: 'orders-1p', partitions: 1, replicationFactor: 3, config: { minInsyncReplicas: 2 } },
      { name: 'orders-6p', partitions: 6, replicationFactor: 3, config: { minInsyncReplicas: 2 } },
    ],
    producers: [PRODUCER_WORKLOAD],
    consumers: [CONSUMER_1P, CONSUMER_6P_A, CONSUMER_6P_B, CONSUMER_6P_C],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 0, kind: 'consumer-join', consumerId: 'c2' },
    { at: 0, kind: 'consumer-join', consumerId: 'c3' },
    { at: 0, kind: 'consumer-join', consumerId: 'c4' },
    ...workloadScript,
  ],
  narrative: [
    {
      at: 1000,
      title: 'Số partition là trần song song',
      body:
        '`orders-1p` chỉ có một partition — dù gắn thêm bao nhiêu consumer vào group `g24-1p`, cũng chỉ đúng một trong số đó có việc để làm tại một thời điểm. `orders-6p` có sáu partition, nên `g24-6p` chia việc thật sự cho `c2`/`c3`/`c4` cùng lúc. Số partition đặt ra khi tạo topic chính là TRẦN của mức song song — Kafka không cho giảm nó xuống sau này, và tăng lên là một thao tác một chiều.',
      highlight: ['orders-1p-0', 'orders-6p-0', 'c1', 'c2', 'c3', 'c4'],
    },
    {
      at: 4000,
      title: 'Tăng partition phá vỡ thứ tự theo key',
      body:
        'Ánh xạ một key sang partition đi qua hash của chính key đó CHIA cho số partition hiện tại — đổi số partition tức là đổi luôn phép chia đó. Mọi record cũ của `user-1` nằm ở partition cũ, còn record mới của `user-1` (sau khi tăng partition) hoàn toàn có thể rơi sang một partition khác — thứ tự theo key, thứ vốn chỉ được bảo đảm TRONG một partition, coi như đứt đoạn ngay tại điểm tăng đó.',
      highlight: ['orders-6p-0', 'orders-6p-1'],
    },
    {
      at: 8000,
      title: 'Ordering đổi lấy parallelism — quyết định thiết kế, không phải cấu hình',
      body:
        'Muốn giữ thứ tự tuyệt đối theo key mãi mãi thì phải chốt số partition ngay từ đầu, chấp nhận trần song song đó suốt vòng đời topic. Muốn linh hoạt tăng partition theo tải thì phải chấp nhận thứ tự theo key có thể đứt đoạn tại thời điểm tăng. Đây là một lựa chọn phải cân nhắc khi THIẾT KẾ topic, không phải một con số chỉnh tạm thời rồi chỉnh lại sau.',
      highlight: ['c1', 'c2', 'c3', 'c4'],
    },
    {
      at: 9500,
      title: 'Checklist production',
      body:
        'Cấu hình của cả hai topic trong bài này gói gọn một checklist đáng nhớ khi đưa Kafka lên production: `replicationFactor: 3` (chịu được mất một broker), `min.insync.replicas: 2` (không chấp nhận ghi mà chỉ một bản sao xác nhận), `acks=\'all\'` phía producer, bật `idempotent` để chặn duplicate do retry, dùng assignor `cooperative-sticky` để rebalance không dừng cả group, và luôn giám sát consumer lag cùng số partition đang under-replicated.',
      highlight: ['p1'],
    },
    {
      at: 9800,
      title: 'Kafka không phải một hàng đợi công việc',
      body:
        'Nếu bài toán thật sự cần chia TỪNG công việc cho một consumer xử lý, kèm ack/nack riêng lẻ cho từng việc và requeue khi thất bại — đó là mô hình hàng đợi (work queue), và RabbitMQ hợp với nó hơn hẳn. Kafka chia việc theo PARTITION (một khối record liên tục cho một consumer trong group), không theo từng record riêng lẻ — mạnh về throughput và replay, nhưng không phải công cụ đúng cho một hàng đợi công việc mịn tới từng item.',
      highlight: ['c2', 'c3', 'c4'],
    },
  ],
  checkpoints: [
    {
      at: 22_000,
      question: 'Vì sao tăng số partition của một topic đang chạy có thể phá vỡ thứ tự theo key, dù không có record nào bị mất?',
      options: [
        'Vì Kafka xoá bớt log cũ khi tăng partition',
        'Vì ánh xạ key sang partition đi qua hash chia cho số partition hiện tại — đổi số partition đổi luôn kết quả ánh xạ đó, nên record mới của một key có thể rơi vào partition khác với record cũ của CHÍNH key đó',
        'Vì consumer group tự động xoá offset đã commit khi partition tăng',
      ],
      answerIndex: 1,
      explanation:
        'Thứ tự theo key của Kafka chỉ đúng TRONG một partition. Tăng số partition thay đổi phép chia dùng để ánh xạ key sang partition, nên từ thời điểm đó, record mới của một key có thể không còn rơi vào partition cũ của nó nữa — hai record cùng key giờ nằm ở hai partition khác nhau, và thứ tự đọc giữa hai partition độc lập không được bảo đảm gì cả.',
    },
  ],
}
