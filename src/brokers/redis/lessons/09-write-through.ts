import { APP, SERVER, WORKER, type RedisLesson } from './types'
import type { RedisScriptedCommand } from '../engine'

/** Stands in for the database both halves of the lesson write to, directly or via `worker`. */
const DB = Object.freeze({ id: 'db', label: 'Database', position: { x: 40, y: 40 } })

const script: RedisScriptedCommand[] = [
  // write-through: the cache write and the synchronous database write the caller also waits for.
  { at: 0, clientId: 'app', name: 'SET', args: ['order:1', 'pending'] },
  { at: 800, clientId: 'db', name: 'SET', args: ['order:1', 'pending'] },
  { at: 2000, clientId: 'app', name: 'GET', args: ['order:1'] },
  // write-behind: redis answers immediately, worker drains the queue later.
  { at: 6000, clientId: 'app', name: 'SET', args: ['order:2', 'pending'] },
  { at: 6200, clientId: 'app', name: 'LPUSH', args: ['writeback', 'order:2'] },
  { at: 7000, clientId: 'app', name: 'GET', args: ['order:2'] },
  { at: 9000, clientId: 'worker', name: 'RPOP', args: ['writeback'] },
  { at: 9500, clientId: 'db', name: 'SET', args: ['order:2', 'pending'] },
]

export const writeThrough: RedisLesson = {
  id: '09-write-through',
  group: 'cache',
  title: 'Write-through và write-behind',
  summary: 'Write-through ghi đồng bộ hai nơi trước khi trả lời, còn write-behind trả lời nhanh rồi để worker rải ghi database sau.',
  seed: 9,
  durationMs: 20_000,
  topology: { clients: [APP, WORKER, DB], server: SERVER },
  script,
  narrative: [
    {
      at: 0,
      title: 'Write-through ghi cả hai nơi trước khi trả lời',
      body: 'Trong nửa `write-through`, ứng dụng ghi `redis` rồi cũng tự ghi `database` trước khi coi request là xong, nên cache không bao giờ đi trước database và độ trễ ghi là tổng của cả hai.',
      highlight: ['app', 'redis', 'db'],
    },
    {
      at: 6000,
      title: 'Write-behind trả lời ngay, worker rải ghi sau',
      body: 'Ở nửa `write-behind`, `redis` nhận `SET order:2` rồi trả lời ngay lập tức; `worker` mới là bên rải ghi `database` về sau bằng cách rút phần tử khỏi queue `writeback`. Đổi lại tốc độ ghi nhanh hơn hẳn, hệ thống chấp nhận một khoảng thời gian hai kho dữ liệu không khớp nhau.',
      highlight: ['app', 'redis', 'worker'],
    },
    {
      at: 9000,
      title: 'Khoảng lệch đó chính là dữ liệu có thể mất khi crash',
      body: 'Khoảng thời gian `redis` đã có giá trị nhưng `database` chưa thấy chính là lượng dữ liệu một lần crash có thể xoá sạch. Chấp nhận khoảng lệch đó lớn tới đâu là quyết định sản phẩm, không phải một giới hạn kỹ thuật.',
      highlight: ['redis', 'db'],
    },
    {
      at: 12_000,
      title: 'Queue `writeback` vẫn chỉ là một Redis list',
      body: 'Hàng đợi `writeback` chỉ là một `list` bình thường trong Redis, nên lời cảnh báo ở bài List vẫn áp dụng nguyên vẹn: một `worker` chết ngay sau khi `RPOP` sẽ làm phần tử vừa rút biến mất, chưa kịp ghi xuống `database`.',
      highlight: ['worker', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 16_000,
      question: 'Write-behind mất dữ liệu khi nào?',
      options: ['Không bao giờ, Redis bền', 'Khi Redis hoặc worker chết trước lúc flush', 'Chỉ khi TTL hết hạn'],
      answerIndex: 1,
      explanation:
        'Một phần tử đã rời khỏi queue `writeback` (bị `RPOP`) nhưng chưa kịp ghi xuống `database` sẽ mất trắng nếu `worker` hoặc Redis chết ngay lúc đó — độ bền của Redis không đổi được điều này, vì worker chỉ giữ dữ liệu đó trong bộ nhớ của chính nó khi đang xử lý.',
    },
  ],
}
