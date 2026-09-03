import { BROKER_1, CONSUMER_A, CONSUMER_B, CONSUMER_C, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// `c4` — consumer thứ tư của group `g1`, cố tình KHÔNG lấy từ `CONSUMER_A/B/C`
// (chỉ có ba) vì bài này cần đúng bốn consumer trong MỘT group ba partition để
// dựng cảnh "consumer thừa nằm không". `c5` là consumer DUY NHẤT của group
// `g2`, một group hoàn toàn khác đọc CÙNG một topic — hai group độc lập, mỗi
// group một bộ `committedOffsets` riêng trên `GroupState`, không hề chia sẻ gì
// với `g1` dù cùng đọc `orders`. Cả hai node cần `maxPollIntervalMs: 5000` như
// `CONSUMER_A/B/C` (xem why-comment ở `types.ts`) vì chúng không spread từ đó
// nên không thừa hưởng default 5_000ms — thiếu field này coordinator sẽ rơi về
// default Kafka thật 300_000ms và không bao giờ vào `Stable` trong khung giờ
// của lesson.
const CONSUMER_D = Object.freeze({
  id: 'c4',
  label: 'Consumer D',
  position: { x: 700, y: 540 },
  maxPollIntervalMs: 5_000,
})
const CONSUMER_E = Object.freeze({
  id: 'c5',
  label: 'Consumer E (group g2)',
  position: { x: 940, y: 260 },
  maxPollIntervalMs: 5_000,
})

export const consumerGroup: KafkaLesson = {
  id: '11-consumer-group',
  group: 'consumer',
  title: 'Consumer group',
  summary:
    'Group là đơn vị chia việc, không phải một consumer đơn lẻ: mỗi partition trong một group luôn có đúng một consumer đọc, thêm consumer là cách scale nhưng trần cứng là số partition — consumer thừa ra chỉ nằm không, không phải dự phòng nóng.',
  seed: 11,
  durationMs: 24_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 3, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [
      { ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
      { ...CONSUMER_B, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
      { ...CONSUMER_C, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
      { ...CONSUMER_D, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
      { ...CONSUMER_E, groupId: 'g2', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false },
    ],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // `c1` (group g1, MỚI) và `c5` (group g2, MỚI) join cùng lúc — mỗi group tự
    // đợi hết rebalanceTimeoutMs 5000ms riêng của nó, cả hai Stable cùng ở 5000.
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 0, kind: 'consumer-join', consumerId: 'c5' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'sk-1' },
    // `c2` join một group g1 ĐANG Stable → mở vòng rebalance mới, đợi thêm
    // 5000ms (rebalanceTimeoutMs của chính c2) kể từ 8000 → Stable ở 13000.
    { at: 8000, kind: 'consumer-join', consumerId: 'c2' },
    { at: 9000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'sk-2' },
    // `c3` và `c4` join cùng lúc vào g1 đang Stable → một vòng rebalance DUY
    // NHẤT cho cả hai (vòng thứ hai nhập chung vòng vừa mở bởi vòng đầu, không
    // hẹn thêm — xem why-comment `joinGroup`), Stable ở 16000+5000=21000. Bốn
    // member, ba partition: range chia hết cho ba member đầu theo thứ tự
    // memberId (`c1`<`c2`<`c3`<`c4`), `c4` — người tới sau cùng — không còn gì
    // để nhận.
    { at: 16_000, kind: 'consumer-join', consumerId: 'c3' },
    { at: 16_000, kind: 'consumer-join', consumerId: 'c4' },
    { at: 17_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'sk-3' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Group là đơn vị chia việc',
      body:
        '`c1` join group `g1`, `c5` join group `g2` — cả hai cùng đọc topic `orders` nhưng thuộc hai group khác nhau. Một group là đơn vị coordinator dùng để chia partition, không phải một consumer đơn lẻ: mọi consumer trong cùng một group chia nhau đọc, còn hai group khác nhau đọc độc lập, mỗi group giữ một bộ `committedOffsets` riêng trên `GroupState`.',
      highlight: ['c1', 'c5', 'orders-0'],
    },
    {
      at: 5000,
      title: 'Một mình thì đọc hết',
      body:
        'Cả `g1` (chỉ có `c1`) lẫn `g2` (chỉ có `c5`) vừa vào `Stable`. Một consumer đơn lẻ trong một group luôn nhận toàn bộ partition của topic đã subscribe — ba partition `orders-0/1/2` đều về tay `c1`, và tách biệt hoàn toàn, ba partition đó CŨNG đều về tay `c5` bên group kia.',
      highlight: ['c1', 'c5'],
    },
    {
      at: 13_100,
      title: 'Mỗi partition đúng một chủ trong group',
      body:
        '`c2` vừa join xong, `g1` rebalance xong: ba partition chia cho hai consumer, mỗi partition chỉ thuộc về đúng một trong hai — không partition nào bị đọc trùng bởi cả `c1` lẫn `c2`, và không partition nào bị bỏ trống. `g2` không hề hay biết chuyện này đang xảy ra — `c5` vẫn yên vị với cả ba partition của riêng nó.',
      highlight: ['c1', 'c2'],
    },
    {
      at: 16_000,
      title: 'Thêm consumer là scale — tới một trần',
      body:
        '`c3` và `c4` cùng join `g1`. Thêm consumer vào một group là cách scale việc đọc song song, nhưng trần cứng của cách scale này là SỐ PARTITION: ba partition không thể chia cho nhiều hơn ba consumer đang thật sự làm việc, bất kể group có bao nhiêu member.',
      highlight: ['c3', 'c4'],
    },
    {
      at: 21_100,
      title: 'Consumer thứ tư nằm không, không phải dự phòng nóng',
      body:
        'Bốn member, ba partition: `c1`, `c2`, `c3` mỗi consumer giữ đúng một partition, còn `c4` không nhận partition nào cả. `c4` không hề "đứng dự phòng" chờ một consumer khác chết để nhảy vào thay — trong engine này, một consumer chỉ có partition khi coordinator gán, và với ba partition đã có đủ ba chủ, `c4` chỉ đơn giản là ngồi không, gửi heartbeat vô nghĩa.',
      highlight: ['c1', 'c2', 'c3', 'c4'],
    },
  ],
  checkpoints: [
    {
      at: 23_000,
      question: 'Group `g1` (bốn consumer) và group `g2` (một consumer) cùng đọc topic `orders`. Điều gì đúng?',
      options: [
        'Hai group chia nhau đọc chung một bộ partition, vì cùng một topic',
        'Mỗi group đọc độc lập toàn bộ topic theo cách riêng của nó, giữ một bộ committed offset riêng — số consumer của group này không ảnh hưởng gì tới group kia',
        'g2 chỉ đọc được phần partition mà g1 chưa dùng tới',
      ],
      answerIndex: 1,
      explanation:
        'Một group là ranh giới chia việc: partition chỉ được chia trong PHẠM VI một group. Hai group khác nhau, dù cùng subscribe một topic, hoàn toàn không biết tới sự tồn tại của nhau — mỗi group tự chạy rebalance riêng, tự giữ `committedOffsets` riêng trên `GroupState` của chính nó.',
    },
  ],
}
