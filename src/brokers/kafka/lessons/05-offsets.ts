import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một broker, một partition — đủ để ba con số (offset của record, position của
// consumer, committed offset của group) không bị lẫn vào chuyện nhiều partition.
export const offsets: KafkaLesson = {
  id: '05-offsets',
  group: 'basics',
  title: 'Offset, position và committed offset',
  summary:
    'Ba con số hay bị gọi chung là "offset": offset của record không đổi, position chạy theo mỗi lần fetch, committed offset chỉ nhích khi commit tường minh.',
  seed: 5,
  durationMs: 24_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'latest' }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // Bốn record ghi TRƯỚC khi có consumer nào tham gia group.
    { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 1500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4' },
    { at: 6000, kind: 'consumer-join', consumerId: 'c1' },
    // 6650/7650/9000/9700 lệch khỏi lưới poll 100ms bắt đầu từ 6000 (6000, 6100,
    // 6200…) một cách có chủ đích, cùng lý do như bài 04: giữ thứ tự "ghi/seek
    // xong rồi mới tới lượt poll kế tiếp thấy" tách bạch, không phụ thuộc cách
    // kernel phá tie giữa hai event trùng `at`.
    { at: 6650, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5' },
    { at: 7000, kind: 'commit', consumerId: 'c1' },
    { at: 7650, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6' },
    // 9050, không phải một mốc tròn 9000: 9000 trùng đúng lưới poll (6000 + n*100),
    // nên seek và lần poll kế tiếp sẽ xử lý trong CÙNG một tick — position bị
    // đọc lại về 6 ngay lập tức, không còn cách nào quan sát khoảnh khắc "vừa
    // seek xong, chưa kịp fetch" mà narrative đang muốn chỉ ra.
    { at: 9050, kind: 'seek', consumerId: 'c1', topic: 'orders', partition: 0, offset: 'earliest' },
    { at: 9700, kind: 'commit', consumerId: 'c1' },
  ],
  narrative: [
    {
      at: 2000,
      title: 'Ba con số dễ gọi chung là offset',
      body:
        'Bốn record đã nằm sẵn trong `orders-0` trước khi có consumer nào tham gia. Bài này phân biệt ba con số hay bị gộp chung một tên: offset của chính record trong log, position — vị trí đọc kế tiếp của một consumer instance, và committed offset — con số đã lưu cho cả group.',
      highlight: ['orders-0'],
    },
    {
      at: 6000,
      title: 'auto.offset.reset chỉ chạy khi chưa có gì để bám vào',
      body:
        'Consumer `c1` vào group với `autoOffsetReset: \'latest\'`. Vì chưa từng có position hay committed offset hợp lệ, nó neo ngay vào high watermark hiện tại — bốn record đã ghi trước đó bị bỏ qua hoàn toàn, không đọc lại.',
      highlight: ['c1', 'orders-0'],
    },
    {
      at: 7700,
      title: 'latest chỉ bỏ qua quá khứ, không bỏ qua tương lai',
      body:
        'Record ghi sau khi `c1` đã vào group vẫn được đọc bình thường — `latest` chỉ quyết định điểm bắt đầu, không phải luật đọc mãi mãi. Ngay lúc này position đã chạy lên phía trước, còn committed offset vẫn đứng nguyên ở giá trị lần commit gần nhất, vì chỉ có gọi commit mới nhích nó.',
      highlight: ['c1'],
    },
    {
      at: 9050,
      title: 'seek: đọc lại có chủ đích',
      body:
        '`c1` seek về `\'earliest\'`. Position lập tức nhảy xuống offset thấp nhất còn trong log — khác hẳn committed offset, vẫn giữ nguyên giá trị cũ cho tới lần commit kế tiếp. Bản thân seek không đọc gì cả, nó chỉ đặt lại vị trí sẽ đọc ở lượt poll kế tiếp.',
      highlight: ['c1', 'orders-0'],
    },
    {
      at: 9700,
      title: 'Committed offset là con số cho lần khởi động lại',
      body:
        'Sau khi đọc lại toàn bộ log từ đầu, `c1` commit lần nữa. Trong Kafka thật, chính con số vừa lưu là thứ quyết định một consumer nên đọc lại từ đâu khi nó rời rồi vào lại group — khác cả position (chạy theo từng lần fetch) lẫn `auto.offset.reset` (chỉ có tác dụng khi chưa hề có committed offset hợp lệ). Bài này chỉ dựng tới bước commit; phần một consumer mới đọc lại đúng con số đó thuộc về group coordinator, một cấu phần chưa có ở đây.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 20_000,
      question: 'Giữa offset của record, position và committed offset, đâu là điểm khác nhau đúng?',
      options: [
        'Cả ba chỉ là ba tên gọi khác nhau của cùng một con số',
        'offset gắn với record, không đổi; position là vị trí đọc kế tiếp của một consumer instance, tự chạy theo mỗi lần fetch; committed offset chỉ đổi khi consumer chủ động commit',
        'committed offset luôn bằng position, vì mỗi lần fetch tự động commit theo',
      ],
      answerIndex: 1,
      explanation:
        'offset gắn với record, cố định. position là trạng thái tạm thời trong bộ nhớ của một consumer instance, tăng ngay sau mỗi lần fetch — kể cả khi chưa commit. committed offset chỉ nhích khi có lệnh commit tường minh, nên nó có thể tụt lại phía sau position rất xa nếu consumer đọc nhiều mà không commit.',
    },
  ],
}
