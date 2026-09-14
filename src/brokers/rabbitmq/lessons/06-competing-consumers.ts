import type { Lesson } from './types'

export const competingConsumers: Lesson = {
  id: '06-competing-consumers',
  group: 'basics',
  title: 'Competing consumers',
  summary: 'Một queue, nhiều consumer: công việc được chia, không bị nhân bản.',
  seed: 6,
  durationMs: 14_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } }],
    queues: [{ id: 'work', label: 'work', kind: 'classic', position: { x: 480, y: 180 } }],
    consumers: [
      {
        id: 'fast',
        label: 'Fast consumer',
        queueId: 'work',
        prefetch: 1,
        autoAck: false,
        processingMs: 400,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 60 },
      },
      {
        id: 'medium',
        label: 'Medium consumer',
        queueId: 'work',
        prefetch: 1,
        autoAck: false,
        processingMs: 900,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 180 },
      },
      {
        id: 'slow',
        label: 'Slow consumer',
        queueId: 'work',
        prefetch: 1,
        autoAck: false,
        processingMs: 2000,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 300 },
      },
    ],
    bindings: [{ id: 'b1', exchangeId: 'ex', destinationId: 'work', destinationKind: 'queue', routingKey: 'job' }],
  },
  script: Array.from({ length: 9 }, (_, i) => ({
    at: i * 300,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'Một queue, ba consumer cạnh tranh nhau',
      body: '`fast`, `medium`, và `slow` đều bind vào cùng một queue, `work`. Đây không phải fanout — mỗi message chỉ đi tới đúng *một* trong số họ. Ba consumer cạnh tranh để giành message thay vì bị nhân bản.',
      highlight: ['work', 'fast', 'medium', 'slow'],
    },
    {
      at: 1800,
      title: 'Delivery xoay vòng khi consumer còn rảnh',
      body: 'Với `prefetch: 1` trên mọi consumer, broker giao message kế tiếp cho bất kỳ consumer nào đủ điều kiện và tới lượt trong vòng xoay — nhưng chỉ khi consumer đó chưa giữ sẵn một message chưa ack.',
      highlight: ['work'],
    },
    {
      at: 5000,
      title: 'Consumer chậm bị tụt lại phía sau',
      body: '`slow` mất 2000ms để xử lý một message, gấp năm lần `fast` chỉ mất 400ms. Trong lúc `slow` còn đang bận với một message, nó bị bỏ qua, và `fast` đủ điều kiện trở lại sớm hơn nhiều.',
      highlight: ['slow', 'fast'],
    },
    {
      at: 9000,
      title: 'Chính prefetch tạo ra sự công bằng, không phải queue',
      body: 'Bản thân queue chẳng hề biết consumer nào nhanh hơn. Chính trần prefetch `1` mới là thứ giữ một consumer đang bận ra khỏi vòng xoay, để các consumer rảnh giành được nhiều phần việc hơn trong tổng khối lượng.',
      highlight: ['work'],
    },
  ],
  checkpoints: [
    {
      at: 5000,
      question:
        'Chín job chia cho ba consumer có tốc độ 400ms, 900ms, 2000ms. Mỗi consumer nhận bao nhiêu job?',
      options: [
        'Đúng ba job mỗi consumer — broker chia đều tuyệt đối',
        'Consumer nhanh nhận nhiều nhất, consumer chậm ít nhất',
        'Consumer chậm nhận nhiều nhất để bù thời gian rảnh',
      ],
      answerIndex: 1,
      explanation:
        'Với `prefetch: 1`, một consumer đang giữ message chưa ack sẽ bị bỏ qua trong vòng xoay. `slow` bận 2000ms mỗi job nên vắng mặt phần lớn thời gian, còn `fast` quay lại trạng thái rảnh sau mỗi 400ms nên gom được nhiều job hơn hẳn.',
    },
    {
      at: 9500,
      question: 'Ngay lúc này `slow` đang bận. Broker làm gì với message kế tiếp trong `work`?',
      options: [
        'Giao cho `fast` hoặc `medium` nếu một trong hai đang rảnh',
        'Giữ lại chờ `slow` tới lượt trong vòng xoay',
        'Nhân bản để cả ba consumer cùng xử lý',
      ],
      answerIndex: 0,
      explanation:
        'Vòng xoay chỉ tính những consumer chưa chạm trần prefetch. `slow` còn giữ một message chưa ack nên bị bỏ qua, message đi thẳng tới người rảnh gần nhất.',
    },
    {
      at: 14_000,
      question:
        'Tổng kết: bạn muốn cả ba consumer đều xử lý **mọi** job thay vì chia nhau. Phải đổi gì?',
      options: [
        'Cấp cho mỗi consumer một queue riêng, cùng bind vào một fanout exchange',
        'Nâng prefetch của cả ba consumer lên số lớn',
        'Thêm ba binding nữa từ `ex` tới queue `work`',
      ],
      answerIndex: 0,
      explanation:
        'Nhân bản là thuộc tính của số lượng queue, không phải số lượng consumer. Nhiều consumer trên **một** queue luôn là mô hình chia việc. Muốn ai cũng thấy mọi message thì mỗi consumer cần queue riêng của mình. Prefetch chỉ chỉnh độ sâu hàng chờ, còn binding trùng lặp không tạo thêm bản copy.',
    },
  ],
  quiz: [
    {
      question: 'Nhiều consumer trên cùng một queue nghĩa là gì?',
      options: [
        'Mỗi message tới đúng một consumer',
        'Mỗi consumer nhận một bản copy',
        'Chỉ consumer kết nối sớm nhất nhận message',
        'Broker chọn ngẫu nhiên rồi nhân đôi message',
      ],
      answerIndex: 0,
      explanation:
        'Một queue là một dòng công việc. Nhân bản chỉ xảy ra khi có nhiều queue, nên nhiều consumer trên một queue luôn là mô hình chia việc.',
    },
    {
      question: 'Điều gì khiến consumer chậm nhận ít job hơn?',
      options: [
        'Trần `prefetch: 1` loại consumer đang bận ra khỏi vòng xoay',
        'Queue đo tốc độ xử lý rồi ưu tiên consumer nhanh',
        'Broker đọc `processingMs` lúc consumer đăng ký',
        'Message ngắn tự tìm tới consumer nhanh',
      ],
      answerIndex: 0,
      explanation:
        'Queue không hề biết ai nhanh ai chậm. Chính prefetch tạo ra sự công bằng: consumer còn giữ message chưa ack thì bị bỏ qua, nên ai rảnh nhiều hơn sẽ gom nhiều việc hơn.',
    },
    {
      question: 'Thêm consumer thứ tư vào `work` đem lại gì?',
      options: [
        'Thông lượng cao hơn, mỗi message vẫn chỉ được xử lý một lần',
        'Mỗi message được xử lý bốn lần',
        'Queue tự nhân bản để đủ việc cho bốn bên',
        'Không gì cả, một queue chỉ phục vụ được ba consumer',
      ],
      answerIndex: 0,
      explanation:
        'Thêm consumer vào một queue là scale out phần xử lý. Message vẫn chia nhau, nên tổng thời gian rút ngắn mà số lần xử lý mỗi message giữ nguyên bằng một.',
    },
    {
      question: '`fast` crash lúc đang giữ một message chưa ack. Message đó ra sao?',
      options: [
        'Quay về `work`, rồi được giao cho consumer còn sống',
        'Mất hẳn, vì nó đã rời queue',
        'Nằm chờ tới khi `fast` hồi phục',
        'Chuyển sang DLX',
      ],
      answerIndex: 0,
      explanation:
        'Message chưa ack vẫn nằm trong bảng unacked của broker, gắn với `work`. Consumer chết thì nó được requeue, rồi bất kỳ ai trong hai consumer còn lại cũng nhận được.',
    },
  ],
}
