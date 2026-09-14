import type { Lesson } from './types'

export const helloWorld: Lesson = {
  id: '01-hello-world',
  group: 'basics',
  title: 'Hello world',
  summary: 'Một publisher, một queue, một consumer, và default exchange.',
  seed: 1,
  durationMs: 12_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 140 } }],
    exchanges: [{ id: 'default', label: '(default)', type: 'direct', position: { x: 260, y: 140 } }],
    queues: [{ id: 'hello', label: 'hello', kind: 'classic', position: { x: 480, y: 140 } }],
    consumers: [
      {
        id: 'c1',
        label: 'Consumer',
        queueId: 'hello',
        prefetch: 1,
        autoAck: false,
        processingMs: 900,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 140 },
      },
    ],
    bindings: [
      {
        id: 'b1',
        exchangeId: 'default',
        destinationId: 'hello',
        destinationKind: 'queue',
        routingKey: 'hello',
      },
    ],
  },
  script: [0, 1500, 3000, 4500].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'default',
    routingKey: 'hello',
    body: `Hello ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'Publisher không bao giờ ghi thẳng vào queue',
      body: 'Publisher luôn giao message cho một **exchange**, không có ngoại lệ. Ngay cả kiểu "gửi thẳng vào queue" bạn thường thấy trong các hướng dẫn cũng đi qua *default exchange*, exchange này có sẵn một binding ngầm định tới mọi queue, dùng tên queue làm routing key.',
      highlight: ['p1', 'default'],
    },
    {
      at: 1200,
      title: 'Exchange route dựa trên routing key',
      body: 'Message này mang routing key `hello`. Default exchange là một direct exchange, nên nó tìm binding có key khớp chính xác, và tìm ra queue `hello`.',
      highlight: ['default', 'hello'],
    },
    {
      at: 2400,
      title: 'Queue đóng vai trò buffer',
      body: 'Queue giữ message lại cho tới khi consumer sẵn sàng. Depth tăng lên khi publisher sản xuất nhanh hơn consumer tiêu thụ — chính khoảng cách đó là lý do broker tồn tại.',
      highlight: ['hello'],
    },
    {
      at: 4000,
      title: 'Consumer thực hiện ack',
      body: 'Với `prefetch: 1` và manual ack, consumer chỉ giữ đúng một message chưa ack tại một thời điểm. Chỉ khi nó ack xong thì queue mới giải phóng message kế tiếp. Hãy quan sát queue drain từng message một theo chu kỳ thay vì giải phóng tất cả cùng lúc.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 2600,
      question: 'Queue `hello` đang phình ra. Điều đó nói lên chuyện gì?',
      options: [
        'Publisher tạo message nhanh hơn consumer xử lý',
        'Broker đang nhân bản message cho nhiều consumer',
        'Routing key sai nên message bị giữ lại',
      ],
      answerIndex: 0,
      explanation:
        'Queue là bộ đệm giữa hai tốc độ khác nhau. Depth tăng nghĩa là nhịp publish vượt nhịp tiêu thụ — chính khoảng cách đó là lý do broker tồn tại.',
    },
    {
      at: 6000,
      question: 'Nếu consumer ngừng ack, điều gì sẽ xảy ra với queue?',
      options: [
        'Queue vẫn tiếp tục delivery; message chất đống ở phía consumer',
        'Queue ngừng delivery sau một message và depth tăng lên',
        'Broker drop các message dư ra',
      ],
      answerIndex: 1,
      explanation:
        'Prefetch giới hạn số message chưa ack. Với `prefetch: 1`, một message chưa ack sẽ chặn toàn bộ delivery kế tiếp tới consumer đó, nên queue depth tăng lên thay vì dừng hẳn.',
    },
    {
      at: 12_000,
      question:
        'Tổng kết: bạn "gửi thẳng vào queue `hello`" bằng thư viện client. Đường đi thật sự của message là gì?',
      options: [
        'Client mở kết nối riêng tới queue, bỏ qua mọi exchange',
        'Message qua default exchange, dùng tên queue làm routing key',
        'Broker tự tạo một exchange tạm cho mỗi lần publish',
      ],
      answerIndex: 1,
      explanation:
        'Không có API nào publish thẳng vào queue. Default exchange là một direct exchange có sẵn binding ngầm tới mọi queue theo đúng tên queue, nên `hello` vừa là tên queue vừa là routing key. Hiểu điều này thì bốn loại exchange ở các bài sau chỉ còn là thay đổi luật khớp key.',
    },
  ],
  quiz: [
    {
      question: 'Publisher gửi message tới đâu trước tiên?',
      options: [
        'Một exchange, không có ngoại lệ',
        'Thẳng vào queue nếu biết tên queue',
        'Thẳng tới consumer đang rảnh',
        'Vào bảng unacked của broker',
      ],
      answerIndex: 0,
      explanation:
        'Không có API nào ghi thẳng vào queue. Kiểu "gửi thẳng vào queue" thực chất đi qua default exchange, nên mọi đường đi của message đều bắt đầu ở một exchange.',
    },
    {
      question: 'Default exchange thuộc loại nào, khớp message theo cái gì?',
      options: [
        'Direct, khớp routing key đúng bằng tên queue',
        'Fanout, gửi tới mọi queue đang tồn tại',
        'Topic, khớp theo pattern của tên queue',
        'Headers, khớp theo header `queue`',
      ],
      answerIndex: 0,
      explanation:
        'Default exchange là direct exchange mang sẵn một binding ngầm tới mọi queue, lấy tên queue làm routing key. Vì vậy `hello` vừa là tên queue vừa là routing key.',
    },
    {
      question: 'Với `prefetch: 1` cùng manual ack, khi nào consumer nhận message kế tiếp?',
      options: [
        'Sau khi nó ack message đang giữ',
        'Ngay khi message kế tiếp vào queue',
        'Sau mỗi 900ms theo `processingMs`',
        'Khi queue depth vượt một ngưỡng',
      ],
      answerIndex: 0,
      explanation:
        '`prefetch: 1` cho phép đúng một message chưa ack mỗi consumer. Ack chính là tín hiệu mở cửa sổ cho message kế tiếp, nên queue drain theo từng nhịp một.',
    },
    {
      question: 'Consumer ngừng ack hẳn. Queue `hello` ra sao?',
      options: [
        'Depth tăng dần, delivery dừng sau một message',
        'Broker drop phần message dư ra',
        'Message tự chuyển sang consumer khác',
        'Publisher bị chặn ngay lập tức',
      ],
      answerIndex: 0,
      explanation:
        'Một message chưa ack đã lấp kín cửa sổ `prefetch: 1`, nên broker ngừng đẩy tiếp cho consumer đó. Message mới vẫn vào queue bình thường, chỉ là không ai lấy đi.',
    },
  ],
}
