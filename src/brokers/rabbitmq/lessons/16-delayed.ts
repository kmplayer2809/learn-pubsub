import type { Lesson } from './types'

export const delayedMessage: Lesson = {
  id: '16-delayed',
  group: 'patterns',
  title: 'Delayed message',
  summary: 'Không có delay primitive nào trong core RabbitMQ; một queue mang TTL và trỏ DLX chính là cách giả lập nó.',
  seed: 16,
  durationMs: 20_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 200 } }],
    exchanges: [
      { id: 'delay-ex', label: 'delay-ex', type: 'direct', position: { x: 260, y: 200 } },
      { id: 'main-ex', label: 'main-ex', type: 'direct', position: { x: 480, y: 420 } },
    ],
    queues: [
      {
        id: 'delay-5s',
        label: 'delay-5s',
        kind: 'classic',
        messageTtlMs: 5000,
        deadLetterExchange: 'main-ex',
        deadLetterRoutingKey: 'now',
        position: { x: 480, y: 200 },
      },
      { id: 'due', label: 'due', kind: 'classic', position: { x: 700, y: 420 } },
    ],
    consumers: [
      {
        id: 'handler',
        label: 'Handler',
        queueId: 'due',
        prefetch: 1,
        autoAck: false,
        processingMs: 400,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 920, y: 420 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'delay-ex', destinationId: 'delay-5s', destinationKind: 'queue', routingKey: 'delay' },
      { id: 'b2', exchangeId: 'main-ex', destinationId: 'due', destinationKind: 'queue', routingKey: 'now' },
    ],
  },
  script: [0, 500, 1000].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'delay-ex',
    routingKey: 'delay',
    body: `Scheduled ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'Không có delay primitive nào trong core RabbitMQ',
      body: 'Muốn một message chỉ xuất hiện sau một khoảng thời gian, core RabbitMQ không cho publisher đặt lịch trực tiếp. Ba message được publish vào `delay-ex`, rơi vào `delay-5s` — một queue không hề có consumer nào bind vào nó.',
      highlight: ['delay-ex', 'delay-5s'],
    },
    {
      at: 2500,
      title: '`delay-5s` là một cái đồng hồ đếm ngược, không phải queue công việc',
      body: 'Cả ba message đang nằm trong `delay-5s`, mỗi message mang `messageTtlMs: 5000` riêng của nó. Không consumer nào tới lấy — thứ duy nhất khiến chúng rời khỏi đây là hết hạn TTL, không phải bị tiêu thụ.',
      highlight: ['delay-5s'],
    },
    {
      at: 7000,
      title: 'Hết TTL, `deadLetterExchange` là nơi message tỉnh dậy',
      body: '`delay-5s` khai báo `deadLetterExchange: main-ex` và `deadLetterRoutingKey: now`. Khi TTL hết hạn, message không hề biến mất — nó bị dead-letter sang `main-ex` với routing key `now`, rồi route tiếp vào `due`, nơi `handler` đang chờ sẵn.',
      highlight: ['delay-5s', 'main-ex', 'due', 'handler'],
    },
    {
      at: 11000,
      title: 'Ba message hết hạn đúng thứ tự chúng đã vào queue',
      body: 'Vì cả ba message cùng chung `messageTtlMs: 5000` và được publish cách nhau chỉ 500ms, chúng hết hạn theo đúng thứ tự chúng vào `delay-5s`, rồi lần lượt được `handler` xử lý và ack.',
      highlight: ['due', 'handler'],
    },
    {
      at: 15000,
      title: 'Trên RabbitMQ thật, cái giá phải trả là head-of-line blocking',
      body: 'Một classic queue thật chỉ xét hết hạn ở đầu của nó. Nếu message đứng đầu mang TTL dài hơn message ngay sau nó, message phía sau — dù đáng lẽ hết hạn sớm hơn — vẫn phải chờ message đứng trước rời đi. Mô phỏng này không tái hiện chi tiết đó: nó đặt cho mỗi message một `ttlExpire` riêng, nên ở đây mỗi message hết hạn theo đồng hồ của chính nó, bất kể vị trí trong queue. Hãy nhớ giới hạn này khi mang TTL cộng DLX ra dùng làm delay primitive ngoài production.',
      highlight: ['delay-5s'],
    },
  ],
  checkpoints: [
    {
      at: 17000,
      question: 'Nếu message thứ hai trong `delay-5s` mang một TTL riêng ngắn hơn message đứng đầu, mô phỏng này xử lý khác một classic queue thật ở điểm nào?',
      options: [
        'Không khác gì: cả hai đều cho message thứ hai hết hạn ngay khi tới hạn của nó',
        'Mô phỏng cho mỗi message một timer riêng nên message thứ hai hết hạn đúng hạn; một classic queue thật chỉ xét ở đầu queue, nên message đó có thể phải chờ message đứng trước rời đi',
        'Không khác gì: cả hai đều sắp xếp lại queue theo TTL còn lại ngắn nhất',
      ],
      answerIndex: 1,
      explanation:
        'Mô phỏng đặt một `ttlExpire` riêng cho mỗi message, nên vị trí trong queue không ảnh hưởng tới thời điểm hết hạn. RabbitMQ thật chỉ kiểm tra hết hạn ở đầu một classic queue — đó chính là head-of-line blocking, một giới hạn mô phỏng này không tái hiện.',
    },
  ],
}
