import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const ttl: RedisLesson = {
  id: '06-ttl',
  group: 'basics',
  title: 'TTL: lazy và active expire',
  summary:
    '`TTL` cho biết còn bao lâu, còn khoảng cách giữa lazy expire cùng active cycle cho thấy vì sao một `key` hết hạn vẫn có thể nằm im trong bộ nhớ một lúc.',
  seed: 6,
  durationMs: 20_000,
  topology: {
    clients: [APP],
    // The shared SERVER constant is frozen, so an override rebuilds it.
    // A deliberately slow cycle (Redis' own default is 100ms) is what makes
    // the gap between lazy and active expiry visible on the canvas instead
    // of only theoretical.
    server: { ...SERVER, activeExpireEveryMs: 5000 },
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['session:1', 'tokenA', 'EX', '3'] },
    { at: 200, clientId: APP.id, name: 'SET', args: ['session:2', 'tokenB', 'EX', '3'] },
    { at: 1000, clientId: APP.id, name: 'TTL', args: ['session:1'] },
    { at: 4000, clientId: APP.id, name: 'GET', args: ['session:1'] },
    { at: 4500, clientId: APP.id, name: 'DBSIZE', args: [] },
    { at: 5500, clientId: APP.id, name: 'TTL', args: ['session:2'] },
    { at: 7000, clientId: APP.id, name: 'SET', args: ['session:3', 'tokenC'] },
    { at: 8000, clientId: APP.id, name: 'TTL', args: ['session:3'] },
    { at: 9000, clientId: APP.id, name: 'PERSIST', args: ['session:3'] },
  ],
  narrative: [
    {
      at: 0,
      title: '`EX` đặt hạn, `TTL` báo còn lại bao lâu',
      body: '`EX` đặt một hạn chót tuyệt đối cho `key`, còn `TTL` chỉ đọc lại xem còn bao nhiêu giây trước khi hạn đó tới.',
      highlight: ['app', 'redis'],
    },
    {
      at: 3500,
      title: 'Hết hạn không xoá ngay lập tức',
      body: 'Một `key` qua hạn chót không biến mất ngay tại đúng khoảnh khắc đó — Redis chẳng có lịch hẹn giờ riêng cho từng `key`.',
      highlight: ['redis'],
    },
    {
      at: 4000,
      title: 'Lệnh đọc đầu tiên xoá lazy',
      body: 'Lệnh đầu tiên chạm vào một `key` đã hết hạn sẽ xoá nó ngay tại chỗ — đó là lý do `GET` ở đây vừa miss vừa giải phóng luôn vùng nhớ đang giữ.',
      highlight: ['app', 'redis'],
    },
    {
      at: 5000,
      title: 'Active cycle quét nền theo đợt',
      body: 'Chu kỳ active expire quét một lượng `key` giới hạn mỗi lần thức dậy, một keyspace lớn cần nhiều đợt mới rút cạn hết — khoảng cách 5 giây ở đây làm lộ rõ độ trễ đó thay vì chỉ nằm trên lý thuyết.',
      highlight: ['redis'],
    },
    {
      at: 9000,
      title: '`-1` và `-2` là hai câu trả lời khác nhau',
      body: '`TTL` trả về `-1` khi `key` còn sống nhưng không mang hạn, còn `-2` khi `key` đã biến mất hẳn — hai con số này tuyệt đối không được nhầm lẫn.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 16_000,
      question: 'Key hết hạn lúc t=3000 nhưng không ai đọc. Lúc t=3500 memory đã được giải phóng chưa?',
      options: ['Rồi, Redis xoá đúng lúc hết hạn', 'Chưa chắc — chờ lazy read hoặc active cycle', 'Không bao giờ, phải DEL tay'],
      answerIndex: 1,
      explanation:
        'Redis không xoá đúng khoảnh khắc hết hạn — vùng nhớ chỉ thật sự giải phóng khi có một lượt đọc lazy chạm vào `key` đó, hoặc khi active cycle quét tới nó.',
    },
  ],
}
