import { BROKER_1 } from './types'
import type { KafkaLesson } from './types'

const PRODUCER_NO_LINGER = Object.freeze({ id: 'p1', label: 'Producer lingerMs=0', position: { x: 40, y: 100 } })
const PRODUCER_LINGER = Object.freeze({ id: 'p2', label: 'Producer lingerMs=2000', position: { x: 40, y: 340 } })

// Một broker, một partition — trọng tâm bài này là accumulator của producer,
// không phải cluster hay partitioner.
export const batchingLinger: KafkaLesson = {
  id: '07-batching-linger',
  group: 'producer',
  title: 'Batching và linger.ms',
  summary:
    'Một request mạng cho nhiều record rẻ hơn nhiều request cho từng record — `linger.ms` là thời gian producer cố tình chờ để gom, đổi độ trễ lấy thông lượng.',
  seed: 7,
  durationMs: 22_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [
      { ...PRODUCER_NO_LINGER, lingerMs: 0 },
      { ...PRODUCER_LINGER, lingerMs: 2000, batchSize: 4096 },
    ],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 500, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 1000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-2' },
    { at: 1500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    { at: 1500, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-3' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4' },
    { at: 2000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-4' },
    // `p2` mở batch mới lúc 500, hẹn flush ở 500+2000=2500 — bốn record trên
    // (500/1000/1500/2000) đều vào TRƯỚC mốc đó nên nằm chung một batch.
    { at: 2500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5' },
    { at: 2500, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-5' },
    { at: 3000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6' },
    { at: 3000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-6' },
    { at: 3500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-7' },
    { at: 3500, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-7' },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-8' },
    { at: 4000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-8' },
    // record `đơn-5` (2500) mở batch THỨ HAI của `p2` đúng lúc batch đầu flush —
    // batch mới hẹn flush ở 2500+2000=4500, gom nốt đơn-5..đơn-8.
  ],
  narrative: [
    {
      at: 500,
      title: 'Một request cho nhiều record rẻ hơn nhiều request lẻ',
      body:
        '`p1` có `lingerMs: 0` — mỗi record rời producer ngay khi enqueue, không chờ ai. `p2` có `lingerMs: 2000` và `batchSize: 4096` — nó cố tình chờ để gom nhiều record vào một lần ghi. Cả hai producer nhận đúng cùng tám record, cùng thời điểm.',
      highlight: ['p1', 'p2'],
    },
    {
      at: 2050,
      title: '`lingerMs: 0` cho độ trễ từng record thấp nhất',
      body:
        '`p1` flush ngay sau mỗi record — đến giờ nó đã gửi bốn batch riêng, mỗi batch một record, và đã nhận đủ bốn phản hồi OK. Không record nào phải chờ record khác.',
      highlight: ['p1', 'orders-0'],
    },
    {
      at: 2550,
      title: 'Hết `lingerMs` mới flush — bốn record nhỏ chưa hề chạm `batch.size`',
      body:
        '`p2` gom bốn record đầu (500–2000) vào một batch, flush đúng lúc hết `lingerMs` ở t=2500 — record `đơn-1` phải chờ tới tận lúc này mới được ghi, độ trễ cao hơn hẳn `p1`. Bốn record này còn rất xa mới chạm `batchSize: 4096`; nếu batch đầy trước khi hết `lingerMs`, `batch.size` sẽ là trần buộc gửi ngay, không cần chờ hết giờ — nhưng đó không phải điều xảy ra trong kịch bản này. Ngay `đơn-5` (2500) lại mở một batch MỚI, vì batch cũ vừa đóng đúng lúc nó tới.',
      highlight: ['p2', 'orders-0'],
    },
    {
      at: 4550,
      title: 'Tổng số batch giảm hẳn, đổi lấy độ trễ trung bình cao hơn',
      body:
        'Kết thúc kịch bản: `p1` đã gửi tám batch (một record mỗi batch), `p2` chỉ gửi hai batch (bốn record mỗi batch). Cùng tám record, ít batch hơn nghĩa là ít round-trip mạng hơn — đây là đánh đổi latency lấy throughput, không phải một tuỳ chọn "bật cho nhanh": record đầu của mỗi batch ở `p2` luôn phải chờ lâu hơn hẳn cùng record đó ở `p1`.',
      highlight: ['p1', 'p2', 'orders-0'],
    },
  ],
  checkpoints: [
    {
      at: 18_000,
      question: 'Giữa hai producer cùng ghi tám record, `p1` (`lingerMs: 0`) và `p2` (`lingerMs: 2000`), điều gì đúng?',
      options: [
        '`p1` gửi ít batch hơn `p2` vì flush ngay lập tức luôn gom được nhiều record hơn',
        '`p1` gửi tám batch (mỗi record một batch, độ trễ thấp), `p2` gửi hai batch (bốn record mỗi batch, độ trễ trung bình cao hơn nhưng ít round-trip hơn)',
        'Cả hai luôn gửi cùng số batch vì `batchSize` mặc định giống nhau',
      ],
      answerIndex: 1,
      explanation:
        '`lingerMs: 0` khiến mỗi record flush ngay khi enqueue — không có gì để gom, nên tám record thành tám batch. `lingerMs: 2000` khiến producer cố tình chờ, gom được bốn record một batch trước khi hết giờ — tổng batch giảm còn hai, đổi lại record đầu của mỗi batch phải chờ lâu hơn mới được ghi.',
    },
  ],
}
