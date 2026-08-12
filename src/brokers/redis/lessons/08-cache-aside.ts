import { APP, SERVER, type RedisLesson } from './types'
import type { RedisScriptedCommand } from '../engine'

/**
 * `db` stands in for the database the application reads on a miss. Modelling
 * it as a client whose only commands are the cache fills makes the round trip
 * (`app` misses, `db` fills the cache) visible on the canvas without this
 * engine inventing a node type it does not otherwise have.
 */
const DB = Object.freeze({ id: 'db', label: 'Database', position: { x: 40, y: 40 } })

const script: RedisScriptedCommand[] = [
  { at: 0, clientId: 'app', name: 'GET', args: ['product:7'] },
  { at: 1500, clientId: 'db', name: 'SET', args: ['product:7', 'Bàn phím|450000', 'EX', '30'] },
  { at: 3500, clientId: 'app', name: 'GET', args: ['product:7'] },
  { at: 5000, clientId: 'app', name: 'GET', args: ['product:7'] },
  { at: 7000, clientId: 'app', name: 'SET', args: ['product:7', 'Bàn phím|399000', 'EX', '30'] },
  { at: 9000, clientId: 'app', name: 'GET', args: ['product:7'] },
  { at: 11_000, clientId: 'app', name: 'DEL', args: ['product:7'] },
  { at: 13_000, clientId: 'app', name: 'GET', args: ['product:7'] },
]

export const cacheAside: RedisLesson = {
  id: '08-cache-aside',
  group: 'cache',
  title: 'Cache-aside',
  summary: 'Ứng dụng tự đọc cache trước, chỉ chạm database khi miss, và ghi lại cache sau khi đọc.',
  seed: 8,
  durationMs: 20_000,
  topology: { clients: [APP, DB], server: SERVER },
  script,
  narrative: [
    {
      at: 0,
      title: 'Redis không biết gì về `cache-aside`',
      body: 'Pattern `cache-aside` nằm hoàn toàn ở phía ứng dụng: đọc `redis` trước, nếu miss thì mới đọc `database`, sau đó ghi kết quả ngược lại cache. Bản thân Redis chỉ lưu trữ thụ động, nó không hề biết `product:7` là sản phẩm gì hay `database` phía sau trông ra sao.',
      highlight: ['app', 'redis', 'db'],
    },
    {
      at: 1500,
      title: '`TTL` là ngân sách cho độ trễ dữ liệu',
      body: 'Dòng lệnh `SET product:7 ... EX 30` gắn cho key một hạn dùng ba mươi giây. `TTL` chính là ngân sách xác định một reader có thể đọc dữ liệu cũ tới đâu, nếu không có gì chủ động xoá key trước đó.',
      highlight: ['db', 'redis'],
    },
    {
      at: 3500,
      title: 'Một lần miss tốn nhiều hơn một round trip',
      body: 'Khi miss, ứng dụng phải trả giá bằng một round trip tới `database`, cộng thêm hai round trip tới Redis — một lần đọc miss, một lần ghi lại cache. Hit rate thấp khiến cache trở thành gánh nặng thay vì lợi ích, bởi mỗi request tốn nhiều bước hơn hẳn so với bỏ qua cache hoàn toàn.',
      highlight: ['app', 'redis', 'db'],
    },
    {
      at: 7000,
      title: 'Ghi database xong phải cập nhật cache ngay',
      body: 'Khi giá sản phẩm đổi, ứng dụng ghi `database` rồi lập tức ghi đè `redis` trong cùng một hơi, thay vì chờ `TTL` hết hạn. Một `DEL` tường minh lúc ghi chính là thứ giữ cache trung thực giữa hai lần hết hạn.',
      highlight: ['app', 'db', 'redis'],
    },
    {
      at: 11_000,
      title: '`metrics.hits` và `metrics.misses` là câu trả lời duy nhất',
      body: 'Hai bộ đếm `metrics.hits` và `metrics.misses` cộng lại thành hit rate — con số duy nhất nói lên liệu cache có đáng giữ hay không. Một `DEL product:7` tường minh xoá cache ngay lập tức, nên lần đọc kế tiếp chắc chắn miss, đúng như thiết kế.',
      highlight: ['app', 'redis'],
    },
  ],
  checkpoints: [
    {
      at: 16_000,
      question: 'Hit rate 20% thì cache-aside có đáng dùng không?',
      options: ['Có, cache luôn nhanh hơn', 'Không chắc — 80% request trả thêm 2 round trip Redis', 'Có, miễn là TTL đủ dài'],
      answerIndex: 1,
      explanation:
        'Với hit rate 20%, tám mươi phần trăm lượt gọi phải đi thêm hai round trip Redis (một lần miss, một lần ghi lại) cộng một round trip `database`, nên tổng độ trễ vượt xa việc bỏ qua cache — đúng như `metrics.hits` và `metrics.misses` cho thấy.',
    },
  ],
}
