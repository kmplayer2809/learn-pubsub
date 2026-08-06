import type { Lesson } from './types'

export const rpcPattern: Lesson = {
  id: '14-rpc',
  group: 'patterns',
  title: 'RPC',
  summary: 'RPC qua broker chỉ là hai message một chiều, nối lại bằng `replyTo` và `correlationId`.',
  seed: 14,
  durationMs: 16_000,
  topology: {
    publishers: [{ id: 'client', label: 'Client', position: { x: 40, y: 200 } }],
    exchanges: [
      { id: 'rpc-ex', label: 'rpc-ex', type: 'direct', position: { x: 260, y: 120 } },
      { id: 'replies', label: 'replies', type: 'direct', position: { x: 260, y: 380 } },
    ],
    queues: [
      { id: 'rpc-work', label: 'rpc-work', kind: 'classic', position: { x: 480, y: 120 } },
      { id: 'reply-q', label: 'reply-q', kind: 'classic', position: { x: 480, y: 380 } },
    ],
    consumers: [
      {
        id: 'worker',
        label: 'Worker',
        queueId: 'rpc-work',
        prefetch: 1,
        autoAck: false,
        processingMs: 1200,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: false,
        position: { x: 700, y: 120 },
      },
      {
        id: 'caller',
        label: 'Caller',
        queueId: 'reply-q',
        prefetch: 1,
        autoAck: false,
        processingMs: 200,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: false,
        position: { x: 700, y: 380 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'rpc-ex', destinationId: 'rpc-work', destinationKind: 'queue', routingKey: 'compute' },
      { id: 'b2', exchangeId: 'replies', destinationId: 'reply-q', destinationKind: 'queue', routingKey: 'corr-1' },
      { id: 'b3', exchangeId: 'replies', destinationId: 'reply-q', destinationKind: 'queue', routingKey: 'corr-2' },
      { id: 'b4', exchangeId: 'replies', destinationId: 'reply-q', destinationKind: 'queue', routingKey: 'corr-3' },
    ],
  },
  script: [0, 2000, 4000].map((at, i) => ({
    at,
    publisherId: 'client',
    exchangeId: 'rpc-ex',
    routingKey: 'compute',
    replyTo: 'replies',
    correlationId: `corr-${i + 1}`,
    body: `Request ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'RPC không phải một kết nối hai chiều',
      body: 'Không có socket nào nối thẳng `client` với `worker`. `client` chỉ publish một message vào `rpc-ex`, mang theo hai trường đặc biệt: `replyTo` ghi tên exchange sẽ nhận câu trả lời, còn `correlationId` gắn nhãn *request* này là `corr-1`, `corr-2` hay `corr-3`.',
      highlight: ['client', 'rpc-ex', 'rpc-work'],
    },
    {
      at: 3200,
      title: '`worker` ack xong là broker tự publish reply',
      body: 'Khi `worker` ack một request, broker tự động publish một message mới vào đúng exchange ghi trong `replyTo`, mang theo `correlationId` gốc làm routing key. `worker` không cần biết `caller` là ai hay đang nghe ở đâu — nó chỉ cần trả lời đúng chỗ được yêu cầu.',
      highlight: ['worker', 'replies', 'reply-q'],
    },
    {
      at: 6500,
      title: '`correlationId` là thứ giúp `caller` khớp câu trả lời',
      body: 'Ba request cùng đổ vào một `rpc-work`, ba reply cùng đổ vào một `reply-q`. `caller` phân biệt reply nào ứng với request nào chỉ nhờ `correlationId` đi kèm — không có nó, ba câu trả lời giống hệt nhau về mặt cấu trúc sẽ không thể ghép lại đúng cặp.',
      highlight: ['reply-q', 'caller'],
    },
    {
      at: 10000,
      title: 'Thứ tự reply không được đảm bảo',
      body: 'Ở đây `worker` xử lý tuần tự nên reply tình cờ về đúng thứ tự request được gửi. Nhưng nếu có nhiều worker chạy song song, hoặc một request mất nhiều thời gian xử lý hơn request sau nó, reply có thể về không đúng thứ tự publish — đó chính là lý do `correlationId` bắt buộc phải có, thay vì chỉ dựa vào thứ tự đến trước.',
      highlight: ['rpc-work', 'worker'],
    },
  ],
  checkpoints: [
    {
      at: 12500,
      question: 'Nếu message request thiếu trường `correlationId`, điều gì xảy ra với reply mà `worker` publish?',
      options: [
        'Broker tự sinh một `correlationId` mới cho reply',
        'Reply vẫn được publish vào `replyTo`, nhưng mang routing key rỗng nên có thể không tới đúng `caller`',
        'Broker từ chối publish reply vì thiếu `correlationId`',
      ],
      answerIndex: 1,
      explanation:
        'Routing key của reply chính là `correlationId` của request gốc. Thiếu `correlationId`, reply vẫn được publish nhưng với routing key rỗng, nên nó chỉ khớp một binding nếu binding đó cũng có routing key rỗng — nghĩa là rất dễ trở thành unroutable.',
    },
  ],
}
