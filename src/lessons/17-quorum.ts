import type { Lesson } from './types'

export const quorumVsClassic: Lesson = {
  id: '17-quorum',
  group: 'patterns',
  title: 'Quorum vs classic',
  summary: 'Consumer crash thì quorum và classic requeue giống hệt nhau; khác biệt thật sự chỉ lộ ra khi cả node chết.',
  seed: 17,
  durationMs: 20_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 260 } }],
    exchanges: [{ id: 'fanout-ex', label: 'fanout-ex', type: 'fanout', position: { x: 260, y: 260 } }],
    queues: [
      { id: 'classic-q', label: 'classic-q', kind: 'classic', position: { x: 480, y: 120 } },
      { id: 'quorum-q', label: 'quorum-q', kind: 'quorum', position: { x: 480, y: 420 } },
    ],
    consumers: [
      {
        id: 'classic-consumer',
        label: 'Classic consumer',
        queueId: 'classic-q',
        prefetch: 2,
        autoAck: false,
        processingMs: 1800,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 120 },
      },
      {
        id: 'quorum-consumer',
        label: 'Quorum consumer',
        queueId: 'quorum-q',
        prefetch: 2,
        autoAck: false,
        processingMs: 1800,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 420 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'fanout-ex', destinationId: 'classic-q', destinationKind: 'queue' },
      { id: 'b2', exchangeId: 'fanout-ex', destinationId: 'quorum-q', destinationKind: 'queue' },
    ],
  },
  script: [0, 400, 800, 1200, 1600, 2000].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'fanout-ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  failures: [
    { at: 3000, consumerId: 'classic-consumer', kind: 'crash' },
    { at: 3000, consumerId: 'quorum-consumer', kind: 'crash' },
    { at: 7000, consumerId: 'classic-consumer', kind: 'recover' },
    { at: 7000, consumerId: 'quorum-consumer', kind: 'recover' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Hai lane giống hệt nhau, chỉ khác `kind`',
      body: '`fanout-ex` gửi mỗi Job tới cả `classic-q` lẫn `quorum-q`. Hai queue nhận cùng lượng message, cùng `prefetch: 2`, cùng consumer với `processingMs: 1800` — khác biệt duy nhất trong topology này là `kind: classic` so với `kind: quorum`.',
      highlight: ['fanout-ex', 'classic-q', 'quorum-q'],
    },
    {
      at: 3000,
      title: 'Cả hai consumer cùng crash lúc đang ôm message',
      body: 'Ở mốc 3000ms, `classic-consumer` và `quorum-consumer` cùng crash. Mỗi consumer đang giữ một số message chưa ack — theo `prefetch: 2` thì tối đa hai message — và cả hai bị trả về đầu queue của chúng, chờ giao lại.',
      highlight: ['classic-consumer', 'quorum-consumer'],
    },
    {
      at: 7000,
      title: 'Hồi phục xong, cả hai lane xử lý tiếp như chưa hề có chuyện gì',
      body: 'Khi hai consumer hồi phục lúc 7000ms, message bị requeue được giao lại và xử lý tiếp cho tới khi hết. Nhìn vào `classic-q` và `quorum-q` lúc này, không cách nào phân biệt được lane nào là quorum, lane nào là classic — hành vi requeue khi consumer chết giống hệt nhau.',
      highlight: ['classic-q', 'quorum-q'],
    },
    {
      at: 12000,
      title: 'Khác biệt thật sự không nằm ở consumer, mà ở node',
      body: 'Mô phỏng này chỉ tạo ra sự cố ở tầng consumer, chưa từng làm chết một broker node nào. Trên thực tế, `classic-q` không mirror sống trên đúng một node — node đó chết là toàn bộ nội dung queue mất theo. `quorum-q` replicate dữ liệu qua nhiều node bằng Raft, cần một majority đồng thuận cho mỗi thao tác, nên một node chết không làm mất bất kỳ message nào đã được xác nhận.',
      highlight: ['classic-q', 'quorum-q'],
    },
    {
      at: 16000,
      title: 'Đừng suy ra độ bền từ một mô phỏng chỉ giết consumer',
      body: 'Nếu chỉ nhìn kết quả của lesson này, hai loại queue trông như tương đương. Kết luận đó chỉ đúng trong phạm vi hẹp: sự cố consumer. Câu hỏi thật sự đáng hỏi là node có thể chết hay không — và đó là câu hỏi mô phỏng trong trình duyệt này không có khả năng trả lời.',
      highlight: ['classic-q', 'quorum-q'],
    },
  ],
  checkpoints: [
    {
      at: 18000,
      question: 'Lesson này cho hai lane requeue giống hệt nhau khi consumer crash. Kết luận nào đúng về `classic-q` và `quorum-q`?',
      options: [
        'Hai loại queue hoàn toàn tương đương, không cần dùng quorum queue nữa',
        'Kết quả chỉ chứng minh chúng giống nhau khi consumer chết; khi cả broker node chết, `classic-q` không mirror có thể mất sạch còn `quorum-q` vẫn còn nhờ Raft majority',
        'Quorum queue luôn xử lý message nhanh hơn classic queue',
      ],
      answerIndex: 1,
      explanation:
        'Mô phỏng chỉ crash consumer, không crash node. Sự cố consumer không phân biệt được hai loại queue, nhưng sự cố node thì có: classic queue không mirror sống trên một node, còn quorum queue replicate qua Raft majority nên chịu được một node chết.',
    },
  ],
}
