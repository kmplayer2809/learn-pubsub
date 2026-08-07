import type { Lesson } from './types'

export const dlxBasics: Lesson = {
  id: '11-dlx',
  group: 'dlx',
  title: 'Dead-letter exchange',
  summary: 'Reject không requeue route message sang dead-letter exchange thay vì xóa mất.',
  seed: 11,
  durationMs: 16_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [
      { id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } },
      { id: 'dlx', label: 'DLX', type: 'fanout', position: { x: 480, y: 400 } },
    ],
    queues: [
      {
        id: 'work',
        label: 'work',
        kind: 'classic',
        deadLetterExchange: 'dlx',
        position: { x: 480, y: 180 },
      },
      { id: 'dead', label: 'dead', kind: 'classic', position: { x: 700, y: 400 } },
    ],
    consumers: [
      {
        id: 'worker',
        label: 'Worker',
        queueId: 'work',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0.6,
        requeueOnNack: false,
        position: { x: 700, y: 180 },
      },
      {
        id: 'dead-inspector',
        label: 'Dead-letter inspector',
        queueId: 'dead',
        prefetch: 1,
        autoAck: false,
        processingMs: 400,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 920, y: 400 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'work', destinationKind: 'queue', routingKey: 'job' },
      { id: 'b2', exchangeId: 'dlx', destinationId: 'dead', destinationKind: 'queue' },
    ],
  },
  script: [0, 600, 1200, 1800, 2400, 3000].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: '`worker` reject phần lớn message, không cho requeue',
      body: '`work` khai báo `deadLetterExchange: dlx`. `worker` reject sáu mươi phần trăm message nó nhận, và `requeueOnNack: false` — vậy message reject không quay lại `work`, nó đi đâu khác.',
      highlight: ['work', 'worker'],
    },
    {
      at: 3200,
      title: 'Reject không requeue route sang dead-letter exchange',
      body: 'Thay vì biến mất, một message bị reject mà không requeue được chuyển sang `dlx` — chính exchange được khai báo là dead-letter exchange của `work`. Đây không phải một cơ chế bí ẩn, nó chỉ là một route bổ sung khi requeue bị tắt.',
      highlight: ['work', 'dlx'],
    },
    {
      at: 6000,
      title: '`x-death-reason` ghi lại vì sao message chết',
      body: 'Message bị dead-letter mang thêm header `x-death-reason` giải thích lý do — ở đây là *rejected*. Header này đi kèm message tới `dead`, để bất kỳ ai tiêu thụ nó cũng biết chuyện gì đã xảy ra.',
      highlight: ['dead'],
    },
    {
      at: 10000,
      title: 'DLX chỉ là một exchange bình thường',
      body: '`dlx` không có gì đặc biệt về mặt kỹ thuật — nó là một fanout exchange như bất kỳ exchange nào khác, chỉ được gán vai trò dead-letter exchange trên `work`. `dead-inspector` tiêu thụ từ `dead` giống hệt cách `worker` tiêu thụ từ `work`.',
      highlight: ['dlx', 'dead-inspector'],
    },
  ],
}
