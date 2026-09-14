import { APP, SERVER, WORKER } from './types'
import type { RedisLesson } from './types'

export const list: RedisLesson = {
  id: '03-list',
  group: 'basics',
  title: 'List: queue và stack',
  summary:
    'Redis `list` biến một `key` thành hàng đợi hoặc ngăn xếp tuỳ đầu bạn thao tác, còn `BLPOP` cho thấy vì sao mất phần tử là chuyện thật khi không có ack.',
  seed: 3,
  durationMs: 16_000,
  topology: {
    clients: [APP, WORKER],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'LPUSH', args: ['jobs', 'a'] },
    { at: 1000, clientId: APP.id, name: 'LPUSH', args: ['jobs', 'b'] },
    { at: 2000, clientId: APP.id, name: 'LPUSH', args: ['jobs', 'c'] },
    { at: 3500, clientId: APP.id, name: 'RPOP', args: ['jobs'] },
    { at: 5000, clientId: APP.id, name: 'LPOP', args: ['jobs'] },
    { at: 6500, clientId: APP.id, name: 'LRANGE', args: ['jobs', '0', '-1'] },
    // Three elements were pushed (a, b, c) and the plan's own script only
    // popped two (RPOP, LPOP), leaving 'b' behind. That means `jobs` still
    // held a live element when the scripted BLPOP below applied, so BLPOP
    // would have returned it synchronously instead of parking — the lesson's
    // whole point (a worker genuinely blocks, then a later push wakes it)
    // never actually happened. This RPOP drains the last element so the key
    // is deleted here (demonstrating the "empty list disappears" narrative
    // beat) and BLPOP genuinely has nothing to pop when it runs.
    { at: 7000, clientId: APP.id, name: 'RPOP', args: ['jobs'] },
    { at: 8000, clientId: WORKER.id, name: 'BLPOP', args: ['jobs', '10'] },
    { at: 11_000, clientId: APP.id, name: 'LPUSH', args: ['jobs', 'd'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Một key, hai cấu trúc dữ liệu',
      body: '`LPUSH` cộng `RPOP` tạo hàng đợi FIFO, còn `LPUSH` cộng `LPOP` tạo ngăn xếp LIFO — vẫn cùng một `key`, chỉ khác đầu nào lấy phần tử ra.',
      highlight: ['app', 'redis'],
    },
    {
      at: 3500,
      title: 'Không consumer group, không ack',
      body: 'Một `list` không mang consumer group, cũng chẳng có cơ chế ack — phần tử vừa bị lấy ra là biến mất vĩnh viễn, worker nào crash ngay sau khi pop coi như mất luôn phần việc đó.',
      highlight: ['worker', 'redis'],
    },
    {
      at: 7000,
      title: 'Key rỗng thì biến mất',
      body: 'Redis không giữ lại một `list` rỗng — phần tử cuối cùng vừa pop xong, `key` biến mất khỏi keyspace ngay lập tức.',
      highlight: ['redis'],
    },
    {
      at: 8000,
      title: '`BLPOP` đợi thay vì hỏi liên tục',
      body: '`BLPOP` cho client đứng đợi ngay tại server thay vì liên tục hỏi lại xem `list` đã có gì chưa — tiết kiệm cả băng thông lẫn công polling.',
      highlight: ['worker'],
    },
    {
      at: 11_000,
      title: 'Một lượt push chỉ đánh thức một client',
      body: 'Khi có một lượt `LPUSH` mới, chỉ đúng một client đang đợi lâu nhất được đánh thức — không phải mọi client đang `BLPOP` trên cùng `key` cùng lúc.',
      highlight: ['app', 'worker', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 9500,
      question: 'Worker gọi `BLPOP jobs 10` lúc `jobs` đang rỗng. Chuyện gì xảy ra?',
      options: [
        'Client đứng đợi ngay tại server, tối đa mười giây',
        'Lệnh trả `(nil)` ngay lập tức',
        'Redis tạo `jobs` rỗng rồi trả về một phần tử giả',
      ],
      answerIndex: 0,
      explanation:
        '`BLPOP` thay cho vòng polling: client chờ tại chỗ, một lượt `LPUSH` mới sẽ đánh thức đúng một client đợi lâu nhất.',
    },
    {
      at: 14_000,
      question: 'Worker `BLPOP` xong rồi crash trước khi xử lý xong. Message đi đâu?',
      options: ['Redis requeue tự động', 'Mất — list không có ack', 'Vào dead-letter list'],
      answerIndex: 1,
      explanation:
        'Khác với RabbitMQ, nơi một message chưa ack tự requeue, `list` trong Redis không lưu bản sao nào sau khi `BLPOP` trả về — worker crash coi như message mất vĩnh viễn.',
    },
    {
      at: 16_000,
      question:
        'Tổng kết: cần hàng đợi job chịu được worker chết giữa chừng. Trong Redis nên chọn gì?',
      options: [
        'Redis Stream với consumer group, vì nó có ack cùng danh sách pending',
        'Vẫn `list`, chỉ cần thêm nhiều worker `BLPOP` song song',
        '`sorted set`, lấy score làm thứ tự ưu tiên',
      ],
      answerIndex: 0,
      explanation:
        'Không cấu trúc nào trong ba cái này tự sinh ra ack ngoài Stream. Consumer group của Stream giữ message đã giao trong danh sách pending cho tới khi có `XACK`, nên `XAUTOCLAIM` có thể chuyển phần việc mồ côi sang worker khác. Thêm worker cho `list` chỉ tăng thông lượng, không hề cứu được job đã pop.',
    },
  ],
  quiz: [
    {
      question: '`LPUSH` cộng `RPOP` tạo ra cấu trúc gì?',
      options: ['Hàng đợi FIFO', 'Ngăn xếp LIFO', 'Tập hợp không trùng', 'Bảng xếp hạng theo score'],
      answerIndex: 0,
      explanation:
        'Đẩy một đầu, lấy đầu kia là FIFO. Đẩy rồi lấy cùng một đầu (`LPUSH` cộng `LPOP`) mới là LIFO — vẫn trên cùng một `key`.',
    },
    {
      question: 'Phần tử cuối cùng của một `list` vừa bị lấy ra. `key` ra sao?',
      options: [
        'Biến mất khỏi keyspace ngay lập tức',
        'Còn lại với độ dài 0',
        'Chuyển sang kiểu `string`',
        'Redis giữ thêm sáu mươi giây',
      ],
      answerIndex: 0,
      explanation:
        'Redis không giữ container rỗng. Vì vậy `EXISTS jobs` trả 0 sau lượt pop cuối, còn `LLEN` trên một `key` không tồn tại cũng trả 0.',
    },
    {
      question: 'Vì sao `list` không hợp làm hàng đợi job cần độ bền?',
      options: [
        'Không có ack — phần tử đã pop không còn bản sao nào ở server',
        'Nó không giữ được thứ tự',
        'Mỗi `key` chỉ cho đúng một consumer',
        'Nó không dùng được với nhiều client',
      ],
      answerIndex: 0,
      explanation:
        'Pop là chuyển giao dứt điểm. Stream cùng consumer group mới giữ message đã giao trong danh sách pending cho tới khi có `XACK`.',
    },
    {
      question: 'Một lượt `LPUSH` đánh thức bao nhiêu client đang `BLPOP` trên cùng `key`?',
      options: [
        'Đúng một, client đợi lâu nhất',
        'Tất cả, rồi chúng tranh nhau',
        'Không client nào, phải gọi lại',
        'Hai, để dự phòng',
      ],
      answerIndex: 0,
      explanation:
        'Một phần tử chỉ về được một nơi, nên đánh thức nhiều client là vô nghĩa. Đây cũng là lý do `list` phân phát việc chứ không phát tán bản sao.',
    },
  ],
}
