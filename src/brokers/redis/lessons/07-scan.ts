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
  ],
}
