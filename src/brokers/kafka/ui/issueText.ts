import type { KafkaValidationIssue } from '../engine'

/**
 * Vietnamese rendering for every `KafkaValidationIssue` the engine can produce
 * (`src/brokers/kafka/engine/validate.ts`). The engine's own `message` stays English —
 * `src/brokers/kafka/engine/**` is not a presentation layer — so this is the only place
 * a learner actually reads these sentences, mirroring RabbitMQ's `vietnameseIssueMessage`
 * and Redis' `issueText`.
 *
 * Kafka terms of art stay English, in backticks where they name a config key (topic,
 * partition, offset, broker, producer, consumer, `acks`, ISR, `replicationFactor`,
 * `min.insync.replicas`, `idempotent`, `transactionalId`, `controllerBrokerId`); everything
 * else is Vietnamese. Node ids and `issue.message` payloads (already carrying the concrete
 * numbers/names) are never translated or reworded — they are interpolated verbatim.
 *
 * This is a `switch` over `KafkaValidationIssue['code']` with no `default` case, so adding
 * a new code to `validate.ts` without adding a case here is a TypeScript compile error, not
 * a silent English fallback in the UI.
 */
export function issueText(issue: KafkaValidationIssue): string {
  switch (issue.code) {
    case 'replication-factor-too-high':
      return `\`replicationFactor\` lớn hơn số broker đang có (${issue.message}) — không đủ broker để giữ đủ bản sao.`
    case 'min-insync-too-high':
      return `\`min.insync.replicas\` lớn hơn \`replicationFactor\` (${issue.message}) — không bao giờ đủ replica để xác nhận ghi, mọi produce với \`acks: all\` sẽ treo.`
    case 'unknown-topic':
      return `node ${issue.nodeId} nhắc tới topic \`${issue.message}\`, nhưng topic đó không tồn tại trong topology.`
    case 'transactional-not-idempotent':
      return `producer ${issue.nodeId} khai \`transactionalId\` (${issue.message}) nhưng không bật \`idempotent\` — producer transactional bắt buộc phải idempotent.`
    case 'unknown-controller':
      return `\`controllerBrokerId\` trỏ tới ${issue.message}, nhưng broker đó không tồn tại trong topology.`
    case 'duplicate-id':
      return `hai node cùng chia id ${issue.nodeId} — canvas không phân biệt được node nào với node nào.`
    case 'unknown-producer':
      return `một lệnh \`produce\` nhắm tới producer ${issue.message}, nhưng producer đó không tồn tại trong topology.`
    case 'unknown-consumer':
      return `một lệnh trong script nhắm tới consumer ${issue.message}, nhưng consumer đó không tồn tại trong topology.`
    case 'idle-consumers':
      return `Group có nhiều consumer hơn partition (${issue.message}), phần thừa sẽ nằm không.`
    case 'topic-unproduced':
      return `topic ${issue.message} không có producer nào ghi vào — kịch bản không hề gọi lệnh \`produce\` cho topic này.`
    case 'topic-unconsumed':
      return `topic ${issue.message} không có consumer nào đăng ký — dữ liệu ghi vào sẽ không ai đọc.`
    case 'acks-zero-idempotent':
      return `producer ${issue.nodeId} đặt \`acks: 0\` trong khi vẫn bật \`idempotent\` — idempotent cần tối thiểu \`acks: 1\` để nhận số thứ tự xác nhận, nên tổ hợp này vô nghĩa.`
  }
}
