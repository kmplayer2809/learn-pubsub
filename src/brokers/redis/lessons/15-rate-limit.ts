import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const rateLimit: RedisLesson = {
  id: '15-rate-limit',
  group: 'advanced',
  title: 'Sliding-window rate limit',
  summary:
    '`ZADD` ghi timestamp mỗi request vào một `zset`, `ZREMRANGEBYSCORE` xoá phần đã rơi khỏi cửa sổ, `ZCARD` đếm để so với hạn mức — cửa sổ trượt theo từng millisecond, không nhảy khối như fixed-window.',
  seed: 15,
  durationMs: 3000,
  topology: { clients: [APP], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '0', 'req-0'] },
    { at: 400, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '400', 'req-1'] },
    { at: 800, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '800', 'req-2'] },
    { at: 1200, clientId: APP.id, name: 'ZREMRANGEBYSCORE', args: ['ratelimit:ip1', '-inf', '200'] },
    { at: 1200, clientId: APP.id, name: 'ZCARD', args: ['ratelimit:ip1'] },
    { at: 1600, clientId: APP.id, name: 'ZADD', args: ['ratelimit:ip1', '1600', 'req-3'] },
    { at: 1600, clientId: APP.id, name: 'ZCARD', args: ['ratelimit:ip1'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Mỗi request là một member trong zset, score là thời điểm',
      body: 'Không đếm bằng một con số duy nhất — mỗi request có mặt riêng trong `zset`, xếp theo đúng thời điểm nó tới.',
      highlight: ['app', 'redis'],
    },
    {
      at: 1200,
      title: 'ZREMRANGEBYSCORE cắt đúng phần đã rơi khỏi cửa sổ 1000ms',
      body: 'Cửa sổ trượt: tại t=1200, chỉ request nào có score < 200 (tức là cũ hơn 1000ms so với hiện tại) mới bị cắt — req-0 (score 0) rơi khỏi cửa sổ, req-1 và req-2 vẫn còn.',
      highlight: ['redis'],
    },
    {
      at: 1600,
      title: 'ZCARD sau khi cắt là con số dùng để so với hạn mức',
      body: 'Không phải tổng số request từng tới — chỉ đếm những gì còn nằm trong cửa sổ hiện tại. Đây là điểm khác fixed-window: fixed-window nhảy khối theo giây/phút cố định, sliding-window trượt liên tục theo từng millisecond.',
      highlight: ['app'],
    },
  ],
  checkpoints: [
    {
      at: 2600,
      question: 'ZREMRANGEBYSCORE chạy trước ZCARD trong mỗi lượt kiểm tra rate limit. Vì sao thứ tự này quan trọng?',
      options: [
        'Không quan trọng, hai lệnh độc lập nhau',
        'ZCARD phải đếm sau khi đã cắt phần cũ, nếu không con số sẽ tính luôn cả request đã rơi khỏi cửa sổ',
        'ZREMRANGEBYSCORE cần ZCARD chạy trước để biết cắt bao nhiêu',
      ],
      answerIndex: 1,
      explanation: 'ZCARD chỉ đếm số member đang có trong zset tại thời điểm gọi — nếu gọi trước khi cắt phần cũ, request đã hết hạn vẫn bị tính vào hạn mức, làm rate limiter từ chối oan những request lẽ ra hợp lệ.',
    },
  ],
}
