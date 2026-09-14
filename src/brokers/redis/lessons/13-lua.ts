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
      at: 1200,
      question: 'Hai `redis.call` liên tiếp trong một script có thể bị lệnh của client khác chen vào giữa không?',
      options: [
        'Không — cả script tính là một bước',
        'Có, nếu script chạy quá lâu',
        'Có, khi nhiều client cùng gọi `EVAL`',
      ],
      answerIndex: 0,
      explanation:
        'Đó chính là lý do gói cặp kiểm tra rồi hành động vào một `EVAL`: khoảng hở giữa hai lệnh rời biến mất hoàn toàn.',
    },
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
    {
      at: 2000,
      question: 'Tổng kết: một script Lua chạy mất 5 giây. Chuyện gì xảy ra với các client khác?',
      options: [
        'Tất cả bị chặn — Redis đơn luồng, script giữ trọn server suốt 5 giây',
        'Chúng vẫn được phục vụ song song, script chạy trên luồng riêng',
        'Redis tự huỷ script sau một ngưỡng rồi phục vụ tiếp',
      ],
      answerIndex: 0,
      explanation:
        'Chính tính atomicity gây ra điều này: không lệnh nào chen được vào giữa nghĩa là không lệnh nào chạy được, chấm hết. Script Lua phải ngắn gọn. `busy-reply-threshold` chỉ khiến Redis bắt đầu trả lỗi `BUSY` cho client khác, chứ không dừng script — trừ khi bị `SCRIPT KILL`.',
    },
  ],
  quiz: [
    {
      question: '`EVAL` đem lại tính chất gì?',
      options: [
        'Cả script chạy như một bước không chia cắt',
        'Mỗi `redis.call` chạy song song',
        'Script chạy trên một luồng riêng',
        'Script được rollback khi gặp lỗi',
      ],
      answerIndex: 0,
      explanation:
        'Mỗi `redis.call` vẫn đi qua đúng bộ xử lý lệnh thông thường, nhưng engine không xen sự kiện nào vào giữa chúng.',
    },
    {
      question: 'Vì sao script Lua phải viết ngắn gọn?',
      options: [
        'Redis đơn luồng, script giữ trọn server suốt thời gian chạy',
        'Redis giới hạn script ở một trăm dòng',
        'Script dài tốn nhiều bộ nhớ cache',
        'Script dài mất tính nguyên tử',
      ],
      answerIndex: 0,
      explanation:
        'Chính tính nguyên tử gây ra điều này: không lệnh nào chen được vào nghĩa là không lệnh nào chạy được.',
    },
    {
      question: '`busy-reply-threshold` làm gì khi một script chạy quá lâu?',
      options: [
        'Bắt đầu trả `BUSY` cho client khác, script vẫn chạy tiếp',
        'Dừng script ngay lập tức',
        'Chuyển script sang một luồng nền',
        'Hạ mức ưu tiên của script',
      ],
      answerIndex: 0,
      explanation:
        'Chỉ `SCRIPT KILL` mới dừng được script, còn script đã ghi dữ liệu thì phải `SHUTDOWN NOSAVE` — thêm một lý do để giữ script ngắn.',
    },
    {
      question: 'Cặp `GET` rồi `DEL` viết rời nhau gặp vấn đề gì?',
      options: [
        'Giữa hai lệnh có khoảng hở cho client khác đổi giá trị',
        '`DEL` không xoá được `key` vừa đọc',
        '`GET` làm `key` mất `TTL`',
        'Hai lệnh rời tốn gấp đôi bộ nhớ',
      ],
      answerIndex: 0,
      explanation:
        'Kiểm tra rồi hành động chỉ an toàn khi cả hai nằm trong cùng một bước. Đây đúng là nền của phần mở khoá phân tán ở bài sau.',
    },
  ],
}
