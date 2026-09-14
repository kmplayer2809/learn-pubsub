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
      at: 3000,
      question: '`HGETALL user:1` vừa trả về đủ hai field. Lệnh nào nên dùng khi chỉ cần đúng một field?',
      options: ['`HGET user:1 name`', '`GET user:1`', '`HGETALL` rồi lọc phía ứng dụng'],
      answerIndex: 0,
      explanation:
        '`HGET` đọc đúng phần cần, không kéo phần còn lại qua mạng. Đó là lợi thế chính của `hash` so với một chuỗi JSON.',
    },
    {
      at: 9000,
      question: 'Đặt TTL cho một field trong hash bằng cách nào?',
      options: ['HEXPIRE user:1 name 60', 'Không được — TTL chỉ gắn với key', 'EXPIRE user:1 name 60'],
      answerIndex: 1,
      explanation:
        'Redis chỉ cho phép TTL gắn ở cấp `key`; không tồn tại `HEXPIRE` cho riêng một field, nên câu trả lời đúng là "không được".',
    },
    {
      at: 12_000,
      question:
        'Tổng kết: một object có 50 field, mỗi lần chỉ cần đọc đúng một field. Nên lưu kiểu nào?',
      options: [
        '`hash`, rồi dùng `HGET` cho từng field',
        'Một chuỗi JSON, dùng `GET` rồi parse phía client',
        'Năm mươi `key` kiểu `string` riêng biệt',
      ],
      answerIndex: 0,
      explanation:
        'JSON buộc mỗi lượt đọc phải kéo trọn 50 field qua mạng rồi parse lại. Tách thành 50 `key` rời thì mất khả năng thao tác cả object cùng lúc, lại tốn thêm bộ nhớ metadata cho mỗi `key`. `hash` giữ được cả hai: `HGET` lấy từng phần, `HGETALL` lấy trọn khi cần.',
    },
  ],
  quiz: [
    {
      question: 'Một `hash` lưu dữ liệu theo cách nào?',
      options: [
        'Nhiều field dưới một `key` duy nhất',
        'Nhiều `key` dưới một field',
        'Một chuỗi JSON đã nén',
        'Một danh sách cặp giá trị có thứ tự',
      ],
      answerIndex: 0,
      explanation:
        'Một lượt round-trip lấy trọn cả object bằng `HGETALL`, hoặc lấy đúng một phần bằng `HGET`.',
    },
    {
      question: '`HINCRBY` khác `INCR` ở điểm nào?',
      options: [
        'Bộ đếm nằm bên trong một field của `hash`, vẫn nguyên tử y hệt',
        '`HINCRBY` không nguyên tử',
        '`HINCRBY` chỉ cộng được số âm',
        '`HINCRBY` tạo `key` mới sau mỗi lượt gọi',
      ],
      answerIndex: 0,
      explanation:
        'Cùng một tính chất nguyên tử, chỉ khác chỗ chứa. Nhờ vậy một object gom được cả dữ liệu lẫn bộ đếm dưới một `key`.',
    },
    {
      question: 'Muốn một field trong `hash` tự hết hạn thì làm thế nào?',
      options: [
        'Không có cách trực tiếp — tách field đó ra thành `key` riêng mang TTL',
        'Gọi `HEXPIRE user:1 name 60`',
        'Gọi `EXPIRE user:1 name 60`',
        'Đặt giá trị field thành rỗng',
      ],
      answerIndex: 0,
      explanation:
        'TTL luôn gắn với cả `key`. Cần hạn riêng cho một phần dữ liệu thì phần đó phải là `key` của chính nó.',
    },
    {
      question: 'Object 50 field, mỗi lượt chỉ đọc một field. Vì sao chuỗi JSON là lựa chọn tệ?',
      options: [
        'Mỗi lượt đọc phải kéo trọn 50 field qua mạng rồi parse lại',
        'Redis không lưu nổi chuỗi dài như vậy',
        'JSON mất tính nguyên tử lúc ghi',
        'JSON tốn nhiều metadata hơn `hash`',
      ],
      answerIndex: 0,
      explanation:
        'Chi phí nằm ở băng thông cộng công parse cho phần dữ liệu không ai cần. `HGET` cắt hẳn phần lãng phí đó.',
    },
  ],
}
