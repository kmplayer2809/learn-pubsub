# Broker Visualizer

Ứng dụng web dạy message broker bằng mô phỏng discrete-event chạy hoàn toàn
trong browser — không cần broker thật, không cần backend. Bạn xem message bay
giữa publisher, exchange, queue và consumer trên một canvas React Flow, tua
đi tua lại theo thời gian ảo, và đọc narrative giải thích từng bước chuyện gì
đang xảy ra và tại sao. Một broker switcher ở đầu sidebar cho phép chuyển qua
lại giữa các broker đang học; hiện có RabbitMQ, Redis và Kafka, và shell
được thiết kế để thêm broker khác mà không phải sửa một dòng nào trong
`src/shell/`.

Mỗi broker (`src/brokers/<id>/`) có **lesson dẫn dắt** (`lessons/`) — mỗi
lesson là một topology cố định kèm kịch bản publish/failure (RabbitMQ) hoặc
lệnh (Redis) định sẵn, dạy một khái niệm cụ thể:

- **RabbitMQ** — 17 lesson: direct/fanout/topic/headers exchange, competing
  consumers, ack mode, prefetch/QoS, nack & requeue, publisher confirms,
  dead-letter exchange, TTL & max-length, retry with backoff, RPC, priority
  queue, delayed message, quorum vs classic.
- **Redis** — 17 lesson trải trên bốn nhóm (`basics`/Cơ bản, `cache`/Cache,
  `messaging`/Messaging — còn trống, để dành cho một plan sau,
  `advanced`/Nâng cao): String & counter, Hash, List, Set, Sorted Set, TTL,
  `SCAN` thay `KEYS`, cache-aside, write-through & write-behind, cache
  stampede, `maxmemory` & eviction policy, transactions, Lua atomicity,
  distributed lock, sliding-window rate limit, RDB vs AOF, replication &
  Sentinel & cluster hash slot.
- **Kafka** — 25 lesson trên năm nhóm (`basics`/Cơ bản, `producer`/Producer,
  `consumer`/Consumer & Group, `durability`/Độ bền, `advanced`/Nâng cao):
  topic & partition & offset, broker & cluster & controller, key &
  partitioning, vòng đời record, offset vs position vs committed, `acks`,
  batching & `linger.ms`, partitioner & hot partition, idempotent producer,
  thứ tự khi có retry, consumer group & rebalance, bốn assignor (range,
  round-robin, sticky, cooperative-sticky), commit offset & auto-commit &
  lag, `max.poll.interval.ms`, replication & ISR & leader election,
  `min.insync.replicas`, retention, log compaction & tombstone,
  transaction & exactly-once (control record, last stable offset,
  `read_committed`), retry topic & DLQ, sizing & tuning, zero-copy
  (`sendfile`/`FileChannel.transferTo` so với đường đi bốn chặng qua user
  space).

RabbitMQ và Kafka có **Sandbox tự do** (`sandbox/`) — tự xây topology bằng
cách kéo-thả node, publish message tay hoặc bằng generator, và xuất topology
thành code chạy thật (RabbitMQ: amqplib hoặc NestJS
`@golevelup/nestjs-rabbitmq`; Kafka: KafkaJS hoặc NestJS
`@nestjs/microservices` Transport.KAFKA). **Redis chưa có Sandbox và chưa có
xuất code** — chỉ có lesson dẫn dắt; nút Sandbox ở sidebar chỉ hiện với
broker nào khai báo nó.

Bộ máy mô phỏng của mỗi broker (`src/brokers/<id>/engine/`) là một reducer
thuần: nhận state hiện tại và một event, trả về state mới cộng các event mới
sinh ra. Không có side effect, không có UI, không có đồng hồ hệ thống — xem
"Determinism contract" bên dưới. Phần dùng chung giữa mọi broker (thời gian
ảo, narrative, checkpoint, broker switcher, sidebar, canvas...) sống ở
`src/shell/`.

## Bắt đầu

```bash
npm install
npm run dev
```

`npm run dev` khởi động Vite dev server (mặc định `http://localhost:5173`,
tự động dò cổng trống nếu cổng đó đang bận). Mở trình duyệt, chọn broker ở
đầu sidebar, chọn một lesson bên dưới, bấm **Chạy** để phát mô phỏng, hoặc
**Bước** để đi từng event một. Với RabbitMQ hoặc Kafka, bấm nút **Sandbox**
ở cuối sidebar để vào chế độ tự xây topology — nút này không xuất hiện khi
đang ở Redis, vì broker đó chưa có Sandbox.

## Màn hình nhỏ

Shell chạy được từ 375px trở lên. Ba layout, chọn bằng `useMediaQuery`
(`src/shell/ui/useMediaQuery.ts`) và render bởi `src/shell/ui/layouts/`:

- **mobile** (`< 768px`) — một pane tại một thời điểm, chọn bằng tab bar dưới đáy
  (`Bài học` / `Canvas` / `Trạng thái`). Transport hiện ở cả ba tab.
- **tablet** (`768–1023px`) — canvas và inspector cạnh nhau, sidebar nằm sau drawer
  mở bằng nút hamburger.
- **desktop** (`≥ 1024px`) — ba cột như cũ.

Pane đang chọn sống ở `mobilePane` trong `src/shell/store.ts`, không phải state cục
bộ của component: `setLesson`/`openSandbox` phải đẩy nó về `canvas`.

Test chạy trong jsdom, không có layout thật, nên chúng khẳng định **cấu trúc** (pane
nào render, class nào có mặt). Phần "trông có đúng không" kiểm thủ công bằng DevTools
ở 393×852, 430×932 và 375×667. Sandbox kéo-thả trên điện thoại vẫn là trải nghiệm
kém — mục tiêu của mobile là xem lesson, không phải xây topology.

## Kiểm thử và build

```bash
npm test          # vitest run — 1213 test trên 90 file
npm run typecheck  # tsc -b --noEmit — BẮT BUỘC dùng script này, không dùng `npx tsc --noEmit` trực tiếp
npm run build      # tsc -b && vite build — xuất ra dist/
npm run lint       # oxlint
```

`tsconfig.json` ở root chỉ là project-references, không liệt kê file nào để
compile — chạy thẳng `npx tsc --noEmit` sẽ compile 0 file và luôn thoát với
mã 0 dù code có lỗi hay không. Luôn dùng `npm run typecheck` (chạy `tsc -b`),
script này duyệt qua từng `tsconfig.*.json` con và thực sự kiểm tra type.

## Determinism contract

Cả bộ máy mô phỏng lẫn mỗi lesson đều xác định: **cùng một seed luôn sinh ra
đúng cùng một journal**, không sai một sự kiện, không lệch một millisecond.
Điều này có được nhờ ba ràng buộc trên kernel dùng chung (`src/shell/kernel/`)
và trên engine của từng broker (`src/brokers/<id>/engine/`):

- Không `Math.random`, không `Date.now`/`new Date`, không `setTimeout`/
  `setInterval`/`performance.now`. Toàn bộ tính "ngẫu nhiên" (jitter, nack
  rate, round-robin...) đi qua RNG thuần `src/shell/kernel/rng.ts`
  (mulberry32), nhận seed và trả về `[value, nextRngState]` — không có state
  ẩn nào ngoài giá trị được truyền tay.
- Không import React, Zustand, hay `@xyflow/react`. Kernel và engine không
  biết gì về UI; chúng chỉ là state + reducer + hàng đợi event theo mốc thời
  gian ảo.
- `src/shell/kernel/purity.test.ts` grep `src/shell/kernel/**` và
  `src/brokers/<id>/engine/**` của mọi broker đang tồn tại (trừ file
  `*.test.ts`) để chặn các pattern trên tái xuất hiện — vi phạm là test đỏ
  ngay, không cần chạy app để phát hiện. Test này tự động soi broker mới, xem
  "Thêm một broker mới" bên dưới.

Nhờ vậy `createSimulation({ topology, script, seed, ... })` với cùng đầu vào
luôn sinh cùng chuỗi event, nên lesson replay được, snapshot test
(`__snapshots__/lessons.test.ts.snap`) ổn định qua nhiều lần chạy, và
`lessons.test.ts` của mỗi broker (ví dụ
`src/brokers/rabbitmq/lessons/lessons.test.ts`) xác nhận điều đó cho từng
lesson bằng cách chạy hai lần và so sánh journal.

## Thêm một lesson mới

1. Tạo file mới trong `src/brokers/<broker>/lessons/`, ví dụ
   `src/brokers/rabbitmq/lessons/18-my-lesson.ts`.
2. Export một object kiểu `Lesson` (định nghĩa ở
   `src/brokers/rabbitmq/lessons/types.ts`): `id`, `group`
   (`'basics' | 'reliability' | 'dlx' | 'patterns'`), `title`, `summary`,
   `topology`, `script`, `failures?`, `narrative`, `checkpoints?`, `seed`,
   `durationMs`.
3. Thêm lesson vào mảng `LESSONS` của broker đó (ví dụ
   `src/brokers/rabbitmq/lessons/registry.ts`, và import nó ở đầu file).

Chỉ cần vậy — mọi test trong `lessons.test.ts` của broker đó lặp qua
`LESSONS` bằng `it.each`, nên lesson mới tự động được kiểm tra: topology hợp
lệ (không có `ValidationIssue` mức `error`), chạy xác định (determinism),
mọi publish đều nhận được confirm, và (nếu bạn thêm test riêng theo mẫu
`basics.test.ts`/`reliability.test.ts`/`patterns.test.ts`) hành vi cụ thể của
lesson. `src/shell/lesson/language.test.ts` cũng tự động soi lesson mới, của
bất kỳ broker nào trong `BROKERS` (`src/brokers/registry.ts`): body của
narrative và `summary` phải là tiếng Việt (có dấu, không sót từ nối tiếng Anh
như "the/and/with"), còn `title` được phép để nguyên tiếng Anh nếu nó là tên
gọi thuần của khái niệm đang dạy (`Direct exchange`, `RPC`...) — đọc file đó
trước khi viết copy cho lesson mới để bám đúng quy tắc.

Toàn bộ copy hướng tới người đọc (title dạng câu, narrative, checkpoint) viết
bằng tiếng Việt; các thuật ngữ của từng broker và của lập trình nói chung giữ
nguyên tiếng Anh, không dịch — với RabbitMQ là exchange, queue, binding,
routing key, publisher, consumer, ack/nack/requeue, prefetch, QoS, DLX, TTL,
persistent, durable, publisher confirms, RPC, quorum, classic, priority...;
với Redis là key, value, TTL, `SCAN`/`KEYS`, cache, `maxmemory`, eviction,
cache-aside, write-through, write-behind, stampede...; với Kafka là topic,
partition, offset, broker, cluster, controller, producer, consumer, key,
batch, `acks`, `linger.ms`, partitioner, hot partition, idempotent, consumer
group, rebalance, assignor, ISR, high watermark, `min.insync.replicas`,
retention, tombstone, transaction, LSO (last stable offset), `read_committed`,
DLQ...

## Thêm một broker mới

1. Tạo `src/brokers/<id>/` với `engine/`, `lessons/`, `ui/`, và `index.ts`.
2. `index.ts` export một object kiểu `BrokerModule` với type argument cụ thể, ví dụ
   `BrokerModule<RedisState, RedisTopology, RedisCommand, RedisIssue>` — không dùng
   `AnyBrokerModule` (chỉ shell dùng kiểu đó để giữ `BROKERS` chung một mảng; gắn nó
   vào module của chính bạn là xoá mọi kiểm tra kiểu, biến một lỗi lẽ ra compile-time
   thành crash lúc render).
3. Thêm object đó vào `BROKERS` trong `src/brokers/registry.ts`.
4. Đăng ký broker trong `src/brokers/catalog.ts` (`BROKER_CATALOG`) — store Zustand
   đọc danh sách broker từ đây, không phải từ `registry.ts`. File này tách riêng vì
   store không được import `registry.ts`: import cycle đó từng resolve thành
   `undefined` lúc runtime thay vì throw lỗi, nên `catalog.ts` tồn tại để việc thiếu
   bước này không lặp lại.

Shell không cần sửa một dòng nào: broker switcher, sidebar, canvas, transport, và
inspector đều đọc từ module. `purity.test.ts` tự động soi `src/brokers/<id>/engine/**`
ngay khi thư mục đó tồn tại.

## Cấu trúc thư mục

```
src/shell/kernel/   bộ máy thời gian dùng chung (rng, scheduler, run loop, guard)
src/shell/lesson/   kiểu Lesson, narrative, checkpoint dùng chung
src/shell/ui/       App, broker switcher, sidebar, canvas, inspector, transport
src/brokers/        registry.ts + mỗi broker một thư mục
src/brokers/rabbitmq/  engine, lessons, sandbox, ui của RabbitMQ
src/brokers/redis/     engine, lessons, ui của Redis — chưa có sandbox
src/brokers/kafka/     engine, lessons, sandbox, ui của Kafka
```
