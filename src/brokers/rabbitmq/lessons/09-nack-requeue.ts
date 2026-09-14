import type { Lesson } from './types'

export const nackRequeue: Lesson = {
  id: '09-nack-requeue',
  group: 'reliability',
  title: 'Nack & requeue',
  summary: 'Reject kèm requeue trả message về đầu queue để giao lại, redeliveryCount tăng dần mỗi lần.',
  seed: 9,
  durationMs: 18_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } }],
    queues: [{ id: 'flaky-q', label: 'flaky-q', kind: 'classic', position: { x: 480, y: 180 } }],
    consumers: [
      {
        id: 'flaky',
        label: 'Flaky consumer',
        queueId: 'flaky-q',
        prefetch: 1,
        autoAck: false,
        processingMs: 600,
        jitterMs: 0,
        nackRate: 0.5,
        requeueOnNack: true,
        position: { x: 700, y: 180 },
      },
    ],
    bindings: [
      { id: 'b1', exchangeId: 'ex', destinationId: 'flaky-q', destinationKind: 'queue', routingKey: 'job' },
    ],
  },
  script: [0, 500, 1000, 1500, 2000].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: '`flaky` reject một nửa số message nó nhận',
      body: '`nackRate: 0.5` nghĩa là mỗi message có năm mươi phần trăm khả năng bị `flaky` reject thay vì ack. `requeueOnNack: true` quyết định điều gì xảy ra tiếp theo: message reject không biến mất, nó quay lại `flaky-q`.',
      highlight: ['flaky-q', 'flaky'],
    },
    {
      at: 2500,
      title: 'Message reject trở về đầu queue',
      body: 'Một message bị reject với requeue được chèn lại ngay đầu `flaky-q`, không phải cuối hàng. Vì vậy nó được giao lại gần như ngay lập tức, thay vì phải chờ hết lượt các message khác.',
      highlight: ['flaky-q'],
    },
    {
      at: 5000,
      title: '`redeliveryCount` tăng dần, event log gọi tên nó là "redelivered"',
      body: 'Mỗi lần một message quay lại `flaky`, `redeliveryCount` của nó tăng thêm một. Event log đánh dấu rõ những lần giao lại này bằng nhãn *redelivered*, để phân biệt với lần giao đầu tiên.',
      highlight: ['flaky'],
    },
    {
      at: 9000,
      title: 'Không có ceiling, một message luôn thất bại sẽ lặp mãi',
      body: 'Ở đây `nackRate` chỉ là năm mươi phần trăm nên rốt cuộc mọi message đều được ack. Nhưng hãy tưởng tượng một message luôn luôn khiến consumer reject nó — không có giới hạn số lần thử, nó sẽ bị giao đi giao lại vô tận. Đó chính xác là tình huống Lesson 13 xử lý bằng một delay queue và một parking lot.',
      highlight: ['flaky-q'],
    },
  ],
  checkpoints: [
    {
      at: 5000,
      question: 'Message bị reject kèm `requeueOnNack: true` được chèn lại ở vị trí nào?',
      options: [
        'Cuối `flaky-q`, sau mọi message đang chờ',
        'Đầu `flaky-q`, nên nó được giao lại gần như tức thì',
        'Một queue retry riêng do broker tự sinh ra',
      ],
      answerIndex: 1,
      explanation:
        'Requeue trả message về đầu queue, giữ nguyên thứ tự ban đầu. Hệ quả thực tế: message hỏng được thử lại ngay lập tức, không có khoảng nghỉ nào — nên một lỗi tạm thời chưa kịp tự khỏi thì lần thử lại cũng hỏng.',
    },
    {
      at: 9500,
      question: 'Một message vừa quay lại `flaky` thêm lần nữa. Trường nào ghi lại chuyện đó?',
      options: [
        '`redeliveryCount` tăng thêm một',
        '`x-death-count` tăng thêm một',
        'Priority của message giảm đi một',
      ],
      answerIndex: 0,
      explanation:
        'Requeue là đường đi trong cùng một queue nên nó chạm `redeliveryCount`. `x-death-count` chỉ tăng khi message bị dead-letter sang exchange khác — chuyện của bài DLX.',
    },
    {
      at: 18_000,
      question:
        'Tổng kết: một message *luôn luôn* khiến consumer reject. Cấu hình hiện tại xử lý nó ra sao?',
      options: [
        'Broker bỏ cuộc sau ba lần rồi tự xóa message',
        'Message quay vòng vô tận, chiếm chỗ của mọi message phía sau',
        '`redeliveryCount` chạm trần rồi message chuyển sang DLX',
      ],
      answerIndex: 1,
      explanation:
        'Requeue trần trụi không có giới hạn số lần thử. `redeliveryCount` tăng mãi nhưng chẳng có gì đọc nó, nên message độc cứ chiếm đầu queue liên tục. Muốn thoát, ứng dụng phải tự đọc số lần giao lại rồi reject *không* requeue để đẩy sang DLX, hoặc dựng vòng retry có backoff.',
    },
  ],
  quiz: [
    {
      question: 'Vì sao requeue trần trụi thường không chữa được một lỗi tạm thời?',
      options: [
        'Message quay lại đầu queue nên được thử lại ngay, lỗi chưa kịp tự khỏi',
        'Broker xóa nội dung message lúc requeue',
        'Message mất `correlationId` sau requeue',
        'Consumer bị ngắt kết nối mỗi lần requeue',
      ],
      answerIndex: 0,
      explanation:
        'Requeue chèn message lại ở đầu queue, không có khoảng nghỉ nào. Lỗi cần thời gian hồi phục — một dịch vụ phụ thuộc đang chậm chẳng hạn — sẽ gặp lại y nguyên ở lần thử kế tiếp. Vòng retry cần một delay queue chính vì vậy.',
    },
    {
      question: 'Ứng dụng muốn chặn một message độc lặp vô tận thì phải làm gì?',
      options: [
        'Tự đọc số lần giao lại rồi reject *không* requeue để đẩy sang DLX',
        'Đặt `maxPriority` cho queue',
        'Bật `autoAck` cho consumer',
        'Nâng `prefetch` lên số lớn',
      ],
      answerIndex: 0,
      explanation:
        'Broker không có sẵn trần số lần thử. `redeliveryCount` tăng mãi nhưng chỉ ứng dụng mới đọc nó, rồi quyết định khi nào ngừng requeue để message rơi sang DLX hoặc parking lot.',
    },
    {
      question: 'Nack có requeue khác nack không requeue ở điểm nào?',
      options: [
        'Có requeue thì message về lại queue cũ; không requeue thì nó rời queue, đi tiếp sang DLX nếu có',
        'Có requeue thì message mất; không requeue thì nó được giữ lại',
        'Chỉ khác nhau ở tốc độ giao lại',
        'Không khác gì, cờ này chỉ ghi vào log',
      ],
      answerIndex: 0,
      explanation:
        'Cùng một hành động reject nhưng hai nhánh khác hẳn nhau. Nhánh không requeue là điều kiện duy nhất kích hoạt `deadLetterExchange`.',
    },
    {
      question: '`nackRate: 0.5` nhưng rốt cuộc mọi message đều được ack. Vì sao?',
      options: [
        'Mỗi lần giao lại là một phép thử mới, xác suất trượt mãi tiến dần về 0',
        'Broker hạ `nackRate` sau mỗi lần thất bại',
        'Sau ba lần reject consumer buộc phải ack',
        'Message được sửa nội dung trước khi giao lại',
      ],
      answerIndex: 0,
      explanation:
        'Consumer reject theo xác suất độc lập từng lần, nên sau đủ nhiều lượt gần như chắc chắn có một lượt ack. Message độc thật sự thì khác hẳn: nó hỏng mọi lần, nên vòng lặp không bao giờ tự kết thúc.',
    },
  ],
}
