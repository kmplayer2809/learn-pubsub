import { BROKER_1 } from './types'
import type { KafkaFault, KafkaLesson } from './types'

const PRODUCER_PLAIN = Object.freeze({ id: 'p1', label: 'Producer thường', position: { x: 40, y: 100 } })
const PRODUCER_IDEMPOTENT = Object.freeze({ id: 'p2', label: 'Producer idempotent', position: { x: 40, y: 340 } })

// `retries: 3` khác `0` một cách có chủ đích (ruling controller task 12, mục
// 3): `retries: 0` rơi thẳng vào nhánh `ACK_LOST_RETRIES_EXHAUSTED` của
// `flushBatch` thay vì resend — một tình huống thật nhưng khác hẳn, và sẽ
// giết luôn màn trình diễn duplicate mà bài này cần.
const failures: KafkaFault[] = [
  { at: 4000, kind: 'ack-lost', producerId: 'p1', times: 1 },
  { at: 4000, kind: 'ack-lost', producerId: 'p2', times: 1 },
]

// Một broker, một partition — cùng kịch bản, chỉ khác đúng một cờ
// `idempotent`, để mọi khác biệt trong log chỉ có thể tới từ cờ đó.
export const idempotentProducer: KafkaLesson = {
  id: '09-idempotent-producer',
  group: 'producer',
  title: 'Idempotent producer',
  summary:
    'Retry là nguồn duplicate chính, không phải lỗi ứng dụng — `producerId` cộng `sequence` cho broker đủ thông tin để nhận ra và bỏ qua một bản gửi lại, thứ mà `enable.idempotence` bật lên gần như miễn phí.',
  seed: 9,
  durationMs: 22_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [
      { ...PRODUCER_PLAIN, idempotent: false, retries: 3, lingerMs: 0 },
      { ...PRODUCER_IDEMPOTENT, idempotent: true, retries: 3, lingerMs: 0 },
    ],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1a' },
    { at: 700, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-1b' },
    // Fault `ack-lost` kích hoạt ĐÚNG t=4000 (xem `failures`) — append của lần
    // gửi này vẫn thành công, chỉ có phản hồi bị buộc "mất", nên cả hai producer
    // đều coi như request thất bại và resend.
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2a' },
    { at: 4000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-2b' },
  ],
  narrative: [
    {
      at: 500,
      title: 'Cùng kịch bản, chỉ khác một cờ',
      body:
        '`p1` (thường) và `p2` (`idempotent: true`) nhận đúng cùng một chuỗi lệnh, cùng một fault. Khác biệt duy nhất giữa hai producer là cờ `idempotent` — mọi khác biệt xuất hiện trong log sau đây chỉ có thể tới từ đúng cờ này.',
      highlight: ['p1', 'p2'],
    },
    {
      at: 4000,
      title: 'Ack bị mất: producer không thể phân biệt với một request thất bại thật',
      body:
        'Record `đơn-2a`/`đơn-2b` của cả hai producer đã append thành công vào log, nhưng phản hồi quay về bị "mất" — mô phỏng một timeout mạng thật. Producer không biết append đã xảy ra: với nó, im lặng này giống hệt một request chưa từng tới nơi, nên cả hai đều resend.',
      highlight: ['p1', 'p2', 'orders-0'],
    },
    {
      at: 4300,
      title: 'Không idempotent: broker không phân biệt được "mới" với "cũ gửi lại"',
      body:
        '`p1` không có `producerId`/`sequence` đi kèm record, nên broker chấp nhận lần gửi lại y như một record hoàn toàn mới — `đơn-2a` xuất hiện HAI LẦN trong log `orders-0`. Đây chính là duplicate sinh ra từ retry, không phải từ một lỗi ứng dụng nào.',
      highlight: ['p1', 'orders-0'],
    },
    {
      at: 4300,
      title: '`enable.idempotence`: broker nhận ra bản gửi lại và bỏ qua',
      body:
        '`p2` gán `producerId` + `sequence` cho mỗi record ngay từ lúc enqueue, không đổi qua các lần gửi lại. Khi bản gửi lại của `đơn-2b` tới, broker so `sequence` với lần cuối đã CHẤP NHẬN cho đúng `producerId` này, thấy trùng, và bỏ qua — record chỉ nằm trong log đúng một lần. `enable.idempotence` gần như miễn phí: chỉ thêm vài trường vào mỗi record, không cần producer tự dò trùng.',
      highlight: ['p2', 'orders-0'],
    },
    {
      at: 4600,
      title: 'Chỉ khử trùng trong một partition, một phiên producer',
      body:
        'Bảo đảm này chỉ đúng trong phạm vi một partition và một phiên `producerId` — nó không phải exactly-once đầu-cuối (từ producer tới tận consumer), thứ đòi hỏi thêm transaction và sẽ tới ở một bài sau. Ở đây, idempotence chỉ chặn đúng một loại duplicate: bản ghi trùng do chính producer gửi lại trên cùng một partition.',
      highlight: ['p2'],
    },
  ],
  checkpoints: [
    {
      at: 18_000,
      question: 'Cùng một lần "ack bị mất", vì sao log của `p1` có `đơn-2a` hai lần còn log của `p2` chỉ có `đơn-2b` một lần?',
      options: [
        '`p2` gửi chậm hơn nên tránh được retry, còn `p1` gửi nhanh nên bị',
        '`p1` không gắn `producerId`/`sequence` nên broker coi bản gửi lại là một record mới; `p2` gắn `sequence` ổn định, nên broker nhận ra bản gửi lại trùng lần đã chấp nhận và bỏ qua',
        'Cả hai đều bị duplicate, chỉ là `p2` xoá bớt một bản trước khi hiển thị',
      ],
      answerIndex: 1,
      explanation:
        'Duplicate ở đây tới từ chính việc producer resend sau khi ack bị mất, không phải một lỗi ứng dụng. `p1` không có định danh nào đi kèm record nên broker không có cách nào biết bản gửi lại là "cũ" — ghi thêm một lần nữa. `p2` (`idempotent: true`) gắn `producerId` + `sequence` cố định cho mỗi record; broker so sequence với lần cuối đã chấp nhận, thấy trùng thì bỏ qua, không ghi lần hai.',
    },
  ],
}
