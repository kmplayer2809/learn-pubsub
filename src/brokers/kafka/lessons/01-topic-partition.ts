import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

export const topicPartition: KafkaLesson = {
  id: '01-topic-partition',
  group: 'basics',
  title: 'Topic, partition và offset',
  summary:
    'Topic chỉ là một cái tên; dữ liệu thật nằm trong các partition, mỗi partition là một log chỉ ghi thêm.',
  seed: 1,
  durationMs: 18_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 3, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'] }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 2500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4' },
    { at: 8000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5' },
    { at: 10_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Topic là một cái tên, partition mới là nơi chứa dữ liệu',
      body:
        '`orders` tự nó không lưu gì cả — nó chỉ là một cái tên. Ba partition `orders-0`, `orders-1`, `orders-2` mới là ba log riêng biệt, mỗi log giữ một phần dữ liệu của topic.',
      highlight: ['orders-0', 'orders-1', 'orders-2'],
    },
    {
      at: 1000,
      title: 'Offset là vị trí, không phải id',
      body:
        'Mỗi partition đếm offset riêng, bắt đầu từ 0. Hai record nằm ở hai partition khác nhau hoàn toàn có thể cùng mang offset 0 mà chẳng liên quan gì tới nhau.',
      highlight: ['orders-0', 'orders-1', 'orders-2'],
    },
    {
      at: 4000,
      title: 'Log chỉ ghi thêm',
      body:
        'Một partition không sửa, không chèn giữa, không xoá lẻ một record. Ghi luôn là nối vào đuôi log, và chính điều đó khiến việc ghi nhanh đến vậy.',
      highlight: ['orders-0', 'orders-1', 'orders-2'],
    },
    {
      at: 8000,
      title: 'Record không key rải qua nhiều partition',
      body:
        'Sáu record đã ghi rải ra cả ba partition, nên **không** có một thứ tự chung cho toàn topic — chỉ có thứ tự bên trong từng partition mới được giữ nguyên.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'p1'],
    },
    {
      at: 12_000,
      title: 'Đọc không xoá',
      body:
        'Consumer đọc xong, record vẫn nằm nguyên trong log — xoá là việc của retention, không phải của việc đọc. Đây là khác biệt lớn nhất so với một queue kiểu RabbitMQ, nơi tiêu thụ xong là mất.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'c1'],
    },
  ],
  checkpoints: [
    {
      at: 5000,
      question: 'Record vừa ghi rải qua ba partition. Offset 0 xuất hiện ở mấy chỗ?',
      options: [
        'Ở cả ba partition — mỗi partition đếm offset riêng',
        'Chỉ một chỗ, vì offset là id duy nhất của cả topic',
        'Không chỗ nào, offset bắt đầu từ 1',
      ],
      answerIndex: 0,
      explanation:
        'Offset là vị trí trong một log, không phải định danh toàn cục. Hai record cùng mang offset 0 ở hai partition chẳng liên quan gì tới nhau.',
    },
    {
      at: 15_000,
      question: 'Sáu record ghi vào topic ba partition. Kafka bảo đảm gì về thứ tự?',
      options: [
        'Sáu record đọc ra đúng thứ tự đã ghi',
        'Chỉ trong từng partition thứ tự mới được bảo đảm',
        'Không bảo đảm gì cả',
      ],
      answerIndex: 1,
      explanation:
        'Kafka chỉ giữ thứ tự bên trong một partition. Sáu record rải ra ba partition khác nhau nên không hề có một thứ tự chung nào cho cả topic — ghép log của cả ba partition lại với nhau không cho ra thứ tự ghi gốc.',
    },
    {
      at: 18_000,
      question:
        'Tổng kết: hai consumer group cùng đọc `orders`. Group thứ nhất đọc xong rồi, group thứ hai còn thấy dữ liệu không?',
      options: [
        'Còn nguyên — đọc không hề xoá, mỗi group giữ offset riêng của mình',
        'Không, group thứ nhất đọc xong là record rời khỏi log',
        'Chỉ còn nếu group thứ hai đã đăng ký trước lúc record được ghi',
      ],
      answerIndex: 0,
      explanation:
        'Log là nơi lưu trữ, không phải hàng đợi tiêu thụ. Record nằm đó cho tới khi retention xoá, còn mỗi group chỉ giữ thêm một con số đánh dấu đã đọc tới đâu. Chính điều này cho phép nhiều hệ thống độc lập cùng đọc một dòng dữ liệu — thứ một queue kiểu RabbitMQ không làm được nếu không nhân bản message.',
    },
  ],
  quiz: [
    {
      question: 'Topic khác partition ở chỗ nào?',
      options: [
        'Topic là một cái tên; partition mới là log thật sự chứa dữ liệu',
        'Topic là log; partition là bản sao của log đó',
        'Topic là một file; partition là chỉ mục vào file đó',
        'Hai khái niệm chỉ là hai tên gọi của một thứ',
      ],
      answerIndex: 0,
      explanation:
        '`orders` ba partition nghĩa là ba log riêng biệt, mỗi log giữ một phần dữ liệu rồi đếm offset của riêng nó.',
    },
    {
      question: 'Một partition cho phép thao tác nào?',
      options: [
        'Chỉ nối thêm vào đuôi log',
        'Chèn vào giữa theo offset',
        'Sửa tại chỗ một record đã ghi',
        'Xoá lẻ một record',
      ],
      answerIndex: 0,
      explanation:
        'Chính ràng buộc chỉ ghi thêm khiến việc ghi nhanh tới vậy. Xoá là việc của retention, theo cả segment chứ không theo từng record.',
    },
    {
      question: 'Vì sao nhiều hệ thống độc lập cùng đọc được một topic?',
      options: [
        'Mỗi group giữ offset riêng, còn record thì không mất đi vì bị đọc',
        'Kafka nhân bản record cho từng group',
        'Mỗi group nhận một partition riêng',
        'Broker gửi một bản sao tới từng group',
      ],
      answerIndex: 0,
      explanation:
        'Log là nơi lưu trữ chung, còn tiến độ đọc là trạng thái riêng của từng group. Một queue muốn làm điều tương tự phải nhân bản message.',
    },
    {
      question: 'Muốn một nhóm record giữ đúng thứ tự thì phải làm gì?',
      options: [
        'Cho chúng rơi vào cùng một partition',
        'Ghi chúng liên tiếp trong cùng một giây',
        'Dùng đúng một producer',
        'Đặt topic sang chế độ có thứ tự',
      ],
      answerIndex: 0,
      explanation:
        'Thứ tự chỉ tồn tại bên trong một partition. Bài sau chỉ ra cách ép điều đó bằng key.',
    },
  ],
}
