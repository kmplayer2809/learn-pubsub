import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateKafkaTopology } from '../engine'
import { getScript, getTopology, resetSandbox, subscribe, useKafkaSandbox } from './kafkaStore'

describe('kafkaStore', () => {
  beforeEach(() => {
    resetSandbox()
  })

  it('getTopology và getScript là hàm thuần, gọi ngoài React vẫn chạy', () => {
    // Ràng buộc của `BrokerSandbox`: `useSimulation` nạp chúng vào một cặp
    // `useSyncExternalStore` cố định. Một hook ở đây làm số hook tại call site
    // đó đổi theo broker và phá Rules of Hooks khi chuyển broker.
    expect(typeof getTopology).toBe('function')
    expect(typeof getScript).toBe('function')
    expect(() => getTopology()).not.toThrow()
    expect(() => getScript()).not.toThrow()
  })

  it('getTopology trả cùng reference khi state không đổi', () => {
    // Đổi reference mỗi lần gọi làm `useSyncExternalStore` render vô hạn.
    expect(getTopology()).toBe(getTopology())
  })

  it('subscribe gọi callback khi topology đổi, trả hàm huỷ đăng ký', () => {
    const cb = vi.fn()
    const unsubscribe = subscribe(cb)

    useKafkaSandbox.getState().addBroker({ x: 0, y: 0 })
    expect(cb).toHaveBeenCalled()

    const callsBeforeUnsubscribe = cb.mock.calls.length
    unsubscribe()
    useKafkaSandbox.getState().addBroker({ x: 10, y: 10 })
    expect(cb.mock.calls.length).toBe(callsBeforeUnsubscribe)
  })

  it('addTopic tạo topic với số partition đã chọn', () => {
    useKafkaSandbox.getState().addTopic('orders', 3, 2)
    const topic = getTopology().topics[0]!
    expect(topic.name).toBe('orders')
    expect(topic.partitions).toBe(3)
    expect(topic.replicationFactor).toBe(2)
  })

  it('setReplicationFactor lớn hơn số broker vẫn đặt được — validate lo phần báo lỗi', () => {
    useKafkaSandbox.getState().addBroker({ x: 0, y: 0 })
    useKafkaSandbox.getState().addTopic('orders', 1, 1)

    useKafkaSandbox.getState().setReplicationFactor('orders', 5)

    const topology = getTopology()
    expect(topology.topics[0]!.replicationFactor).toBe(5)
    const issues = validateKafkaTopology(topology, [])
    expect(issues.some((i) => i.code === 'replication-factor-too-high')).toBe(true)
  })

  it('resetSandbox đưa về topology rỗng', () => {
    useKafkaSandbox.getState().addBroker({ x: 0, y: 0 })
    useKafkaSandbox.getState().addTopic('orders', 1, 1)

    resetSandbox()

    expect(getTopology().brokers).toEqual([])
    expect(getTopology().topics).toEqual([])
    expect(getScript()).toEqual([])
  })

  it('produceManually thêm một lệnh produce vào script với mốc thời gian tăng dần', () => {
    useKafkaSandbox.getState().addProducer({ x: 0, y: 0 })
    const producerId = getTopology().producers[0]!.id

    useKafkaSandbox.getState().produceManually({ producerId, topic: 'orders', value: 'a' })
    useKafkaSandbox.getState().produceManually({ producerId, topic: 'orders', value: 'b' })

    const script = getScript()
    expect(script).toHaveLength(2)
    expect(script.every((c) => c.kind === 'produce')).toBe(true)
    expect(script[0]!.at).toBeLessThan(script[1]!.at)
  })
})
