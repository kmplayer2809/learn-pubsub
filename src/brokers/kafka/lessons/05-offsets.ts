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
  durationMs: 30_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [PRODUCER],
    // `enableAutoCommit: false` — cùng lý do bài 04: auto-commit thật (mặc định
    // bật, 5s một lần) sẽ tự nhích committed offset ngoài ý script, làm sai
    // đúng điều bài này muốn chỉ ra ("committed offset chỉ nhích khi commit
    // tường minh").
    consumers: [
      { ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'latest', enableAutoCommit: false },
    ],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // Bốn record ghi TRƯỚC khi có consumer nào tham gia group.
    { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 1500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4' },
    { at: 6000, kind: 'consumer-join', consumerId: 'c1' },
    // `c1` join một group MỚI ở đây nên phải đợi hết `maxPollIntervalMs` (5000,
    // xem default ở `types.ts`) trước khi coordinator chốt assignment — hành vi
    // CHỦ ĐỘNG của `group/coordinator.ts` (Task 2), không phải độ trễ ngẫu
    // nhiên. `auto.offset.reset=latest` chỉ thật sự "neo" một khi lần poll ĐẦU
    // TIÊN có assignment chạy, tức 6000+5000=11000, không phải ngay lúc join —
    // mọi mốc còn lại trong bài lùi 5000ms so với bản trước khi real group
    // coordination được nối vào, để giữ nguyên khoảng cách tương đối với mốc đó.
    //
    // 11650/12650/14050/14700 lệch khỏi lưới poll 100ms bắt đầu từ 6000 (6000,
    // 6100, 6200…) một cách có chủ đích, cùng lý do như bài 04: giữ thứ tự
    // "ghi/seek xong rồi mới tới lượt poll kế tiếp thấy" tách bạch, không phụ
    // thuộc cách kernel phá tie giữa hai event trùng `at`.
    { at: 11_650, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5' },
    { at: 12_000, kind: 'commit', consumerId: 'c1' },
    { at: 12_650, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6' },
    // 14050, không phải một mốc tròn 14000: 14000 trùng đúng lưới poll
    // (6000 + n*100), nên seek và lần poll kế tiếp sẽ xử lý trong CÙNG một
    // tick — position bị đọc lại về 6 ngay lập tức, không còn cách nào quan sát
    // khoảnh khắc "vừa seek xong, chưa kịp fetch" mà narrative đang muốn chỉ ra.
    { at: 14_050, kind: 'seek', consumerId: 'c1', topic: 'orders', partition: 0, offset: 'earliest' },
    { at: 14_700, kind: 'commit', consumerId: 'c1' },
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
      title: 'Join xong chưa có nghĩa là đọc được ngay',
      body:
        '`c1` gọi join group `g1`. Coordinator không cấp assignment ngay tại đây — nó chủ động đợi hết `maxPollIntervalMs` trước khi chốt ai thuộc group, đúng cơ chế rebalance thật (bài 12 đi sâu vào lý do). Trong lúc chờ, `c1` chưa đọc được record nào, kể cả bốn record đã nằm sẵn trong log.',
      highlight: ['c1', 'orders-0'],
    },
    {
      at: 11_000,
      title: 'auto.offset.reset chỉ chạy khi chưa có gì để bám vào',
      body:
        'Assignment vừa chốt xong, `c1` có lượt poll đầu tiên thật sự đọc được gì đó. Vì chưa từng có position hay committed offset hợp lệ, `autoOffsetReset: \'latest\'` neo ngay vào high watermark hiện tại — bốn record đã ghi từ trước khi `c1` vào group bị bỏ qua hoàn toàn, không đọc lại.',
      highlight: ['c1', 'orders-0'],
    },
    {
      at: 12_700,
      title: 'latest chỉ bỏ qua quá khứ, không bỏ qua tương lai',
      body:
        'Record ghi sau khi `c1` đã có assignment vẫn được đọc bình thường — `latest` chỉ quyết định điểm bắt đầu, không phải luật đọc mãi mãi. Ngay lúc này position đã chạy lên phía trước, còn committed offset vẫn đứng nguyên ở giá trị lần commit gần nhất, vì chỉ có gọi commit mới nhích nó.',
      highlight: ['c1'],
    },
    {
      at: 14_050,
      title: 'seek: đọc lại có chủ đích',
      body:
        '`c1` seek về `\'earliest\'`. Position lập tức nhảy xuống offset thấp nhất còn trong log — khác hẳn committed offset, vẫn giữ nguyên giá trị cũ cho tới lần commit kế tiếp. Bản thân seek không đọc gì cả, nó chỉ đặt lại vị trí sẽ đọc ở lượt poll kế tiếp.',
      highlight: ['c1', 'orders-0'],
    },
    {
      at: 14_700,
      title: 'Committed offset là con số cho lần khởi động lại',
      body:
        'Sau khi đọc lại toàn bộ log từ đầu, `c1` commit lần nữa. Trong Kafka thật, chính con số vừa lưu là thứ quyết định một consumer nên đọc lại từ đâu khi nó rời rồi vào lại group — khác cả position (chạy theo từng lần fetch) lẫn `auto.offset.reset` (chỉ có tác dụng khi chưa hề có committed offset hợp lệ). Bài này chỉ dựng tới bước commit; phần một consumer mới đọc lại đúng con số đó thuộc về group coordinator, một cấu phần chưa có ở đây.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 16_000,
      question: '`c1` vừa seek về `earliest`. Committed offset đổi chưa?',
      options: [
        'Chưa — seek chỉ đặt lại position, committed offset giữ nguyên tới lần commit kế tiếp',
        'Đổi ngay theo position mới',
        'Đổi về 0 rồi khoá lại',
      ],
      answerIndex: 0,
      explanation:
        'Ba con số tách bạch nhau: offset gắn với record, position là vị trí đọc kế tiếp, committed offset chỉ nhích khi có lệnh commit.',
    },
    {
      at: 25_000,
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
    {
      at: 30_000,
      question:
        'Tổng kết: một service mới lên production với `auto.offset.reset=latest`. Vì sao nó không thấy record nào của tuần trước?',
      options: [
        'Group mới chưa có committed offset, nên `latest` neo thẳng vào cuối log',
        'Retention đã xoá sạch dữ liệu tuần trước rồi',
        '`latest` chặn mọi record cũ hơn lượt poll gần nhất',
      ],
      answerIndex: 0,
      explanation:
        '`auto.offset.reset` chỉ có tác dụng đúng một lần: khi group chưa hề có committed offset hợp lệ. `latest` neo vào high watermark nên toàn bộ lịch sử bị bỏ qua. Muốn xử lý lại từ đầu thì chọn `earliest`, hoặc `seek` về mốc mong muốn rồi commit — cấu hình sau đó không còn quyết định gì nữa.',
    },
  ],
  quiz: [
    {
      question: '`auto.offset.reset` có tác dụng vào lúc nào?',
      options: [
        'Khi group chưa có committed offset hợp lệ',
        'Ở mọi lượt poll',
        'Mỗi lần rebalance',
        'Khi consumer gọi seek',
      ],
      answerIndex: 0,
      explanation:
        'Nó chỉ quyết định điểm bắt đầu. Có committed offset rồi thì cấu hình này không còn quyết định gì nữa.',
    },
    {
      question: '`latest` neo vào đâu?',
      options: [
        'High watermark hiện tại, nên toàn bộ lịch sử bị bỏ qua',
        'Offset nhỏ nhất còn trong log',
        'Offset đã commit gần nhất',
        'Record mới nhất của mỗi key',
      ],
      answerIndex: 0,
      explanation:
        'Đây đúng là cái bẫy khiến một service mới lên production không thấy dữ liệu cũ. Muốn xử lý lại từ đầu thì chọn `earliest`.',
    },
    {
      question: 'Position nhích vào lúc nào?',
      options: [
        'Ngay sau mỗi lần fetch, kể cả khi chưa commit',
        'Chỉ khi commit',
        'Khi high watermark đổi',
        'Khi rebalance kết thúc',
      ],
      answerIndex: 0,
      explanation:
        'Vì vậy position có thể chạy trước committed offset rất xa. Consumer chết giữa chừng thì đúng phần chênh đó bị đọc lại.',
    },
    {
      question: 'Vì sao một consumer vừa join group mới chưa đọc được gì ngay?',
      options: [
        'Coordinator đợi hết `maxPollIntervalMs` rồi mới chốt assignment',
        'Broker phải nén log trước',
        'Producer phải flush batch trước',
        'Consumer phải commit một lần trước',
      ],
      answerIndex: 0,
      explanation:
        'Chưa có assignment thì chưa partition nào thuộc về nó. Đây cũng là lý do record ghi trong lúc chờ có thể bị `latest` bỏ qua.',
    },
  ],
}
