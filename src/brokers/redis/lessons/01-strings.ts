import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const strings: RedisLesson = {
  id: '01-strings',
  group: 'basics',
  title: 'String và counter',
  summary:
    'Redis lưu mọi dữ liệu trong một `key`-`value` phẳng, `GET` một `key` lạ trả về `(nil)`, còn `INCR` luôn an toàn dù nhiều client gọi cùng lúc.',
  seed: 1,
  durationMs: 12_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['user:1', 'alice'] },
    { at: 1500, clientId: APP.id, name: 'GET', args: ['user:1'] },
    { at: 3000, clientId: APP.id, name: 'GET', args: ['user:2'] },
    { at: 4500, clientId: APP.id, name: 'INCR', args: ['page:views'] },
    { at: 6000, clientId: APP.id, name: 'INCR', args: ['page:views'] },
    { at: 7500, clientId: APP.id, name: 'SET', args: ['user:1', 'bob'] },
    { at: 9000, clientId: APP.id, name: 'GET', args: ['user:1'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Một bản đồ phẳng',
      body: 'Toàn bộ dữ liệu Redis nằm trong một bản đồ phẳng từ `key` sang `value` — không bảng, không schema, chỉ một không gian tên duy nhất cho mọi kiểu dữ liệu.',
      highlight: ['app', 'redis'],
    },
    {
      at: 3000,
      title: 'Miss vẫn là một giá trị hợp lệ',
      body: '`GET` trên một `key` chưa tồn tại trả về `(nil)` — đó là một giá trị bình thường, không phải lỗi. Đọc một `key` lạ vẫn nhận về câu trả lời gọn gàng như vậy.',
      highlight: ['redis'],
    },
    {
      at: 4500,
      title: '`INCR` không có khoảng hở đọc-ghi',
      body: '`INCR` tạo `key` ở giá trị 0 trước, rồi cộng thêm 1, tất cả trong một bước nguyên tử. Hai client gọi `INCR` cùng lúc không bao giờ giẫm lên nhau.',
      highlight: ['app', 'redis'],
    },
    {
      at: 7500,
      title: '`SET` ghi đè không hỏi han',
      body: '`SET` viết đè giá trị cũ vô điều kiện, kể cả khi `key` đang mang TTL — TTL biến mất theo, trừ khi thêm `KEEPTTL`.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 10_500,
      question: '`INCR` trên một key chưa tồn tại trả về gì?',
      options: ['(error)', '(integer) 1', '(nil)'],
      answerIndex: 1,
      explanation:
        '`INCR` luôn tạo `key` ở 0 trước khi cộng thêm 1, nên kết quả đầu tiên luôn là `(integer) 1`, không bao giờ lỗi hay `(nil)`.',
    },
    {
      at: 12_000,
      question:
        'Tổng kết: `key` đang mang TTL 60 giây, bạn gọi `SET` ghi giá trị mới. TTL còn lại bao nhiêu?',
      options: ['Không còn hạn nữa — `SET` xoá luôn TTL', 'Vẫn 60 giây như cũ', 'Đặt lại về 60 giây tính từ lúc ghi'],
      answerIndex: 0,
      explanation:
        '`SET` thay thế toàn bộ `key`, gồm cả phần metadata mang hạn, nên `key` trở thành vĩnh viễn. Muốn giữ hạn cũ thì phải gọi `SET ... KEEPTTL`. Đây là nguyên nhân rất thường gặp khiến cache tưởng có hạn mà thực ra nằm mãi.',
    },
  ],
}
