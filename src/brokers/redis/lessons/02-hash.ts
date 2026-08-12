import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const hash: RedisLesson = {
  id: '02-hash',
  group: 'basics',
  title: 'Hash',
  summary:
    'Hash gom nhiều field dưới một `key`, `HGET` đọc từng phần mà không kéo theo cả object, còn TTL luôn thuộc về `key`, chưa từng thuộc về field.',
  seed: 2,
  durationMs: 12_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'HSET', args: ['user:1', 'name', 'alice', 'city', 'hanoi'] },
    { at: 1500, clientId: APP.id, name: 'HGET', args: ['user:1', 'name'] },
    { at: 3000, clientId: APP.id, name: 'HGETALL', args: ['user:1'] },
    { at: 4500, clientId: APP.id, name: 'HINCRBY', args: ['user:1', 'logins', '1'] },
    { at: 6000, clientId: APP.id, name: 'HDEL', args: ['user:1', 'city'] },
    { at: 7500, clientId: APP.id, name: 'HGETALL', args: ['user:1'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Nhiều field, một key',
      body: 'Một `hash` gom nhiều field dưới một `key` duy nhất, nên một lượt round-trip lấy trọn cả object thay vì gọi `GET` rời rạc nhiều lần.',
      highlight: ['app', 'redis'],
    },
    {
      at: 1500,
      title: '`HGET` chỉ lấy đúng phần cần',
      body: '`HGET` đọc một field mà không kéo theo phần còn lại — đây là lý do nên chọn `hash` thay vì nhét cả object vào một chuỗi JSON.',
      highlight: ['redis'],
    },
    {
      at: 4500,
      title: '`HINCRBY` vẫn nguyên tử',
      body: '`HINCRBY` biến một field thành bộ đếm riêng, vẫn nguyên tử như `INCR` trên `string`, chỉ khác là bộ đếm sống bên trong `hash`.',
      highlight: ['app', 'redis'],
    },
    {
      at: 6000,
      title: 'TTL thuộc về key, không thuộc field',
      body: 'TTL luôn gắn với cả `key`, chưa từng gắn riêng cho một field bên trong `hash` — muốn hết hạn một field, chỉ còn cách xoá nó rồi ghi lại.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 9000,
      question: 'Đặt TTL cho một field trong hash bằng cách nào?',
      options: ['HEXPIRE user:1 name 60', 'Không được — TTL chỉ gắn với key', 'EXPIRE user:1 name 60'],
      answerIndex: 1,
      explanation:
        'Redis chỉ cho phép TTL gắn ở cấp `key`; không tồn tại `HEXPIRE` cho riêng một field, nên câu trả lời đúng là "không được".',
    },
  ],
}
