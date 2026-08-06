import type { Lesson } from './types'

export const durabilityAndConfirms: Lesson = {
  id: '10-confirms',
  group: 'reliability',
  title: 'Durability and confirms',
  summary:
    'persistent đánh dấu message cho đĩa, durable đánh dấu queue sống sót qua restart, và publisher confirm là lời hứa của broker.',
  seed: 10,
  durationMs: 12_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } }],
    queues: [{ id: 'orders', label: 'orders', kind: 'classic', durable: true, position: { x: 480, y: 180 } }],
    consumers: [
      {
        id: 'worker',
        label: 'Worker',
        queueId: 'orders',
        prefetch: 1,
        autoAck: false,
        processingMs: 900,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: false,
        position: { x: 700, y: 180 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'orders', destinationKind: 'queue', routingKey: 'order' },
    ],
  },
  script: [0, 1500, 3000, 4500].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'order',
    body: `Order ${i + 1}`,
    // The third message is the odd one out: everything else is persistent.
    persistent: i !== 2,
  })),
  narrative: [
    {
      at: 0,
      title: '`persistent` và `durable` là hai cờ khác nhau, và cả hai đều cần thiết',
      body: '`orders` khai báo `durable: true` nên bản thân queue sống sót qua một lần restart broker. Nhưng `persistent` nằm trên từng message, không phải trên queue — chỉ message nào tự đánh dấu `persistent: true` mới được ghi xuống đĩa khi vào `orders`. Thiếu một trong hai, message đó vẫn mất khi broker khởi động lại.',
      highlight: ['orders'],
    },
    {
      at: 800,
      title: 'Publisher confirm là lúc broker nhận trách nhiệm',
      body: 'Không có publisher confirm, một publish chỉ là `fire-and-forget`, kể cả khi đích đến là `orders` — một queue `durable`. Confirm chính là câu trả lời của broker: *tôi đã nhận message này rồi*. Message đầu tiên vừa route xong và đang chờ confirm quay lại `p1`.',
      highlight: ['ex', 'p1'],
    },
    {
      at: 3800,
      title: 'Message thứ ba là ngoại lệ transient',
      body: 'Ba trong bốn message publish với `persistent: true`; riêng message thứ ba thì không. Nó vẫn được `ex` route vào `orders` và `worker` vẫn xử lý nó bình thường — nhưng nếu broker restart đúng lúc nó còn nằm trong queue, chính message này sẽ biến mất, dù `orders` là `durable`.',
      highlight: ['orders'],
    },
    {
      at: 6000,
      title: 'Confirm cho message persistent luôn đến trễ hơn',
      body: 'So sánh thời điểm confirm: message `persistent` vào `orders` phải chờ broker ghi xong xuống đĩa rồi mới được xác nhận, còn message transient chỉ cần route xong là confirm ngay. Khoảng trễ đó chính là cái giá của durability — chậm hơn, nhưng đổi lại là một lời hứa thật sự.',
      highlight: ['orders', 'p1'],
    },
  ],
  checkpoints: [
    {
      at: 9000,
      question: 'Nếu broker restart ngay sau khi cả bốn message đã nằm trong `orders`, điều gì sống sót?',
      options: [
        'Cả bốn message, vì `orders` là `durable`',
        'Chỉ những message mang `persistent: true`, vì `durable` một mình không đủ',
        'Không message nào, vì broker restart luôn xóa sạch mọi queue',
      ],
      answerIndex: 1,
      explanation:
        'Chỉ message vừa `persistent` vừa nằm trong queue `durable` mới sống sót — đúng ba trong bốn message ở đây. Message thứ ba là `persistent: false` nên vẫn mất, dù `orders` bản thân nó sống sót qua restart.',
    },
  ],
}
