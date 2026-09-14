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
      at: 4200,
      question: 'Message thứ ba publish với `persistent: false`. Nó có vào `orders` không?',
      options: [
        'Có — route rồi tiêu thụ bình thường, chỉ khác lúc broker restart',
        'Không, broker từ chối message transient vào một queue `durable`',
        'Có, nhưng `worker` bỏ qua nó',
      ],
      answerIndex: 0,
      explanation:
        '`persistent` không ảnh hưởng tới routing hay tiêu thụ, nó chỉ quyết định message có được ghi xuống đĩa hay không. Khác biệt duy nhất lộ ra đúng lúc broker khởi động lại.',
    },
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
    {
      at: 12_000,
      question:
        'Tổng kết: publish với `persistent: true` vào queue `durable` nhưng **không** bật publisher confirm. Lỗ hổng còn lại nằm ở đâu?',
      options: [
        'Publisher chẳng bao giờ biết broker có thật sự nhận message hay chưa',
        'Message mất tính `persistent` khi thiếu confirm',
        'Không còn lỗ hổng nào, hai cờ kia đã đủ',
      ],
      answerIndex: 0,
      explanation:
        '`persistent` cộng `durable` bảo vệ message *sau khi* broker đã nhận. Confirm bảo vệ đoạn trước đó: kết nối rớt giữa chừng thì publish im lặng biến mất, ứng dụng vẫn tưởng đã gửi xong. Đủ bộ ba mới khép kín đường đi từ publisher tới đĩa.',
    },
  ],
  quiz: [
    {
      question: '`durable` nằm trên đâu, `persistent` nằm trên đâu?',
      options: [
        '`durable` trên queue, `persistent` trên từng message',
        '`durable` trên message, `persistent` trên queue',
        'Cả hai đều nằm trên queue',
        'Cả hai đều nằm trên exchange',
      ],
      answerIndex: 0,
      explanation:
        'Hai cờ ở hai tầng khác nhau nên phải đủ cả hai: queue sống sót qua restart, còn message cũng phải tự đánh dấu để được ghi xuống đĩa.',
    },
    {
      question: 'Queue `durable` nhưng message `persistent: false`. Sau restart còn lại gì?',
      options: [
        'Queue còn, message đó mất',
        'Cả queue lẫn message đều còn',
        'Cả hai đều mất',
        'Message còn, nhưng queue phải khai báo lại',
      ],
      answerIndex: 0,
      explanation:
        'Khai báo queue được ghi xuống đĩa nên `orders` xuất hiện lại sau restart, chỉ thiếu phần message transient. Độ bền chỉ khép kín khi cả hai tầng cùng bật.',
    },
    {
      question: 'Publisher confirm cho biết điều gì?',
      options: [
        'Broker đã nhận trách nhiệm với message',
        'Consumer đã ack message',
        'Message đã tới đúng consumer',
        'Message đã hết TTL',
      ],
      answerIndex: 0,
      explanation:
        'Confirm là lời xác nhận của broker về việc nhận message; với message `persistent` thì còn chờ ghi xong xuống đĩa. Nó không nói gì về phía tiêu thụ — ack mới là chuyện của consumer.',
    },
    {
      question: 'Vì sao confirm cho message `persistent` về trễ hơn message transient?',
      options: [
        'Broker chờ ghi xong xuống đĩa rồi mới xác nhận',
        'Message `persistent` phải qua thêm một exchange',
        'Broker nén message trước khi lưu',
        'Confirm transient được gửi trước cả lúc route',
      ],
      answerIndex: 0,
      explanation:
        'Khoảng trễ đó chính là cái giá của durability. Message transient chỉ cần route xong là confirm, nên nhanh hơn nhưng lời hứa cũng yếu hơn hẳn.',
    },
  ],
}
