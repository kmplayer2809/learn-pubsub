# RabbitMQ Visualizer

Ứng dụng web dạy RabbitMQ bằng mô phỏng discrete-event chạy hoàn toàn trong
browser — không cần broker thật, không cần backend. Bạn xem message bay giữa
publisher, exchange, queue và consumer trên một canvas React Flow, tua đi tua
lại theo thời gian ảo, và đọc narrative giải thích từng bước chuyện gì đang
xảy ra và tại sao.

Ứng dụng có hai phần:

- **17 lesson dẫn dắt** (`src/lessons/`) — mỗi lesson là một topology cố định
  kèm kịch bản publish/failure định sẵn, dạy một khái niệm cụ thể: direct/
  fanout/topic/headers exchange, competing consumers, ack mode, prefetch/QoS,
  nack & requeue, publisher confirms, dead-letter exchange, TTL & max-length,
  retry with backoff, RPC, priority queue, delayed message, quorum vs classic.
- **Sandbox tự do** (`src/sandbox/`) — tự xây topology bằng cách kéo-thả node,
  publish message tay hoặc bằng generator, và xuất topology thành code chạy
  thật (amqplib hoặc NestJS `@golevelup/nestjs-rabbitmq`).

Bộ máy mô phỏng (`src/engine/`) là một reducer thuần: nhận state hiện tại và
một event, trả về state mới cộng các event mới sinh ra. Không có side effect,
không có UI, không có đồng hồ hệ thống — xem "Determinism contract" bên dưới.

## Bắt đầu

```bash
npm install
npm run dev
```

`npm run dev` khởi động Vite dev server (mặc định `http://localhost:5173`,
tự động dò cổng trống nếu cổng đó đang bận). Mở trình duyệt, chọn một lesson ở
sidebar bên trái, bấm **Chạy** để phát mô phỏng, hoặc **Bước** để đi từng
event một. Bấm nút **Sandbox** ở cuối sidebar để vào chế độ tự xây topology.

## Kiểm thử và build

```bash
npm test          # vitest run — 322 test trên 30 file
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
Điều này có được nhờ ba ràng buộc trên `src/engine/`:

- Không `Math.random`, không `Date.now`/`new Date`, không `setTimeout`/
  `setInterval`/`performance.now`. Toàn bộ tính "ngẫu nhiên" (jitter, nack
  rate, round-robin...) đi qua RNG thuần `src/engine/rng.ts` (mulberry32),
  nhận seed và trả về `[value, nextRngState]` — không có state ẩn nào ngoài
  giá trị được truyền tay.
- Không import React, Zustand, hay `@xyflow/react`. Engine không biết gì về
  UI; nó chỉ là state + reducer + hàng đợi event theo mốc thời gian ảo.
- `src/engine/purity.test.ts` grep toàn bộ `src/engine/**` (trừ file
  `*.test.ts`) để chặn các pattern trên tái xuất hiện — vi phạm là test đỏ
  ngay, không cần chạy app để phát hiện.

Nhờ vậy `createSimulation({ topology, script, seed, ... })` với cùng đầu vào
luôn sinh cùng chuỗi event, nên lesson replay được, snapshot test
(`__snapshots__/lessons.test.ts.snap`) ổn định qua nhiều lần chạy, và
`it.each(LESSONS)('%s runs deterministically', ...)` trong
`src/lessons/lessons.test.ts` xác nhận điều đó cho từng lesson bằng cách chạy
hai lần và so sánh journal.

## Thêm một lesson mới

1. Tạo file mới trong `src/lessons/`, ví dụ `src/lessons/18-my-lesson.ts`.
2. Export một object kiểu `Lesson` (định nghĩa ở `src/lessons/types.ts`):
   `id`, `group` (`'basics' | 'reliability' | 'dlx' | 'patterns'`), `title`,
   `summary`, `topology`, `script`, `failures?`, `narrative`, `checkpoints?`,
   `seed`, `durationMs`.
3. Thêm lesson vào mảng `LESSONS` trong `src/lessons/registry.ts` (và import
   nó ở đầu file).

Chỉ cần vậy — mọi test trong `src/lessons/lessons.test.ts` lặp qua
`LESSONS` bằng `it.each`, nên lesson mới tự động được kiểm tra: topology hợp
lệ (không có `ValidationIssue` mức `error`), chạy xác định (determinism),
mọi publish đều nhận được confirm, và (nếu bạn thêm test riêng theo mẫu
`basics.test.ts`/`reliability.test.ts`/`patterns.test.ts`) hành vi cụ thể của
lesson. `src/lessons/language.test.ts` cũng tự động soi lesson mới: body của
narrative và `summary` phải là tiếng Việt (có dấu, không sót từ nối tiếng Anh
như "the/and/with"), còn `title` được phép để nguyên tiếng Anh nếu nó là tên
gọi thuần của khái niệm đang dạy (`Direct exchange`, `RPC`...) — đọc file đó
trước khi viết copy cho lesson mới để bám đúng quy tắc.

Toàn bộ copy hướng tới người đọc (title dạng câu, narrative, checkpoint) viết
bằng tiếng Việt; các thuật ngữ RabbitMQ và lập trình (exchange, queue,
binding, routing key, publisher, consumer, ack/nack/requeue, prefetch, QoS,
DLX, TTL, persistent, durable, publisher confirms, RPC, quorum, classic,
priority...) giữ nguyên tiếng Anh, không dịch.

## Cấu trúc thư mục

```
src/engine/     bộ máy mô phỏng thuần (state, reducer, routing, validate)
src/lessons/    17 lesson + registry + test theo từng nhóm chủ đề
src/sandbox/    topology tự xây, export code (amqplib/NestJS)
src/sim/        store Zustand kết nối engine với UI (không thuần, có thời gian)
src/ui/         React Flow canvas, inspector, sidebar, transport controls
```
