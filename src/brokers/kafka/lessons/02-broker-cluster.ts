import { BROKER_1, BROKER_2, BROKER_3, CONSUMER_A, PRODUCER } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// `orders` có sáu partition, replicationFactor 1, ba broker: `createState`
// (engine/index.ts) rải leader vòng tròn theo index tăng dần, không reset ở mỗi
// topic — kết quả cố định: orders-0→b1, orders-1→b2, orders-2→b3, orders-3→b1,
// orders-4→b2, orders-5→b3. Mọi `partition` trong script produce dưới đây được
// ghim tường minh đúng theo bảng này, để một record luôn chạm đúng broker mà
// narrative đang nói tới thay vì phó mặc cho partitioner ngẫu nhiên.
const failures: KafkaFault[] = [
  { at: 10_000, kind: 'broker-down', brokerId: BROKER_1.id },
  { at: 15_000, kind: 'broker-up', brokerId: BROKER_1.id },
]

export const brokerCluster: KafkaLesson = {
  id: '02-broker-cluster',
  group: 'basics',
  title: 'Broker, cluster và controller',
  summary:
    'Một broker chỉ giữ một phần dữ liệu của topic; mỗi partition có đúng một leader, và mất leader chỉ chặn ghi ở đúng những partition nó giữ.',
  seed: 2,
  durationMs: 20_000,
  topology: {
    brokers: [BROKER_1, BROKER_2, BROKER_3],
    topics: [{ name: 'orders', partitions: 6, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'] }],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1', partition: 0 },
    { at: 1200, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2', partition: 1 },
    { at: 1400, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3', partition: 2 },
    { at: 1600, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4', partition: 3 },
    { at: 1800, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5', partition: 4 },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6', partition: 5 },
    // b1 xuống ở t=10_000 (xem `failures`): b1 là leader của orders-0 VÀ orders-3.
    // Chỉ produce vào orders-0 để giữ test gọn — orders-3 chịu đúng số phận
    // tương tự vì cùng leader, không cần chứng minh lại lần hai.
    { at: 11_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-7', partition: 0 },
    // orders-1 có leader là b2, không phải b1 — vẫn ghi bình thường trong lúc b1 down.
    { at: 12_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-8', partition: 1 },
    // b1 lên lại ở t=15_000 (xem `failures`): cùng broker cũ tái kết nối, không
    // phải một leader mới được bầu — engine ở plan này chưa có bầu leader.
    { at: 16_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-9', partition: 0 },
  ],
  narrative: [
    {
      at: 0,
      title: 'Một broker chỉ giữ một phần dữ liệu',
      body:
        'Cluster này có ba broker `b1`, `b2`, `b3`. Topic `orders` có sáu partition, và mỗi broker chỉ giữ một vài partition trong số đó — không broker nào có bản sao đầy đủ của cả topic.',
      highlight: ['b1', 'b2', 'b3'],
    },
    {
      at: 1000,
      title: 'Mỗi partition có đúng một leader',
      body:
        '`orders-0` do `b1` làm leader, `orders-1` do `b2`, `orders-2` do `b3`, rồi lặp lại vòng tròn cho `orders-3`, `orders-4`, `orders-5`. Producer ghi và consumer đọc của một partition đều đi qua đúng leader của partition đó, không phải broker bất kỳ trong cluster.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'orders-3', 'orders-4', 'orders-5'],
    },
    {
      at: 2200,
      title: 'Controller: một broker kiêm thêm việc',
      body:
        '`b1` còn giữ vai trò controller — quản lý metadata của cả cluster (broker nào còn sống, ai là leader của partition nào). Kafka bản mới dùng KRaft để tự bầu và đồng bộ controller giữa các broker, thay cho ZooKeeper trước đây; bài này chỉ nhắc tới đó, không đi sâu cơ chế bầu.',
      highlight: ['b1'],
    },
    {
      at: 8000,
      title: 'Thêm broker chỉ hữu ích khi partition được rải lại',
      body:
        'Thêm một broker thứ tư vào cluster tự nó không giúp gì — nếu sáu partition vẫn nằm nguyên chỗ cũ, broker mới đứng không. Chỗ chứa thêm chỉ phát huy tác dụng sau khi partition được rải lại qua broker mới, một thao tác quản trị riêng chứ không tự động xảy ra.',
      highlight: ['b1', 'b2', 'b3'],
    },
    {
      at: 10_000,
      title: 'Mất một broker là mất leader của những partition nó giữ',
      body:
        '`b1` vừa xuống. `orders-0` và `orders-3` — hai partition `b1` làm leader — lập tức ngừng nhận ghi, trong khi `orders-1`, `orders-2`, `orders-4`, `orders-5` (leader ở `b2`/`b3`) vẫn ghi bình thường. Ở plan này chưa có cơ chế bầu một leader khác thay `b1`; ghi vào `orders-0` chỉ trở lại được khi chính `b1` kết nối lại — bài 19 mới nói tới việc bầu leader mới từ một replica còn sống.',
      highlight: ['b1', 'orders-0', 'orders-3'],
    },
  ],
  checkpoints: [
    {
      at: 18_000,
      question: 'Khi broker `b1` (leader của `orders-0` và `orders-3`) xuống, điều gì xảy ra với `orders-1`?',
      options: [
        'orders-1 cũng ngừng nhận ghi vì cùng cluster với b1',
        'orders-1 vẫn ghi bình thường vì leader của nó là b2, không phải b1',
        'orders-1 tự động chuyển leader sang b1 để cân bằng tải',
      ],
      answerIndex: 1,
      explanation:
        'Mỗi partition chỉ phụ thuộc vào leader riêng của nó. `orders-1` có leader là `b2` nên `b1` xuống không ảnh hưởng gì tới nó — mất một broker chỉ làm mất khả năng ghi ở đúng những partition mà broker đó làm leader, không phải cả cluster.',
    },
  ],
}
