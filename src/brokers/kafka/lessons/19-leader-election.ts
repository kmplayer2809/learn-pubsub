import { BROKER_1, BROKER_2, BROKER_3 } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// `b3` fetch chậm hẳn (16s một lần, so với mặc định ~200ms của b1/b2) — CHỦ Ý,
// không phải một fault: đây là cách duy nhất dựng được "một replica online
// nhưng tụt lại xa phía sau" mà không cần đưa nó offline rồi lại online đúng
// lúc (đua với vòng `replica-fetch` độc lập của chính nó, việc không thể canh
// đúng bằng script). Với `replicaFetchEveryMs: 16_000` > mặc định
// `replicaLagTimeMaxMs` (10_000), `b3` CHẮC CHẮN bị `shrinkIsr` loại khỏi ISR
// trước khi lần fetch thật đầu tiên của nó (~16_000ms) kịp diễn ra — và sau đó
// production tiếp tục vượt xa nó, nên nó không bao giờ đủ điều kiện quay lại
// ISR (`expandIsr` đòi `replicaState.leo >= partition.leo` NGAY LÚC XÉT).
const BROKER_3_SLOW = Object.freeze({ ...BROKER_3, replicaFetchEveryMs: 13_000 })

const PRODUCER_ALL = Object.freeze({ id: 'p1', label: "Producer acks='all'", position: { x: 40, y: 220 }, acks: 'all' as const })

// Ghi liên tục mỗi giây từ 1000 tới 24000 — 24 record (offset 0-23). Khoảng
// cách production luôn lớn hơn hẳn jitter (tối đa 50ms) của mọi vòng
// replica-fetch, nên margin trong toàn bộ kịch bản dưới đây không phụ thuộc
// giá trị jitter cụ thể rút ra ở seed 19.
const produceScript = Array.from({ length: 24 }, (_, i) => ({
  at: 1000 * (i + 1),
  kind: 'produce' as const,
  producerId: 'p1',
  topic: 'orders',
  value: `e${i + 1}`,
  partition: 0,
}))

const failures: KafkaFault[] = [
  // Chết lần một: b1 (leader gốc), giữa hai lần ghi (7000 và 8000) — cố tình
  // không trùng đúng một mốc produce, để "record nào đã vào log trước khi
  // leader chết" không phụ thuộc thứ tự xử lý hai event cùng một `at`. ISR lúc
  // này còn đủ (b2, b3 — b3 chưa kịp fetch lần đầu tiên nên vẫn coi là "chưa
  // quá hạn" ở t=7500, xem why-comment BROKER_3_SLOW) — bầu sạch, không mất
  // record nào.
  { at: 7500, kind: 'broker-down', brokerId: BROKER_1.id },
  // Chết lần hai: b2 (leader mới từ lần bầu trên), sau khi mọi record đã
  // dừng ghi (script kết thúc ở t=24000). ISR lúc này đã co về một mình b2
  // (b1 bị dọn khỏi ISR ngay từ lần bầu sạch t=7500; b3 bị `shrinkIsr` loại vì
  // lag trước mốc này rất nhiều — xem why-comment BROKER_3_SLOW) — không còn
  // ứng viên sạch.
  { at: 25_000, kind: 'broker-down', brokerId: BROKER_2.id },
]

export const leaderElection: KafkaLesson = {
  id: '19-leader-election',
  group: 'durability',
  title: 'Leader election',
  summary:
    'Controller phát hiện leader chết và bầu lại từ ISR — bầu từ ISR không mất record vì mọi thành viên đã có tới high watermark; ISR rỗng là ngã ba giữa chờ (mất tính sẵn sàng) và bầu bừa (mất dữ liệu), và Kafka mặc định chọn chờ.',
  seed: 19,
  durationMs: 30_000,
  topology: {
    brokers: [BROKER_1, BROKER_2, BROKER_3_SLOW],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 3, config: { uncleanLeaderElection: true } }],
    producers: [PRODUCER_ALL],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: produceScript,
  narrative: [
    {
      at: 1000,
      title: 'Ba broker, một partition, cùng theo dõi một leader',
      body:
        '`orders-0` có leader `b1`, hai follower `b2`/`b3`. Producer ghi `acks=\'all\'` mỗi giây — mỗi lần ghi phải chờ ISR xác nhận trước khi coi là xong.',
      highlight: ['b1', 'b2', 'b3', 'orders-0'],
    },
    {
      at: 7500,
      title: 'Leader chết — controller bầu lại NGAY từ ISR',
      body:
        '`b1` vừa chết. Controller phát hiện và bầu lại ngay lập tức, không đợi một vòng quét định kỳ. `leaderEpoch` tăng thêm một — đây là cách client cũ (còn giữ metadata trỏ tới `b1`) biết thông tin mình đang cầm đã lỗi thời và phải hỏi lại. Vì cả `b2` lẫn `b3` vẫn còn trong ISR lúc này, ứng viên được chọn (`b2`, đứng trước trong danh sách replica) đã có đủ mọi record tới high watermark — bầu từ ISR không bao giờ làm mất một record nào consumer từng thấy được.',
      highlight: ['b1', 'b2', 'orders-0'],
    },
    {
      at: 16_000,
      title: 'Replica chậm âm thầm rớt khỏi ISR',
      body:
        '`b3` fetch quá thưa (16 giây một lần) — chậm hơn hẳn ngưỡng `replica.lag.time.max.ms` mặc định (10 giây), nên nó đã bị loại khỏi ISR từ lâu trước khi có cơ hội tự bắt kịp. Nó vẫn `online`, vẫn là một replica hợp lệ về mặt cấu hình — chỉ là không còn được tính là "đang bắt kịp" nữa.',
      highlight: ['b3', 'orders-0'],
    },
    {
      at: 25_000,
      title: 'ISR rỗng: ngã ba giữa chờ và bầu bừa',
      body:
        '`b2` — leader hiện tại — vừa chết theo. ISR lúc này chỉ còn mỗi `b2`, nên không còn ứng viên sạch nào cả — đây chính là ngã ba: chờ (mất tính sẵn sàng, không ai ghi được cho tới khi `b1`/`b2` sống lại) hay bầu bừa từ một replica NGOÀI ISR (mất dữ liệu, vì replica đó chưa chắc đã có mọi record). Topic này bật `uncleanLeaderElection`, nên hệ thống chọn bầu bừa: `b3` — replica online duy nhất còn lại — lên làm leader mới, dù nó đang tụt lại rất xa phía sau. Log bị cắt về đúng chỗ `b3` có, và mọi record sau đó — kể cả những record đã từng nhận `acks=\'all\'` thành công — biến mất thật sự.',
      highlight: ['b2', 'b3', 'orders-0'],
    },
  ],
  checkpoints: [
    {
      at: 28_000,
      question: 'Vì sao `unclean.leader.election.enable` mặc định là `false` kể từ Kafka 0.11?',
      options: [
        'Vì bật nó lên làm hệ thống chậm hơn đáng kể, không liên quan gì tới mất dữ liệu',
        'Vì bầu một leader ngoài ISR đổi tính sẵn sàng lấy dữ liệu — cắt log về đúng những gì replica đó có, làm biến mất cả những record producer đã được xác nhận `acks=\'all\'` thành công; mặc định tắt buộc người vận hành phải CHỦ ĐỘNG chọn đánh đổi đó, không phải nó tự xảy ra',
        'Vì ISR không bao giờ rỗng trong thực tế nên tính năng này chưa từng cần dùng tới',
      ],
      answerIndex: 1,
      explanation:
        'Bầu bừa (unclean) là đánh đổi tính sẵn sàng lấy nguy cơ mất dữ liệu — như `b3` ở bài này, log bị cắt và một record đã từng "chắc chắn thành công" theo lời hứa `acks=\'all\'` biến mất thật. Mặc định tắt (từ 0.11) buộc đây phải là một quyết định có ý thức của người vận hành, không phải hành vi ngầm định của hệ thống.',
    },
  ],
}
