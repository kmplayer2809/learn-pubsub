import { BROKER_1, CONSUMER_A, CONSUMER_B, CONSUMER_C, PRODUCER } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// Hai partition — đủ để "thêm consumer giúp giảm lag, nhưng chỉ tới số
// partition" có nội dung thật: một consumer thứ ba tham gia group này sẽ
// không còn gì để nhận.
//
// `c1` override `maxPollIntervalMs: 40_000` (rộng hơn hẳn cả cơn treo dài
// nhất trong bài, 27_000ms — rộng hơn để KHÔNG bị đá khỏi group giữa chừng:
// bài này nói về lag, không phải về eviction, đó là chuyện của bài 16) NHƯNG
// `rebalanceTimeoutMs: 1_000` tách biệt hẳn (không đi theo `maxPollIntervalMs`
// như default) — join đầu vẫn chốt nhanh, chỉ riêng NGƯỠNG bị đá là rộng.
//
// `c1` dùng `enableAutoCommit: false` — CHỦ ĐỘNG khác `c2`/`c3` bên dưới, và
// khác mọi lesson khác vẫn tắt auto-commit chỉ để tránh nhiễu thời điểm: ở đây
// lý do còn nặng hơn. `c1` giữ CẢ HAI partition một mình trước khi `c2` join
// (13000ms), rồi bị treo. Nếu bật auto-commit, vòng auto-commit của `c1` KHÔNG
// hề dừng lại khi rebalance lấy partition khỏi tay nó (chỉ `consumer-leave`
// mới dừng được vòng đó, không phải mất assignment) — nó sẽ tiếp tục commit
// lại đúng cái POSITION CŨ, ĐÃ ĐÓNG BĂNG của `c1` cho partition đó mỗi
// `autoCommitIntervalMs`, đè lên đúng committed offset mà `c2` — chủ MỚI, đang
// đọc thật — vừa ghi. `committedOffsets` là một map DÙNG CHUNG cho cả group
// trên `GroupState`, không phân biệt "ai đang thật sự sở hữu partition này lúc
// commit" — một lần thấy tận mắt hiệu ứng này khi build lesson là đủ để không
// bao giờ để một consumer auto-commit cho một partition nó không còn giữ.
// Thay vào đó, `c1` chỉ commit MỘT LẦN, tường minh, ngay sau khi có assignment
// và trước khi bị treo — khoá lại đúng baseline để lag tính từ đó tăng dần.
const LAG_CONSUMER_A = Object.freeze({
  ...CONSUMER_A,
  maxPollIntervalMs: 40_000,
  rebalanceTimeoutMs: 1_000,
})
const LAG_CONSUMER_B = Object.freeze({
  ...CONSUMER_B,
  rebalanceTimeoutMs: 1_000,
})
const LAG_CONSUMER_C = Object.freeze({
  ...CONSUMER_C,
  rebalanceTimeoutMs: 1_000,
})

// Producer ghi đều đặn mỗi 500ms suốt gần hết lesson — "producer nhanh hơn
// consumer" cần một dòng ghi liên tục, không phải vài record rời rạc.
const PRODUCE_EVERY_MS = 500
const PRODUCE_LAST_AT = 29_500
const produceScript = Array.from({ length: Math.floor((PRODUCE_LAST_AT - PRODUCE_EVERY_MS) / PRODUCE_EVERY_MS) + 1 }, (_, i) => {
  const at = PRODUCE_EVERY_MS * (i + 1)
  return { at, kind: 'produce' as const, producerId: 'p1', topic: 'orders', value: `r${i + 1}` }
})

const failures: KafkaFault[] = [
  // `c1` "xử lý chậm" mô phỏng bằng một cơn treo dài duy nhất, phủ gần hết
  // lesson (1100 → 28100): trong khi treo, `c1` không fetch được gì — vị trí
  // đọc của nó đứng yên trong khi high watermark của cả hai partition vẫn tiến
  // lên đều đặn theo production, đúng cách lag thật sự lớn dần trong Kafka. Bắt
  // đầu ngay sau lần commit baseline (1050) — gần như toàn bộ lesson diễn ra
  // với `c1` đã treo, để đường lag đủ dài mà quan sát.
  { at: 1_100, kind: 'consumer-stall', consumerId: 'c1', durationMs: 27_000 },
]

export const consumerLag: KafkaLesson = {
  id: '15-consumer-lag',
  group: 'consumer',
  title: 'Consumer lag',
  summary:
    'Lag là high watermark trừ committed offset, đo bằng số record chứ không phải giây — producer nhanh hơn consumer thì lag tăng đều, thêm consumer chỉ kéo được nó xuống tới trần là số partition.',
  seed: 15,
  durationMs: 30_000,
  topology: {
    brokers: [BROKER_1],
    topics: [{ name: 'orders', partitions: 2, replicationFactor: 1 }],
    producers: [PRODUCER],
    consumers: [
      { ...LAG_CONSUMER_A, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: false, processingMs: 1_200 },
      { ...LAG_CONSUMER_B, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: true, autoCommitIntervalMs: 1_000, processingMs: 300 },
      { ...LAG_CONSUMER_C, groupId: 'g1', subscriptions: ['orders'], autoOffsetReset: 'earliest', enableAutoCommit: true, autoCommitIntervalMs: 1_000, processingMs: 300 },
    ],
    controllerBrokerId: BROKER_1.id,
  },
  script: [
    // `c1` join một mình, group MỚI, rebalanceTimeoutMs riêng 1000ms →
    // Stable ở 1000, nhận cả hai partition.
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    // Commit MỘT LẦN, tường minh, ngay sau khi có assignment — khoá baseline
    // committed offset trước khi treo (xem why-comment ở `LAG_CONSUMER_A`).
    { at: 1_050, kind: 'commit', consumerId: 'c1' },
    ...produceScript,
    // `c2` và `c3` join cùng lúc ở giây 15 vào group đang Stable → rebalance
    // mới, Stable trở lại ở 15000+1000=16000. Ba member, hai partition: `c1`
    // và `c2` mỗi người giữ đúng một, `c3` — người tới sau cùng theo thứ tự
    // memberId — không còn gì để nhận.
    { at: 15_000, kind: 'consumer-join', consumerId: 'c2' },
    { at: 15_000, kind: 'consumer-join', consumerId: 'c3' },
  ],
  failures,
  narrative: [
    {
      at: 1000,
      title: 'Lag là số record, không phải số giây',
      body:
        '`c1` vừa nhận cả hai partition của `orders`. Lag của một partition là high watermark (offset kế tiếp sẽ được ghi) trừ đi committed offset của group cho đúng partition đó — một con số RECORD còn tồn đọng, không phải thời gian đã trôi qua.',
      highlight: ['c1', 'orders-0', 'orders-1'],
    },
    {
      at: 1100,
      title: 'Xử lý treo, producer vẫn ghi đều',
      body:
        '`c1` vừa commit một lần (khoá lại vị trí lúc này làm baseline), rồi bắt đầu treo xử lý (fault `consumer-stall`) — vòng poll của nó dừng cập nhật vị trí đọc hoàn toàn, kéo dài suốt gần hết lesson. Producer thì không hề hay biết, vẫn ghi một record mỗi 500ms như cũ vào cả hai partition.',
      highlight: ['c1'],
    },
    {
      at: 9000,
      title: 'Lag tăng đều — dấu hiệu của một consumer chậm hơn producer',
      body:
        'High watermark của cả `orders-0` lẫn `orders-1` cứ mỗi 500ms lại nhích lên một, còn committed offset của `c1` đứng yên từ lúc treo. Lag của cả hai partition vì vậy tăng ĐỀU theo đúng nhịp production — đây chính là dấu hiệu characteristic của "consumer chậm hơn producer": lag đi lên như một đường thẳng, không phải một cú nhảy đột ngột (dấu hiệu của một sự cố mạng hay broker rớt).',
      highlight: ['orders-0', 'orders-1'],
    },
    {
      at: 16_100,
      title: 'Thêm consumer, lag của MỘT partition dừng lại',
      body:
        '`c2` và `c3` vừa join xong. Với hai partition và ba member, `c1` giữ lại một partition (vẫn đang treo — lag phần này TIẾP TỤC tăng, thêm consumer không sửa được một consumer đang treo, chỉ có thể lấy partition khỏi tay nó), còn partition kia chuyển sang `c2` — vừa nhận, `c2` đọc dồn hết chỗ tồn đọng gần như ngay lập tức (không có gì cản polling), rồi giữ nhịp đọc kịp production từ đây tới hết lesson. Tổng lag của cả group vì vậy KHÔNG còn tăng nhanh như trước — chỉ còn một nửa (đúng phần `c1` vẫn giữ) tiếp tục đi lên.',
      highlight: ['c1', 'c2'],
    },
    {
      at: 18_000,
      title: 'Thêm consumer thứ ba: không còn gì để chia',
      body:
        '`c3` join cùng lúc với `c2` nhưng không nhận được partition nào — hai partition đã có đủ hai chủ. `c3` không giúp lag giảm thêm chút nào: trần cứng của việc "thêm consumer để giảm lag" luôn là SỐ PARTITION, đúng nguyên tắc đã thấy ở bài 11.',
      highlight: ['c3'],
    },
    {
      at: 26_000,
      title: 'Lag của một partition riêng lẻ tăng — thường không phải do thiếu consumer',
      body:
        'Nếu chỉ MỘT partition trong nhiều partition có lag cao bất thường trong khi số consumer đã đủ, thủ phạm thường gặp nhất là hot key (bài 08, key nào đó liên tục đổ dồn vào cùng một partition) — không phải do thiếu consumer để chia việc. Ở bài này nguyên nhân khác (một consumer bị treo), nhưng cách CHẨN ĐOÁN thì giống nhau: nhìn lag TỪNG PARTITION, không chỉ tổng.',
      highlight: ['orders-0', 'orders-1'],
    },
  ],
  checkpoints: [
    {
      at: 28_000,
      question: 'Một group ba consumer đọc một topic hai partition. Consumer thứ ba join group này ảnh hưởng gì tới lag?',
      options: [
        'Luôn kéo tổng lag xuống thấp hơn, bất kể có bao nhiêu partition',
        'Không giúp gì cả — hai partition đã có đủ hai chủ, consumer thứ ba không nhận được partition nào',
        'Buộc hai consumer kia phải nhường bớt một nửa partition của mình cho nó',
      ],
      answerIndex: 1,
      explanation:
        'Số partition là trần cứng cho số consumer THẬT SỰ làm việc trong một group. Một khi số consumer đã bằng số partition, thêm consumer nữa chỉ tạo ra một member nằm không — không giúp lag giảm thêm, vì không còn partition nào để chia.',
    },
  ],
}
