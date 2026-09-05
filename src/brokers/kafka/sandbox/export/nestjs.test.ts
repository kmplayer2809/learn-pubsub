import { describe, expect, it } from 'vitest'
import type { KafkaTopology } from '../../engine'
import { toNestJs } from './nestjs'

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

describe('toNestJs', () => {
  it('sinh ClientsModule.register với Transport.KAFKA và danh sách broker', () => {
    const code = toNestJs(
      topology({
        brokers: [
          { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
          { id: 'b2', label: 'Broker 2', position: { x: 0, y: 0 } },
        ],
      }),
    )
    expect(code).toContain('ClientsModule.register(')
    expect(code).toContain('Transport.KAFKA')
    expect(code).toContain("'b1:9092'")
    expect(code).toContain("'b2:9092'")
  })

  it('mỗi consumer thành một @EventPattern theo topic nó subscribe', () => {
    const code = toNestJs(
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
          },
        ],
      }),
    )
    expect(code.match(/@EventPattern\('orders'\)/g)).toHaveLength(1)
    expect(code.match(/@EventPattern\('payments'\)/g)).toHaveLength(1)
  })

  it('khớp snapshot', () => {
    const full = topology({
      brokers: [
        { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
        { id: 'b2', label: 'Broker 2', position: { x: 0, y: 0 } },
      ],
      topics: [{ name: 'orders', partitions: 2, replicationFactor: 2 }],
      consumers: [
        {
          id: 'c1',
          label: 'Consumer 1',
          position: { x: 0, y: 0 },
          groupId: 'group-1',
          subscriptions: ['orders'],
        },
      ],
      controllerBrokerId: 'b1',
    })
    expect(toNestJs(full)).toMatchSnapshot()
  })
})
