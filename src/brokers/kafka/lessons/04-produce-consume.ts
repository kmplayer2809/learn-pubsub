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
      at: 10_000,
      question: 'Hai record vào chung một batch. Cái gì quyết định lúc batch rời producer?',
      options: [
        'Đồng hồ `lingerMs` đếm từ lúc mở batch, hoặc batch đầy `batchSize`',
        'Mỗi record tự đặt hẹn giờ riêng của nó',
        'Lượt poll kế tiếp của consumer',
      ],
      answerIndex: 0,
      explanation:
        'Record thứ hai nhập vào batch đang mở, không làm đồng hồ chạy lại từ đầu. Vì vậy độ trễ tệ nhất của một record bằng đúng `lingerMs`.',
    },
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
    {
      at: 25_000,
      question:
        'Tổng kết: tiến trình producer chết ngay sau khi `produce()` trả về, trước lúc batch kịp flush. Record ra sao?',
      options: [
        'Mất — nó mới nằm trong bộ nhớ producer, chưa broker nào thấy',
        'An toàn, vì `produce()` đã trả về nghĩa là broker đã nhận',
        'Broker phát hiện thiếu rồi yêu cầu gửi lại',
      ],
      answerIndex: 0,
      explanation:
        '`produce()` trả về ngay khi record vào buffer, đó là một lời gọi bất đồng bộ. Chỉ callback hoặc `Future` mới báo broker đã nhận thật. Đây chính là lý do phải chờ callback trước khi coi một lượt ghi là xong, và vì sao `lingerMs` lớn vừa tăng thông lượng vừa nới rộng lượng dữ liệu có thể mất.',
    },
  ],
  quiz: [
    {
      question: '`produce()` trả về nghĩa là gì?',
      options: [
        'Record đã vào buffer của producer, chưa chắc broker đã nhận',
        'Broker đã ghi xong record',
        'Consumer đã đọc được record',
        'Record đã được cấp offset',
      ],
      answerIndex: 0,
      explanation:
        'Đây là một lời gọi bất đồng bộ. Chỉ callback hoặc `Future` mới báo broker đã nhận thật.',
    },
    {
      question: 'Ai cấp offset cho một record?',
      options: [
        'Leader của partition, lúc append vào log',
        'Producer, trước khi gửi',
        'Controller',
        'Consumer, lúc đọc',
      ],
      answerIndex: 0,
      explanation:
        'Offset là vị trí trong log của leader, nên nó chỉ tồn tại sau bước append. Thứ tự các record trong batch được giữ nguyên khi append.',
    },
    {
      question: 'High watermark là gì?',
      options: [
        'Ranh giới mà consumer được phép đọc tới',
        'Offset lớn nhất producer đã gửi',
        'Số record trong một batch',
        'Vị trí commit của group',
      ],
      answerIndex: 0,
      explanation:
        'Chỉ một broker giữ partition thì high watermark bám sát ngay theo leader. Nhiều replica thì nó chỉ nhích khi ISR đã theo kịp.',
    },
    {
      question: '`lingerMs` lớn hơn đem lại gì, mất gì?',
      options: [
        'Thông lượng cao hơn, đổi bằng độ trễ lớn hơn cùng lượng dữ liệu có thể mất rộng hơn',
        'Độ trễ thấp hơn, đổi bằng thông lượng',
        'Độ bền cao hơn, đổi bằng bộ nhớ',
        'Không đổi gì, nó chỉ ảnh hưởng tới log',
      ],
      answerIndex: 0,
      explanation:
        'Batch lớn hơn nghĩa là ít lượt gửi hơn cho cùng lượng dữ liệu, nhưng cũng nghĩa là nhiều record nằm chờ trong bộ nhớ producer lâu hơn.',
    },
  ],
}
