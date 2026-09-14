import type { Lesson } from './types'

export const fanoutExchange: Lesson = {
  id: '03-fanout',
  group: 'basics',
  title: 'Fanout exchange',
  summary: 'Một message được broadcast tới mọi queue đã bind, bất kể routing key.',
  seed: 3,
  durationMs: 9_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Fanout exchange', type: 'fanout', position: { x: 260, y: 180 } }],
    queues: [
      { id: 'email', label: 'email', kind: 'classic', position: { x: 480, y: 60 } },
      { id: 'analytics', label: 'analytics', kind: 'classic', position: { x: 480, y: 180 } },
      { id: 'audit', label: 'audit', kind: 'classic', position: { x: 480, y: 300 } },
    ],
    consumers: [
      {
        id: 'c-email',
        label: 'Email consumer',
        queueId: 'email',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 60 },
      },
      {
        id: 'c-analytics',
        label: 'Analytics consumer',
        queueId: 'analytics',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 180 },
      },
      {
        id: 'c-audit',
        label: 'Audit consumer',
        queueId: 'audit',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 300 },
      },
    ],
    bindings: [
      {
        id: 'b1',
        exchangeId: 'ex',
        destinationId: 'email',
        destinationKind: 'queue',
        routingKey: 'ignored-a',
      },
      {
        id: 'b2',
        exchangeId: 'ex',
        destinationId: 'analytics',
        destinationKind: 'queue',
        routingKey: 'ignored-b',
      },
      {
        id: 'b3',
        exchangeId: 'ex',
        destinationId: 'audit',
        destinationKind: 'queue',
        routingKey: 'ignored-c',
      },
    ],
  },
  script: [
    { at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'whatever', body: 'Broadcast 1' },
    { at: 2000, publisherId: 'p1', exchangeId: 'ex', routingKey: 'whatever', body: 'Broadcast 2' },
    { at: 4000, publisherId: 'p1', exchangeId: 'ex', routingKey: 'whatever', body: 'Broadcast 3' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Fanout bỏ qua hoàn toàn routing key',
      body: 'Mỗi binding trên `ex` đều mang một routing key — `ignored-a`, `ignored-b`, `ignored-c` — nhưng fanout exchange chẳng bao giờ nhìn vào chúng. Mọi queue đã bind đều nhận mọi message.',
      highlight: ['p1', 'ex'],
    },
    {
      at: 1400,
      title: 'Một message trở thành ba bản copy',
      body: 'Hãy quan sát các chấm message rời khỏi `ex` rồi tách thành ba cùng lúc, một hướng về `email`, một hướng về `analytics`, một hướng về `audit`. Mỗi queue nhận một bản copy độc lập của cùng một message.',
      highlight: ['email', 'analytics', 'audit'],
    },
    {
      at: 3000,
      title: 'Một queue chậm không làm chậm các queue khác',
      body: 'Vì mỗi queue sở hữu bản copy của riêng mình, một consumer chậm chạp trong việc drain `audit` không ảnh hưởng gì tới tốc độ phục vụ của `email` hay `analytics`.',
      highlight: ['email', 'analytics', 'audit'],
    },
    {
      at: 5000,
      title: 'Không pattern, không ngoại lệ',
      body: 'Không có routing key nào khiến fanout exchange bỏ qua một queue đã bind. Bind vào fanout exchange chính là một subscription kiểu *broadcast*, chấm hết.',
      highlight: ['ex'],
    },
  ],
  checkpoints: [
    {
      at: 3000,
      question: 'Nếu publish một message với routing key `ignored-a`, queue nào nhận được nó?',
      options: [
        'Chỉ `email`, vì binding của nó mang đúng key đó',
        'Cả ba queue — fanout chẳng bao giờ đọc routing key',
        'Không queue nào, vì key phải rỗng ở fanout exchange',
      ],
      answerIndex: 1,
      explanation:
        'Fanout exchange bỏ qua routing key hoàn toàn. Key trên binding vẫn được lưu nhưng không tham gia quyết định route, nên `email`, `analytics` lẫn `audit` đều nhận một bản copy.',
    },
    {
      at: 5500,
      question: 'Ba queue drain với tốc độ khác nhau. `audit` chậm có kéo `email` chậm theo không?',
      options: [
        'Không — mỗi queue giữ bản copy riêng của nó',
        'Có, vì cả ba chia chung một bản copy',
        'Có, vì `ex` chờ mọi queue nhận xong mới phát tiếp',
      ],
      answerIndex: 0,
      explanation:
        'Fanout tạo bản copy độc lập cho từng queue đã bind. Consumer chậm chỉ làm queue của chính nó sâu thêm, các lane còn lại không hề biết.',
    },
    {
      at: 9_000,
      question:
        'Tổng kết: bạn cần `email` chỉ nhận sự kiện loại `signup`, còn `audit` vẫn nhận tất cả. Làm thế nào?',
      options: [
        'Đổi `ex` sang topic exchange rồi bind `email` theo pattern hẹp hơn',
        'Giữ fanout, đặt routing key `signup` cho binding của `email`',
        'Giữ fanout, cho `email` bind hai lần để tăng độ ưu tiên',
      ],
      answerIndex: 0,
      explanation:
        'Fanout không có bất kỳ cơ chế lọc nào — mọi queue đã bind đều nhận mọi message. Muốn lọc theo nội dung key, bạn phải đổi loại exchange sang topic hoặc direct; lúc đó `audit` vẫn bắt hết bằng pattern `#`.',
    },
  ],
  quiz: [
    {
      question: 'Fanout exchange quyết định route dựa trên cái gì?',
      options: [
        'Không dựa vào gì cả — mọi queue đã bind đều nhận',
        'Routing key của message',
        'Routing key ghi trên binding',
        'Header của message',
      ],
      answerIndex: 0,
      explanation:
        'Fanout bỏ qua routing key hoàn toàn, kể cả key ghi trên binding. Bind vào fanout exchange nghĩa là đăng ký nhận tất cả.',
    },
    {
      question: 'Binding của `email` mang key `ignored-a`. Message publish với key `ignored-a` tới đâu?',
      options: [
        'Cả ba queue',
        'Chỉ `email`',
        'Không queue nào',
        'Chỉ `analytics` cùng `audit`',
      ],
      answerIndex: 0,
      explanation:
        'Key trên binding vẫn được lưu nhưng fanout chẳng bao giờ đọc tới. Ba queue đều đã bind nên ba queue đều nhận một bản copy.',
    },
    {
      question: 'Một message vào fanout exchange có ba binding sinh ra bao nhiêu bản copy?',
      options: [
        'Ba bản độc lập, mỗi queue một bản',
        'Một bản dùng chung cho ba queue',
        'Ba bản nhưng chỉ queue rảnh nhất giữ lại',
        'Số bản bằng số consumer',
      ],
      answerIndex: 0,
      explanation:
        'Nhân bản xảy ra ở tầng queue: mỗi queue đã bind nhận bản copy riêng, có depth riêng, ack riêng. Số consumer không tham gia phép tính này.',
    },
    {
      question: 'Vì sao thêm một consumer nữa vào `email` *không* khiến mọi consumer cùng thấy mọi message?',
      options: [
        'Nhân bản thuộc về số queue; nhiều consumer trên một queue là chia việc',
        'Vì fanout chỉ hỗ trợ đúng một consumer mỗi queue',
        'Vì routing key rỗng chặn consumer thứ hai',
        'Vì prefetch mặc định bằng 1',
      ],
      answerIndex: 0,
      explanation:
        'Fanout nhân bản tới từng queue, không tới từng consumer. Hai consumer trên `email` sẽ cạnh tranh trên cùng một bản copy — muốn ai cũng thấy đủ thì mỗi bên cần queue riêng.',
    },
  ],
}
