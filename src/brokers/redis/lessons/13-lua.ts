import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const lua: RedisLesson = {
  id: '13-lua',
  group: 'advanced',
  title: 'Lua atomicity',
  summary:
    '`EVAL` chạy nguyên khối script không bị chen ngang — đối chiếu trực tiếp với hai lệnh rời làm cùng việc, nơi race condition có thể lọt vào giữa.',
  seed: 13,
  durationMs: 2000,
  topology: { clients: [APP], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['seq:name', 'first'] },
    { at: 300, clientId: APP.id, name: 'EVAL', args: [`redis.call('SET', KEYS[1], ARGV[1]) return redis.call('GET', KEYS[1])`, '1', 'seq:name', 'second'] },
    { at: 700, clientId: APP.id, name: 'EVAL', args: [`local ok = redis.call('GET', KEYS[1]) if ok == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`, '1', 'seq:name', 'second'] },
    { at: 1100, clientId: APP.id, name: 'GET', args: ['seq:name'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Một script, nhiều redis.call, một bước duy nhất',
      body: 'Bên trong `EVAL`, mỗi `redis.call` chạy qua đúng bộ xử lý lệnh mà mọi lệnh khác dùng — nhưng toàn bộ script tính là một bước, không command nào khác chen được vào giữa hai `redis.call` liên tiếp.',
      highlight: ['app', 'redis'],
    },
    {
      at: 700,
      title: 'Check-rồi-hành-động an toàn bên trong script',
      body: 'Đọc giá trị rồi quyết định có xoá hay không — làm bằng hai lệnh rời (`GET` xong `DEL`) sẽ có khoảng hở cho client khác chen vào giữa; gói cả hai vào một `EVAL` thì khoảng hở đó biến mất.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 1800,
      question: 'Vì sao gói "GET rồi DEL" vào một EVAL an toàn hơn gọi hai lệnh GET và DEL rời nhau?',
      options: [
        'Vì EVAL chạy nhanh hơn nên ít có cơ hội bị chen',
        'Vì cả script tính là một bước không thể chia cắt, không command nào khác chen được vào giữa GET và DEL',
        'Vì EVAL tự động khoá key lại trong lúc chạy',
      ],
      answerIndex: 1,
      explanation: 'Tốc độ không phải lý do — atomicity mới là lý do: engine không lên lịch một sự kiện mới nào cho từng redis.call bên trong script, nên không có khe hở thời gian nào cho một command khác len vào giữa.',
    },
  ],
}
