import { BROKER_1, BROKER_2, BROKER_3 } from './types'
import type { KafkaFault, KafkaLesson } from './types'

// Ba producer, ba partition khác nhau — mỗi producer ghim (`partition:`) vào
// đúng MỘT partition có leader riêng, để "leader nào chết" quyết định hẳn kết
// quả của đúng MỘT producer, không lẫn vào hai producer còn lại. Engine ở plan
// này chưa có bầu leader mới (lesson 02): một khi leader của một partition
// chết, ghi vào partition đó chỉ trở lại được khi chính leader cũ lên lại — nên
// nếu cả ba producer cùng ghi vào một partition, `acks=1`/`acks=all` cũng mất
// y hệt `acks=0` một khi leader của NÓ chết (chỉ khác chỗ có báo lỗi hay
// không), và khi đó vế "acks=all không mất record nào" sẽ không còn đúng nữa.
// Tách partition là cách duy nhất giữ phép so sánh trung thực với đúng cái
// engine này thật sự làm được.
const PRODUCER_ACKS_0 = Object.freeze({ id: 'p1', label: 'Producer acks=0', position: { x: 40, y: 40 } })
const PRODUCER_ACKS_1 = Object.freeze({ id: 'p2', label: 'Producer acks=1', position: { x: 40, y: 220 } })
const PRODUCER_ACKS_ALL = Object.freeze({ id: 'p3', label: "Producer acks='all'", position: { x: 40, y: 400 } })

const failures: KafkaFault[] = [{ at: 8000, kind: 'broker-down', brokerId: BROKER_1.id }]

export const acks: KafkaLesson = {
  id: '06-acks',
  group: 'producer',
  title: 'acks',
  summary:
    '`acks` định nghĩa producer coi một record là "xong" tại thời điểm nào: gửi rồi quên, chờ leader, hay chờ cả ISR — mỗi lựa chọn đổi một mức độ bền lấy một mức độ trễ khác nhau.',
  seed: 6,
  durationMs: 24_000,
  topology: {
    brokers: [BROKER_1, BROKER_2, BROKER_3],
    // Ba partition, replicationFactor 1: leader rải vòng tròn orders-0→b1,
    // orders-1→b2, orders-2→b3 (đúng quy tắc `createState`, xem lesson 02).
    topics: [{ name: 'orders', partitions: 3, replicationFactor: 1 }],
    producers: [
      { ...PRODUCER_ACKS_0, acks: 0 },
      { ...PRODUCER_ACKS_1, acks: 1 },
      { ...PRODUCER_ACKS_ALL, acks: 'all' },
    ],
    consumers: [],
    controllerBrokerId: BROKER_1.id,
  },
  failures,
  script: [
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1a', partition: 0 },
    { at: 1500, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-2a', partition: 1 },
    { at: 2000, kind: 'produce', producerId: 'p3', topic: 'orders', value: 'đơn-3a', partition: 2 },
    // b1 xuống ở t=8000 (xem `failures`) — b1 là leader DUY NHẤT của `orders-0`,
    // nơi chỉ `p1` ghi vào. `orders-1`/`orders-2` (leader b2/b3) không hề hấn gì.
    { at: 8500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1b', partition: 0 },
    { at: 9000, kind: 'produce', producerId: 'p2', topic: 'orders', value: 'đơn-2b', partition: 1 },
    { at: 9500, kind: 'produce', producerId: 'p3', topic: 'orders', value: 'đơn-3b', partition: 2 },
  ],
  narrative: [
    {
      at: 2000,
      title: 'acks: producer coi một record là "xong" khi nào',
      body:
        '`acks=0` là gửi rồi quên — producer không chờ bất kỳ phản hồi nào, nhanh nhất và cũng dễ mất im lặng nhất. `acks=1` chờ đúng leader ghi xong. `acks=all` chờ cả ISR xác nhận, chậm nhất nhưng bền nhất. Ba producer `p1`, `p2`, `p3` dưới đây dùng đúng ba mức này, mỗi producer ghi vào một partition riêng.',
      highlight: ['p1', 'p2', 'p3'],
    },
    {
      at: 8000,
      title: 'Mất leader: `orders-0` ngừng nhận ghi, hai partition kia thì không',
      body:
        '`b1` — leader của `orders-0` — vừa xuống. Ở plan này chưa có bầu leader mới (bài 02), nên ghi vào `orders-0` chỉ trở lại khi chính `b1` lên lại. `orders-1` và `orders-2`, leader là `b2`/`b3`, hoàn toàn không bị ảnh hưởng.',
      highlight: ['b1', 'orders-0'],
    },
    {
      at: 8500,
      title: '`acks=0`: mất mà không hề biết',
      body:
        'Record `đơn-1b` của `p1` biến mất hoàn toàn — không xuất hiện trong log `orders-0`, cũng không có bất kỳ phản hồi lỗi nào gửi về `p1`. Với `acks=0`, producer không chờ ai xác nhận, nên nó không có cách nào phát hiện ra record vừa gửi chưa từng chạm log.',
      highlight: ['p1', 'orders-0'],
    },
    {
      at: 9000,
      title: '`acks=1` và `acks=all`: leader còn sống thì không mất gì',
      body:
        '`p2` (`acks=1`) và `p3` (`acks=all`) ghi vào `orders-1`/`orders-2` — hai partition có leader vẫn còn sống suốt kịch bản này, nên cả hai record trước và sau khi `b1` xuống đều nằm trọn trong log, không thiếu record nào. Đây đúng là điều `acks=1`/`acks=all` hứa hẹn: miễn leader (và với `acks=all`, cả ISR) còn phản hồi được, producer luôn biết chắc record đã vào log hay chưa — khác hẳn `acks=0` chỉ biết mỗi việc "đã gửi".',
      highlight: ['p2', 'p3', 'orders-1', 'orders-2'],
    },
  ],
  checkpoints: [
    {
      at: 20_000,
      question: 'Vì sao chọn `acks` là chọn theo giá của một record bị mất, không phải theo throughput mong muốn?',
      options: [
        '`acks` chỉ ảnh hưởng tới độ trễ hiển thị trên canvas, không liên quan gì tới mất dữ liệu',
        '`acks=0` nhanh nhất nhưng producer không có cách nào biết một record đã mất; `acks=1`/`acks=all` chậm hơn nhưng đổi lại luôn biết chắc trạng thái của record — mức nào phù hợp phụ thuộc việc mất record đó tốn kém tới đâu, không phải muốn nhanh hay chậm',
        '`acks=all` luôn là lựa chọn đúng cho mọi hệ thống vì nó không bao giờ chậm hơn đáng kể so với `acks=0`',
      ],
      answerIndex: 1,
      explanation:
        '`acks=0` không chờ phản hồi nên nhanh nhất, nhưng đổi lại producer hoàn toàn mù trước một record bị mất — như `p1` ở bài này. `acks=1`/`acks=all` chậm hơn vì phải chờ xác nhận, nhưng đổi lại luôn biết chắc trạng thái record. Chọn mức nào vì vậy phải dựa vào chi phí thật sự của việc mất một record trong hệ thống cụ thể, không phải một con số throughput trừu tượng.',
    },
  ],
}
