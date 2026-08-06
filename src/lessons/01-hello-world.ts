import type { Lesson } from './types'

export const helloWorld: Lesson = {
  id: '01-hello-world',
  group: 'basics',
  title: 'Hello world',
  summary: 'Một publisher, một queue, một consumer, và default exchange.',
  seed: 1,
  durationMs: 12_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 140 } }],
    exchanges: [{ id: 'default', label: '(default)', type: 'direct', position: { x: 260, y: 140 } }],
    queues: [{ id: 'hello', label: 'hello', kind: 'classic', position: { x: 480, y: 140 } }],
    consumers: [
      {
        id: 'c1',
        label: 'Consumer',
        queueId: 'hello',
        prefetch: 1,
        autoAck: false,
        processingMs: 900,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 140 },
      },
    ],
    bindings: [
      {
        id: 'b1',
        exchangeId: 'default',
        destinationId: 'hello',
        destinationKind: 'queue',
        routingKey: 'hello',
      },
    ],
  },
  script: [0, 1500, 3000, 4500].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'default',
    routingKey: 'hello',
    body: `Hello ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'Publisher không bao giờ ghi thẳng vào queue',
      body: 'Publisher luôn giao message cho một **exchange**, không có ngoại lệ. Ngay cả kiểu "gửi thẳng vào queue" bạn thường thấy trong các hướng dẫn cũng đi qua *default exchange*, exchange này có sẵn một binding ngầm định tới mọi queue, dùng tên queue làm routing key.',
      highlight: ['p1', 'default'],
    },
    {
      at: 1200,
      title: 'Exchange route dựa trên routing key',
      body: 'Message này mang routing key `hello`. Default exchange là một direct exchange, nên nó tìm binding có key khớp chính xác, và tìm ra queue `hello`.',
      highlight: ['default', 'hello'],
    },
    {
      at: 2400,
      title: 'Queue đóng vai trò buffer',
      body: 'Queue giữ message lại cho tới khi consumer sẵn sàng. Depth tăng lên khi publisher sản xuất nhanh hơn consumer tiêu thụ — chính khoảng cách đó là lý do broker tồn tại.',
      highlight: ['hello'],
    },
    {
      at: 4000,
      title: 'Consumer thực hiện ack',
      body: 'Với `prefetch: 1` và manual ack, consumer chỉ giữ đúng một message chưa ack tại một thời điểm. Chỉ khi nó ack xong thì queue mới giải phóng message kế tiếp. Hãy quan sát queue drain từng message một theo chu kỳ thay vì giải phóng tất cả cùng lúc.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 6000,
      question: 'Nếu consumer ngừng ack, điều gì sẽ xảy ra với queue?',
      options: [
        'Queue vẫn tiếp tục delivery; message chất đống ở phía consumer',
        'Queue ngừng delivery sau một message và depth tăng lên',
        'Broker drop các message dư ra',
      ],
      answerIndex: 1,
      explanation:
        'Prefetch giới hạn số message chưa ack. Với `prefetch: 1`, một message chưa ack sẽ chặn toàn bộ delivery kế tiếp tới consumer đó, nên queue depth tăng lên thay vì dừng hẳn.',
    },
  ],
}
