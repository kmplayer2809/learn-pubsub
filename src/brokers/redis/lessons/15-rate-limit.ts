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
      at: 1800,
      question: 'Tại t=1200, `ZREMRANGEBYSCORE ratelimit:ip1 -inf 200` cắt phần nào?',
      options: [
        'Request có score nhỏ hơn 200, tức cũ hơn cửa sổ 1000ms',
        'Toàn bộ request trong `key`',
        'Request mới nhất',
      ],
      answerIndex: 0,
      explanation:
        'Cửa sổ trượt luôn tính ngược từ hiện tại, nên biên dưới đổi theo từng lượt kiểm tra thay vì nhảy khối theo giây cố định.',
    },
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
    {
      at: 3000,
      question:
        'Tổng kết: rate limiter này chạy trên nhiều máy chủ ứng dụng cùng lúc. Điểm yếu còn lại là gì?',
      options: [
        'Ba lệnh rời nhau tạo khoảng hở — nên gói vào một `EVAL` hoặc `MULTI`',
        '`zset` không dùng chung được giữa nhiều máy chủ',
        'Mỗi máy chủ cần một `key` `ratelimit` riêng của nó',
      ],
      answerIndex: 0,
      explanation:
        'Trạng thái nằm chung trong Redis nên nhiều máy chủ dùng chung được, đó là điểm mạnh. Vấn đề là `ZREMRANGEBYSCORE`, `ZCARD`, `ZADD` là ba lượt round-trip riêng biệt: nhiều máy chủ đọc `ZCARD` cùng lúc rồi đều thấy còn hạn mức, nên tổng số request lọt qua vượt trần. Gói cả ba vào một Lua script thì phần kiểm tra cộng ghi trở thành một bước duy nhất.',
    },
  ],
  quiz: [
    {
      question: 'Sliding window log lưu mỗi request theo cách nào?',
      options: [
        'Một member trong `zset`, score là thời điểm request tới',
        'Một lượt `INCR` trên một bộ đếm',
        'Một phần tử trong `list`',
        'Một field trong `hash`',
      ],
      answerIndex: 0,
      explanation:
        'Nhờ score chính là thời gian, phần rơi khỏi cửa sổ cắt được bằng đúng một lệnh range.',
    },
    {
      question: 'Gọi `ZCARD` trước khi cắt phần cũ dẫn tới chuyện gì?',
      options: [
        'Request đã rơi khỏi cửa sổ vẫn bị tính, limiter từ chối oan',
        'Con số trả về luôn bằng 0',
        '`ZREMRANGEBYSCORE` sau đó không chạy được',
        'Cửa sổ bị kéo dài gấp đôi',
      ],
      answerIndex: 0,
      explanation:
        '`ZCARD` chỉ đếm những gì đang có tại thời điểm gọi, nên thứ tự hai lệnh quyết định con số đem so với hạn mức.',
    },
    {
      question: 'Sliding window khác fixed window ở điểm nào?',
      options: [
        'Fixed window nhảy khối theo mốc cố định; sliding window trượt liên tục',
        'Sliding window chỉ đếm được một client',
        'Fixed window cần `zset`, sliding window cần `list`',
        'Hai cách cho kết quả giống hệt nhau',
      ],
      answerIndex: 0,
      explanation:
        'Mốc cố định cho phép dồn gần gấp đôi hạn mức quanh ranh giới giữa hai khối. Cửa sổ trượt không có ranh giới đó.',
    },
    {
      question: 'Vì sao nên gói ba lệnh của limiter vào một Lua script?',
      options: [
        'Ba lượt round-trip riêng để lộ khoảng hở: nhiều máy chủ cùng thấy còn hạn mức rồi cùng cho qua',
        'Vì Lua chạy nhanh hơn ba lệnh rời',
        'Vì `zset` chỉ dùng được bên trong script',
        'Vì script tự chia hạn mức theo từng máy chủ',
      ],
      answerIndex: 0,
      explanation:
        'Trạng thái nằm chung trong Redis nên nhiều máy chủ chia sẻ được, đó là điểm mạnh. Phần kiểm tra cộng ghi mới là chỗ cần gộp thành một bước.',
    },
  ],
}
