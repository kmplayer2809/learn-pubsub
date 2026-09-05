import { beforeEach, describe, expect, it } from 'vitest'
import { resetSandbox, useKafkaSandbox } from '../sandbox/kafkaStore'
import { onConnect, onNodesChange } from './editing'

describe('editing', () => {
  beforeEach(() => {
    resetSandbox()
  })

  it('onNodesChange cập nhật vị trí node trong store', () => {
    useKafkaSandbox.getState().addBroker({ x: 0, y: 0 })
    const brokerId = useKafkaSandbox.getState().topology.brokers[0]!.id

    onNodesChange(useKafkaSandbox.getState().topology, [
      { id: brokerId, type: 'position', position: { x: 200, y: 300 } },
    ])

    expect(useKafkaSandbox.getState().topology.brokers[0]!.position).toEqual({ x: 200, y: 300 })
  })

  it('onConnect từ producer sang topic thêm topic vào danh sách producer ghi', () => {
    useKafkaSandbox.getState().addProducer({ x: 0, y: 0 })
    useKafkaSandbox.getState().addTopic('orders', 2, 1)
    const producerId = useKafkaSandbox.getState().topology.producers[0]!.id

    onConnect(useKafkaSandbox.getState().topology, {
      source: producerId,
      target: 'orders-0',
      sourceHandle: null,
      targetHandle: null,
    })

    expect(useKafkaSandbox.getState().producerTopics[producerId]).toEqual(['orders'])
  })

  it('onConnect từ consumer sang topic thêm subscription', () => {
    useKafkaSandbox.getState().addConsumer({ x: 0, y: 0 })
    useKafkaSandbox.getState().addTopic('orders', 2, 1)
    const consumerId = useKafkaSandbox.getState().topology.consumers[0]!.id

    onConnect(useKafkaSandbox.getState().topology, {
      source: consumerId,
      target: 'orders-1',
      sourceHandle: null,
      targetHandle: null,
    })

    expect(useKafkaSandbox.getState().topology.consumers[0]!.subscriptions).toEqual(['orders'])
  })

  it('onConnect giữa hai broker bị bỏ qua, không tạo cạnh vô nghĩa', () => {
    useKafkaSandbox.getState().addBroker({ x: 0, y: 0 })
    useKafkaSandbox.getState().addBroker({ x: 100, y: 0 })
    const [b1, b2] = useKafkaSandbox.getState().topology.brokers

    onConnect(useKafkaSandbox.getState().topology, {
      source: b1!.id,
      target: b2!.id,
      sourceHandle: null,
      targetHandle: null,
    })

    expect(useKafkaSandbox.getState().producerTopics).toEqual({})
    expect(useKafkaSandbox.getState().topology.consumers).toEqual([])
  })
})
