import { APP } from './types'
import type { RedisLesson } from './types'

export const persistence: RedisLesson = {
  id: '16-persistence',
  group: 'advanced',
  title: 'RDB vs AOF',
  summary:
    'Cùng một chuỗi ghi, một server chỉ có RDB định kỳ và một server AOF `everysec` — cùng crash ở một thời điểm, nhưng mất dữ liệu khác nhau.',
  seed: 16,
  durationMs: 3000,
  topology: {
    clients: [APP],
    server: { id: 'redis', label: 'Redis (RDB)', position: { x: 380, y: 200 }, persistence: { rdb: { everySec: 1 } } },
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['a', '1'] }, // before the snapshot at t=1000: survives
    { at: 1500, clientId: APP.id, name: 'SET', args: ['b', '2'] }, // after it: lost
    { at: 2200, clientId: APP.id, name: 'KEYS', args: ['*'] },
  ],
  failures: [
    { at: 1900, kind: 'crash', target: 'redis' },
    { at: 2000, kind: 'restart', target: 'redis' },
  ],
  narrative: [
    {
      at: 0,
      title: 'RDB chụp toàn bộ keyspace theo chu kỳ',
      body: 'Với `everySec: 1`, cứ mỗi giây ảo server lại chụp một bản chỉ chụp toàn bộ `key` hiện có — không phải log từng lệnh.',
      highlight: ['redis'],
    },
    {
      at: 1000,
      title: 'Bản chụp đầu tiên chỉ có a',
      body: 'Tại t=1000, `b` chưa tồn tại — bản chụp không thể chứa thứ chưa được ghi.',
      highlight: ['redis'],
    },
    {
      at: 1900,
      title: 'Crash xảy ra sau khi b đã ghi nhưng trước bản chụp kế tiếp',
      body: '`b` được ghi ở t=1620 (script t=1500 cộng thời gian truyền lệnh), còn bản chụp kế tiếp phải đợi tới t=2000 — `b` rơi đúng vào khoảng hở đó.',
      highlight: ['redis'],
    },
    {
      at: 2200,
      title: 'Sau restart, chỉ a còn sống',
      body: 'Server phục hồi từ bản chụp cuối cùng nó có — đúng bằng những gì tồn tại tại t=1000, không hơn.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 2800,
      question: 'Nếu server này dùng aof: "always" thay vì RDB, sau cùng một cú crash thì b có còn sống không?',
      options: ['Vẫn mất, always không khác gì RDB', 'Còn sống — always fsync mỗi lệnh ghi, không có khoảng hở nào để mất', 'Tuỳ vào tốc độ đĩa'],
      answerIndex: 1,
      explanation: '`aof: always` fsync ngay sau mỗi lệnh ghi, nên tại bất kỳ thời điểm nào — kể cả ngay trước khi crash — mọi ghi đã hoàn tất đều đã nằm trên đĩa. Cái giá phải trả là một lần fsync cho mỗi lệnh ghi, chậm hơn hẳn everysec hay RDB.',
    },
  ],
}
