import type { NodeId, Topology } from './types'

/**
 * Stable machine-readable discriminator for each issue shape below, plus the
 * exact values `message` interpolates. The presentation layer (Vietnamese
 * for a Vietnamese-reading learner) renders off `code` and these fields
 * instead of parsing `message` — `message` stays English on purpose; see
 * the module comment below.
 */
export type ValidationIssueCode =
  | 'binding-missing-exchange'
  | 'binding-missing-destination'
  | 'dead-letter-exchange-missing'
  | 'zero-ttl-dead-letter-cycle'
  | 'queue-unreachable'
  | 'consumer-missing-queue'

interface ValidationIssueBase {
  nodeId?: NodeId
  severity: 'error' | 'warning'
  /**
   * Always English. This is the engine's own diagnostic sentence, asserted on
   * verbatim by this file's tests, and the engine is not a presentation layer.
   * UI surfaces must render Vietnamese from `code` (and the fields below),
   * never from this string.
   */
  message: string
}

export type ValidationIssue =
  | (ValidationIssueBase & {
      code: 'binding-missing-exchange'
      bindingId: string
      exchangeId: NodeId
    })
  | (ValidationIssueBase & {
      code: 'binding-missing-destination'
      bindingId: string
      destinationId: NodeId
    })
  | (ValidationIssueBase & {
      code: 'dead-letter-exchange-missing'
      queueId: NodeId
      queueLabel: string
      deadLetterExchange: NodeId
    })
  | (ValidationIssueBase & {
      code: 'zero-ttl-dead-letter-cycle'
      queueId: NodeId
      queueLabel: string
    })
  | (ValidationIssueBase & {
      code: 'queue-unreachable'
      queueId: NodeId
      queueLabel: string
    })
  | (ValidationIssueBase & {
      code: 'consumer-missing-queue'
      consumerId: NodeId
      consumerLabel: string
      queueId: NodeId
    })

export function validateTopology(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const queueIds = new Set(topology.queues.map((q) => q.id))
  const exchangeIds = new Set(topology.exchanges.map((e) => e.id))

  for (const binding of topology.bindings) {
    if (!exchangeIds.has(binding.exchangeId)) {
      issues.push({
        code: 'binding-missing-exchange',
        nodeId: binding.exchangeId,
        severity: 'error',
        message: `binding ${binding.id} starts at exchange ${binding.exchangeId}, which does not exist`,
        bindingId: binding.id,
        exchangeId: binding.exchangeId,
      })
    }
    const known = binding.destinationKind === 'queue' ? queueIds : exchangeIds
    if (!known.has(binding.destinationId)) {
      issues.push({
        code: 'binding-missing-destination',
        nodeId: binding.destinationId,
        severity: 'error',
        message: `binding ${binding.id} points at ${binding.destinationId}, which does not exist`,
        bindingId: binding.id,
        destinationId: binding.destinationId,
      })
    }
  }

  for (const queue of topology.queues) {
    if (queue.deadLetterExchange && !exchangeIds.has(queue.deadLetterExchange)) {
      issues.push({
        code: 'dead-letter-exchange-missing',
        nodeId: queue.id,
        severity: 'error',
        message: `queue ${queue.label} dead-letters to ${queue.deadLetterExchange}, which does not exist`,
        queueId: queue.id,
        queueLabel: queue.label,
        deadLetterExchange: queue.deadLetterExchange,
      })
    }

    // A zero TTL plus a dead-letter exchange that routes back here loops without advancing time.
    if (queue.messageTtlMs === 0 && queue.deadLetterExchange) {
      const returns = topology.bindings.some(
        (b) =>
          b.exchangeId === queue.deadLetterExchange &&
          b.destinationKind === 'queue' &&
          b.destinationId === queue.id,
      )
      if (returns) {
        issues.push({
          code: 'zero-ttl-dead-letter-cycle',
          nodeId: queue.id,
          severity: 'error',
          message: `queue ${queue.label} forms a zero-TTL dead-letter cycle; the run would never advance`,
          queueId: queue.id,
          queueLabel: queue.label,
        })
      }
    }

    const reachable = topology.bindings.some(
      (b) => b.destinationKind === 'queue' && b.destinationId === queue.id,
    )
    if (!reachable) {
      issues.push({
        code: 'queue-unreachable',
        nodeId: queue.id,
        severity: 'warning',
        message: `queue ${queue.label} has no binding, so no message can reach it`,
        queueId: queue.id,
        queueLabel: queue.label,
      })
    }
  }

  for (const consumer of topology.consumers) {
    if (!queueIds.has(consumer.queueId)) {
      issues.push({
        code: 'consumer-missing-queue',
        nodeId: consumer.id,
        severity: 'error',
        message: `consumer ${consumer.label} consumes from ${consumer.queueId}, which does not exist`,
        consumerId: consumer.id,
        consumerLabel: consumer.label,
        queueId: consumer.queueId,
      })
    }
  }

  return issues
}
