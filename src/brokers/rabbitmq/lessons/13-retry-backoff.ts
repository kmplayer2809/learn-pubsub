import type { Lesson } from './types'

export const retryWithBackoff: Lesson = {
  id: '13-retry-backoff',
  group: 'dlx',
  title: 'Retry with backoff',
  summary: 'Một delay queue trỏ DLX ngược lại exchange chính tạo ra cơ chế retry có backoff mà không cần timer.',
  seed: 13,
  durationMs: 30_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 140 } }],
    exchanges: [
      { id: 'main-ex', label: 'main-ex', type: 'direct', position: { x: 260, y: 140 } },
      { id: 'retry-ex', label: 'retry-ex', type: 'direct', position: { x: 480, y: 400 } },
    ],
    queues: [
      {
        id: 'work',
        label: 'work',
        kind: 'classic',
        deadLetterExchange: 'retry-ex',
        deadLetterRoutingKey: 'retry',
        position: { x: 480, y: 140 },
      },
      {
        id: 'retry-1s',
        label: 'retry-1s',
        kind: 'classic',
        messageTtlMs: 1000,
        deadLetterExchange: 'main-ex',
        deadLetterRoutingKey: 'order',
        position: { x: 700, y: 400 },
      },
      { id: 'parking-lot', label: 'parking-lot', kind: 'classic', position: { x: 700, y: 600 } },
    ],
    consumers: [
      {
        id: 'worker',
        label: 'Worker',
        queueId: 'work',
        prefetch: 1,
        autoAck: false,
        processingMs: 400,
        jitterMs: 0,
        nackRate: 0.7,
        requeueOnNack: false,
        position: { x: 700, y: 140 },
      },
      {
        id: 'parking-inspector',
        label: 'Parking-lot inspector',
        queueId: 'parking-lot',
        prefetch: 1,
        autoAck: false,
        processingMs: 400,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 920, y: 600 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'main-ex', destinationId: 'work', destinationKind: 'queue', routingKey: 'order' },
      {
        id: 'b2',
        exchangeId: 'retry-ex',
        destinationId: 'retry-1s',
        destinationKind: 'queue',
        routingKey: 'retry',
      },
      {
        id: 'b3',
        exchangeId: 'retry-ex',
        destinationId: 'parking-lot',
        destinationKind: 'queue',
        routingKey: 'parked',
      },
    ],
  },
  script: [0, 800, 1600, 2400].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'main-ex',
    routingKey: 'order',
    body: `Order ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'Bốn queue, một vòng lặp retry không cần timer',
      body: '`worker` reject bảy mươi phần trăm message nó nhận, không cho requeue. `work` trỏ dead-letter exchange sang `retry-ex`, và `retry-ex` route message sang `retry-1s` — một queue chỉ tồn tại để giữ message đúng một giây rồi thả nó ra.',
      highlight: ['work', 'worker', 'retry-ex'],
    },
    {
      at: 3000,
      title: '`retry-1s` là một delay queue trá hình',
      body: '`retry-1s` không có consumer nào cả. Nó chỉ giữ message cho tới khi `messageTtlMs: 1000` hết hạn, rồi dead-letter message đó sang `main-ex` — chính exchange dùng để publish message lần đầu. Vòng lặp khép kín: `work → retry-ex → retry-1s → main-ex → work`.',
      highlight: ['retry-1s', 'main-ex'],
    },
    {
      at: 9000,
      title: 'Mỗi lượt đi qua đều để lại dấu vết trên death trail',
      body: 'Mỗi lần dead-letter, message được ghi thêm một mục vào `deathTrail`, và header `x-death-count` tăng lên. Đây chính là dữ liệu một hệ thống thật sẽ đọc để biết một message đã thử lại bao nhiêu lần.',
      highlight: ['work', 'retry-1s'],
    },
    {
      at: 16000,
      title: '`parking-lot` tồn tại cho những message đã thử đủ nhiều lần',
      body: '`retry-ex` cũng bind tới `parking-lot` với routing key `parked`, dành cho message đã chết đủ số lần cần thiết — nơi một con người xem xét thay vì để nó tiếp tục vòng lặp. Mô phỏng này không tự động đổi routing key khi `x-death-count` chạm ngưỡng; một hệ thống thật cần đọc header đó và tự quyết định khi nào chuyển hướng sang `parked`.',
      highlight: ['parking-lot', 'retry-ex'],
    },
    {
      at: 22000,
      title: 'Vòng lặp này dừng vì xác suất, không vì có ai canh gác',
      body: 'Trong lesson này, vòng retry cuối cùng dừng lại vì `nackRate` chỉ là bảy mươi phần trăm — sớm muộn `worker` cũng ack thành công. Không có bất kỳ ceiling nào trong topology chặn nó lại. Thiếu một death-count check tường minh, một message xui xẻo có thể lặp vô tận giữa `work` và `retry-1s`.',
      highlight: ['work', 'retry-1s'],
    },
  ],
  checkpoints: [
    {
      at: 20000,
      question: 'Nếu không có bất kỳ death-count check tường minh nào đọc `x-death-count`, điều gì sẽ xảy ra với một message luôn luôn bị `worker` reject?',
      options: [
        'Nó tự động được route sang `parking-lot` sau vài lần chết',
        'Nó lặp vô tận giữa `work` và `retry-1s`, không có gì chặn lại',
        'Broker tự hủy nó sau khi `redeliveryCount` vượt một ngưỡng mặc định',
      ],
      answerIndex: 1,
      explanation:
        'Routing key `parked` chỉ được dùng khi có logic ứng dụng đọc `x-death-count` rồi chủ động publish với key đó. Không có logic ấy, message cứ dead-letter qua lại giữa `work` và `retry-1s` mãi mãi — đúng như cảnh báo trong narrative phía trên.',
    },
  ],
}
