import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const zset: RedisLesson = {
  id: '05-zset',
  group: 'basics',
  title: 'Sorted Set: leaderboard',
  summary:
    '`Sorted set` giữ thứ tự theo score ngay từ lúc ghi, nên `ZINCRBY` cộng `ZREVRANGE` cho một bảng xếp hạng luôn cập nhật tức thời.',
  seed: 5,
  durationMs: 14_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'ZADD', args: ['board', '100', 'ann', '250', 'bob', '175', 'cat'] },
    { at: 2000, clientId: APP.id, name: 'ZREVRANGE', args: ['board', '0', '2', 'WITHSCORES'] },
    { at: 4000, clientId: APP.id, name: 'ZINCRBY', args: ['board', '200', 'ann'] },
    { at: 6000, clientId: APP.id, name: 'ZREVRANGE', args: ['board', '0', '2', 'WITHSCORES'] },
    { at: 8000, clientId: APP.id, name: 'ZSCORE', args: ['board', 'cat'] },
    { at: 9500, clientId: APP.id, name: 'ZCARD', args: ['board'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Luôn sắp xếp sẵn theo score',
      body: 'Mỗi member trong `sorted set` mang một score, Redis giữ nguyên thứ tự đó ngay từ lúc ghi — đọc bảng xếp hạng chỉ là một range query, chưa từng cần một bước sort riêng.',
      highlight: ['app', 'redis'],
    },
    {
      at: 4000,
      title: '`ZINCRBY` cập nhật tại chỗ',
      body: '`ZINCRBY` cộng thêm vào score ngay tại chỗ, thứ tự trong `sorted set` thay đổi theo ngay lập tức — không có bước ghi lại toàn bộ danh sách.',
      highlight: ['app', 'redis'],
    },
    {
      at: 6000,
      title: '`ZREVRANGE` đọc top N không quét hết',
      body: '`ZREVRANGE` lấy đúng nhóm đầu bảng mà chẳng cần quét qua toàn bộ member còn lại phía sau.',
      highlight: ['redis'],
    },
    {
      at: 9500,
      title: 'Điểm bằng nhau vẫn có thứ tự cố định',
      body: 'Khi hai member trùng score, bộ mô phỏng này xếp theo tên để một lượt chạy luôn cho cùng một kết quả — Redis thật cũng cần một tie-break tương tự.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 7000,
      question: '`ZREVRANGE board 0 2 WITHSCORES` phải chạm vào bao nhiêu member?',
      options: [
        'Chỉ ba member đầu bảng',
        'Toàn bộ `sorted set`, rồi sắp xếp lại',
        'Một nửa `sorted set`',
      ],
      answerIndex: 0,
      explanation:
        'Trật tự đã có sẵn từ lúc ghi, nên đọc top N chỉ là đi N bước từ một đầu. Chi phí không phụ thuộc kích thước tập.',
    },
    {
      at: 11_000,
      question: 'Sau `ZINCRBY board 200 ann`, ai đứng đầu?',
      options: ['bob (250)', 'ann (300)', 'cat (175)'],
      answerIndex: 1,
      explanation:
        'Sau khi cộng thêm 200, score của `ann` tăng lên 300, vượt qua `bob` đang giữ 250, nên `ann` đứng đầu bảng xếp hạng.',
    },
    {
      at: 14_000,
      question:
        'Tổng kết: bảng xếp hạng mười triệu người chơi, cần đọc top 10 mỗi giây. Chi phí ra sao?',
      options: [
        'Rẻ — `ZREVRANGE board 0 9` chỉ chạm mười phần tử đầu',
        'Đắt — Redis phải sắp xếp lại toàn bộ mười triệu member mỗi lượt gọi',
        'Đắt — phải quét hết `sorted set` để tìm ra nhóm điểm cao nhất',
      ],
      answerIndex: 0,
      explanation:
        '`sorted set` giữ trật tự sẵn trong skiplist ngay lúc ghi, nên không có bước sắp xếp nào lúc đọc. Lấy top N chỉ là đi mười bước từ một đầu, chi phí không phụ thuộc kích thước tập. Chỗ tốn kém là những truy vấn cần thứ hạng của một member ở giữa bảng.',
    },
  ],
  quiz: [
    {
      question: 'Thứ tự trong một `sorted set` được lập vào lúc nào?',
      options: [
        'Lúc ghi, theo score của member',
        'Lúc đọc, bằng một bước sort',
        'Theo thứ tự chèn',
        'Theo thứ tự chữ cái của member',
      ],
      answerIndex: 0,
      explanation:
        'Redis giữ member trong skiplist theo score ngay khi ghi, nên đọc bảng xếp hạng chỉ còn là một range query.',
    },
    {
      question: '`ZINCRBY board 200 ann` làm gì?',
      options: [
        'Cộng 200 vào score của `ann`, vị trí đổi theo ngay',
        'Đặt score của `ann` thành 200',
        'Thêm một member mới tên `200`',
        'Ghi lại toàn bộ bảng xếp hạng',
      ],
      answerIndex: 0,
      explanation:
        'Cập nhật tại chỗ nên ứng dụng khỏi phải đọc rồi ghi lại, cũng không có khoảng hở cho client khác chen vào.',
    },
    {
      question: 'Hai member trùng score thì xếp thế nào?',
      options: [
        'Cần một tie-break cố định, ở đây là theo tên',
        'Member mới hơn luôn đứng trước',
        'Redis xếp ngẫu nhiên ở mỗi lượt đọc',
        'Redis từ chối hai member cùng score',
      ],
      answerIndex: 0,
      explanation:
        'Thiếu tie-break thì cùng một dữ liệu lại cho hai thứ tự khác nhau giữa hai lượt chạy — bảng xếp hạng mất tính lặp lại.',
    },
    {
      question: 'Truy vấn nào trên `sorted set` đắt hơn hẳn việc lấy top N?',
      options: [
        'Tìm thứ hạng của một member nằm giữa bảng',
        'Lấy mười member đầu',
        'Cộng thêm score cho một member',
        'Đếm tổng số member bằng `ZCARD`',
      ],
      answerIndex: 0,
      explanation:
        'Top N đi N bước từ một đầu, `ZCARD` đọc một con số có sẵn. Còn thứ hạng của một member giữa bảng đòi đếm qua phần đứng trước nó.',
    },
  ],
}
