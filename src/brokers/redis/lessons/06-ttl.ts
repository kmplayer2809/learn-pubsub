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
      at: 10_000,
      question: 'Chu kỳ active expire quét theo cách nào?',
      options: [
        'Quét một lượng `key` giới hạn ở mỗi lần thức dậy',
        'Quét trọn keyspace trong một lần',
        'Chỉ quét khi bộ nhớ chạm `maxmemory`',
      ],
      answerIndex: 0,
      explanation:
        'Quét trọn keyspace trong một nhịp sẽ chặn server. Vì vậy một keyspace lớn cần nhiều đợt mới rút cạn hết `key` đã hết hạn.',
    },
    {
      at: 16_000,
      question: 'Key hết hạn lúc t=3000 nhưng không ai đọc. Lúc t=3500 memory đã được giải phóng chưa?',
      options: ['Rồi, Redis xoá đúng lúc hết hạn', 'Chưa chắc — chờ lazy read hoặc active cycle', 'Không bao giờ, phải DEL tay'],
      answerIndex: 1,
      explanation:
        'Redis không xoá đúng khoảnh khắc hết hạn — vùng nhớ chỉ thật sự giải phóng khi có một lượt đọc lazy chạm vào `key` đó, hoặc khi active cycle quét tới nó.',
    },
    {
      at: 20_000,
      question: 'Tổng kết: `TTL` trả về `-1` cho một `key`. Nghĩa là gì?',
      options: [
        '`key` còn sống nhưng không mang hạn nào',
        '`key` đã hết hạn, đang chờ được xoá',
        '`key` không tồn tại trong keyspace',
      ],
      answerIndex: 0,
      explanation:
        '`-1` nghĩa là có `key`, không có hạn. `-2` mới là `key` đã biến mất. Nhầm hai giá trị này thường dẫn tới lỗi kiểu coi mọi số âm đều là cache miss, trong khi `-1` lại chính là một `key` sống mãi mà lẽ ra phải mang TTL.',
    },
  ],
  quiz: [
    {
      question: 'Redis xoá một `key` đã hết hạn vào lúc nào?',
      options: [
        'Khi có lượt đọc chạm vào nó, hoặc khi active cycle quét tới',
        'Đúng khoảnh khắc hạn chót tới',
        'Khi client gọi `DEL`',
        'Khi bộ nhớ đầy',
      ],
      answerIndex: 0,
      explanation:
        'Không có lịch hẹn giờ riêng cho từng `key`. Vùng nhớ vẫn bị giữ cho tới khi một trong hai cơ chế kia chạm tới.',
    },
    {
      question: 'Phân biệt `-1` với `-2` trong kết quả của `TTL` ra sao?',
      options: [
        '`-1`: `key` còn sống, không mang hạn. `-2`: `key` không còn tồn tại',
        '`-1`: `key` đã hết hạn. `-2`: `key` sống mãi',
        'Hai giá trị đều nghĩa là `key` không tồn tại',
        '`-1`: lỗi cú pháp. `-2`: lỗi kiểu dữ liệu',
      ],
      answerIndex: 0,
      explanation:
        'Gộp mọi số âm thành một trường hợp là lỗi rất thường gặp: `-1` chính là một `key` sống mãi mà lẽ ra phải mang hạn.',
    },
    {
      question: '`PERSIST` làm gì?',
      options: [
        'Gỡ hạn của `key`, biến nó thành vĩnh viễn',
        'Ghi `key` xuống đĩa ngay',
        'Gia hạn thêm một chu kỳ',
        'Đặt hạn mặc định cho `key`',
      ],
      answerIndex: 0,
      explanation:
        'Sau `PERSIST`, `TTL` trả về `-1`. Đây là cách gỡ hạn mà khỏi phải ghi lại giá trị.',
    },
    {
      question: 'Lệnh `GET` chạm vào một `key` đã quá hạn đem lại hai kết quả nào?',
      options: [
        'Trả về `(nil)`, đồng thời xoá luôn `key` để giải phóng vùng nhớ',
        'Trả về giá trị cũ, rồi mới xoá `key`',
        'Trả về lỗi, `key` vẫn nằm đó',
        'Gia hạn `key` thêm một chu kỳ rồi trả giá trị',
      ],
      answerIndex: 0,
      explanation:
        'Đó chính là xoá lazy: lượt đọc đầu tiên vừa báo miss vừa dọn dẹp. `DBSIZE` sau đó mới phản ánh đúng số `key` còn sống.',
    },
  ],
}
