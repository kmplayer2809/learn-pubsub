import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

export const topicPartition: KafkaLesson = {
  id: '01-topic-partition',
  group: 'basics',
  title: 'Topic, partition và offset',
  summary:
    'Topic chỉ là một cái tên; dữ liệu thật nằm trong các partition, mỗi partition là một log chỉ ghi thêm.',
  seed: 1,
  durationMs: 18_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 3, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'] }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 2500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4' },
    { at: 8000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5' },
    { at: 10_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Topic là một cái tên, partition mới là nơi chứa dữ liệu',
      body:
        '`orders` tự nó không lưu gì cả — nó chỉ là một cái tên. Ba partition `orders-0`, `orders-1`, `orders-2` mới là ba log riêng biệt, mỗi log giữ một phần dữ liệu của topic.',
      highlight: ['orders-0', 'orders-1', 'orders-2'],
    },
    {
      at: 1000,
      title: 'Offset là vị trí, không phải id',
      body:
        'Mỗi partition đếm offset riêng, bắt đầu từ 0. Hai record nằm ở hai partition khác nhau hoàn toàn có thể cùng mang offset 0 mà chẳng liên quan gì tới nhau.',
      highlight: ['orders-0', 'orders-1', 'orders-2'],
    },
    {
      at: 4000,
      title: 'Log chỉ ghi thêm',
      body:
        'Một partition không sửa, không chèn giữa, không xoá lẻ một record. Ghi luôn là nối vào đuôi log, và chính điều đó khiến việc ghi nhanh đến vậy.',
      highlight: ['orders-0', 'orders-1', 'orders-2'],
    },
    {
      at: 8000,
      title: 'Record không key rải qua nhiều partition',
      body:
        'Sáu record đã ghi rải ra cả ba partition, nên **không** có một thứ tự chung cho toàn topic — chỉ có thứ tự bên trong từng partition mới được giữ nguyên.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'p1'],
    },
    {
      at: 12_000,
      title: 'Đọc không xoá',
      body:
        'Consumer đọc xong, record vẫn nằm nguyên trong log — xoá là việc của retention, không phải của việc đọc. Đây là khác biệt lớn nhất so với một queue kiểu RabbitMQ, nơi tiêu thụ xong là mất.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'c1'],
    },
  ],
  checkpoints: [
    {
      at: 15_000,
      question: 'Sáu record ghi vào topic ba partition. Kafka bảo đảm gì về thứ tự?',
      options: [
        'Sáu record đọc ra đúng thứ tự đã ghi',
        'Chỉ trong từng partition thứ tự mới được bảo đảm',
        'Không bảo đảm gì cả',
      ],
      answerIndex: 1,
      explanation:
        'Kafka chỉ giữ thứ tự bên trong một partition. Sáu record rải ra ba partition khác nhau nên không hề có một thứ tự chung nào cho cả topic — ghép log của cả ba partition lại với nhau không cho ra thứ tự ghi gốc.',
    },
  ],
}
