import { BROKER_1, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một producer transactional (`transactionalId: 'tx-orders'`, bắt buộc đi kèm
// `idempotent: true` — `validateKafkaTopology` chặn tổ hợp ngược lại), hai
// partition trên cùng một topic để "transaction mở rộng ra nhiều partition"
// là một sự thật quan sát được chứ không chỉ một câu mô tả suông: cả hai
// transaction dưới đây đều ghi xen kẽ vào `orders-0` và `orders-1`.
const PRODUCER_TX = Object.freeze({
  ...PRODUCER,
  idempotent: true,
  transactionalId: 'tx-orders',
  lingerMs: 0,
  acks: 'all' as const,
})

// Hai consumer, cùng subscribe `orders`, khác NHAU đúng một cờ —
// `isolationLevel` — để mọi khác biệt trong những gì mỗi bên thấy chỉ có thể
// tới từ cờ đó. Group riêng cho từng consumer (không chia partition) vì mục
// đích ở đây là so sánh những gì MỘT consumer đọc toàn bộ topic thấy được,
// không phải dạy lại consumer group.
// `maxPollIntervalMs: 5_000` bắt buộc trên MỌI consumer tự khai ở đây — bỏ
// trống thì rơi về default 300_000ms (5 phút ảo), vượt xa `durationMs` của cả
// lesson này, và coordinator không bao giờ đưa group về `Stable` kịp trong
// khung giờ chạy (xem why-comment ở `DEFAULT_MAX_POLL_INTERVAL_MS`, `types.ts`).
const CONSUMER_RC = Object.freeze({
  id: 'c1',
  label: 'Consumer read_committed',
  position: { x: 700, y: 120 },
  groupId: 'g22-rc',
  subscriptions: ['orders'],
  autoOffsetReset: 'earliest' as const,
  isolationLevel: 'read_committed' as const,
  maxPollIntervalMs: 5_000,
})

const CONSUMER_RU = Object.freeze({
  id: 'c2',
  label: 'Consumer read_uncommitted',
  position: { x: 700, y: 320 },
  groupId: 'g22-ru',
  subscriptions: ['orders'],
  autoOffsetReset: 'earliest' as const,
  isolationLevel: 'read_uncommitted' as const,
  maxPollIntervalMs: 5_000,
})

export const transactionsEos: KafkaLesson = {
  id: '22-transactions-eos',
  group: 'advanced',
  title: 'Transaction và exactly-once',
  summary:
    'Idempotence chỉ khử trùng bản ghi trong một partition, một phiên producer; transaction đi xa hơn — commit/abort phủ nhiều partition cùng lúc, và `read_committed` chỉ đọc tới last stable offset, không tới high watermark, để không bao giờ thấy nửa vời một transaction còn đang treo.',
  seed: 22,
  durationMs: 30_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 2, replicationFactor: 1 }],
    producers: [PRODUCER_TX],
    consumers: [CONSUMER_RC, CONSUMER_RU],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 0, kind: 'consumer-join', consumerId: 'c2' },
    // Transaction thứ nhất: ba record trải trên cả hai partition, rồi abort.
    { at: 1000, kind: 'begin-transaction', producerId: 'p1' },
    { at: 1500, kind: 'produce', producerId: 'p1', topic: 'orders', partition: 0, value: 'a1' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', partition: 1, value: 'a2' },
    { at: 2500, kind: 'produce', producerId: 'p1', topic: 'orders', partition: 0, value: 'a3' },
    { at: 3000, kind: 'abort-transaction', producerId: 'p1' },
    // Transaction thứ hai: cùng khuôn, nhưng commit.
    { at: 4000, kind: 'begin-transaction', producerId: 'p1' },
    { at: 4500, kind: 'produce', producerId: 'p1', topic: 'orders', partition: 0, value: 'b1' },
    { at: 5000, kind: 'produce', producerId: 'p1', topic: 'orders', partition: 1, value: 'b2' },
    { at: 5500, kind: 'produce', producerId: 'p1', topic: 'orders', partition: 0, value: 'b3' },
    { at: 6000, kind: 'commit-transaction', producerId: 'p1' },
  ],
  narrative: [
    {
      at: 1000,
      title: 'Idempotence dừng ở một partition, transaction thì không',
      body:
        '`enable.idempotence` (bài 9) chỉ khử được duplicate trong PHẠM VI một partition, một phiên `producerId` — nó không nói gì về việc ghi ĐỒNG THỜI vào nhiều partition. `p1` ở đây vừa `idempotent: true` vừa mang `transactional.id: \'tx-orders\'`: transaction mở rộng bảo đảm ra nhiều partition cùng lúc, đúng thứ idempotence một mình không làm được.',
      highlight: ['p1'],
    },
    {
      at: 1000,
      title: '`transactional.id` cấp `producerId` và epoch',
      body:
        'Khi một producer khai `transactional.id` cố định, broker cấp cho nó một `producerId` gắn liền với cái tên đó qua mọi lần khởi động lại, cộng một epoch tăng dần. Một tiến trình cũ (zombie) còn sống nhưng đã bị thay bằng một phiên mới của CÙNG `transactional.id` sẽ bị hàng rào chặn (zombie fencing) — broker từ chối mọi request mang epoch cũ hơn, nên nó không thể âm thầm ghi đè lên công việc của phiên mới.',
      highlight: ['p1'],
    },
    {
      at: 3000,
      title: 'Abort ghi control record vào từng partition tham gia',
      body:
        'Transaction thứ nhất vừa abort. `p1` đã ghi vào CẢ HAI partition (`orders-0` với `a1`/`a3`, `orders-1` với `a2`) nên broker ghi một control record abort vào TỪNG partition đó — không phải một bản ghi trung tâm duy nhất. Đây là cách một transaction trải trên nhiều partition kết thúc dứt khoát ở tất cả các nơi nó đã chạm tới, không nửa vời.',
      highlight: ['orders-0', 'orders-1'],
    },
    {
      at: 3200,
      title: 'Record đã abort vẫn nằm trong log',
      body:
        '`a1`, `a2`, `a3` không hề bị xoá — broker không có khái niệm "xoá ngược" một record đã ghi. Chúng vẫn nằm nguyên trong log, chỉ là một consumer `read_committed` biết bỏ qua chúng nhờ control record abort vừa ghi. Việc lọc là ở phía đọc, không phải phía lưu trữ.',
      highlight: ['orders-0'],
    },
    {
      at: 4500,
      title: '`read_committed`: đọc tới last stable offset, không tới high watermark',
      body:
        'Trong lúc transaction thứ hai còn đang mở (`b1`/`b2`/`b3` đã ghi nhưng chưa commit), last stable offset đứng nguyên tại record đầu tiên của nó — `c1` (`read_committed`) không thấy bất kỳ gì từ đó trở đi, dù `b1` đã nằm trong log và cộng cả vào high watermark. `c2` (`read_uncommitted`) thì đọc thẳng tới high watermark, thấy `b1`/`b2`/`b3` ngay khi chúng vừa ghi xong, không chờ commit.',
      highlight: ['orders-0', 'orders-1', 'c1', 'c2'],
    },
    {
      at: 6000,
      title: 'Exactly-once của Kafka dừng lại ở biên Kafka',
      body:
        'Transaction thứ hai vừa commit — `c1` giờ thấy đúng `b1`/`b2`/`b3`, không bao giờ thấy `a1`/`a2`/`a3`. Nhưng "exactly-once" ở đây chỉ đúng trong phạm vi read-process-write BÊN TRONG Kafka: đọc từ một topic, xử lý, ghi vào topic khác, tất cả trong cùng một transaction. Một khi ứng dụng ghi ra ngoài — một database, một lệnh gọi HTTP — bảo đảm này không còn theo tới nơi đó nữa; hệ thống bên ngoài cần cơ chế idempotent riêng của chính nó.',
      highlight: ['p1', 'c1', 'c2'],
    },
  ],
  checkpoints: [
    {
      at: 26_000,
      question: 'Vì sao `c1` (`read_committed`) không thấy `b1` ngay lúc `b1` vừa được ghi xong (t=4500), dù `c2` (`read_uncommitted`) thấy ngay?',
      options: [
        '`c1` bị chậm mạng hơn `c2` nên tới trễ',
        '`read_committed` chỉ đọc tới last stable offset — offset đó đứng yên tại đầu một transaction còn đang mở, nên `b1` chưa "đọc được" cho tới khi commit; `read_uncommitted` đọc thẳng tới high watermark nên thấy ngay',
        '`b1` chưa thật sự nằm trong log tại t=4500, chỉ mới nằm trong bộ nhớ producer',
      ],
      answerIndex: 1,
      explanation:
        'Last stable offset là biên `read_committed` không bao giờ vượt qua — nó đứng lại đúng tại record đầu tiên của một transaction chưa resolve. `b1` đã append vào log thật (cộng vào high watermark, `read_uncommitted` thấy được), nhưng với `read_committed` nó "chưa tồn tại" cho tới khi commit-transaction ghi control record và đẩy last stable offset lên.',
    },
  ],
}
