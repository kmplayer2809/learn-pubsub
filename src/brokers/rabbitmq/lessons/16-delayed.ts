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
      at: 8000,
      question: 'Message vừa rời `delay-5s`. Cái gì đẩy nó đi?',
      options: [
        'TTL hết hạn, rồi `deadLetterExchange` đưa nó sang `main-ex`',
        '`handler` kéo nó trực tiếp từ `delay-5s`',
        'Queue tràn `maxLength`',
      ],
      answerIndex: 0,
      explanation:
        '`delay-5s` không có consumer nào bind vào. Hết hạn TTL là lối ra duy nhất, còn `deadLetterRoutingKey: now` quyết định nó rơi vào `due`.',
    },
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
    {
      at: 20_000,
      question:
        'Tổng kết: ứng dụng cần hoãn message với đủ mọi khoảng thời gian tùy ý, từ vài giây tới vài giờ. Cách nào bền vững trên RabbitMQ thật?',
      options: [
        'Một nhóm delay queue theo bậc cố định, hoặc plugin `rabbitmq_delayed_message_exchange`',
        'Một delay queue duy nhất, đặt TTL riêng cho từng message lúc publish',
        'Publish thẳng vào `due` rồi để `handler` tự ngủ tới lúc đến hạn',
      ],
      answerIndex: 0,
      explanation:
        'TTL trên từng message nghe hợp lý nhưng vướng đúng head-of-line blocking vừa nói: một message hạn dài đứng đầu chặn mọi message hạn ngắn phía sau. Bậc thang delay queue tránh được vì trong mỗi queue mọi message chung một TTL, còn plugin thì lập lịch thật sự thay vì mượn TTL.',
    },
  ],
  quiz: [
    {
      question: 'Core RabbitMQ có cho publisher hẹn giờ một message trực tiếp không?',
      options: [
        'Không — độ trễ phải dựng từ TTL cộng DLX, hoặc từ plugin',
        'Có, qua trường `x-delay` sẵn có',
        'Có, qua `priority` âm',
        'Có, nếu queue thuộc loại quorum',
      ],
      answerIndex: 0,
      explanation:
        'Không có delay primitive nào trong core. Queue không consumer, mang TTL, trỏ DLX là cách dựng lại độ trễ bằng đúng những gì broker đã có.',
    },
    {
      question: 'Vì sao `delay-5s` phải không có consumer nào?',
      options: [
        'Có consumer thì message bị lấy đi ngay, chẳng còn chờ gì nữa',
        'Vì consumer làm TTL ngừng chạy',
        'Vì broker cấm consumer trên queue có TTL',
        'Vì consumer sẽ xóa `deadLetterRoutingKey`',
      ],
      answerIndex: 0,
      explanation:
        'Delay queue là một đồng hồ đếm ngược, không phải queue công việc. Lối ra duy nhất được phép là hết hạn TTL, nên bất kỳ consumer nào cũng phá vỡ cơ chế.',
    },
    {
      question: 'Head-of-line blocking trên classic queue nghĩa là gì?',
      options: [
        'Queue chỉ xét hết hạn ở message đứng đầu, nên message hạn ngắn phía sau phải chờ',
        'Message đứng đầu luôn được ưu tiên xử lý trước',
        'Consumer đầu tiên chặn các consumer khác',
        'Queue khóa lại khi message đầu tiên hết hạn',
      ],
      answerIndex: 0,
      explanation:
        'Một message TTL dài nằm ở đầu sẽ giữ chỗ cho tới khi chính nó hết hạn. Mô phỏng này đặt cho mỗi message một `ttlExpire` riêng nên không tái hiện giới hạn đó.',
    },
    {
      question: 'Vì sao bậc thang delay queue tránh được head-of-line blocking?',
      options: [
        'Trong mỗi queue mọi message chung một TTL nên chúng hết hạn đúng thứ tự vào',
        'Vì mỗi bậc chỉ chứa đúng một message',
        'Vì broker sắp xếp lại queue theo TTL còn lại',
        'Vì mỗi bậc có consumer riêng lấy message ra',
      ],
      answerIndex: 0,
      explanation:
        'TTL đồng nhất nghĩa là message vào trước luôn hết hạn trước, nên việc chỉ xét ở đầu queue không gây kẹt. Đặt TTL riêng cho từng message trong một queue chung thì mất đúng tính chất này.',
    },
  ],
}
