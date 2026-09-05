import { describe, expect, it } from 'vitest'
import type { KafkaTopology } from '../../engine'
import { toKafkaJs } from './kafkajs'

function topology(over: Partial<KafkaTopology> = {}): KafkaTopology {
  return {
    brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
    topics: [],
    producers: [],
    consumers: [],
    controllerBrokerId: 'b1',
    ...over,
  }
}

describe('toKafkaJs', () => {
  it('sinh admin.createTopics đúng numPartitions và replicationFactor', () => {
    const code = toKafkaJs(topology({ topics: [{ name: 'orders', partitions: 3, replicationFactor: 2 }] }))
    expect(code).toContain("topic: 'orders'")
    expect(code).toContain('numPartitions: 3')
    expect(code).toContain('replicationFactor: 2')
  })

  it('producer mang đúng acks, idempotent và transactionalId', () => {
    const code = toKafkaJs(
      topology({
        producers: [
          {
            id: 'p1',
            label: 'Producer 1',
            position: { x: 0, y: 0 },
            acks: 'all',
            idempotent: true,
            transactionalId: 'txn-1',
          },
        ],
      }),
    )
    expect(code).toContain('idempotent: true')
    expect(code).toContain("transactionalId: 'txn-1'")
    expect(code).toContain('acks: -1')
  })

  it('consumer mang đúng groupId, subscribe từng topic và fromBeginning theo autoOffsetReset', () => {
    const code = toKafkaJs(
      topology({
        topics: [
          { name: 'orders', partitions: 1, replicationFactor: 1 },
          { name: 'payments', partitions: 1, replicationFactor: 1 },
        ],
        consumers: [
          {
            id: 'c1',
            label: 'Consumer 1',
            position: { x: 0, y: 0 },
            groupId: 'group-1',
            subscriptions: ['orders', 'payments'],
            autoOffsetReset: 'earliest',
          },
        ],
      }),
    )
    expect(code).toContain("groupId: 'group-1'")
    expect(code).toContain("await consumer_c1.subscribe({ topic: 'orders', fromBeginning: true })")
    expect(code).toContain("await consumer_c1.subscribe({ topic: 'payments', fromBeginning: true })")
  })

  it('autoOffsetReset latest sinh fromBeginning false', () => {
    const code = toKafkaJs(
      topology({
        topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
        consumers: [
          {
            id: 'c1',
            label: 'Consumer 1',
            position: { x: 0, y: 0 },
            groupId: 'group-1',
            subscriptions: ['orders'],
            autoOffsetReset: 'latest',
          },
        ],
      }),
    )
    expect(code).toContain('fromBeginning: false')
  })

  it('maxPollRecords > 1 sinh eachBatch thay vì eachMessage', () => {
    const withBatch = toKafkaJs(
      topology({
        topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
        consumers: [
          {
            id: 'c1',
            label: 'Consumer 1',
            position: { x: 0, y: 0 },
            groupId: 'group-1',
            subscriptions: ['orders'],
            maxPollRecords: 50,
          },
        ],
      }),
    )
    expect(withBatch).toContain('eachBatch:')
    expect(withBatch).not.toContain('eachMessage:')

    const withMessage = toKafkaJs(
      topology({
        topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
        consumers: [
          {
            id: 'c1',
            label: 'Consumer 1',
            position: { x: 0, y: 0 },
            groupId: 'group-1',
            subscriptions: ['orders'],
            maxPollRecords: 1,
          },
        ],
      }),
    )
    expect(withMessage).toContain('eachMessage:')
    expect(withMessage).not.toContain('eachBatch:')
  })

  it('khớp snapshot', () => {
    const full = topology({
      brokers: [
        { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
        { id: 'b2', label: 'Broker 2', position: { x: 0, y: 0 } },
      ],
      topics: [{ name: 'orders', partitions: 2, replicationFactor: 2 }],
      producers: [
        {
          id: 'p1',
          label: 'Producer 1',
          position: { x: 0, y: 0 },
          acks: 'all',
          idempotent: true,
          transactionalId: 'txn-1',
        },
      ],
      consumers: [
        {
          id: 'c1',
          label: 'Consumer 1',
          position: { x: 0, y: 0 },
          groupId: 'group-1',
          subscriptions: ['orders'],
          autoOffsetReset: 'earliest',
          maxPollRecords: 100,
        },
      ],
      controllerBrokerId: 'b1',
    })
    expect(toKafkaJs(full)).toMatchSnapshot()
  })
})
