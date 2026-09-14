import type { Lesson } from './types'

export const directExchange: Lesson = {
  id: '02-direct',
  group: 'basics',
  title: 'Direct exchange',
  summary: 'Routing key khớp chính xác, và điều gì xảy ra khi không có gì khớp.',
  seed: 2,
  durationMs: 10_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } }],
    queues: [
      { id: 'pay', label: 'pay', kind: 'classic', position: { x: 480, y: 60 } },
      { id: 'ship', label: 'ship', kind: 'classic', position: { x: 480, y: 180 } },
      { id: 'audit', label: 'audit', kind: 'classic', position: { x: 480, y: 300 } },
    ],
    consumers: [
      {
        id: 'c-pay',
        label: 'Pay consumer',
        queueId: 'pay',
        prefetch: 1,
        autoAck: false,
        processingMs: 700,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 60 },
      },
      {
        id: 'c-ship',
        label: 'Ship consumer',
        queueId: 'ship',
        prefetch: 1,
        autoAck: false,
        processingMs: 700,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 180 },
      },
      {
        id: 'c-audit',
        label: 'Audit consumer',
        queueId: 'audit',
        prefetch: 1,
        autoAck: false,
        processingMs: 700,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 300 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'pay', destinationKind: 'queue', routingKey: 'payment' },
      { id: 'b2', exchangeId: 'ex', destinationId: 'ship', destinationKind: 'queue', routingKey: 'shipping' },
      { id: 'b3', exchangeId: 'ex', destinationId: 'audit', destinationKind: 'queue', routingKey: 'payment' },
    ],
  },
  script: [
    { at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'payment', body: 'Payment 1' },
    { at: 1200, publisherId: 'p1', exchangeId: 'ex', routingKey: 'shipping', body: 'Shipping 1' },
    { at: 2400, publisherId: 'p1', exchangeId: 'ex', routingKey: 'payment', body: 'Payment 2' },
    { at: 3600, publisherId: 'p1', exchangeId: 'ex', routingKey: 'refund', body: 'Refund 1' },
    { at: 4800, publisherId: 'p1', exchangeId: 'ex', routingKey: 'shipping', body: 'Shipping 2' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Direct exchange khớp key một cách chính xác',
      body: 'Mỗi binding trên `ex` gán một routing key. Message chỉ được route tới binding có key khớp *chính xác* dạng string — không pattern, không khớp một phần.',
      highlight: ['p1', 'ex'],
    },
    {
      at: 1800,
      title: 'Hai queue, một key, hai bản copy',
      body: 'Cả `pay` và `audit` đều bind với key `payment`. Message publish với key đó được route tới **cả hai** — mỗi queue nhận một bản copy độc lập của riêng mình.',
      highlight: ['pay', 'audit'],
    },
    {
      at: 3600,
      title: 'Key không khớp bị âm thầm loại bỏ',
      body: 'Message này mang key `refund`, và không binding nào trên `ex` dùng key đó. Không có flag `mandatory`, cũng không có alternate exchange nào được cấu hình, nên broker đơn giản là drop nó.',
      highlight: ['ex'],
    },
    {
      at: 6000,
      title: 'Vì sao `mandatory` và alternate exchange tồn tại',
      body: 'Một message bị drop như message `refund` ở trên không để lại dấu vết nào ở queue. Đánh dấu publish là `mandatory`, hoặc bind một alternate exchange để hứng phần dư ra, chính là cách bạn tránh mất message một cách âm thầm.',
      highlight: ['ex'],
    },
  ],
  checkpoints: [
    {
      at: 2400,
      question: 'Message `Payment 1` vừa được route. Bao nhiêu queue nhận nó?',
      options: [
        'Một — chỉ `pay`',
        'Hai — `pay` cùng `audit`, vì cả hai bind key `payment`',
        'Cả ba queue, vì `ex` phát cho mọi binding',
      ],
      answerIndex: 1,
      explanation:
        'Direct exchange giao bản copy cho *mọi* binding có key khớp, chứ không dừng ở binding đầu tiên. `pay` với `audit` cùng bind key `payment` nên mỗi queue nhận một bản riêng; `ship` mang key khác nên đứng ngoài.',
    },
    {
      at: 4800,
      question: 'Message publish với routing key `refund` kết thúc ở đâu?',
      options: [
        'Ở queue `audit`, vốn đóng vai trò nơi hứng mặc định',
        'Không ở đâu cả — broker drop nó vì không binding nào khớp',
        'Ở cả ba queue, vì key lạ được coi như broadcast',
      ],
      answerIndex: 1,
      explanation:
        'Direct exchange chỉ so khớp chuỗi một cách chính xác. Không binding nào trên `ex` mang key `refund`, nên message không có đích tới và bị loại bỏ. Không có queue nào giữ vai trò nơi hứng mặc định trừ khi bạn tự cấu hình.',
    },
    {
      at: 10_000,
      question:
        'Tổng kết: bạn muốn phát hiện những message không route được thay vì để chúng biến mất. Cách nào đúng?',
      options: [
        'Publish kèm cờ `mandatory`, hoặc gắn alternate exchange cho `ex`',
        'Thêm một binding nữa cho `audit` với cùng key `payment`',
        'Đổi `ex` sang loại fanout để mọi key đều có nơi tới',
      ],
      answerIndex: 0,
      explanation:
        'Cờ `mandatory` khiến broker trả message không route được về publisher qua callback `basic.return`; alternate exchange thì chuyển nó sang một exchange dự phòng. Cả hai đều biến việc mất message âm thầm thành tín hiệu quan sát được. Chuyển sang fanout tuy hết drop nhưng đồng thời phá vỡ toàn bộ khả năng routing.',
    },
  ],
  quiz: [
    {
      question: 'Direct exchange so khớp routing key kiểu nào?',
      options: [
        'Khớp chuỗi chính xác',
        'Khớp tiền tố',
        'Khớp pattern dùng `*` cùng `#`',
        'Khớp không phân biệt hoa thường',
      ],
      answerIndex: 0,
      explanation:
        'Direct chỉ so bằng: key của message phải trùng từng ký tự với key của binding. Muốn khớp theo pattern thì cần topic exchange.',
    },
    {
      question: 'Hai binding cùng key `payment` trỏ về hai queue. Một message key `payment` tạo ra bao nhiêu bản copy?',
      options: [
        'Hai, mỗi queue một bản độc lập',
        'Một, broker chọn queue rảnh hơn',
        'Một, queue bind trước được ưu tiên',
        'Không bản nào, vì key trùng gây xung đột',
      ],
      answerIndex: 0,
      explanation:
        'Số bản copy bằng số binding khớp. Mỗi queue giữ bản riêng của nó, tiêu thụ độc lập, không ai tranh phần của ai.',
    },
    {
      question: 'Message mang key `refund` không khớp binding nào. Broker làm gì?',
      options: [
        'Drop im lặng, không nơi nào giữ lại',
        'Giữ trong exchange cho tới khi có binding mới',
        'Đẩy vào `audit` như nơi hứng mặc định',
        'Trả lỗi cho publisher',
      ],
      answerIndex: 0,
      explanation:
        'Exchange không lưu trữ. Không binding nào khớp, không cờ `mandatory`, không alternate exchange thì message bị bỏ ngay, không để lại dấu vết ở queue nào.',
    },
    {
      question: 'Cách nào biến việc mất message âm thầm thành tín hiệu quan sát được?',
      options: [
        'Publish kèm cờ `mandatory`, hoặc gắn alternate exchange cho `ex`',
        'Đổi `ex` sang fanout',
        'Nâng prefetch cho cả ba consumer',
        'Bật `durable` cho cả ba queue',
      ],
      answerIndex: 0,
      explanation:
        '`mandatory` khiến broker trả message không route được về publisher qua `basic.return`; alternate exchange chuyển nó sang một exchange dự phòng. Fanout tuy hết drop nhưng xoá luôn khả năng routing.',
    },
  ],
}
