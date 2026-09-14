import { APP, SERVER, WORKER } from './types'
import type { RedisLesson } from './types'

export const transactions: RedisLesson = {
  id: '12-transactions',
  group: 'advanced',
  title: 'Transactions',
  summary:
    '`MULTI`/`EXEC` gộp nhiều lệnh thành một bước duy nhất; `WATCH` huỷ `EXEC` nếu `key` đang theo dõi đổi giữa chừng.',
  seed: 12,
  durationMs: 3500,
  topology: { clients: [APP, WORKER], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['balance:1', '100'] },
    { at: 300, clientId: APP.id, name: 'MULTI', args: [] },
    { at: 500, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 700, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 900, clientId: APP.id, name: 'EXEC', args: [] },
    { at: 1400, clientId: APP.id, name: 'WATCH', args: ['balance:1'] },
    { at: 1600, clientId: WORKER.id, name: 'SET', args: ['balance:1', '999'] },
    { at: 2000, clientId: APP.id, name: 'MULTI', args: [] },
    { at: 2200, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 2400, clientId: APP.id, name: 'EXEC', args: [] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Lệnh bên trong MULTI chỉ xếp hàng, chưa chạy',
      body: 'Từ lúc `MULTI` tới trước `EXEC`, mỗi lệnh gửi lên chỉ nhận `QUEUED` — chưa hề đụng vào `key` nào cả.',
      highlight: ['app', 'redis'],
    },
    {
      at: 900,
      title: 'EXEC chạy trọn khối một lượt',
      body: 'Cả hai `INCR` chạy liền nhau trong đúng một bước — không command nào khác của client khác chen được vào giữa.',
      highlight: ['redis'],
    },
    {
      at: 1400,
      title: 'WATCH đặt một điều kiện, không phải một khoá',
      body: '`WATCH` không chặn `worker` ghi đè `balance:1` — nó chỉ ghi nhớ phiên bản hiện tại của `key` để `EXEC` so sánh lại sau.',
      highlight: ['app'],
    },
    {
      at: 1600,
      title: 'worker ghi đè ngay trong lúc app đang theo dõi',
      body: '`worker` không biết và không cần biết `app` đang `WATCH` — đây chính là race condition mà `WATCH` được sinh ra để phát hiện.',
      highlight: ['worker', 'redis'],
    },
    {
      at: 2400,
      title: 'EXEC lần hai bị huỷ',
      body: '`balance:1` đã đổi kể từ lúc `WATCH` — `EXEC` từ chối chạy khối lệnh, trả về nil thay vì âm thầm ghi đè lên giá trị mà `worker` vừa đặt.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 2600,
      question: '`WATCH balance:1` có chặn `worker` ghi đè `key` đó không?',
      options: [
        'Không — `WATCH` chỉ ghi nhớ phiên bản để `EXEC` so lại',
        'Có, `key` bị khoá cho tới khi `EXEC` chạy',
        'Có, nhưng chỉ trong năm giây',
      ],
      answerIndex: 0,
      explanation:
        'Đây là kiểm soát lạc quan: không ai bị chặn, chỉ bên đang theo dõi phải làm lại khi phát hiện dữ liệu đã đổi.',
    },
    {
      at: 3200,
      question: 'worker ghi đè balance:1 trong lúc app đang WATCH nó. EXEC của app sau đó làm gì?',
      options: ['Chạy bình thường, đè lên giá trị của worker', 'Từ chối chạy, trả về nil', 'Báo lỗi và crash'],
      answerIndex: 1,
      explanation: '`EXEC` so phiên bản của `balance:1` tại lúc `WATCH` với phiên bản hiện tại — lệch nhau thì huỷ toàn bộ khối lệnh, trả về nil, không chạy gì.',
    },
    {
      at: 3500,
      question:
        'Tổng kết: lệnh thứ hai trong khối `MULTI` gặp lỗi runtime lúc `EXEC` chạy. Các lệnh còn lại ra sao?',
      options: [
        'Vẫn chạy hết — Redis không rollback lệnh đã thực thi',
        'Toàn khối bị rollback về trạng thái trước `EXEC`',
        '`EXEC` dừng ngay tại lệnh lỗi, phần sau bị bỏ',
      ],
      answerIndex: 0,
      explanation:
        '`MULTI`/`EXEC` cho tính cô lập chứ không cho tính nguyên tử kiểu rollback. Lỗi cú pháp bị bắt lúc xếp hàng nên cả khối bị từ chối, nhưng lỗi runtime — ví dụ `INCR` trên một chuỗi — chỉ làm hỏng đúng lệnh đó, phần còn lại vẫn chạy tiếp. Cần rollback thật thì phải viết Lua script.',
    },
  ],
  quiz: [
    {
      question: 'Lệnh gửi lên giữa `MULTI` với `EXEC` làm gì?',
      options: [
        'Chỉ xếp hàng, nhận `QUEUED`, chưa chạm `key` nào',
        'Chạy ngay rồi có thể rollback sau',
        'Chạy trên một bản sao tạm của keyspace',
        'Bị từ chối cho tới khi `EXEC` tới',
      ],
      answerIndex: 0,
      explanation:
        '`EXEC` mới là lúc cả khối chạy liền một mạch, không client nào chen được vào giữa.',
    },
    {
      question: '`WATCH` phát hiện điều gì?',
      options: [
        '`key` theo dõi đã đổi kể từ lúc `WATCH`',
        'Client khác đang đọc `key`',
        'Kết nối tới `key` bị rớt',
        '`key` sắp hết hạn',
      ],
      answerIndex: 0,
      explanation:
        'Lệch phiên bản thì `EXEC` trả nil, không chạy gì cả — ứng dụng phải đọc lại rồi thử lại từ đầu.',
    },
    {
      question: '`MULTI`/`EXEC` cho tính chất nào, không cho tính chất nào?',
      options: [
        'Cho tính cô lập, không cho rollback',
        'Cho rollback, không cho tính cô lập',
        'Cho cả hai',
        'Không cho cả hai',
      ],
      answerIndex: 0,
      explanation:
        'Lỗi cú pháp bị bắt lúc xếp hàng nên cả khối bị từ chối, nhưng lỗi runtime chỉ hỏng đúng lệnh đó, phần sau vẫn chạy tiếp. Cần rollback thật thì phải viết Lua script.',
    },
    {
      question: 'Mẫu `WATCH` rồi `MULTI` rồi `EXEC` cần gì ở phía ứng dụng?',
      options: [
        'Một vòng thử lại khi `EXEC` trả nil',
        'Một khoá phân tán bao ngoài',
        'Một `TTL` cho từng `key` theo dõi',
        'Một bản sao dữ liệu phía client',
      ],
      answerIndex: 0,
      explanation:
        'Kiểm soát lạc quan giả định xung đột hiếm. `EXEC` trả nil là tín hiệu đọc lại giá trị mới rồi dựng lại khối lệnh, không phải một lỗi.',
    },
  ],
}
