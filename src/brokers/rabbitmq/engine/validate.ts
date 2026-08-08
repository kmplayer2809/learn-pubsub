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
  | 'self-dead-letter-cycle'
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
      code: 'self-dead-letter-cycle'
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

    // A queue whose dead-letter exchange routes straight back into it re-expires its
    // own messages forever, and the TTL only sets how fast. An earlier version gated
    // this on `messageTtlMs < TRAVEL_MS`, reasoning that a shorter TTL "expires the
    // message again before it has finished moving" — that mechanism does not exist.
    // The TTL timer starts at enqueue, which is already after the travel, so 599 and
    // 600 cycle identically and only one of them warned. Any TTL loops here, so the
    // threshold is gone.
    //
    // This stays narrow on purpose: it fires only when the dead-letter exchange binds
    // back to this same queue. Lesson 13's retry-with-backoff is a longer cycle
    // (work -> retry-ex -> retry-1s -> main-ex -> work) in which no queue's own
    // dead-letter exchange returns to it, so that lesson is untouched. Without a TTL
    // nothing expires and the message simply waits, so a TTL is required to loop.
    if (queue.messageTtlMs !== undefined && queue.deadLetterExchange) {
      const returns = topology.bindings.some(
        (b) =>
          b.exchangeId === queue.deadLetterExchange &&
          b.destinationKind === 'queue' &&
          b.destinationId === queue.id,
      )
      if (returns) {
        issues.push({
          code: 'self-dead-letter-cycle',
          nodeId: queue.id,
          // Deliberately a warning rather than an error. An error is fatal in
          // createSimulation and refuses to run the topology at all; a warning lets
          // the run proceed so the user can watch the loop happen, which is the point
          // of a teaching tool. Says the message "keeps cycling" rather than promising
          // the ceiling halts it: the ceiling counts events, so at low volume a single
          // message cycles for the whole 60s the Sandbox transport reaches without ever
          // reaching it. The ceiling is a backstop against a hung tab, not the lesson.
          severity: 'warning',
          message: `queue ${queue.label} dead-letters into an exchange that routes straight back to it, so an expired message keeps cycling instead of leaving`,
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
