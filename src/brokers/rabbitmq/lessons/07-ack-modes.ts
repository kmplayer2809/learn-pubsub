import type { Lesson } from './types'

export const ackModes: Lesson = {
  id: '07-ack-modes',
  group: 'reliability',
  title: 'Ack modes',
  summary: 'Auto-ack xác nhận ngay khi giao message; manual ack chỉ xác nhận sau khi xử lý xong.',
  seed: 7,
  durationMs: 14_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Fanout exchange', type: 'fanout', position: { x: 260, y: 180 } }],
    queues: [
      { id: 'auto-q', label: 'auto-q', kind: 'classic', position: { x: 480, y: 60 } },
      { id: 'manual-q', label: 'manual-q', kind: 'classic', position: { x: 480, y: 320 } },
    ],
    consumers: [
      {
        id: 'auto',
        label: 'Auto-ack consumer',
        queueId: 'auto-q',
        prefetch: 1,
        autoAck: true,
        processingMs: 1500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 60 },
      },
      {
        id: 'manual',
        label: 'Manual-ack consumer',
        queueId: 'manual-q',
        prefetch: 1,
        autoAck: false,
        processingMs: 1500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 320 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'auto-q', destinationKind: 'queue' },
      { id: 'b2', exchangeId: 'ex', destinationId: 'manual-q', destinationKind: 'queue' },
    ],
  },
  script: [0, 800, 1600, 2400].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  failures: [
    { at: 2000, consumerId: 'auto', kind: 'crash' },
    { at: 2000, consumerId: 'manual', kind: 'crash' },
    { at: 6000, consumerId: 'auto', kind: 'recover' },
    { at: 6000, consumerId: 'manual', kind: 'recover' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Hai lane giống hệt nhau, chỉ khác chế độ ack',
      body: 'Cùng một `ex` kiểu fanout gửi mỗi message tới cả `auto-q` lẫn `manual-q`. `auto` dùng `autoAck: true`, `manual` dùng `autoAck: false`. Mọi tham số khác — `processingMs`, timing publish — đều giống hệt nhau, để phần khác biệt duy nhất còn lại chính là ack mode.',
      highlight: ['auto-q', 'manual-q'],
    },
    {
      at: 2000,
      title: 'Cả hai consumer cùng crash lúc đang xử lý dở',
      body: 'Ở mốc này, `auto` không hề giữ message nào chưa ack trong bookkeeping của broker — với auto-ack, broker không theo dõi message sau khi giao, nên chẳng có gì để requeue khi crash. Message `auto` vừa nhận chỉ đơn giản biến mất: nó đã delivered nhưng chưa xử lý xong, và `acked` cũng không tăng cho nó. `manual` thì khác: message nó đang xử lý dở vẫn nằm trong bảng unacked, và crash lập tức trả message đó về đầu `manual-q`.',
      highlight: ['auto', 'manual'],
    },
    {
      at: 6000,
      title: 'Consumer hồi phục, message của manual quay lại với redeliveryCount tăng',
      body: 'Khi `manual` hồi phục, message vừa bị trả về queue được giao lại, và lần này `redeliveryCount` của nó đã tăng thêm một. `auto` cũng hồi phục và tiếp tục nhận message mới bình thường, nhưng không hề có cơ chế nào phục hồi message đã mất bookkeeping từ trước.',
      highlight: ['manual-q', 'auto-q'],
    },
    {
      at: 10000,
      title: 'Cái giá của mỗi chế độ',
      body: 'Manual ack trả giá bằng bookkeeping: broker phải nhớ mọi message chưa ack để có thể requeue khi cần. Auto-ack trả giá bằng rủi ro mất mát âm thầm: một khi đã giao, broker quên hẳn message đó, nên nếu consumer gặp sự cố giữa chừng thì chẳng có `redeliveryCount` nào ghi nhận lại.',
      highlight: ['auto', 'manual'],
    },
  ],
}
