import { BROKER_1, CONSUMER_A, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Một broker duy nhất — replicationFactor 1, `createState` gán cả bốn
// partition cho `b1` (chỉ có một broker để chọn). Trọng tâm bài này là hàm
// partitioner, không phải cluster, nên giữ số broker ở mức tối thiểu.
export const keyPartitioning: KafkaLesson = {
  id: '03-key-partitioning',
  group: 'basics',
  title: 'Key và partition',
  summary:
    '`murmur2(key) % số partition` là toàn bộ quy tắc: cùng key luôn về cùng partition, không key thì rải ngẫu nhiên, không bảo đảm gì.',
  seed: 3,
  durationMs: 22_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 4, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [{ ...CONSUMER_A, groupId: 'g1', subscriptions: ['orders'] }],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'đơn-a1' },
    { at: 1500, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'đơn-a2' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-1', value: 'đơn-a3' },
    { at: 3000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-2', value: 'đơn-b1' },
    { at: 3500, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-2', value: 'đơn-b2' },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-2', value: 'đơn-b3' },
    // Không truyền `key` — engine coi thiếu key giống hệt `key: null`, đi qua
    // nhánh partitioner ngẫu nhiên (rng), không chạm `murmur2`.
    { at: 5000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-c1' },
    { at: 5500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-c2' },
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-c3' },
  ],
  narrative: [
    {
      at: 0,
      title: 'murmur2(key) % số partition là toàn bộ quy tắc',
      body:
        'Với topic `orders` bốn partition, mọi record MANG key được đưa qua `murmur2(key) % 4` để chọn partition. Không có quy tắc nào phức tạp hơn thế — không dựa vào giá trị record, không dựa vào thời điểm ghi, chỉ dựa đúng vào chuỗi key.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'orders-3'],
    },
    {
      at: 2000,
      title: 'Cùng key, cùng partition, cùng thứ tự',
      body:
        'Ba record key `user-1` đều đi qua cùng một phép tính `murmur2(\'user-1\') % 4`, nên cả ba nằm chung một partition — và vì partition là log chỉ ghi thêm, thứ tự đọc lại đúng bằng thứ tự đã ghi.',
      highlight: ['p1'],
    },
    {
      at: 4000,
      title: 'Key khác, phép tính khác, vẫn nhất quán',
      body:
        'Ba record key `user-2` cũng dồn về đúng một partition — không nhất thiết là partition của `user-1`, chỉ đơn giản là `murmur2(\'user-2\') % 4` luôn ra cùng một kết quả cho mọi lần gọi.',
      highlight: ['p1'],
    },
    {
      at: 6000,
      title: 'Không key thì không có bảo đảm nào',
      body:
        'Ba record không key rải qua partition theo một bộ đếm ngẫu nhiên riêng của producer, không hề chạm `murmur2`. Không có gì đảm bảo ba record này nằm cùng partition, và cũng không có gì đảm bảo thứ tự giữa chúng khi ghép chung với các partition khác.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'orders-3'],
    },
    {
      at: 15_000,
      title: 'Đổi số partition là đổi cả ánh xạ',
      body:
        'Nếu topic `orders` đổi từ bốn sang một số partition khác, `murmur2(key) % số_partition_mới` cho ra kết quả khác hẳn — record mới của `user-1` có thể lạc sang một partition khác record cũ của chính key đó. Bảo đảm thứ tự cho key này đứt ngay tại ranh giới đổi số partition, dù dữ liệu cũ không hề mất. Chọn key, vì vậy, là chọn luôn đơn vị thứ tự của cả hệ thống.',
    },
  ],
  checkpoints: [
    {
      at: 7000,
      question: 'Ba record mang key `user-1` nằm ở đâu?',
      options: [
        'Cùng một partition, theo `murmur2(\'user-1\') % 4`',
        'Rải đều qua bốn partition',
        'Partition đang có ít dữ liệu nhất',
      ],
      answerIndex: 0,
      explanation:
        'Phép tính chỉ dựa vào chuỗi key nên nó cho cùng kết quả ở mọi lần gọi. Vì partition là log chỉ ghi thêm, ba record đó cũng giữ đúng thứ tự đã ghi.',
    },
    {
      at: 19_000,
      question: 'Nếu đổi topic `orders` từ 4 sang 8 partition, điều gì xảy ra với record cũ của key `user-1`?',
      options: [
        'Không đổi gì, Kafka tự động di chuyển đúng record cũ sang đúng vị trí mới',
        '`murmur2(\'user-1\') % 8` ra partition khác `% 4`, nên record mới của cùng key có thể lạc sang partition khác record cũ',
        '`user-1` bị cấm ghi thêm cho tới khi rebalance xong',
      ],
      answerIndex: 1,
      explanation:
        'Partition chỉ là kết quả một phép chia lấy dư. Đổi số partition đổi luôn kết quả đó, nên record MỚI của một key có thể rơi vào partition khác hẳn record CŨ của đúng key đó — bảo đảm thứ tự cho key này đứt đúng tại thời điểm đổi, còn dữ liệu cũ vẫn nguyên vẹn chứ không hề được Kafka "di chuyển" lại.',
    },
    {
      at: 22_000,
      question:
        'Tổng kết: chín mươi phần trăm sự kiện mang key của cùng một khách hàng lớn. Hậu quả là gì?',
      options: [
        'Một partition nóng ôm hết tải, thêm consumer cũng không giúp gì',
        'Kafka tự tách key đó ra nhiều partition để cân bằng lại',
        'Producer chuyển sang chế độ rải ngẫu nhiên khi phát hiện lệch tải',
      ],
      answerIndex: 0,
      explanation:
        'Đây là bài toán hot partition. Cùng key luôn về cùng partition, nên tải nghiêng hẳn về một chỗ và song song hoá tắc ngay tại đó — số consumer hữu ích trong một group bị chặn bởi số partition. Cách chữa là làm key mịn hơn, chẳng hạn ghép thêm hậu tố `customer-1#3`, đổi lại thì mất bảo đảm thứ tự trên toàn bộ khách hàng đó.',
    },
  ],
  quiz: [
    {
      question: 'Producer chọn partition cho một record mang key theo cách nào?',
      options: [
        '`murmur2(key)` chia lấy dư cho số partition',
        'Theo thứ tự vòng tròn',
        'Theo partition ít tải nhất',
        'Theo giá trị của record',
      ],
      answerIndex: 0,
      explanation:
        'Không dựa vào giá trị record, không dựa vào thời điểm ghi, chỉ dựa đúng vào chuỗi key.',
    },
    {
      question: 'Record không mang key đi đâu?',
      options: [
        'Rải qua partition theo một bộ đếm riêng của producer, không đảm bảo gì',
        'Luôn về partition 0',
        'Về partition đang có offset nhỏ nhất',
        'Bị broker từ chối',
      ],
      answerIndex: 0,
      explanation:
        'Không key nghĩa là không có đơn vị thứ tự nào. Ba record liên tiếp hoàn toàn có thể nằm ở ba partition khác nhau.',
    },
    {
      question: 'Vì sao dữ liệu cũ không hề được di chuyển khi số partition đổi?',
      options: [
        'Record đã ghi nằm cố định trong log của partition cũ; phép chia lấy dư chỉ áp cho lượt ghi mới',
        'Kafka có di chuyển, chỉ là chạy nền rất chậm',
        'Vì mỗi key được lưu kèm số partition cũ',
        'Vì mọi partition chia sẻ chung một log',
      ],
      answerIndex: 0,
      explanation:
        'Hệ quả là bảo đảm thứ tự cho một key đứt ngay tại ranh giới đổi số partition, dù không record nào mất.',
    },
    {
      question: 'Ghép hậu tố vào key, ví dụ `customer-1#3`, đem lại gì, mất gì?',
      options: [
        'Tải rải ra nhiều partition, đổi lại mất bảo đảm thứ tự trên toàn bộ khách hàng đó',
        'Tải rải ra mà thứ tự vẫn nguyên vẹn',
        'Thứ tự chặt hơn, đổi lại tải nghiêng hơn',
        'Không đổi gì, hậu tố bị bỏ qua lúc băm',
      ],
      answerIndex: 0,
      explanation:
        'Key mịn hơn nghĩa là đơn vị thứ tự nhỏ hơn. Chọn key chính là chọn luôn đơn vị thứ tự của cả hệ thống.',
    },
  ],
}
