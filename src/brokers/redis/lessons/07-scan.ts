import type { RedisScriptedCommand } from '../engine'
import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

const seedKeys: RedisScriptedCommand[] = Array.from({ length: 12 }, (_, i): RedisScriptedCommand => ({
  at: i * 200,
  clientId: APP.id,
  name: 'SET',
  args: [`user:${i + 1}`, 'v'],
}))

export const scan: RedisLesson = {
  id: '07-scan',
  group: 'basics',
  title: 'SCAN thay vì KEYS',
  summary:
    '`KEYS` quét trọn keyspace trong một nhịp chặn, còn `SCAN` trả về từng trang nhỏ kèm cursor để server luôn còn rảnh tay phục vụ request khác.',
  seed: 7,
  durationMs: 16_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    ...seedKeys,
    { at: 3000, clientId: APP.id, name: 'KEYS', args: ['user:*'] },
    { at: 5000, clientId: APP.id, name: 'SCAN', args: ['0', 'COUNT', '5'] },
    { at: 7000, clientId: APP.id, name: 'SCAN', args: ['5', 'COUNT', '5'] },
    { at: 9000, clientId: APP.id, name: 'SCAN', args: ['10', 'COUNT', '5'] },
    { at: 11_000, clientId: APP.id, name: 'DBSIZE', args: [] },
  ],
  narrative: [
    {
      at: 3000,
      title: '`KEYS` chặn cả server trong một nhịp',
      body: '`KEYS` quét trọn keyspace trong một lượt duy nhất — mười hai `key` thì vô hại, mười triệu `key` thì thành một sự cố ngoài production.',
      highlight: ['app', 'redis'],
    },
    {
      at: 5000,
      title: '`SCAN` trả cursor cùng một trang nhỏ',
      body: '`SCAN` trả về một cursor cùng một trang giới hạn, server luôn còn rảnh tay giữa hai lượt gọi thay vì bị giữ chân suốt một lượt quét khổng lồ.',
      highlight: ['redis'],
    },
    {
      at: 9000,
      title: 'Cursor không phải một bản snapshot',
      body: 'Một `key` bị thêm hoặc xoá giữa lượt quét có thể bị bỏ sót hoặc xuất hiện hai lần — `SCAN` chỉ đảm bảo một `key` sống suốt cả lượt quét sẽ xuất hiện ít nhất một lần, không hơn.',
      highlight: ['app', 'redis'],
    },
    {
      at: 11_000,
      title: 'Cursor ở đây chỉ là một chỉ số đơn giản',
      body: 'Cursor của bộ mô phỏng này là một chỉ số vào thứ tự chèn — một giản lược cho dễ hiểu. Cursor thật của Redis là một cấu trúc bucket nhị phân đảo ngược, code không được phép dựa vào cách biểu diễn của bên nào trong hai kiểu đó.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 6000,
      question: 'Vì sao `KEYS user:*` nguy hiểm ngoài production?',
      options: [
        'Nó quét trọn keyspace trong một nhịp, giữ chân server suốt lượt quét',
        'Nó xoá mọi `key` không khớp pattern',
        'Nó chỉ chạy được trên replica',
      ],
      answerIndex: 0,
      explanation:
        'Redis xử lý lệnh tuần tự, nên một lượt `KEYS` trên mười triệu `key` chặn mọi client khác cho tới lúc xong. `SCAN` chia việc đó thành nhiều trang nhỏ.',
    },
    {
      at: 13_000,
      question: '`SCAN` đảm bảo gì?',
      options: [
        'Mỗi key xuất hiện đúng một lần',
        'Key tồn tại suốt scan sẽ xuất hiện ít nhất một lần',
        'Snapshot tại thời điểm bắt đầu',
      ],
      answerIndex: 1,
      explanation:
        '`SCAN` chỉ cam kết một `key` sống suốt toàn bộ lượt quét sẽ xuất hiện ít nhất một lần — không cam kết đúng một lần, cũng không phải một bản snapshot tại thời điểm bắt đầu.',
    },
    {
      at: 16_000,
      question:
        'Tổng kết: `SCAN` có thể trả về cùng một `key` hai lần. Vòng lặp xử lý nên viết ra sao?',
      options: [
        'Thao tác phải idempotent, chạy lại trên cùng `key` vẫn cho kết quả đúng',
        'Nhớ mọi `key` đã thấy trong một `set` phía ứng dụng để lọc trùng',
        'Quay về dùng `KEYS` cho chắc chắn không trùng',
      ],
      answerIndex: 0,
      explanation:
        'Trùng lặp là đặc tính của `SCAN`, không phải lỗi. Thao tác idempotent như `DEL` hay `EXPIRE` chịu được điều đó mà không tốn gì. Bộ nhớ chống trùng phía client thì phình theo kích thước keyspace, đúng thứ `SCAN` sinh ra để tránh, còn `KEYS` thì đánh đổi bằng việc chặn cả server.',
    },
  ],
  quiz: [
    {
      question: '`SCAN` trả về gì?',
      options: [
        'Một cursor cùng một trang `key` giới hạn',
        'Toàn bộ `key` khớp pattern',
        'Số lượng `key` trong keyspace',
        'Một snapshot của keyspace',
      ],
      answerIndex: 0,
      explanation:
        'Cursor dành cho lượt gọi kế tiếp, còn server rảnh tay giữa hai lượt gọi. `COUNT` chỉ là gợi ý kích thước trang, không phải cam kết.',
    },
    {
      question: 'Một `key` được thêm vào giữa lượt quét có chắc chắn xuất hiện không?',
      options: [
        'Không — chỉ `key` sống suốt cả lượt quét mới chắc chắn xuất hiện ít nhất một lần',
        'Có, cursor luôn bắt kịp `key` mới',
        'Có, nếu `COUNT` đủ lớn',
        'Không, `key` mới luôn bị bỏ qua',
      ],
      answerIndex: 0,
      explanation:
        'Cursor không phải một bản snapshot. `key` thêm hoặc xoá giữa chừng có thể bị bỏ sót, hoặc xuất hiện hai lần.',
    },
    {
      question: 'Vì sao chống trùng bằng một `set` phía client lại phản tác dụng?',
      options: [
        'Bộ nhớ đó phình theo kích thước keyspace, đúng thứ `SCAN` sinh ra để tránh',
        'Vì `set` phía client không so sánh được `key` nhị phân',
        'Vì cursor đổi sau mỗi lượt gọi',
        'Vì Redis từ chối lượt quét thứ hai',
      ],
      answerIndex: 0,
      explanation:
        'Trùng lặp là đặc tính, không phải lỗi. Thao tác idempotent như `DEL` hay `EXPIRE` chịu được trùng mà chẳng tốn thêm gì.',
    },
    {
      question: 'Cursor của `SCAN` nên được hiểu thế nào?',
      options: [
        'Một giá trị mờ, chỉ để truyền lại cho lượt gọi kế tiếp',
        'Một chỉ số vào thứ tự chèn',
        'Số `key` đã quét được',
        'Một dấu thời gian',
      ],
      answerIndex: 0,
      explanation:
        'Bộ mô phỏng này dùng chỉ số cho dễ hiểu, còn Redis thật dùng bucket nhị phân đảo ngược. Code không được dựa vào cách biểu diễn của bên nào.',
    },
  ],
}
