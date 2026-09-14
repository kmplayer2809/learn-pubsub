import type { Lesson } from './types'

export const topicExchange: Lesson = {
  id: '04-topic',
  group: 'basics',
  title: 'Topic exchange',
  summary: 'Wildcard routing: `*` khớp một từ, `#` khớp không hoặc nhiều từ.',
  seed: 4,
  durationMs: 12_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Topic exchange', type: 'topic', position: { x: 260, y: 180 } }],
    queues: [
      { id: 'eu-orders', label: 'eu-orders', kind: 'classic', position: { x: 480, y: 60 } },
      { id: 'all-orders', label: 'all-orders', kind: 'classic', position: { x: 480, y: 180 } },
      { id: 'created-only', label: 'created-only', kind: 'classic', position: { x: 480, y: 300 } },
    ],
    consumers: [
      {
        id: 'c-eu-orders',
        label: 'EU orders consumer',
        queueId: 'eu-orders',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 60 },
      },
      {
        id: 'c-all-orders',
        label: 'All orders consumer',
        queueId: 'all-orders',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 180 },
      },
      {
        id: 'c-created-only',
        label: 'Created-only consumer',
        queueId: 'created-only',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 300 },
      },
    ],
    bindings: [
      {
        id: 'b1',
        exchangeId: 'ex',
        destinationId: 'eu-orders',
        destinationKind: 'queue',
        routingKey: 'order.eu.*',
      },
      {
        id: 'b2',
        exchangeId: 'ex',
        destinationId: 'all-orders',
        destinationKind: 'queue',
        routingKey: 'order.#',
      },
      {
        id: 'b3',
        exchangeId: 'ex',
        destinationId: 'created-only',
        destinationKind: 'queue',
        routingKey: '*.*.created',
      },
    ],
  },
  script: [
    { at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'order.eu.created', body: 'Order A' },
    { at: 1800, publisherId: 'p1', exchangeId: 'ex', routingKey: 'order.us.created', body: 'Order B' },
    { at: 3600, publisherId: 'p1', exchangeId: 'ex', routingKey: 'order.eu.cancelled', body: 'Order C' },
    { at: 5400, publisherId: 'p1', exchangeId: 'ex', routingKey: 'payment.eu.created', body: 'Payment A' },
    { at: 7200, publisherId: 'p1', exchangeId: 'ex', routingKey: 'order', body: 'Order D' },
  ],
  narrative: [
    {
      at: 0,
      title: '`*` khớp đúng một từ',
      body: 'Binding trên `eu-orders` là `order.eu.*`, nên nó khớp với key có đúng ba từ ngăn cách bởi dấu chấm: hai từ đầu cố định, từ cuối là bất kỳ. `order.eu.created` khớp; `order.eu.west.created` thì không — vì key đó thừa một từ.',
      highlight: ['p1', 'ex', 'eu-orders'],
    },
    {
      at: 3000,
      title: '`#` khớp không hoặc nhiều từ',
      body: 'Binding `order.#` trên `all-orders` khớp với `order` đứng một mình, `order.eu.created`, và bất kỳ key nào khác bắt đầu bằng `order`. Đây là wildcard lỏng lẻo nhất mà một topic exchange cung cấp.',
      highlight: ['all-orders'],
    },
    {
      at: 6000,
      title: 'Key trơn vẫn khớp `#`, nhưng không khớp `*`',
      body: 'Key `order` đứng một mình khớp `order.#` — `#` chấp nhận cả trường hợp không còn từ nào — nhưng nó **không** khớp `order.eu.*`, vốn cần đúng thêm hai từ nữa sau `order`.',
      highlight: ['all-orders', 'eu-orders'],
    },
    {
      at: 9000,
      title: 'Một message có thể rơi vào nhiều queue cùng lúc',
      body: 'Không có gì trong topic routing là độc quyền. `order.eu.created` ở trên khớp cả `eu-orders`, `all-orders`, *và* `created-only` trong cùng một lần publish — ba bản copy độc lập từ một message.',
      highlight: ['eu-orders', 'all-orders', 'created-only'],
    },
  ],
  checkpoints: [
    {
      at: 3200,
      question: 'Key `order.eu.created` vừa publish. Nó khớp bao nhiêu binding trong ba binding trên?',
      options: [
        'Một — chỉ `order.eu.*`',
        'Hai — `order.eu.*` cùng `order.#`',
        'Cả ba binding',
      ],
      answerIndex: 2,
      explanation:
        '`order.eu.*` khớp vì key có đúng ba từ, hai từ đầu đúng. `order.#` khớp mọi key mở đầu bằng `order`. `*.*.created` cần ba từ với từ cuối là `created` — cũng khớp. Một lần publish, ba bản copy.',
    },
    {
      at: 6000,
      question: 'Key `order.us.created` khớp những binding nào trong ba binding trên?',
      options: [
        'Chỉ `order.#`',
        '`order.#` và `*.*.created`',
        'Cả ba, vì `*` khớp được `us`',
      ],
      answerIndex: 1,
      explanation:
        '`order.#` khớp mọi key mở đầu bằng `order`. `*.*.created` cần đúng ba từ với từ cuối là `created`, nên cũng khớp. Riêng `order.eu.*` đòi từ thứ hai đúng bằng `eu`, mà key này lại là `us`.',
    },
    {
      at: 12_000,
      question:
        'Tổng kết: một queue cần bắt mọi sự kiện đơn hàng, sâu bao nhiêu cấp cũng được — `order`, `order.eu.created`, `order.eu.west.created`. Binding nào đúng?',
      options: [
        '`order.#`',
        '`order.*`',
        '`order.*.*`',
      ],
      answerIndex: 0,
      explanation:
        '`#` khớp không hoặc nhiều từ, nên nó ôm trọn cả key `order` trơn lẫn key sâu bốn cấp. Mỗi `*` chỉ khớp đúng một từ, nên `order.*` bỏ sót `order` trơn lẫn key dài hơn ba cấp.',
    },
  ],
  quiz: [
    {
      question: '`*` trong một topic binding khớp bao nhiêu từ?',
      options: [
        'Đúng một từ',
        'Không hoặc nhiều từ',
        'Ít nhất một từ, tối đa ba',
        'Mọi ký tự, kể cả dấu chấm',
      ],
      answerIndex: 0,
      explanation:
        '`*` thay cho đúng một từ nằm giữa hai dấu chấm. Vì vậy `order.eu.*` đòi key có đúng ba từ, không hơn không kém.',
    },
    {
      question: 'Key `order` đứng một mình khớp binding nào?',
      options: [
        'Chỉ `order.#`',
        'Chỉ `order.*`',
        'Cả `order.#` lẫn `order.*`',
        'Không binding nào trong hai cái',
      ],
      answerIndex: 0,
      explanation:
        '`#` chấp nhận cả trường hợp không còn từ nào phía sau, nên `order` trơn vẫn khớp `order.#`. `order.*` thì đòi thêm đúng một từ nữa.',
    },
    {
      question: 'Key `payment.eu.created` khớp binding nào trong ba binding của bài?',
      options: [
        'Chỉ `*.*.created`',
        'Chỉ `order.#`',
        '`order.eu.*` cùng `*.*.created`',
        'Không binding nào',
      ],
      answerIndex: 0,
      explanation:
        'Key có ba từ, từ cuối là `created` nên `*.*.created` khớp. Hai binding kia đều đòi từ đầu tiên đúng bằng `order`.',
    },
    {
      question: 'Vì sao topic exchange có thể thay vai của cả direct lẫn fanout?',
      options: [
        'Pattern không wildcard hành xử như direct, pattern `#` hành xử như fanout',
        'Vì topic đọc thêm header khi key trượt',
        'Vì topic gửi bản copy tới mọi queue rồi lọc ở consumer',
        'Vì topic tự đổi loại theo key của message',
      ],
      answerIndex: 0,
      explanation:
        'Một binding key không wildcard chỉ khớp chuỗi chính xác, đúng hành vi direct. Binding `#` khớp mọi key, đúng hành vi fanout. Topic là tập cha của hai kiểu kia, đổi lại chi phí so khớp cao hơn.',
    },
  ],
}
