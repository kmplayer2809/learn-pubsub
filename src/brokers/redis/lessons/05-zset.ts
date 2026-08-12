import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const zset: RedisLesson = {
  id: '05-zset',
  group: 'basics',
  title: 'Sorted Set: leaderboard',
  summary:
    '`Sorted set` giữ thứ tự theo score ngay từ lúc ghi, nên `ZINCRBY` cộng `ZREVRANGE` cho một bảng xếp hạng luôn cập nhật tức thời.',
  seed: 5,
  durationMs: 14_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'ZADD', args: ['board', '100', 'ann', '250', 'bob', '175', 'cat'] },
    { at: 2000, clientId: APP.id, name: 'ZREVRANGE', args: ['board', '0', '2', 'WITHSCORES'] },
    { at: 4000, clientId: APP.id, name: 'ZINCRBY', args: ['board', '200', 'ann'] },
    { at: 6000, clientId: APP.id, name: 'ZREVRANGE', args: ['board', '0', '2', 'WITHSCORES'] },
    { at: 8000, clientId: APP.id, name: 'ZSCORE', args: ['board', 'cat'] },
    { at: 9500, clientId: APP.id, name: 'ZCARD', args: ['board'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Luôn sắp xếp sẵn theo score',
      body: 'Mỗi member trong `sorted set` mang một score, Redis giữ nguyên thứ tự đó ngay từ lúc ghi — đọc bảng xếp hạng chỉ là một range query, chưa từng cần một bước sort riêng.',
      highlight: ['app', 'redis'],
    },
    {
      at: 4000,
      title: '`ZINCRBY` cập nhật tại chỗ',
      body: '`ZINCRBY` cộng thêm vào score ngay tại chỗ, thứ tự trong `sorted set` thay đổi theo ngay lập tức — không có bước ghi lại toàn bộ danh sách.',
      highlight: ['app', 'redis'],
    },
    {
      at: 6000,
      title: '`ZREVRANGE` đọc top N không quét hết',
      body: '`ZREVRANGE` lấy đúng nhóm đầu bảng mà chẳng cần quét qua toàn bộ member còn lại phía sau.',
      highlight: ['redis'],
    },
    {
      at: 9500,
      title: 'Điểm bằng nhau vẫn có thứ tự cố định',
      body: 'Khi hai member trùng score, bộ mô phỏng này xếp theo tên để một lượt chạy luôn cho cùng một kết quả — Redis thật cũng cần một tie-break tương tự.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 11_000,
      question: 'Sau `ZINCRBY board 200 ann`, ai đứng đầu?',
      options: ['bob (250)', 'ann (300)', 'cat (175)'],
      answerIndex: 1,
      explanation:
        'Sau khi cộng thêm 200, score của `ann` tăng lên 300, vượt qua `bob` đang giữ 250, nên `ann` đứng đầu bảng xếp hạng.',
    },
  ],
}
