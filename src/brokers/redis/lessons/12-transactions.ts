import { APP, SERVER, WORKER } from './types'
import type { RedisLesson } from './types'

export const transactions: RedisLesson = {
  id: '12-transactions',
  group: 'advanced',
  title: 'Transactions',
  summary:
    '`MULTI`/`EXEC` gộp nhiều lệnh thành một bước duy nhất; `WATCH` huỷ `EXEC` nếu `key` đang theo dõi đổi giữa chừng.',
  seed: 12,
  durationMs: 3500,
  topology: { clients: [APP, WORKER], server: SERVER },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['balance:1', '100'] },
    { at: 300, clientId: APP.id, name: 'MULTI', args: [] },
    { at: 500, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 700, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 900, clientId: APP.id, name: 'EXEC', args: [] },
    { at: 1400, clientId: APP.id, name: 'WATCH', args: ['balance:1'] },
    { at: 1600, clientId: WORKER.id, name: 'SET', args: ['balance:1', '999'] },
    { at: 2000, clientId: APP.id, name: 'MULTI', args: [] },
    { at: 2200, clientId: APP.id, name: 'INCR', args: ['balance:1'] },
    { at: 2400, clientId: APP.id, name: 'EXEC', args: [] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Lệnh bên trong MULTI chỉ xếp hàng, chưa chạy',
      body: 'Từ lúc `MULTI` tới trước `EXEC`, mỗi lệnh gửi lên chỉ nhận `QUEUED` — chưa hề đụng vào `key` nào cả.',
      highlight: ['app', 'redis'],
    },
    {
      at: 900,
      title: 'EXEC chạy trọn khối một lượt',
      body: 'Cả hai `INCR` chạy liền nhau trong đúng một bước — không command nào khác của client khác chen được vào giữa.',
      highlight: ['redis'],
    },
    {
      at: 1400,
      title: 'WATCH đặt một điều kiện, không phải một khoá',
      body: '`WATCH` không chặn `worker` ghi đè `balance:1` — nó chỉ ghi nhớ phiên bản hiện tại của `key` để `EXEC` so sánh lại sau.',
      highlight: ['app'],
    },
    {
      at: 1600,
      title: 'worker ghi đè ngay trong lúc app đang theo dõi',
      body: '`worker` không biết và không cần biết `app` đang `WATCH` — đây chính là race condition mà `WATCH` được sinh ra để phát hiện.',
      highlight: ['worker', 'redis'],
    },
    {
      at: 2400,
      title: 'EXEC lần hai bị huỷ',
      body: '`balance:1` đã đổi kể từ lúc `WATCH` — `EXEC` từ chối chạy khối lệnh, trả về nil thay vì âm thầm ghi đè lên giá trị mà `worker` vừa đặt.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 3200,
      question: 'worker ghi đè balance:1 trong lúc app đang WATCH nó. EXEC của app sau đó làm gì?',
      options: ['Chạy bình thường, đè lên giá trị của worker', 'Từ chối chạy, trả về nil', 'Báo lỗi và crash'],
      answerIndex: 1,
      explanation: '`EXEC` so phiên bản của `balance:1` tại lúc `WATCH` với phiên bản hiện tại — lệch nhau thì huỷ toàn bộ khối lệnh, trả về nil, không chạy gì.',
    },
  ],
}
