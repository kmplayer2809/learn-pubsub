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
      at: 6000,
      question: '`INCR page:views` vừa chạy lần thứ hai. Vì sao hai client gọi cùng lúc vẫn không mất lượt đếm?',
      options: [
        '`INCR` đọc rồi cộng trong một bước nguyên tử',
        'Redis khoá `key` lại cho tới khi client ngắt kết nối',
        'Client thứ hai phải chờ hết TTL',
      ],
      answerIndex: 0,
      explanation:
        'Không có khoảng hở đọc-ghi nào để hai bên giẫm lên nhau. Làm việc đó bằng `GET` rồi `SET` phía ứng dụng thì khoảng hở xuất hiện ngay.',
    },
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
  quiz: [
    {
      question: 'Dữ liệu trong Redis được tổ chức theo cách nào?',
      options: [
        'Một bản đồ phẳng từ `key` sang `value`, chung một không gian tên',
        'Nhiều bảng có schema riêng',
        'Một cây thư mục phân cấp',
        'Mỗi kiểu dữ liệu một không gian tên riêng',
      ],
      answerIndex: 0,
      explanation:
        'Không bảng, không schema. `user:1` với `page:views` nằm chung một keyspace; dấu hai chấm chỉ là quy ước đặt tên của con người.',
    },
    {
      question: '`GET` trên một `key` chưa tồn tại trả về gì?',
      options: ['`(nil)` — một giá trị hợp lệ', '`(error)`', '`(integer) 0`', 'Một chuỗi rỗng'],
      answerIndex: 0,
      explanation:
        'Miss là câu trả lời bình thường, không phải lỗi. Code phía ứng dụng vẫn phải phân biệt `(nil)` với một giá trị rỗng thật sự.',
    },
    {
      question: 'Vì sao `INCR` an toàn hơn cặp `GET` rồi `SET` phía ứng dụng?',
      options: [
        '`INCR` là một bước nguyên tử, không có khoảng hở cho client khác chen vào',
        '`INCR` chạy trên một luồng riêng',
        '`INCR` tự khoá `key` trong một giây',
        '`INCR` ghi thẳng xuống đĩa',
      ],
      answerIndex: 0,
      explanation:
        'Cặp `GET` rồi `SET` để lộ một khoảng hở đúng bằng thời gian giữa hai lượt round-trip; hai client cùng tăng bộ đếm sẽ mất một lượt. `INCR` khép hẳn khoảng hở đó.',
    },
    {
      question: 'Muốn ghi giá trị mới mà giữ nguyên hạn cũ thì dùng gì?',
      options: ['`SET ... KEEPTTL`', '`SET ... NX`', '`SET ... XX`', '`GETSET`'],
      answerIndex: 0,
      explanation:
        '`SET` mặc định thay cả phần metadata mang hạn nên `key` trở thành vĩnh viễn. `NX` với `XX` chỉ điều kiện hoá việc ghi, không liên quan tới hạn.',
    },
  ],
}
