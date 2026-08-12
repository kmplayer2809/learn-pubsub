import { APP, SERVER, WORKER, type RedisLesson } from './types'
import type { RedisScriptedCommand } from '../engine'

/** A third reader — three concurrent readers is the minimum that shows a stampede. */
const APP2 = Object.freeze({ id: 'app2', label: 'App 2', position: { x: 40, y: 200 } })

// The engine dispatches deterministically by time, and every `SETNX` here lands
// 100ms apart with no tie, so the client scripted first (`app`, at 7000) is
// always the one whose reply reaches the handler first and wins the lock —
// confirmed by running the simulation before writing this comment, not assumed.
const script: RedisScriptedCommand[] = [
  { at: 0, clientId: 'app', name: 'SET', args: ['hot:key', 'value', 'EX', '4'] },
  { at: 5000, clientId: 'app', name: 'GET', args: ['hot:key'] },
  { at: 5100, clientId: 'app2', name: 'GET', args: ['hot:key'] },
  { at: 5200, clientId: 'worker', name: 'GET', args: ['hot:key'] },
  { at: 7000, clientId: 'app', name: 'SETNX', args: ['lock:hot:key', '1'] },
  { at: 7100, clientId: 'app2', name: 'SETNX', args: ['lock:hot:key', '1'] },
  { at: 7200, clientId: 'worker', name: 'SETNX', args: ['lock:hot:key', '1'] },
  { at: 8000, clientId: 'app', name: 'SET', args: ['hot:key', 'value2', 'EX', '4'] },
  { at: 8200, clientId: 'app', name: 'DEL', args: ['lock:hot:key'] },
  { at: 9000, clientId: 'app', name: 'GET', args: ['hot:key'] },
  { at: 9100, clientId: 'app2', name: 'GET', args: ['hot:key'] },
  { at: 9200, clientId: 'worker', name: 'GET', args: ['hot:key'] },
]

export const stampede: RedisLesson = {
  id: '10-stampede',
  group: 'cache',
  title: 'Cache stampede',
  summary: 'Một key hết hạn cộng nhiều reader đọc cùng lúc kéo theo nhiều lượt đọc database thừa cho cùng một giá trị.',
  seed: 10,
  durationMs: 22_000,
  topology: { clients: [APP, WORKER, APP2], server: SERVER },
  script,
  narrative: [
    {
      at: 0,
      title: 'Một key hết hạn cộng nhiều reader đồng thời bằng stampede',
      body: 'Khi `hot:key` hết hạn đúng lúc ba client cùng gọi `GET`, cả ba đều miss trong một khoảng rất ngắn, kéo theo ba lượt đọc `database` cho cùng một giá trị — đó chính là `cache stampede`.',
      highlight: ['app', 'app2', 'worker', 'redis'],
    },
    {
      at: 5000,
      title: 'Ba reader không hề sai, cái sai là thời điểm hết hạn trùng nhau',
      body: '`app`, `app2` và `worker` không làm gì sai cả, chúng chỉ tình cờ đọc đúng lúc key vừa chết. Miss xảy ra đồng thời bởi vì hạn dùng của key là một điểm duy nhất, không phải vì logic đọc có lỗi.',
      highlight: ['app', 'app2', 'worker'],
    },
    {
      at: 7000,
      title: '`SETNX` bầu ra đúng một người xây lại cache',
      body: 'Lệnh `SETNX lock:hot:key 1` (hay `SET key value NX`) chỉ cho đúng một client tạo được khoá, những client còn lại nhận `0` và lùi lại thay vì cùng đi đọc `database`.',
      highlight: ['app', 'app2', 'worker', 'redis'],
    },
    {
      at: 8000,
      title: 'Khoá tự xây lại cần có `TTL` riêng của nó',
      body: 'Nếu người thắng khoá chết trước khi kịp ghi lại `hot:key`, một khoá không có hạn dùng sẽ giữ mọi reader khác chờ mãi mãi. Gắn `TTL` riêng cho `lock:hot:key` là cách đảm bảo khoá luôn tự giải phóng, kể cả khi rebuilder gặp sự cố.',
      highlight: ['redis'],
    },
    {
      at: 9000,
      title: '`TTL jitter` tấn công stampede từ phía ngược lại',
      body: 'Thay vì chặn nhiều reader cùng miss, `jitter` rải ngẫu nhiên hạn dùng của hàng nghìn key ra nhiều thời điểm khác nhau, để chúng không bao giờ chết cùng một lúc. Hai kỹ thuật, `SETNX` khoá rebuild và `jitter` rải hạn dùng, giải quyết cùng một vấn đề theo hai hướng khác nhau.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 18_000,
      question: 'Vì sao lock rebuild bắt buộc phải có TTL riêng?',
      options: ['Để tiết kiệm memory', 'Vì rebuilder chết sẽ giữ lock vĩnh viễn', 'Vì Redis yêu cầu mọi key có TTL'],
      answerIndex: 1,
      explanation:
        'Không có `TTL`, một `rebuilder` chết ngay sau khi giữ khoá sẽ không bao giờ tự giải phóng nó, khiến mọi reader khác kẹt lại vĩnh viễn — gắn hạn dùng riêng cho khoá đảm bảo nó luôn biến mất, dù rebuilder có gặp sự cố hay không.',
    },
  ],
}
