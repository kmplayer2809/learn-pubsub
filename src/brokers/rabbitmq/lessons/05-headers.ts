import type { Lesson } from './types'

export const headersExchange: Lesson = {
  id: '05-headers',
  group: 'basics',
  title: 'Headers exchange',
  summary: 'Route dựa trên giá trị header thay vì routing key, với kiểu khớp `all` so với `any`.',
  seed: 5,
  durationMs: 10_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 180 } }],
    exchanges: [{ id: 'ex', label: 'Headers exchange', type: 'headers', position: { x: 260, y: 180 } }],
    queues: [
      { id: 'pdf-reports', label: 'pdf-reports', kind: 'classic', position: { x: 480, y: 60 } },
      { id: 'anything-pdf', label: 'anything-pdf', kind: 'classic', position: { x: 480, y: 180 } },
      { id: 'csv-or-report', label: 'csv-or-report', kind: 'classic', position: { x: 480, y: 300 } },
    ],
    consumers: [
      {
        id: 'c-pdf-reports',
        label: 'PDF reports consumer',
        queueId: 'pdf-reports',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 60 },
      },
      {
        id: 'c-anything-pdf',
        label: 'Anything PDF consumer',
        queueId: 'anything-pdf',
        prefetch: 1,
        autoAck: false,
        processingMs: 500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 180 },
      },
      {
        id: 'c-csv-or-report',
        label: 'CSV or report consumer',
        queueId: 'csv-or-report',
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
        destinationId: 'pdf-reports',
        destinationKind: 'queue',
        headers: { format: 'pdf', kind: 'report' },
        xMatch: 'all',
      },
      {
        id: 'b2',
        exchangeId: 'ex',
        destinationId: 'anything-pdf',
        destinationKind: 'queue',
        headers: { format: 'pdf' },
        xMatch: 'any',
      },
      {
        id: 'b3',
        exchangeId: 'ex',
        destinationId: 'csv-or-report',
        destinationKind: 'queue',
        headers: { format: 'csv', kind: 'report' },
        xMatch: 'any',
      },
    ],
  },
  script: [
    {
      at: 0,
      publisherId: 'p1',
      exchangeId: 'ex',
      routingKey: '',
      body: 'PDF report',
      headers: { format: 'pdf', kind: 'report' },
    },
    {
      at: 2000,
      publisherId: 'p1',
      exchangeId: 'ex',
      routingKey: '',
      body: 'PDF only',
      headers: { format: 'pdf' },
    },
    {
      at: 4000,
      publisherId: 'p1',
      exchangeId: 'ex',
      routingKey: '',
      body: 'CSV file',
      headers: { format: 'csv' },
    },
    {
      at: 6000,
      publisherId: 'p1',
      exchangeId: 'ex',
      routingKey: '',
      body: 'Invoice',
      headers: { kind: 'invoice' },
    },
  ],
  narrative: [
    {
      at: 0,
      title: 'Headers exchange bỏ qua hoàn toàn routing key',
      body: 'Mọi message ở đây đều được publish với routing key rỗng. Thay vào đó, headers exchange route dựa trên `headers` map của message, so sánh nó với tiêu chí header của từng binding.',
      highlight: ['p1', 'ex'],
    },
    {
      at: 2200,
      title: '`x-match: all` cần mọi header đều khớp',
      body: '`pdf-reports` bind với `xMatch: all` theo `{format: pdf, kind: report}`. Chỉ message mang **cả hai** header đó với đúng giá trị mới được route tới đây.',
      highlight: ['pdf-reports'],
    },
    {
      at: 4200,
      title: '`x-match: any` chỉ cần một header khớp',
      body: '`anything-pdf` và `csv-or-report` đều bind với `xMatch: any`. Message chỉ cần khớp *một* header bất kỳ trong danh sách — không cần khớp hết — là được route tới đây.',
      highlight: ['anything-pdf', 'csv-or-report'],
    },
    {
      at: 6200,
      title: 'Không header nào khớp, không có route',
      body: 'Message cuối cùng chỉ mang `kind: invoice`, không xuất hiện trong tiêu chí của cả ba binding. Nó không khớp gì cả và bị drop, y hệt một routing key không thể route được ở direct exchange.',
      highlight: ['ex'],
    },
  ],
  checkpoints: [
    {
      at: 4200,
      question: 'Message chỉ mang một header duy nhất `{format: pdf}` được route tới đâu?',
      options: [
        'Chỉ `anything-pdf`',
        '`pdf-reports` và `anything-pdf`',
        'Không queue nào, vì thiếu header `kind`',
      ],
      answerIndex: 0,
      explanation:
        '`anything-pdf` dùng `xMatch: any` theo `{format: pdf}`, nên một header khớp là đủ. `pdf-reports` dùng `xMatch: all` nên đòi cả `format: pdf` lẫn `kind: report`, thiếu một cái là trượt. `csv-or-report` không có tiêu chí nào trùng.',
    },
    {
      at: 6400,
      question: 'Message cuối chỉ mang `{kind: invoice}`. Nó tới queue nào?',
      options: [
        'Không queue nào — không tiêu chí binding nào nhắc tới `invoice`',
        'Tới `csv-or-report`, vì binding này dùng `xMatch: any`',
        'Tới cả ba, vì header lạ được coi như broadcast',
      ],
      answerIndex: 0,
      explanation:
        '`xMatch: any` vẫn đòi ít nhất một cặp header trùng cả khóa lẫn giá trị. `csv-or-report` chỉ chấp nhận `format: csv` hoặc `kind: report`, nên `kind: invoice` trượt. Message không khớp gì bị drop y như một routing key không route được.',
    },
    {
      at: 10_000,
      question:
        'Tổng kết: bạn đổi binding của `pdf-reports` sang `xMatch: any` nhưng giữ nguyên `{format: pdf, kind: report}`. Hệ quả?',
      options: [
        'Queue này bắt đầu nhận thêm mọi message chỉ mang `kind: report`',
        'Queue này ngừng nhận message, vì `any` cần đúng một header',
        'Không thay đổi gì, `all` với `any` chỉ khác nhau lúc header rỗng',
      ],
      answerIndex: 0,
      explanation:
        '`all` là phép giao: mọi cặp header trong tiêu chí đều phải khớp. `any` là phép hợp: một cặp khớp đã đủ. Nới sang `any` khiến tiêu chí rộng ra, nên message chỉ có `kind: report` — trước kia bị loại — nay lọt vào.',
    },
  ],
  quiz: [
    {
      question: 'Headers exchange route dựa trên cái gì?',
      options: [
        '`headers` map của message',
        'Routing key',
        'Tên queue đích',
        'Thứ tự khai báo binding',
      ],
      answerIndex: 0,
      explanation:
        'Headers exchange bỏ qua routing key — ở bài này mọi message publish với key rỗng. Quyết định route nằm ở phép so khớp giữa header của message với tiêu chí của binding.',
    },
    {
      question: '`x-match: all` đòi hỏi điều gì?',
      options: [
        'Mọi cặp header trong tiêu chí đều phải khớp',
        'Ít nhất một cặp header khớp',
        'Message không được mang header thừa',
        'Header phải xuất hiện đúng thứ tự khai báo',
      ],
      answerIndex: 0,
      explanation:
        '`all` là phép giao: thiếu một cặp là trượt. Header thừa thì vô hại — binding chỉ soi đúng những khóa nó liệt kê.',
    },
    {
      question: 'Message `{format: pdf}` đi tới đâu trong ba queue của bài?',
      options: [
        'Chỉ `anything-pdf`',
        'Chỉ `pdf-reports`',
        '`pdf-reports` cùng `anything-pdf`',
        'Không queue nào',
      ],
      answerIndex: 0,
      explanation:
        '`anything-pdf` dùng `xMatch: any` theo `{format: pdf}` nên một cặp khớp là đủ. `pdf-reports` dùng `all` nên đòi thêm `kind: report`. `csv-or-report` không có tiêu chí nào trùng.',
    },
    {
      question: 'Đổi một binding từ `all` sang `any` mà giữ nguyên tiêu chí. Tập message lọt vào thay đổi ra sao?',
      options: [
        'Rộng ra — tiêu chí trở nên dễ khớp hơn',
        'Hẹp lại — mỗi lần chỉ một header được xét',
        'Không đổi, nếu tiêu chí có đúng hai header',
        'Queue ngừng nhận message',
      ],
      answerIndex: 0,
      explanation:
        'Phép giao chuyển thành phép hợp, nên mọi message vốn đã khớp `all` vẫn khớp, cộng thêm những message chỉ trùng một phần tiêu chí.',
    },
  ],
}
