import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một broker, một partition — vòng đời của một record kể được rõ nhất khi
// không có partitioner hay nhiều leader nào chen vào câu chuyện.
export const produceConsume: KafkaLesson = {
  id: '04-produce-consume',
  group: 'basics',
  title: 'Vòng đời một record',
  summary:
    'Từ lúc nằm trong batch ở producer tới lúc consumer commit xong — không có bước nào tự động, mỗi mốc đều do một sự kiện cụ thể kích hoạt.',
  seed: 4,
  durationMs: 25_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [{ ...PRODUCER, lingerMs: 500 }],
    // `enableAutoCommit: false`: mặc định thật của Kafka là `true` (5s một lần,
    // xem `group/offsets.ts`), nhưng bài này đang dạy "commit là một hành động
    // tường minh" — bật auto-commit thật sẽ tự nhích `committedAt` mỗi 5s bất kể
    // script có gọi commit hay không, làm sai chính điều bài muốn chỉ ra.
    consumers: [{ ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], processingMs: 300, enableAutoCommit: false }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    // `c1` join một group MỚI nên phải đợi hết `maxPollIntervalMs` (5000, xem
    // default ở `types.ts`) trước khi coordinator chốt assignment — đây là hành
    // vi CHỦ ĐỘNG của `group/coordinator.ts` (đã duyệt ở Task 2), không phải độ
    // trễ ngẫu nhiên. Mọi mốc sau đây lùi lại đúng 5000ms so với bản trước khi
    // real group coordination được nối vào, để record chỉ được produce SAU khi
    // `c1` đã có assignment thật — produce trước mốc đó sẽ bị `latest` (default
    // của consumer) bỏ qua vĩnh viễn, y hệt bẫy lesson 05 dạy.
    //
    // Lệch khỏi lưới poll 100ms (0, 100, 200…) một chút có chủ đích: flush ở
    // 6050+500=6550 không trùng bất kỳ mốc poll nào, nên thứ tự "flush xong rồi
    // mới tới lượt poll kế tiếp đọc thấy" không phụ thuộc cách kernel phá vỡ
    // tie giữa hai event cùng `at` (xem run.ts/clock.ts) — luôn tách bạch rõ ràng.
    { at: 6050, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 6150, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    // Commit phải là một lệnh script tường minh (auto-commit đã tắt ở trên),
    // đặt sau khi process-done (6600 + processingMs 300 = 6900) đã chắc chắn xảy ra.
    { at: 7000, kind: 'commit', consumerId: 'c1' },
  ],
  narrative: [
    {
      at: 6050,
      title: 'Record nằm trong batch, chưa đi đâu cả',
      body:
        'Producer gom record vào một batch cục bộ trước, không gửi ngay lập tức. Với `lingerMs: 500`, batch này còn chờ tới khi đủ nửa giây hoặc đầy `batchSize` mới thật sự rời khỏi producer.',
      highlight: ['p1'],
    },
    {
      at: 6150,
      title: 'Batch gom thêm, đồng hồ chờ không đổi',
      body:
        'Record thứ hai nhập cùng batch còn đang mở — chỉ chiếc đồng hồ đếm từ lần mở batch đầu tiên mới quyết định lúc flush, không phải mỗi record tự đặt hẹn giờ riêng.',
      highlight: ['p1'],
    },
    {
      at: 6550,
      title: 'Flush: leader append và cấp offset',
      body:
        'Hết `lingerMs`, batch rời producer. Leader `b1` ghi cả hai record vào log `orders-0` theo đúng thứ tự đã gom, cấp offset 0 và offset 1.',
      highlight: ['orders-0'],
    },
    {
      at: 6600,
      title: 'High watermark nhích, consumer fetch',
      body:
        'Chỉ một broker giữ partition này nên high watermark bám sát ngay theo leo — hai record vừa ghi lập tức được phép đọc. Đúng lượt poll kế tiếp, consumer nhận cả hai.',
      highlight: ['orders-0', 'c1'],
    },
    {
      at: 7000,
      title: 'Xử lý xong rồi mới commit',
      body:
        'Consumer xử lý xong hai record sau `processingMs: 300`, và chỉ tới đây mới chủ động gọi commit để lưu lại vị trí đã đọc. Auto-commit đã bị tắt ở lesson này nên không có bước nào tự commit thay — vòng đời của một record khép lại đúng ở hành động này.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 20_000,
      question: 'Ngay sau khi gọi `produce()`, record đi đâu trước tiên?',
      options: [
        'Gửi thẳng tới leader ngay lập tức',
        'Nằm trong một batch cục bộ ở producer, chờ `lingerMs` hoặc `batchSize`',
        'Ghi thẳng vào một log cục bộ ở producer trước khi gửi',
      ],
      answerIndex: 1,
      explanation:
        'Producer không gửi từng record riêng lẻ. Nó gom vào một batch trong bộ nhớ, chỉ thật sự gửi khi `lingerMs` hết hoặc batch đủ `batchSize` — trì hoãn có chủ đích để đổi độ trễ nhỏ lấy thông lượng lớn hơn.',
    },
  ],
}
