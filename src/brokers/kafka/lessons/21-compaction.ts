import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một broker, một partition, `cleanupPolicy: 'compact'`. `segmentBytes: 200`
// nhỏ CHỦ Ý — bốn record đầu (khoảng 190 byte) vừa đủ lấp một segment; record
// thứ năm buộc nó seal, và compaction (Task 8: chạy ngay khi một segment MỚI
// sealed) có việc để làm trong đúng khung script ngắn dưới đây, không cần chờ
// một vòng quét định kỳ riêng.
export const compaction: KafkaLesson = {
  id: '21-compaction',
  group: 'durability',
  title: 'Log compaction',
  summary:
    'Compaction giữ bản ghi mới nhất của mỗi key thay vì giữ theo thời gian — dùng cho topic dạng bảng trạng thái, không dùng cho dòng sự kiện; tombstone (`value = null`) xoá hẳn một key, và sau compaction offset có lỗ mà consumer phải chịu được.',
  seed: 21,
  durationMs: 28_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1, config: { cleanupPolicy: 'compact', segmentBytes: 200 } }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g21', subscriptions: ['orders'], autoOffsetReset: 'earliest' }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'v1' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-2', value: 'v1' },
    { at: 3000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'v2' },
    // Tombstone: `value: null` xoá hẳn `user-2` — không phải một giá trị rỗng,
    // mà là tín hiệu "quên key này đi".
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-2', value: null },
    // Record thứ năm buộc segment đầu (bốn record trên, ~190 byte) phải seal —
    // compaction chạy ngay tại đây (xem why-comment ở đầu file).
    { at: 5000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'v3' },
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'v4' },
    { at: 7000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'v5' },
  ],
  narrative: [
    {
      at: 1000,
      title: 'Compaction giữ bản mới nhất của mỗi key',
      body:
        'Topic này bật `cleanupPolicy: \'compact\'` thay vì `\'delete\'` (mặc định) — thay vì xoá theo tuổi hay dung lượng, nó giữ đúng MỘT bản ghi mới nhất cho mỗi key, xoá hết mọi bản cũ hơn của cùng key đó. `user-1` sắp được ghi nhiều lần — chỉ giá trị cuối cùng còn ý nghĩa.',
      highlight: ['orders-0', 'p1'],
    },
    {
      at: 4000,
      title: 'Tombstone: `value = null` xoá hẳn một key',
      body:
        '`user-2` vừa nhận một tombstone — một record với `value: null`. Đây không phải "đặt giá trị rỗng", mà là tín hiệu xoá: sau compaction, `user-2` biến mất khỏi log hoàn toàn, kể cả chính tombstone đó cũng tự xoá luôn sau khi làm xong nhiệm vụ.',
      highlight: ['orders-0'],
    },
    {
      at: 5000,
      title: 'Compaction chạy khi segment sealed',
      body:
        'Record vừa buộc segment đầu tiên phải đóng lại (đầy `segment.bytes`). Compaction chỉ đụng tới segment ĐÃ sealed — không bao giờ chạm segment đang mở — nên đây là lúc nó có việc để làm: bốn record vừa rồi được duyệt lại, chỉ giữ bản mới nhất của `user-1` (`v2`), còn `user-2` (đã có tombstone) biến mất hoàn toàn.',
      highlight: ['orders-0'],
    },
    {
      at: 7000,
      title: 'Offset có lỗ — consumer phải chịu được điều đó',
      body:
        'Những record bị compaction xoá KHÔNG được đánh số lại — offset của chúng biến mất vĩnh viễn, để lại lỗ hổng trong dãy offset. Một consumer đọc tuần tự sẽ thấy offset nhảy cóc, không liên tục — đây là hành vi bình thường của một topic compact, không phải dấu hiệu mất mát ngoài ý muốn.',
      highlight: ['orders-0', 'c1'],
    },
  ],
  checkpoints: [
    {
      at: 12_000,
      question: 'Compaction vừa xoá một record. Offset của nó ra sao?',
      options: [
        'Biến mất vĩnh viễn, để lại một lỗ trong dãy offset',
        'Được đánh số lại cho liên tục',
        'Chuyển sang cho record kế tiếp',
      ],
      answerIndex: 0,
      explanation:
        'Consumer đọc tuần tự sẽ thấy offset nhảy cóc. Đó là hành vi bình thường của một topic compact, không phải dấu hiệu mất mát ngoài ý muốn.',
    },
    {
      at: 24_000,
      question: 'Vì sao một topic ghi log sự kiện thuần tuý (ví dụ lịch sử giao dịch) không nên dùng `cleanupPolicy: \'compact\'`?',
      options: [
        'Vì compaction chỉ hoạt động với `replicationFactor: 1`, không dùng được cho cụm nhiều broker',
        'Vì compaction giữ bản ghi MỚI NHẤT theo key, xoá mọi bản cũ hơn — một dòng sự kiện cần giữ TOÀN BỘ lịch sử theo thời gian, không phải chỉ trạng thái cuối cùng của mỗi key',
        'Vì compaction làm topic đó không thể có consumer đọc được nữa',
      ],
      answerIndex: 1,
      explanation:
        'Compaction phù hợp cho topic dạng "ảnh chụp trạng thái" (changelog, bảng key-value) — nơi chỉ giá trị mới nhất của mỗi key có ý nghĩa. Một dòng sự kiện (mỗi bản ghi là một sự việc độc lập, kể cả trùng key) cần `cleanupPolicy: \'delete\'` để giữ đúng lịch sử theo thời gian, không bị compaction âm thầm xoá mất các sự kiện cũ hơn.',
    },
    {
      at: 28_000,
      question:
        'Tổng kết: một record trong topic compact được ghi mà **không** có key. Chuyện gì xảy ra?',
      options: [
        'Compaction không xử lý được nó, record nằm lại mãi và làm log phình dần',
        'Nó được coi như tombstone rồi bị xoá ngay lượt compaction kế tiếp',
        'Broker từ chối ghi vì topic compact bắt buộc phải có key',
      ],
      answerIndex: 0,
      explanation:
        'Compaction gom nhóm theo key, nên record thiếu key không thuộc nhóm nào và không bao giờ bị thay thế. Nó không bị coi là tombstone — tombstone là record **có** key với `value: null`. Vì vậy quy tắc là mọi record vào topic compact đều phải mang key; nhiều triển khai từ chối ghi ngay từ phía producer để tránh rác tích tụ.',
    },
  ],
  quiz: [
    {
      question: '`cleanupPolicy: \'compact\'` giữ lại cái gì?',
      options: [
        'Bản ghi mới nhất của mỗi key',
        'Mọi record trong khoảng `retention.ms` gần nhất',
        'Record đầu tiên của mỗi key',
        'Một mẫu ngẫu nhiên trong số record',
      ],
      answerIndex: 0,
      explanation:
        'Nó hợp cho topic dạng ảnh chụp trạng thái — changelog, bảng key-value — nơi chỉ giá trị mới nhất của mỗi key có ý nghĩa.',
    },
    {
      question: 'Tombstone là gì?',
      options: [
        'Record có key với `value: null`, báo hiệu xoá hẳn key đó',
        'Record không mang key',
        'Record đã bị compaction bỏ qua',
        'Một control record do broker tự sinh',
      ],
      answerIndex: 0,
      explanation:
        'Sau khi làm xong nhiệm vụ, chính tombstone cũng tự xoá luôn.',
    },
    {
      question: 'Compaction chạm vào segment nào?',
      options: [
        'Chỉ segment đã đóng',
        'Cả segment đang mở',
        'Chỉ segment đầu tiên',
        'Toàn bộ partition trong một lượt',
      ],
      answerIndex: 0,
      explanation:
        'Cùng nguyên tắc với retention: segment đang nhận ghi không bao giờ bị đụng tới.',
    },
    {
      question: 'Vì sao mọi record vào một topic compact đều nên mang key?',
      options: [
        'Compaction gom nhóm theo key; record thiếu key không thuộc nhóm nào nên nằm lại mãi',
        'Vì broker cần key để tính partition',
        'Vì tombstone phải trùng key với record đầu tiên',
        'Vì thiếu key thì consumer không đọc được',
      ],
      answerIndex: 0,
      explanation:
        'Rác kiểu đó tích tụ dần làm log phình lên. Nhiều triển khai từ chối ghi ngay từ phía producer.',
    },
  ],
}
