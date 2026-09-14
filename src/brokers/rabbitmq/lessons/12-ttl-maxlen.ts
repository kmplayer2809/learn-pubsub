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
  checkpoints: [
    {
      at: 6000,
      question: '`maxLength: 3` đã đầy, message thứ tư tới nơi. Message nào bị đẩy ra?',
      options: [
        'Message vừa tới, vì queue đã hết chỗ',
        'Message cũ nhất trong queue, theo chính sách `drop-head`',
        'Một message ngẫu nhiên trong ba message đang chờ',
      ],
      answerIndex: 1,
      explanation:
        'Mặc định `x-overflow` là `drop-head`: queue nhận message mới rồi đẩy message ở đầu hàng ra ngoài. Muốn giữ hàng chờ hiện có và từ chối message mới thì phải đổi sang `reject-publish`.',
    },
    {
      at: 9000,
      question: 'Message hết hạn TTL rồi bị dead-letter mang lý do nào trong `x-death-reason`?',
      options: ['*expired*', '*rejected*', '*maxlen*'],
      answerIndex: 0,
      explanation:
        'Ba lý do dùng chung một nhánh dead-letter nhưng ghi nhãn khác nhau: *rejected* khi consumer từ chối, *expired* khi hết TTL, *maxlen* khi queue tràn. Nhãn này là thứ giúp phân loại message ở nơi hứng.',
    },
    {
      at: 16_000,
      question:
        'Tổng kết: muốn message tự động chuyển sang queue khác sau đúng 30 giây, dựng thế nào?',
      options: [
        'Một queue có `messageTtlMs: 30000`, trỏ DLX tới đích, không consumer nào bind vào',
        'Một queue có `maxLength: 1` để message bị đẩy đi ngay',
        'Một consumer đọc message rồi tự ngủ 30 giây trước khi ack',
      ],
      answerIndex: 0,
      explanation:
        'Queue không consumer cộng TTL cộng DLX chính là delay primitive chuẩn của RabbitMQ: message nằm chờ đủ 30 giây, hết hạn, rồi được dead-letter sang đích. Cách cho consumer tự ngủ thì chiếm giữ kết nối, dễ chạm timeout, lại mất hiệu lực ngay khi tiến trình chết.',
    },
  ],
  quiz: [
    {
      question: 'Muốn giữ nguyên hàng chờ hiện có, từ chối message mới lúc queue đầy thì đặt gì?',
      options: [
        '`x-overflow` sang `reject-publish`',
        '`x-overflow` sang `drop-head`',
        '`messageTtlMs` bằng 0',
        '`maxPriority` bằng 1',
      ],
      answerIndex: 0,
      explanation:
        'Mặc định `drop-head` hy sinh message cũ để nhận message mới. `reject-publish` đảo ngược ưu tiên đó: queue giữ nguyên nội dung, publish mới bị từ chối — publisher biết ngay thay vì mất message âm thầm.',
    },
    {
      question: 'Vì sao `short-lived` mất message dù chưa message nào chạm mốc TTL?',
      options: [
        '`maxLength: 3` tràn trước, message cũ nhất bị đẩy ra',
        'TTL được tính từ lúc publish message đầu tiên',
        'Queue không consumer thì broker xóa luôn queue',
        'Message thứ tư ghi đè message đầu tiên',
      ],
      answerIndex: 0,
      explanation:
        'Hai giới hạn chạy song song, cái nào tới trước thì cái đó quyết định. Nhịp publish 400ms khiến queue đầy ngay ở message thứ tư, sớm hơn mốc 2500ms rất nhiều.',
    },
    {
      question: 'Message bị đẩy ra vì tràn queue có mất luôn không?',
      options: [
        'Không, nếu queue khai báo DLX thì nó được chuyển sang đó',
        'Có, tràn queue luôn đồng nghĩa mất message',
        'Không, broker giữ nó trong bộ nhớ chờ chỗ trống',
        'Có, chỉ message hết TTL mới được dead-letter',
      ],
      answerIndex: 0,
      explanation:
        'Tràn queue lẫn hết hạn TTL đều đi vào cùng một nhánh dead-letter. Thiếu `deadLetterExchange` thì cả hai trường hợp đều mất sạch, không dấu vết.',
    },
    {
      question: 'Đặt `messageTtlMs` trên queue khác gì đặt TTL trên từng message?',
      options: [
        'TTL trên queue áp cho mọi message như nhau, TTL trên message thì mỗi cái một hạn riêng',
        'Không khác gì, broker gộp cả hai thành một',
        'TTL trên queue chỉ áp cho message `persistent`',
        'TTL trên message bị bỏ qua nếu queue có DLX',
      ],
      answerIndex: 0,
      explanation:
        'Đồng nhất một hạn cho cả queue chính là cách bậc thang delay queue hoạt động. TTL riêng từng message nghe linh hoạt hơn nhưng vướng head-of-line blocking ở classic queue — bài delay sẽ mổ xẻ chỗ này.',
    },
  ],
}
