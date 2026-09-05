import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KafkaTopology } from '../engine'
import { ExportDialog } from './ExportDialog'

function topology(over: Partial<KafkaTopology> = {}): KafkaTopology {
  return {
    brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [{ id: 'p1', label: 'Producer 1', position: { x: 0, y: 0 } }],
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
    ...over,
  }
}

describe('ExportDialog', () => {
  it('renders KafkaJS code by default and switches to NestJS on tab click', () => {
    render(<ExportDialog topology={topology()} onClose={() => {}} />)

    expect(screen.getByTestId('export-code').textContent).toContain('kafkajs')

    fireEvent.click(screen.getByTestId('export-tab-nestjs'))

    expect(screen.getByTestId('export-code').textContent).toContain('@nestjs/microservices')
  })

  it('shows a message instead of code when the topology has nothing to export', () => {
    render(
      <ExportDialog
        topology={topology({ topics: [], producers: [], consumers: [] })}
        onClose={() => {}}
      />,
    )

    expect(screen.queryByTestId('export-code')).toBeNull()
  })

  it('calls onClose on Escape and on backdrop click', () => {
    const onClose = vi.fn()
    render(<ExportDialog topology={topology()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('is full-screen on mobile and a centered modal from md up', () => {
    render(<ExportDialog topology={topology()} onClose={() => {}} />)

    const dialog = screen.getByTestId('export-dialog')
    expect(dialog.className).toContain('fixed inset-0')
    expect(dialog.className).toContain('md:inset-auto')
  })

  it('mọi nút đạt tap target 44px ở màn nhỏ', () => {
    render(<ExportDialog topology={topology()} onClose={() => {}} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11')
    }
  })
})
