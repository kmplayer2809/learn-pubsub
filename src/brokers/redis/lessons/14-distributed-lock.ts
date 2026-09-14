import { APP, SERVER, WORKER } from './types'
import type { RedisLesson } from './types'

const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`

export const distributedLock: RedisLesson = {
  id: '14-distributed-lock',
  group: 'advanced',
  title: 'Distributed lock',
  summary:
    '`SET key token NX PX` giành khoá; unlock an toàn bằng một `EVAL` so token trước khi xoá — không phải hai lệnh `GET` rồi `DEL` rời nhau.',
  seed: 14,
  durationMs: 2400,
  topology: { clients: [APP, WORKER], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['lock:job', 'token-app', 'NX', 'PX', '5000'] },
    { at: 300, clientId: WORKER.id, name: 'SET', args: ['lock:job', 'token-worker', 'NX', 'PX', '5000'] },
    { at: 700, clientId: WORKER.id, name: 'EVAL', args: [UNLOCK, '1', 'lock:job', 'token-worker'] },
    { at: 1100, clientId: APP.id, name: 'EVAL', args: [UNLOCK, '1', 'lock:job', 'token-app'] },
    { at: 1500, clientId: APP.id, name: 'EXISTS', args: ['lock:job'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'SET NX PX là toàn bộ cơ chế giành khoá',
      body: '`NX` chỉ ghi khi `key` chưa tồn tại — đúng một client thắng cuộc đua giành khoá; `PX` đặt hạn tự huỷ phòng khi client giữ khoá chết mà không kịp mở.',
      highlight: ['app', 'redis'],
    },
    {
      at: 300,
      title: 'worker đến sau, thua cuộc đua',
      body: '`lock:job` đã có `app` giữ — `SET NX` của `worker` không ghi được gì, trả về nil.',
      highlight: ['worker'],
    },
    {
      at: 700,
      title: 'worker thử mở khoá của người khác — bị chặn',
      body: 'Token trong lệnh mở khoá không khớp giá trị đang giữ `key` — script trả về 0, `lock:job` vẫn còn nguyên. Đây là lý do mở khoá không thể chỉ là một `DEL` trần trụi: bất kỳ ai gọi `DEL lock:job` cũng sẽ vô tình mở khoá của người khác.',
      highlight: ['worker', 'redis'],
    },
    {
      at: 1100,
      title: 'app mở đúng khoá của mình',
      body: 'Token khớp — script xoá `key` trong đúng một bước `EVAL`, không có khoảng hở giữa lúc kiểm tra token và lúc xoá.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 1300,
      question: '`worker` gọi `SET lock:job token-worker NX PX 5000` lúc `app` đang giữ khoá. Kết quả?',
      options: [
        'Trả về nil, không ghi gì cả',
        'Ghi đè khoá của `app`',
        'Xếp hàng chờ tới khi khoá được mở',
      ],
      answerIndex: 0,
      explanation:
        '`NX` chỉ ghi khi `key` chưa tồn tại, nên đúng một client thắng cuộc đua. Bên thua phải tự quyết định chờ rồi thử lại hay bỏ qua.',
    },
    {
      at: 2000,
      question: 'Vì sao mở khoá dùng EVAL (GET rồi DEL trong một script) thay vì gọi GET và DEL là hai lệnh riêng?',
      options: [
        'Vì EVAL nhanh hơn hai lệnh cộng lại',
        'Vì giữa hai lệnh riêng có khoảng hở: một client khác có thể giành lại lock:job ngay sau GET nhưng trước DEL, khiến DEL xoá nhầm khoá của họ',
        'Vì SET NX không tương thích với hai lệnh riêng',
      ],
      answerIndex: 1,
      explanation: 'Không phải chuyện tốc độ — là chuyện atomicity: hai lệnh rời để lộ một khoảng hở đúng bằng thời gian giữa chúng, đủ để client khác giành lại lock:job. Redlock (khoá qua nhiều node) vẫn còn bị tranh cãi (Martin Kleppmann và antirez từng tranh luận công khai) chính vì những khoảng hở tương tự ở tầng mạng, không phải tầng một lệnh.',
    },
    {
      at: 2400,
      question:
        'Tổng kết: `app` giành khoá `PX 5000` nhưng công việc mất 8 giây. Rủi ro nằm ở đâu?',
      options: [
        'Khoá hết hạn lúc giây thứ 5, client khác giành được, hai bên cùng chạy một lúc',
        'Redis tự gia hạn khoá vì `app` vẫn còn kết nối',
        'Không rủi ro nào — `PX` chỉ tính khi client chết',
      ],
      answerIndex: 0,
      explanation:
        'TTL của khoá là phỏng đoán về thời gian công việc, mà phỏng đoán thì sai được. Vượt hạn thì mất quyền loại trừ lẫn nhau, đúng thứ khoá sinh ra để bảo vệ. Cách chữa là một watchdog gia hạn khoá theo chu kỳ khi việc còn chạy, cộng thêm thiết kế idempotent để hai lượt chạy chồng nhau vẫn không gây hại.',
    },
  ],
  quiz: [
    {
      question: 'Vai trò của `NX` với `PX` trong `SET lock:job token NX PX 5000` là gì?',
      options: [
        '`NX` đảm bảo chỉ một client giành được; `PX` đặt hạn tự huỷ',
        '`NX` đặt hạn; `PX` đảm bảo tính duy nhất',
        'Cả hai đều chỉ đặt hạn',
        'Cả hai đều chỉ kiểm tra sự tồn tại',
      ],
      answerIndex: 0,
      explanation:
        'Thiếu `PX`, một client chết lúc đang giữ khoá sẽ chặn mọi người mãi mãi.',
    },
    {
      question: 'Vì sao mở khoá không thể chỉ là `DEL lock:job`?',
      options: [
        'Bất kỳ ai gọi cũng xoá được, kể cả khoá của người khác',
        'Vì `DEL` không xoá được `key` mang `PX`',
        'Vì `DEL` trả về nil khi `key` đang bị giữ',
        'Vì `DEL` làm mất token',
      ],
      answerIndex: 0,
      explanation:
        'Token nằm trong giá trị của `key` là bằng chứng quyền sở hữu. Mở khoá phải kiểm tra token trước khi xoá.',
    },
    {
      question: 'Khoảng hở giữa `GET` với `DEL` lúc mở khoá dẫn tới chuyện gì?',
      options: [
        'Khoá hết hạn rồi client khác giành được ngay trong khoảng đó, `DEL` xoá nhầm khoá của họ',
        '`GET` trả về giá trị cũ',
        'Token bị Redis ghi đè',
        'Khoá không bao giờ mở được',
      ],
      answerIndex: 0,
      explanation:
        'Khoảng hở đúng bằng thời gian giữa hai lượt round-trip. Gói cả hai vào một script thì nó biến mất.',
    },
    {
      question: 'Công việc kéo dài hơn `PX` của khoá. Cách xử lý đúng?',
      options: [
        'Một watchdog gia hạn khoá theo chu kỳ, cộng thiết kế idempotent',
        'Đặt `PX` thật lớn rồi thôi',
        'Bỏ `PX` để khoá khỏi hết hạn',
        'Giành lại khoá sau mỗi bước công việc',
      ],
      answerIndex: 0,
      explanation:
        'TTL của khoá là phỏng đoán về thời gian công việc, mà phỏng đoán thì sai được. Bỏ `PX` thì quay lại đúng bài toán client chết giữ khoá vĩnh viễn.',
    },
  ],
}
