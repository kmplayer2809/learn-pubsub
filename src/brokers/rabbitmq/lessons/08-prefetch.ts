import type { Lesson } from './types'

export const prefetchQos: Lesson = {
  id: '08-prefetch',
  group: 'reliability',
  title: 'Prefetch & QoS',
  summary: 'Prefetch không giới hạn để một consumer ôm trọn queue; prefetch 1 chia đều công việc.',
  seed: 8,
  durationMs: 20_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 220 } }],
    exchanges: [{ id: 'ex', label: 'Fanout exchange', type: 'fanout', position: { x: 260, y: 220 } }],
    queues: [
      { id: 'greedy-q', label: 'greedy-q', kind: 'classic', position: { x: 480, y: 80 } },
      { id: 'fair-q', label: 'fair-q', kind: 'classic', position: { x: 480, y: 380 } },
    ],
    consumers: [
      {
        id: 'greedy',
        label: 'Greedy consumer',
        queueId: 'greedy-q',
        prefetch: 0,
        autoAck: false,
        processingMs: 1200,
        jitterMs: 600,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 80 },
      },
      {
        id: 'fair-a',
        label: 'Fair consumer A',
        queueId: 'fair-q',
        prefetch: 1,
        autoAck: false,
        processingMs: 1200,
        jitterMs: 600,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 320 },
      },
      {
        id: 'fair-b',
        label: 'Fair consumer B',
        queueId: 'fair-q',
        prefetch: 1,
        autoAck: false,
        processingMs: 1200,
        jitterMs: 600,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 440 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'greedy-q', destinationKind: 'queue' },
      { id: 'b2', exchangeId: 'ex', destinationId: 'fair-q', destinationKind: 'queue' },
    ],
  },
  script: Array.from({ length: 12 }, (_, i) => ({
    at: i * 200,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'Cùng một nhịp publish, hai chính sách prefetch khác nhau',
      body: '`greedy` khai báo `prefetch: 0` — không giới hạn. `fair-a` và `fair-b` đều khai báo `prefetch: 1`. Publisher bơm mười hai message liên tiếp, cách nhau 200ms, để cả hai queue nhận cùng một áp lực.',
      highlight: ['greedy-q', 'fair-q'],
    },
    {
      at: 3000,
      title: '`greedy` ôm trọn queue chỉ trong vài giây',
      body: 'Vì `prefetch: 0`, `greedy` không bị chặn bởi số message chưa ack — nó nhận message mới ngay khi có, kể cả khi những message trước còn đang xử lý dở. Queue `greedy-q` gần như rỗng rất nhanh, nhưng bản thân `greedy` lại giữ một chồng message chưa ack.',
      highlight: ['greedy'],
    },
    {
      at: 9000,
      title: 'Ôm hết queue không giúp xử lý nhanh hơn',
      body: 'Dù `greedy-q` trống sớm, `greedy` vẫn phải xử lý tuần tự từng message một, mất `processingMs` cho mỗi message y hệt `fair-a` hay `fair-b`. Rỗng queue chỉ có nghĩa là message đã bị lấy đi, không có nghĩa là đã xử lý xong.',
      highlight: ['greedy', 'greedy-q'],
    },
    {
      at: 14000,
      title: '`prefetch: 1` giữ message lại cho bất kỳ consumer nào rảnh',
      body: 'Vì `fair-a` và `fair-b` chỉ được giữ đúng một message chưa ack, phần message còn lại vẫn nằm trong `fair-q`, sẵn sàng cho bất kỳ ai trong hai consumer rảnh trước. Đây chính là cơ chế khiến việc thêm consumer thực sự tăng throughput — thay vì để một consumer ôm hết việc như `greedy`.',
      highlight: ['fair-q', 'fair-a', 'fair-b'],
    },
  ],
  checkpoints: [
    {
      at: 4500,
      question: 'Ngay lúc này `fair-a` được phép giữ tối đa bao nhiêu message chưa ack?',
      options: ['0', '1', '2'],
      answerIndex: 1,
      explanation:
        '`prefetch: 1` cho phép đúng một message chưa ack mỗi consumer. Phần còn lại nằm trong `fair-q`, chờ ai rảnh trước thì nhận.',
    },
    {
      at: 9000,
      question: '`greedy-q` cạn sạch sớm hơn `fair-q` rất nhiều. Điều đó chứng tỏ gì?',
      options: [
        '`greedy` xử lý xong công việc nhanh hơn hai consumer kia cộng lại',
        'Message đã rời queue vào buffer của `greedy`, phần lớn còn chưa xử lý',
        'Broker ưu tiên `greedy-q` vì queue này bind trước',
      ],
      answerIndex: 1,
      explanation:
        'Độ sâu queue chỉ đo số message broker còn giữ, không đo tiến độ xử lý. `prefetch: 0` cho phép `greedy` kéo hết message về phía nó, nhưng vẫn xử lý tuần tự mất `processingMs` mỗi cái — hàng chờ chỉ dời chỗ chứ không ngắn đi.',
    },
    {
      at: 20_000,
      question:
        'Tổng kết: `greedy` đang ôm chồng message chưa ack thì tiến trình chết. Hậu quả là gì?',
      options: [
        'Toàn bộ chồng message chưa ack quay lại queue cùng một lúc',
        'Chỉ message đang xử lý dở quay lại, phần còn lại đã ack ngầm',
        'Không message nào quay lại, vì `prefetch: 0` tắt bookkeeping',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch không giới hạn nghĩa là số message chưa ack cũng không giới hạn, nên bán kính thiệt hại khi crash bằng đúng chồng message đó. Chúng bị requeue hàng loạt và giao lại, làm mất mọi công đã xử lý dở. Prefetch nhỏ giữ bán kính này ở mức có thể đoán trước.',
    },
  ],
  quiz: [
    {
      question: '`prefetch` giới hạn cái gì?',
      options: [
        'Số message chưa ack broker đẩy cho một consumer',
        'Số message mỗi queue chứa được',
        'Số consumer mỗi queue',
        'Kích thước tối đa của message',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch là cửa sổ message đã đẩy đi mà chưa được ack. Đầy cửa sổ thì broker ngừng đẩy cho consumer đó.',
    },
    {
      question: 'Consumer chậm giữ một message không ack, `prefetch: 1`, chuyện gì xảy ra?',
      options: [
        'Consumer đó không nhận thêm message nào cho tới khi ack',
        'Broker huỷ message rồi gửi cho consumer khác ngay',
        'Queue ngừng nhận message mới từ publisher',
        'Message tự động vào DLX',
      ],
      answerIndex: 0,
      explanation:
        'Chỉ consumer đó bị chặn. Queue vẫn nhận message mới, còn consumer khác vẫn được đẩy message bình thường.',
    },
    {
      question: 'Vì sao `prefetch` cao lại làm lệch tải giữa các consumer?',
      options: [
        'Một consumer ôm sẵn nhiều message dù nó đang xử lý chậm',
        'Broker ưu tiên consumer kết nối trước',
        'Message lớn luôn về cùng một consumer',
        'Routing key quyết định consumer nhận message',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch cao nghĩa là message nằm chờ trong bộ đệm của một consumer thay vì chờ trong queue, nơi consumer rảnh có thể nhận.',
    },
    {
      question: 'Với tác vụ ngắn, thời lượng đều nhau, nên đặt `prefetch` thế nào?',
      options: [
        'Cao hơn 1, để bớt vòng chờ giữa broker với consumer',
        'Luôn đặt bằng 1',
        'Đặt bằng số queue',
        'Không đặt, mặc định luôn tối ưu',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch 1 trả giá một vòng round-trip cho mỗi message. Tác vụ ngắn, đều nhau thì cửa sổ lớn hơn cho thông lượng cao hơn mà lệch tải không đáng kể.',
    },
  ],
}
