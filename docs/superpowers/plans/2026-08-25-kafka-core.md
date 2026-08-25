# Kafka — Engine Core, UI và 10 Lesson đầu (P1–P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broker Kafka chọn được ở broker switcher, với engine log/partition/producer/consumer chạy thật và 10 lesson đầu (nhóm `basics` và `producer`).

**Architecture:** Một `BrokerModule<KafkaState, KafkaTopology, KafkaScriptedCommand, KafkaValidationIssue>` mới dưới `src/brokers/kafka/`. Engine là reducer thuần chạy trên kernel dùng chung: mỗi partition là một append-only log có `logStartOffset`/`leo`/`highWatermark`; producer gom record thành batch rồi flush theo `linger.ms`/`batch.size`; consumer fetch tới high watermark. Shell không phải sửa gì.

**Tech Stack:** TypeScript strict, React + `@xyflow/react`, Zustand (chỉ ở shell), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-responsive-and-kafka-design.md` (Phần B, §B1–B8 phần producer)

**Plan trước:** `docs/superpowers/plans/2026-08-25-responsive-shell.md` phải xong trước — nó đổi chữ ký `BrokerModule.StatePanel` thành `{ state: S; dense?: boolean }`, và UI Kafka ở plan này viết theo chữ ký mới.

**Plan sau:** `docs/superpowers/plans/2026-08-25-kafka-groups-durability.md` (P4–P8: consumer group, replication, transaction, sandbox, export).

## Global Constraints

- **Determinism.** Trong `src/brokers/kafka/engine/**`: không `Math.random`, không `Date.now`/`new Date`, không `setTimeout`/`setInterval`/`performance.now`, không `window`/`document`/`process`, không dynamic `import()`/`require()`, không import `react`/`zustand`/`@xyflow/react`. Mọi ngẫu nhiên đi qua `src/shell/kernel/rng.ts` (trả `[value, nextRngState]`). `src/shell/kernel/purity.test.ts` grep tự động và **fail nếu một broker có thư mục nhưng thiếu cả `engine/` lẫn `engine.ts`**.
- **Thứ tự lặp.** Không lặp thẳng trên `Object.keys`/`Object.entries` của `partitions`/`groups`/`producers`/`consumers`. Luôn đi qua một mảng đã sort tường minh. Đây là nguồn mất determinism dễ lọt nhất trong plan này.
- **Topology bất biến.** `emptyTopology` và mọi node singleton của lesson là `Object.freeze`d và dùng chung một reference cho mọi lesson. Engine ghi vào topology là hỏng mọi run sau đó.
- **Copy tiếng Việt.** `summary`, `narrative.body`, `checkpoint.question`/`explanation` phải có dấu tiếng Việt và không được chứa từ nối tiếng Anh (`the|and|with|that|which|from|into|because|however`) ngoài backtick. `title` được để tiếng Anh khi nó là tên thuần của khái niệm (`Consumer group`, `Log compaction`). Thuật ngữ Kafka **không dịch**: topic, partition, offset, broker, producer, consumer, batch, `acks`, ISR, high watermark, retention, compaction, tombstone, rebalance, assignor, lag, DLQ. `src/shell/lesson/language.test.ts` tự soi broker mới.
- **Typecheck** chỉ bằng `npm run typecheck` (`tsc -b`). Không bao giờ `npx tsc --noEmit`.
- Strict TS: `noUncheckedIndexedAccess`, `noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Type-only import viết `import type`.
- **Annotate module bằng kiểu cụ thể**, không dùng `AnyBrokerModule` — nó xoá mọi kiểm tra kiểu và biến lỗi compile thành crash lúc render.
- Đăng ký broker phải sửa **cả hai** `src/brokers/registry.ts` và `src/brokers/catalog.ts`.
- Trường scripted fault trên lesson tên là **`failures`**, không phải `faults`.
- Comment giải thích **tại sao**, không phải cái gì. Cùng mật độ với code xung quanh.

---

## File Structure

**Tạo mới — engine:**
- `src/brokers/kafka/engine/types.ts` — mọi type state/topology/event.
- `src/brokers/kafka/engine/validate.ts` + test — `KafkaValidationIssue`.
- `src/brokers/kafka/engine/murmur2.ts` + test — hash đúng bản Kafka.
- `src/brokers/kafka/engine/partitioner.ts` + test — chọn partition.
- `src/brokers/kafka/engine/log.ts` + test — append, đọc, LEO/HW.
- `src/brokers/kafka/engine/segments.ts` + test — roll segment, retention.
- `src/brokers/kafka/engine/produce.ts` + test — batch, linger, acks, idempotent, retry.
- `src/brokers/kafka/engine/consume.ts` + test — fetch, position, `auto.offset.reset`.
- `src/brokers/kafka/engine/index.ts` + test — `createKafkaSimulation`, bảng reducer.

**Tạo mới — UI:**
- `src/brokers/kafka/ui/nodes.tsx` + test
- `src/brokers/kafka/ui/toFlow.ts` + test
- `src/brokers/kafka/ui/LogPanel.tsx` + test
- `src/brokers/kafka/ui/NodeConfig.tsx` + test
- `src/brokers/kafka/ui/issueText.ts` + test

**Tạo mới — lesson:**
- `src/brokers/kafka/lessons/types.ts` — `KafkaLesson`, node singleton.
- `src/brokers/kafka/lessons/registry.ts` — `LESSONS`, `KAFKA_LESSON_GROUPS`.
- `src/brokers/kafka/lessons/01-topic-partition.ts` … `10-ordering-retries.ts`
- `src/brokers/kafka/lessons/lessons.test.ts` — cross-lesson `it.each`.
- `src/brokers/kafka/lessons/basics.test.ts`, `producer.test.ts`

**Tạo mới — module:**
- `src/brokers/kafka/index.ts`

**Sửa:**
- `src/brokers/registry.ts`, `src/brokers/catalog.ts`, `README.md`

---

### Task 1: Type nền tảng và validate topology

**Files:**
- Create: `src/brokers/kafka/engine/types.ts`
- Create: `src/brokers/kafka/engine/validate.ts`
- Test: `src/brokers/kafka/engine/validate.test.ts`

**Interfaces:**
- Consumes: `KernelState`, `ValidationIssueBase`, `InFlight` từ `src/shell/kernel/types`.
- Produces: `NodeId`, `XY`, `KafkaTopology`, `KafkaBrokerSpec`, `KafkaTopicSpec`, `KafkaProducerSpec`, `KafkaConsumerSpec`, `LogEntry`, `PartitionState`, `ProducerRuntime`, `ConsumerRuntime`, `KafkaMetrics`, `KafkaState`, `KafkaEventType`, `KafkaScriptedCommand`, `KafkaFault`; `partitionKey(topic: string, index: number): string`; `sortedPartitionKeys(state: KafkaState): string[]`; `KafkaIssueCode`, `KafkaValidationIssue`, `validateKafkaTopology(topology: KafkaTopology, script: KafkaScriptedCommand[]): KafkaValidationIssue[]`.

- [ ] **Step 1: Viết test thất bại**

`src/brokers/kafka/engine/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateKafkaTopology } from './validate'
import type { KafkaTopology } from './types'

const base: KafkaTopology = {
  brokers: [
    { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
    { id: 'b2', label: 'Broker 2', position: { x: 0, y: 100 } },
  ],
  topics: [{ name: 'orders', partitions: 3, replicationFactor: 2 }],
  producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }],
  consumers: [{ id: 'c1', label: 'Consumer', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'] }],
  controllerBrokerId: 'b1',
}

const codes = (topology: KafkaTopology) => validateKafkaTopology(topology, []).map((i) => i.code)

describe('validateKafkaTopology', () => {
  it('topology hợp lệ không sinh issue nào', () => {
    expect(validateKafkaTopology(base, [])).toEqual([])
  })

  it('replicationFactor lớn hơn số broker là error', () => {
    const issues = validateKafkaTopology(
      { ...base, topics: [{ name: 'orders', partitions: 3, replicationFactor: 5 }] },
      [],
    )
    expect(issues[0]?.code).toBe('replication-factor-too-high')
    expect(issues[0]?.severity).toBe('error')
  })

  it('minInsyncReplicas lớn hơn replicationFactor là error', () => {
    expect(
      codes({
        ...base,
        topics: [{ name: 'orders', partitions: 3, replicationFactor: 2, config: { minInsyncReplicas: 3 } }],
      }),
    ).toContain('min-insync-too-high')
  })

  it('consumer subscribe topic không khai báo là error', () => {
    expect(
      codes({ ...base, consumers: [{ ...base.consumers[0]!, subscriptions: ['ghost'] }] }),
    ).toContain('unknown-topic')
  })

  it('producer có transactionalId nhưng không idempotent là error', () => {
    expect(
      codes({ ...base, producers: [{ ...base.producers[0]!, transactionalId: 'tx-1' }] }),
    ).toContain('transactional-not-idempotent')
  })

  it('controllerBrokerId không thuộc brokers là error', () => {
    expect(codes({ ...base, controllerBrokerId: 'b9' })).toContain('unknown-controller')
  })

  it('id trùng nhau giữa producer và consumer là error', () => {
    expect(
      codes({ ...base, consumers: [{ ...base.consumers[0]!, id: 'p1' }] }),
    ).toContain('duplicate-id')
  })

  it('nhiều consumer hơn partition trong cùng group chỉ là warning', () => {
    const issues = validateKafkaTopology(
      {
        ...base,
        topics: [{ name: 'orders', partitions: 1, replicationFactor: 2 }],
        consumers: [
          { id: 'c1', label: 'C1', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'] },
          { id: 'c2', label: 'C2', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'] },
        ],
      },
      [],
    )
    const idle = issues.find((i) => i.code === 'idle-consumers')
    expect(idle?.severity).toBe('warning')
  })

  it('topic không ai đọc chỉ là warning', () => {
    const issues = validateKafkaTopology({ ...base, consumers: [] }, [])
    expect(issues.find((i) => i.code === 'topic-unconsumed')?.severity).toBe('warning')
  })

  it('acks 0 cộng idempotent là warning vì hai ý định mâu thuẫn', () => {
    const issues = validateKafkaTopology(
      { ...base, producers: [{ ...base.producers[0]!, acks: 0, idempotent: true }] },
      [],
    )
    expect(issues.find((i) => i.code === 'acks-zero-idempotent')?.severity).toBe('warning')
  })

  it('script produce vào topic lạ là error', () => {
    const issues = validateKafkaTopology(base, [
      { at: 0, kind: 'produce', producerId: 'p1', topic: 'ghost', value: 'x' },
    ])
    expect(issues.map((i) => i.code)).toContain('unknown-topic')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/validate.test.ts`
Expected: FAIL — `Failed to resolve import "./validate"`.

- [ ] **Step 3: Viết `types.ts`**

Sao chép nguyên các interface ở spec §B2, §B3, §B4 vào `src/brokers/kafka/engine/types.ts`. Thêm ở cuối file:

```ts
/** Khoá của một partition trong `KafkaState.partitions`. Dạng chuỗi có tiền tố
 *  topic chứ không phải số: khoá số thuần trong một object JavaScript được lặp
 *  theo thứ tự số học, không theo thứ tự chèn, và engine này dựa vào thứ tự lặp
 *  ổn định để giữ determinism. */
export function partitionKey(topic: string, index: number): string {
  return `${topic}-${index}`
}

/**
 * Mọi vòng lặp trên `state.partitions` phải đi qua hàm này, không bao giờ lặp
 * thẳng `Object.keys`. Thứ tự lặp của một object là hợp đồng mong manh; một
 * mảng đã sort tường minh thì không.
 */
export function sortedPartitionKeys(state: KafkaState): string[] {
  return Object.keys(state.partitions).sort()
}

export type KafkaEventType =
  | 'produce-request'
  | 'batch-flush'
  | 'append'
  | 'produce-response'
  | 'produce-retry'
  | 'fetch-request'
  | 'deliver'
  | 'process-done'
  | 'commit'
  | 'segment-roll'
  | 'retention-delete'
  | 'consumer-join'
  | 'consumer-leave'
  | 'seek'
  | 'pause'
  | 'resume'
  | 'broker-down'
  | 'broker-up'
```

`KafkaEventType` sẽ được nối thêm ở plan sau (`heartbeat`, `join-group`, `sync-group`, `replica-fetch`, `isr-shrink`, `leader-election`, `txn-marker`, `compact-run`). Thêm vào union này là thay đổi mở rộng, không phá vỡ gì.

- [ ] **Step 4: Viết `validate.ts`**

```ts
import type { KafkaScriptedCommand, KafkaTopology } from './types'
import type { ValidationIssueBase } from '../../../shell/kernel/types'

export type KafkaIssueCode =
  | 'replication-factor-too-high'
  | 'min-insync-too-high'
  | 'unknown-topic'
  | 'transactional-not-idempotent'
  | 'unknown-controller'
  | 'duplicate-id'
  | 'unknown-producer'
  | 'unknown-consumer'
  | 'idle-consumers'
  | 'topic-unproduced'
  | 'topic-unconsumed'
  | 'acks-zero-idempotent'

export interface KafkaValidationIssue extends ValidationIssueBase {
  code: KafkaIssueCode
}

export function validateKafkaTopology(
  topology: KafkaTopology,
  script: KafkaScriptedCommand[],
): KafkaValidationIssue[] {
  const issues: KafkaValidationIssue[] = []
  const topicNames = new Set(topology.topics.map((t) => t.name))
  const brokerIds = new Set(topology.brokers.map((b) => b.id))

  // Id đụng nhau giữa ba loại node: canvas định danh node bằng id, nên hai node
  // trùng id là hai node không phân biệt được — vẽ đè lên nhau và click sai node.
  const seen = new Set<string>()
  for (const node of [...topology.brokers, ...topology.producers, ...topology.consumers]) {
    if (seen.has(node.id)) {
      issues.push({ code: 'duplicate-id', severity: 'error', nodeId: node.id, message: `id ${node.id}` })
    }
    seen.add(node.id)
  }

  if (!brokerIds.has(topology.controllerBrokerId)) {
    issues.push({
      code: 'unknown-controller',
      severity: 'error',
      message: topology.controllerBrokerId,
    })
  }

  for (const topic of topology.topics) {
    if (topic.replicationFactor > topology.brokers.length) {
      issues.push({
        code: 'replication-factor-too-high',
        severity: 'error',
        message: `${topic.name}: ${topic.replicationFactor} > ${topology.brokers.length}`,
      })
    }
    const minIsr = topic.config?.minInsyncReplicas
    if (minIsr !== undefined && minIsr > topic.replicationFactor) {
      issues.push({
        code: 'min-insync-too-high',
        severity: 'error',
        message: `${topic.name}: ${minIsr} > ${topic.replicationFactor}`,
      })
    }
    if (!topology.producers.length) continue
  }

  for (const producer of topology.producers) {
    if (producer.transactionalId && producer.idempotent !== true) {
      issues.push({
        code: 'transactional-not-idempotent',
        severity: 'error',
        nodeId: producer.id,
        message: producer.transactionalId,
      })
    }
    if (producer.acks === 0 && producer.idempotent) {
      issues.push({ code: 'acks-zero-idempotent', severity: 'warning', nodeId: producer.id, message: producer.id })
    }
  }

  for (const consumer of topology.consumers) {
    for (const subscription of consumer.subscriptions) {
      if (!topicNames.has(subscription)) {
        issues.push({ code: 'unknown-topic', severity: 'error', nodeId: consumer.id, message: subscription })
      }
    }
  }

  for (const command of script) {
    if (command.kind === 'produce') {
      if (!topicNames.has(command.topic)) {
        issues.push({ code: 'unknown-topic', severity: 'error', nodeId: command.producerId, message: command.topic })
      }
      if (!topology.producers.some((p) => p.id === command.producerId)) {
        issues.push({ code: 'unknown-producer', severity: 'error', message: command.producerId })
      }
    }
  }

  // Cảnh báo, không phải lỗi: một group nhiều consumer hơn partition vẫn chạy
  // đúng, chỉ là phần thừa nằm không — và đó chính là điều lesson 11 dạy, nên
  // nó phải dựng được chứ không bị chặn.
  const groups = new Map<string, { members: number; partitions: number }>()
  for (const consumer of topology.consumers) {
    const partitions = consumer.subscriptions.reduce(
      (sum, name) => sum + (topology.topics.find((t) => t.name === name)?.partitions ?? 0),
      0,
    )
    const entry = groups.get(consumer.groupId) ?? { members: 0, partitions }
    groups.set(consumer.groupId, { members: entry.members + 1, partitions: Math.max(entry.partitions, partitions) })
  }
  for (const [groupId, { members, partitions }] of [...groups.entries()].sort()) {
    if (members > partitions) {
      issues.push({
        code: 'idle-consumers',
        severity: 'warning',
        message: `${groupId}: ${members} consumer / ${partitions} partition`,
      })
    }
  }

  for (const topic of topology.topics) {
    if (!topology.consumers.some((c) => c.subscriptions.includes(topic.name))) {
      issues.push({ code: 'topic-unconsumed', severity: 'warning', message: topic.name })
    }
  }

  return issues
}
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/validate.test.ts && npm run typecheck`
Expected: PASS — 11 test.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/kafka/engine/types.ts src/brokers/kafka/engine/validate.ts src/brokers/kafka/engine/validate.test.ts
git commit -m "feat(kafka): topology types and validation"
```

---

### Task 2: `murmur2` và partitioner

**Files:**
- Create: `src/brokers/kafka/engine/murmur2.ts`
- Create: `src/brokers/kafka/engine/partitioner.ts`
- Test: `src/brokers/kafka/engine/murmur2.test.ts`, `src/brokers/kafka/engine/partitioner.test.ts`

**Interfaces:**
- Consumes: `RngState`, `nextInt` từ `src/shell/kernel/rng`; `KafkaProducerSpec` từ `./types`.
- Produces: `murmur2(data: string): number`; `toPositive(value: number): number`; `pickPartition(args: { key: string | null; partitionCount: number; partitioner: 'default' | 'round-robin' | 'sticky'; roundRobinCounter: number; stickyPartition?: number; rng: RngState }): { partition: number; nextRoundRobinCounter: number; nextSticky: number; rng: RngState }`.

- [ ] **Step 1: Viết test thất bại**

`src/brokers/kafka/engine/murmur2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { murmur2, toPositive } from './murmur2'

describe('murmur2', () => {
  // Đây là hàm hash thật của Kafka (`org.apache.kafka.common.utils.Utils.murmur2`,
  // seed 0x9747b28c). Bài 03 dạy "cùng key luôn về cùng partition" và người học
  // phải gõ lại được kết quả trên cluster thật, nên tính chất của nó là hợp đồng.
  it('luôn trả về một số nguyên 32-bit có dấu', () => {
    for (const key of ['', 'a', 'user-42', 'đơn-hàng-7', 'x'.repeat(129)]) {
      const value = murmur2(key)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBe(value | 0)
    }
  })

  it('xử lý đúng cả bốn nhánh phần dư của vòng lặp 4 byte', () => {
    // Độ dài 4/5/6/7 byte đi qua bốn nhánh `remainder` khác nhau. Một nhánh cài
    // sai chỉ lộ ra ở đúng độ dài của nó, nên phải chạm cả bốn.
    const values = ['abcd', 'abcde', 'abcdef', 'abcdefg'].map(murmur2)
    expect(new Set(values).size).toBe(4)
  })

  it('hash theo byte UTF-8, không theo mã UTF-16', () => {
    // Key có dấu tiếng Việt là loại key lesson này dùng. Hash theo UTF-16 sẽ cho
    // partition khác với broker thật, và bug đó chỉ lộ ra ở đúng những key này.
    const encoded = new TextEncoder().encode('đơn')
    expect(encoded.length).toBe(6)
    expect(murmur2('đơn')).not.toBe(murmur2('don'))
  })

  it('cùng đầu vào luôn ra cùng giá trị', () => {
    expect(murmur2('user-42')).toBe(murmur2('user-42'))
  })

  it('key khác nhau gần như luôn ra giá trị khác nhau', () => {
    expect(murmur2('user-42')).not.toBe(murmur2('user-43'))
  })

  it('toPositive xoá bit dấu, không dùng Math.abs', () => {
    // `Math.abs(Number.MIN_SAFE_INTEGER)` và `Math.abs(-2147483648)` trong 32 bit
    // đều trả về chính nó — Kafka dùng `& 0x7fffffff` chính vì lý do đó.
    expect(toPositive(-2147483648)).toBe(0)
    expect(toPositive(-1)).toBe(2147483647)
    expect(toPositive(5)).toBe(5)
  })
})
```

Các test này chốt **tính chất** của hàm hash chứ không chốt một con số cứng, vì không có nguồn nào trong repo để đối chiếu một vector Kafka thật. Nếu sau này bạn đối chiếu được với một cluster thật, thêm một test vector cố định — đó là bằng chứng mạnh hơn, nhưng không được thay thế bốn test tính chất ở trên.

`src/brokers/kafka/engine/partitioner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shell/kernel/rng'
import { pickPartition } from './partitioner'

const rng = createRng(1)

describe('pickPartition', () => {
  it('default: cùng key luôn về cùng partition', () => {
    const first = pickPartition({ key: 'user-42', partitionCount: 6, partitioner: 'default', roundRobinCounter: 0, rng })
    const second = pickPartition({ key: 'user-42', partitionCount: 6, partitioner: 'default', roundRobinCounter: 99, rng })
    expect(first.partition).toBe(second.partition)
  })

  it('default: partition luôn nằm trong khoảng hợp lệ', () => {
    for (const key of ['a', 'user-1', 'user-2', 'order-9999', 'đơn-hàng-7']) {
      const { partition } = pickPartition({ key, partitionCount: 3, partitioner: 'default', roundRobinCounter: 0, rng })
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(3)
    }
  })

  it('round-robin: key null rải đều lần lượt', () => {
    let counter = 0
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      const result = pickPartition({ key: null, partitionCount: 3, partitioner: 'round-robin', roundRobinCounter: counter, rng })
      seen.push(result.partition)
      counter = result.nextRoundRobinCounter
    }
    expect(seen).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('sticky: key null bám nguyên một partition cho tới khi được đổi', () => {
    const first = pickPartition({ key: null, partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0, rng })
    const second = pickPartition({
      key: null, partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0,
      stickyPartition: first.partition, rng: first.rng,
    })
    expect(second.partition).toBe(first.partition)
  })

  it('key có giá trị thì partitioner nào cũng hash, không rải đều', () => {
    const a = pickPartition({ key: 'k', partitionCount: 5, partitioner: 'round-robin', roundRobinCounter: 0, rng })
    const b = pickPartition({ key: 'k', partitionCount: 5, partitioner: 'sticky', roundRobinCounter: 3, rng })
    expect(a.partition).toBe(b.partition)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/murmur2.test.ts src/brokers/kafka/engine/partitioner.test.ts`
Expected: FAIL — hai module chưa tồn tại.

- [ ] **Step 3: Viết `murmur2.ts`**

```ts
/**
 * Bản port của `org.apache.kafka.common.utils.Utils.murmur2` — chính hàm mà
 * `DefaultPartitioner` của Kafka dùng để ánh xạ key sang partition. Cài đúng bản
 * này chứ không phải một hash bất kỳ là điều kiện để lesson 03 và 08 dạy được:
 * người học phải chạy lại được kết quả trên cluster thật.
 */
const SEED = 0x9747b28c
const M = 0x5bd1e995
const R = 24

/** Nhân hai số 32-bit mà không rơi khỏi khoảng chính xác của double. */
function multiply(a: number, b: number): number {
  return Math.imul(a, b) | 0
}

export function murmur2(data: string): number {
  // Kafka hash **byte** của key. Chuỗi ở đây là UTF-8 khi ra ngoài dây, nên phải
  // encode trước — hash theo mã UTF-16 sẽ lệch với broker thật ở mọi key có dấu
  // tiếng Việt, đúng loại key lesson này dùng.
  const bytes = new TextEncoder().encode(data)
  const length = bytes.length
  let h = (SEED ^ length) | 0
  const remainder = length & 3
  const aligned = length - remainder

  for (let i = 0; i < aligned; i += 4) {
    let k =
      (bytes[i]! & 0xff) |
      ((bytes[i + 1]! & 0xff) << 8) |
      ((bytes[i + 2]! & 0xff) << 16) |
      ((bytes[i + 3]! & 0xff) << 24)
    k = multiply(k, M)
    k ^= k >>> R
    k = multiply(k, M)
    h = multiply(h, M)
    h = (h ^ k) | 0
  }

  if (remainder === 3) h = (h ^ ((bytes[aligned + 2]! & 0xff) << 16)) | 0
  if (remainder >= 2) h = (h ^ ((bytes[aligned + 1]! & 0xff) << 8)) | 0
  if (remainder >= 1) {
    h = (h ^ (bytes[aligned]! & 0xff)) | 0
    h = multiply(h, M)
  }

  h ^= h >>> 13
  h = multiply(h, M)
  h ^= h >>> 15
  return h | 0
}

/**
 * Kafka dùng `& 0x7fffffff` chứ không phải `Math.abs`: với số 32-bit,
 * `Math.abs(-2147483648)` tràn về chính nó và cho ra partition âm.
 */
export function toPositive(value: number): number {
  return value & 0x7fffffff
}
```

- [ ] **Step 4: Viết `partitioner.ts`**

```ts
import { murmur2, toPositive } from './murmur2'
import { nextInt, type RngState } from '../../../shell/kernel/rng'

export interface PickPartitionArgs {
  key: string | null
  partitionCount: number
  partitioner: 'default' | 'round-robin' | 'sticky'
  roundRobinCounter: number
  stickyPartition?: number
  rng: RngState
}

export interface PickPartitionResult {
  partition: number
  nextRoundRobinCounter: number
  nextSticky: number
  rng: RngState
}

export function pickPartition(args: PickPartitionArgs): PickPartitionResult {
  const { key, partitionCount, partitioner, roundRobinCounter, stickyPartition, rng } = args

  // Key có giá trị thì mọi partitioner đều hash — đó là bảo đảm thứ tự của Kafka:
  // cùng key về cùng partition, và trong một partition thứ tự là tuyệt đối.
  // Partitioner chỉ quyết định số phận của record **không có key**.
  if (key !== null) {
    return {
      partition: toPositive(murmur2(key)) % partitionCount,
      nextRoundRobinCounter: roundRobinCounter,
      nextSticky: stickyPartition ?? 0,
      rng,
    }
  }

  if (partitioner === 'round-robin') {
    return {
      partition: roundRobinCounter % partitionCount,
      nextRoundRobinCounter: roundRobinCounter + 1,
      nextSticky: stickyPartition ?? 0,
      rng,
    }
  }

  if (partitioner === 'sticky' && stickyPartition !== undefined) {
    return { partition: stickyPartition, nextRoundRobinCounter: roundRobinCounter, nextSticky: stickyPartition, rng }
  }

  // Chưa có sticky partition nào (batch đầu, hoặc batch trước vừa đóng): chọn
  // một partition qua RNG thuần của kernel. `nextInt` trả `[value, nextState]`,
  // không giữ state ẩn — đó là điều kiện để cùng seed luôn cho cùng journal.
  const [picked, nextRng] = nextInt(rng, partitionCount)
  return { partition: picked, nextRoundRobinCounter: roundRobinCounter, nextSticky: picked, rng: nextRng }
}
```

Nếu chữ ký `nextInt` trong `src/shell/kernel/rng.ts` khác (`nextInt(rng, min, max)` chẳng hạn), dùng đúng chữ ký thật — đọc file đó trước, đừng đoán.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/murmur2.test.ts src/brokers/kafka/engine/partitioner.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/kafka/engine/murmur2.ts src/brokers/kafka/engine/murmur2.test.ts src/brokers/kafka/engine/partitioner.ts src/brokers/kafka/engine/partitioner.test.ts
git commit -m "feat(kafka): murmur2 hash and partition selection"
```

---

### Task 3: Log per-partition và segment/retention

**Files:**
- Create: `src/brokers/kafka/engine/log.ts`
- Create: `src/brokers/kafka/engine/segments.ts`
- Test: `src/brokers/kafka/engine/log.test.ts`, `src/brokers/kafka/engine/segments.test.ts`

**Interfaces:**
- Consumes: `LogEntry`, `PartitionState`, `KafkaTopicSpec` từ `./types`.
- Produces:
  - `log.ts`: `createPartition(args: { topic: string; index: number; leader: NodeId; replicas: NodeId[] }): PartitionState`; `appendRecord(partition: PartitionState, record: Omit<LogEntry, 'offset'>): { partition: PartitionState; offset: number }`; `readFrom(partition: PartitionState, offset: number, maxRecords: number): LogEntry[]`; `recomputeHighWatermark(partition: PartitionState): PartitionState`; `estimateBytes(key: string | null, value: string | null): number`.
  - `segments.ts`: `rollSegments(partition: PartitionState, config: KafkaTopicSpec['config'], now: number): PartitionState`; `applyRetention(partition: PartitionState, config: KafkaTopicSpec['config'], now: number): { partition: PartitionState; removed: number }`.

- [ ] **Step 1: Viết test thất bại**

`src/brokers/kafka/engine/log.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appendRecord, createPartition, readFrom, recomputeHighWatermark } from './log'

const empty = () => createPartition({ topic: 'orders', index: 0, leader: 'b1', replicas: ['b1', 'b2'] })

const push = (p: ReturnType<typeof empty>, value: string) =>
  appendRecord(p, { key: null, value, timestamp: 0, bytes: 10 }).partition

describe('log', () => {
  it('partition mới rỗng: mọi offset bằng 0', () => {
    const p = empty()
    expect(p.leo).toBe(0)
    expect(p.logStartOffset).toBe(0)
    expect(p.highWatermark).toBe(0)
    expect(p.log).toEqual([])
  })

  it('offset cấp tăng dần từ 0 và không bao giờ dùng lại', () => {
    let p = empty()
    const a = appendRecord(p, { key: null, value: 'a', timestamp: 0, bytes: 10 })
    p = a.partition
    const b = appendRecord(p, { key: null, value: 'b', timestamp: 1, bytes: 10 })
    expect(a.offset).toBe(0)
    expect(b.offset).toBe(1)
    expect(b.partition.leo).toBe(2)
  })

  it('append không sửa partition cũ — reducer phải thuần', () => {
    const before = empty()
    appendRecord(before, { key: null, value: 'a', timestamp: 0, bytes: 10 })
    expect(before.log).toHaveLength(0)
    expect(before.leo).toBe(0)
  })

  it('readFrom trả đúng số record tối đa, bắt đầu từ offset yêu cầu', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c', 'd']) p = push(p, v)
    expect(readFrom(p, 1, 2).map((r) => r.value)).toEqual(['b', 'c'])
  })

  it('readFrom không bao giờ trả record vượt quá high watermark', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c']) p = push(p, v)
    // Chưa replica nào bắt kịp: HW vẫn 0, nên consumer không thấy gì. Đây chính
    // là lý do một record vừa ghi xong vẫn "chưa đọc được" trên Kafka thật.
    expect(readFrom({ ...p, highWatermark: 0 }, 0, 10)).toEqual([])
    expect(readFrom({ ...p, highWatermark: 2 }, 0, 10)).toHaveLength(2)
  })

  it('high watermark là LEO nhỏ nhất trong ISR, không phải của leader', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c']) p = push(p, v)
    p = {
      ...p,
      isr: ['b1', 'b2'],
      replicaState: { b1: { leo: 3, lastFetchAt: 0 }, b2: { leo: 1, lastFetchAt: 0 } },
    }
    expect(recomputeHighWatermark(p).highWatermark).toBe(1)
  })

  it('replica ngoài ISR không kéo tụt high watermark', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c']) p = push(p, v)
    p = {
      ...p,
      isr: ['b1'],
      replicaState: { b1: { leo: 3, lastFetchAt: 0 }, b2: { leo: 0, lastFetchAt: 0 } },
    }
    expect(recomputeHighWatermark(p).highWatermark).toBe(3)
  })
})
```

`src/brokers/kafka/engine/segments.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appendRecord, createPartition } from './log'
import { applyRetention, rollSegments } from './segments'

function withRecords(count: number, bytes: number) {
  let p = createPartition({ topic: 'orders', index: 0, leader: 'b1', replicas: ['b1'] })
  for (let i = 0; i < count; i++) {
    p = appendRecord(p, { key: null, value: `v${i}`, timestamp: i * 1000, bytes }).partition
  }
  return p
}

describe('segments', () => {
  it('segment đang mở đóng lại khi vượt segment.bytes', () => {
    const p = rollSegments(withRecords(5, 100), { segmentBytes: 250 }, 5000)
    expect(p.segments.filter((s) => s.sealed).length).toBeGreaterThanOrEqual(1)
    expect(p.segments.at(-1)?.sealed).toBe(false)
  })

  it('retention.ms xoá segment đã đóng và đủ già, kéo logStartOffset lên', () => {
    let p = rollSegments(withRecords(6, 100), { segmentBytes: 200 }, 6000)
    const result = applyRetention(p, { segmentBytes: 200, retentionMs: 2000 }, 10_000)
    expect(result.partition.logStartOffset).toBeGreaterThan(0)
    expect(result.removed).toBeGreaterThan(0)
    expect(result.partition.log[0]?.offset).toBe(result.partition.logStartOffset)
  })

  it('retention không bao giờ xoá segment đang mở — record vừa ghi luôn còn đó', () => {
    const p = rollSegments(withRecords(3, 10), { segmentBytes: 10_000 }, 3000)
    const result = applyRetention(p, { segmentBytes: 10_000, retentionMs: 1 }, 1_000_000)
    expect(result.partition.log).toHaveLength(3)
    expect(result.removed).toBe(0)
  })

  it('không cấu hình retention thì không xoá gì', () => {
    const p = withRecords(4, 10)
    expect(applyRetention(p, undefined, 999_999).removed).toBe(0)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/log.test.ts src/brokers/kafka/engine/segments.test.ts`
Expected: FAIL — hai module chưa tồn tại.

- [ ] **Step 3: Viết `log.ts`**

Điểm bắt buộc phải đúng:

- `appendRecord` trả về `PartitionState` **mới** (spread), không mutate. Test "append không sửa partition cũ" chốt điều này.
- `readFrom(partition, offset, maxRecords)` chỉ trả record có `offset >= yêu cầu` **và** `offset < highWatermark`. Đây là bảo đảm cốt lõi của Kafka và là lý do lesson 17 tồn tại.
- `recomputeHighWatermark` = `min(replicaState[b].leo)` trên các `b` thuộc `isr`. ISR rỗng thì giữ nguyên `highWatermark` cũ (không tụt).
- `estimateBytes(key, value)` = `(key?.length ?? 0) + (value?.length ?? 0) + 40` — 40 byte overhead xấp xỉ header của record batch. Số này chỉ cần **ổn định**, không cần đúng tuyệt đối: nó chỉ dùng cho `segment.bytes` và `retention.bytes`.
- `createPartition` khởi tạo `segments: [{ baseOffset: 0, bytes: 0, createdAt: 0, sealed: false }]`, `isr` bằng `replicas`, `replicaState` mỗi replica `{ leo: 0, lastFetchAt: 0 }`, `leaderEpoch: 0`, `lastStableOffset: 0`.

- [ ] **Step 4: Viết `segments.ts`**

- `rollSegments`: cộng `bytes` của record mới vào segment đang mở (`sealed: false`); nếu vượt `segmentBytes`, hoặc `now - createdAt >= segmentMs`, thì đánh dấu `sealed: true` và mở segment mới có `baseOffset = partition.leo`.
- `applyRetention`: chỉ xét segment `sealed`. Xoá segment khi `now - createdAt > retentionMs`, hoặc khi tổng `bytes` của log vượt `retentionBytes` (xoá từ segment cũ nhất cho tới khi vừa). Sau khi xoá, `logStartOffset` = `baseOffset` của segment còn lại đầu tiên, và cắt `log` bỏ mọi record có `offset < logStartOffset`. Trả `removed` = số record bị xoá.
- Không cấu hình gì thì trả nguyên partition và `removed: 0`.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/log.test.ts src/brokers/kafka/engine/segments.test.ts`
Expected: PASS — 7 + 4 test.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/kafka/engine/log.ts src/brokers/kafka/engine/log.test.ts src/brokers/kafka/engine/segments.ts src/brokers/kafka/engine/segments.test.ts
git commit -m "feat(kafka): partition log, segments and retention"
```

---

### Task 4: `produce.ts` — batching, linger, acks

**Files:**
- Create: `src/brokers/kafka/engine/produce.ts`
- Test: `src/brokers/kafka/engine/produce.test.ts`

**Interfaces:**
- Consumes: `appendRecord`, `estimateBytes`, `recomputeHighWatermark` (Task 3); `pickPartition` (Task 2).
- Produces: `enqueueRecord(state, args): { state; newEvents }`; `flushBatch(state, args): { state; newEvents }`; `resolveAcks(state, args): { satisfied: boolean; error?: 'NOT_ENOUGH_REPLICAS' }`. Chữ ký chi tiết trong Step 3.

- [ ] **Step 1: Viết test thất bại**

`src/brokers/kafka/engine/produce.test.ts` — dùng một helper `testState.ts` nhỏ dựng `KafkaState` từ một topology, theo đúng mẫu `src/brokers/redis/engine/testState.ts`. Các khẳng định bắt buộc:

```ts
describe('produce', () => {
  it('record chưa đủ batch.size thì nằm trong batch, chưa vào log', () => { /* leo vẫn 0, batch có 1 record */ })

  it('batch flush khi đủ batch.size, không cần chờ linger', () => { /* flush event sinh ra ở đúng `at` của record cuối */ })

  it('batch flush khi hết linger.ms dù chưa đủ batch.size', () => { /* flush ở openedAt + lingerMs */ })

  it('lingerMs = 0 thì mỗi record là một batch — độ trễ thấp nhất, throughput thấp nhất', () => {})

  it('acks=0 coi như thành công ngay, kể cả khi leader offline', () => {})

  it('acks=1 thành công khi leader append xong, không chờ follower', () => {})

  it('acks=all chờ mọi replica trong ISR bắt kịp', () => {})

  it('acks=all lỗi NOT_ENOUGH_REPLICAS khi ISR nhỏ hơn min.insync.replicas', () => {})

  it('record có key luôn vào đúng partition murmur2 chỉ ra, kể cả khi qua batch', () => {})

  it('metrics.recordsProduced chỉ tăng khi record thực sự vào log', () => {})
})
```

Viết đủ thân từng test — dựng state, gọi hàm, khẳng định `leo`/`metrics`/`newEvents`.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/produce.test.ts`
Expected: FAIL — `./produce` chưa tồn tại.

- [ ] **Step 3: Viết `produce.ts`**

```ts
export interface EnqueueArgs {
  producer: KafkaProducerSpec
  topic: KafkaTopicSpec
  key: string | null
  value: string | null
  headers?: Record<string, string>
  /** Partition chỉ định tường minh trong script — bỏ qua partitioner hoàn toàn. */
  partition?: number
  at: number
}

/**
 * Đưa một record vào batch accumulator của producer. Trả về event `batch-flush`
 * mới **chỉ khi** batch vừa được mở: một batch chỉ cần đúng một hẹn giờ flush,
 * và hẹn thêm lần nữa cho record thứ hai sẽ flush cùng batch đó hai lần.
 */
export function enqueueRecord(
  state: KafkaState,
  args: EnqueueArgs,
): { state: KafkaState; newEvents: SimEvent<KafkaEventType>[] }
```

Quy tắc cài đặt:

1. Chọn partition: `args.partition` nếu có, ngược lại `pickPartition` với `producer.partitioner ?? 'default'`. Cập nhật `roundRobinCounter`/`stickyPartition`/`rng` trên `ProducerRuntime`.
2. Cộng record vào `runtime.batches[partitionKey]`. Nếu batch chưa tồn tại, tạo với `openedAt: args.at` và sinh event `batch-flush` ở `args.at + (producer.lingerMs ?? 0)`.
3. Nếu `bytes` sau khi cộng `>= producer.batchSize`, sinh thêm event `batch-flush` ngay tại `args.at`. `flushBatch` phải chịu được việc bị gọi hai lần cho cùng một batch — lần thứ hai thấy batch rỗng thì không làm gì. Đây là cách rẻ nhất để cả hai điều kiện flush cùng hoạt động mà không cần huỷ hẹn giờ, và kernel không có cơ chế huỷ event.
4. `flushBatch` với `acks=0`: append vào log, ghi journal, `metrics.recordsProduced += n`, không sinh `produce-response`.
5. `acks=1`: append rồi sinh `produce-response` ở `at + travel`.
6. `acks='all'`: kiểm `isr.length >= (topic.config?.minInsyncReplicas ?? 1)`. Không đủ thì **không append**, sinh `produce-response` mang `error: 'NOT_ENOUGH_REPLICAS'`. Đủ thì append và chờ HW vượt qua offset vừa ghi mới trả response — ở plan này chưa có replication nên `replicaState` của mọi replica được coi là bắt kịp ngay; plan sau thay phần đó bằng follower fetch thật, và test ở đây phải vẫn xanh.
7. Leader offline (`state.brokersOnline[partition.leader] === false`): `acks=0` vẫn coi là gửi xong (mất im lặng — chính là điều bài 06 dạy), `acks>=1` trả `error: 'LEADER_NOT_AVAILABLE'`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/produce.test.ts`
Expected: PASS — 10 test.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/produce.ts src/brokers/kafka/engine/produce.test.ts src/brokers/kafka/engine/testState.ts
git commit -m "feat(kafka): producer batching, linger and acks"
```

---

### Task 5: `consume.ts` — fetch, position, `auto.offset.reset`

**Files:**
- Create: `src/brokers/kafka/engine/consume.ts`
- Test: `src/brokers/kafka/engine/consume.test.ts`

**Interfaces:**
- Consumes: `readFrom` (Task 3).
- Produces: `resolvePosition(args: { position?: number; logStartOffset: number; highWatermark: number; autoOffsetReset: 'earliest' | 'latest' }): number`; `fetchRecords(state, args): { state; records: LogEntry[]; newEvents }`; `applyPause(state, args)`, `applyResume(state, args)`, `applySeek(state, args)`.

- [ ] **Step 1: Viết test thất bại**

Khẳng định bắt buộc:

```ts
describe('consume', () => {
  it('consumer chưa có position, auto.offset.reset=earliest thì bắt đầu từ logStartOffset', () => {})
  it('consumer chưa có position, auto.offset.reset=latest thì bắt đầu từ high watermark — bỏ qua mọi record cũ', () => {})
  it('position rơi dưới logStartOffset (retention đã xoá) thì reset theo auto.offset.reset', () => {})
  it('fetch trả tối đa maxPollRecords record một lần', () => {})
  it('fetch không bao giờ vượt quá high watermark', () => {})
  it('partition đang pause thì không fetch, partition khác vẫn chạy', () => {})
  it('seek đặt lại position, lần fetch sau đọc từ đúng chỗ đó', () => {})
  it('seek tới "earliest"/"latest" phân giải qua đúng logStartOffset/highWatermark', () => {})
  it('fetch xong sinh event process-done ở at + processingMs', () => {})
  it('metrics.recordsConsumed tăng đúng bằng số record giao đi', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/consume.test.ts`
Expected: FAIL — `./consume` chưa tồn tại.

- [ ] **Step 3: Viết `consume.ts`**

`resolvePosition` là hàm thuần nhỏ nhưng quan trọng nhất ở đây:

```ts
/**
 * `auto.offset.reset` chỉ có tác dụng khi consumer **không có** position hợp lệ:
 * lần đầu vào group, hoặc position đã rơi dưới `logStartOffset` vì retention xoá
 * mất đoạn đó. Nó không phải "đọc từ đâu mỗi lần poll" — hiểu nhầm đó là lý do
 * lesson 05 tồn tại.
 */
export function resolvePosition(args: {
  position?: number
  logStartOffset: number
  highWatermark: number
  autoOffsetReset: 'earliest' | 'latest'
}): number {
  const { position, logStartOffset, highWatermark, autoOffsetReset } = args
  if (position !== undefined && position >= logStartOffset) return position
  return autoOffsetReset === 'earliest' ? logStartOffset : highWatermark
}
```

`fetchRecords` đọc `readFrom(partition, position, maxPollRecords)`, cập nhật `position += records.length`, cộng `metrics.recordsConsumed`, và sinh `process-done` ở `at + (consumer.processingMs ?? 0)`. Partition trong `runtime.paused` bị bỏ qua. Vòng lặp trên partition đi qua `sortedPartitionKeys`, không lặp thẳng object.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/consume.test.ts`
Expected: PASS — 10 test.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/consume.ts src/brokers/kafka/engine/consume.test.ts
git commit -m "feat(kafka): consumer fetch, position and auto.offset.reset"
```

---

### Task 6: `createKafkaSimulation` — nối vào kernel

**Files:**
- Create: `src/brokers/kafka/engine/index.ts`
- Test: `src/brokers/kafka/engine/index.test.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 1–5; `createKernel`, `Simulation` từ `src/shell/kernel/run`; `createRng` từ `src/shell/kernel/rng`.
- Produces: `createKafkaSimulation(options: KafkaSimulationOptions): Simulation<KafkaState> & { readonly issues: KafkaValidationIssue[] }`; `RECORD_TRAVEL_MS`; re-export mọi type từ `./types` và `./validate`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('createKafkaSimulation', () => {
  it('cùng seed cho journal giống hệt nhau tới từng byte', () => {
    const run = () => { const s = createKafkaSimulation(options); s.advanceTo(20_000); return s.snapshot().journal }
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })

  it('topology có issue mức error thì kernel không dispatch event nào', () => {
    const sim = createKafkaSimulation({ ...options, topology: badTopology })
    sim.advanceTo(20_000)
    expect(sim.snapshot().journal).toEqual([])
    expect(sim.issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('reset rồi advanceTo cùng mốc cho đúng state cũ — rewind là reset + replay', () => {})

  it('không mutate topology đầu vào', () => {
    const topology = deepFreeze(makeTopology())
    const sim = createKafkaSimulation({ ...options, topology })
    expect(() => sim.advanceTo(20_000)).not.toThrow()
  })

  it('vòng lặp trên partition đi theo thứ tự sort, không theo thứ tự chèn', () => {
    // Dựng topic có partition được chèn lộn xộn, khẳng định journal xếp theo
    // `orders-0`, `orders-1`, `orders-2`.
  })

  it('nextEventTime trả về mốc event kế tiếp, undefined khi hết', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết `index.ts`**

Theo đúng khuôn `src/brokers/redis/engine/index.ts`:

- `createState()` dựng `partitions` từ `topology.topics` (mỗi topic × mỗi partition, leader rải vòng tròn qua `topology.brokers`, `replicas` là `replicationFactor` broker liên tiếp bắt đầu từ leader), `producers`/`consumers` runtime rỗng, `brokersOnline` tất cả `true`, `metrics` tất cả `0`, `rng: createRng(seed)`, `journal: []`, `now: 0`, `seq: 0`.
- `seedEvents()` biến mỗi `KafkaScriptedCommand` thành một `SimEvent` cùng `at`, cộng các event từ `failures`.
- `reducers` là một `Record<KafkaEventType, Reducer>` đầy đủ — TypeScript sẽ báo lỗi nếu thiếu một nhánh, đó là mục đích của union `KafkaEventType`.
- Payload lấy ra qua các hàm `asString`/`asNumber` kiểu type guard **chứ không phải `as`** — sao chép đúng cách Redis làm (`src/brokers/redis/engine/index.ts` phần "Payload extraction") và giữ nguyên tinh thần comment ở đó.
- `fatal: issues.some((i) => i.severity === 'error')`.
- `RECORD_TRAVEL_MS = 120` — thời gian ảo một record bay trên một cạnh canvas, dùng cho `inFlight`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/ && npm run typecheck`
Expected: PASS toàn bộ thư mục engine.

- [ ] **Step 5: Chạy purity test**

Run: `npx vitest run src/shell/kernel/purity.test.ts`
Expected: PASS — nó tự phát hiện `src/brokers/kafka/engine/` và quét. Đỏ nghĩa là có `Math.random`/`Date.now`/timer/import cấm lọt vào; sửa engine, không sửa test.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/kafka/engine/index.ts src/brokers/kafka/engine/index.test.ts
git commit -m "feat(kafka): wire engine into the shared kernel"
```

---

### Task 7: Canvas — `nodes.tsx` và `toFlow.ts`

**Files:**
- Create: `src/brokers/kafka/ui/nodes.tsx`
- Create: `src/brokers/kafka/ui/toFlow.ts`
- Test: `src/brokers/kafka/ui/nodes.test.tsx`, `src/brokers/kafka/ui/toFlow.test.ts`

**Interfaces:**
- Consumes: `KafkaState`, `KafkaTopology`, `sortedPartitionKeys` (Task 1).
- Produces: `ProducerNode`, `BrokerNode`, `PartitionNode`, `ConsumerNode`, `ConsumerGroupNode` (component React Flow); `toFlowNodes(topology, state, highlight?): Node[]`; `toFlowEdges(topology): Edge[]`.

- [ ] **Step 1: Viết test thất bại**

`toFlow.test.ts` khẳng định:

```ts
it('mỗi partition là một node con của broker đang làm leader', () => {
  const nodes = toFlowNodes(topology, state)
  const p0 = nodes.find((n) => n.id === 'orders-0')
  expect(p0?.type).toBe('partition')
  expect(p0?.parentId).toBe(state.partitions['orders-0']!.leader)
})

it('node partition xếp theo thứ tự sort, không theo thứ tự chèn', () => {
  const ids = toFlowNodes(topology, state).filter((n) => n.type === 'partition').map((n) => n.id)
  expect(ids).toEqual([...ids].sort())
})

it('consumer là node con của consumer group của nó', () => {})

it('edge producer nối tới từng partition của topic nó ghi', () => {})

it('edge consumer chỉ nối tới partition đang được giao cho nó', () => {})

it('highlight đánh dấu đúng node được nêu tên, không đánh dấu node khác', () => {})

it('toFlowEdges chỉ phụ thuộc topology — gọi hai lần với cùng topology cho cùng kết quả', () => {})
```

`nodes.test.tsx` khẳng định: `PartitionNode` hiện `leo`, `highWatermark` và badge ISR; `BrokerNode` hiện trạng thái offline; `ConsumerNode` hiện lag; mọi node có nhãn tự do đều mang class `truncate` và `max-w-[200px]` (ràng buộc từ plan responsive).

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/ui/`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `nodes.tsx` và `toFlow.ts`**

`toFlowNodes` sinh, theo đúng thứ tự này:
1. `broker` node cho mỗi `topology.brokers` (React Flow yêu cầu node cha đứng **trước** node con trong mảng, nếu không con sẽ không định vị được).
2. `partition` node cho mỗi khoá trong `sortedPartitionKeys(state)`, với `parentId` là leader và `extent: 'parent'`.
3. `consumerGroup` node cho mỗi `groupId` khác nhau.
4. `consumer` node với `parentId` là group của nó.
5. `producer` node.

`toFlowEdges(topology)` chỉ nhận topology — hợp đồng `BrokerModule.toEdges` cho phép nhận cả script, nhưng Kafka không cần: producer nối tới mọi partition của topic nó ghi, consumer nối tới mọi partition của topic nó subscribe. Cạnh nào đang "sống" là việc của `inFlight`, không phải của edge. Ghi comment nêu rõ điều này, theo mẫu comment `toEdges` trong `src/brokers/redis/index.ts`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/ui/nodes.test.tsx src/brokers/kafka/ui/toFlow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/ui/nodes.tsx src/brokers/kafka/ui/nodes.test.tsx src/brokers/kafka/ui/toFlow.ts src/brokers/kafka/ui/toFlow.test.ts
git commit -m "feat(kafka): canvas nodes and flow mapping"
```

---

### Task 8: `LogPanel`, `NodeConfig`, `issueText`

**Files:**
- Create: `src/brokers/kafka/ui/LogPanel.tsx`
- Create: `src/brokers/kafka/ui/NodeConfig.tsx`
- Create: `src/brokers/kafka/ui/issueText.ts`
- Test: `.test.tsx` / `.test.ts` kề bên từng file

**Interfaces:**
- Consumes: `KafkaState`, `KafkaValidationIssue`, `KafkaLesson`.
- Produces: `LogPanel({ state, dense }: { state: KafkaState; dense?: boolean })`; `NodeConfig({ lesson, state, nodeId })`; `issueText(issue: KafkaValidationIssue): string`.

- [ ] **Step 1: Viết test thất bại**

`LogPanel.test.tsx`:

```tsx
it('hiện mọi partition kèm offset, đánh dấu HW và LEO', () => {})
it('record dưới logStartOffset hiện mờ — đã bị retention xoá', () => {})
it('dense siết chiều cao lại cho màn hình nhỏ', () => {
  const { rerender } = render(<LogPanel state={state} />)
  expect(screen.getByTestId('log-panel').className).toContain('max-h-32')
  rerender(<LogPanel state={state} dense />)
  expect(screen.getByTestId('log-panel').className).toContain('max-h-24')
})
it('tab Group liệt kê member, assignment và lag', () => {})
it('lưới thuộc tính xuống một cột ở màn hẹp', () => {
  // grid-cols-1 sm:grid-cols-2 — ràng buộc từ plan responsive
})
```

`issueText.test.ts` khẳng định mọi `KafkaIssueCode` đều có một câu tiếng Việt riêng, và không code nào rơi vào nhánh mặc định:

```ts
it('mọi mã issue đều có câu tiếng Việt riêng', () => {
  const codes: KafkaIssueCode[] = [
    'replication-factor-too-high', 'min-insync-too-high', 'unknown-topic',
    'transactional-not-idempotent', 'unknown-controller', 'duplicate-id',
    'unknown-producer', 'unknown-consumer', 'idle-consumers',
    'topic-unproduced', 'topic-unconsumed', 'acks-zero-idempotent',
  ]
  const texts = codes.map((code) => issueText({ code, severity: 'error', message: 'x' }))
  expect(new Set(texts).size).toBe(codes.length)
  for (const text of texts) expect(text).toMatch(/[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i)
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/ui/`
Expected: FAIL.

- [ ] **Step 3: Viết ba file**

`issueText` là `switch` trên `issue.code` trả câu tiếng Việt, giữ nguyên thuật ngữ Kafka trong backtick. Ví dụ:

```ts
    case 'replication-factor-too-high':
      return `\`replicationFactor\` lớn hơn số broker đang có (${issue.message}) — không đủ broker để giữ đủ bản sao.`
    case 'idle-consumers':
      return `Group có nhiều consumer hơn partition (${issue.message}), phần thừa sẽ nằm không.`
```

`LogPanel` dùng `sortedPartitionKeys` để lặp. `NodeConfig` phân nhánh theo loại node tìm được từ `nodeId` (producer / broker / partition / consumer), mỗi nhánh một `<dl className="grid grid-cols-1 gap-x-2 gap-y-1 sm:grid-cols-2 ...">`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/ui/`
Expected: PASS toàn bộ thư mục `ui`.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/ui/
git commit -m "feat(kafka): log panel, node config and Vietnamese issue text"
```

---

### Task 9: Đăng ký broker và lesson 01

**Files:**
- Create: `src/brokers/kafka/lessons/types.ts`
- Create: `src/brokers/kafka/lessons/registry.ts`
- Create: `src/brokers/kafka/lessons/01-topic-partition.ts`
- Create: `src/brokers/kafka/lessons/lessons.test.ts`
- Create: `src/brokers/kafka/index.ts`
- Modify: `src/brokers/registry.ts`, `src/brokers/catalog.ts`

**Interfaces:**
- Consumes: mọi thứ ở Task 1–8.
- Produces: `KafkaLessonGroup`, `KafkaLesson`, node singleton `BROKER_1`/`BROKER_2`/`BROKER_3`/`PRODUCER`/`CONSUMER_A`/`CONSUMER_B`/`CONSUMER_C`; `KAFKA_LESSON_GROUPS`, `LESSONS`; `kafka: BrokerModule<KafkaState, KafkaTopology, KafkaScriptedCommand, KafkaValidationIssue>`.

- [ ] **Step 1: Viết `lessons.test.ts` (thất bại)**

Sao chép cấu trúc từ `src/brokers/redis/lessons/lessons.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, validateKafkaTopology } from '../engine'
import { KAFKA_LESSON_GROUPS, LESSONS } from './registry'

describe('mọi lesson Kafka', () => {
  it('có ít nhất một lesson', () => {
    expect(LESSONS.length).toBeGreaterThan(0)
  })

  it('id không trùng nhau', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: topology không có issue mức error', (_id, lesson) => {
    const errors = validateKafkaTopology(lesson.topology, lesson.script).filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: chạy xác định', (_id, lesson) => {
    const run = () => {
      const sim = createKafkaSimulation({
        topology: lesson.topology, script: lesson.script, seed: lesson.seed, failures: lesson.failures,
      })
      sim.advanceTo(lesson.durationMs + 5000)
      return JSON.stringify(sim.snapshot().journal)
    }
    expect(run()).toBe(run())
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: group đã khai báo trong registry', (_id, lesson) => {
    expect(KAFKA_LESSON_GROUPS.map((g) => g.id)).toContain(lesson.group)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: narrative xếp theo thời gian tăng dần', (_id, lesson) => {
    const times = lesson.narrative.map((s) => s.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: mọi mốc narrative nằm trong durationMs', (_id, lesson) => {
    for (const step of lesson.narrative) expect(step.at).toBeLessThanOrEqual(lesson.durationMs)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: mọi node được highlight đều tồn tại', (_id, lesson) => {
    const ids = new Set([
      ...lesson.topology.brokers.map((b) => b.id),
      ...lesson.topology.producers.map((p) => p.id),
      ...lesson.topology.consumers.map((c) => c.id),
      ...lesson.topology.topics.flatMap((t) =>
        Array.from({ length: t.partitions }, (_, i) => `${t.name}-${i}`),
      ),
    ])
    for (const step of lesson.narrative) {
      for (const nodeId of step.highlight ?? []) expect(ids).toContain(nodeId)
    }
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: không run nào bị halt', (_id, lesson) => {
    const sim = createKafkaSimulation({
      topology: lesson.topology, script: lesson.script, seed: lesson.seed, failures: lesson.failures,
    })
    sim.advanceTo(lesson.durationMs + 5000)
    expect(sim.snapshot().halted).toBeUndefined()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/lessons/lessons.test.ts`
Expected: FAIL — `./registry` chưa tồn tại.

- [ ] **Step 3: Viết `lessons/types.ts`**

```ts
import type { Lesson } from '../../../shell/lesson/types'
import type { KafkaFault, KafkaScriptedCommand, KafkaTopology } from '../engine'

export type { KafkaFault } from '../engine'

export type KafkaLessonGroup = 'basics' | 'producer' | 'consumer' | 'durability' | 'advanced'

/** Thu hẹp `group: string` của `Lesson` về đúng năm nhóm sidebar dựng, nên một
 *  lesson xếp nhầm nhóm là lỗi compile chứ không phải một bài không ai mở được. */
export interface KafkaLesson extends Lesson<KafkaTopology, KafkaScriptedCommand> {
  group: KafkaLessonGroup
  /** Tên `failures`, không phải `faults`: `src/shell/useSimulation.ts` đọc trường
   *  này một cách generic và đó là thứ giữ `src/shell/` broker-agnostic. */
  failures?: KafkaFault[]
}

/** Node dùng chung cho mọi lesson trừ khi file của nó nói khác. Frozen và dùng
 *  chung một reference: `createSimulation` coi topology là đầu vào bất biến, và
 *  một object duy nhất qua mọi lesson là cách rẻ nhất giữ điều đó thành thật —
 *  engine ghi vào nó sẽ làm hỏng mọi lesson khác chứ không chỉ lesson của nó. */
export const BROKER_1 = Object.freeze({ id: 'b1', label: 'Broker 1', position: { x: 340, y: 60 } })
export const BROKER_2 = Object.freeze({ id: 'b2', label: 'Broker 2', position: { x: 340, y: 240 } })
export const BROKER_3 = Object.freeze({ id: 'b3', label: 'Broker 3', position: { x: 340, y: 420 } })
export const PRODUCER = Object.freeze({ id: 'p1', label: 'Producer', position: { x: 40, y: 220 } })
export const CONSUMER_A = Object.freeze({ id: 'c1', label: 'Consumer A', position: { x: 700, y: 120 } })
export const CONSUMER_B = Object.freeze({ id: 'c2', label: 'Consumer B', position: { x: 700, y: 260 } })
export const CONSUMER_C = Object.freeze({ id: 'c3', label: 'Consumer C', position: { x: 700, y: 400 } })
```

- [ ] **Step 4: Viết lesson 01**

`src/brokers/kafka/lessons/01-topic-partition.ts` — topic `orders` 3 partition, 1 broker, replicationFactor 1, một producer ghi 6 record không key, một consumer đọc.

```ts
export const topicPartition: KafkaLesson = {
  id: '01-topic-partition',
  group: 'basics',
  title: 'Topic, partition và offset',
  summary: 'Topic chỉ là một cái tên; dữ liệu thật nằm trong các partition, mỗi partition là một log chỉ ghi thêm.',
  seed: 1,
  durationMs: 18_000,
  topology: { /* … */ },
  script: [
    { at: 0, kind: 'consumer-join', consumerId: 'c1' },
    { at: 1000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-1' },
    { at: 2500, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-2' },
    { at: 4000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-3' },
    { at: 6000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-4' },
    { at: 8000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-5' },
    { at: 10_000, kind: 'produce', producerId: 'p1', topic: 'orders', value: 'đơn-6' },
  ],
  narrative: [ /* 5 bước, xem dưới */ ],
  checkpoints: [ /* 1 checkpoint */ ],
}
```

Năm mốc narrative, viết đủ thân bằng tiếng Việt có dấu:

1. `at: 0` — "Topic là một cái tên, partition mới là nơi chứa dữ liệu": `orders` không lưu gì cả; ba partition `orders-0`, `orders-1`, `orders-2` mới là ba log riêng biệt. highlight `['orders-0', 'orders-1', 'orders-2']`.
2. `at: 1000` — "Offset là vị trí, không phải id": mỗi partition đếm offset riêng từ 0; hai record ở hai partition khác nhau có thể cùng offset 0 mà không hề liên quan.
3. `at: 4000` — "Log chỉ ghi thêm": không sửa, không chèn giữa, không xoá lẻ một record. Ghi là nối vào đuôi, và đó là lý do Kafka ghi nhanh.
4. `at: 8000` — "Record không key rải qua nhiều partition": sáu record nằm rải ba partition, nên **không** có thứ tự chung cho cả topic — chỉ có thứ tự trong từng partition.
5. `at: 12_000` — "Đọc không xoá": consumer đọc xong record vẫn nằm nguyên trong log; xoá là việc của retention, không phải của việc đọc. Đây là khác biệt lớn nhất với queue của RabbitMQ.

Checkpoint `at: 15_000`: "Sáu record ghi vào topic ba partition. Kafka bảo đảm gì về thứ tự?" — options: `['Sáu record đọc ra đúng thứ tự đã ghi', 'Chỉ trong từng partition thứ tự mới được bảo đảm', 'Không bảo đảm gì cả']`, `answerIndex: 1`, giải thích bằng tiếng Việt.

- [ ] **Step 5: Viết `registry.ts`, `index.ts` của broker, và đăng ký**

`src/brokers/kafka/lessons/registry.ts`:

```ts
export const KAFKA_LESSON_GROUPS: LessonGroupSpec[] = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'producer', label: 'Producer' },
  { id: 'consumer', label: 'Consumer & Group' },
  { id: 'durability', label: 'Độ bền' },
  { id: 'advanced', label: 'Nâng cao' },
]

/** Thứ tự sidebar cũng là thứ tự dạy: mỗi bài giả định các bài phía trên nó. */
export const LESSONS: KafkaLesson[] = [topicPartition]
```

`src/brokers/kafka/index.ts` — theo đúng khuôn `src/brokers/redis/index.ts`, annotate **kiểu cụ thể**:

```ts
export const kafka: BrokerModule<KafkaState, KafkaTopology, KafkaScriptedCommand, KafkaValidationIssue> = {
  id: 'kafka',
  label: 'Kafka',
  lessonGroups: KAFKA_LESSON_GROUPS,
  lessons: LESSONS,
  defaultLessonId: '01-topic-partition',
  emptyTopology: {
    brokers: [], topics: [], producers: [], consumers: [], controllerBrokerId: 'b1',
  },
  createSimulation: (options) =>
    createKafkaSimulation({
      topology: options.topology,
      script: options.script,
      seed: options.seed,
      failures: options.failures as KafkaFault[] | undefined,
      maxEvents: options.maxEvents,
    }),
  nodeTypes: { producer: ProducerNode, broker: BrokerNode, partition: PartitionNode, consumer: ConsumerNode, consumerGroup: ConsumerGroupNode },
  toNodes: (topology, state, highlight) => toFlowNodes(topology, state, highlight),
  // Edge của Kafka chỉ phụ thuộc topology: producer nối tới mọi partition của topic
  // nó ghi, consumer nối tới mọi partition nó subscribe. Cạnh nào đang "sống" là
  // việc của `inFlight`, không phải của edge — nên script không đổi được đồ thị.
  toEdges: (topology) => toFlowEdges(topology),
  inFlight: (state) => state.inFlight,
  StatePanel: LogPanel,
  issueText,
  // Spread chứ không cast: `KafkaMetrics` là interface nên không có index signature
  // ngầm, và tự nó không thoả `Record<string, number>` về mặt cấu trúc.
  metrics: (state) => ({ ...state.metrics }),
  NodeConfig,
  // Chưa có `sandbox`, chưa có `ExportDialog` — cả hai là slot optional trong
  // `BrokerModule`, nên để trống chứ không stub. Plan sau bổ sung.
}
```

`src/brokers/registry.ts`: thêm `kafka` vào `BROKERS`.
`src/brokers/catalog.ts`: thêm `{ id: 'kafka', label: 'Kafka', defaultLessonId: '01-topic-partition' }` vào `BROKER_CATALOG`.

- [ ] **Step 6: Chạy test, xác nhận xanh**

Run: `npm test && npm run typecheck`
Expected: toàn bộ xanh, gồm `src/brokers/registry.test.ts`, `src/shell/store.importOrder.test.ts`, `src/shell/lesson/language.test.ts` (tự soi lesson Kafka mới), và `src/shell/kernel/purity.test.ts`.

Nếu `language.test.ts` đỏ: copy có từ nối tiếng Anh ngoài backtick, hoặc thiếu dấu tiếng Việt. Sửa copy, không sửa test.

- [ ] **Step 7: Kiểm thủ công**

Run: `npm run dev` → chọn **Kafka** ở broker switcher → lesson `Topic, partition và offset` → bấm **Chạy**. Record phải bay từ producer sang đúng partition, `LogPanel` phải thấy offset tăng dần trong từng partition.

- [ ] **Step 8: Commit**

```bash
git add src/brokers/kafka/ src/brokers/registry.ts src/brokers/catalog.ts
git commit -m "feat(kafka): register broker with the first lesson"
```

---

### Task 10: Lesson 02–05 (hết nhóm `basics`)

**Files:**
- Create: `src/brokers/kafka/lessons/02-broker-cluster.ts`, `03-key-partitioning.ts`, `04-produce-consume.ts`, `05-offsets.ts`
- Create: `src/brokers/kafka/lessons/basics.test.ts`
- Modify: `src/brokers/kafka/lessons/registry.ts`

**Interfaces:**
- Consumes: `KafkaLesson`, node singleton (Task 9).
- Produces: `brokerCluster`, `keyPartitioning`, `produceConsume`, `offsets` — thêm vào `LESSONS` theo đúng thứ tự này.

- [ ] **Step 1: Viết `basics.test.ts` (thất bại)**

```ts
describe('lesson 03 — key và partition', () => {
  it('mọi record cùng key nằm trong đúng một partition', () => {
    const sim = createKafkaSimulation({ topology: keyPartitioning.topology, script: keyPartitioning.script, seed: keyPartitioning.seed })
    sim.advanceTo(keyPartitioning.durationMs + 5000)
    const state = sim.snapshot()
    const partitionsOfKey = new Map<string, Set<string>>()
    for (const key of sortedPartitionKeys(state)) {
      for (const record of state.partitions[key]!.log) {
        if (record.key === null) continue
        const set = partitionsOfKey.get(record.key) ?? new Set()
        set.add(key)
        partitionsOfKey.set(record.key, set)
      }
    }
    for (const [, set] of partitionsOfKey) expect(set.size).toBe(1)
  })

  it('thứ tự trong một partition đúng bằng thứ tự ghi', () => {
    // offset tăng dần và timestamp không giảm
  })
})

describe('lesson 05 — offset', () => {
  it('auto.offset.reset=latest bỏ qua mọi record ghi trước khi consumer vào', () => {})
  it('auto.offset.reset=earliest đọc lại từ đầu log', () => {})
  it('committed offset khác position: position chạy trước, committed chỉ nhích khi commit', () => {})
})

describe('lesson 02 — cluster', () => {
  it('partition của một topic trải trên nhiều broker, không dồn vào một', () => {})
})

describe('lesson 04 — vòng đời record', () => {
  it('mỗi record produce đều đến được consumer trong durationMs', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/lessons/basics.test.ts`
Expected: FAIL — bốn lesson chưa tồn tại.

- [ ] **Step 3: Viết bốn lesson**

**02 — `Broker, cluster và controller`** (`basics`, seed 2, 20s). Ba broker, topic `orders` 6 partition replicationFactor 1. Narrative: broker là một process giữ một phần dữ liệu, không phải bản sao đầy đủ · mỗi partition có đúng một leader, ghi và đọc đều qua leader · controller là một broker kiêm nhiệm việc quản trị metadata (nhắc KRaft đã thay ZooKeeper, không đi sâu) · thêm broker là thêm chỗ chứa, nhưng chỉ giúp khi partition được rải lại · mất một broker là mất quyền truy cập những partition nó làm leader, cho tới khi có leader mới (dẫn sang bài 19).

**03 — `Key và partition`** (`basics`, seed 3, 22s). Một broker, topic `orders` 4 partition. Script produce 9 record: ba record key `user-1`, ba key `user-2`, ba không key. Narrative: `murmur2(key) % số partition` là toàn bộ quy tắc · cùng key ⇒ cùng partition ⇒ thứ tự được bảo đảm cho key đó · không key ⇒ rải, không có bảo đảm thứ tự nào · **đổi số partition là đổi ánh xạ**, key cũ nhảy sang partition khác và bảo đảm thứ tự đứt ngay tại đó · chọn key là chọn đơn vị thứ tự của hệ thống.

**04 — `Vòng đời một record`** (`basics`, seed 4, 20s). Một producer `lingerMs: 500`, một consumer `processingMs: 300`. Narrative bám đúng chuỗi event: nằm batch → flush → leader append và cấp offset → high watermark nhích → consumer fetch → xử lý → commit.

**05 — `Offset, position và committed offset`** (`basics`, seed 5, 24s). Producer ghi 4 record **trước** khi consumer join, consumer `autoOffsetReset: 'latest'`; sau đó `seek` về `'earliest'` và đọc lại. Narrative: ba con số khác nhau dễ bị gọi chung là "offset" · `auto.offset.reset` chỉ có tác dụng khi không có committed offset hợp lệ · `latest` bỏ qua quá khứ, `earliest` đọc lại từ đầu · `seek` là cách đọc lại có chủ đích · committed offset là thứ quyết định consumer khởi động lại từ đâu.

Mỗi lesson: 4–5 narrative, 1 checkpoint, `highlight` chỉ dùng id node có thật (`lessons.test.ts` chốt điều này).

- [ ] **Step 4: Cập nhật `registry.ts` và chạy test**

Run: `npx vitest run src/brokers/kafka/lessons/ && npm run typecheck`
Expected: PASS — cả `basics.test.ts` lẫn `lessons.test.ts` (giờ chạy `it.each` trên 5 lesson).

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/lessons/
git commit -m "feat(kafka): basics lessons 02-05"
```

---

### Task 11: `produce.ts` — idempotent, retry và thứ tự

**Files:**
- Modify: `src/brokers/kafka/engine/produce.ts`
- Modify: `src/brokers/kafka/engine/types.ts` (thêm `produce-retry` vào `KafkaEventType` nếu chưa có)
- Test: `src/brokers/kafka/engine/produce.test.ts`

**Interfaces:**
- Consumes: `ProducerRuntime` (Task 1), `appendRecord` (Task 3).
- Produces: `assignProducerId(state, producerId): { state; producerId: number; epoch: number }`; `checkSequence(partition, record): 'ok' | 'duplicate' | 'out-of-order'`.

- [ ] **Step 1: Viết test thất bại**

```ts
describe('idempotent producer', () => {
  it('retry cùng một record không tạo bản ghi thứ hai trong log', () => {})
  it('duplicatesPrevented tăng đúng số lần retry bị chặn', () => {})
  it('sequence nhảy cóc bị từ chối là out-of-order, không âm thầm ghi', () => {})
  it('producer không idempotent thì retry tạo duplicate thật — đó là điều bài 09 dạy', () => {})
})

describe('retry và thứ tự', () => {
  it('maxInFlight = 1 giữ nguyên thứ tự kể cả khi request đầu phải retry', () => {})
  it('maxInFlight > 1 không idempotent: retry đẩy record ra sau record gửi sau nó', () => {
    // Khẳng định log ra thứ tự KHÁC thứ tự produce — đây là bug thật, không phải
    // lỗi cài đặt. Test chốt nó để lesson 10 dạy được.
  })
  it('maxInFlight > 1 CÓ idempotent: broker sắp lại theo sequence, thứ tự được giữ', () => {})
  it('retries = 0 thì lỗi là lỗi luôn, không thử lại', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/engine/produce.test.ts`
Expected: FAIL — 8 test mới đỏ, 10 test cũ vẫn xanh.

- [ ] **Step 3: Cài đặt**

- `assignProducerId` cấp `producerId` tăng dần (đếm trong state, không dùng RNG — nó không cần ngẫu nhiên) và `epoch: 0`.
- `ProducerRuntime.nextSequence[partitionKey]` tăng mỗi record được **chấp nhận**.
- `PartitionState` thêm `producerState: Record<number, { epoch: number; lastSequence: number }>` — broker nhớ sequence cuối của từng producer, đúng cách Kafka làm.
- `checkSequence`: `sequence === lastSequence + 1` ⇒ `ok`; `<= lastSequence` ⇒ `duplicate` (bỏ qua, `duplicatesPrevented++`); `> lastSequence + 1` ⇒ `out-of-order` (trả lỗi).
- Fault `produce-error` làm request thất bại `times` lần đầu. Retry sinh event `produce-retry` ở `at + 200`. Với `maxInFlight > 1` và không idempotent, record retry được append **sau** những record đã gửi sau nó — cài bằng cách chỉ đơn giản append theo thứ tự event tới, không sắp lại. Với idempotent, `checkSequence` chặn nó ở nhánh `out-of-order` và buộc chờ, nên thứ tự được giữ.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/kafka/engine/ && npm run typecheck`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/engine/produce.ts src/brokers/kafka/engine/produce.test.ts src/brokers/kafka/engine/types.ts
git commit -m "feat(kafka): idempotent producer, retries and ordering"
```

---

### Task 12: Lesson 06–10 (hết nhóm `producer`)

**Files:**
- Create: `src/brokers/kafka/lessons/06-acks.ts`, `07-batching-linger.ts`, `08-partitioner.ts`, `09-idempotent-producer.ts`, `10-ordering-retries.ts`
- Create: `src/brokers/kafka/lessons/producer.test.ts`
- Modify: `src/brokers/kafka/lessons/registry.ts`

**Interfaces:**
- Consumes: `KafkaLesson`, engine từ Task 11.
- Produces: `acks`, `batchingLinger`, `partitioner`, `idempotentProducer`, `orderingRetries`.

- [ ] **Step 1: Viết `producer.test.ts` (thất bại)**

```ts
describe('lesson 06 — acks', () => {
  it('acks=0 mất record khi broker chết mà producer không hề biết', () => {})
  it('acks=all không mất record nào trong cùng kịch bản', () => {})
})
describe('lesson 07 — batching', () => {
  it('linger.ms lớn gom nhiều record vào một lần ghi, tổng số batch giảm', () => {})
  it('linger.ms = 0 cho độ trễ từng record thấp nhất', () => {})
})
describe('lesson 08 — partitioner', () => {
  it('key lệch làm một partition ôm phần lớn record — hot partition', () => {})
  it('round-robin rải đều khi không có key', () => {})
})
describe('lesson 09 — idempotent', () => {
  it('cùng kịch bản retry: không idempotent sinh duplicate, idempotent thì không', () => {})
})
describe('lesson 10 — thứ tự', () => {
  it('maxInFlight = 5 không idempotent làm log lệch thứ tự produce', () => {})
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/kafka/lessons/producer.test.ts`
Expected: FAIL — năm lesson chưa tồn tại.

- [ ] **Step 3: Viết năm lesson**

**06 — `acks`** (seed 6, 24s). Ba producer cùng ghi vào `orders`: `acks: 0`, `acks: 1`, `acks: 'all'`. `failures: [{ at: 8000, kind: 'broker-down', brokerId: 'b1' }]`. Narrative: `acks` là "producer coi như xong khi nào" · `acks=0` là gửi rồi quên, nhanh nhất và mất im lặng · `acks=1` chờ leader, mất khi leader chết trước lúc follower kịp sao · `acks=all` chờ cả ISR, chậm nhất và bền nhất · con số này chọn theo giá của một record bị mất, không chọn theo throughput mong muốn.

**07 — `Batching và linger.ms`** (seed 7, 22s). Hai producer: `lingerMs: 0` và `lingerMs: 2000, batchSize: 4096`. Cùng ghi 8 record. Narrative: một request mạng cho nhiều record rẻ hơn nhiều request cho từng record · `linger.ms` là thời gian producer cố tình chờ để gom · `batch.size` là trần, tới trần thì gửi luôn không chờ hết linger · compression chỉ có ý nghĩa khi batch đủ lớn · đây là đánh đổi latency lấy throughput, không phải một tuỳ chọn "bật cho nhanh".

**08 — `Partitioner và hot partition`** (seed 8, 24s). Topic 4 partition. Producer 1 dùng `default` với key lệch (`vip-1` chiếm 7/10 record); producer 2 dùng `round-robin` không key. Narrative: default hash key · key lệch làm một partition nóng, consumer của nó tụt lại · sticky partitioner gom record không key vào một partition cho tới khi batch đóng, ít batch hơn hẳn round-robin · thêm partition không cứu được hot key, vì key đó vẫn về đúng một partition · muốn phân tán thì phải đổi cách chọn key.

**09 — `Idempotent producer`** (seed 9, 22s). Hai producer cùng kịch bản, một `idempotent: false`, một `idempotent: true`; `failures: [{ at: 4000, kind: 'produce-error', producerId: 'p1', times: 1 }, { at: 4000, kind: 'produce-error', producerId: 'p2', times: 1 }]`. Narrative: retry là nguồn duplicate chính, không phải lỗi ứng dụng · broker không phân biệt được "record mới" với "record cũ gửi lại" nếu không có định danh · `producerId` + `epoch` + `sequence` cho phép broker nhận ra và bỏ qua bản trùng · `enable.idempotence` gần như miễn phí và nên bật mặc định · nó chỉ khử trùng **trong một partition, một phiên producer** — không phải exactly-once đầu-cuối, cái đó là bài 22.

**10 — `Thứ tự khi có retry`** (seed 10, 24s). Producer `maxInFlight: 5`, `idempotent: false`, `retries: 3`, một `produce-error` chen giữa. Narrative: năm request bay song song, request đầu hỏng và bị gửi lại sau · log ghi theo thứ tự tới, nên record 1 nằm sau record 2 và 3 · hai cách chặn: `max.in.flight = 1` (mất throughput) hoặc bật idempotence (giữ throughput, broker sắp lại theo sequence) · thứ tự chỉ được nói tới trong phạm vi một partition, đừng kỳ vọng gì hơn.

- [ ] **Step 4: Chạy test và gate đầy đủ**

Run: `npm test && npm run typecheck && npm run lint`
Expected: toàn bộ xanh — gồm `language.test.ts` trên 10 lesson mới.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/lessons/
git commit -m "feat(kafka): producer lessons 06-10"
```

---

### Task 13: Cập nhật tài liệu và chốt phase

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Sửa `README.md`**

- Thêm Kafka vào đoạn mở đầu: hiện có RabbitMQ, Redis và Kafka.
- Thêm gạch đầu dòng: **Kafka** — 10 lesson trên hai nhóm (`basics`/Cơ bản, `producer`/Producer; ba nhóm `consumer`/`durability`/`advanced` còn trống, để dành plan sau): topic & partition & offset, broker & cluster & controller, key & partitioning, vòng đời record, offset vs position vs committed, `acks`, batching & `linger.ms`, partitioner & hot partition, idempotent producer, thứ tự khi có retry.
- Mục "Cấu trúc thư mục": thêm `src/brokers/kafka/  engine, lessons, ui của Kafka — chưa có sandbox`.
- Mục thuật ngữ không dịch: thêm nhóm Kafka.

- [ ] **Step 2: Chạy full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: bốn lệnh xanh.

- [ ] **Step 3: Kiểm thủ công cả ba broker, cả ba layout**

Run: `npm run dev`. Ở 1280px và 393px, đổi qua lại RabbitMQ ↔ Redis ↔ Kafka nhiều lần: không crash, không hook warning trong console, canvas fit lại đúng sau mỗi lần đổi. Đây là bài kiểm cho ràng buộc "số hook tại call site không đổi theo broker".

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Kafka to the broker list"
```

---

## Self-Review

**Spec coverage (Phần B, phạm vi P1–P3):**

| Mục spec | Task |
| --- | --- |
| §B2 `KafkaTopology` và mọi spec con | Task 1 |
| §B3 `KafkaState`, `PartitionState`, `LogEntry`, `ProducerRuntime`, `ConsumerRuntime`, `KafkaMetrics` | Task 1, 3, 4, 5 |
| §B3 `GroupState` | Khai báo ở Task 1, dùng ở plan sau (P4) |
| §B4 `KafkaScriptedCommand`, `KafkaFault`, tên trường `failures` | Task 1, 9 |
| §B5 `murmur2.ts`, `partitioner.ts` | Task 2 |
| §B5 `log.ts`, `segments.ts` | Task 3 |
| §B5.2 `produce.ts` | Task 4 (batch/linger/acks), Task 11 (idempotent/retry) |
| §B5 `consume.ts` | Task 5 |
| §B5.6 `validate.ts` | Task 1 |
| §B6 determinism, bẫy thứ tự lặp `Record` | Task 1 (`sortedPartitionKeys`), Task 6 (test) |
| §B7 lesson 01–10 | Task 9, 10, 12 |
| §B8 UI | Task 7, 8 |
| §B11 đăng ký `registry.ts` + `catalog.ts` | Task 9 |
| §B12 test | Task 1–12 |

**Ngoài phạm vi plan này, thuộc plan sau:** `group/` (§B5.4), `replication.ts` (§B5.3), `transaction.ts` (§B5.5), `compaction.ts`, `faults.ts` đầy đủ, lesson 11–24 (§B7), sandbox (§B9), export (§B10).

**Type consistency:** `partitionKey`/`sortedPartitionKeys` khai báo Task 1, dùng ở Task 3, 5, 7, 8, 10. `pickPartition` trả `{ partition, nextRoundRobinCounter, nextSticky, rng }` ở Task 2, dùng đúng bốn trường đó ở Task 4. `PartitionState.producerState` **thêm ở Task 11** — Task 1 khai báo `PartitionState` chưa có trường này, nên Task 11 Step 3 nêu rõ là thêm vào. `KafkaEventType` mở rộng ở Task 11 và ở plan sau; nó là union nên thiếu một nhánh reducer là lỗi compile, không phải lỗi runtime.

**Phụ thuộc:** 1 → 2 → 3 → (4, 5 song song được) → 6 → (7, 8 song song được) → 9 → 10 → 11 → 12 → 13.
