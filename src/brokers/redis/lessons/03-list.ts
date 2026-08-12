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
      at: 14_000,
      question: 'Worker `BLPOP` xong rồi crash trước khi xử lý xong. Message đi đâu?',
      options: ['Redis requeue tự động', 'Mất — list không có ack', 'Vào dead-letter list'],
      answerIndex: 1,
      explanation:
        'Khác với RabbitMQ, nơi một message chưa ack tự requeue, `list` trong Redis không lưu bản sao nào sau khi `BLPOP` trả về — worker crash coi như message mất vĩnh viễn.',
    },
  ],
}
