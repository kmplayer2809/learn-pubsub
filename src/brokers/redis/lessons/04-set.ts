import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const set: RedisLesson = {
  id: '04-set',
  group: 'basics',
  title: 'Set',
  summary:
    'Set khử trùng lặp ngay khi ghi, còn `SINTER` tính giao trực tiếp bên trong Redis mà không cần truyền cả hai tập qua mạng.',
  seed: 4,
  durationMs: 12_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SADD', args: ['online:mon', 'ann', 'bob', 'cat'] },
    { at: 1500, clientId: APP.id, name: 'SADD', args: ['online:tue', 'bob', 'cat', 'dan'] },
    { at: 3000, clientId: APP.id, name: 'SADD', args: ['online:mon', 'bob'] },
    { at: 4500, clientId: APP.id, name: 'SISMEMBER', args: ['online:mon', 'ann'] },
    { at: 6000, clientId: APP.id, name: 'SINTER', args: ['online:mon', 'online:tue'] },
    { at: 7500, clientId: APP.id, name: 'SCARD', args: ['online:mon'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Set không lưu trùng',
      body: '`SADD` tự động bỏ qua phần tử đã có, nên không cần đọc trước rồi mới quyết định ghi — việc khử trùng lặp nằm sẵn trong chính thao tác ghi.',
      highlight: ['app', 'redis'],
    },
    {
      at: 4500,
      title: '`SISMEMBER` không kéo cả set về',
      body: '`SISMEMBER` chỉ kiểm tra một phần tử có mặt hay không, trả lời ngay tại server mà chẳng cần truyền nguyên `set` qua mạng.',
      highlight: ['redis'],
    },
    {
      at: 6000,
      title: '`SINTER` tính giao ngay trong Redis',
      body: '`SINTER` tính phần giao giữa nhiều `set` ngay bên trong Redis — mạng chỉ phải mang đúng kết quả cuối, chưa từng phải mang một trong hai `set` gốc.',
      highlight: ['app', 'redis'],
    },
    {
      at: 7500,
      title: 'Không có thứ tự đảm bảo',
      body: 'Redis thật không đảm bảo thứ tự cho `SMEMBERS`, nhưng bộ mô phỏng này cố định theo thứ tự chèn để một lượt chạy luôn phát lại giống hệt — code thật không được phép dựa vào thứ tự đó.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 9000,
      question: '`SADD` một member đã có trả về gì?',
      options: ['(integer) 0', '(integer) 1', '(error)'],
      answerIndex: 0,
      explanation:
        '`SADD` chỉ đếm phần tử mới thêm; một member đã tồn tại sẵn không làm gì thêm cả, nên kết quả luôn là `(integer) 0`.',
    },
  ],
}
