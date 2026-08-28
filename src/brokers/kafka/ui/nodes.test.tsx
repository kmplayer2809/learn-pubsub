import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrokerNode, ConsumerGroupNode, ConsumerNode, PartitionNode, ProducerNode } from './nodes'

// NodeProps carries a large React Flow surface (positionAbsoluteX, dragging, ...) that
// none of these components read. Only `data` and `selected` matter here — same
// convention as Redis' `nodes.test.tsx`.
function nodeProps(data: Record<string, unknown>, selected: boolean): NodeProps {
  return { id: 'n', data, selected, type: 't' } as unknown as NodeProps
}

function shellOf(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

function renderNode(
  Component: (typeof KINDS)[number][1],
  data: Record<string, unknown>,
  selected = false,
): HTMLElement {
  const { container } = render(
    <ReactFlowProvider>
      <Component {...nodeProps(data, selected)} />
    </ReactFlowProvider>,
  )
  return shellOf(container)
}

const KINDS = [
  ['broker', BrokerNode, 'ring-blue-300', { label: 'b1', offline: false, isController: false }],
  [
    'partition',
    PartitionNode,
    'ring-teal-300',
    { label: 'orders-0', leo: 0, highWatermark: 0, isrCount: 1, replicaCount: 1 },
  ],
  ['consumerGroup', ConsumerGroupNode, 'ring-orange-300', { label: 'g1' }],
  ['consumer', ConsumerNode, 'ring-pink-300', { label: 'c1', lag: 0, joined: true }],
  ['producer', ProducerNode, 'ring-lime-300', { label: 'p1' }],
] as const

describe.each(KINDS)('%s node emphasis', (_kind, Component, ring, baseData) => {
  it('renders no highlight outline when data.highlighted is false', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: false })
    expect(shell.className).not.toContain('outline-fuchsia-400')
  })

  it('renders the dashed offset outline when data.highlighted is true', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: true })
    expect(shell.className).toContain('outline-dashed')
    expect(shell.className).toContain('outline-offset-4')
    expect(shell.className).toContain('outline-fuchsia-400')
  })

  it('keeps the highlight visually separate from selection', () => {
    const selectedOnly = renderNode(Component, { ...baseData, highlighted: false }, true)
    expect(selectedOnly.className).toContain(ring)
    expect(selectedOnly.className).not.toContain('outline-fuchsia-400')

    const highlightedOnly = renderNode(Component, { ...baseData, highlighted: true }, false)
    expect(highlightedOnly.className).not.toContain(ring)
    expect(highlightedOnly.className).toContain('outline-fuchsia-400')
  })

  it('reads as both when a node is selected and highlighted at once', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: true }, true)
    expect(shell.className).toContain(ring)
    expect(shell.className).toContain('outline-fuchsia-400')
  })

  // Ràng buộc từ plan responsive-shell: mọi node có nhãn tự do phải mang cả hai class
  // này, nếu không một label dài (tên topic/consumer do người dùng đặt) sẽ tràn canvas.
  it('carries truncate and max-w-[200px] on its label', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: false })
    const label = shell.querySelector('.truncate')
    expect(label).not.toBeNull()
    expect(label?.className).toContain('max-w-[200px]')
  })
})

describe('five Kafka node kinds use distinct hues', () => {
  it('no two share a border colour class', () => {
    const borders = KINDS.map(([, Component, , baseData]) => {
      const shell = renderNode(Component, { ...baseData, highlighted: false })
      return [...shell.classList].find((c) => c.startsWith('border-'))
    })
    expect(borders.every((b) => b !== undefined)).toBe(true)
    expect(new Set(borders).size).toBe(borders.length)
  })
})

describe('BrokerNode', () => {
  it('shows online status by default', () => {
    const shell = renderNode(BrokerNode, { label: 'b1', offline: false, isController: false, highlighted: false })
    expect(shell.textContent).toContain('online')
    expect(shell.textContent).not.toContain('offline')
  })

  it('shows offline status when data.offline is true', () => {
    const shell = renderNode(BrokerNode, { label: 'b1', offline: true, isController: false, highlighted: false })
    expect(shell.textContent).toContain('offline')
  })

  it('marks the controller broker', () => {
    const shell = renderNode(BrokerNode, { label: 'b1', offline: false, isController: true, highlighted: false })
    expect(shell.textContent).toContain('controller')
  })
})

describe('PartitionNode', () => {
  it('renders leo, highWatermark and an ISR badge', () => {
    const shell = renderNode(PartitionNode, {
      label: 'orders-0',
      leo: 42,
      highWatermark: 40,
      isrCount: 2,
      replicaCount: 3,
      highlighted: false,
    })
    expect(shell.textContent).toContain('42')
    expect(shell.textContent).toContain('40')
    expect(shell.textContent).toContain('ISR')
    expect(shell.textContent).toContain('2')
    expect(shell.textContent).toContain('3')
  })
})

describe('ConsumerNode', () => {
  it('renders lag once the consumer has joined', () => {
    const shell = renderNode(ConsumerNode, { label: 'c1', lag: 12, joined: true, highlighted: false })
    expect(shell.textContent).toContain('12')
  })

  it('says "chưa tham gia" instead of a lag number before consumer-join', () => {
    const shell = renderNode(ConsumerNode, { label: 'c1', lag: 0, joined: false, highlighted: false })
    expect(shell.textContent).toContain('chưa tham gia')
  })
})

describe('ConsumerGroupNode', () => {
  it('renders its groupId label', () => {
    const shell = renderNode(ConsumerGroupNode, { label: 'g1', highlighted: false })
    expect(shell.textContent).toContain('g1')
  })
})

describe('ProducerNode', () => {
  it('renders its label', () => {
    const shell = renderNode(ProducerNode, { label: 'p1', highlighted: false })
    expect(shell.textContent).toContain('p1')
  })
})
