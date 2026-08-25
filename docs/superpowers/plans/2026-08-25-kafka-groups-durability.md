# Kafka — Consumer Group, Replication, Nâng cao, Sandbox và Export (P4–P8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện broker Kafka — consumer group và rebalance, replication/ISR/leader election, retention & compaction, transaction/exactly-once, đủ 24 lesson trên 5 nhóm, cộng sandbox tự do và xuất code KafkaJS/NestJS.

**Architecture:** Tiếp tục engine reducer thuần đã dựng ở plan trước. Thêm ba trục: `group/` (coordinator + assignor + offset) chạy máy trạng thái rebalance; `replication.ts` cho follower fetch và ISR quyết định high watermark; `transaction.ts` cho control marker và `read_committed`. Sandbox và export theo đúng khuôn RabbitMQ.

**Tech Stack:** TypeScript strict, React + `@xyflow/react`, Zustand (chỉ cho sandbox store), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-responsive-and-kafka-design.md` (Phần B, §B5.3–B5.5, §B7 lesson 11–24, §B9, §B10)

**Plan trước (bắt buộc xong):**
1. `docs/superpowers/plans/2026-08-25-responsive-shell.md`
2. `docs/superpowers/plans/2026-08-25-kafka-core.md`

## Global Constraints

Mọi ràng buộc của plan trước vẫn áp dụng nguyên vẹn:

- **Determinism** trong `src/brokers/kafka/engine/**`: không `Math.random`/`Date.now`/timer/`window`/dynamic import; không import `react`/`zustand`/`@xyflow/react`. Ngẫu nhiên chỉ qua `src/shell/kernel/rng.ts`. `purity.test.ts` grep tự động.
- **Không lặp thẳng `Object.keys`/`Object.entries`** trên `partitions`/`groups`/`members`/`producers`/`consumers`. Luôn qua mảng đã sort tường minh (`sortedPartitionKeys`, và thêm `sortedGroupIds`/`sortedMemberIds` ở plan này). Trong một vòng rebalance, thứ tự member quyết định assignment — lặp sai thứ tự là mất determinism ở chỗ khó phát hiện nhất.
- **Topology bất biến**, node singleton `Object.freeze`d dùng chung.
- **Copy tiếng Việt** có dấu, không từ nối tiếng Anh ngoài backtick; thuật ngữ Kafka không dịch. `language.test.ts` tự soi.
- **Typecheck** chỉ bằng `npm run typecheck`.
- Strict TS: `noUncheckedIndexedAccess`, `noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- `BrokerSandbox` phơi `getTopology`/`getScript`/`subscribe` và `editing.onNodesChange`/`onConnect` là **hàm thuần, không hook** — `useSimulation` nạp chúng vào một cặp `useSyncExternalStore` cố định, nên số hook tại call site đó không được đổi theo broker.
- Trường fault trên lesson tên là **`failures`**.
- Thêm nhánh vào `KafkaEventType` là mở rộng union; thiếu reducer cho một nhánh là lỗi compile — đó là mục đích của nó, đừng cast để né.

---

## File Structure

**Tạo mới — engine:**
- `src/brokers/kafka/engine/group/assignors.ts` + test
- `src/brokers/kafka/engine/group/coordinator.ts` + test
- `src/brokers/kafka/engine/group/offsets.ts` + test
- `src/brokers/kafka/engine/replication.ts` + test
- `src/brokers/kafka/engine/faults.ts` + test
- `src/brokers/kafka/engine/compaction.ts` + test
- `src/brokers/kafka/engine/transaction.ts` + test

**Tạo mới — lesson:** `11-consumer-group.ts` … `24-sizing-tuning.ts`, cộng `consumer.test.ts`, `durability.test.ts`, `advanced.test.ts`

**Tạo mới — sandbox:**
- `src/brokers/kafka/sandbox/kafkaStore.ts` + test
- `src/brokers/kafka/sandbox/SandboxPanel.tsx` + test
- `src/brokers/kafka/sandbox/ExportDialog.tsx` + test
- `src/brokers/kafka/sandbox/export/kafkajs.ts` + test
- `src/brokers/kafka/sandbox/export/nestjs.ts` + test
- `src/brokers/kafka/ui/editing.ts` + test

**Sửa:** `src/brokers/kafka/engine/types.ts`, `engine/index.ts`, `lessons/registry.ts`, `src/brokers/kafka/index.ts`, `README.md`

---

### Task 1: Bốn assignor

**Files:**
- Create: `src/brokers/kafka/engine/group/assignors.ts`
- Test: `src/brokers/kafka/engine/group/assignors.test.ts`

**Interfaces:**
- Consumes: `GroupMember`, `TopicPartition` từ `../types`.
- Produces: `type AssignorName = 'range' | 'round-robin' | 'sticky' | 'cooperative-sticky'`; `type Assignment = Record<string, TopicPartition[]>`; `assign(name: AssignorName, members: GroupMember[], partitions: TopicPartition[]): Assignment`; `revocationsFor(previous: Assignment, next: Assignment): Assignment` (chỉ dùng cho cooperative).

- [ ] **Step 1: Viết test thất bại**

```ts
import { describe, expect, it } from 'vitest'
import { assign, revocationsFor } from './assignors'
import type { GroupMember, TopicPartition } from '../types'

const member = (id: string, subscriptions: string[], assignment: TopicPartition[] = []): GroupMember => ({
  memberId: id, subscriptions, assignment, lastHeartbeatAt: 0, lastPollAt: 0,
})

const partitions = (topic: string, count: number): TopicPartition[] =>
  Array.from({ length: count }, (_, index) => ({ topic, partition: index }))

describe('assign', () => {
  it('range: chia liên tiếp theo topic, member đầu ôm phần dư', () => {
    const result = assign('range', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 5))
    expect(result.c1?.map((p) => p.partition)).toEqual([0, 1, 2])
    expect(result.c2?.map((p) => p.partition)).toEqual([3, 4])
  })

  it('range lệch tải khi số partition không chia hết — đó là nhược điểm bài 13 dạy', () => {
    const result = assign('range', [member('c1', ['t']), member('c2', ['t']), member('c3', ['t'])], partitions('t', 4))
    expect(result.c1).toHaveLength(2)
    expect(result.c2).toHaveLength(1)
    expect(result.c3).toHaveLength(1)
  })

  it('round-robin: rải xen kẽ, cân hơn range trên cùng đầu vào', () => {
    const result = assign('round-robin', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 5))
    expect(result.c1?.map((p) => p.partition)).toEqual([0, 2, 4])
    expect(result.c2?.map((p) => p.partition)).toEqual([1, 3])
  })

  it('round-robin rải qua nhiều topic như một danh sách phẳng', () => {
    const result = assign('round-robin', [member('c1', ['a', 'b']), member('c2', ['a', 'b'])],
      [...partitions('a', 2), ...partitions('b', 2)])
    expect(result.c1).toHaveLength(2)
    expect(result.c2).toHaveLength(2)
  })

  it('sticky: giữ tối đa assignment cũ khi thêm member mới', () => {
    const previous = [member('c1', ['t'], partitions('t', 4))]
    const result = assign('sticky', [...previous, member('c2', ['t'])], partitions('t', 4))
    expect(result.c1).toHaveLength(2)
    expect(result.c2).toHaveLength(2)
    // Hai partition c1 giữ lại phải là partition nó đang có, không phải hai cái bất kỳ.
    for (const tp of result.c1!) expect(previous[0]!.assignment.some((p) => p.partition === tp.partition)).toBe(true)
  })

  it('sticky vẫn cân bằng: chênh lệch giữa member nhiều nhất và ít nhất không quá 1', () => {
    const result = assign('sticky',
      [member('c1', ['t'], partitions('t', 7)), member('c2', ['t']), member('c3', ['t'])], partitions('t', 7))
    const sizes = Object.values(result).map((a) => a.length).sort()
    expect(sizes.at(-1)! - sizes[0]!).toBeLessThanOrEqual(1)
  })

  it('cooperative-sticky cho ra cùng assignment cuối như sticky', () => {
    const members = [member('c1', ['t'], partitions('t', 4)), member('c2', ['t'])]
    expect(assign('cooperative-sticky', members, partitions('t', 4)))
      .toEqual(assign('sticky', members, partitions('t', 4)))
  })

  it('revocationsFor chỉ liệt kê partition thực sự đổi chủ', () => {
    const previous = { c1: partitions('t', 4), c2: [] as TopicPartition[] }
    const next = { c1: partitions('t', 2), c2: [{ topic: 't', partition: 2 }, { topic: 't', partition: 3 }] }
    expect(revocationsFor(previous, next)).toEqual({ c1: [{ topic: 't', partition: 2 }, { topic: 't', partition: 3 }] })
  })

  it('mọi assignor: không partition nào bị giao cho hai member', () => {
    for (const name of ['range', 'round-robin', 'sticky', 'cooperative-sticky'] as const) {
      const result = assign(name, [member('c1', ['t']), member('c2', ['t']), member('c3', ['t'])], partitions('t', 7))
      const all = Object.values(result).flat().map((p) => p.partition)
      expect(new Set(all).size).toBe(all.length)
      expect(all).toHaveLength(7)
    }
  })

  it('member nhiều hơn partition: phần thừa nhận mảng rỗng, không phải undefined', () => {
    const result = assign('range', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 1))
    expect(result.c2).toEqual([])
  })

  it('kết quả không phụ thuộc thứ tự truyền member vào', () => {
    const a = assign('round-robin', [member('c2', ['t']), member('c1', ['t'])], partitions('t', 4))
    const b = assign('round-robin', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 4))
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/group/assignors.test.ts`
Expected: FAIL — `./assignors` chưa tồn tại.

- [ ] **Step 3: Cài đặt**

Bốn hàm thuần, cùng chữ ký. Điểm bắt buộc:

- **Sort trước mọi thứ.** `members` sort theo `memberId`, `partitions` sort theo `(topic, partition)`. Test cuối chốt điều này, và nó cũng là ràng buộc determinism của plan: coordinator gọi `assign` với member theo thứ tự join, mà thứ tự đó phụ thuộc jitter.
- `range`: với mỗi topic, `Math.ceil(count / members.length)` partition cho các member đầu.
- `round-robin`: rải `partitions[i]` cho `members[i % members.length]`, chỉ xét member có subscribe topic đó.
- `sticky`: giữ lại partition mà member đang có nếu nó không vượt quota `Math.ceil(total / members.length)`; phần còn thừa gom lại rồi rải cho member đang dưới quota, theo thứ tự `memberId`.
- `cooperative-sticky`: assignment cuối giống `sticky`. Khác biệt nằm ở **quy trình hai vòng**, do coordinator điều khiển (Task 2), không nằm ở hàm này.
- `revocationsFor(previous, next)`: với mỗi member, các partition có trong `previous` mà không có trong `next`. Bỏ hẳn key có mảng rỗng.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/group/assignors.test.ts`
Expected: PASS — 11 test.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/group/assignors.ts src/brokers/kafka/engine/group/assignors.test.ts
git commit -m "feat(kafka): range, round-robin, sticky and cooperative-sticky assignors"
```

---

### Task 2: Coordinator — máy trạng thái rebalance

**Files:**
- Create: `src/brokers/kafka/engine/group/coordinator.ts`
- Modify: `src/brokers/kafka/engine/types.ts` (thêm `join-group`, `sync-group`, `heartbeat`, `rebalance-complete`, `member-timeout` vào `KafkaEventType`)
- Test: `src/brokers/kafka/engine/group/coordinator.test.ts`

**Interfaces:**
- Consumes: `assign`, `revocationsFor` (Task 1).
- Produces: `joinGroup(state, args): { state; newEvents }`; `leaveGroup(state, args)`; `syncGroup(state, args)`; `heartbeat(state, args)`; `checkTimeouts(state, now): { state; newEvents }`; `sortedGroupIds(state): string[]`; `sortedMemberIds(group): string[]`.

- [ ] **Step 1: Viết test thất bại**

Khẳng định bắt buộc, viết đủ thân từng test:

```ts
describe('coordinator', () => {
  it('member đầu tiên join đưa group từ Empty sang PreparingRebalance', () => {})
  it('member đầu tiên join thành leader của group', () => {})
  it('group chỉ sang CompletingRebalance sau khi hết rebalanceTimeoutMs, không sang ngay khi có member', () => {
    // Đây là lý do rebalance "chậm": coordinator cố ý chờ gom đủ member.
  })
  it('sync xong thì group Stable và mọi member có assignment', () => {})
  it('generationId tăng đúng một lần cho mỗi vòng rebalance', () => {})
  it('heartbeat mang generation cũ bị từ chối, member đó phải join lại', () => {})
  it('member im lặng quá sessionTimeoutMs bị đá và group rebalance', () => {})
  it('member không poll quá maxPollIntervalMs bị đá, dù heartbeat vẫn đều', () => {
    // Heartbeat chạy ở thread riêng của client thật, nên nó vẫn đều trong khi
    // vòng xử lý đã treo — đó chính là bẫy lesson 16 dạy.
  })
  it('member rời group chủ động kích hoạt rebalance ngay, không chờ session timeout', () => {})
  it('rebalanceTimeoutMs mặc định lấy theo maxPollIntervalMs khi không khai báo', () => {})
  it('eager rebalance: mọi member mất hết assignment trong lúc rebalance', () => {
    // `assignor` không phải cooperative — group dừng toàn bộ.
  })
  it('cooperative-sticky: partition không bị thu hồi vẫn giữ nguyên assignment suốt hai vòng', () => {})
  it('cooperative-sticky rebalance hai vòng, generationId tăng hai lần', () => {})
  it('metrics.rebalances đếm đúng số vòng rebalance đã hoàn tất', () => {})
  it('member join theo thứ tự lộn xộn vẫn cho cùng assignment — coordinator sort trước khi assign', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/group/coordinator.test.ts`
Expected: FAIL — `./coordinator` chưa tồn tại.

- [ ] **Step 3: Cài đặt**

Máy trạng thái, đúng bốn trạng thái ở spec §B3:

```
Empty ──join──▶ PreparingRebalance ──hết rebalanceTimeout──▶ CompletingRebalance ──sync──▶ Stable
  ▲                                                                                          │
  └──────────────── member cuối rời ───────────────────────────────────────────────── join/leave/timeout
```

- `joinGroup`: thêm member; nếu group đang `Stable` thì chuyển `PreparingRebalance`, `generationId++`, và hẹn event `rebalance-complete` ở `now + rebalanceTimeoutMs` (`consumer.rebalanceTimeoutMs ?? consumer.maxPollIntervalMs ?? 300_000`). Member đầu tiên (theo `memberId` đã sort) là leader.
- Assignor **eager** (`range`/`round-robin`/`sticky`): khi vào `PreparingRebalance`, xoá sạch `assignment` của mọi member. Đó là "stop-the-world" mà lesson 12 dạy.
- Assignor **cooperative-sticky**: vòng một chỉ áp `revocationsFor` — thu hồi phần phải đổi chủ, giữ nguyên phần còn lại — rồi lập tức mở vòng hai để giao phần vừa thu. Hai vòng ⇒ `generationId` tăng hai lần.
- `heartbeat`: `generationId` khác hiện tại ⇒ trả `ILLEGAL_GENERATION` và buộc member join lại. Đúng ⇒ cập nhật `lastHeartbeatAt`.
- `checkTimeouts(state, now)` chạy định kỳ: member có `now - lastHeartbeatAt > sessionTimeoutMs`, **hoặc** `now - lastPollAt > maxPollIntervalMs`, bị xoá khỏi group và kích hoạt rebalance. Hai điều kiện tách bạch — test riêng cho từng cái.
- `metrics.rebalances` tăng khi chuyển sang `Stable`, không tăng lúc bắt đầu.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/group/coordinator.test.ts && npm run typecheck`
Expected: PASS — 15 test.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/group/coordinator.ts src/brokers/kafka/engine/group/coordinator.test.ts src/brokers/kafka/engine/types.ts
git commit -m "feat(kafka): consumer group coordinator and rebalance state machine"
```

---

### Task 3: Commit offset, auto-commit và lag

**Files:**
- Create: `src/brokers/kafka/engine/group/offsets.ts`
- Test: `src/brokers/kafka/engine/group/offsets.test.ts`

**Interfaces:**
- Consumes: `GroupState`, `PartitionState`.
- Produces: `commitOffsets(state, args: { groupId: string; memberId: NodeId; offsets: Record<string, number>; at: number }): KafkaState`; `committedOffset(group, partitionKey): number | undefined`; `lagFor(state, groupId, partitionKey): number`; `totalLag(state, groupId): number`; `scheduleAutoCommit(state, consumer, at): SimEvent[]`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('offsets', () => {
  it('commit ghi offset của lần đọc kế tiếp, không phải offset vừa đọc', () => {
    // Kafka commit "offset sẽ đọc tiếp", tức offset cuối + 1. Nhầm chỗ này làm
    // consumer đọc lại đúng một record sau mỗi lần khởi động lại.
  })
  it('chưa commit lần nào thì committedOffset là undefined, không phải 0', () => {
    // 0 và "chưa commit" là hai chuyện khác nhau: cái sau mới kích hoạt auto.offset.reset.
  })
  it('lag = high watermark trừ committed offset', () => {})
  it('lag của partition chưa commit tính từ vị trí auto.offset.reset sẽ chọn', () => {})
  it('totalLag cộng lag của mọi partition group đang giữ', () => {})
  it('auto-commit hẹn đúng theo autoCommitIntervalMs', () => {})
  it('enableAutoCommit=false thì không sinh event auto-commit nào', () => {})
  it('commit của member không thuộc group bị bỏ qua, không tạo group ma', () => {})
  it('metrics.commits chỉ tăng khi commit thực sự ghi được', () => {})
  it('metrics.lagTotal cập nhật sau mỗi lần commit và mỗi lần append', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/group/offsets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

`committedOffsets` sống trên `GroupState` — mô hình hoá `__consumer_offsets` mà không dựng topic nội bộ thật. Viết comment nêu rõ giới hạn này ngay trong file; narrative lesson 14 cũng phải nói ra.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/group/`
Expected: PASS toàn bộ thư mục `group`.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/group/offsets.ts src/brokers/kafka/engine/group/offsets.test.ts
git commit -m "feat(kafka): offset commit, auto-commit and lag"
```

---

### Task 4: Nối `group/` và fault consumer vào engine

**Files:**
- Modify: `src/brokers/kafka/engine/index.ts`
- Create: `src/brokers/kafka/engine/faults.ts`
- Test: `src/brokers/kafka/engine/faults.test.ts`, `src/brokers/kafka/engine/index.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces: `applyFault(state, fault, at): { state; newEvents }` xử lý `broker-down`, `broker-up`, `consumer-stall`, `processing-error`, `produce-error`, `replica-lag`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('faults', () => {
  it('broker-down làm mọi partition nó làm leader ngừng nhận produce', () => {})
  it('broker-up đưa broker trở lại, partition nhận produce lại được', () => {})
  it('consumer-stall giữ lastPollAt đứng yên nên member vượt maxPollIntervalMs và bị đá', () => {})
  it('processing-error làm record bị xử lý lại đúng số lần đã khai, rồi mới đi tiếp', () => {})
  it('fault ở thời điểm không có gì để tác động thì không làm gì, không throw', () => {})
})

describe('engine với consumer group', () => {
  it('hai consumer cùng group chia nhau partition, không consumer nào đọc trùng', () => {})
  it('một consumer rời group thì partition của nó được giao lại trong cùng run', () => {})
  it('cùng seed cho journal giống hệt nhau kể cả khi có rebalance', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/faults.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

Thêm reducer cho các `KafkaEventType` mới. TypeScript sẽ báo thiếu nhánh nếu quên — đó là cơ chế bảo vệ, không cast để né.

`seedEvents()` sinh event từ `failures`, đặt `seq` sau các event script cùng `at` để một fault và một lệnh cùng mốc luôn được áp theo thứ tự cố định.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/ && npx vitest run src/shell/kernel/purity.test.ts && npm run typecheck`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/
git commit -m "feat(kafka): wire consumer groups and faults into the engine"
```

---

### Task 5: Lesson 11–16 (nhóm `consumer`)

**Files:**
- Create: `11-consumer-group.ts`, `12-rebalance.ts`, `13-assignors.ts`, `14-commit-strategies.ts`, `15-consumer-lag.ts`, `16-max-poll-interval.ts`
- Create: `src/brokers/kafka/lessons/consumer.test.ts`
- Modify: `src/brokers/kafka/lessons/registry.ts`

**Interfaces:**
- Consumes: engine Task 4.
- Produces: `consumerGroup`, `rebalance`, `assignors`, `commitStrategies`, `consumerLag`, `maxPollInterval`.

- [ ] **Step 1: Viết `consumer.test.ts` (thất bại)**

```ts
describe('lesson 11 — consumer group', () => {
  it('mỗi partition được đúng một consumer trong group đọc', () => {})
  it('consumer thứ tư trong group ba partition không nhận partition nào', () => {})
})
describe('lesson 12 — rebalance', () => {
  it('trong lúc rebalance không consumer nào đọc được record mới', () => {})
  it('sau rebalance mọi partition đều có chủ trở lại', () => {})
})
describe('lesson 13 — assignor', () => {
  it('cooperative-sticky giữ được assignment của partition không đổi chủ', () => {})
  it('range để lại chênh lệch tải lớn hơn round-robin trên cùng đầu vào', () => {})
})
describe('lesson 14 — commit', () => {
  it('at-most-once: commit trước khi xử lý thì crash làm mất record', () => {})
  it('at-least-once: commit sau khi xử lý thì crash làm xử lý lại record', () => {})
})
describe('lesson 15 — lag', () => {
  it('producer nhanh hơn consumer thì lag tăng đều', () => {})
  it('thêm consumer vào group làm lag giảm — nhưng chỉ tới số partition', () => {})
})
describe('lesson 16 — max.poll.interval.ms', () => {
  it('consumer xử lý chậm bị đá khỏi group', () => {})
  it('bị đá xong join lại rồi lại bị đá — vòng lặp rebalance', () => {
    expect(state.metrics.rebalances).toBeGreaterThan(2)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/lessons/consumer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết sáu lesson**

**11 — `Consumer group`** (seed 11, 24s). Topic 3 partition, group `g1` có `c1` rồi thêm `c2` ở giữa run, rồi thêm `c3` và `c4`. Narrative: group là đơn vị chia việc, không phải một consumer · mỗi partition đúng một consumer trong cùng group · thêm consumer là scale, nhưng trần cứng là **số partition** · consumer thứ tư nằm không, không phải dự phòng nóng · hai group khác nhau đọc độc lập cùng một topic, mỗi group một bộ offset riêng.

**12 — `Rebalance`** (seed 12, 26s). `c2` join ở giây 6, `c1` leave ở giây 14. Narrative: JoinGroup rồi SyncGroup, leader tính assignment chứ không phải broker · `generationId` là số vòng, heartbeat mang generation cũ bị từ chối · rebalance eager dừng toàn bộ group, không riêng consumer mới · rebalance càng lâu khi group càng đông · mỗi lần deploy lăn bánh là một chuỗi rebalance, đó là lý do người ta quan tâm tới nó.

**13 — `Assignor`** (seed 13, 28s). Hai group song song trên cùng topic 6 partition: `g-range` dùng `range`, `g-coop` dùng `cooperative-sticky`; cả hai thêm một consumer ở giây 10. Narrative: range chia liên tiếp và lệch khi không chia hết · round-robin cân hơn nhưng xáo trộn nhiều hơn mỗi lần rebalance · sticky cân bằng mà vẫn giữ tối đa assignment cũ · cooperative-sticky rebalance hai vòng, partition không đổi chủ **không** ngừng chạy · mặc định nên chọn cooperative-sticky khi client hỗ trợ.

**14 — `Commit strategy`** (seed 14, 26s). Hai consumer khác group: `c-auto` `enableAutoCommit: true, autoCommitIntervalMs: 5000`, `c-manual` `enableAutoCommit: false` với `commit` tường minh sau mỗi lần xử lý. `failures: [{ at: 12_000, kind: 'consumer-stall', consumerId: 'c-auto', durationMs: 8000 }]`. Narrative: committed offset là thứ duy nhất quyết định chỗ khởi động lại · auto-commit commit theo đồng hồ, không theo tiến độ xử lý · commit trước khi xử lý là at-most-once, mất record khi crash · commit sau khi xử lý là at-least-once, xử lý lại khi crash · Kafka không có at-exactly-once ở tầng này, muốn có thì phải làm xử lý idempotent hoặc dùng transaction (bài 22) · nói rõ giới hạn mô phỏng: `committedOffsets` ở đây nằm trên `GroupState`, Kafka thật lưu trong topic `__consumer_offsets`.

**15 — `Consumer lag`** (seed 15, 30s). Producer ghi mỗi 500ms, một consumer `processingMs: 1200`, thêm consumer thứ hai ở giây 15. Narrative: lag = high watermark trừ committed offset, đo bằng số record chứ không phải giây · lag tăng đều nghĩa là consumer chậm hơn producer, không phải nghẽn mạng · thêm consumer chỉ giúp tới trần số partition · lag của một partition duy nhất tăng thì thủ phạm thường là hot key (bài 08), không phải thiếu consumer · lag là chỉ số cảnh báo đáng tin nhất của một hệ Kafka.

**16 — `max.poll.interval.ms`** (seed 16, 30s). `maxPollIntervalMs: 6000`, `processingMs: 9000`, `sessionTimeoutMs: 10_000`. Narrative: heartbeat và poll là hai đồng hồ khác nhau · heartbeat chạy ở thread riêng nên vẫn đều trong khi vòng xử lý đã treo · vượt `max.poll.interval.ms` là bị đá, dù heartbeat hoàn hảo · bị đá thì join lại, xử lý lại vẫn chậm, lại bị đá — vòng lặp rebalance khiến group không tiến được bước nào · lối ra: giảm `max.poll.records`, tăng `max.poll.interval.ms`, hoặc đẩy việc nặng sang thread khác.

- [ ] **Step 4: Cập nhật `registry.ts`, chạy test**

Run: `npx vitest run src/brokers/kafka/lessons/ && npm run typecheck`
Expected: PASS — `lessons.test.ts` giờ chạy `it.each` trên 16 lesson.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/lessons/
git commit -m "feat(kafka): consumer group lessons 11-16"
```

---

### Task 6: `replication.ts` — follower fetch, ISR, leader election

**Files:**
- Create: `src/brokers/kafka/engine/replication.ts`
- Modify: `src/brokers/kafka/engine/types.ts` (`replica-fetch`, `isr-shrink`, `isr-expand`, `leader-election`)
- Test: `src/brokers/kafka/engine/replication.test.ts`

**Interfaces:**
- Consumes: `recomputeHighWatermark` (plan trước, Task 3).
- Produces: `replicaFetch(state, args): { state; newEvents }`; `shrinkIsr(state, at)`; `expandIsr(state, at)`; `electLeader(state, args: { partitionKey: string; at: number }): { state; newEvents; dataLoss: number }`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('replication', () => {
  it('follower fetch kéo LEO của nó lên bằng leader', () => {})
  it('high watermark chỉ nhích khi mọi replica trong ISR đã bắt kịp', () => {})
  it('replica chậm quá replicaLagTimeMaxMs rơi khỏi ISR', () => {})
  it('ISR co lại làm high watermark nhích lên — replica chậm không còn giữ nó nữa', () => {
    // Phản trực giác nhưng đúng: HW là min LEO **trong ISR**, nên loại bớt thành
    // viên chậm ra thì min tăng.
  })
  it('replica bắt kịp trở lại thì vào lại ISR', () => {})
  it('leader chết: leader mới được bầu từ ISR, không mất record nào', () => {})
  it('ISR chỉ còn leader và leader chết, unclean tắt: partition offline, produce lỗi', () => {})
  it('unclean bật: replica ngoài ISR lên làm leader và log bị cắt về LEO của nó', () => {
    expect(result.dataLoss).toBeGreaterThan(0)
  })
  it('leaderEpoch tăng mỗi lần bầu lại', () => {})
  it('metrics.underReplicatedPartitions đếm partition có ISR nhỏ hơn replicationFactor', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/replication.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

- `replicaFetch` chạy định kỳ mỗi `broker.replicaFetchEveryMs ?? 200`, cộng jitter lấy từ `rng.ts` (`nextInt`) — bắt buộc đi qua RNG thuần, không tự sinh.
- Sau mỗi fetch: `replicaState[b].leo = leader.leo`, `lastFetchAt = now`, rồi `recomputeHighWatermark`.
- `shrinkIsr`: replica có `now - lastFetchAt > replicaLagTimeMaxMs` (mặc định `10_000`) bị loại. Loại xong **phải** gọi lại `recomputeHighWatermark` — test "ISR co lại làm HW nhích lên" chốt đúng thứ tự này.
- `electLeader`: chọn replica online đầu tiên trong ISR (theo thứ tự `replicas` đã sort). ISR rỗng: `topic.config.uncleanLeaderElection` bật thì chọn replica online có `leo` cao nhất và cắt `log` về `leo` đó, trả `dataLoss` = số record bị cắt; tắt thì đặt `leader: null` và mọi produce vào partition đó trả `LEADER_NOT_AVAILABLE`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/replication.test.ts && npm run typecheck`
Expected: PASS — 10 test.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/replication.ts src/brokers/kafka/engine/replication.test.ts src/brokers/kafka/engine/types.ts
git commit -m "feat(kafka): replication, ISR and leader election"
```

---

### Task 7: `compaction.ts`

**Files:**
- Create: `src/brokers/kafka/engine/compaction.ts`
- Test: `src/brokers/kafka/engine/compaction.test.ts`

**Interfaces:**
- Consumes: `PartitionState`, `KafkaTopicSpec`.
- Produces: `compact(partition, now): { partition: PartitionState; removed: number }`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('compaction', () => {
  it('giữ lại bản ghi cuối của mỗi key, xoá bản cũ hơn', () => {})
  it('không đụng tới record trong segment đang mở — Kafka cũng vậy', () => {})
  it('record không key được giữ nguyên, compaction không biết gộp chúng theo gì', () => {})
  it('tombstone (value = null) xoá hẳn key khỏi log sau khi compact', () => {})
  it('offset của record còn lại giữ nguyên, không đánh số lại', () => {
    // Sau compaction, log có lỗ offset. Consumer phải chịu được điều đó, và đây
    // là điểm dễ hiểu sai nhất của compaction.
  })
  it('logStartOffset không đổi khi compaction chạy — nó chỉ đổi bởi retention', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/compaction.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt** — duyệt log **ngược từ cuối**, giữ lần xuất hiện đầu tiên (tức bản mới nhất) của mỗi key, bỏ mọi bản cũ hơn; tombstone thì bỏ luôn cả chính nó. Chỉ xét record thuộc segment `sealed`. Không đánh số lại offset.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/compaction.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/compaction.ts src/brokers/kafka/engine/compaction.test.ts
git commit -m "feat(kafka): log compaction and tombstones"
```

---

### Task 8: Lesson 17–21 (nhóm `durability`)

**Files:**
- Create: `17-replication-isr.ts`, `18-min-insync-replicas.ts`, `19-leader-election.ts`, `20-retention.ts`, `21-compaction.ts`
- Create: `src/brokers/kafka/lessons/durability.test.ts`
- Modify: `src/brokers/kafka/lessons/registry.ts`, `src/brokers/kafka/engine/index.ts` (nối `replication.ts`, `compaction.ts`, `segments.ts` vào bảng reducer)

- [ ] **Step 1: Viết `durability.test.ts` (thất bại)**

```ts
describe('lesson 17', () => {
  it('consumer không bao giờ đọc được record vượt quá high watermark', () => {})
  it('follower chậm kéo high watermark tụt lại so với LEO của leader', () => {})
})
describe('lesson 18', () => {
  it('acks=all + min.insync.replicas=2: mất một broker là produce lỗi, không mất im lặng', () => {})
  it('cùng kịch bản với min.insync.replicas=1 thì produce vẫn thành công', () => {})
})
describe('lesson 19', () => {
  it('leader chết, bầu từ ISR: không record nào biến mất', () => {})
  it('unclean.leader.election bật: log ngắn lại, record đã acks=all vẫn mất', () => {})
})
describe('lesson 20', () => {
  it('retention.ms xoá segment cũ, logStartOffset tăng', () => {})
  it('consumer đang ở offset đã bị xoá phải reset theo auto.offset.reset', () => {})
})
describe('lesson 21', () => {
  it('sau compaction mỗi key chỉ còn một bản ghi', () => {})
  it('tombstone xoá hẳn key', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/lessons/durability.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết năm lesson**

**17 — `Replication và ISR`** (seed 17, 28s). Ba broker, topic 2 partition replicationFactor 3; `failures: [{ at: 10_000, kind: 'replica-lag', brokerId: 'b3', ms: 15_000 }]`. Narrative: mỗi partition có một leader và các follower, follower **kéo** chứ không được đẩy · ISR là tập replica đang bắt kịp · high watermark là LEO nhỏ nhất trong ISR, và consumer chỉ đọc tới đó · record vừa ghi chưa đọc được không phải lỗi, đó là bảo đảm bền · replica chậm rơi khỏi ISR, và high watermark **nhích lên** ngay sau đó — phản trực giác nhưng đúng theo định nghĩa.

**18 — `min.insync.replicas`** (seed 18, 26s). Hai topic giống nhau, một `minInsyncReplicas: 2`, một `minInsyncReplicas: 1`; cùng producer `acks: 'all'`; `failures: [{ at: 9000, kind: 'broker-down', brokerId: 'b2' }]`. Narrative: `acks=all` một mình không bảo đảm gì — "all" là "cả ISR", mà ISR có thể co về một · `min.insync.replicas` là sàn ISR để một lần ghi được chấp nhận · dưới sàn thì produce **lỗi**, và lỗi ồn ào tốt hơn mất im lặng · công thức phổ biến: replicationFactor 3, `min.insync.replicas` 2, `acks=all` · đặt `min.insync.replicas` bằng replicationFactor là mất khả năng chịu lỗi hoàn toàn.

**19 — `Leader election`** (seed 19, 30s). `failures` giết leader hai lần: lần một ISR còn đủ, lần hai ISR đã co về một và `uncleanLeaderElection: true`. Narrative: controller phát hiện leader chết và bầu lại từ ISR · bầu từ ISR không mất record vì mọi thành viên ISR đã có tới high watermark · `leaderEpoch` tăng để client cũ biết metadata mình đang giữ đã lỗi thời · ISR rỗng là ngã ba: chờ (mất tính sẵn sàng) hoặc bầu bừa (mất dữ liệu) · `unclean.leader.election.enable` mặc định `false` từ 0.11, và nên để nguyên vậy.

**20 — `Retention và segment`** (seed 20, 30s). Topic `segmentBytes: 300, retentionMs: 8000`, producer ghi liên tục; một consumer join muộn với `autoOffsetReset: 'earliest'`. Narrative: log không giữ mọi thứ mãi mãi, retention quyết định giữ bao lâu · xoá theo **segment**, không theo từng record — nên retention là hạt thô · segment đang mở không bao giờ bị xoá · `logStartOffset` nhảy lên khi segment bị xoá, và offset dưới nó vĩnh viễn không đọc được · consumer chậm hơn retention sẽ bị `OFFSET_OUT_OF_RANGE` và reset — mất dữ liệu ở phía consumer, không phải phía broker.

**21 — `Log compaction`** (seed 21, 28s). Topic `cleanupPolicy: 'compact'`, script ghi nhiều lần cùng key `user-1`, `user-2`, rồi một tombstone cho `user-2`. Narrative: compaction giữ **bản mới nhất của mỗi key** thay vì giữ theo thời gian · dùng cho topic dạng changelog/bảng trạng thái, không dùng cho event stream · record không key không compact được · tombstone là record `value = null`, nó xoá key · sau compaction offset có lỗ, consumer phải chịu được điều đó · `delete` và `compact` chọn theo câu hỏi "topic này là dòng sự kiện hay là ảnh chụp trạng thái".

- [ ] **Step 4: Chạy test và gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: xanh toàn bộ, 21 lesson.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/
git commit -m "feat(kafka): durability lessons 17-21"
```

---

### Task 9: `transaction.ts` — marker, LSO, `read_committed`

**Files:**
- Create: `src/brokers/kafka/engine/transaction.ts`
- Modify: `src/brokers/kafka/engine/types.ts` (`txn-begin`, `txn-marker`), `engine/consume.ts` (lọc theo `isolationLevel`)
- Test: `src/brokers/kafka/engine/transaction.test.ts`

**Interfaces:**
- Consumes: `appendRecord`, `ProducerRuntime`.
- Produces: `beginTransaction(state, args)`; `commitTransaction(state, args)`; `abortTransaction(state, args)`; `recomputeLastStableOffset(partition): PartitionState`; `filterForIsolation(records, partition, isolationLevel): LogEntry[]`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('transaction', () => {
  it('record trong transaction đang mở vẫn nằm trong log, chỉ chưa đọc được', () => {})
  it('lastStableOffset đứng lại ở record đầu tiên của transaction đang mở', () => {})
  it('commit ghi control record commit và đẩy lastStableOffset lên', () => {})
  it('abort ghi control record abort, record vẫn nằm trong log', () => {})
  it('read_committed bỏ qua record thuộc transaction đã abort', () => {})
  it('read_committed không đọc quá lastStableOffset', () => {})
  it('read_uncommitted đọc tới high watermark, thấy cả record đã abort', () => {})
  it('read_committed không bao giờ trả control record cho ứng dụng', () => {})
  it('metrics.abortedRecordsSkipped đếm đúng số record bị bỏ qua', () => {})
  it('transaction trên nhiều partition commit hoặc abort cùng nhau, không nửa vời', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/transaction.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt** — theo spec §B5.5. `lastStableOffset` = offset thấp nhất còn thuộc một transaction đang mở, hoặc `highWatermark` nếu không có transaction nào mở. `filterForIsolation` với `read_committed` cắt tại LSO, bỏ record có `txnId` thuộc transaction đã abort, và luôn bỏ record có `control`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/
git commit -m "feat(kafka): transactions, control markers and read_committed"
```

---

### Task 10: Lesson 22–24 (nhóm `advanced`) — đủ 24 lesson

**Files:**
- Create: `22-transactions-eos.ts`, `23-retry-dlq.ts`, `24-sizing-tuning.ts`
- Create: `src/brokers/kafka/lessons/advanced.test.ts`
- Modify: `src/brokers/kafka/lessons/registry.ts`

- [ ] **Step 1: Viết `advanced.test.ts` (thất bại)**

```ts
describe('lesson 22', () => {
  it('consumer read_committed không thấy record của transaction bị abort', () => {})
  it('consumer read_uncommitted trong cùng run thì thấy', () => {})
})
describe('lesson 23', () => {
  it('record lỗi quá số lần cho phép rơi sang DLQ, không chặn partition', () => {})
  it('record sau record lỗi vẫn được xử lý — retry tại chỗ thì không', () => {})
})
describe('lesson 24', () => {
  it('lesson chạy hết durationMs không halt và có đủ narrative', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/lessons/advanced.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết ba lesson**

**22 — `Transaction và exactly-once`** (seed 22, 30s). Producer `idempotent: true, transactionalId: 'tx-orders'`; script `begin-transaction` → 3 produce → `abort-transaction`, rồi `begin-transaction` → 3 produce → `commit-transaction`. Hai consumer khác `isolationLevel`. Narrative: idempotence khử trùng trong một partition; transaction mở rộng ra nhiều partition · `transactional.id` cấp `producerId` và `epoch`, epoch cũ bị hàng rào chặn (zombie fencing) · commit/abort ghi **control record** vào từng partition tham gia · `read_committed` đọc tới last stable offset, không tới high watermark · record đã abort vẫn nằm trong log, consumer bỏ qua chứ broker không xoá · exactly-once của Kafka là trong phạm vi Kafka: read-process-write. Ghi ra ngoài (database, HTTP) không nằm trong bảo đảm này.

**23 — `Retry topic và DLQ`** (seed 23, 28s). Ba topic `orders`, `orders.retry`, `orders.dlq`; `failures: [{ at: 6000, kind: 'processing-error', consumerId: 'c1', times: 5 }]`. Narrative: một record hỏng chặn cả partition nếu retry tại chỗ — vì offset không nhích được · đẩy sang retry topic để partition gốc đi tiếp · retry topic có độ trễ riêng, thường nhiều bậc (5s, 1 phút, 10 phút) · quá số lần thì vào DLQ, kèm header ghi nguyên nhân và số lần thử · DLQ không có ai đọc thì chỉ là chỗ chôn dữ liệu — phải có quy trình xử lý và cảnh báo.

**24 — `Sizing và tuning`** (seed 24, 26s). Cùng workload trên hai topic: 1 partition và 6 partition, mỗi topic một group. Narrative: số partition là trần song song, không thể tăng lên rồi giảm xuống · tăng partition phá vỡ bảo đảm thứ tự theo key vì ánh xạ hash đổi · ordering đổi lấy parallelism, đây là quyết định thiết kế chứ không phải cấu hình · checklist production: replicationFactor 3, `min.insync.replicas` 2, `acks=all`, bật idempotence, cooperative-sticky, giám sát lag và under-replicated partitions · Kafka không phải queue — nếu bạn cần công việc chia đến từng consumer với ack lẻ, RabbitMQ hợp hơn (dẫn ngược sang broker kia trong app).

- [ ] **Step 4: Chạy gate đầy đủ**

Run: `npm test && npm run typecheck && npm run lint`
Expected: xanh, `lessons.test.ts` chạy trên đủ **24** lesson, `language.test.ts` xanh.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/lessons/
git commit -m "feat(kafka): advanced lessons 22-24, all five groups complete"
```

---

### Task 11: Sandbox — store và editing

**Files:**
- Create: `src/brokers/kafka/sandbox/kafkaStore.ts`
- Create: `src/brokers/kafka/ui/editing.ts`
- Test: `kafkaStore.test.ts`, `editing.test.ts`

**Interfaces:**
- Consumes: `KafkaTopology`, `KafkaScriptedCommand`.
- Produces: `useKafkaSandbox` (Zustand store); `getTopology(): KafkaTopology`; `getScript(): KafkaScriptedCommand[]`; `subscribe(onStoreChange: () => void): () => void`; `resetSandbox(): void`; `onNodesChange(topology, changes)`; `onConnect(topology, connection)`; các action `addBroker`, `addTopic`, `addProducer`, `addConsumer`, `setPartitionCount`, `setReplicationFactor`, `produceManually`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('kafkaStore', () => {
  it('getTopology và getScript là hàm thuần, gọi ngoài React vẫn chạy', () => {
    // Ràng buộc của `BrokerSandbox`: `useSimulation` nạp chúng vào một cặp
    // `useSyncExternalStore` cố định. Một hook ở đây làm số hook tại call site
    // đó đổi theo broker và phá Rules of Hooks khi chuyển broker.
    expect(typeof getTopology).toBe('function')
    expect(() => getTopology()).not.toThrow()
  })
  it('getTopology trả cùng reference khi state không đổi', () => {
    // Đổi reference mỗi lần gọi làm `useSyncExternalStore` render vô hạn.
    expect(getTopology()).toBe(getTopology())
  })
  it('subscribe gọi callback khi topology đổi, trả hàm huỷ đăng ký', () => {})
  it('addTopic tạo topic với số partition đã chọn', () => {})
  it('setReplicationFactor lớn hơn số broker vẫn đặt được — validate lo phần báo lỗi', () => {})
  it('resetSandbox đưa về topology rỗng', () => {})
  it('produceManually thêm một lệnh produce vào script với mốc thời gian tăng dần', () => {})
})

describe('editing', () => {
  it('onNodesChange cập nhật vị trí node trong store', () => {})
  it('onConnect từ producer sang topic thêm topic vào danh sách producer ghi', () => {})
  it('onConnect từ consumer sang topic thêm subscription', () => {})
  it('onConnect giữa hai broker bị bỏ qua, không tạo cạnh vô nghĩa', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/sandbox/kafkaStore.test.ts src/brokers/kafka/ui/editing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt** — theo đúng khuôn `src/brokers/rabbitmq/sandbox/sandboxStore.ts`. Đọc file đó trước khi viết; nó đã giải quyết đúng bài toán ổn định reference mà test thứ hai chốt.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/sandbox/kafkaStore.ts src/brokers/kafka/sandbox/kafkaStore.test.ts src/brokers/kafka/ui/editing.ts src/brokers/kafka/ui/editing.test.ts
git commit -m "feat(kafka): sandbox store and canvas editing"
```

---

### Task 12: `SandboxPanel` và gắn `sandbox` vào module

**Files:**
- Create: `src/brokers/kafka/sandbox/SandboxPanel.tsx` + test
- Modify: `src/brokers/kafka/index.ts`

**Interfaces:**
- Consumes: Task 11.
- Produces: `kafka.sandbox: BrokerSandbox<...>` với `Panel`, `getTopology`, `getScript`, `subscribe`, `reset`, `maxEvents`, `transportDurationMs`, `editing`.

- [ ] **Step 1: Viết test thất bại**

```tsx
it('liệt kê mọi issue validate bằng tiếng Việt', () => {})
it('thêm topic bằng form cập nhật store', () => {})
it('nút produce tay thêm lệnh vào script', () => {})
it('panel cuộn được và nút đạt tap target 44px ở màn nhỏ', () => {
  // Ràng buộc từ plan responsive.
  for (const button of screen.getAllByRole('button')) expect(button.className).toContain('min-h-11')
})
```

Thêm vào `src/shell/ui/App.test.tsx`: nút Sandbox **hiện** khi broker là Kafka (trước đây chỉ RabbitMQ có).

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/sandbox/SandboxPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Cài đặt** — viết panel, rồi thêm khối `sandbox` vào `src/brokers/kafka/index.ts`. Shell tự hiện nút Sandbox cho Kafka, **không** sửa gì dưới `src/shell/`.

- [ ] **Step 4: Chạy test và kiểm thủ công**

Run: `npm test && npm run typecheck`, rồi `npm run dev` → Kafka → Sandbox: dựng 2 broker, 1 topic 3 partition, 1 producer, 2 consumer cùng group; produce tay; xem rebalance chạy trên canvas.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/sandbox/ src/brokers/kafka/index.ts src/shell/ui/App.test.tsx
git commit -m "feat(kafka): sandbox panel wired into the broker module"
```

---

### Task 13: Xuất code — KafkaJS và NestJS

**Files:**
- Create: `src/brokers/kafka/sandbox/export/kafkajs.ts` + test
- Create: `src/brokers/kafka/sandbox/export/nestjs.ts` + test
- Create: `src/brokers/kafka/sandbox/ExportDialog.tsx` + test
- Modify: `src/brokers/kafka/index.ts`

**Interfaces:**
- Consumes: `KafkaTopology`.
- Produces: `toKafkaJs(topology: KafkaTopology): string`; `toNestJs(topology: KafkaTopology): string`; `ExportDialog({ topology, onClose })`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('toKafkaJs', () => {
  it('sinh admin.createTopics đúng numPartitions và replicationFactor', () => {})
  it('producer mang đúng acks, idempotent và transactionalId', () => {})
  it('consumer mang đúng groupId, subscribe từng topic và fromBeginning theo autoOffsetReset', () => {})
  it('maxPollRecords > 1 sinh eachBatch thay vì eachMessage', () => {})
  it('khớp snapshot', () => { expect(toKafkaJs(topology)).toMatchSnapshot() })
})

describe('toNestJs', () => {
  it('sinh ClientsModule.register với Transport.KAFKA và danh sách broker', () => {})
  it('mỗi consumer thành một @EventPattern theo topic nó subscribe', () => {})
  it('khớp snapshot', () => { expect(toNestJs(topology)).toMatchSnapshot() })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/sandbox/export/`
Expected: FAIL.

- [ ] **Step 3: Cài đặt** — đọc `src/brokers/rabbitmq/sandbox/export/` trước và bám đúng cấu trúc (một hàm thuần trả chuỗi, snapshot test kèm). `ExportDialog` full màn ở mobile, modal giữa màn từ `md` trở lên — ràng buộc từ plan responsive.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/ && npm run typecheck`
Expected: PASS, snapshot mới được ghi lần đầu.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/sandbox/
git commit -m "feat(kafka): export topology to KafkaJS and NestJS"
```

---

### Task 14: Tài liệu và chốt

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Cập nhật `README.md`**

- Kafka: **24 lesson trên 5 nhóm**, liệt kê đủ như đã làm với RabbitMQ và Redis.
- Kafka có Sandbox và xuất code (KafkaJS, NestJS) — cập nhật đoạn nói "chỉ RabbitMQ có Sandbox".
- Mục cấu trúc thư mục: `src/brokers/kafka/  engine, lessons, sandbox, ui của Kafka`.
- Thuật ngữ Kafka không dịch: bổ sung ISR, high watermark, `min.insync.replicas`, tombstone, LSO.

- [ ] **Step 2: Chạy gate cuối**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: bốn lệnh xanh.

- [ ] **Step 3: Kiểm thủ công toàn diện**

Run: `npm run dev`. Ở 393px và 1280px: đổi qua lại ba broker nhiều lần (console không có hook warning), mở cả 24 lesson Kafka (không lesson nào crash hay halt), vào Sandbox Kafka và xuất code cả hai target.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: Kafka broker complete with 24 lessons, sandbox and export"
```

---

## Self-Review

**Spec coverage (Phần B, phạm vi P4–P8):**

| Mục spec | Task |
| --- | --- |
| §B5.4 `assignors.ts` | Task 1 |
| §B5.4 `coordinator.ts` | Task 2 |
| §B5.4 `offsets.ts` | Task 3 |
| §B4 `faults.ts` đầy đủ | Task 4 |
| §B5.3 `replication.ts` | Task 6 |
| §B5 `compaction.ts` | Task 7 |
| §B5.5 `transaction.ts` | Task 9 |
| §B7 lesson 11–16 | Task 5 |
| §B7 lesson 17–21 | Task 8 |
| §B7 lesson 22–24 | Task 10 |
| §B9 sandbox | Task 11, 12 |
| §B10 export KafkaJS + NestJS | Task 13 |
| §B6 determinism qua rebalance và replication | Task 2 (sort member), Task 4 (test journal), Task 6 (jitter qua rng) |

**Ngoài phạm vi, đúng như §B13:** Kafka Streams, Connect, Schema Registry, quota, MirrorMaker, KRaft vs ZooKeeper (chỉ nhắc ở narrative bài 02), nén thật, SSL/SASL.

**Type consistency:** `AssignorName`/`Assignment` khai báo Task 1, dùng ở Task 2. `sortedGroupIds`/`sortedMemberIds` khai báo Task 2, dùng ở Task 3, 5. `PartitionState.lastStableOffset` đã có từ plan trước (Task 1 của plan đó), Task 9 mới thực sự tính nó. `uncleanLeaderElection` nằm trong `KafkaTopicSpec['config']` từ plan trước, Task 6 mới đọc tới. `KafkaEventType` mở rộng ở Task 2, 4, 6, 9 — union nên thiếu nhánh reducer là lỗi compile.

**Phụ thuộc:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. Task 6 và 7 độc lập với nhau, chạy song song được; mọi cặp còn lại là tuần tự.
