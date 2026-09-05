import { BROKER_1, PRODUCER } from './types'
import type { KafkaFault, KafkaLesson } from './types'

const PRODUCER_ORDERS = Object.freeze({ ...PRODUCER, lingerMs: 0 })

// `maxPollIntervalMs: 5_000` — bỏ trống rơi về default 300_000ms, vượt xa
// `durationMs` của lesson này, và group không bao giờ về `Stable` kịp.
const CONSUMER_C1 = Object.freeze({
  id: 'c1',
  label: 'Consumer đơn hàng',
  position: { x: 700, y: 200 },
  groupId: 'g23',
  subscriptions: ['orders'],
  autoOffsetReset: 'earliest' as const,
  processingMs: 500,
  maxPollIntervalMs: 5_000,
})

// Fault duy nhất: `c1` xử lý lỗi 5 lần liên tiếp bắt đầu đúng lúc `order-6-loi`
// tới tay nó (t=6000) — mô phỏng một record khiến callback xử lý ném ngoại lệ
// nhiều lần trước khi ứng dụng (kịch bản bên dưới, hai lệnh produce ở t=9000
// và t=9200) từ bỏ retry-tại-chỗ và đẩy nó sang `orders.retry` rồi `orders.dlq`.
const failures: KafkaFault[] = [{ at: 6000, kind: 'processing-error', consumerId: 'c1', times: 5 }]

export const retryDlq: KafkaLesson = {
  id: '23-retry-dlq',
  group: 'advanced',
  title: 'Retry topic và DLQ',
  summary:
    'Retry-tại-chỗ khiến offset không nhích được — một record hỏng chặn đứng cả partition; đẩy nó sang một topic retry riêng để partition gốc đi tiếp, và sau đủ số lần thất bại thì rơi vào DLQ kèm header ghi nguyên nhân, chờ một quy trình xử lý thật chứ không phải nằm im ở đó mãi mãi.',
  seed: 23,
  durationMs: 28_000,
  topology: {
    brokers: [BROKER_1],
    topics: [
      { name: 'orders', partitions: 1, replicationFactor: 1 },
      { name: 'orders.retry', partitions: 1, replicationFactor: 1 },
      { name: 'orders.dlq', partitions: 1, replicationFactor: 1 },
    ],
    producers: [PRODUCER_ORDERS],
    consumers: [CONSUMER_C1],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-1' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-2' },
    { at: 3000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-3' },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-4' },
    { at: 5000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-5' },
    // Record hỏng — đúng lúc fault kích hoạt (xem `failures`).
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-6-loi' },
    // Hai record NGAY SAU record hỏng — điểm mấu chốt cần chứng minh: chúng
    // vẫn phải được giao và xử lý, không đứng khựng lại chờ record hỏng xong.
    { at: 6500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-7' },
    { at: 7500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-8' },
    // Ứng dụng (mô phỏng qua kịch bản, không phải một cơ chế tự động của
    // broker) đẩy `order-6-loi` sang topic retry trước…
    { at: 9000, kind: 'produce', producerId: 'p1', topic: 'orders.retry', value: 'order-6-loi', headers: { attempt: '1' } },
    // …rồi, sau khi cũng hết hạn mức retry ở đó, rơi hẳn vào DLQ — kèm header
    // ghi lại nguyên nhân và tổng số lần đã thử, để một quy trình xử lý sau
    // này (con người hoặc job khác) biết chuyện gì đã xảy ra mà không cần đoán.
    {
      at: 9200,
      kind: 'produce',
      producerId: 'p1',
      topic: 'orders.dlq',
      value: 'order-6-loi',
      headers: { cause: 'processing-error', attempts: '5' },
    },
    { at: 10_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-9' },
    { at: 12_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-10' },
    { at: 15_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'order-11' },
  ],
  narrative: [
    {
      at: 6000,
      title: 'Retry-tại-chỗ: offset không nhích được',
      body:
        '`order-6-loi` vừa khiến `c1` xử lý lỗi liên tiếp. Nếu ứng dụng chọn retry NGAY TẠI CHỖ — nghĩa là lặp lại đúng record đó tới khi thành công, không bao giờ gọi `poll()` cho lô tiếp theo — thì cả partition đứng khựng lại theo nó: offset không nhích lên được, mọi record đến sau, kể cả những record hoàn toàn khoẻ mạnh, phải xếp hàng chờ.',
      highlight: ['c1', 'orders-0'],
    },
    {
      at: 9000,
      title: 'Đẩy sang retry topic để partition gốc đi tiếp',
      body:
        'Cách khác: bắt lỗi, ghi record hỏng sang một topic retry riêng (`orders.retry`), rồi commit offset trên partition gốc như bình thường. `order-7`, `order-8` phía sau đã được giao và xử lý bình thường trong lúc `order-6-loi` còn đang loay hoay — partition gốc không hề biết hay quan tâm nó đang được retry ở nơi khác.',
      highlight: ['orders.retry-0', 'c1'],
    },
    {
      at: 9100,
      title: 'Retry topic có độ trễ riêng, thường nhiều bậc',
      body:
        'Một retry topic thường không xử lý lại ngay — nó gắn một độ trễ (delay) trước khi đẩy ngược lại, và hệ thống production thường xếp NHIỀU bậc trễ tăng dần (ví dụ 5 giây, rồi 1 phút, rồi 10 phút) thay vì retry dồn dập liên tục, để không dội ngay lập tức vào một sự cố còn đang xảy ra.',
      highlight: ['orders.retry-0'],
    },
    {
      at: 9200,
      title: 'Quá số lần thì vào DLQ, kèm header ghi lại nguyên nhân',
      body:
        'Sau khi cũng hết hạn mức thử lại, `order-6-loi` rơi hẳn vào `orders.dlq` — kèm header `cause`/`attempts` ghi lại VÌ SAO nó thất bại và đã thử bao nhiêu lần. Không có hai trường này, một record nằm trong DLQ chỉ là một bí ẩn không ai lần ra được nguồn gốc.',
      highlight: ['orders.dlq-0'],
    },
    {
      at: 9300,
      title: 'DLQ không người đọc chỉ là chỗ chôn dữ liệu',
      body:
        'Chú ý: `orders.dlq` ở lesson này không có consumer nào subscribe — đúng ý cảnh báo cần đưa ra. Một DLQ không đi kèm quy trình xử lý và cảnh báo (dashboard, alert, một job định kỳ quét qua) không giải quyết được gì — nó chỉ chuyển vấn đề từ "chặn partition" sang "âm thầm biến mất", và cái sau còn nguy hiểm hơn vì không ai nhận ra.',
      highlight: ['orders.dlq-0'],
    },
  ],
  checkpoints: [
    {
      at: 24_000,
      question: 'Vì sao đẩy record hỏng sang `orders.retry` rồi `orders.dlq` tốt hơn retry-tại-chỗ trên chính partition gốc?',
      options: [
        'Vì `orders.retry`/`orders.dlq` xử lý nhanh hơn partition gốc',
        'Vì retry-tại-chỗ giữ nguyên vị trí đọc tại record hỏng cho tới khi nó thành công, chặn đứng mọi record phía sau; đẩy sang topic khác cho phép commit offset trên partition gốc đi tiếp ngay, còn record hỏng được xử lý riêng, có độ trễ và giới hạn số lần thử riêng',
        'Vì `orders.dlq` tự động sửa lỗi trong record trước khi lưu',
      ],
      answerIndex: 1,
      explanation:
        'Một consumer retry-tại-chỗ không tiến lên record kế tiếp cho tới khi record hiện tại thành công — với một record hỏng vĩnh viễn (dữ liệu sai định dạng chẳng hạn), điều đó chặn đứng toàn bộ phần còn lại của partition. Đẩy sang một topic retry (rồi DLQ nếu vẫn thất bại) tách hẳn số phận của record hỏng khỏi tiến độ của partition gốc.',
    },
  ],
}
