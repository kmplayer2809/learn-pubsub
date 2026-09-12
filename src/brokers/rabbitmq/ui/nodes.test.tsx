import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsumerNode, ExchangeNode, PublisherNode, QueueNode } from './nodes'

// NodeProps carries a large React Flow surface (positionAbsoluteX, dragging, ...) that
// none of these components read. Only `data` and `selected` matter here.
function nodeProps(data: Record<string, unknown>, selected: boolean): NodeProps {
  return { id: 'n', data, selected, type: 't' } as unknown as NodeProps
}

function shellOf(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

const KINDS = [
  ['publisher', PublisherNode, 'ring-role-sky-ring', { label: 'p1' }],
  ['exchange', ExchangeNode, 'ring-role-violet-ring', { label: 'ex', exchangeType: 'direct' }],
  ['queue', QueueNode, 'ring-role-emerald-ring', { label: 'q', depth: 0, messages: [] }],
  ['consumer', ConsumerNode, 'ring-role-amber-ring', { label: 'c1', prefetch: 1, unacked: 0 }],
] as const

function renderNode(
  Component: (typeof KINDS)[number][1],
  data: Record<string, unknown>,
  selected: boolean,
): HTMLElement {
  const { container } = render(
    <ReactFlowProvider>
      <Component {...nodeProps(data, selected)} />
    </ReactFlowProvider>,
  )
  return shellOf(container)
}

describe.each(KINDS)('%s node emphasis', (_kind, Component, ring, baseData) => {
  it('renders no highlight outline when data.highlighted is false', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: false }, false)
    expect(shell.className).not.toContain('outline-highlight')
  })

  it('renders the dashed offset outline when data.highlighted is true', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: true }, false)
    expect(shell.className).toContain('outline-dashed')
    expect(shell.className).toContain('outline-offset-4')
    expect(shell.className).toContain('outline-highlight')
  })

  it('keeps the highlight visually separate from selection', () => {
    // The highlight must not be the selection treatment under another name, or a reader
    // cannot tell "the prose is about this" from "I clicked this".
    const selectedOnly = renderNode(Component, { ...baseData, highlighted: false }, true)
    expect(selectedOnly.className).toContain(ring)
    expect(selectedOnly.className).not.toContain('outline-highlight')

    const highlightedOnly = renderNode(Component, { ...baseData, highlighted: true }, false)
    expect(highlightedOnly.className).not.toContain(ring)
    expect(highlightedOnly.className).toContain('outline-highlight')
  })

  it('reads as both when a node is selected and highlighted at once', () => {
    // The common case: the reader clicks the node the narrative is pointing at.
    const shell = renderNode(Component, { ...baseData, highlighted: true }, true)
    expect(shell.className).toContain(ring)
    expect(shell.className).toContain('outline-highlight')
  })
})

describe('consumer node emphasis composes with crashed', () => {
  it('keeps the highlight on a crashed consumer', () => {
    const shell = renderNode(
      ConsumerNode,
      { label: 'c1', prefetch: 1, unacked: 0, crashed: true, highlighted: true },
      false,
    )
    expect(shell.className).toContain('line-through')
    expect(shell.className).toContain('outline-highlight')
  })
})
