import { BROKER_1 } from './types'
import type { KafkaFault, KafkaLesson } from './types'

const PRODUCER_UNSAFE = Object.freeze({ id: 'p1', label: 'maxInFlight=5, không idempotent', position: { x: 40, y: 40 } })
const PRODUCER_IDEMPOTENT = Object.freeze({ id: 'p2', label: 'maxInFlight=5, idempotent', position: { x: 40, y: 240 } })
const PRODUCER_SERIAL = Object.freeze({ id: 'p3', label: 'maxInFlight=1', position: { x: 40, y: 440 } })

// Một `produce-error` riêng cho mỗi producer, cùng `at`, cùng `times: 1` — ba
// producer nhận ĐÚNG một kịch bản thất bại giống hệt nhau ở lần gửi đầu tiên,
// chỉ khác cấu hình. Ruling controller task 12 giữ `produce-error` (không đổi
// sang `ack-lost`) cho bài này: chủ đề ở đây là THỨ TỰ, và một record bị từ
// chối TRƯỚC khi append rồi gửi lại muộn đúng là thứ tạo ra thứ tự append lệch
// — không cần một record đã nằm trong log mới "mất thứ tự" được.
const failures: KafkaFault[] = [
  { at: 1000, kind: 'produce-error', producerId: 'p1', times: 1 },
  { at: 1000, kind: 'produce-error', producerId: 'p2', times: 1 },
  { at: 1000, kind: 'produce-error', producerId: 'p3', times: 1 },
]

// Một broker, một partition — thứ tự chỉ có ý nghĩa trong phạm vi MỘT partition,
// nên không cần nhiều partition chen vào câu chuyện. Cả ba producer ghi vào
// CÙNG partition đó, nên mỗi giá trị được đặt tiền tố theo producer
// (`p1-rec-1`…) — không phải vì narrative cần, mà vì log dùng chung một mảng
// và giá trị trùng tên giữa ba producer sẽ không còn cách nào phân biệt được
// record nào thuộc về ai chỉ bằng cách đọc lại log.
export const orderingRetries: KafkaLesson = {
  id: '10-ordering-retries',
  group: 'producer',
  title: 'Thứ tự khi có retry',
  summary:
    'Với `max.in.flight > 1`, một record hỏng và phải gửi lại có thể tới log SAU những record gửi sau nó — hai cách chặn là giới hạn `max.in.flight = 1` hoặc bật idempotence để broker tự sắp lại theo sequence.',
  seed: 10,
  durationMs: 24_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [
      { ...PRODUCER_UNSAFE, idempotent: false, retries: 3, maxInFlight: 5, lingerMs: 0 },
      { ...PRODUCER_IDEMPOTENT, idempotent: true, retries: 3, maxInFlight: 5, lingerMs: 0 },
      { ...PRODUCER_SERIAL, idempotent: false, retries: 3, maxInFlight: 1, lingerMs: 0 },
    ],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'p1-rec-1' },
    { at: 1000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'p2-rec-1' },
    { at: 1000, kind: 'produce', producerId: 'p3', topic: 'orders', value: 'p3-rec-1' },
    { at: 1050, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'p1-rec-2' },
    { at: 1050, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'p2-rec-2' },
    { at: 1050, kind: 'produce', producerId: 'p3', topic: 'orders', value: 'p3-rec-2' },
    { at: 1100, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'p1-rec-3' },
    { at: 1100, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'p2-rec-3' },
    { at: 1100, kind: 'produce', producerId: 'p3', topic: 'orders', value: 'p3-rec-3' },
  ],
  narrative: [
    {
      at: 1000,
      title: '`max.in.flight` cho phép nhiều request bay song song',
      body:
        '`max.in.flight.requests.per.connection = 5` (mặc định Kafka thật) nghĩa là producer không cần chờ request trước có phản hồi mới gửi request tiếp theo — tới năm request có thể cùng lúc trên đường. Record thứ nhất của `p1` hỏng ngay lần gửi đầu (fault) và phải gửi lại, trong khi record thứ hai và thứ ba (gửi ngay sau, không dính fault) vẫn tự do bay tiếp vì `maxInFlight: 5` không buộc chúng phải chờ record thứ nhất.',
      highlight: ['p1'],
    },
    {
      at: 1200,
      title: 'Không idempotent: log ghi theo thứ tự TỚI, không theo thứ tự GỬI',
      body:
        '`p1-rec-2` và `p1-rec-3` tới broker trước và được append ngay; `p1-rec-1` gửi lại sau, đứng cuối. Phần log của `p1` kết thúc với thứ tự `p1-rec-2, p1-rec-3, p1-rec-1` — lệch hẳn thứ tự đã gọi `produce()`, và không có gì trong bản thân broker phát hiện ra chuyện này vì mỗi record không idempotent không mang thông tin gì về vị trí đúng của nó.',
      highlight: ['p1', 'orders-0'],
    },
    {
      at: 1350,
      title: 'Idempotence: broker từ chối record đến sớm hơn phiên nó, tự sắp lại đúng thứ tự',
      body:
        '`p2` gắn sequence 0/1/2 cho `p2-rec-1/2/3` ngay từ lúc enqueue. Khi `p2-rec-2` (sequence 1) tới trước `p2-rec-1` (sequence 0) chưa được chấp nhận, broker thấy sequence nhảy cóc và từ chối — buộc `p2-rec-2` cũng phải gửi lại. Kết quả: `p2` tốn NHIỀU lần retry hơn `p1` (mỗi record đến sai lượt đều bị bật lại), nhưng log cuối cùng đúng thứ tự `p2-rec-1, p2-rec-2, p2-rec-3` — cái giá của thứ tự đúng ở đây là retry, không phải mất throughput.',
      highlight: ['p2', 'orders-0'],
    },
    {
      at: 1500,
      title: '`max.in.flight = 1`: chặn thứ tự bằng cách không cho vượt mặt',
      body:
        '`p3` giới hạn `maxInFlight: 1` — `p3-rec-2`/`p3-rec-3` không hề "bay" trước khi `p3-rec-1` xong, chúng chỉ đơn giản NỐI ĐUÔI vào batch đang chờ gửi lại của `p3-rec-1`. Cả ba record rời broker trong đúng một lần gửi lại, đúng thứ tự — nhưng suốt thời gian `p3-rec-1` chờ retry, `p3` không hề gửi thêm gì khác, đây chính là cái giá throughput của cách chặn này.',
      highlight: ['p3', 'orders-0'],
    },
    {
      at: 1500,
      title: 'Thứ tự chỉ có nghĩa trong một partition',
      body:
        'Cả ba cách trên chỉ nói về thứ tự BÊN TRONG một partition — `orders-0`. Không có bảo đảm thứ tự nào giữa hai partition khác nhau, kể cả khi chúng thuộc cùng một topic; đừng kỳ vọng gì hơn phạm vi đó.',
      highlight: ['orders-0'],
    },
  ],
  checkpoints: [
    {
      at: 20_000,
      question: 'Vì sao phần log của `p1` (không idempotent, `maxInFlight: 5`) kết thúc với thứ tự `p1-rec-2, p1-rec-3, p1-rec-1`?',
      options: [
        'Vì broker cố ý đảo ngược thứ tự để cân bằng tải',
        'Vì `p1-rec-1` hỏng ở lần gửi đầu và phải gửi lại, trong khi `maxInFlight: 5` vẫn cho phép `p1-rec-2`/`p1-rec-3` tiếp tục bay và tới log trước — không có sequence nào để broker biết `p1-rec-1` đáng lẽ phải đứng đầu',
        'Vì `p1-rec-1` có kích thước lớn hơn nên mất nhiều thời gian ghi hơn',
      ],
      answerIndex: 1,
      explanation:
        '`max.in.flight > 1` cho phép nhiều request bay song song — khi request đầu hỏng và phải gửi lại, các request gửi sau nó (không dính lỗi) hoàn toàn có thể tới broker và được append trước. Producer không idempotent không gắn sequence nào lên record để broker biết thứ tự đúng, nên broker chỉ ghi theo đúng thứ tự nó NHẬN được — hai cách chặn là giới hạn `max.in.flight = 1` hoặc bật idempotence để broker tự từ chối record tới sai lượt.',
    },
  ],
}
