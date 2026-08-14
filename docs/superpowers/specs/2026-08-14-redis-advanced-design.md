# Redis — nhóm lesson Nâng cao (Phase 6) — Design

**Date:** 2026-08-14
**Status:** Approved
**Kế thừa từ:** `docs/superpowers/specs/2026-08-07-multi-broker-redis-design.md` (§6, §9 phase 6) — spec đó đã
duyệt bốn nhóm lesson và để trống `messaging`/`advanced` "cho một plan sau". Đây là plan đó, chỉ cho
`advanced`. `messaging` (Pub/Sub, Streams) không nằm trong scope tài liệu này.

## 1. Mục tiêu

Lấp nhóm `advanced` (`Nâng cao`) của Redis bằng sáu lesson: transactions, Lua atomicity, distributed
lock, sliding-window rate limit, RDB vs AOF, replication/Sentinel/cluster hash slot. Mỗi lesson đi kèm
engine support thật — không phải narrative suông — theo đúng nguyên tắc "lesson là topology cố định +
script lệnh thật chạy qua engine" mà mọi lesson khác trong repo tuân theo.

## 2. Quyết định chính

| Quyết định | Chọn | Lý do |
| --- | --- | --- |
| Số lượng lesson | Đủ 6, đúng spec gốc | Dạy trọn bộ chủ đề nâng cao thay vì một tập con lửng lơ. |
| `EVAL` (Lua) | Mini interpreter thật, không phải canned script ID | Distributed lock cần unlock an toàn (compare-and-delete) — một pattern Lua kinh điển; canned ID sẽ chỉ diễn lại kết quả, không dạy được *tại sao* Lua atomic. |
| Lua subset | `redis.call`, `KEYS`/`ARGV`, `local`, `if/then/else`, `for`/`while`, `return` | Đủ cho hai lesson dùng tới nó (Lua atomicity, distributed lock); không cần function definition hay closure. |
| Cluster | Chỉ `CLUSTER KEYSLOT` (CRC16 mod 16384), không sharding thật | Đúng "out of scope" của spec gốc: không có real cluster resharding. Dữ liệu vẫn sống trên một server logic duy nhất. |
| Crash/restart/failover | Cơ chế `faults?` trên lesson, giống `failures?` của RabbitMQ | Pattern đã có tiền lệ trong repo (`src/brokers/rabbitmq/lessons/07-ack-modes.ts`) — không phát minh cơ chế mới. |
| Giao hàng | 2 sub-phase: 6a (không đổi topology) rồi 6b (đổi topology) | 6b kéo theo thay đổi `RedisTopology`/UI (replica, sentinel node); tách ra để 6a merge được độc lập và sớm. |

## 3. Engine — 6a (tx, Lua, lock, rate limit)

Không đổi `RedisTopology`/`RedisServerSpec`. Chỉ thêm command handlers và state trên client.

### 3.1 Transactions — `commands/tx.ts`

- `MULTI` — bật cờ `inTransaction` trên client trong `RedisState`; các lệnh sau đó (trừ `EXEC`/`DISCARD`/
  `WATCH`/`MULTI`) không chạy ngay mà được đẩy vào `queuedCommands: RedisScriptedCommand[]` của client đó,
  trả về `QUEUED`.
- `EXEC` — nếu không có `WATCH` nào bị vi phạm, chạy tuần tự toàn bộ `queuedCommands` như một event duy
  nhất (không event nào khác chen giữa), trả về mảng reply; nếu có watched key đổi, trả `nil` (abort) và
  không chạy gì. Xoá `queuedCommands`/`watchedKeys` sau khi xong dù abort hay không.
- `DISCARD` — xoá `queuedCommands`/`watchedKeys`, không chạy gì.
- `WATCH key...` — chỉ hợp lệ ngoài transaction. Ghi lại `{key, version}` hiện tại của mỗi key vào
  `watchedKeys` của client.
- **Version stamp:** mỗi `KeyRecord` thêm field `version: number`, tăng mỗi lần key bị ghi hoặc xoá (kể cả
  bởi lazy/active expire và eviction). `EXEC` so version watched với version hiện tại của key.
- Trạng thái transaction sống trên `RedisState.clients: Record<NodeId, {queuedCommands, watchedKeys}>`
  (map mới), không phải trên topology — giống cách `BlockedClient` đã tách trạng thái runtime khỏi
  topology tĩnh.

### 3.2 Lua — `engine/lua/` + `commands/script.ts`

Module riêng, tách khỏi `commands/` vì đây là một interpreter con, không phải một command handler đơn:

```
engine/lua/
  lex.ts      # nguồn text -> token[]
  parse.ts    # token[] -> AST (Program, If, ForNumeric, WhileLoop, LocalDecl, Return, Call, BinOp, ...)
  eval.ts     # AST + { KEYS, ARGV, call: (name, args) => Reply } -> Reply
  lex.test.ts / parse.test.ts / eval.test.ts
```

- `eval.ts` không tự dispatch lệnh Redis — nó nhận một hàm `call` do `commands/script.ts` truyền vào, hàm
  đó gọi thẳng `HANDLERS` hiện có. Một lời gọi `redis.call('SET', KEYS[1], ARGV[1])` trong script chạy qua
  đúng handler `SET` mà `SET` trực tiếp cũng dùng — không có đường logic thứ hai để lệch khỏi cái thứ nhất.
- `EVAL script numkeys key... arg...` — parse `numkeys`, chia `KEYS`/`ARGV`, chạy interpreter, cả script
  tính là **một event kernel duy nhất** (không `at` riêng cho từng `redis.call` bên trong) — đúng ngữ nghĩa
  atomic mà lesson dạy.
- Lỗi cú pháp hoặc runtime (gọi lệnh không tồn tại, so sánh sai kiểu...) trả `Reply` kind `error`, không
  throw — nhất quán với cách mọi command handler khác báo lỗi.
- Giới hạn: không `function`, không closure, không string library ngoài so sánh `==`/`~=`, không table
  literal ngoài `KEYS`/`ARGV`. Đủ cho hai lesson dùng nó; vượt khỏi đây là scope creep.

### 3.3 Distributed lock

Không command mới. Lesson dùng `SET lock:x <token> NX PX <ms>` để lock, và một `EVAL` compare-and-delete
(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`) để
unlock — đúng pattern khuyến nghị chính thức của Redis, và narrative nói rõ vì sao "GET rồi DEL" hai lệnh
rời nhau là race condition mà lock được sinh ra để tránh, còn tại sao Redlock (multi-node) vẫn bị Martin
Kleppmann/antirez tranh cãi (nêu trong narrative, không mô phỏng multi-node consensus thật).

### 3.4 Rate limit — thêm vào `commands/zset.ts`

- `ZREMRANGEBYSCORE key min max` — xoá member có score trong `[min, max]`.
- `ZCOUNT key min max` — đếm member có score trong `[min, max]`.

Lesson: sliding window bằng `ZADD key <now> <request-id>`, `ZREMRANGEBYSCORE key -inf <now-windowMs>`,
`ZCARD key` so với limit — pattern rate-limit kinh điển, không cần command nào khác.

## 4. Engine — 6b (persistence, replication, Sentinel, cluster)

### 4.1 Topology

```ts
interface RedisServerSpec {
  // ...existing fields
  persistence?: {
    rdb?: { everySec: number; changes: number }
    aof?: 'always' | 'everysec' | 'no'
  }
}

interface RedisTopology {
  clients: RedisClientSpec[]
  server: RedisServerSpec
  replicas?: { id: NodeId; label: string; position: Position; lagMs: number }[]
  sentinels?: { id: NodeId; label: string; position: Position }[]
}
```

Replica ở đây là một **node hiển thị + độ trễ**, không phải một engine con chạy song song: dữ liệu vẫn
là một `RedisState` duy nhất, mỗi replica giữ `lastAppliedVersion`/timestamp để keyspace panel vẽ được độ
trễ, chứ không giữ bản sao dữ liệu riêng. Giữ đúng nguyên tắc "một reducer thuần" của repo thay vì mô
phỏng N server độc lập.

### 4.2 Faults — mở rộng `RedisLesson`

```ts
// src/brokers/redis/lessons/types.ts
export interface RedisFault {
  at: number
  kind: 'crash' | 'restart' | 'sentinelFailover'
  target: NodeId // server hoặc replica id
}
export interface RedisLesson extends Lesson<RedisTopology, RedisScriptedCommand> {
  group: RedisLessonGroup
  faults?: RedisFault[]
}
```

Giống hệt mô hình `failures?: ScriptedFailure[]` của RabbitMQ (`src/brokers/rabbitmq/lessons/types.ts`) —
kernel áp fault tại đúng `at` như một event, độc lập với `script`.

### 4.3 Sự kiện mới

| Event | Ý nghĩa |
| --- | --- |
| `snapshotWrite` | Điểm RDB save (theo `persistence.rdb.everySec`/`changes`) hoặc AOF fsync boundary — engine ghi lại "mốc an toàn" gần nhất. |
| `crash` | Server hoặc replica dừng. Nếu là server: mọi ghi từ `snapshotWrite`/AOF-fsync gần nhất trở đi bị loại khỏi state theo policy (`rdb`: mất hết từ snapshot cuối; `aof: always`: không mất; `aof: everysec`: mất ghi trong 1000ms cuối trước crash). |
| `restart` | Server quay lại với state đã restore ở bước `crash`. |
| `replicate` | Một ghi trên primary đến replica sau `lagMs`, cập nhật `lastAppliedVersion` của replica đó. |
| `sentinelFailover` | Sau `crash` trên primary, sentinel chọn replica có `lastAppliedVersion` cao nhất làm primary mới; state panel phản ánh đổi vai trò. |

### 4.4 Lệnh mới — mở rộng `commands/server.ts`

- `CLUSTER KEYSLOT key` — `crc16(key) % 16384`, thuần hàm tính, không side effect. Thêm `engine/crc16.ts`
  (bảng tra cứu chuẩn CRC16/CCITT mà Redis dùng) — thuần, không random/Date, `purity.test.ts` tự phủ vì
  nó nằm trong `engine/**`.
- `BGSAVE` — tạo `snapshotWrite` ngay lập tức, trả `Background saving started`.
- `REPLICAOF host port` / `REPLICAOF NO ONE` — chỉ đổi field hiển thị vai trò trên node, không mô phỏng
  handshake mạng thật (không có mạng thật trong app này).

### 4.5 UI

- `ReplicaNode` — hiện `lagMs` và `lastAppliedVersion` lệch bao nhiêu so với primary.
- `SentinelNode` — hiện trạng thái theo dõi / vừa failover.
- Edge `server → replica` (replication, nét đứt) và `sentinel ⇢ server`/`sentinel ⇢ replica` (giám sát,
  chấm) — tái dùng `MessageLayer` như mọi edge khác, không component canvas mới.

## 5. Lesson (6, nối tiếp `11-eviction.ts`, group `advanced`)

| File | Lesson | Dạy |
| --- | --- | --- |
| `12-transactions.ts` | Transactions | `MULTI`/`EXEC` gộp nhiều lệnh thành một bước; `WATCH` abort khi key đổi giữa chừng (optimistic lock). |
| `13-lua.ts` | Lua atomicity | `EVAL` chạy nguyên khối không bị chen ngang — đối chiếu trực tiếp với hai lệnh rời (race condition) làm cùng việc. |
| `14-distributed-lock.ts` | Distributed lock | `SET NX PX` để lock, `EVAL` compare-and-delete để unlock an toàn; narrative nêu vì sao Redlock gây tranh cãi. |
| `15-rate-limit.ts` | Sliding-window rate limit | `ZADD`/`ZREMRANGEBYSCORE`/`ZCARD` làm sliding window, so với fixed-window để thấy khác biệt burst. |
| `16-persistence.ts` | RDB vs AOF | Cùng một chuỗi ghi, hai server (một RDB-only, một AOF `everysec`) cùng crash — panel cho thấy server nào mất dữ liệu và mất bao nhiêu. |
| `17-replication.ts` | Replication & Sentinel & cluster | Ghi trên primary tới replica có độ trễ; primary crash, Sentinel failover; `CLUSTER KEYSLOT` cho thấy key sẽ rơi vào slot nào nếu cluster hoá. |

Copy theo đúng quy tắc `language.test.ts` đã có: narrative/summary tiếng Việt, thuật ngữ Redis giữ tiếng
Anh (transaction, watch, atomic, distributed lock, rate limit, snapshot, replica, failover, hash slot...).

## 6. Testing

- `advanced.test.ts` (mẫu `cache.test.ts`) — mỗi lesson trong nhóm: hành vi cụ thể (VD: `EXEC` abort đúng
  lúc watched key đổi; `EVAL` không bị chen ngang; rate limiter từ chối đúng request thứ N+1; persistence
  lesson mất đúng số key kỳ vọng theo từng policy; failover chọn đúng replica).
- `lex.test.ts`/`parse.test.ts`/`eval.test.ts` cho Lua interpreter — token hoá, cây cú pháp, và chạy thật
  từng nhánh cú pháp được hỗ trợ (if/else cả hai nhánh, for/while, lỗi cú pháp, gọi `redis.call` lỗi).
- `tx.test.ts` — `MULTI`/`EXEC`/`DISCARD`/`WATCH` riêng, kể cả watch trên key đã hết TTL.
- Mở rộng `validate.test.ts`: `WATCH` một key không tồn tại không phải lỗi (Redis thật cho phép), replica
  không có `lagMs` hợp lệ, sentinel khai báo mà không có replica nào là lỗi.
- `it.each` chuẩn (topology hợp lệ, deterministic hai lần chạy, mọi lệnh có reply, journal snapshot ổn
  định) tự áp dụng cho 6 lesson mới vì chúng chạy qua `lessons.test.ts` chung của Redis, không cần sửa gì.
- `purity.test.ts` tự phủ `engine/lua/`, `engine/crc16.ts`, `commands/tx.ts` vì mọi thứ nằm trong
  `src/brokers/redis/engine/**`.

## 7. Phase giao hàng

1. **6a — tx + Lua + lock + rate limit.** `commands/tx.ts`, `engine/lua/`, `commands/script.ts`, hai lệnh
   zset mới, 4 lesson (`12`–`15`), test tương ứng. Không đổi `RedisTopology`.
2. **6b — persistence + replication/Sentinel/cluster.** Đổi `RedisTopology`/`RedisServerSpec`, `faults?`
   trên `RedisLesson`, `engine/crc16.ts`, `ReplicaNode`/`SentinelNode`, 2 lesson (`16`, `17`), test tương
   ứng.

Mỗi phase kết thúc bằng `npm test`, `npm run typecheck`, `npm run lint` xanh, và tự commit riêng — theo
đúng quy ước phần "Delivery phases" của spec gốc.

## 8. Ngoài phạm vi

- Nhóm `messaging` (Pub/Sub, Streams) — vẫn để trống, dành cho plan riêng.
- Redis Sandbox / xuất code cho nhóm advanced — Sandbox là hạng mục chung cho cả broker Redis (phase 7 của
  spec gốc), không phải riêng nhóm advanced; không đụng tới trong tài liệu này.
- Lua: function definition, closure, string/table library ngoài những gì §3.2 liệt kê.
- Cluster: sharding thật, multi-server dataset tách biệt, resharding, gossip protocol thật.
- Sentinel: quorum thật giữa nhiều sentinel (`sentinels?` chỉ hiển thị, failover được kích bởi `faults?`
  kịch bản sẵn, không phải bầu chọn runtime).
