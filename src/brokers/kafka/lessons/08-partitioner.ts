import { BROKER_1 } from './types'
import type { KafkaLesson } from './types'

const PRODUCER_DEFAULT = Object.freeze({ id: 'p1', label: 'Producer default', position: { x: 40, y: 100 } })
const PRODUCER_ROUND_ROBIN = Object.freeze({ id: 'p2', label: 'Producer round-robin', position: { x: 40, y: 340 } })

// Một broker, bốn partition — đủ để thấy record dồn lệch mà không cần nhiều
// leader chen vào câu chuyện (đó là chuyện của bài 06).
export const partitioner: KafkaLesson = {
  id: '08-partitioner',
  group: 'producer',
  title: 'Partitioner và hot partition',
  summary:
    '`murmur2(key) % số partition` đưa mọi record cùng key về đúng một partition — một key chiếm phần lớn traffic biến đúng partition đó thành hot partition, và không partitioner nào cứu được việc đó.',
  seed: 8,
  durationMs: 24_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 4, replicationFactor: 1 }],
    producers: [
      { ...PRODUCER_DEFAULT, partitioner: 'default' },
      { ...PRODUCER_ROUND_ROBIN, partitioner: 'round-robin' },
    ],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // `p1`: bảy trong mười record mang key `vip-1` — key lệch nặng. `murmur2('vip-1') % 4`
    // luôn ra CÙNG một partition (`orders-1`), nên cả bảy dồn về đúng một chỗ.
    { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-1' },
    { at: 800, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-2' },
    { at: 1100, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-3' },
    { at: 1400, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-4' },
    { at: 1700, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-5' },
    { at: 2000, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-6' },
    { at: 2300, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'vip-1', value: 'đơn-7' },
    { at: 2600, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-2', value: 'đơn-8' },
    { at: 2900, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-3', value: 'đơn-9' },
    { at: 3200, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'user-4', value: 'đơn-10' },
    // `p2`: mười record KHÔNG key, `partitioner: 'round-robin'` — rải theo bộ đếm
    // vòng tròn của chính producer (`roundRobinCounter`), không chạm `murmur2`.
    { at: 3700, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-11' },
    { at: 4000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-12' },
    { at: 4300, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-13' },
    { at: 4600, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-14' },
    { at: 4900, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-15' },
    { at: 5200, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-16' },
    { at: 5500, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-17' },
    { at: 5800, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-18' },
    { at: 6100, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-19' },
    { at: 6400, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-20' },
  ],
  narrative: [
    {
      at: 500,
      title: 'default hash key, key lệch làm một partition nóng',
      body:
        '`p1` dùng partitioner `default`. Bảy trong mười record của nó mang cùng key `vip-1` — vì `murmur2(\'vip-1\') % 4` luôn ra đúng một kết quả, cả bảy record đó dồn về đúng một partition, còn ba record key khác (`user-2`, `user-3`, `user-4`) rải rác sang các partition khác nhau.',
      highlight: ['p1'],
    },
    {
      at: 3200,
      title: 'Hot partition: bảy trong mười record nằm chung một chỗ',
      body:
        '`orders-1` giờ giữ bảy trong mười record của `p1` — một tỉ lệ lệch hẳn so với ba partition còn lại. Đây chính là hot partition: không phải do partitioner sai, mà do chính key phân bố lệch, và mọi partitioner default/sticky/round-robin đều hash key giống hệt nhau nên không cái nào tránh được.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'orders-3'],
    },
    {
      at: 3700,
      title: 'round-robin rải đều khi không có key',
      body:
        '`p2` dùng `round-robin` cho mười record không key — mỗi record lần lượt sang partition kế tiếp theo một bộ đếm cố định của chính `p2`, không liên quan gì tới `murmur2`. Không có key để lệch, nên cả mười record rải khá đều qua bốn partition.',
      highlight: ['p2'],
    },
    {
      at: 6400,
      title: 'Thêm partition không cứu được hot key',
      body:
        'Nếu topic `orders` có thêm partition, `murmur2(\'vip-1\') % số_partition_mới` vẫn chỉ ra đúng MỘT partition — key lệch vẫn dồn hết vào đúng một chỗ, chỉ là một con số khác. Muốn phân tán bảy record đó ra nhiều partition, cách duy nhất là đổi chính cách chọn key (ví dụ băm thêm một hậu tố ngẫu nhiên), không phải tăng số partition.',
      highlight: ['orders-0', 'orders-1', 'orders-2', 'orders-3'],
    },
  ],
  checkpoints: [
    {
      at: 12_000,
      question: '`p2` dùng `round-robin` cho mười record không key. Kết quả ra sao?',
      options: [
        'Rải khá đều qua bốn partition, theo một bộ đếm của riêng `p2`',
        'Dồn hết vào partition 0',
        'Vẫn hash qua `murmur2` rồi dồn về một chỗ',
      ],
      answerIndex: 0,
      explanation:
        'Không có key thì không có gì để hash. Bộ đếm vòng tròn thuộc về riêng producer đó, không đồng bộ giữa nhiều producer.',
    },
    {
      at: 20_000,
      question: 'Thêm partition cho topic `orders` có giải quyết được hot partition do key `vip-1` gây ra không?',
      options: [
        'Có, thêm partition luôn rải lại toàn bộ dữ liệu cũ cho đều hơn',
        'Không — `murmur2(\'vip-1\') % số_partition_mới` vẫn chỉ ra đúng một partition; muốn phân tán phải đổi cách chọn key, không phải tăng số partition',
        'Có, nhưng chỉ khi dùng `round-robin` thay vì `default`',
      ],
      answerIndex: 1,
      explanation:
        'Mọi partitioner hash key giống nhau — record MANG key luôn về đúng một partition, bất kể số partition là bao nhiêu. Tăng số partition chỉ đổi con số kết quả của phép chia lấy dư, không đổi việc `vip-1` vẫn luôn về đúng một partition duy nhất. Muốn rải bảy record đó ra nhiều partition, phải đổi chính key dùng để hash.',
    },
    {
      at: 24_000,
      question:
        'Tổng kết: đổi key `vip-1` thành `vip-1#0` tới `vip-1#3` để rải qua bốn partition. Cái giá là gì?',
      options: [
        'Mất bảo đảm thứ tự trên toàn bộ sự kiện của `vip-1`',
        'Không giá nào — Kafka vẫn giữ thứ tự theo tiền tố key',
        'Consumer buộc phải đọc cả bốn partition trong cùng một luồng',
      ],
      answerIndex: 0,
      explanation:
        'Thứ tự chỉ tồn tại bên trong một partition, nên tách key ra bốn partition là tự tay từ bỏ thứ tự chung của khách hàng đó. Chấp nhận được khi các sự kiện độc lập nhau, còn nếu chúng là chuỗi chuyển trạng thái thì phải giữ nguyên một key và chịu hot partition, hoặc chuyển sang một khoá mịn hơn mà vẫn giữ trọn vẹn từng nhóm cần thứ tự.',
    },
  ],
  quiz: [
    {
      question: 'Vì sao `orders-1` giữ bảy trong mười record của `p1`?',
      options: [
        'Bảy record mang cùng key `vip-1`, nên chúng luôn về đúng một partition',
        'Partitioner `default` ưu tiên partition đang có ít dữ liệu',
        '`orders-1` là leader của cả topic',
        'Producer gửi nhầm partition',
      ],
      answerIndex: 0,
      explanation:
        'Không phải partitioner sai, mà chính key phân bố lệch. Đây đúng là hot partition.',
    },
    {
      question: '`default`, `sticky`, `round-robin` khác nhau ở chỗ nào?',
      options: [
        'Chúng chỉ khác nhau với record không key; record mang key thì cả ba đều hash giống hệt',
        '`sticky` bỏ qua key',
        '`round-robin` hash key theo vòng tròn',
        '`default` ưu tiên partition gần nhất',
      ],
      answerIndex: 0,
      explanation:
        'Vì vậy đổi partitioner không bao giờ chữa được một hot key.',
    },
    {
      question: 'Cách duy nhất phân tán bảy record của `vip-1` ra nhiều partition là gì?',
      options: [
        'Đổi chính key dùng để hash, ví dụ ghép thêm hậu tố',
        'Tăng số partition của topic',
        'Đổi sang partitioner `sticky`',
        'Thêm consumer vào group',
      ],
      answerIndex: 0,
      explanation:
        'Tăng số partition chỉ đổi con số kết quả của phép chia lấy dư; `vip-1` vẫn về đúng một chỗ.',
    },
    {
      question: 'Khi nào việc tách key thành `vip-1#0` tới `vip-1#3` là chấp nhận được?',
      options: [
        'Khi các sự kiện của khách hàng đó độc lập nhau',
        'Khi chúng là một chuỗi chuyển trạng thái',
        'Khi topic chỉ có một partition',
        'Khi group chỉ có một consumer',
      ],
      answerIndex: 0,
      explanation:
        'Tách key là tự tay từ bỏ thứ tự chung của khách hàng đó. Chuỗi chuyển trạng thái thì phải giữ nguyên một key rồi chịu hot partition, hoặc tìm một khoá mịn hơn mà vẫn giữ trọn từng nhóm cần thứ tự.',
    },
  ],
}
