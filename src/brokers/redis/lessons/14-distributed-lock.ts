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
  ],
}
