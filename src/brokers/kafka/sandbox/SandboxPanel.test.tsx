import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { testState } from '../engine/testState'
import type { KafkaValidationIssue } from '../engine'
import { useAppStore } from '../../../shell/store'
import { SandboxPanel } from './SandboxPanel'
import { resetSandbox, useKafkaSandbox } from './kafkaStore'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  resetSandbox()
})

describe('SandboxPanel', () => {
  it('liệt kê mọi issue validate bằng tiếng Việt', () => {
    const issues: KafkaValidationIssue[] = [
      { severity: 'error', code: 'unknown-controller', message: 'b9' },
    ]
    render(<SandboxPanel state={testState()} issues={issues} />)

    expect(screen.getByText(/controllerBrokerId.*trỏ tới b9/)).toBeTruthy()
  })

  it('thêm topic bằng form cập nhật store', () => {
    render(<SandboxPanel state={testState()} issues={[]} />)

    fireEvent.change(screen.getByLabelText('tên topic'), { target: { value: 'orders' } })
    fireEvent.change(screen.getByLabelText('số partition'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Topic' }))

    const topic = useKafkaSandbox.getState().topology.topics[0]!
    expect(topic.name).toBe('orders')
    expect(topic.partitions).toBe(3)
  })

  it('nút produce tay thêm lệnh vào script', () => {
    useKafkaSandbox.getState().addProducer({ x: 0, y: 0 })
    useKafkaSandbox.getState().addTopic('orders', 1, 1)

    render(<SandboxPanel state={testState()} issues={[]} />)

    fireEvent.change(screen.getByLabelText('nội dung'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(useKafkaSandbox.getState().script).toHaveLength(1)
    expect(useKafkaSandbox.getState().script[0]!.kind).toBe('produce')
  })

  it('panel cuộn được và nút đạt tap target 44px ở màn nhỏ', () => {
    render(<SandboxPanel state={testState()} issues={[]} />)

    expect(screen.getByTestId('sandbox-panel').className).toContain('overflow-y-auto')
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11')
    }
  })
})
