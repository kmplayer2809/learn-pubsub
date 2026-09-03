import { BROKER_1, PRODUCER } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// Một consumer duy nhất, lặp đi lặp lại đúng một vòng: join → được assign →
// "xử lý" quá lâu (mô phỏng bằng fault `consumer-stall`, xem why-comment ở
// `ConsumerRuntime.stalledUntil`, `engine/types.ts` — chính comment đó gọi tên
// bài này) → bị đá vì vượt `maxPollIntervalMs` dù heartbeat vẫn đều → tự nhận
// ra và join lại → lặp lại từ đầu. `rebalanceTimeoutMs: 1_500` tách biệt hẳn
// khỏi `maxPollIntervalMs: 6_000` (không rơi về default "bằng maxPollIntervalMs"
// như coordinator vẫn làm khi bỏ trống) — CHỈ để mỗi vòng join-lại chốt
// `Stable` nhanh, giữ toàn bộ vòng lặp vừa đủ trong 30 giây; ngưỡng bị đá thật
// sự dạy trong bài (6000ms) không hề đổi.
//
// Bốn mốc join/stall dưới đây không phải số tròn chọn bừa — mỗi mốc được suy
// ra bằng cách cộng dồn đúng cơ chế thật của engine (đã verify bằng một kịch
// bản chạy thử tách rời, xoá trước khi commit):
//   - join tại J → Stable tại J+1500 (rebalanceTimeoutMs).
//   - lưới poll bắt đầu từ J, mỗi 100ms; fault đặt NGAY SAU một mốc lưới ngay
//     sau Stable (vd Stable=1500 → fault tại 1650, mốc lưới liền trước là 1600)
//     để "lastPollAt đóng băng ở" luôn là mốc lưới đó, không phụ thuộc thứ tự
//     xử lý event trùng `at`.
//   - bị đá khi `now - lastPollAt > 6000` — do vòng quét `member-timeout` chỉ
//     chạy mỗi 1000ms và tự khởi động lại (neo vào mốc join J+1000) mỗi khi
//     group rỗng rồi có người join lại, mốc bị đá thật sự là tick 1000ms ĐẦU
//     TIÊN sau ngưỡng 6000, không phải đúng ngưỡng.
const CONSUMER_LOOP = Object.freeze({
  id: 'c1',
  label: 'Consumer (kẹt xử lý)',
  position: { x: 700, y: 220 },
  groupId: 'g16',
  subscriptions: ['orders'],
  autoOffsetReset: 'latest' as const,
  enableAutoCommit: false,
  maxPollIntervalMs: 6_000,
  processingMs: 9_000,
  sessionTimeoutMs: 10_000,
  rebalanceTimeoutMs: 1_500,
})

const failures: KafkaFault[] = [
  { at: 1_650, kind: 'consumer-stall', consumerId: 'c1', durationMs: 9_000 },
  { at: 9_675, kind: 'consumer-stall', consumerId: 'c1', durationMs: 9_000 },
  { at: 17_625, kind: 'consumer-stall', consumerId: 'c1', durationMs: 9_000 },
  { at: 25_675, kind: 'consumer-stall', consumerId: 'c1', durationMs: 9_000 },
]

export const maxPollInterval: KafkaLesson = {
  id: '16-max-poll-interval',
  group: 'consumer',
  title: 'max.poll.interval.ms',
  summary:
    'heartbeat và poll là hai đồng hồ khác nhau — heartbeat chạy đều trên một vòng riêng dù vòng xử lý đã treo, và vượt `max.poll.interval.ms` là bị đá khỏi group dù heartbeat hoàn hảo; xử lý vẫn chậm sau khi join lại thì lại bị đá — một vòng lặp rebalance khiến group không tiến được bước nào.',
  seed: 16,
  durationMs: 30_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 2, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [CONSUMER_LOOP],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    // Bị đá ở 8000 (xem why-comment đầu file) — client tự nhận ra và join lại
    // ngay sau đó.
    { at: 8_050, kind: 'consumer-join', consumerId: 'c1' },
    // Bị đá lần hai ở 16050.
    { at: 16_100, kind: 'consumer-join', consumerId: 'c1' },
    // Bị đá lần ba ở 24100.
    { at: 24_150, kind: 'consumer-join', consumerId: 'c1' },
  ],
  failures,
  narrative: [
    {
      at: 0,
      title: 'Hai đồng hồ khác nhau: heartbeat và poll',
      body:
        '`c1` join group `g16` với `maxPollIntervalMs: 6000` và `processingMs: 9000` — xử lý một lô record được mô phỏng mất LÂU HƠN cả ngưỡng `max.poll.interval.ms` cho phép giữa hai lần poll. Heartbeat chạy trên một vòng lặp hoàn toàn riêng, cố định mỗi 3000ms, không phụ thuộc gì vào vòng poll/xử lý.',
      highlight: ['c1'],
    },
    {
      at: 1600,
      title: 'Được assign, rồi bắt đầu "xử lý"',
      body:
        'Group vừa về `Stable`, `c1` nhận được assignment thật. Ngay sau đó, một cơn treo xử lý bắt đầu (fault `consumer-stall`, dài 9000ms) — mô phỏng callback xử lý một record chạy quá lâu, đúng như `processingMs: 9000` đã khai báo.',
      highlight: ['c1'],
    },
    {
      at: 4000,
      title: 'Heartbeat vẫn đều trong khi vòng xử lý đã treo',
      body:
        'Dù `c1` đang "kẹt" xử lý, heartbeat của nó vẫn tới coordinator đúng nhịp 3000ms — thread heartbeat không hề biết vòng xử lý chính đã treo. Từ phía coordinator, `c1` trông vẫn "sống" hoàn toàn bình thường.',
      highlight: ['c1'],
    },
    {
      at: 8000,
      title: 'Vượt max.poll.interval.ms là bị đá, dù heartbeat hoàn hảo',
      body:
        'Vòng quét `member-timeout` phát hiện `c1` đã hơn 6000ms không hề poll — heartbeat đều đặn không cứu được nó: `sessionTimeoutMs` và `maxPollIntervalMs` là hai điều kiện đá member HOÀN TOÀN TÁCH BIỆT, chỉ cần vượt MỘT trong hai. `c1` bị loại khỏi group; nó không hề biết điều này cho tới lần heartbeat kế tiếp.',
      highlight: ['c1'],
    },
    {
      at: 8100,
      title: 'Join lại — nhưng xử lý vẫn chậm y như cũ',
      body:
        '`c1` tự nhận ra (qua heartbeat bị từ chối) và join lại group. Rebalance chốt xong, nó lại được assign — nhưng cấu hình xử lý không hề đổi, nên vòng treo 9000ms lại bắt đầu ngay khi có gì để "xử lý".',
      highlight: ['c1'],
    },
    {
      at: 16_050,
      title: 'Vòng lặp rebalance: group không tiến được bước nào',
      body:
        'Bị đá lần thứ hai. Đây chính là cái bẫy `max.poll.interval.ms` dạy: join lại, được assign, xử lý chậm, bị đá — rồi lặp lại, không có bước nào trong chuỗi này thật sự "tiến" được: `c1` chưa từng đọc xong một lô record trọn vẹn trước khi bị đá lần kế tiếp. `metrics.rebalances` cứ thế tăng lên mà group không đạt được gì.',
      highlight: ['c1'],
    },
    {
      at: 24_100,
      title: 'Lối ra: không phải tăng session timeout',
      body:
        'Bị đá lần thứ ba. Tăng `sessionTimeoutMs` không giúp được gì — heartbeat chưa từng là vấn đề. Lối ra thật sự: giảm `max.poll.records` (mỗi lô ít record hơn, xử lý nhanh hơn giữa hai lần poll), tăng `max.poll.interval.ms` (nếu xử lý vốn cần lâu và không thể rút ngắn), hoặc đẩy phần việc nặng sang một thread khác rồi gọi `poll()` đều đặn trên thread chính.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 28_000,
      question: 'Một consumer heartbeat đều đặn, không hề mất kết nối, nhưng vẫn liên tục bị đá khỏi group. Nguyên nhân khả dĩ nhất là gì?',
      options: [
        'sessionTimeoutMs đặt quá thấp so với độ trễ mạng',
        'Thời gian xử lý mỗi lô record (giữa hai lần gọi poll()) vượt quá max.poll.interval.ms, dù thread heartbeat vẫn chạy bình thường',
        'Broker đang gặp sự cố, không liên quan gì tới cấu hình consumer',
      ],
      answerIndex: 1,
      explanation:
        'heartbeat và poll là hai vòng lặp tách biệt trong client Kafka thật. Một callback xử lý chạy quá lâu chỉ chặn vòng poll, không chặn heartbeat — nên consumer "trông vẫn sống" với coordinator trong khi thực chất đã vượt quá max.poll.interval.ms, và bị đá vì lý do đó, không phải vì mất kết nối.',
    },
  ],
}
