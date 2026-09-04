import { BROKER_1, BROKER_2, BROKER_3, CONSUMER_A, PRODUCER } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// Ba broker, hai partition, replicationFactor 3 — mọi broker vừa là leader của
// một partition vừa là follower của partition kia (round-robin `createState`:
// orders-0 leader b1, replicas [b1,b2,b3]; orders-1 leader b2, replicas
// [b2,b3,b1]), nên `replica-fetch`/`isr-shrink` (Task 8) chạy thật cho cả ba
// broker ngay từ t=0 — không cần dàn dựng gì thêm để có một cụm đang replicate
// thật sự.
//
// Script chỉ ghi vào `orders-0` để giữ mọi phép đo (HW, LEO, ISR) gọn trong
// đúng một partition — narrative và test đều nói về "cái partition đang được
// quan sát", không phải cả topic.
const burstScript = Array.from({ length: 10 }, (_, i) => ({
  at: 100 + i * 50,
  kind: 'produce' as const,
  producerId: 'p1',
  topic: 'orders',
  value: `e${i + 1}`,
  partition: 0,
}))

const failures: KafkaFault[] = [
  // b3 rớt khỏi ISR ngay lập tức (Task 8: `replica-lag` chain một `shrinkIsr`
  // phản ứng cùng lượt) — `ms: 15_000` vượt xa `replicaLagTimeMaxMs` mặc định
  // (10_000ms) nên không cần chờ vòng quét định kỳ mới thấy hiệu ứng.
  { at: 10_000, kind: 'replica-lag', brokerId: BROKER_3.id, ms: 15_000 },
]

export const replicationIsr: KafkaLesson = {
  id: '17-replication-isr',
  group: 'durability',
  title: 'Replication và ISR',
  summary:
    'Follower kéo dữ liệu về từ leader, không phải leader đẩy đi; high watermark là LEO nhỏ nhất trong ISR, và consumer chỉ đọc tới đó — record vừa ghi xong mà chưa follower nào bắt kịp là bảo đảm bền, không phải lỗi.',
  seed: 17,
  durationMs: 28_000,
  topology: {
    brokers: [BROKER_1, BROKER_2, BROKER_3],
    topics: [{ name: 'orders', partitions: 2, replicationFactor: 3 }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g17', subscriptions: ['orders'], autoOffsetReset: 'earliest' }],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    ...burstScript,
    // Sau burst, ghi thưa lại — đủ hoạt động để follower luôn có việc bắt kịp,
    // không dồn dập như đoạn đầu.
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e11', partition: 0 },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e12', partition: 0 },
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e13', partition: 0 },
    { at: 8000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e14', partition: 0 },
    // b3 rớt khỏi ISR ở 10_000 (xem failures) — vài lần ghi sau đó để narrative
    // có gì đó xảy ra trong lúc ISR chỉ còn hai thành viên.
    { at: 12_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e15', partition: 0 },
    { at: 15_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e16', partition: 0 },
    { at: 18_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e17', partition: 0 },
  ],
  narrative: [
    {
      at: 0,
      title: 'Follower kéo, leader không đẩy',
      body:
        'Mỗi partition có một leader và các follower — nhưng follower chủ động **kéo** dữ liệu về (`replica-fetch`, định kỳ, không phải mỗi lần leader ghi mới đẩy đi). `orders-0` do `b1` làm leader, `b2`/`b3` là follower; `orders-1` thì ngược lại, `b2` làm leader còn `b1`/`b3` là follower — mỗi broker trong cụm này vừa lãnh đạo một phần vừa theo sau phần khác.',
      highlight: ['b1', 'b2', 'b3', 'orders-0', 'orders-1'],
    },
    {
      at: 100,
      title: 'ISR: tập replica đang thật sự bắt kịp',
      body:
        'ISR (in-sync replicas) không phải danh sách tĩnh "các bản sao của partition" — nó là tập những replica đã fetch đủ gần đây để coi là bắt kịp. Một replica online nhưng fetch chậm quá hạn vẫn có thể bị loại khỏi ISR, dù nó không hề "chết".',
      highlight: ['orders-0'],
    },
    {
      at: 550,
      title: 'High watermark: LEO nhỏ nhất trong ISR',
      body:
        'Leader vừa ghi mười record liên tiếp rất nhanh (mỗi 50ms một record) — LEO (log end offset) của nó đã lên tới 10. Nhưng high watermark — offset cao nhất consumer được phép đọc — là LEO **nhỏ nhất trong ISR**, và follower fetch mỗi 200ms một lần thì không thể theo kịp nhịp ghi đó ngay lập tức. Record vừa ghi mà chưa đọc được không phải lỗi — đó chính là bảo đảm bền: chỉ khi đủ ISR đã có nó, high watermark mới nhích qua, và chỉ khi đó consumer mới thấy.',
      highlight: ['orders-0', 'c1'],
    },
    {
      at: 10_000,
      title: 'Replica chậm rớt khỏi ISR — high watermark có thể nhích lên ngay',
      body:
        '`b3` vừa lag quá hạn (`replica.lag.time.max.ms`) và bị loại khỏi ISR. Phản trực giác nhưng đúng theo định nghĩa: high watermark là LEO nhỏ nhất **trong ISR** — loại một replica đang kéo tụt con số đó ra khỏi ISR có thể khiến high watermark nhích lên ngay lập tức, dù không có ghi mới nào xảy ra. ISR co lại không phải luôn là tin xấu cho throughput đọc.',
      highlight: ['b3', 'orders-0'],
    },
  ],
  checkpoints: [
    {
      at: 24_000,
      question: 'Một record vừa được leader ghi vào log nhưng chưa follower nào trong ISR fetch tới nó. Điều gì đúng?',
      options: [
        'Đó là lỗi — leader phải đẩy record đi ngay khi ghi xong, không được để follower tự kéo chậm',
        'Record đã tồn tại trong log của leader nhưng chưa nằm dưới high watermark, nên chưa consumer nào đọc được — đây là bảo đảm bền hoạt động đúng, không phải sự cố',
        'Consumer vẫn đọc được record đó ngay vì nó đã ở trong log',
      ],
      answerIndex: 1,
      explanation:
        'High watermark là LEO nhỏ nhất trong ISR, và `readFrom` không bao giờ trả record ở offset từ high watermark trở lên. Một record vừa ghi mà chưa đủ ISR bắt kịp thì vẫn "chưa tồn tại" với consumer — đúng ý nghĩa của durability: chỉ công nhận đã ghi khi đủ bản sao đã có nó.',
    },
  ],
}
