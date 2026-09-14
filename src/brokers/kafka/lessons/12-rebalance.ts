import { BROKER_1, CONSUMER_A, CONSUMER_B, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Bốn partition, hai consumer — đủ để "mọi partition có chủ trở lại" sau
// rebalance là một khẳng định có nội dung (không phải một topic một partition,
// nơi câu đó tầm thường đúng với đúng một consumer). `autoOffsetReset:
// 'earliest'` trên cả hai (không phải default `'latest'`): khi một partition
// đổi chủ sang một consumer CHƯA TỪNG đọc nó, `resolvePosition` (consume.ts)
// chỉ có `ConsumerRuntime.position` của chính consumer đó để tra — chưa từng
// đọc nghĩa là chưa có gì, và `'latest'` sẽ bỏ qua vĩnh viễn mọi record đã nằm
// sẵn trước khi nó được assign. `'earliest'` đảm bảo bất kể partition rơi vào
// tay ai sau rebalance, mọi record production trong lúc rebalance ("không
// consumer nào đọc được record mới") đều được đọc lại đầy đủ ngay khi group ổn
// định, thay vì phụ thuộc vào việc nó tình cờ rơi lại đúng consumer cũ.
export const rebalance: KafkaLesson = {
  id: '12-rebalance',
  group: 'consumer',
  title: 'Rebalance',
  summary:
    'JoinGroup rồi SyncGroup, leader tính assignment chứ không phải broker; assignor mặc định của engine này (`range`) dừng TOÀN BỘ group trong lúc chờ, không riêng consumer vừa đổi — dù chỉ một consumer join hay rời, ai cũng ngừng đọc cho tới khi rebalance xong.',
  seed: 12,
  durationMs: 26_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 4, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [
      { ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
      { ...CONSUMER_B, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
    ],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // `c1` join một group MỚI, một mình — Stable ở 0+5000=5000, nhận cả bốn
    // partition.
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'a' },
    // `c2` join một group ĐANG Stable → mở vòng rebalance mới NGAY tại 6000
    // (assignment của CẢ HAI bị xoá tức khắc — eager, xem `clearAssignmentsIfEager`
    // ở `group/coordinator.ts`), Stable trở lại ở 6000+5000=11000.
    { at: 6000, kind: 'consumer-join', consumerId: 'c2' },
    // Record này rơi giữa cửa sổ rebalance [6000, 11000) — không consumer nào
    // đang có assignment nên không ai đọc được nó cho tới khi rebalance xong.
    { at: 8000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'b' },
    // `c1` RỜI group chủ động (LeaveGroupRequest thật) — kích hoạt rebalance
    // NGAY LẬP TỨC ở 14000 (khác hẳn một eviction do timeout, xem why-comment
    // `leaveGroup`), xoá sạch assignment kể cả của `c2` — người còn lại, còn
    // Stable trở lại ở 14000+5000=19000 với toàn bộ bốn partition.
    { at: 14_000, kind: 'consumer-leave', consumerId: 'c1' },
    // Lại rơi giữa cửa sổ rebalance thứ hai [14000, 19000) — cùng quy luật.
    { at: 16_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'c' },
  ],
  narrative: [
    {
      at: 0,
      title: 'JoinGroup rồi SyncGroup',
      body:
        '`c1` gửi JoinGroupRequest, coordinator gom hết member trong `rebalanceTimeoutMs` rồi mới tính assignment (`completeRebalance`) — không phải broker tự quyết định ai đọc gì, mà là một hàm assignor thuần chạy trên state của coordinator, dựa trên tập member đã chốt. Bước SyncGroup theo sau mới thật sự đưa group về `Stable` và phát assignment cho từng member.',
      highlight: ['c1'],
    },
    {
      at: 5000,
      title: 'generationId là số vòng',
      body:
        'Group vừa về `Stable` ở `generationId: 1`. Mỗi vòng rebalance tăng số này lên một — heartbeat mang theo `generationId` CŨ (chụp lại từ lúc hẹn, không đọc lại tức thời) sẽ bị coordinator từ chối bằng `ILLEGAL_GENERATION` một khi một vòng mới đã chốt xong, đúng cách một client thật biết mình cần JoinGroup lại.',
      highlight: ['c1'],
    },
    {
      at: 6000,
      title: 'Rebalance dừng toàn bộ group, không riêng consumer mới',
      body:
        '`c2` vừa join xong, và ngay lập tức — không đợi rebalance hoàn tất — assignment của CẢ `c1` LẪN `c2` đều bị xoá sạch. `c1` không hề đổi gì cả (không rời, không lỗi), nhưng với assignor mặc định của engine này (`range`, kiểu "eager"), toàn bộ group dừng đọc cùng lúc trong lúc chờ chốt assignment mới — không phải chỉ member vừa vào cuộc mới bị ảnh hưởng.',
      highlight: ['c1', 'c2'],
    },
    {
      at: 8100,
      title: 'Giữa rebalance, không ai đọc được gì mới',
      body:
        'Record `b` vừa được ghi vào `orders`, nhưng group vẫn đang `PreparingRebalance` — không `c1` lẫn `c2` có assignment nào để fetch. Record không mất: nó nằm nguyên trong log, chỉ là chưa ai được phép đọc nó cho tới khi rebalance xong.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'orders-3'],
    },
    {
      at: 11_100,
      title: 'Sau rebalance, mọi partition có chủ trở lại',
      body:
        'Group về `Stable` ở `generationId: 2`. Bốn partition được chia lại cho hai consumer, không partition nào bị bỏ trống — bao gồm cả record `b`, giờ đã có chủ và được đọc lại từ đầu vì partition đó, với consumer vừa nhận nó, chưa từng có vị trí đọc nào trước đó (`autoOffsetReset: \'earliest\'`).',
      highlight: ['c1', 'c2'],
    },
    {
      at: 14_000,
      title: 'Một consumer rời cũng dừng cả group',
      body:
        '`c1` chủ động rời group. Y hệt lúc `c2` join, rebalance kích hoạt NGAY LẬP TỨC và xoá assignment của TOÀN BỘ member còn lại — `c2`, dù chẳng làm gì sai, cũng ngừng đọc cho tới khi rebalance xong. Trong Kafka thật, một lần deploy lăn bánh (rolling restart) là một CHUỖI những lần rời-rồi-join như thế này nối tiếp nhau, mỗi lần đều kéo theo đúng kiểu gián đoạn toàn group vừa thấy — đó là lý do người vận hành Kafka quan tâm tới rebalance nhiều đến vậy, và cũng là lý do cooperative-sticky (bài 13) ra đời.',
      highlight: ['c1', 'c2'],
    },
    {
      at: 19_100,
      title: 'Một mình `c2` lại nhận hết',
      body:
        'Group về `Stable` lần thứ ba, `generationId: 3`, chỉ còn `c2`. Toàn bộ bốn partition — kể cả record `c` vừa nằm im trong lúc rebalance — đều thuộc về `c2`.',
      highlight: ['c2'],
    },
  ],
  checkpoints: [
    {
      at: 12_000,
      question: '`c2` vừa join group. Assignment của `c1` ra sao?',
      options: [
        'Bị xoá luôn — assignor `range` kiểu eager dừng cả group',
        'Giữ nguyên, chỉ mình `c2` phải chờ',
        'Chỉ mất đúng một partition',
      ],
      answerIndex: 0,
      explanation:
        '`c1` không rời, không lỗi, nhưng vẫn ngừng đọc cho tới khi vòng rebalance mới chốt xong. Đó là cái giá của một assignor eager.',
    },
    {
      at: 24_000,
      question: 'Trong lúc group đang `PreparingRebalance`, một record mới được ghi vào topic. Chuyện gì xảy ra với nó?',
      options: [
        'Bị mất vĩnh viễn vì không consumer nào đang đọc lúc đó',
        'Vẫn nằm nguyên trong log; không ai đọc được nó cho tới khi rebalance xong và có chủ mới',
        'Broker tự giữ lại và gửi thẳng cho consumer đầu tiên nhận được assignment mới',
      ],
      answerIndex: 1,
      explanation:
        'Rebalance chỉ ảnh hưởng tới AI đang được phép fetch, không ảnh hưởng gì tới việc ghi vào log. Record vẫn được leader append và cấp offset bình thường; nó chỉ "chờ" tới khi có consumer nào đó nhận được assignment cho đúng partition của nó rồi fetch như mọi record khác.',
    },
    {
      at: 26_000,
      question:
        'Tổng kết: rolling restart mười pod consumer. Với assignor `range`, group gián đoạn bao nhiêu lần?',
      options: [
        'Hai mươi lần — mỗi pod gây một lần rời cộng một lần join, lần nào cũng dừng cả group',
        'Một lần duy nhất, ở cuối đợt deploy',
        'Không lần nào, vì luôn còn pod khác đang chạy',
      ],
      answerIndex: 0,
      explanation:
        '`range` thuộc loại eager: mỗi lần thành viên thay đổi là toàn bộ group mất assignment. Rolling restart mười pod tạo ra hai mươi lần thay đổi như thế, mỗi lần dừng đọc cho tới khi rebalance chốt xong. Cách giảm là `group.instance.id` (thành viên tĩnh, tránh rebalance khi pod khởi động lại nhanh) hoặc `cooperative-sticky` ở bài 13.',
    },
  ],
  quiz: [
    {
      question: 'Một vòng rebalance đi qua hai bước nào?',
      options: ['JoinGroup rồi SyncGroup', 'Fetch rồi Commit', 'Elect rồi Replicate', 'Subscribe rồi Assign'],
      answerIndex: 0,
      explanation:
        'Coordinator gom member trong `rebalanceTimeoutMs` rồi chạy assignor; SyncGroup mới phát assignment rồi đưa group về `Stable`.',
    },
    {
      question: '`generationId` dùng để làm gì?',
      options: [
        'Đánh số vòng rebalance; heartbeat mang số cũ bị từ chối bằng `ILLEGAL_GENERATION`',
        'Đếm số record đã commit',
        'Đánh số partition trong topic',
        'Đếm số lần consumer poll',
      ],
      answerIndex: 0,
      explanation:
        'Nhờ đó một client biết mình đã lỡ một vòng rồi chủ động JoinGroup lại.',
    },
    {
      question: 'Rebalance có ảnh hưởng tới việc ghi vào log không?',
      options: [
        'Không — nó chỉ quyết định ai được phép fetch',
        'Có, producer bị chặn cho tới khi xong',
        'Có, record bị giữ ở leader rồi mới append sau',
        'Có, log chuyển sang chỉ đọc',
      ],
      answerIndex: 0,
      explanation:
        'Leader vẫn append rồi cấp offset bình thường. Record chỉ nằm chờ tới khi partition của nó có chủ mới.',
    },
    {
      question: 'Cách nào giảm số lần gián đoạn trong một đợt rolling restart?',
      options: [
        '`group.instance.id` cho thành viên tĩnh, hoặc `cooperative-sticky`',
        'Tăng số partition',
        'Tắt auto-commit',
        'Giảm `lingerMs`',
      ],
      answerIndex: 0,
      explanation:
        'Thành viên tĩnh tránh hẳn rebalance khi pod khởi động lại đủ nhanh; `cooperative-sticky` thì không dừng cả group.',
    },
  ],
}
