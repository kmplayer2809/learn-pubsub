import type { Lesson } from './types'

export const priorityQueue: Lesson = {
  id: '15-priority',
  group: 'patterns',
  title: 'Priority queue',
  summary: 'Priority chỉ sắp lại message đang chờ trong queue; message đã giao thì thứ tự đã chốt.',
  seed: 15,
  durationMs: 16_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 200 } }],
    exchanges: [{ id: 'ex', label: 'Direct exchange', type: 'direct', position: { x: 260, y: 200 } }],
    queues: [{ id: 'jobs', label: 'jobs', kind: 'classic', maxPriority: 10, position: { x: 480, y: 200 } }],
    consumers: [
      {
        id: 'worker',
        label: 'Worker',
        queueId: 'jobs',
        prefetch: 1,
        autoAck: false,
        processingMs: 1500,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: false,
        position: { x: 700, y: 200 },
      },
    ],
    bindings: [{ id: 'b1', exchangeId: 'ex', destinationId: 'jobs', destinationKind: 'queue', routingKey: 'job' }],
  },
  script: [0, 0, 0, 9, 0, 5, 0, 9].map((priority, i) => ({
    at: i * 200,
    publisherId: 'p1',
    exchangeId: 'ex',
    routingKey: 'job',
    priority,
    body: `Job ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: '`jobs` khai báo `maxPriority: 10`',
      body: 'Tám message được publish liên tiếp, cách nhau 200ms, với priority `0, 0, 0, 9, 0, 5, 0, 9`. `worker` chỉ có `prefetch: 1` và mất 1500ms cho mỗi message — chậm hơn nhiều so với nhịp publish, nên queue kịp phình ra trước khi `worker` rảnh trở lại.',
      highlight: ['jobs', 'worker'],
    },
    {
      at: 2200,
      title: 'Message đầu tiên đã đi trước khi queue kịp sắp xếp',
      body: 'Job 1 được giao ngay khi `worker` còn rảnh, trước khi bất kỳ message priority cao nào xuất hiện. Priority không thể cứu message nào đã rời khỏi `jobs` — nó chỉ tác động lên những gì còn nằm chờ.',
      highlight: ['jobs'],
    },
    {
      at: 4200,
      title: 'Priority 9 vượt lên trước cả message tới sớm hơn',
      body: 'Trong lúc `worker` bận với Job 1, `jobs` nhận thêm Job 2, 3, 4, 5, 6, 7, 8. Job 4 mang priority 9 nên được chèn lên đầu queue, vượt qua Job 2 và Job 3 dù hai message đó tới trước nó rất lâu. Job 8, cũng priority 9, xếp ngay sau Job 4.',
      highlight: ['jobs'],
    },
    {
      at: 9000,
      title: 'Priority bằng nhau vẫn giữ nguyên tắc đến trước phục vụ trước',
      body: 'Giữa các message cùng priority — như bốn message priority 0 còn đang chờ là Job 2, Job 3, Job 5 và Job 7 — queue không xáo trộn thứ tự giữa chúng. Priority chỉ phá vỡ nguyên tắc FIFO giữa các mức priority khác nhau, không phải trong cùng một mức.',
      highlight: ['jobs', 'worker'],
    },
    {
      at: 13000,
      title: 'Prefetch thấp là điều kiện để priority còn ý nghĩa',
      body: 'Nếu `worker` khai báo `prefetch` cao, nó sẽ ôm một loạt message chưa ack ngay từ đầu, và thứ tự xử lý coi như đã chốt trước khi priority kịp phát huy tác dụng. Chỉ với `prefetch: 1`, mỗi lần `worker` rảnh mới thật sự là một cơ hội để priority chọn lại message xứng đáng nhất trong số đang chờ.',
      highlight: ['worker', 'jobs'],
    },
  ],
  checkpoints: [
    {
      at: 5000,
      question: 'Job 4 mang priority 9 vừa vào `jobs`. Nó đứng ở đâu trong hàng chờ?',
      options: [
        'Trước Job 2 cùng Job 3, dù hai job đó tới sớm hơn',
        'Sau Job 2 cùng Job 3, theo đúng thứ tự tới',
        'Ở cuối queue, chờ hết một chu kỳ',
      ],
      answerIndex: 0,
      explanation:
        'Priority sắp xếp lại phần message còn đang chờ: mức cao hơn luôn được chọn trước. Riêng Job 1 đã rời queue từ trước nên priority không thể động tới nó.',
    },
    {
      at: 15000,
      question: 'Nếu `worker` khai báo `prefetch: 10` thay vì `prefetch: 1`, priority của Job 4 và Job 8 còn phát huy tác dụng như trong lesson này không?',
      options: [
        'Có, priority luôn được tôn trọng bất kể prefetch',
        'Không hẳn — `worker` có thể đã nhận sẵn nhiều message chưa ack trước khi Job 4 và Job 8 kịp tới, nên chúng phải chờ tới lượt như bình thường',
        'Không, priority chỉ hoạt động khi `prefetch: 1`',
      ],
      answerIndex: 1,
      explanation:
        'Priority chỉ sắp xếp message còn nằm trong queue. Với `prefetch` cao, `worker` có thể đã lấy đi phần lớn message ngay từ đầu — trước khi Job 4 hay Job 8 kịp publish — nên hai message priority cao đó vẫn phải xếp hàng sau những gì `worker` đã ôm sẵn.',
    },
    {
      at: 16_000,
      question:
        'Tổng kết: dòng message priority 9 đổ vào liên tục, không ngừng. Điều gì xảy ra với bốn Job priority 0 đang chờ?',
      options: [
        'Chúng bị bỏ đói vô thời hạn — priority queue không có cơ chế chống đói',
        'Broker tự nâng priority của message chờ lâu để chúng khỏi kẹt',
        'Chúng được xử lý xen kẽ theo tỉ lệ ứng với mức priority',
      ],
      answerIndex: 0,
      explanation:
        'Priority queue luôn chọn mức cao nhất còn hàng, không hề có aging hay chia phần theo tỉ lệ. Tải mức cao liên tục sẽ khiến message mức thấp nằm mãi. Cách xử lý thực tế là tách hẳn thành nhiều queue với số worker riêng, thay vì trông vào priority trong một queue duy nhất.',
    },
  ],
  quiz: [
    {
      question: 'Priority tác động lên phần nào của dòng message?',
      options: [
        'Chỉ message còn nằm chờ trong queue',
        'Cả message đã giao cho consumer',
        'Cả message đã ack',
        'Message trong bảng unacked',
      ],
      answerIndex: 0,
      explanation:
        'Message đã rời queue thì queue hết quyền sắp xếp. Vì vậy Job 1 được xử lý trước dù priority 0, còn priority chỉ định đoạt những gì chưa đi.',
    },
    {
      question: 'Hai message cùng priority 0 thì queue chọn cái nào trước?',
      options: [
        'Cái vào queue trước',
        'Cái có body ngắn hơn',
        'Một cái ngẫu nhiên',
        'Cái vào queue sau',
      ],
      answerIndex: 0,
      explanation:
        'Trong cùng một mức priority, queue vẫn là FIFO. Priority chỉ phá vỡ thứ tự giữa các mức khác nhau.',
    },
    {
      question: 'Vì sao `prefetch` thấp là điều kiện để priority còn ý nghĩa?',
      options: [
        'Mỗi lần consumer rảnh mới là một cơ hội chọn lại message xứng đáng nhất',
        'Vì prefetch cao làm queue bỏ qua `maxPriority`',
        'Vì broker chỉ sắp xếp queue lúc prefetch bằng 1',
        'Vì prefetch cao khiến message mất priority',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch cao nghĩa là consumer ôm sẵn một loạt message, thứ tự xử lý coi như chốt từ sớm. Message priority cao tới sau đó phải xếp hàng sau những gì đã bị lấy đi.',
    },
    {
      question: 'Cách nào chống việc message mức thấp bị bỏ đói?',
      options: [
        'Tách hẳn thành nhiều queue, mỗi queue có số worker riêng',
        'Bật aging để broker tự nâng priority của message chờ lâu',
        'Đặt `maxPriority` cao hơn',
        'Giảm `processingMs` của worker',
      ],
      answerIndex: 0,
      explanation:
        'Priority queue luôn chọn mức cao nhất còn hàng, không hề có aging hay chia phần theo tỉ lệ. Muốn đảm bảo phần tài nguyên tối thiểu cho việc mức thấp thì phải tách queue.',
    },
  ],
}
