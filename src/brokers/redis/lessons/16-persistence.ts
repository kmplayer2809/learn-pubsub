import { APP } from './types'
import type { RedisLesson } from './types'

export const persistence: RedisLesson = {
  id: '16-persistence',
  group: 'advanced',
  title: 'RDB vs AOF',
  summary:
    'Một server chỉ dùng RDB `everySec`: chụp toàn bộ keyspace theo chu kỳ rồi crash đúng vào khoảng hở giữa hai lần chụp — ghi nào rơi vào khoảng hở đó sẽ mất. Checkpoint đối chiếu kết quả này với `aof: "always"` (giả định) để thấy vì sao fsync mỗi lệnh tránh được khoảng hở đó.',
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
      at: 2400,
      question: 'Sau restart, server phục hồi từ đâu?',
      options: [
        'Bản chụp RDB gần nhất nó có',
        'Trạng thái ngay trước lúc crash',
        'Một bản sao nằm trên replica',
      ],
      answerIndex: 0,
      explanation:
        'Mọi lệnh ghi sau bản chụp cuối rơi vào khoảng hở. Ở đây `b` được ghi sau bản chụp t=1000 nên nó không quay lại.',
    },
    {
      at: 2800,
      question: 'Nếu server này dùng aof: "always" thay vì RDB, sau cùng một cú crash thì b có còn sống không?',
      options: ['Vẫn mất, always không khác gì RDB', 'Còn sống — always fsync mỗi lệnh ghi, không có khoảng hở nào để mất', 'Tuỳ vào tốc độ đĩa'],
      answerIndex: 1,
      explanation: '`aof: always` fsync ngay sau mỗi lệnh ghi, nên tại bất kỳ thời điểm nào — kể cả ngay trước khi crash — mọi ghi đã hoàn tất đều đã nằm trên đĩa. Cái giá phải trả là một lần fsync cho mỗi lệnh ghi, chậm hơn hẳn everysec hay RDB.',
    },
    {
      at: 3000,
      question:
        'Tổng kết: cần khôi phục nhanh sau sự cố, đồng thời chấp nhận mất tối đa một giây dữ liệu. Cấu hình nào?',
      options: [
        'Bật đồng thời RDB cùng `aof: everysec` — RDB nạp nhanh, AOF vá phần đuôi',
        'Chỉ `aof: always`, an toàn nhất nên khỏi nghĩ thêm',
        'Chỉ RDB với chu kỳ chụp mỗi giây',
      ],
      answerIndex: 0,
      explanation:
        'Hai cơ chế này bù cho nhau chứ không loại trừ nhau: RDB là file nhị phân gọn, nạp lại rất nhanh, còn AOF `everysec` giữ phần ghi phát sinh sau bản chụp gần nhất trong phạm vi mất mát một giây. `always` thì chậm hơn mức cần thiết, còn RDB chụp mỗi giây gây tốn kém vì mỗi lần chụp là một lượt `fork` toàn bộ tiến trình.',
    },
  ],
  quiz: [
    {
      question: 'RDB lưu cái gì?',
      options: [
        'Bản chụp toàn bộ `key` tại một thời điểm',
        'Log từng lệnh ghi',
        'Chỉ `key` mang `TTL`',
        'Danh sách `key` đã bị eviction',
      ],
      answerIndex: 0,
      explanation:
        'Nhờ là file nhị phân gọn, RDB nạp lại rất nhanh. Cái giá là mọi lệnh ghi giữa hai bản chụp có thể mất.',
    },
    {
      question: '`aof: always` khác RDB ra sao?',
      options: [
        'fsync sau mỗi lệnh ghi nên không còn khoảng hở, đổi lại chậm hơn hẳn',
        'Chụp toàn bộ keyspace mỗi giây',
        'Chỉ ghi `key` mới, bỏ qua `key` cũ',
        'Ghi bất đồng bộ nên nhanh hơn RDB',
      ],
      answerIndex: 0,
      explanation:
        'Một lần fsync cho mỗi lệnh ghi là cái giá của việc không mất gì. `everysec` là điểm cân bằng thường dùng.',
    },
    {
      question: 'Vì sao RDB chụp mỗi giây lại tốn kém?',
      options: [
        'Mỗi lần chụp là một lượt `fork` toàn bộ tiến trình',
        'Vì file RDB không nén được',
        'Vì Redis phải khoá keyspace suốt lượt chụp',
        'Vì chu kỳ ngắn làm hỏng bản chụp trước',
      ],
      answerIndex: 0,
      explanation:
        '`fork` sao chép bảng trang của cả tiến trình; keyspace lớn thì chi phí đó lặp lại mỗi giây. AOF `everysec` cho cùng mức mất mát mà rẻ hơn.',
    },
    {
      question: 'Vì sao bật đồng thời RDB với AOF lại hợp lý?',
      options: [
        'RDB nạp nhanh phần thân, AOF vá phần đuôi phát sinh sau bản chụp',
        'Hai cơ chế kiểm tra chéo lỗi của nhau',
        'AOF thay RDB khi đĩa đầy',
        'RDB chỉ chạy khi AOF tắt',
      ],
      answerIndex: 0,
      explanation:
        'Hai cơ chế bù cho nhau chứ không loại trừ nhau: một bên lo tốc độ nạp, một bên lo phần mất mát gần nhất.',
    },
  ],
}
