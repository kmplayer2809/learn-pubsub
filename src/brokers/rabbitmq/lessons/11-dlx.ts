import type { Lesson } from './types'

export const dlxBasics: Lesson = {
  id: '11-dlx',
  group: 'dlx',
  title: 'Dead-letter exchange',
  summary: 'Reject không requeue route message sang dead-letter exchange thay vì xóa mất.',
  seed: 11,
  durationMs: 16_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [
      { id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 180 } },
      { id: 'dlx', label: 'DLX', type: 'fanout', position: { x: 480, y: 400 } },
    ],
    queues: [
      {
        id: 'work',
        label: 'work',
        kind: 'classic',
        deadLetterExchange: 'dlx',
        position: { x: 480, y: 180 },
      },
      { id: 'dead', label: 'dead', kind: 'classic', position: { x: 700, y: 400 } },
    ],
    consumers: [
      {
        id: 'worker',
        label: 'Worker',
        queueId: 'work',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0.6,
        requeueOnNack: false,
        position: { x: 700, y: 180 },
      },
      {
        id: 'dead-inspector',
        label: 'Dead-letter inspector',
        queueId: 'dead',
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
      { id: 'b1', exchangeId: 'ex', destinationId: 'work', destinationKind: 'queue', routingKey: 'job' },
      { id: 'b2', exchangeId: 'dlx', destinationId: 'dead', destinationKind: 'queue' },
    ],
  },
  script: [0, 600, 1200, 1800, 2400, 3000].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: '`worker` reject phần lớn message, không cho requeue',
      body: '`work` khai báo `deadLetterExchange: dlx`. `worker` reject sáu mươi phần trăm message nó nhận, và `requeueOnNack: false` — vậy message reject không quay lại `work`, nó đi đâu khác.',
      highlight: ['work', 'worker'],
    },
    {
      at: 3200,
      title: 'Reject không requeue route sang dead-letter exchange',
      body: 'Thay vì biến mất, một message bị reject mà không requeue được chuyển sang `dlx` — chính exchange được khai báo là dead-letter exchange của `work`. Đây không phải một cơ chế bí ẩn, nó chỉ là một route bổ sung khi requeue bị tắt.',
      highlight: ['work', 'dlx'],
    },
    {
      at: 6000,
      title: '`x-death-reason` ghi lại vì sao message chết',
      body: 'Message bị dead-letter mang thêm header `x-death-reason` giải thích lý do — ở đây là *rejected*. Header này đi kèm message tới `dead`, để bất kỳ ai tiêu thụ nó cũng biết chuyện gì đã xảy ra.',
      highlight: ['dead'],
    },
    {
      at: 10000,
      title: 'DLX chỉ là một exchange bình thường',
      body: '`dlx` không có gì đặc biệt về mặt kỹ thuật — nó là một fanout exchange như bất kỳ exchange nào khác, chỉ được gán vai trò dead-letter exchange trên `work`. `dead-inspector` tiêu thụ từ `dead` giống hệt cách `worker` tiêu thụ từ `work`.',
      highlight: ['dlx', 'dead-inspector'],
    },
  ],
  checkpoints: [
    {
      at: 6000,
      question: 'Điều gì quyết định message reject đi sang `dlx` thay vì quay lại `work`?',
      options: [
        'Cờ `requeueOnNack: false` trên `worker`',
        'Việc `dlx` thuộc loại fanout',
        'Số lần message đã bị giao lại',
      ],
      answerIndex: 0,
      explanation:
        'Dead-letter chỉ kích hoạt khi message rời queue mà **không** được requeue. Bật `requeueOnNack` thì message quay về `work` như bài trước, `deadLetterExchange` chẳng bao giờ tới lượt. Loại của `dlx` chỉ quyết định nó phân phát tiếp ra sao.',
    },
    {
      at: 10_500,
      question: 'Message đã nằm trong `dead`. Header nào cho biết vì sao nó tới đây?',
      options: [
        '`x-death-reason`, ở đây mang giá trị *rejected*',
        '`redeliveryCount`, vừa tăng thêm một',
        '`correlationId` do broker gán thêm',
      ],
      answerIndex: 0,
      explanation:
        'Broker gắn `x-death-reason` lúc dead-letter, nên bất kỳ ai tiêu thụ `dead` cũng đọc được lý do: reject, hết hạn TTL, hay tràn `maxLength`.',
    },
    {
      at: 16_000,
      question:
        'Tổng kết: bạn xóa khai báo `deadLetterExchange` khỏi `work` nhưng giữ `requeueOnNack: false`. Message reject đi đâu?',
      options: [
        'Biến mất hoàn toàn, không dấu vết nào ở bất kỳ queue nào',
        'Quay lại `work`, vì mất DLX thì requeue bật lại',
        'Nằm mãi trong bảng unacked của broker',
      ],
      answerIndex: 0,
      explanation:
        'Reject không requeue nghĩa là message rời queue vĩnh viễn. `deadLetterExchange` chỉ là một nhánh chuyển hướng tùy chọn cho đúng khoảnh khắc đó; thiếu nhánh này thì broker đơn giản bỏ message. Chính vì vậy DLX là mặc định nên có cho mọi queue mang tải nghiệp vụ.',
    },
  ],
  quiz: [
    {
      question: 'Điều kiện nào kích hoạt `deadLetterExchange` của một queue?',
      options: [
        'Message rời queue mà không được requeue',
        'Message bị reject, dù có requeue hay không',
        'Queue có nhiều hơn một consumer',
        'Message mang priority 0',
      ],
      answerIndex: 0,
      explanation:
        'Dead-letter là nhánh dành cho message rời queue vĩnh viễn: reject không requeue, hết hạn TTL, hoặc bị đẩy ra vì tràn queue. Bật requeue thì message về lại queue cũ, DLX chẳng bao giờ tới lượt.',
    },
    {
      question: 'DLX có gì đặc biệt so với một exchange thường?',
      options: [
        'Không gì cả — nó chỉ là exchange được gán vai trò dead-letter trên queue',
        'Nó luôn thuộc loại fanout',
        'Nó tự tạo queue để hứng message chết',
        'Nó bỏ qua binding, gửi thẳng tới consumer',
      ],
      answerIndex: 0,
      explanation:
        '`dlx` ở đây tình cờ là fanout, nhưng direct hay topic đều được. Nếu không ai bind queue nào vào nó, message chết vẫn biến mất — vai trò dead-letter không tự sinh ra nơi hứng.',
    },
    {
      question: 'Vì sao nên khai báo DLX cho mọi queue mang tải nghiệp vụ?',
      options: [
        'Thiếu DLX thì message reject không requeue biến mất không dấu vết',
        'DLX làm tăng thông lượng của queue chính',
        'DLX thay thế publisher confirm',
        'DLX giữ message lại trong queue cũ lâu hơn',
      ],
      answerIndex: 0,
      explanation:
        'Reject không requeue nghĩa là message rời queue vĩnh viễn. DLX biến một mất mát im lặng thành một queue có thể đọc, đếm, dựng cảnh báo.',
    },
    {
      question: '`dead-inspector` tiêu thụ `dead` theo cách nào?',
      options: [
        'Y như một consumer bình thường trên một queue bình thường',
        'Qua một API dead-letter riêng của broker',
        'Chỉ đọc được header, không đọc được body',
        'Phải bật `autoAck` mới nhận được message chết',
      ],
      answerIndex: 0,
      explanation:
        'Message chết vẫn là message, `dead` vẫn là queue. Nhờ vậy nơi hứng có thể gắn retry, cảnh báo, hoặc một người ngồi xem — không cần cơ chế đặc biệt nào.',
    },
  ],
}
