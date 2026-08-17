import { APP, SERVER } from './types'
import type { RedisLesson } from './types'

export const replication: RedisLesson = {
  id: '17-replication',
  group: 'advanced',
  title: 'Replication, Sentinel & cluster hash slot',
  summary:
    'Ghi trên primary tới replica sau một độ trễ; primary crash, Sentinel đẩy replica lên thay; `CLUSTER KEYSLOT` cho thấy key sẽ rơi vào slot nào nếu cluster hoá.',
  seed: 17,
  durationMs: 3500,
  topology: {
    clients: [APP],
    server: SERVER,
    replicas: [{ id: 'replica-1', label: 'Replica', position: { x: 620, y: 120 }, lagMs: 400 }],
    sentinels: [{ id: 'sentinel-1', label: 'Sentinel', position: { x: 620, y: 280 } }],
  },
  script: [
    { at: 0, clientId: APP.id, name: 'SET', args: ['a', '1'] },
    { at: 400, clientId: APP.id, name: 'SET', args: ['b', '2'] },
    { at: 1600, clientId: APP.id, name: 'CLUSTER', args: ['KEYSLOT', 'a'] },
  ],
  failures: [
    { at: 1200, kind: 'crash', target: 'redis' },
    { at: 1400, kind: 'sentinelFailover', target: 'replica-1' },
  ],
  narrative: [
    {
      at: 0,
      title: 'Mỗi ghi tới replica sau đúng lagMs',
      body: 'Ghi `a` hoàn tất trên primary ở t=120 (thời gian truyền lệnh); replica chỉ thấy nó ở t=520, trễ đúng 400ms đã khai báo.',
      highlight: ['redis', 'replica-1'],
    },
    {
      at: 1200,
      title: 'Primary crash — replica có thể đang lagging',
      body: 'Nếu primary vừa ghi xong một thứ chưa kịp tới replica lúc crash, phần đó sẽ không có mặt trên replica — đây là cái giá của replication bất đồng bộ.',
      highlight: ['redis'],
    },
    {
      at: 1400,
      title: 'Sentinel đẩy replica lên làm primary mới',
      body: 'Sentinel theo dõi primary, phát hiện nó biến mất, và đẩy replica đang có dữ liệu mới nhất lên thay — không cần con người can thiệp.',
      highlight: ['sentinel-1', 'replica-1'],
    },
    {
      at: 1600,
      title: 'CLUSTER KEYSLOT chỉ tính toán, không sharding thật',
      body: 'Slot trả về đúng công thức Redis Cluster thật dùng (CRC16 mod 16384) — nhưng mô phỏng này chưa hề chia dữ liệu ra nhiều node theo slot; đây chỉ là bước đầu để hiểu keyslot là gì trước khi học cluster thật.',
      highlight: ['redis'],
    },
  ],
  checkpoints: [
    {
      at: 3100,
      question: 'lagMs của replica trong lesson này là 400ms. Điều gì quyết định replica có bị mất ghi khi primary crash hay không?',
      options: [
        'Replica luôn mất đúng lagMs cuối cùng của dữ liệu',
        'Chỉ mất ghi nào chưa kịp tới trong khoảng lagMs trước lúc crash — ghi đã tới thì vẫn còn',
        'Replica không bao giờ mất gì, chỉ chậm hiển thị',
      ],
      answerIndex: 1,
      explanation: 'Replication bất đồng bộ không đảm bảo mọi ghi đều tới replica trước khi primary chết — chỉ những ghi đã có đủ thời gian (ít nhất lagMs) mới chắc chắn đã tới; phần còn nằm "trên đường" lúc crash sẽ không có mặt trên replica được promote.',
    },
  ],
}
