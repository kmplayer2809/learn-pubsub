import { APP, SERVER, type RedisLesson } from './types'
import type { RedisScriptedCommand } from '../engine'

/**
 * The plan's own `maxmemoryBytes: 200` never evicts anything: `sizeOf`
 * (`engine/memory.ts`) is `16 + key.length + payload`, so each one-character
 * key with an eight-character value here costs 25 bytes, and four of them
 * only reach 100 — nowhere near 200. `writeKey` refuses or evicts when
 * `memoryUsed + newBytes - budget > 0`; with `a`, `b`, `c` sitting at 75 bytes,
 * the fourth `SET` needs 100, so the budget must be under 100 for eviction to
 * trigger at all, and at least 75 for a single eviction to clear it. 90
 * satisfies both, and running the lesson confirms `b` (the coldest of the
 * three) is the sole victim.
 */
const TINY_SERVER = Object.freeze({ ...SERVER, maxmemoryBytes: 90, evictionPolicy: 'allkeys-lru' as const })

const script: RedisScriptedCommand[] = [
  { at: 0, clientId: 'app', name: 'SET', args: ['a', 'aaaaaaaa'] },
  { at: 1000, clientId: 'app', name: 'SET', args: ['b', 'bbbbbbbb'] },
  { at: 2000, clientId: 'app', name: 'SET', args: ['c', 'cccccccc'] },
  { at: 3000, clientId: 'app', name: 'GET', args: ['a'] },
  { at: 4000, clientId: 'app', name: 'SET', args: ['d', 'dddddddd'] },
  { at: 5500, clientId: 'app', name: 'KEYS', args: ['*'] },
  { at: 7000, clientId: 'app', name: 'CONFIG', args: ['SET', 'maxmemory-policy', 'volatile-lru'] },
  { at: 8000, clientId: 'app', name: 'SET', args: ['e', 'eeeeeeee'] },
  { at: 10_000, clientId: 'app', name: 'EXPIRE', args: ['a', '60'] },
  { at: 11_000, clientId: 'app', name: 'SET', args: ['f', 'ffffffff'] },
  { at: 13_000, clientId: 'app', name: 'KEYS', args: ['*'] },
  { at: 15_000, clientId: 'app', name: 'INFO', args: [] },
]

export const eviction: RedisLesson = {
  id: '11-eviction',
  group: 'cache',
  title: 'maxmemory và eviction policy',
  summary: 'Chạm trần maxmemory buộc Redis chọn giữa từ chối ghi và xoá bớt dữ liệu cũ theo một chính sách eviction.',
  seed: 11,
  durationMs: 24_000,
  topology: { clients: [APP], server: TINY_SERVER },
  script,
  narrative: [
    {
      at: 0,
      title: '`maxmemory` là trần, không phải gợi ý',
      body: 'Ngân sách 90 byte ở đây nhỏ bất thường, cố tình thu nhỏ để eviction xảy ra chỉ sau vài key thay vì vài nghìn key như một server thật. Chạm trần buộc Redis phải chọn giữa từ chối ghi hoặc xoá bớt dữ liệu cũ.',
      highlight: ['app', 'redis'],
    },
    {
      at: 4000,
      title: '`allkeys-lru` xoá key lạnh nhất',
      body: 'Với chính sách `allkeys-lru`, key nào lâu nhất chưa được đọc hay ghi sẽ bị xoá trước tiên — đúng là lựa chọn hợp lý cho một cache thuần tuý, nơi dữ liệu cũ ít giá trị hơn dữ liệu mới.',
      highlight: ['redis'],
    },
    {
      at: 7000,
      title: '`volatile-*` chỉ nhìn vào key có `TTL`',
      body: 'Chính sách `volatile-lru` chỉ coi những key mang `TTL` là ứng viên bị xoá. Một keyspace không key nào có hạn dùng khiến chính sách này hành xử y hệt `noeviction`, dù tên gọi nghe có vẻ vẫn chủ động xoá bớt.',
      highlight: ['redis'],
    },
    {
      at: 8000,
      title: 'Đây là cái bẫy khiến nhiều người mắc phải',
      body: 'Chính sách đã bật, bộ nhớ đã đầy, nhưng mọi lệnh ghi đều trả `OOM` bởi vì không có key nào đủ điều kiện bị xoá — không phải Redis hỏng, chỉ là không key nào mang `TTL` để chính sách chạm vào.',
      highlight: ['redis', 'app'],
    },
    {
      at: 11_000,
      title: 'Eviction khác hoàn toàn với hết hạn',
      body: 'Một key bị eviction vẫn đang sống khoẻ mạnh, nó chỉ bị xoá để nhường chỗ, khác hẳn một key hết hạn tự nhiên. Đó là lý do `metrics.evicted` và `metrics.expired` là hai bộ đếm tách biệt, không gộp chung.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 13_000,
      question: 'Một `key` bị eviction khác một `key` hết hạn ở điểm nào?',
      options: [
        '`key` bị eviction vẫn đang sống, nó bị xoá chỉ để nhường chỗ',
        'Hai trường hợp giống hệt nhau',
        '`key` bị eviction luôn mang `TTL` đã hết',
      ],
      answerIndex: 0,
      explanation:
        'Vì vậy `metrics.evicted` với `metrics.expired` là hai bộ đếm tách biệt: một cái đo áp lực bộ nhớ, cái kia đo vòng đời dữ liệu.',
    },
    {
      at: 19_000,
      question: '`volatile-lru` với keyspace không key nào có TTL thì sao?',
      options: ['Xoá key cũ nhất', 'Hoạt động như noeviction — write trả OOM', 'Xoá ngẫu nhiên một key'],
      answerIndex: 1,
      explanation:
        'Chính sách `volatile-lru` chỉ chọn ứng viên trong số key mang `TTL`; không key nào mang `TTL` nghĩa là danh sách ứng viên rỗng, nên mọi lệnh ghi vượt `maxmemory` đều bị từ chối với `OOM`, giống hệt như đang chạy `noeviction`.',
    },
    {
      at: 24_000,
      question:
        'Tổng kết: một instance vừa làm cache vừa giữ dữ liệu bắt buộc phải còn. Chọn chính sách nào?',
      options: [
        '`volatile-lru`, đặt `TTL` cho riêng phần dữ liệu cache',
        '`allkeys-lru`, cho Redis tự chọn key lạnh nhất',
        '`noeviction`, chấp nhận `OOM` khi đầy bộ nhớ',
      ],
      answerIndex: 0,
      explanation:
        '`allkeys-lru` coi mọi key là ứng viên, nên nó xoá cả dữ liệu bắt buộc phải còn. `volatile-lru` biến `TTL` thành lời tuyên bố "key này bỏ được", nên chỉ phần cache bị xoá. Bẫy duy nhất là quên đặt `TTL`: lúc đó danh sách ứng viên rỗng và mọi lệnh ghi trả `OOM`. Tách hẳn hai instance vẫn là phương án sạch sẽ nhất.',
    },
  ],
  quiz: [
    {
      question: '`maxmemory` là gì?',
      options: [
        'Trần cứng: chạm trần thì Redis phải xoá bớt hoặc từ chối ghi',
        'Một gợi ý để Redis tự cân đối',
        'Giới hạn kích thước mỗi `key`',
        'Ngưỡng bắt đầu ghi xuống đĩa',
      ],
      answerIndex: 0,
      explanation:
        'Chính sách eviction quyết định Redis chọn nhánh nào khi chạm trần.',
    },
    {
      question: '`allkeys-lru` chọn `key` nào để xoá?',
      options: [
        '`key` lâu nhất chưa được đọc hay ghi, trong toàn bộ keyspace',
        'Chỉ `key` mang `TTL`',
        '`key` lớn nhất',
        '`key` mới ghi gần đây nhất',
      ],
      answerIndex: 0,
      explanation:
        'Hợp lý cho một cache thuần tuý, nhưng nó coi cả dữ liệu bắt buộc phải còn là ứng viên.',
    },
    {
      question: 'Vì sao `volatile-lru` vẫn có thể trả `OOM` dù chính sách đã bật?',
      options: [
        'Danh sách ứng viên rỗng khi không `key` nào mang `TTL`',
        'Vì `volatile-lru` chỉ chạy lúc khởi động',
        'Vì nó đòi `maxmemory` lớn hơn một gigabyte',
        'Vì nó xung đột với RDB',
      ],
      answerIndex: 0,
      explanation:
        'Chính sách chỉ nhìn vào `key` mang hạn. Không có ứng viên thì nó hành xử y hệt `noeviction`.',
    },
    {
      question: 'Một instance vừa làm cache vừa giữ dữ liệu bắt buộc phải còn. Hướng nào sạch nhất?',
      options: [
        'Tách hẳn thành hai instance',
        '`allkeys-lru` cho cả hai loại dữ liệu',
        '`noeviction` rồi nâng `maxmemory` dần',
        'Bỏ `TTL` để không `key` nào bị xoá',
      ],
      answerIndex: 0,
      explanation:
        '`volatile-lru` cộng `TTL` cho riêng phần cache là phương án chấp nhận được, nhưng nó phụ thuộc vào việc không ai quên đặt hạn. Hai instance tách biệt không mang cái bẫy đó.',
    },
  ],
}
