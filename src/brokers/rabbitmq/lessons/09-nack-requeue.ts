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
}
