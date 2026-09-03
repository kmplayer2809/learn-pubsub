import { BROKER_1, PRODUCER } from './types'
import type { KafkaLesson } from './types'

// Hai group song song, CÙNG một topic sáu partition, khác đúng một biến: assignor.
// `g-range` dùng `range` (mặc định của engine khi bỏ trống), `g-coop` dùng
// `cooperative-sticky`. Mọi tham số khác (số member, thời điểm join, topic,
// partition) giống hệt nhau giữa hai group — để bất kỳ khác biệt nào quan sát
// được đều chỉ có thể do assignor gây ra, không do lệch cấu hình.
//
// `assignor` chỉ có hiệu lực trên member TẠO group (join đầu tiên khi group
// chưa tồn tại) — set trên cả ba member của mỗi group cho chắc, dù chỉ member
// tới trước (theo thứ tự script) thật sự quyết định.
function mk(id: string, label: string, y: number, groupId: string, assignor: 'range' | 'cooperative-sticky') {
  return Object.freeze({
    id,
    label,
    position: { x: 700, y },
    groupId,
    subscriptions: ['orders'],
    autoOffsetReset: 'earliest' as const,
    enableAutoCommit: false,
    maxPollIntervalMs: 5_000,
    assignor,
  })
}

const RG1 = mk('rg1', 'range · c1', 40, 'g-range', 'range')
const RG2 = mk('rg2', 'range · c2', 140, 'g-range', 'range')
const RG3 = mk('rg3', 'range · c3', 240, 'g-range', 'range')
const CG1 = mk('cg1', 'coop · c1', 380, 'g-coop', 'cooperative-sticky')
const CG2 = mk('cg2', 'coop · c2', 480, 'g-coop', 'cooperative-sticky')
const CG3 = mk('cg3', 'coop · c3', 580, 'g-coop', 'cooperative-sticky')

export const assignors: KafkaLesson = {
  id: '13-assignors',
  group: 'consumer',
  title: 'Assignor',
  summary:
    '`range` chia partition thành khối liên tiếp và xoá sạch assignment của CẢ group mỗi lần rebalance (eager); `cooperative-sticky` chỉ thu hồi đúng phần cần đổi chủ qua hai vòng, nên partition không cần đổi chủ tiếp tục được đọc suốt lúc rebalance — cùng một đầu vào, hai cách khác nhau để tới cùng một kết quả cân bằng.',
  seed: 13,
  durationMs: 28_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 6, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [RG1, RG2, RG3, CG1, CG2, CG3],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // Hai member mỗi group join cùng lúc — cả hai group Stable ở 0+5000=5000.
    { at: 0, kind: 'consumer-join', consumerId: 'rg1' },
    { at: 0, kind: 'consumer-join', consumerId: 'rg2' },
    { at: 0, kind: 'consumer-join', consumerId: 'cg1' },
    { at: 0, kind: 'consumer-join', consumerId: 'cg2' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'e1' },
    // Member thứ ba join CẢ HAI group cùng lúc, ở giây 10 — cả hai group
    // Stable trở lại ở 10000+5000=15000.
    { at: 10_000, kind: 'consumer-join', consumerId: 'rg3' },
    { at: 10_000, kind: 'consumer-join', consumerId: 'cg3' },
  ],
  narrative: [
    {
      at: 5000,
      title: 'Hai group, cùng đầu vào, khác assignor',
      body:
        'Cả `g-range` lẫn `g-coop` vừa về `Stable` với hai member, sáu partition chia đều 3/3. `range` xếp partition thành khối liên tiếp (`rg1` giữ `orders-0/1/2`, `rg2` giữ `orders-3/4/5`); `cooperative-sticky` (thực chất dùng chung thuật toán với `sticky`, chỉ khác cách CHUYỂN từ assignment cũ sang mới) rải xen kẽ ngay từ lần gán đầu tiên vì chưa ai từng sở hữu gì. Khi số partition chia hết cho số consumer như ở đây, cả hai đều cho kết quả cân bằng tuyệt đối — khác biệt thật sự giữa chúng chỉ lộ ra khi có SỰ THAY ĐỔI thành viên, đúng lúc `rg3`/`cg3` sắp join.',
      highlight: ['rg1', 'rg2', 'cg1', 'cg2'],
    },
    {
      at: 10_100,
      title: 'range: rebalance dừng toàn bộ group ngay lập tức',
      body:
        '`rg3` vừa join, và `rg1` lẫn `rg2` NGAY LẬP TỨC mất sạch assignment — dù kết quả cuối cùng (sau khi rebalance xong) mỗi consumer vẫn giữ lại một phần partition cũ, `range` không hề "biết" điều đó tại thời điểm này: nó xoá trước rồi tính lại từ đầu sau, kiểu "eager". Không ai trong `g-range` đọc được gì cho tới khi rebalance xong.',
      highlight: ['rg1', 'rg2', 'rg3'],
    },
    {
      at: 10_200,
      title: 'cooperative-sticky: partition không cần đổi chủ vẫn chạy',
      body:
        'Cùng lúc đó ở `g-coop`, `cg1` và `cg2` VẪN giữ nguyên assignment cũ, vẫn tiếp tục fetch bình thường — coordinator chưa hề đụng tới chúng. `cooperative-sticky` chỉ thu hồi đúng phần cần đổi chủ qua một vòng riêng, và chỉ làm điều đó ở phút chót (khi tính xong assignment mới); partition nào không cần đổi chủ thì không bao giờ bị rút, group không hề dừng lại "toàn bộ" như bên `g-range`.',
      highlight: ['cg1', 'cg2'],
    },
    {
      at: 15_100,
      title: 'Cùng con số, khác mức xáo trộn',
      body:
        'Cả hai group đều về lại 2/2/2. Nhưng nhìn kỹ AI giữ gì: `g-range` xếp lại hoàn toàn từ đầu — `rg1` giờ giữ `orders-0/1` thay vì `orders-0/1/2` cũ, không có gì đảm bảo trùng lại; `g-coop` thì `cg1` vẫn giữ nguyên `orders-0` và `orders-2` — hai trong ba partition cũ của nó không hề đổi chủ suốt từ đầu tới giờ, chỉ có phần dư (`orders-4`) mới thật sự được thu hồi và giao cho `cg3`, người mới vào. Cân bằng như nhau, nhưng lượng "đổi chủ" (dẫn tới việc phải đóng rồi mở lại state phía ứng dụng, nếu có) khác hẳn nhau.',
      highlight: ['rg1', 'cg1'],
    },
    {
      at: 22_000,
      title: 'round-robin và sticky: hai cách cân bằng khác range',
      body:
        'Ngoài hai assignor đang chạy ở đây, engine còn có `round-robin` — một cursor DUY NHẤT rải lần lượt qua mọi member cho từng partition, không tính lại theo khối như `range`. Với một group nhiều topic, cùng một cursor xuyên suốt các topic khiến `round-robin` cân bằng TỔNG số partition mỗi member giữ tốt hơn `range` (vốn tính lại phần dư "liên tiếp" cho MỖI topic riêng, dồn hết phần lệch vào đúng những member đứng đầu bảng chữ cái mỗi lần) — nhưng đổi lại, `round-robin` xáo trộn gần như toàn bộ assignment mỗi lần rebalance, không giữ lại gì cũ. `sticky` là assignor cân bằng THEO CÙNG một công thức phân bổ như `round-robin` nhưng ưu tiên giữ lại assignment cũ trước — `cooperative-sticky` chỉ là `sticky` cộng thêm cách CHUYỂN êm hơn giữa hai lần gán, đúng cái vừa thấy ở `g-coop`.',
      highlight: [],
    },
    {
      at: 24_000,
      title: 'Vì sao nên chọn cooperative-sticky khi client hỗ trợ',
      body:
        'Với cùng một đầu vào, `cooperative-sticky` đạt cân bằng ngang `range`, giữ lại nhiều assignment cũ hơn hẳn, và không bắt CẢ GROUP dừng lại trong lúc chờ — chỉ member thật sự mất partition mới bị gián đoạn ngắn. Đó là lý do các client Kafka hiện đại (`ConsumerPartitionAssignor` từ 2.4 trở đi) đều khuyến nghị `cooperative-sticky` làm lựa chọn mặc định thay vì `range`, miễn là mọi client trong group cùng hỗ trợ nó.',
      highlight: ['cg1', 'cg2', 'cg3'],
    },
  ],
  checkpoints: [
    {
      at: 26_000,
      question: 'Khi một consumer thứ ba join một group hai consumer đang `Stable`, khác biệt lớn nhất giữa `range` và `cooperative-sticky` là gì?',
      options: [
        'range luôn cho kết quả cân bằng hơn cooperative-sticky',
        'range xoá assignment của CẢ group ngay khi rebalance bắt đầu; cooperative-sticky chỉ thu hồi đúng phần cần đổi chủ, phần còn lại tiếp tục đọc bình thường',
        'Cả hai hành xử giống hệt nhau, chỉ khác tên gọi',
      ],
      answerIndex: 1,
      explanation:
        'range là một assignor "eager": toàn bộ group mất assignment ngay khi `PreparingRebalance` bắt đầu, rồi mới tính lại từ đầu. cooperative-sticky trì hoãn việc thu hồi tới đúng lúc cần, và chỉ thu hồi đúng những partition thật sự phải đổi chủ — partition không đổi chủ tiếp tục được đọc suốt quá trình rebalance.',
    },
  ],
}
