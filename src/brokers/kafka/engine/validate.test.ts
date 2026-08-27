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
