import type { Edge, Node } from '@xyflow/react'
import {
  partitionKey,
  sortedPartitionKeys,
  type ConsumerRuntime,
  type KafkaConsumerSpec,
  type KafkaState,
  type KafkaTopology,
} from '../engine'
// Không nằm trong barrel `../engine` (index.ts chỉ import `applyPause`/`applyResume`/
// `applySeek`/`fetchRecords` từ `./consume`, không re-export `resolvePosition`) — import
// thẳng từ module con, đúng như engine's own test files làm.
import { resolvePosition } from '../engine/consume'

// Xếp dọc các partition bên dưới header của broker leader — con số thuần bố cục, không
// mang ý nghĩa domain nào. `PARTITION_HEADER_Y` chừa chỗ cho nhãn + trạng thái online/
// controller của `BrokerNode` phía trên; `PARTITION_ROW_HEIGHT` đủ cho một `PartitionNode`
// (nhãn + badge ISR + dòng LEO/HW) không đè lên hàng kế tiếp.
const PARTITION_OFFSET_X = 24
const PARTITION_HEADER_Y = 64
const PARTITION_ROW_HEIGHT = 64

// `consumerGroup` cũng không có spec object riêng trong topology (chỉ là một field
// `groupId: string` trên từng consumer) nên vị trí của nó cũng phải tính, giống partition
// — xếp thành một hàng ngang bên dưới cụm broker/partition, thứ tự theo groupId đã sort
// (xác định, không phụ thuộc thứ tự chèn của `topology.consumers`).
const GROUP_ROW_Y = 420
const GROUP_SPACING_X = 260

/**
 * `highlight` carries the active narrative step's `NarrativeStep.highlight` ids, cùng quy
 * ước như RabbitMQ/Redis' `toFlowNodes`. Id nào không khớp node nào thì bị bỏ qua, không
 * ném lỗi: một lesson có thể nêu tên một node rồi sau đó xoá nó đi, và bỏ sót trong im
 * lặng còn tốt hơn nhiều so với một canvas crash giữa chừng.
 *
 * Node `position` được đọc thẳng từ spec object của topology thay vì tạo mới, để giữ
 * tham chiếu ổn định qua từng tick — hàm này nằm trong một `useMemo` ở `CanvasView`, một
 * object position mới mỗi lần render sẽ làm canvas re-layout mỗi frame (xem comment tương
 * tự ở `redis/ui/toFlow.ts`). `partition` và `consumerGroup` là hai ngoại lệ: chúng không
 * có spec object riêng trong `KafkaTopology` (xem `PARTITION_*`/`GROUP_*` phía trên), nên
 * vị trí của chúng phải tính từ thứ hạng trong danh sách đã sort.
 *
 * Thứ tự trả về LÀ MỘT PHẦN HỢP ĐỒNG: React Flow yêu cầu node cha đứng trước node con
 * trong mảng, nếu không con không định vị được (rơi về góc canvas). Thứ tự ở đây —
 * broker -> partition -> consumerGroup -> consumer -> producer — đúng thứ tự cha luôn
 * đứng trước con: partition có `parentId` là broker leader, consumer có `parentId` là
 * consumer group của nó.
 */
export function toFlowNodes(topology: KafkaTopology, state: KafkaState, highlight: string[] = []): Node[] {
  const emphasised = new Set(highlight)

  // 1. broker
  const brokerNodes = topology.brokers.map<Node>((broker) => ({
    id: broker.id,
    type: 'broker',
    position: broker.position,
    data: {
      label: broker.label,
      offline: !(state.brokersOnline[broker.id] ?? true),
      isController: broker.id === topology.controllerBrokerId,
      highlighted: emphasised.has(broker.id),
    },
  }))

  // 2. partition — theo `sortedPartitionKeys`, không theo `Object.keys` thô (xem comment
  // trên `sortedPartitionKeys` trong `engine/types.ts`: thứ tự lặp của object là hợp đồng
  // mong manh, mảng đã sort thì không).
  const siblingRank = new Map<string, number>() // leader broker id -> số partition đã xếp dưới nó
  const partitionNodes = sortedPartitionKeys(state).map<Node>((key) => {
    const partition = state.partitions[key]!
    const rank = siblingRank.get(partition.leader) ?? 0
    siblingRank.set(partition.leader, rank + 1)
    return {
      id: key,
      type: 'partition',
      parentId: partition.leader,
      extent: 'parent',
      // Lệch theo THỨ HẠNG trong số các partition cùng leader — cố tình không dùng
      // `partition.index` trực tiếp: index đó là topic-cục-bộ, nên topic-a partition 0
      // và topic-b partition 0 cùng chung một leader sẽ đều là index 0 và đè lên nhau.
      // Rank được suy ra thuần từ thứ tự `sortedPartitionKeys`, nên vẫn là một hàm xác
      // định của tập khoá, không phụ thuộc thứ tự chèn.
      position: { x: PARTITION_OFFSET_X, y: PARTITION_HEADER_Y + rank * PARTITION_ROW_HEIGHT },
      data: {
        label: key,
        leo: partition.leo,
        highWatermark: partition.highWatermark,
        isrCount: partition.isr.length,
        replicaCount: partition.replicas.length,
        highlighted: emphasised.has(key),
      },
    }
  })

  // 3. consumerGroup — suy ra từ `topology.consumers[].groupId`, KHÔNG từ `state.groups`.
  // `state.groups` chỉ được điền bởi sự kiện `consumer-join`, nên một canvas dựng trên đó
  // sẽ render không có khung group nào ở t=0 rồi bật ra giữa chừng — và mọi consumer node
  // sẽ có `parentId` trỏ vào một node chưa tồn tại trong khoảnh khắc đó, thứ React Flow
  // không định vị được. Topology là nguồn ổn định; khử trùng lặp và sort để thứ tự xác định.
  const groupIds = [...new Set(topology.consumers.map((c) => c.groupId))].sort()
  const consumerGroupNodes = groupIds.map<Node>((groupId, index) => ({
    id: groupId,
    type: 'consumerGroup',
    position: { x: index * GROUP_SPACING_X, y: GROUP_ROW_Y },
    data: { label: groupId, highlighted: emphasised.has(groupId) },
  }))

  // 4. consumer — con của group của nó
  const consumerNodes = topology.consumers.map<Node>((consumer) => {
    const runtime = state.consumers[consumer.id]
    const joined = runtime !== undefined
    return {
      id: consumer.id,
      type: 'consumer',
      parentId: consumer.groupId,
      position: consumer.position,
      data: {
        label: consumer.label,
        lag: joined ? consumerLag(topology, state, consumer, runtime) : 0,
        joined,
        highlighted: emphasised.has(consumer.id),
      },
    }
  })

  // 5. producer
  const producerNodes = topology.producers.map<Node>((producer) => ({
    id: producer.id,
    type: 'producer',
    position: producer.position,
    data: { label: producer.label, highlighted: emphasised.has(producer.id) },
  }))

  return [...brokerNodes, ...partitionNodes, ...consumerGroupNodes, ...consumerNodes, ...producerNodes]
}

/**
 * Tổng lag trên mọi partition của mọi topic trong `subscriptions` — `highWatermark -
 * position`, đúng định nghĩa lag của Kafka thật. Vị trí "chưa từng resolve" của một
 * partition phải đi qua `resolvePosition` (`consume.ts`), không phải đọc thẳng
 * `runtime.position[key]` với một fallback tự bịa: khi `autoOffsetReset` là `'latest'`
 * (mặc định — `DEFAULT_AUTO_OFFSET_RESET` trong `consume.ts`), vị trí chưa resolve nghĩa
 * là "bắt đầu từ high watermark", tức lag bằng 0 — không phải `logStartOffset`, con số đó
 * sẽ bịa ra một backlog gồm mọi record đã tồn tại từ trước khi consumer này vào group.
 *
 * BẪY đã từng rơi vào đây: `fetchRecords` trong `consume.ts` có một dòng trông giống hệt
 * `runtime.position[key] ?? partition.logStartOffset`, nhưng comment ngay tại đó nói rõ
 * đó CHỈ là rào chắn kiểu cho `noUncheckedIndexedAccess` sau khi vòng lặp phía trên đã
 * resolve position cho MỌI key không bị pause — không phải là quy tắc resolve thật. Copy
 * cái rào chắn đó vào đây (thay vì gọi `resolvePosition`) làm consumer bị pause TRƯỚC lần
 * poll đầu tiên (position chưa từng được resolve) đọc lag bằng cỡ toàn bộ log thay vì 0.
 *
 * Exported: `NodeConfig.tsx`'s consumer branch renders this same fetch-position lag next
 * to the canvas badge this function feeds, and imports it from here rather than keeping a
 * second copy — a duplicate whose correctness hinges on `resolvePosition`'s contract is
 * exactly the divergence hazard Task 7's fix round already cost this plan once.
 */
export function consumerLag(
  topology: KafkaTopology,
  state: KafkaState,
  consumer: KafkaConsumerSpec,
  runtime: ConsumerRuntime,
): number {
  const autoOffsetReset = consumer.autoOffsetReset ?? 'latest'
  let lag = 0
  for (const topicName of consumer.subscriptions) {
    const topic = topology.topics.find((t) => t.name === topicName)
    if (!topic) continue
    for (let index = 0; index < topic.partitions; index++) {
      const key = partitionKey(topicName, index)
      const partition = state.partitions[key]
      if (!partition) continue
      const position = resolvePosition({
        position: runtime.position[key],
        logStartOffset: partition.logStartOffset,
        highWatermark: partition.highWatermark,
        autoOffsetReset,
      })
      lag += partition.highWatermark - position
    }
  }
  return lag
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target, animated: false, style: { stroke: '#475569' } }
}

/**
 * Chỉ nhận `topology`, theo đúng mẫu `toFlowEdges` đơn giản của Redis
 * (`src/brokers/redis/index.ts`) — hợp đồng `BrokerModule.toEdges` cho phép nhận cả
 * script, nhưng Kafka không cần: tập cạnh không đổi theo lệnh nào chạy, chỉ đổi theo
 * topology.
 *
 * Producer: `KafkaProducerSpec` không có trường topic (xem `engine/types.ts`) — topic
 * một producer thực sự ghi chỉ script mới biết (`produce`.topic). Ở đây nối producer tới
 * MỌI partition của MỌI topic trong topology; với một lesson chỉ có một topic điều này
 * không mơ hồ, với nhiều topic cạnh sẽ vẽ dư tới topic producer không thực ghi — hạn chế
 * đã biết, không phải bug. Không thêm trường mới vào `KafkaProducerSpec` chỉ để phục vụ
 * canvas; script mới là nguồn thật của việc producer ghi đâu.
 *
 * Consumer: nối tới MỌI partition của MỌI topic trong `subscriptions`, không chỉ
 * partition đang được giao. Assignment sống trong `GroupMember.assignment`, một trường
 * của STATE mà hàm này không nhận — và group coordinator/rebalance chưa được implement ở
 * plan này, thuộc plan sau. Cạnh nào đang "sống" tại một thời điểm là việc của `inFlight`,
 * không phải của tập cạnh.
 */
export function toFlowEdges(topology: KafkaTopology): Edge[] {
  const edges: Edge[] = []

  for (const producer of topology.producers) {
    for (const topic of topology.topics) {
      for (let index = 0; index < topic.partitions; index++) {
        edges.push(edge(producer.id, partitionKey(topic.name, index)))
      }
    }
  }

  for (const consumer of topology.consumers) {
    for (const topicName of consumer.subscriptions) {
      const topic = topology.topics.find((t) => t.name === topicName)
      if (!topic) continue
      for (let index = 0; index < topic.partitions; index++) {
        edges.push(edge(partitionKey(topicName, index), consumer.id))
      }
    }
  }

  return edges
}
