import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một broker, một partition — retention không cần replication để dạy, và giữ
// mọi phép đo (`logStartOffset`, segment) gọn trong đúng một chỗ.
//
// `segmentBytes: 300` nhỏ CHỦ Ý: mỗi record (key null, value ~3 ký tự) tốn
// khoảng 43 byte (`estimateBytes`) — một segment chứa khoảng sáu, bảy record
// rồi seal, để retention (`retentionMs: 8000`) có nhiều segment để xoá dần
// trong 30 giây của bài học, không phải một segment khổng lồ duy nhất không
// bao giờ bị đụng tới.
const PRODUCE_EVERY_MS = 500
const PRODUCE_LAST_AT = 24_500
const produceScript = Array.from({ length: Math.floor(PRODUCE_LAST_AT / PRODUCE_EVERY_MS) }, (_, i) => ({
  at: PRODUCE_EVERY_MS * (i + 1),
  kind: 'produce' as const,
  producerId: 'p1',
  topic: 'orders',
  value: `r${i + 1}`,
}))

// `rebalanceTimeoutMs` riêng (500ms), tách khỏi `maxPollIntervalMs` mặc định
// (5000ms) — group MỚI này chỉ có một member, chốt Stable nhanh để lần fetch
// đầu tiên của `c1` (join muộn, t=25000) còn kịp nằm trong khung 30 giây của
// bài học, thay vì đợi hết 5000ms mới có assignment thật.
const LATE_CONSUMER = Object.freeze({ ...CONSUMER_A, rebalanceTimeoutMs: 500 })

export const retention: KafkaLesson = {
  id: '20-retention',
  group: 'durability',
  title: 'Retention và segment',
  summary:
    'Log không giữ mọi thứ mãi mãi — retention xoá theo segment chứ không theo từng record, và chỉ xoá segment đã sealed; `logStartOffset` nhảy lên khi một segment bị xoá, và consumer chậm hơn retention phải reset theo `auto.offset.reset`, mất dữ liệu ở phía nó chứ không phải phía broker.',
  seed: 20,
  durationMs: 30_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1, config: { segmentBytes: 300, retentionMs: 8000 } }],
    producers: [PRODUCER],
    consumers: [{ ...LATE_CONSUMER, groupId: 'g20', subscriptions: ['orders'], autoOffsetReset: 'earliest' }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [...produceScript, { at: 25_000, kind: 'consumer-join', consumerId: 'c1' }],
  narrative: [
    {
      at: 500,
      title: 'Log không giữ mọi thứ mãi mãi',
      body:
        'Producer ghi liên tục mỗi 500ms. `retention.ms: 8000` nghĩa là log này không định giữ dữ liệu quá tám giây — retention quyết định giữ bao lâu, không phải giữ bao nhiêu.',
      highlight: ['orders-0', 'p1'],
    },
    {
      at: 2500,
      title: 'Xoá theo segment, không theo từng record',
      body:
        'Log vật lý được chia thành các segment (`segment.bytes: 300` ở đây — nhỏ để nhiều segment kịp hình thành trong bài học này). Retention xoá NGUYÊN một segment một lúc, không rà từng record để xem cái nào quá tám giây — đây là lý do retention là một hạt thô, không chính xác tới từng mili giây.',
      highlight: ['orders-0'],
    },
    {
      at: 9000,
      title: 'Segment đầu tiên đủ tuổi — nhưng đang mở thì không bị đụng',
      body:
        'Segment đang MỞ (nơi record mới nhất đang được ghi vào) không bao giờ bị xoá, dù nó có "già" cỡ nào — chỉ segment đã sealed (đã đóng, không còn nhận ghi mới) mới nằm trong diện xét retention.',
      highlight: ['orders-0'],
    },
    {
      at: 12_000,
      title: '`logStartOffset` nhảy lên khi segment bị xoá',
      body:
        'Segment cũ nhất vừa bị xoá — `logStartOffset` nhảy lên đúng offset đầu của segment còn lại sớm nhất. Mọi offset dưới `logStartOffset` vĩnh viễn không đọc được nữa, kể cả khi trước đó đã từng đọc được.',
      highlight: ['orders-0'],
    },
    {
      at: 25_000,
      title: 'Consumer join muộn: `earliest` không còn nghĩa là offset 0',
      body:
        '`c1` vừa join, `auto.offset.reset: \'earliest\'`. Nhưng offset 0 đã bị retention xoá từ lâu — "earliest" giờ được giải nghĩa lại thành `logStartOffset` hiện tại, phần cũ nhất VẪN CÒN, không phải phần cũ nhất TỪNG CÓ. Đây là mất dữ liệu ở phía consumer (nó không bao giờ đọc được những record đã bị retention xoá), không phải một lỗi của broker.',
      highlight: ['c1', 'orders-0'],
    },
  ],
  checkpoints: [
    {
      at: 14_000,
      question: 'Segment cũ nhất vừa bị xoá. `logStartOffset` ra sao?',
      options: [
        'Nhảy lên offset đầu của segment còn lại sớm nhất',
        'Giữ nguyên ở 0',
        'Đặt lại bằng high watermark',
      ],
      answerIndex: 0,
      explanation:
        'Mọi offset dưới `logStartOffset` vĩnh viễn không đọc được nữa, kể cả khi trước đó đã từng đọc được.',
    },
    {
      at: 27_000,
      question: 'Một consumer commit offset 5 rồi ngừng hoạt động rất lâu. Khi quay lại, offset 5 đã bị retention xoá mất. Điều gì xảy ra?',
      options: [
        'Broker tự động giữ lại offset 5 vì đã có consumer commit tới đó, bất kể retention',
        'Consumer nhận được thực tế là offset 5 không còn đọc được nữa, và phải xử lý theo `auto.offset.reset` — reset lên `logStartOffset` hiện tại (mất phần dữ liệu ở giữa) hoặc lên high watermark tuỳ cấu hình',
        'Simulation dừng lại và báo lỗi, vì đây là một trạng thái không hợp lệ',
      ],
      answerIndex: 1,
      explanation:
        'Committed offset không hề "khoá" retention lại — broker vẫn xoá segment cũ theo đúng lịch của nó bất kể có consumer nào từng commit tới offset đó hay không. Một consumer quay lại sau khi phần log đó đã bị xoá phải chấp nhận reset theo `auto.offset.reset`, đúng thứ lesson này minh hoạ với `c1` join muộn.',
    },
    {
      at: 30_000,
      question:
        'Tổng kết: `retention.ms` là 7 ngày nhưng `segment.ms` để mặc định 7 ngày. Vì sao dữ liệu cũ hơn 7 ngày vẫn nằm đó?',
      options: [
        'Segment đang mở không bị xoá — nó chỉ đóng sau 7 ngày, rồi mới bắt đầu đếm tuổi để xét retention',
        'Retention chỉ chạy khi đĩa đầy',
        '`retention.ms` đo từ lần đọc gần nhất, chưa phải từ lúc ghi',
      ],
      answerIndex: 0,
      explanation:
        'Retention xét theo segment đã đóng, nên tuổi thật của dữ liệu xấp xỉ `segment.ms` cộng `retention.ms` — ở đây là tới 14 ngày. Muốn xoá đúng hạn thì `segment.ms` (hoặc `segment.bytes`) phải nhỏ hơn hẳn `retention.ms`. Đây là lý do rất thường gặp khiến đĩa phình gấp đôi dự tính.',
    },
  ],
  quiz: [
    {
      question: 'Retention xoá dữ liệu theo đơn vị nào?',
      options: ['Nguyên một segment', 'Từng record một', 'Từng partition', 'Từng batch của producer'],
      answerIndex: 0,
      explanation:
        'Vì vậy retention là một hạt thô, không chính xác tới từng mili giây.',
    },
    {
      question: 'Segment đang mở có bị retention xoá không?',
      options: [
        'Không — chỉ segment đã đóng mới nằm trong diện xét',
        'Có, nếu nó đủ tuổi',
        'Có, nếu đĩa đã đầy',
        'Có, sau mỗi lần rebalance',
      ],
      answerIndex: 0,
      explanation:
        'Đây là lý do tuổi thật của dữ liệu xấp xỉ `segment.ms` cộng `retention.ms`.',
    },
    {
      question: 'Committed offset có giữ được một segment khỏi bị xoá không?',
      options: [
        'Không — broker xoá theo lịch của nó, bất kể có ai commit tới đó hay chưa',
        'Có, segment được giữ tới khi mọi group đọc qua',
        'Có, nếu group vẫn còn member sống',
        'Có, trong vòng bảy ngày kể từ lần commit',
      ],
      answerIndex: 0,
      explanation:
        'Consumer quay lại sau khi phần log đó đã bị xoá phải chấp nhận reset theo `auto.offset.reset`.',
    },
    {
      question: '`earliest` nghĩa là gì với một log đã bị retention cắt bớt?',
      options: [
        '`logStartOffset` hiện tại — phần cũ nhất vẫn còn, không phải phần cũ nhất từng có',
        'Luôn là offset 0',
        'Offset đã commit gần nhất',
        'High watermark trừ đi một',
      ],
      answerIndex: 0,
      explanation:
        'Consumer join muộn vì vậy không bao giờ đọc được phần đã bị xoá — mất dữ liệu ở phía consumer, không phải một lỗi của broker.',
    },
  ],
}
