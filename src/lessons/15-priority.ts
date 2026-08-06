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
      body: 'Tám message được publish liên tiếp, cách nhau 200ms, với priority `0, 0, 0, 9, 0, 5, 0, 9`. `worker` chỉ có `prefetch: 1` và mất 1500ms cho mỗi message — chậm hơn nhiều so với nhịp publish, nên hàng đợi kịp phình ra trước khi `worker` rảnh trở lại.',
      highlight: ['jobs', 'worker'],
    },
    {
      at: 2200,
      title: 'Message đầu tiên đã đi trước khi hàng đợi kịp sắp xếp',
      body: 'Job 1 được giao ngay khi `worker` còn rảnh, trước khi bất kỳ message priority cao nào xuất hiện. Priority không thể cứu message nào đã rời khỏi `jobs` — nó chỉ tác động lên những gì còn nằm chờ.',
      highlight: ['jobs'],
    },
    {
      at: 4200,
      title: 'Priority 9 vượt lên trước cả message tới sớm hơn',
      body: 'Trong lúc `worker` bận với Job 1, `jobs` nhận thêm Job 2, 3, 4, 5, 6, 7, 8. Job 4 mang priority 9 nên được chèn lên đầu hàng đợi, vượt qua Job 2 và Job 3 dù hai message đó tới trước nó rất lâu. Job 8, cũng priority 9, xếp ngay sau Job 4.',
      highlight: ['jobs'],
    },
    {
      at: 9000,
      title: 'Priority bằng nhau vẫn giữ nguyên tắc đến trước phục vụ trước',
      body: 'Giữa các message cùng priority — như ba message priority 0 là Job 2, Job 3, Job 5 — hàng đợi không xáo trộn thứ tự giữa chúng. Priority chỉ phá vỡ nguyên tắc FIFO giữa các mức priority khác nhau, không phải trong cùng một mức.',
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
  ],
}
