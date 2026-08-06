import { describe, expect, it } from 'vitest'
import type { Topology } from '../../engine'
import { getLesson } from '../../lessons/registry'
import { toAmqplib } from './amqplib'
import { toNestjs } from './nestjs'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'api', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'orders', label: 'orders', type: 'topic', position: { x: 0, y: 0 } }],
  queues: [
    {
      id: 'payments',
      label: 'payments',
      kind: 'classic',
      messageTtlMs: 30000,
      maxLength: 1000,
      deadLetterExchange: 'dlx',
      position: { x: 0, y: 0 },
    },
  ],
  consumers: [
    {
      id: 'c1',
      label: 'payment-worker',
      queueId: 'payments',
      prefetch: 5,
      autoAck: false,
      processingMs: 100,
      jitterMs: 0,
      nackRate: 0,
      requeueOnNack: true,
      position: { x: 0, y: 0 },
    },
  ],
  bindings: [
    {
      id: 'b1',
      exchangeId: 'orders',
      destinationId: 'payments',
      destinationKind: 'queue',
      routingKey: 'order.*.paid',
    },
  ],
}

describe('toAmqplib', () => {
  it('declares the exchange with its type', () => {
    expect(toAmqplib(topology)).toContain("assertExchange('orders', 'topic'")
  })

  it('carries queue arguments across', () => {
    const code = toAmqplib(topology)
    expect(code).toContain("'x-message-ttl': 30000")
    expect(code).toContain("'x-max-length': 1000")
    expect(code).toContain("'x-dead-letter-exchange': 'dlx'")
  })

  it('binds with the routing key and sets prefetch', () => {
    const code = toAmqplib(topology)
    expect(code).toContain("bindQueue('payments', 'orders', 'order.*.paid')")
    expect(code).toContain('prefetch(5)')
  })
})

describe('toNestjs', () => {
  it('emits a RabbitSubscribe decorator per consumer', () => {
    const code = toNestjs(topology)
    expect(code).toContain('@RabbitSubscribe(')
    expect(code).toContain("exchange: 'orders'")
    expect(code).toContain("routingKey: 'order.*.paid'")
    expect(code).toContain("queue: 'payments'")
  })

  it('marks manual ack when the consumer does not auto-ack', () => {
    expect(toNestjs(topology)).toContain('allowNonJsonMessages')
  })
})

// The fixture above only exercises messageTtlMs + maxLength + deadLetterExchange
// together. Every other optional QueueSpec/ConsumerSpec field is exercised by a
// real lesson topology below, so a generator that silently drops one is caught
// against the same data the app actually renders on the canvas.

describe('toAmqplib against real lesson topologies', () => {
  it('13-retry-backoff: both delay-queue legs carry their own TTL, DLX, and dead-letter routing key', () => {
    const code = toAmqplib(getLesson('13-retry-backoff')!.topology)
    expect(code).toContain("'x-dead-letter-exchange': 'retry-ex'")
    expect(code).toContain("'x-dead-letter-routing-key': 'retry'")
    expect(code).toContain("'x-message-ttl': 1000")
    expect(code).toContain("'x-dead-letter-exchange': 'main-ex'")
    expect(code).toContain("'x-dead-letter-routing-key': 'order'")
    // The worker rejects without requeue; the parking-lot inspector requeues.
    expect(code).toContain('channel.nack(message, false, false)')
    expect(code).toContain('channel.nack(message, false, true)')
  })

  it('15-priority: emits x-max-priority for the queue declaring maxPriority', () => {
    const code = toAmqplib(getLesson('15-priority')!.topology)
    expect(code).toContain("'x-max-priority': 10")
  })

  it('17-quorum: emits x-queue-type quorum only for the quorum queue, not the classic one', () => {
    const code = toAmqplib(getLesson('17-quorum')!.topology)
    const quorumBlock = code.slice(code.indexOf("assertQueue('quorum-q'"))
    const classicBlock = code.slice(code.indexOf("assertQueue('classic-q'"), code.indexOf("assertQueue('quorum-q'"))
    expect(quorumBlock).toContain("'x-queue-type': 'quorum'")
    expect(classicBlock).not.toContain('x-queue-type')
  })

  it('12-ttl-maxlen: emits ttl, max-length, and dead-letter-exchange together on one queue', () => {
    const code = toAmqplib(getLesson('12-ttl-maxlen')!.topology)
    expect(code).toContain("'x-message-ttl': 2500")
    expect(code).toContain("'x-max-length': 3")
    expect(code).toContain("'x-dead-letter-exchange': 'dlx'")
  })
})

describe('toNestjs against real lesson topologies', () => {
  it('15-priority: queueOptions.arguments carries x-max-priority', () => {
    const code = toNestjs(getLesson('15-priority')!.topology)
    expect(code).toContain("'x-max-priority': 10")
  })

  it('17-quorum: queueOptions.arguments carries x-queue-type for the quorum consumer only', () => {
    const code = toNestjs(getLesson('17-quorum')!.topology)
    const classicStart = code.indexOf("queue: 'classic-q'")
    const quorumStart = code.indexOf("queue: 'quorum-q'")
    const classicBlock = code.slice(classicStart, quorumStart)
    const quorumBlock = code.slice(quorumStart)
    expect(quorumBlock).toContain("'x-queue-type': 'quorum'")
    expect(classicBlock).not.toContain('x-queue-type')
  })

  it('13-retry-backoff: manual-ack consumers import and return Nack with their requeueOnNack value', () => {
    const code = toNestjs(getLesson('13-retry-backoff')!.topology)
    expect(code).toContain("import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'")
    expect(code).toContain('return new Nack(false)')
    expect(code).toContain('return new Nack(true)')
  })

  it('produces valid TypeScript method names for prose consumer labels', () => {
    const code = toNestjs(getLesson('13-retry-backoff')!.topology)
    expect(code).toContain('async handleParkingLotInspector(')
    expect(code).not.toMatch(/async handle[A-Za-z]* [A-Za-z]*\(/)
  })
})
