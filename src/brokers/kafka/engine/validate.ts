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
  const consumerIds = new Set(topology.consumers.map((c) => c.id))

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

  // Topic thực sự được ghi là topic một lệnh `produce` trong script nhắm tới —
  // đây là lý do `validateKafkaTopology` nhận `script` chứ không chỉ topology.
  const producedTopics = new Set<string>()
  for (const command of script) {
    if (command.kind === 'produce') {
      producedTopics.add(command.topic)
      if (!topicNames.has(command.topic)) {
        issues.push({ code: 'unknown-topic', severity: 'error', nodeId: command.producerId, message: command.topic })
      }
      if (!topology.producers.some((p) => p.id === command.producerId)) {
        issues.push({ code: 'unknown-producer', severity: 'error', message: command.producerId })
      }
    } else if ('consumerId' in command && !consumerIds.has(command.consumerId)) {
      issues.push({ code: 'unknown-consumer', severity: 'error', message: command.consumerId })
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
    if (!producedTopics.has(topic.name)) {
      issues.push({ code: 'topic-unproduced', severity: 'warning', message: topic.name })
    }
    if (!topology.consumers.some((c) => c.subscriptions.includes(topic.name))) {
      issues.push({ code: 'topic-unconsumed', severity: 'warning', message: topic.name })
    }
  }

  return issues
}
