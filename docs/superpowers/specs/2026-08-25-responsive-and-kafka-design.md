# Responsive shell + Broker Kafka — Design

**Date:** 2026-08-25
**Status:** Draft — chờ review
**Kế thừa từ:**
- `docs/superpowers/specs/2026-08-07-multi-broker-redis-design.md` — hợp đồng `BrokerModule`, tách
  `registry.ts` / `catalog.ts`, ràng buộc hook của `useSimulation`.
- `docs/superpowers/specs/2026-08-14-redis-advanced-design.md` — tiền lệ cho cơ chế `failures?`,
  interpreter con trong `engine/`, và cách chia sub-phase.

Tài liệu này gộp hai khối việc vào một plan duy nhất, làm tuần tự:

1. **P0 — Responsive**: shell chạy được xuống 393px (iPhone 15 / 15 Pro), áp cho cả RabbitMQ lẫn Redis.
2. **P1–P8 — Kafka**: broker thứ ba, engine đầy đủ, 24 lesson / 5 nhóm, sandbox, xuất code.

Responsive làm **trước** vì nó sửa `App.tsx`, `store.ts`, `CanvasView.tsx` — đúng những file UI Kafka sẽ
dựa vào. Làm sau thì phải sửa lại UI Kafka lần thứ hai.

---

# PHẦN A — RESPONSIVE (P0)

## A1. Vấn đề

`src/shell/ui/App.tsx:34-63` là ba cột cứng:

```tsx
<div className="flex h-full ...">
  <aside className="w-60 shrink-0 ...">   {/* 240px LessonSidebar */}
  <main className="flex min-w-0 flex-1 flex-col">  {/* Canvas + StatePanel + Transport */}
  <aside className="w-80 shrink-0 ...">   {/* 320px Inspector / SandboxPanel */}
```

560px chrome cố định trước khi canvas nhận được pixel nào. Ở viewport 393px, hai `aside` chiếm hết màn
và canvas co về 0. Kèm theo:

- `src/index.css` dùng `html, body, #root { height: 100% }` — trên Safari iOS, thanh địa chỉ co giãn làm
  `100%` nhảy, layout giật khi cuộn.
- `index.html` thiếu `viewport-fit=cover`, nên không đọc được `env(safe-area-inset-*)`; tab bar dưới đáy
  sẽ nằm dưới home indicator.
- `Transport.tsx` xếp 6 control trên một hàng ngang, nút cao ~26px — dưới ngưỡng tap target 44px.
- `CanvasView` không `fitView` lại khi container đổi kích thước, nên xoay ngang/dọc là topology lệch khung.

## A2. Breakpoint

Dùng thẳng breakpoint mặc định của Tailwind, **không** thêm gì vào `tailwind.config.js`:

| Tên | Điều kiện | Layout |
| --- | --- | --- |
| mobile | `< 768px` | Một pane, tab bar dưới đáy |
| tablet | `768px – 1023px` (`md`) | Sidebar thành drawer, canvas + Inspector cạnh nhau |
| desktop | `≥ 1024px` (`lg`) | Y hệt hiện tại, không đổi một pixel |

393px (iPhone 15, iPhone 15 Pro) và 430px (15 Pro Max) đều rơi vào mobile. 375px (SE/mini) cũng phải
không vỡ — mọi giá trị cứng trong layout mobile phải chịu được 375px.

## A3. Layout mobile

```
┌─────────────────────────────┐
│ BrokerSwitcher · lesson title│  TopBar, h-11, pt safe-area-inset-top
├─────────────────────────────┤
│                             │
│   pane đang chọn            │  flex-1, min-h-0, overflow-y-auto
│                             │
├─────────────────────────────┤
│ ⟲  ▶  ⏭ ─────────  1.2s  1x │  Transport gọn, mọi nút min-h-11
├─────────────────────────────┤
│  Bài học │ Canvas │ Trạng thái│  MobileTabBar, pb safe-area-inset-bottom
└─────────────────────────────┘
```

| Tab | Nội dung |
| --- | --- |
| `lessons` | `LessonSidebar` toàn màn |
| `canvas` | `CanvasView` (flex-1) + `StatePanel` thu gọn ở đáy (`max-h-24`) |
| `state` | `Inspector` — hoặc `SandboxPanel` khi ở sandbox — cộng `StatePanel` không giới hạn chiều cao |

Transport hiện ở **mọi** tab: tua thời gian ảo là hành động xuyên suốt, ẩn nó đi thì tab Bài học và tab
Trạng thái mất khả năng điều khiển mô phỏng đang xem.

Tab mặc định là `canvas`. Đổi lesson từ tab `lessons` sẽ tự nhảy sang `canvas` — người học vừa chọn bài
thì thứ họ muốn thấy là mô phỏng, không phải danh sách bài.

## A4. Layout tablet

Hai cột: `CanvasView` + `StatePanel` + `Transport` bên trái, `Inspector`/`SandboxPanel` (`w-72`) bên phải.
`LessonSidebar` thành drawer overlay (`fixed inset-y-0 left-0 w-64`, backdrop mờ), mở bằng nút hamburger ở
`TopBar`, đóng khi chọn lesson hoặc chạm backdrop.

## A5. Thay đổi theo file

### Shell — file mới

- **`src/shell/ui/useMediaQuery.ts`** — `useMediaQuery(query: string): boolean` bọc `window.matchMedia`,
  đăng ký `change` listener và cleanup. Hai wrapper `useIsMobile()` (`(max-width: 767px)`) và
  `useIsTablet()` (`(min-width: 768px) and (max-width: 1023px)`). Dùng `useSyncExternalStore` để tránh
  một lượt render sai ở lần mount đầu.
- **`src/shell/ui/TopBar/TopBar.tsx`** — chỉ render ở mobile/tablet: `BrokerSwitcher` + tên lesson đang mở
  (truncate), cộng nút hamburger khi ở tablet.
- **`src/shell/ui/MobileTabBar/MobileTabBar.tsx`** — ba nút `Bài học` / `Canvas` / `Trạng thái`,
  `role="tablist"`, `aria-selected`, mỗi nút `min-h-11`.
- **`src/shell/ui/layouts/DesktopLayout.tsx` / `TabletLayout.tsx` / `MobileLayout.tsx`** — nhận **cùng
  một bộ prop** đã tính sẵn ở `App`.

### `src/shell/ui/App.tsx`

`App` vẫn là nơi duy nhất gọi `useSimulation()`, `useAppStore`, và tính `topology`/`script`/`highlight`.
Ba layout chỉ nhận prop và vẽ. **Không layout nào được gọi hook riêng của mình phụ thuộc vào broker đang
active** — đó đúng là cái bẫy `useSimulation.ts` đã ghi chú: số lần gọi hook tại một call site không được
đổi theo broker. Chọn layout bằng `useIsMobile()`/`useIsTablet()` ở `App` rồi render một trong ba
component; cả ba hook media query đều gọi vô điều kiện, mỗi lần render.

### `src/shell/store.ts`

Thêm:

```ts
mobilePane: 'lessons' | 'canvas' | 'state'   // mặc định 'canvas'
setMobilePane(pane: MobilePane): void
drawerOpen: boolean                          // drawer sidebar ở tablet
setDrawerOpen(open: boolean): void
```

Đặt ở store chứ không phải `useState` trong `App` vì cùng lý do cờ `sandbox` đã ở đó: test cần đặt được
trạng thái UI mà không phải mô phỏng cú chạm, và `selectLesson` cần đẩy `mobilePane` về `'canvas'` (§A3)
— một action của store không với tới được state cục bộ của component.

`src/shell/store.importOrder.test.ts` không đổi: không thêm import mới nào vào `store.ts`.

### `src/shell/ui/Transport/Transport.tsx`

Một component, hai cách trình bày, chọn bằng prop `compact?: boolean` do layout truyền xuống (không tự
gọi `useIsMobile` — giữ nó thuần và test được):

- `compact` bật: nút `Chạy lại` / `Bước` chỉ còn icon, chữ chuyển thành `aria-label`; nút `Chạy/Tạm dừng`
  giữ chữ (hành động chính); mọi nút `min-h-11 min-w-11`; slider `flex-1`; đồng hồ `w-12`; `select` speed
  `min-h-11`.
- `compact` tắt: đúng như hiện tại.

`data-testid="transport"` và `data-testid="play-pause"` giữ nguyên — `App.test.tsx` hiện tại đang dựa vào.

### `src/shell/ui/CanvasView/CanvasView.tsx`

- `minZoom={0.25}` (mặc định React Flow là `0.5`) — topology 3 broker × 6 partition của Kafka không lọt
  vào 393px ở zoom 0.5.
- `fitView` + `fitViewOptions={{ padding: 0.15 }}`.
- `ResizeObserver` trên container: gọi `fitView()` khi kích thước đổi (xoay máy, đổi tab, bàn phím ảo
  hiện). Debounce bằng `requestAnimationFrame`, không `setTimeout` — file này ở `src/shell/ui/`, ngoài
  vùng `purity.test.ts` soi, nhưng vẫn tránh timer để không tạo tiền lệ.
- Fit lại khi `lessonId` hoặc `brokerId` đổi.
- Giữ pinch-zoom và `panOnDrag` một ngón (mặc định của React Flow đã đúng); **không** đụng `preventScrolling`
  — mặc định `true` là thứ chặn trang cuộn khi người dùng pan canvas.

### `src/index.css`

```css
html, body, #root {
  height: 100dvh;   /* fallback height: 100vh ở dòng trên cho browser cũ */
}
body { overscroll-behavior: none; }  /* chặn bounce/pull-to-refresh của Safari iOS */
```

Thêm utility class cho safe area (`padding-bottom: env(safe-area-inset-bottom)` v.v.) — Tailwind không
có sẵn, và thêm plugin chỉ vì hai class là thừa.

### `index.html`

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

`viewport-fit=cover` là điều kiện bắt buộc để `env(safe-area-inset-*)` trả về khác 0 trên iOS.

### Broker — RabbitMQ, Redis (và Kafka sau này theo cùng quy tắc)

- `src/brokers/redis/ui/KeyspacePanel.tsx:53` và `src/brokers/rabbitmq/ui/InFlightPanel.tsx:17`:
  `max-h-32` → `max-h-24 md:max-h-32`. Khi panel nằm trong tab `state` (mobile) thì bỏ hẳn giới hạn —
  truyền qua prop `dense?: boolean` từ layout, không để panel tự dò breakpoint.
  Việc này đổi chữ ký `StatePanel` trong `BrokerModule`: `ComponentType<{ state: S; dense?: boolean }>`.
  Prop optional nên broker chưa dùng tới vẫn compile.
- `NodeConfig.tsx` của cả hai broker: `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`.
- `Inspector.tsx:63` `grid-cols-2` giữ nguyên — 2 cột số ở 393px vẫn đọc được.
- `nodes.tsx`: rà node nào rộng hơn ~200px thì thêm `max-w-[200px]` + `truncate` cho nhãn. React Flow
  zoom lo phần còn lại.
- `rabbitmq/sandbox/ExportDialog.tsx`: modal `inset-0 rounded-none md:inset-auto md:max-w-2xl md:rounded`
  — full màn ở mobile, giữ nguyên ở desktop.
- `rabbitmq/sandbox/SandboxPanel.tsx`: cuộn dọc được, nút `min-h-11`.

**Ghi rõ giới hạn:** sandbox kéo-thả trên 393px vẫn là trải nghiệm kém dù React Flow hỗ trợ chạm. Mục
tiêu của mobile là **xem lesson**, không phải xây topology. Không cố tối ưu sandbox cho mobile trong plan
này.

## A6. Test

- `src/shell/ui/useMediaQuery.test.ts` — mock `window.matchMedia`, xác nhận giá trị ban đầu, phản ứng khi
  `change` bắn, và listener được gỡ lúc unmount.
- Polyfill `matchMedia` trong setup file của vitest (jsdom không có). Mặc định trả `matches: false` để mọi
  test cũ vẫn nhận desktop layout — không test nào đang tồn tại phải sửa.
- `src/shell/ui/App.test.tsx` thêm nhóm case mobile: đúng một pane render tại một thời điểm; tab bar có ba
  tab; đổi tab đổi pane; `Transport` hiện ở cả ba tab; chọn lesson ở tab `lessons` đẩy `mobilePane` về
  `canvas`.
- `src/shell/ui/MobileTabBar/MobileTabBar.test.tsx` — `role="tablist"`, `aria-selected` đúng tab, mỗi nút
  có class `min-h-11`.
- `src/shell/ui/Transport/Transport.test.tsx` — ở `compact`, nút `Bước`/`Chạy lại` vẫn tìm được bằng
  accessible name (chữ đã chuyển sang `aria-label`).

Không test nào chụp ảnh màn hình hay đo pixel thật — jsdom không layout. Test khẳng định **cấu trúc**
(pane nào render, class nào có mặt), còn phần "trông có đúng không" xác nhận thủ công bằng DevTools ở
393×852 và 430×932.

---

# PHẦN B — BROKER KAFKA (P1–P8)

## B1. Mục tiêu

Broker thứ ba, đủ sâu để dạy trọn khái niệm Kafka: log per-partition, producer, consumer group và
rebalance, replication/ISR, retention/compaction, transaction/exactly-once. Kèm sandbox tự do và xuất
code, ngang RabbitMQ. 24 lesson chia 5 nhóm.

Shell **không sửa một dòng nào** cho Kafka (ngoài phần responsive ở P0 và prop `dense?` ở §A5). Đăng ký ở
`src/brokers/registry.ts` **và** `src/brokers/catalog.ts` — thiếu một trong hai là broker không tới được
store.

## B2. Topology — đầu vào bất biến

```ts
export interface KafkaTopology {
  brokers: KafkaBrokerSpec[]
  topics: KafkaTopicSpec[]
  producers: KafkaProducerSpec[]
  consumers: KafkaConsumerSpec[]
  controllerBrokerId: NodeId
}

interface KafkaBrokerSpec {
  id: NodeId; label: string; position: XY; rack?: string
  /** Follower fetch bao lâu một lần (thời gian ảo). Mặc định 200ms, cộng jitter qua `rng.ts`. */
  replicaFetchEveryMs?: number
  /** Follower im lặng quá lâu thì rơi khỏi ISR. Mặc định 10_000ms — bằng default của Kafka thật. */
  replicaLagTimeMaxMs?: number
}

interface KafkaTopicSpec {
  name: string
  partitions: number
  replicationFactor: number
  config?: {
    retentionMs?: number
    retentionBytes?: number
    segmentMs?: number
    segmentBytes?: number
    cleanupPolicy?: 'delete' | 'compact'
    minInsyncReplicas?: number
    /** Bật thì cho bầu leader ngoài ISR khi ISR rỗng — đổi mất dữ liệu lấy tính sẵn sàng.
     *  Mặc định `false`, đúng default của Kafka từ 0.11. Bài 19 bật nó lên để dạy hậu quả. */
    uncleanLeaderElection?: boolean
  }
}

interface KafkaProducerSpec {
  id: NodeId; label: string; position: XY
  acks?: 0 | 1 | 'all'          // mặc định 'all'
  retries?: number
  maxInFlight?: number          // max.in.flight.requests.per.connection, mặc định 5
  idempotent?: boolean
  transactionalId?: string
  lingerMs?: number
  batchSize?: number            // bytes
  partitioner?: 'default' | 'round-robin' | 'sticky'
  compression?: 'none' | 'gzip' | 'lz4'   // chỉ ảnh hưởng bytes ước lượng, không nén thật
}

interface KafkaConsumerSpec {
  id: NodeId; label: string; position: XY
  groupId: string
  subscriptions: string[]
  autoOffsetReset?: 'earliest' | 'latest'
  enableAutoCommit?: boolean
  autoCommitIntervalMs?: number
  maxPollRecords?: number
  sessionTimeoutMs?: number
  maxPollIntervalMs?: number
  /** Coordinator chờ bao lâu để gom member trong một vòng rebalance. Bỏ trống thì lấy
   *  `maxPollIntervalMs` — đúng cách Kafka thật mặc định `rebalance.timeout.ms`. */
  rebalanceTimeoutMs?: number
  processingMs?: number         // thời gian ảo xử lý mỗi record
  isolationLevel?: 'read_uncommitted' | 'read_committed'
}
```

Giống Redis, mọi lesson dùng chung các node singleton `Object.freeze`d khai báo ở `lessons/types.ts`
(`BROKER_1/2/3`, `PRODUCER`, `CONSUMER_A/B/C`). Engine **không bao giờ** ghi vào topology.

## B3. State

```ts
export interface KafkaState extends KernelState {
  partitions: Record<string, PartitionState>   // key `${topic}-${partition}`
  groups: Record<string, GroupState>
  producers: Record<NodeId, ProducerRuntime>
  consumers: Record<NodeId, ConsumerRuntime>
  brokersOnline: Record<NodeId, boolean>
  controller: { brokerId: NodeId; epoch: number }
  transactions: Record<string, TxnState>       // key = transactionalId
  metrics: KafkaMetrics
  inFlight: InFlight[]
}

interface PartitionState {
  topic: string; index: number
  leader: NodeId; replicas: NodeId[]; isr: NodeId[]
  log: LogEntry[]
  logStartOffset: number       // tăng khi retention xoá segment
  leo: number                  // log end offset
  highWatermark: number        // min(LEO của mọi replica trong ISR)
  lastStableOffset: number     // cho read_committed
  replicaState: Record<NodeId, { leo: number; lastFetchAt: number }>
  segments: { baseOffset: number; bytes: number; createdAt: number; sealed: boolean }[]
  leaderEpoch: number
}

interface LogEntry {
  offset: number
  key: string | null
  value: string | null         // null = tombstone (compaction)
  timestamp: number            // thời gian ảo
  headers?: Record<string, string>
  bytes: number
  producerId?: number; producerEpoch?: number; sequence?: number
  txnId?: string
  control?: 'commit' | 'abort' // transaction marker
}

interface GroupState {
  groupId: string
  state: 'Empty' | 'PreparingRebalance' | 'CompletingRebalance' | 'Stable'
  generationId: number
  leaderMemberId: NodeId | null
  assignor: 'range' | 'round-robin' | 'sticky' | 'cooperative-sticky'
  members: GroupMember[]
  committedOffsets: Record<string, { offset: number; committedAt: number }>
  coordinatorBrokerId: NodeId
}

interface GroupMember {
  memberId: NodeId
  subscriptions: string[]
  assignment: { topic: string; partition: number }[]
  lastHeartbeatAt: number
  lastPollAt: number
}

interface ProducerRuntime {
  batches: Record<string, { records: PendingRecord[]; bytes: number; openedAt: number }>
  inFlightRequests: number
  producerId?: number; epoch?: number
  nextSequence: Record<string, number>   // theo partition
  txnState?: 'Empty' | 'Ongoing' | 'PrepareCommit' | 'PrepareAbort'
}

interface ConsumerRuntime {
  position: Record<string, number>       // fetch offset theo partition
  paused: string[]
  lastPollAt: number
  processingUntil?: number
  pendingCommit?: Record<string, number>
}

interface KafkaMetrics {
  recordsProduced: number; recordsConsumed: number
  bytesProduced: number
  rebalances: number; commits: number
  retries: number; duplicatesPrevented: number
  underReplicatedPartitions: number
  lagTotal: number
  abortedRecordsSkipped: number
  recordsExpired: number; recordsCompacted: number
}
```

## B4. Script và fault

```ts
export type KafkaScriptedCommand =
  | { at: number; kind: 'produce'; producerId: NodeId; topic: string; key?: string | null; value: string | null; partition?: number; headers?: Record<string, string> }
  | { at: number; kind: 'consumer-join'; consumerId: NodeId }
  | { at: number; kind: 'consumer-leave'; consumerId: NodeId }
  | { at: number; kind: 'commit'; consumerId: NodeId }
  | { at: number; kind: 'seek'; consumerId: NodeId; topic: string; partition: number; offset: number | 'earliest' | 'latest' }
  | { at: number; kind: 'pause' | 'resume'; consumerId: NodeId; topic: string; partition: number }
  | { at: number; kind: 'begin-transaction' | 'commit-transaction' | 'abort-transaction'; producerId: NodeId }

export type KafkaFault =
  | { at: number; kind: 'broker-down'; brokerId: NodeId }
  | { at: number; kind: 'broker-up'; brokerId: NodeId }
  | { at: number; kind: 'consumer-stall'; consumerId: NodeId; durationMs: number }
  | { at: number; kind: 'replica-lag'; brokerId: NodeId; ms: number }
  | { at: number; kind: 'processing-error'; consumerId: NodeId; times: number }
  | { at: number; kind: 'produce-error'; producerId: NodeId; times: number }
```

Trường trên lesson tên là **`failures`**, không phải `faults` — `src/shell/useSimulation.ts` đọc
`.failures` một cách generic và đó là thứ giữ `src/shell/` broker-agnostic. Redis đã theo đúng quy ước
này (`src/brokers/redis/lessons/types.ts`).

## B5. Engine — bố cục file

```
src/brokers/kafka/engine/
  types.ts            # mọi type ở §B2, §B3, §B4
  index.ts            # createKafkaSimulation, bảng reducer, seedEvents
  validate.ts         # KafkaValidationIssue
  murmur2.ts          # hash murmur2 đúng bản Kafka
  partitioner.ts      # default(murmur2) / round-robin / sticky
  log.ts              # append, read, LEO, HW, logStartOffset
  segments.ts         # roll segment, retention xoá theo ms/bytes
  compaction.ts       # cleanup.policy=compact, tombstone
  produce.ts          # batching, linger, acks, retries, idempotent dedupe
  replication.ts      # follower fetch, ISR shrink/expand, HW advance, leader election
  consume.ts          # fetch, maxPollRecords, auto.offset.reset, pause/resume
  transaction.ts      # producerId/epoch, marker, LSO, read_committed
  faults.ts
  group/
    coordinator.ts    # join/sync/heartbeat, generation, máy trạng thái group
    assignors.ts      # range, round-robin, sticky, cooperative-sticky
    offsets.ts        # commit/fetch offset, auto-commit, lag
```

Mỗi file một `*.test.ts` kề bên, theo đúng nếp Redis.

### B5.1 `murmur2.ts` + `partitioner.ts`

Kafka's `DefaultPartitioner` tính `toPositive(murmur2(keyBytes)) % numPartitions`. Cài đúng murmur2 (seed
`0x9747b28c`) chứ không phải một hash bịa ra: bài 03 và bài 08 dạy "cùng key luôn về cùng partition", và
người học phải gõ lại được kết quả đó trên cluster thật. Key `null` đi theo sticky partitioner (KIP-480):
gắn với một partition tới khi batch đầy hoặc `linger.ms` hết, rồi mới đổi.

### B5.2 `produce.ts`

- Record vào batch theo partition; batch flush khi `bytes >= batchSize` hoặc `now - openedAt >= lingerMs`.
- `acks=0`: trả về ngay khi gửi, không chờ leader ghi. `acks=1`: chờ leader append. `acks='all'`: chờ mọi
  replica trong ISR bắt kịp, và ISR phải `>= minInsyncReplicas`, nếu không trả lỗi
  `NOT_ENOUGH_REPLICAS`.
- Retry: `produce-error` fault hoặc leader offline làm request hỏng; retry tối đa `retries` lần với
  backoff. Với `maxInFlight > 1` và **không** idempotent, retry làm **đảo thứ tự** — đó là toàn bộ nội
  dung bài 10.
- Idempotent: `(producerId, epoch, sequence)` theo partition. Broker từ chối sequence đã thấy
  (`duplicatesPrevented++`) và từ chối sequence nhảy cóc (`OUT_OF_ORDER_SEQUENCE`).

### B5.3 `replication.ts`

- Follower fetch định kỳ (`replicaFetchEveryMs`, mặc định 200ms ảo, cộng jitter qua `rng.ts`).
- `highWatermark = min(leo của mọi replica trong isr)`. Consumer chỉ đọc được tới HW.
- ISR shrink khi `now - lastFetchAt > replicaLagTimeMaxMs` (mặc định 10s ảo); expand lại khi follower bắt
  kịp `leo` của leader.
- Leader chết → controller bầu leader mới từ ISR, `leaderEpoch++`. ISR rỗng: nếu
  `unclean.leader.election.enable` bật thì bầu một replica ngoài ISR và **cắt log về LEO của nó** (mất dữ
  liệu — bài 19 dạy chính điểm này); tắt thì partition offline.

### B5.4 `group/`

- **`coordinator.ts`** — máy trạng thái: consumer gửi JoinGroup → group vào `PreparingRebalance` và chờ
  hết `rebalanceTimeoutMs` gom member → member đầu tiên thành leader, tính assignment → SyncGroup phát
  assignment → `Stable`. `generationId` tăng mỗi vòng; heartbeat mang generation cũ bị từ chối. Thiếu
  heartbeat quá `sessionTimeoutMs`, hoặc không poll quá `maxPollIntervalMs`, thì member bị đá và group
  rebalance lại.
- **`assignors.ts`** — bốn assignor thuần, cùng chữ ký
  `(members, partitions) => Record<memberId, TopicPartition[]>`:
  - `range` — chia theo topic, member đầu ôm phần dư (lệch tải khi số partition không chia hết).
  - `round-robin` — rải đều toàn bộ partition của mọi topic.
  - `sticky` — cân bằng nhưng giữ tối đa assignment cũ.
  - `cooperative-sticky` — rebalance tăng dần (KIP-429): vòng một chỉ **thu hồi**, vòng hai mới **giao**,
    partition không bị thu hồi vẫn chạy suốt quá trình. Đây là điểm dạy chính của bài 13.
- **`offsets.ts`** — `committedOffsets` sống trên `GroupState` (mô hình hoá `__consumer_offsets` mà không
  cần dựng topic nội bộ thật — ghi rõ giới hạn này trong narrative bài 14). Auto-commit theo
  `autoCommitIntervalMs`. `lag = highWatermark - committedOffset`.

### B5.5 `transaction.ts`

`InitProducerId` cấp `producerId` + `epoch`; `AddPartitionsToTxn` ghi nhận partition tham gia; commit/abort
ghi **control record** (`control: 'commit' | 'abort'`) vào từng partition. `lastStableOffset` là offset
thấp nhất còn thuộc một transaction đang mở. Consumer `read_committed` chỉ đọc tới LSO và **bỏ qua** record
thuộc transaction đã abort (`abortedRecordsSkipped++`). Consumer `read_uncommitted` đọc tới HW như thường.

### B5.6 `validate.ts`

`KafkaValidationIssue extends ValidationIssueBase`:

| Điều kiện | Mức |
| --- | --- |
| `replicationFactor > brokers.length` | error |
| `minInsyncReplicas > replicationFactor` | error |
| consumer subscribe topic không khai báo | error |
| producer có `transactionalId` nhưng `idempotent !== true` | error |
| `controllerBrokerId` không thuộc `brokers` | error |
| id trùng nhau giữa broker/producer/consumer | error |
| số consumer trong group > tổng partition đã subscribe | warning (có consumer nằm không) |
| topic không producer nào ghi, hoặc không consumer nào đọc | warning |
| `acks: 0` cộng `idempotent: true` | warning (mâu thuẫn ý định) |

`issueText.ts` dịch từng issue sang tiếng Việt, giữ nguyên thuật ngữ Kafka.

## B6. Determinism

Mọi ràng buộc của `purity.test.ts` áp cho `src/brokers/kafka/engine/**` ngay khi thư mục tồn tại: không
`Math.random`, không `Date.now`/`new Date`, không timer, không `window`/`document`, không import `react`/
`zustand`/`@xyflow/react`, không dynamic `import()`.

Nguồn "ngẫu nhiên" duy nhất: `src/shell/kernel/rng.ts` cho jitter của follower fetch, jitter heartbeat, và
thứ tự tới của member trong một vòng rebalance. Mọi chỗ khác là hàm thuần của `(state, event)`.

Chỗ dễ vỡ determinism nhất là **thứ tự lặp trên `Record`**: `Object.keys` theo thứ tự chèn với key chuỗi,
nhưng key dạng `"topic-0"` an toàn còn key số thuần thì không. Vì vậy mọi vòng lặp trên `partitions`,
`groups`, `members` phải đi qua một mảng đã sort tường minh (`sortedPartitionKeys(state)` trong `log.ts`),
không lặp thẳng trên `Object.entries`. Test riêng cho quy tắc này trong `index.test.ts`.

## B7. Lesson — 24 bài / 5 nhóm

```ts
export type KafkaLessonGroup = 'basics' | 'producer' | 'consumer' | 'durability' | 'advanced'
```

`KAFKA_LESSON_GROUPS`: `basics`/`Cơ bản`, `producer`/`Producer`, `consumer`/`Consumer & Group`,
`durability`/`Độ bền`, `advanced`/`Nâng cao`.

### basics — Cơ bản (5)

| # | id | Dạy gì |
| --- | --- | --- |
| 01 | `01-topic-partition` | Topic là tên logic, partition là append-only log, offset là vị trí — không phải id |
| 02 | `02-broker-cluster` | Broker, cluster, controller, leader/follower của từng partition |
| 03 | `03-key-partitioning` | `murmur2(key) % partitions`, cùng key cùng partition, thứ tự chỉ có **trong** partition |
| 04 | `04-produce-consume` | Vòng đời một record: batch → leader append → HW → fetch → xử lý |
| 05 | `05-offsets` | offset vs position vs committed offset; `auto.offset.reset` earliest/latest |

### producer — Producer (5)

| # | id | Dạy gì |
| --- | --- | --- |
| 06 | `06-acks` | `acks=0/1/all` — đánh đổi latency vs mất dữ liệu, mô phỏng bằng `broker-down` |
| 07 | `07-batching-linger` | `linger.ms`, `batch.size`, compression — throughput đổi lấy latency |
| 08 | `08-partitioner` | default vs round-robin vs sticky; hot partition khi key lệch |
| 09 | `09-idempotent-producer` | `producerId`/`epoch`/`sequence` chặn duplicate lúc retry |
| 10 | `10-ordering-retries` | `max.in.flight > 1` + retries làm đảo thứ tự; hai cách chặn |

### consumer — Consumer & Group (6)

| # | id | Dạy gì |
| --- | --- | --- |
| 11 | `11-consumer-group` | Group, assignment, scale ngang; consumer thừa nằm không |
| 12 | `12-rebalance` | JoinGroup/SyncGroup/heartbeat, `generationId`, rebalance dừng toàn bộ group |
| 13 | `13-assignors` | range vs round-robin vs sticky vs cooperative-sticky |
| 14 | `14-commit-strategies` | Auto-commit vs manual; at-least-once vs at-most-once; duplicate sau crash |
| 15 | `15-consumer-lag` | Lag = HW − committed; chẩn đoán, và khi nào scale không cứu được |
| 16 | `16-max-poll-interval` | Xử lý chậm → vượt `max.poll.interval.ms` → bị đá → vòng lặp rebalance |

### durability — Độ bền (5)

| # | id | Dạy gì |
| --- | --- | --- |
| 17 | `17-replication-isr` | Leader/follower fetch, ISR, high watermark, tại sao chỉ đọc tới HW |
| 18 | `18-min-insync-replicas` | `acks=all` + `min.insync.replicas` khi mất một broker |
| 19 | `19-leader-election` | Failover, `unclean.leader.election` và mất dữ liệu có thật |
| 20 | `20-retention` | `retention.ms`/`retention.bytes`, segment roll, `logStartOffset` nhảy |
| 21 | `21-compaction` | `cleanup.policy=compact`, tombstone, topic dạng changelog |

### advanced — Nâng cao (3)

| # | id | Dạy gì |
| --- | --- | --- |
| 22 | `22-transactions-eos` | Transaction, control marker, `read_committed`, LSO, exactly-once |
| 23 | `23-retry-dlq` | Retry topic + DLQ, poison message, tại sao không retry tại chỗ |
| 24 | `24-sizing-tuning` | Chọn số partition, ordering đổi lấy parallelism, checklist production |

Mỗi lesson: `topology` cố định, `script` lệnh thật chạy qua engine, `failures?` khi cần, 4–6 bước
`narrative`, 1–2 `checkpoint`, `seed`, `durationMs`. Copy tiếng Việt có dấu; thuật ngữ Kafka
(topic, partition, offset, broker, ISR, high watermark, consumer group, rebalance, assignor, acks,
`min.insync.replicas`, retention, compaction, tombstone, transaction, DLQ…) **không dịch** —
`src/shell/lesson/language.test.ts` tự soi broker mới.

## B8. UI

```
src/brokers/kafka/ui/
  nodes.tsx      # ProducerNode, BrokerNode, PartitionNode, ConsumerNode, ConsumerGroupNode
  toFlow.ts      # toFlowNodes / toFlowEdges
  LogPanel.tsx   # StatePanel
  NodeConfig.tsx
  issueText.ts
```

- **Node**: `broker` là node cha (React Flow parent), `partition` là node con nằm trong nó — một node mỗi
  partition **leader**. Nhờ vậy edge producer→partition vẽ đúng partition mà key rơi vào, đó là điểm dạy
  của bài 03 và 08. `consumerGroup` là node cha bọc các `consumer`, cho thấy assignment đổi khi rebalance.
  Follower replica vẽ mờ trong broker của nó, kèm badge ISR / out-of-sync.
- **`LogPanel`** (`StatePanel`): tab **Log** — từng partition một hàng, entry có `offset`/`key`/`value`,
  vạch `HW` và `LEO`, vùng dưới `logStartOffset` xám đi (đã bị retention xoá); tab **Group** — member,
  assignment, committed offset, lag. Nhận prop `dense?` từ §A5.
- **`NodeConfig`**: producer (`acks`, `linger.ms`, `batch.size`, idempotent, partitioner); partition
  (offsets, replicas, ISR, segment); consumer (group, assignment, position, lag); broker (partition đang
  làm leader, online/offline).
- **`metrics`**: `recordsProduced`, `recordsConsumed`, `rebalances`, `commits`, `lagTotal`,
  `underReplicatedPartitions`, `retries`, `duplicatesPrevented`, `abortedRecordsSkipped`,
  `recordsExpired`, `recordsCompacted` — đúng bằng `KafkaMetrics` ở §B3, spread nguyên vẹn (`{ ...state.metrics }`)
  vì interface không có index signature, y hệt ghi chú ở `src/brokers/redis/index.ts`.
- Mọi component tuân §A5 ngay từ đầu: `grid-cols-1 sm:grid-cols-2`, node có `max-w`, panel có `dense`.

## B9. Sandbox

```
src/brokers/kafka/sandbox/
  kafkaStore.ts        # Zustand store riêng, giống rabbitmq/sandbox/sandboxStore.ts
  SandboxPanel.tsx
  export/
```

Kéo-thả broker/topic/producer/consumer; chỉnh số partition và `replicationFactor`; nối producer→topic và
consumer group→topic; produce tay hoặc bằng generator.

`getTopology`/`getScript`/`subscribe` và `editing.onNodesChange`/`onConnect` là **hàm thuần, không hook** —
`useSimulation` nạp chúng vào một cặp `useSyncExternalStore` cố định, nên số hook tại call site đó không
được đổi theo broker.

## B10. Xuất code

Hai target, đúng nếp RabbitMQ:

- **KafkaJS** — `admin.createTopics` với đúng `numPartitions`/`replicationFactor`/config, `producer` với
  `acks`/`idempotent`/`transactionalId`, `consumer` với `groupId`/`subscribe`/`eachMessage` (hoặc
  `eachBatch` khi `maxPollRecords > 1`).
- **NestJS microservice** — `@nestjs/microservices` transport `Transport.KAFKA`: `ClientsModule.register`,
  `@MessagePattern` / `@EventPattern`, `ConsumerConfig` ánh xạ từ `KafkaConsumerSpec`.

Cùng cấu trúc thư mục và cùng kiểu test snapshot như `src/brokers/rabbitmq/sandbox/export/`.

## B11. Đăng ký

- `src/brokers/kafka/index.ts` — annotate **kiểu cụ thể**
  `BrokerModule<KafkaState, KafkaTopology, KafkaScriptedCommand, KafkaValidationIssue>`, không dùng
  `AnyBrokerModule`.
- `src/brokers/registry.ts` — thêm vào `BROKERS`.
- `src/brokers/catalog.ts` — thêm `{ id: 'kafka', label: 'Kafka', defaultLessonId: '01-topic-partition' }`.
  Bỏ bước này thì store phân giải broker sai — `store.importOrder.test.ts` tồn tại chính vì lỗi đó đã xảy
  ra một lần.

## B12. Test

| Tầng | File |
| --- | --- |
| Engine unit | Một `*.test.ts` kề mỗi file trong `engine/` và `engine/group/` |
| Cross-lesson | `lessons/lessons.test.ts` — `it.each` trên `LESSONS`: topology không có issue mức `error`, chạy hai lần journal khớp byte |
| Theo nhóm | `lessons/basics.test.ts`, `producer.test.ts`, `consumer.test.ts`, `durability.test.ts`, `advanced.test.ts` |
| UI | `nodes.test.tsx`, `toFlow.test.ts`, `LogPanel.test.tsx`, `NodeConfig.test.tsx`, `issueText.test.ts` |
| Sandbox | `kafkaStore.test.ts`, `SandboxPanel.test.tsx` |
| Export | Snapshot cho KafkaJS và NestJS |
| Tự động | `purity.test.ts` và `language.test.ts` soi Kafka ngay khi thư mục tồn tại — không phải sửa gì |

Vài khẳng định hành vi bắt buộc phải có, vì chúng là thứ dễ cài sai nhất:

- `murmur2('user-42')` cho ra đúng partition mà Kafka thật cho ra (test bằng vector cố định).
- `acks='all'` + ISR co xuống dưới `min.insync.replicas` ⇒ produce lỗi, không phải im lặng thành công.
- Rebalance `cooperative-sticky` không thu hồi partition mà member đó vẫn giữ được.
- `read_committed` không bao giờ trả record thuộc transaction đã abort.
- Retention xoá segment làm `logStartOffset` tăng, và consumer đang ở offset đã bị xoá phải reset theo
  `auto.offset.reset`.

## B13. Ngoài phạm vi

Không làm trong plan này: Kafka Streams, Kafka Connect, Schema Registry, quota/throttling,
multi-datacenter/MirrorMaker, KRaft vs ZooKeeper (chỉ nhắc trong narrative bài 02), nén thật (chỉ ước
lượng bytes), SSL/SASL.

---

# Thứ tự giao hàng

| Phase | Nội dung | Xong khi |
| --- | --- | --- |
| **P0** | Responsive shell + RabbitMQ + Redis (Phần A) | `npm test` xanh, kiểm thủ công ở 393×852 và 430×932 |
| **P1** | Engine core: `types`, `murmur2`, `partitioner`, `log`, `segments`, `produce`, `consume`, `validate`, `index` | Unit test engine xanh |
| **P2** | UI Kafka + đăng ký `registry.ts` **và** `catalog.ts` + lesson 01–05 | Kafka chọn được ở switcher, 5 lesson chạy |
| **P3** | Hoàn thiện `produce.ts` (idempotent, retry, ordering) + lesson 06–10 | `producer.test.ts` xanh |
| **P4** | `group/` (coordinator, assignors, offsets) + lesson 11–16 | `consumer.test.ts` xanh |
| **P5** | `replication.ts` + `faults.ts` + lesson 17–21 | `durability.test.ts` xanh |
| **P6** | `transaction.ts` + `compaction.ts` + lesson 22–24 | `advanced.test.ts` xanh, đủ 24 lesson |
| **P7** | Sandbox Kafka | Kéo-thả dựng được topology, nút Sandbox hiện với Kafka |
| **P8** | Xuất code KafkaJS + NestJS | Snapshot export xanh |

Mỗi phase kết thúc bằng `npm test` + `npm run typecheck` + `npm run lint` xanh và dừng lại được: bỏ dở ở
P5 vẫn là một broker Kafka dùng được với 21 lesson, chỉ thiếu sandbox và export.

Cập nhật `README.md` ở P2 (thêm Kafka vào danh sách broker) và lần nữa ở P6 (đủ 24 lesson).
