import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một broker, một partition, đúng một batch ba record — hai lựa chọn này gọn
// hoá bài học về đúng cái nó cần nói: (1) ba record rời producer trong CÙNG
// một batch (lingerMs 500, y hệt bài 07) để có một khối byte liên tục trên
// segment log, mô phỏng đúng cảnh một lần `sendfile` chuyển nguyên khối chứ
// không phải build lại từng record; (2) không cần nhiều broker hay nhiều
// partition, vì zero-copy là chuyện xảy ra ở tầng vận chuyển của MỘT lần fetch
// response, không phụ thuộc cluster topology hay ai làm leader của ai.
export const zeroCopy: KafkaLesson = {
  id: '25-zero-copy',
  group: 'advanced',
  title: 'Zero-copy',
  summary:
    'Zero-copy không nghĩa là không byte nào được sao chép — nó nghĩa là broker dùng syscall sendfile để kernel tự chuyển byte thẳng từ page cache sang socket buffer, bỏ hẳn hai lần sao chép băng qua user space vốn phải xảy ra ở đường đi truyền thống.',
  seed: 25,
  durationMs: 18_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [{ ...PRODUCER, lingerMs: 500 }],
    // `enableAutoCommit: false` cùng lý do bài 04/05: giữ commit là một hành
    // động tường minh trong script, không bị auto-commit thật (5s một lần) làm
    // nhiễu mốc thời gian narrative đang dựa vào.
    consumers: [
      { ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], processingMs: 300, enableAutoCommit: false },
    ],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    // `c1` join một group MỚI nên phải đợi hết `maxPollIntervalMs` (5000) trước
    // khi coordinator chốt assignment — cùng cơ chế và cùng lý do dịch mốc như
    // bài 04/05, không phải độ trễ ngẫu nhiên. Ba record dưới đây chỉ được
    // produce SAU khi `c1` đã có assignment thật, để tránh bẫy `autoOffsetReset`
    // mặc định (`latest`) bỏ qua vĩnh viễn những gì ghi trước đó.
    { at: 6050, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 6150, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 6250, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    // Batch mở lúc 6050, `lingerMs: 500` nên flush ở 6550 — cả ba record cùng
    // rời producer trong một khối, đúng lúc high watermark của `orders-0` nhích
    // theo. Poll grid 100ms bắt đầu từ mốc assignment (5000, 5100, …) khiến lượt
    // poll kế tiếp sau 6550 rơi đúng vào 6600 — `c1` fetch cả ba record cùng lúc.
    { at: 7000, kind: 'commit', consumerId: 'c1' },
  ],
  narrative: [
    {
      at: 6050,
      title: 'Ba record, một batch, một khối byte liên tục',
      body:
        'Ba record đơn-1, đơn-2, đơn-3 xếp vào cùng một batch ở `p1` (`lingerMs: 500`, giống hệt cơ chế bài 07) — batch này sẽ flush đúng một lần. Điều đó quan trọng cho bài này: khi rời producer, leader `b1` sắp nhận về đúng MỘT khối byte liên tục, không phải ba record tách lẻ từng cái một.',
      highlight: ['p1'],
    },
    {
      at: 6550,
      title: 'Byte ghi xuống log chính là byte sẽ ra khỏi NIC',
      body:
        'Hết `lingerMs`, batch flush. `b1` append nguyên khối vào segment log của `orders-0`. Điểm mấu chốt của zero-copy nằm ngay đây: định dạng byte Kafka ghi xuống đĩa GIỐNG HỆT định dạng byte sẽ gửi qua mạng cho consumer. Không có bước deserialize từng record rồi dựng lại object trên JVM heap chỉ để đóng gói thành response — byte trên đĩa và byte trên dây đã là một.',
      highlight: ['orders-0'],
    },
    {
      at: 6600,
      title: 'Đường đi truyền thống: bốn chặng, hai lần vượt ranh giới kernel/user',
      body:
        'Nếu broker phục vụ đúng lượt fetch này mà không có zero-copy, ba record vừa ghi sẽ phải đi bốn chặng: đĩa lên page cache (kernel space), sao chép sang application buffer (user space, JVM heap), sao chép ngược lại socket buffer (kernel space), rồi mới ra NIC. Bốn chặng đó là hai lần sao chép băng qua ranh giới kernel/user cộng hai lần context switch — cho MỖI byte, MỖI lần fetch, MỖI consumer, không phải chi phí trả một lần rồi thôi.',
      highlight: ['orders-0', 'c1'],
    },
    {
      at: 6650,
      title: '`sendfile`: kernel tự chuyển byte, CPU không đụng payload',
      body:
        'Kafka gọi syscall `sendfile` (qua `FileChannel.transferTo` trên JVM) để phục vụ đúng lượt fetch này — chỉ đưa cho kernel bộ ba (file descriptor, offset, length), không đưa byte nào cả. Kernel tự sao chép trực tiếp từ page cache sang socket buffer; CPU không đọc payload và không phải nhảy sang user space để chạm vào dữ liệu. Còn lại đúng hai lần sao chép (đĩa → page cache, page cache → socket buffer) thay vì bốn, cùng ít hẳn context switch.',
      highlight: ['orders-0', 'c1'],
    },
    {
      at: 7200,
      title: 'High watermark trả lời CÁI GÌ, zero-copy trả lời CÁCH',
      body:
        'High watermark (bài 05) quyết định record nào đủ điều kiện để fetch được — CÁI GÌ consumer được phép thấy. Zero-copy không đụng gì tới luật đó; nó chỉ quyết định CÁCH những byte đã hợp lệ đó rời khỏi broker rẻ tới đâu. Hai khái niệm độc lập nhau: đổi cơ chế truyền tải không dịch chuyển offset nào được phép đọc, và siết chặt offset được phép đọc cũng không làm chậm cơ chế `sendfile` phía dưới.',
      highlight: ['orders-0', 'c1'],
    },
    {
      at: 9000,
      title: 'TLS phá vỡ đường tắt này',
      body:
        'Một khi kết nối bật mã hoá, đường tắt biến mất — dữ liệu bắt buộc phải đi qua user space để mã hoá và giải mã, kernel không còn cách nào tự chuyển byte thẳng từ page cache sang socket buffer nữa, và broker phải quay lại đường đi bốn chặng. Cấu hình SSL/SASL nằm ngoài phạm vi mô phỏng ở app này, nhưng đây là lý do zero-copy không phải một thứ luôn miễn phí trong mọi cấu hình production.',
      highlight: ['orders-0'],
    },
  ],
  checkpoints: [
    {
      at: 14_000,
      question: 'Điều gì thật sự khiến Kafka gọi được là zero-copy khi phục vụ một lần fetch cho consumer?',
      options: [
        'Không byte nào được sao chép ở bất kỳ đâu trên toàn bộ đường đi từ đĩa tới NIC',
        'Định dạng byte trên đĩa giống hệt định dạng byte gửi qua mạng, nên broker dùng syscall `sendfile` để kernel chuyển thẳng từ page cache sang socket buffer, bỏ qua hẳn bước sao chép qua application buffer ở user space',
        'Consumer đọc thẳng vào page cache của broker qua mạng, broker không phải gửi gì cả',
      ],
      answerIndex: 1,
      explanation:
        'Zero-copy không có nghĩa không byte nào di chuyển — vẫn còn đúng hai lần sao chép (đĩa → page cache, page cache → socket buffer). Cái bị loại bỏ là hai lần sao chép băng qua ranh giới kernel/user (vào application buffer rồi lại ra socket buffer) cùng hai lần context switch đi kèm, nhờ định dạng byte trên đĩa đã giống hệt định dạng byte gửi qua mạng nên broker không cần dựng lại record nào trên JVM heap trước khi gửi.',
    },
  ],
}
