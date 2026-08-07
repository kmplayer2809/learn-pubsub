import type { Lesson } from './types'

export const ttlAndMaxLength: Lesson = {
  id: '12-ttl-maxlen',
  group: 'dlx',
  title: 'TTL & max-length',
  summary: 'Message hết hạn hoặc queue tràn đều bị dead-letter khi có DLX, và bị âm thầm bỏ khi không có.',
  seed: 12,
  durationMs: 16_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [
      { id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } },
      { id: 'dlx', label: 'DLX', type: 'fanout', position: { x: 480, y: 400 } },
    ],
    queues: [
      {
        id: 'short-lived',
        label: 'short-lived',
        kind: 'classic',
        messageTtlMs: 2500,
        maxLength: 3,
        deadLetterExchange: 'dlx',
        position: { x: 480, y: 180 },
      },
      { id: 'expired', label: 'expired', kind: 'classic', position: { x: 700, y: 400 } },
    ],
    consumers: [
      {
        id: 'expired-inspector',
        label: 'Expired-letter inspector',
        queueId: 'expired',
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
      {
        id: 'b1',
        exchangeId: 'ex',
        destinationId: 'short-lived',
        destinationKind: 'queue',
        routingKey: 'job',
      },
      { id: 'b2', exchangeId: 'dlx', destinationId: 'expired', destinationKind: 'queue' },
    ],
  },
  script: [0, 400, 800, 1200, 1600, 2000].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: '`short-lived` không có consumer nào cả',
      body: '`short-lived` khai báo `messageTtlMs: 2500` và `maxLength: 3`, nhưng không hề có consumer nào bind vào nó. Message chỉ nằm đó, chờ hết hạn hoặc chờ bị đẩy ra vì queue đầy.',
      highlight: ['short-lived'],
    },
    {
      at: 1400,
      title: 'Message thứ tư làm tràn queue trước khi kịp hết hạn',
      body: 'Với `maxLength: 3`, message thứ tư đẩy độ sâu queue vượt giới hạn trước khi bất kỳ message nào trong ba message đầu kịp chạm mốc 2500ms TTL. Theo chính sách mặc định `drop-head`, message *cũ nhất* trong queue bị đẩy ra để nhường chỗ, không phải message vừa tới.',
      highlight: ['short-lived'],
    },
    {
      at: 4200,
      title: 'Những message còn lại hết hạn theo TTL',
      body: 'Các message sống sót qua đợt tràn tiếp tục nằm trong `short-lived` cho tới khi chạm mốc `messageTtlMs`. Khi đó chúng cũng bị dead-letter, chỉ khác lý do: *expired* thay vì *maxlen*.',
      highlight: ['short-lived'],
    },
    {
      at: 8000,
      title: 'Có DLX thì dead-letter, không có thì âm thầm mất',
      body: 'Cả tràn queue lẫn hết hạn TTL đều dẫn tới cùng một nhánh xử lý: nếu queue có khai báo `deadLetterExchange`, message được chuyển sang đó — ở đây là `dlx`, rồi tới `expired`. Nếu không có DLX nào được khai báo, message bị bỏ hoàn toàn, không để lại dấu vết.',
      highlight: ['dlx', 'expired'],
    },
    {
      at: 12000,
      title: 'TTL cộng DLX chính là delay primitive chuẩn',
      body: 'Một queue mang TTL và trỏ DLX về một nơi khác, không có consumer nào tiêu thụ trực tiếp, là cách RabbitMQ hiện thực hóa độ trễ mà không cần bất kỳ timer nào trong tầng ứng dụng. Lesson 13 dùng đúng nguyên lý này để xây một vòng retry có backoff.',
      highlight: ['short-lived', 'dlx'],
    },
  ],
}
