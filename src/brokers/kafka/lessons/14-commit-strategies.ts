import { BROKER_1, PRODUCER } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// Hai consumer, hai group KHÁC nhau, cùng đọc một topic một partition — mỗi
// consumer minh hoạ một chiến lược commit riêng, không cạnh tranh partition
// với nhau nên khác biệt quan sát được chỉ tới từ CÁCH commit, không từ việc
// chia partition.
//
// `maxPollIntervalMs: 15_000` trên cả hai (không phải default 5_000 của
// `CONSUMER_A/B/C`) — CHỦ ĐỘNG rộng hơn cơn treo 8000ms (fault bên dưới) của
// `c-auto`: bài này nói về THỜI ĐIỂM commit, không phải về bị đá khỏi group
// (chuyện đó là bài 16). Với default 5_000ms, `c-auto` sẽ bị `checkTimeouts`
// đá ngay giữa cơn treo — mọi auto-commit SAU đó lặng lẽ no-op (member không
// còn thuộc group), khiến `committedOffsets` đứng yên mãi ở giá trị TRƯỚC khi
// bị đá và câu chuyện "auto-commit vẫn tích đúng giờ dù đang treo" không còn
// đúng nữa sau mốc đó — một lần bắt được hiệu ứng này khi build lesson là đủ
// để không bao giờ để `maxPollIntervalMs` mặc định đứng cạnh một
// `consumer-stall` dài hơn nó.
//
// `rebalanceTimeoutMs: 5_000` tách riêng khỏi `maxPollIntervalMs` — nếu bỏ
// trống, nó sẽ rơi về ĐÚNG giá trị `maxPollIntervalMs` (15_000) và đẩy mốc
// Stable đầu tiên (cũng là mốc mọi mốc script/narrative còn lại của bài này
// neo vào) lùi lại 10 giây, phá vỡ toàn bộ các con số đã tính.
const CONSUMER_AUTO = Object.freeze({
  id: 'c-auto',
  label: 'c-auto (auto-commit)',
  position: { x: 700, y: 120 },
  groupId: 'g-auto',
  subscriptions: ['orders'],
  autoOffsetReset: 'earliest' as const,
  enableAutoCommit: true,
  autoCommitIntervalMs: 5_000,
  maxPollIntervalMs: 15_000,
  rebalanceTimeoutMs: 5_000,
  processingMs: 6_000,
})
const CONSUMER_MANUAL = Object.freeze({
  id: 'c-manual',
  label: 'c-manual (manual commit)',
  position: { x: 700, y: 320 },
  groupId: 'g-manual',
  subscriptions: ['orders'],
  autoOffsetReset: 'earliest' as const,
  enableAutoCommit: false,
  maxPollIntervalMs: 15_000,
  rebalanceTimeoutMs: 5_000,
  processingMs: 6_000,
})

const failures: KafkaFault[] = [{ at: 12_000, kind: 'consumer-stall', consumerId: 'c-auto', durationMs: 8_000 }]

export const commitStrategies: KafkaLesson = {
  id: '14-commit-strategies',
  group: 'consumer',
  title: 'Commit strategy',
  summary:
    'committed offset là con số DUY NHẤT quyết định một consumer khởi động lại từ đâu — commit trước khi xử lý xong là at-most-once (mất record khi crash), commit sau khi xử lý xong là at-least-once (xử lý lại record khi crash); auto-commit chạy theo đồng hồ, không theo tiến độ xử lý thật.',
  seed: 14,
  durationMs: 26_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [CONSUMER_AUTO, CONSUMER_MANUAL],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c-auto' },
    { at: 0, kind: 'consumer-join', consumerId: 'c-manual' },
    // Cả hai group Stable ở 5000. Record ghi NGAY SAU đó (5050, lệch khỏi lưới
    // poll 100ms từ mốc join 0) để lượt poll đầu tiên chắc chắn thấy nó là
    // 5100, không lẫn với chính tick Stable.
    { at: 5050, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'x' },
    // `c-manual` commit tường minh SAU khi `process-done` của record `x` đã
    // chắc chắn xảy ra: fetch ở 5100, `processingMs: 6000` → process-done ở
    // 11100. 11200 nằm sau đó, không trùng lưới poll của `c-manual`.
    { at: 11_200, kind: 'commit', consumerId: 'c-manual' },
    // Vài record nữa sau khi fault kết thúc (20000), để canvas không đứng im
    // suốt nửa cuối lesson và commit auto-commit tiếp theo (25000) có gì đó
    // mới để phản ánh.
    { at: 21_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'y' },
  ],
  failures,
  narrative: [
    {
      at: 0,
      title: 'Committed offset quyết định chỗ khởi động lại',
      body:
        '`c-auto` bật `enableAutoCommit: true` (mặc định thật của Kafka, 5000ms một lần) — `c-manual` tắt hẳn, tự gọi `commit` tường minh sau mỗi lần xử lý. Cả hai đọc cùng một topic nhưng KHÔNG cùng group, nên không hề tranh nhau partition; khác biệt quan sát được ở bài này chỉ tới từ thời điểm mỗi bên commit.',
      highlight: ['c-auto', 'c-manual'],
    },
    {
      at: 5100,
      title: 'Fetch xong không có nghĩa là xử lý xong',
      body:
        'Record `x` vừa được cả hai consumer fetch — `position` của cả hai nhảy lên 1 ngay lập tức. Nhưng `processingMs: 6000` nghĩa là phải tới 11100 việc "xử lý" record này mới thật sự hoàn tất — giữa hai mốc đó, record đã được ĐỌC nhưng chưa được XỬ LÝ xong.',
      highlight: ['c-auto', 'c-manual', 'orders-0'],
    },
    {
      at: 10_000,
      title: 'auto-commit: commit trước khi xử lý xong (at-most-once)',
      body:
        'Đồng hồ auto-commit của `c-auto` tích đúng giờ (5000ms một lần kể từ lúc join) — bất kể record `x` đã xử lý xong hay chưa. Tại 10000, committed offset nhảy lên 1, NHƯNG process-done của record đó chỉ xảy ra ở 11100 — committed offset đã vượt qua một record CHƯA xử lý xong. Nếu `c-auto` crash thật ngay lúc này, một client khởi động lại sẽ đọc tiếp từ offset 1, bỏ qua hẳn record `x` — mất record, đây chính là rủi ro at-most-once.',
      highlight: ['c-auto'],
    },
    {
      at: 11_200,
      title: 'manual: commit sau khi xử lý xong (at-least-once)',
      body:
        '`c-manual` chỉ gọi commit ở đây — sau khi process-done của record `x` (11100) đã chắc chắn xảy ra. committed offset của nó không bao giờ vượt quá phần đã xử lý xong thật sự. Nếu crash xảy ra TRƯỚC 11200 (kể cả sau khi record đã xử lý xong), một client khởi động lại sẽ đọc lại đúng record đó lần nữa — xử lý lại, không mất, đây là at-least-once.',
      highlight: ['c-manual'],
    },
    {
      at: 12_000,
      title: 'Poll bị treo, đồng hồ auto-commit không hề hay biết',
      body:
        '`c-auto` bắt đầu bị treo xử lý 8000ms (fault `consumer-stall`, mô phỏng một callback xử lý mất quá lâu). Vòng poll của nó dừng cập nhật hoàn toàn — nhưng vòng auto-commit là một đồng hồ RIÊNG, độc lập hoàn toàn với vòng poll.',
      highlight: ['c-auto'],
    },
    {
      at: 15_000,
      title: 'auto-commit vẫn tích đúng giờ dù đang treo',
      body:
        'Tick auto-commit tiếp theo của `c-auto` vẫn nổ ra đúng 5000ms sau lần trước — commit lại chính offset 1 (không có gì mới để commit, vì poll đang treo, chưa fetch thêm được record nào). Đây là bằng chứng rõ nhất: auto-commit chạy theo ĐỒNG HỒ, không theo tiến độ xử lý thật — nó không "biết" và không quan tâm poll có đang treo hay không.',
      highlight: ['c-auto'],
    },
    {
      at: 20_100,
      title: 'Giới hạn của mô phỏng này',
      body:
        'Kafka thật không có "at-exactly-once" ở tầng commit — muốn đúng-một-lần thật sự phải tự làm xử lý idempotent (ghi có khoá trùng lặp không đổi kết quả), hoặc dùng transaction xuyên producer-consumer (bài 22). Một giới hạn khác cần nói rõ: `committedOffsets` ở đây là một field phẳng nằm ngay trên `GroupState`, không có log hay replication riêng — Kafka thật lưu commit trong một topic nội bộ tên `__consumer_offsets`, với đầy đủ cơ chế bền vững như mọi topic khác. Engine này chỉ mô phỏng đúng NGỮ NGHĨA commit/offset nhìn từ phía consumer, không mô phỏng cơ chế lưu trữ đó.',
      highlight: [],
    },
  ],
  checkpoints: [
    {
      at: 24_000,
      question: 'Một consumer commit offset của một record NGAY SAU khi fetch, TRƯỚC khi xử lý xong record đó. Nếu consumer crash giữa lúc xử lý, chuyện gì xảy ra?',
      options: [
        'Record đó chắc chắn được xử lý lại sau khi consumer khởi động lại',
        'Record đó bị bỏ qua vĩnh viễn — committed offset đã vượt qua nó, đây là rủi ro at-most-once',
        'Kafka tự phát hiện và xử lý lại record đó bất kể committed offset là bao nhiêu',
      ],
      answerIndex: 1,
      explanation:
        'committed offset là con số DUY NHẤT một client dùng để biết đọc tiếp từ đâu. Commit trước khi xử lý xong nghĩa là con số đó đã "hứa" record vừa fetch coi như xong — nếu crash xảy ra trước khi xử lý thật sự hoàn tất, record đó vĩnh viễn không được đọc lại nữa. Đây chính là at-most-once, đối lập với at-least-once (commit sau khi xử lý xong, chấp nhận có thể xử lý lại nhưng không bao giờ mất).',
    },
  ],
}
