import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const set: RedisLesson = {
  id: '04-set',
  group: 'basics',
  title: 'Set',
  summary:
    'Set khử trùng lặp ngay khi ghi, còn `SINTER` tính giao trực tiếp bên trong Redis mà không cần truyền cả hai tập qua mạng.',
  seed: 4,
  durationMs: 12_000,
  topology: {
    clients: [APP],
    server: SERVER,
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SADD', args: ['online:mon', 'ann', 'bob', 'cat'] },
    { at: 1500, clientId: APP.id, name: 'SADD', args: ['online:tue', 'bob', 'cat', 'dan'] },
    { at: 3000, clientId: APP.id, name: 'SADD', args: ['online:mon', 'bob'] },
    { at: 4500, clientId: APP.id, name: 'SISMEMBER', args: ['online:mon', 'ann'] },
    { at: 6000, clientId: APP.id, name: 'SINTER', args: ['online:mon', 'online:tue'] },
    { at: 7500, clientId: APP.id, name: 'SCARD', args: ['online:mon'] },
  ],
  narrative: [
    {
      at: 0,
      title: 'Set không lưu trùng',
      body: '`SADD` tự động bỏ qua phần tử đã có, nên không cần đọc trước rồi mới quyết định ghi — việc khử trùng lặp nằm sẵn trong chính thao tác ghi.',
      highlight: ['app', 'redis'],
    },
    {
      at: 4500,
      title: '`SISMEMBER` không kéo cả set về',
      body: '`SISMEMBER` chỉ kiểm tra một phần tử có mặt hay không, trả lời ngay tại server mà chẳng cần truyền nguyên `set` qua mạng.',
      highlight: ['redis'],
    },
    {
      at: 6000,
      title: '`SINTER` tính giao ngay trong Redis',
      body: '`SINTER` tính phần giao giữa nhiều `set` ngay bên trong Redis — mạng chỉ phải mang đúng kết quả cuối, chưa từng phải mang một trong hai `set` gốc.',
      highlight: ['app', 'redis'],
    },
    {
      at: 7500,
      title: 'Không có thứ tự đảm bảo',
      body: 'Redis thật không đảm bảo thứ tự cho `SMEMBERS`, nhưng bộ mô phỏng này cố định theo thứ tự chèn để một lượt chạy luôn phát lại giống hệt — code thật không được phép dựa vào thứ tự đó.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 6500,
      question: '`SINTER online:mon online:tue` được tính ở đâu?',
      options: [
        'Ngay trong Redis, mạng chỉ mang kết quả cuối',
        'Phía client, sau khi tải cả hai `set` về',
        'Trong một tiến trình nền, trả kết quả sau',
      ],
      answerIndex: 0,
      explanation:
        'Đưa phép tính tới chỗ dữ liệu là nguyên tắc chung. Kéo hai `set` về client rồi tự giao là cách tốn băng thông nhất.',
    },
    {
      at: 9000,
      question: '`SADD` một member đã có trả về gì?',
      options: ['(integer) 0', '(integer) 1', '(error)'],
      answerIndex: 0,
      explanation:
        '`SADD` chỉ đếm phần tử mới thêm; một member đã tồn tại sẵn không làm gì thêm cả, nên kết quả luôn là `(integer) 0`.',
    },
    {
      at: 12_000,
      question:
        'Tổng kết: hai `set` mỗi cái một triệu member, cần biết số phần tử chung. Cách nào tốt nhất?',
      options: [
        '`SINTERCARD` — Redis tính rồi trả về đúng một con số',
        '`SMEMBERS` cả hai rồi so sánh phía ứng dụng',
        '`SISMEMBER` lặp qua từng member của `set` thứ nhất',
      ],
      answerIndex: 0,
      explanation:
        'Nguyên tắc chung là đưa phép tính tới chỗ dữ liệu. `SMEMBERS` kéo hai triệu phần tử qua mạng, còn vòng lặp `SISMEMBER` tốn một triệu lượt round-trip. `SINTERCARD` làm trọn việc ngay trong Redis rồi trả về mỗi con số đếm.',
    },
  ],
  quiz: [
    {
      question: 'Vì sao `set` không cần một bước kiểm tra trước khi ghi?',
      options: [
        '`SADD` tự bỏ qua member đã có, việc khử trùng nằm trong chính thao tác ghi',
        'Redis khoá `key` lại trong lúc ghi',
        '`SADD` ghi đè member cũ',
        '`set` cho phép trùng rồi lọc lúc đọc',
      ],
      answerIndex: 0,
      explanation:
        'Giá trị trả về đếm số member mới thêm, nên một lượt `SADD` vừa ghi vừa cho biết member đã có hay chưa, chỉ tốn một round-trip.',
    },
    {
      question: '`SISMEMBER` khác `SMEMBERS` ở chỗ nào?',
      options: [
        '`SISMEMBER` trả lời có hay không ngay tại server; `SMEMBERS` kéo cả `set` về',
        '`SISMEMBER` chậm hơn vì phải quét',
        'Hai lệnh giống hệt nhau',
        '`SMEMBERS` chỉ trả về mười member đầu',
      ],
      answerIndex: 0,
      explanation:
        'Với `set` lớn, khác biệt là một byte trả lời so với hàng triệu member đi qua mạng.',
    },
    {
      question: 'Thứ tự của `SMEMBERS` có gì đảm bảo không?',
      options: [
        'Không — Redis thật không cam kết thứ tự nào',
        'Có, theo thứ tự chèn',
        'Có, theo thứ tự chữ cái',
        'Có, theo thời điểm đọc gần nhất',
      ],
      answerIndex: 0,
      explanation:
        'Bộ mô phỏng này cố định theo thứ tự chèn để một lượt chạy luôn phát lại giống hệt, nhưng code thật tuyệt đối không được dựa vào điều đó.',
    },
    {
      question: 'Vì sao vòng lặp `SISMEMBER` qua từng member là cách tệ để đếm phần giao?',
      options: [
        'Tốn một triệu lượt round-trip, trong khi Redis làm trọn việc trong một lệnh',
        'Vì `SISMEMBER` thiếu chính xác trên `set` lớn',
        'Vì `SISMEMBER` đòi hai `set` cùng kích thước',
        'Vì mỗi lượt gọi làm hỏng cursor',
      ],
      answerIndex: 0,
      explanation:
        'Chi phí nằm ở số lượt đi về mạng, không ở phép so khớp. `SINTERCARD` gộp tất cả thành một lượt rồi trả về đúng một con số đếm.',
    },
  ],
}
