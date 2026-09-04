import { BROKER_1, BROKER_2 } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// Hai broker, hai topic CÙNG hình dạng (2 partition, replicationFactor 2) —
// chỉ khác `minInsyncReplicas`. Cả hai topic có 2 partition (không phải 1) để
// vòng round-robin gán leader của `createState` cho PARTITION 0 của cả hai
// topic cùng rơi vào `b1` (globalIndex 0 và 2, cùng `% 2 == 0`) — script chỉ
// ghi vào partition 0 của mỗi topic, nên cùng một broker `b2` chết là follower
// của CẢ HAI, cho phép so sánh công bằng trên cùng một fault.
const PRODUCER_ALL = Object.freeze({ id: 'p1', label: "Producer acks='all'", position: { x: 40, y: 220 }, acks: 'all' as const })

const failures: KafkaFault[] = [{ at: 9000, kind: 'broker-down', brokerId: BROKER_2.id }]

export const minInsyncReplicas: KafkaLesson = {
  id: '18-min-insync-replicas',
  group: 'durability',
  title: 'min.insync.replicas',
  summary:
    '`acks=all` một mình không bảo đảm gì — "all" nghĩa là cả ISR, mà ISR có thể co lại chỉ còn một broker; `min.insync.replicas` là sàn ISR để một lần ghi được chấp nhận, dưới sàn thì produce lỗi ồn ào thay vì mất im lặng.',
  seed: 18,
  durationMs: 26_000,
  topology: {
    brokers: [BROKER_1, BROKER_2],
    topics: [
      { name: 'orders-strict', partitions: 2, replicationFactor: 2, config: { minInsyncReplicas: 2 } },
      { name: 'orders-loose', partitions: 2, replicationFactor: 2, config: { minInsyncReplicas: 1 } },
    ],
    producers: [PRODUCER_ALL],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders-strict', value: 'a1', partition: 0 },
    { at: 1500, kind: 'produce', producerId: 'p1', topic: 'orders-loose', value: 'b1', partition: 0 },
    { at: 5000, kind: 'produce', producerId: 'p1', topic: 'orders-strict', value: 'a2', partition: 0 },
    { at: 5500, kind: 'produce', producerId: 'p1', topic: 'orders-loose', value: 'b2', partition: 0 },
    // b2 xuống ở t=9000 (xem failures): ISR của cả hai partition-0 co từ [b1,b2]
    // về [b1] ngay lập tức (Task 8: broker-down chain shrink phản ứng).
    { at: 9500, kind: 'produce', producerId: 'p1', topic: 'orders-strict', value: 'a3', partition: 0 },
    { at: 10_000, kind: 'produce', producerId: 'p1', topic: 'orders-loose', value: 'b3', partition: 0 },
    { at: 15_000, kind: 'produce', producerId: 'p1', topic: 'orders-strict', value: 'a4', partition: 0 },
    { at: 15_500, kind: 'produce', producerId: 'p1', topic: 'orders-loose', value: 'b4', partition: 0 },
  ],
  narrative: [
    {
      at: 1000,
      title: 'Hai topic giống hệt nhau, chỉ khác một con số',
      body:
        '`orders-strict` và `orders-loose` có cùng `replicationFactor: 2`, cùng producer `acks=\'all\'` — khác đúng một chỗ: `min.insync.replicas` là 2 với topic đầu, 1 với topic sau. Cùng một sự cố sắp xảy ra với cả hai, nhưng hậu quả sẽ khác hẳn.',
      highlight: ['orders-strict-0', 'orders-loose-0', 'p1'],
    },
    {
      at: 5000,
      title: '`acks=all` là "cả ISR" — mà ISR có thể chỉ còn một broker',
      body:
        '`acks=\'all\'` không có nghĩa "chờ mọi replica trong `replicationFactor`" — nó chờ ISR, và ISR co lại được. Ngay bây giờ ISR của cả hai partition đang đủ hai broker, ghi vẫn bình thường ở cả hai topic — nhưng đó không phải một bảo đảm cố định.',
      highlight: ['orders-strict-0', 'orders-loose-0'],
    },
    {
      at: 9000,
      title: '`b2` xuống: ISR co ngay xuống còn một',
      body:
        '`b2` vừa chết. ISR của partition-0 ở cả hai topic co từ hai broker xuống còn một (`b1`) ngay lập tức — Kafka thật cũng phản ứng nhanh với một broker được xác nhận đã mất, không đợi hết `replica.lag.time.max.ms` mới nhận ra điều đã biết chắc.',
      highlight: ['b2', 'orders-strict-0', 'orders-loose-0'],
    },
    {
      at: 9500,
      title: '`orders-strict`: dưới sàn, produce lỗi ồn ào',
      body:
        'ISR chỉ còn một broker, trong khi `min.insync.replicas` của `orders-strict` đòi hai — produce lần này bị từ chối thẳng với `NOT_ENOUGH_REPLICAS`, KHÔNG hề ghi một phần nào vào log. Đây chính là điểm của `min.insync.replicas`: lỗi ồn ào, producer biết ngay để retry hoặc báo cho application, tốt hơn hẳn một ghi "thành công" nhưng chỉ nằm trên một bản sao duy nhất.',
      highlight: ['orders-strict-0', 'b1'],
    },
    {
      at: 10_000,
      title: '`orders-loose`: dưới sàn của topic kia không có nghĩa gì ở đây',
      body:
        'Cùng lúc, `orders-loose` vẫn ghi bình thường — ISR của nó cũng chỉ còn một broker, nhưng `min.insync.replicas: 1` coi đó là đủ. Cùng một sự cố cụm, hai kết quả khác hẳn nhau chỉ vì một con số cấu hình khác nhau trên từng topic.',
      highlight: ['orders-loose-0', 'b1'],
    },
  ],
  checkpoints: [
    {
      at: 22_000,
      question: 'Công thức phổ biến `replicationFactor: 3`, `min.insync.replicas: 2`, `acks: \'all\'` cân bằng điều gì?',
      options: [
        'Luôn cần cả ba broker sống thì mới ghi được — an toàn tuyệt đối nhưng không chịu được bất kỳ sự cố nào',
        'Chịu được đúng một broker chết mà vẫn ghi được (ISR còn hai, đủ sàn 2), đồng thời vẫn đòi ít nhất hai bản sao xác nhận trước khi coi một ghi là xong',
        'Đặt `min.insync.replicas` bằng `replicationFactor` để chắc chắn không bao giờ mất record, bất kể có bao nhiêu broker chết',
      ],
      answerIndex: 1,
      explanation:
        'Với replicationFactor 3 và min.insync.replicas 2, cụm chịu được một broker chết (ISR co từ 3 xuống 2, vẫn đủ sàn) mà không ngừng ghi, trong khi vẫn đòi hai bản sao xác nhận cho mỗi lần ghi acks=all. Đặt min.insync.replicas bằng đúng replicationFactor (phương án thứ ba) là mất khả năng chịu lỗi hoàn toàn — chỉ cần một broker chết là ISR tụt dưới sàn ngay.',
    },
  ],
}
