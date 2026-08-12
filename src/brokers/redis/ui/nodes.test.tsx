import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClientNode, ServerNode } from './nodes'

// NodeProps carries a large React Flow surface (positionAbsoluteX, dragging, ...) that
// none of these components read. Only `data` and `selected` matter here.
function nodeProps(data: Record<string, unknown>, selected: boolean): NodeProps {
  return { id: 'n', data, selected, type: 't' } as unknown as NodeProps
}

function shellOf(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

const KINDS = [
  ['client', ClientNode, 'ring-cyan-300', { label: 'c1' }],
  ['server', ServerNode, 'ring-rose-300', { label: 'redis', keysCount: 0, memoryUsed: 0 }],
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
    expect(shell.className).not.toContain('outline-fuchsia-400')
  })

  it('renders the dashed offset outline when data.highlighted is true', () => {
    const shell = renderNode(Component, { ...baseData, highlighted: true }, false)
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
})

describe('client and server use distinct hues', () => {
  it('never share the border colour class', () => {
    const clientShell = renderNode(ClientNode, { label: 'c1', highlighted: false }, false)
    const serverShell = renderNode(
      ServerNode,
      { label: 'redis', keysCount: 0, memoryUsed: 0, highlighted: false },
      false,
    )
    const clientBorder = [...clientShell.classList].find((c) => c.startsWith('border-'))
    const serverBorder = [...serverShell.classList].find((c) => c.startsWith('border-'))
    expect(clientBorder).toBeDefined()
    expect(serverBorder).toBeDefined()
    expect(clientBorder).not.toBe(serverBorder)
  })
})

describe('ServerNode', () => {
  it('renders keysCount and memory usage', () => {
    const shell = renderNode(
      ServerNode,
      { label: 'redis', keysCount: 7, memoryUsed: 1234, highlighted: false },
      false,
    )
    expect(shell.textContent).toContain('7 keys')
    expect(shell.textContent).toContain('1234')
  })

  it('shows the policy name when maxmemoryBytes is set', () => {
    const shell = renderNode(
      ServerNode,
      {
        label: 'redis',
        keysCount: 0,
        memoryUsed: 500,
        maxmemoryBytes: 1000,
        evictionPolicy: 'allkeys-lru',
        highlighted: false,
      },
      false,
    )
    expect(shell.textContent).toContain('500')
    expect(shell.textContent).toContain('1000')
    expect(shell.textContent).toContain('allkeys-lru')
  })

  it('says so rather than rendering undefined when no limit is set', () => {
    const shell = renderNode(
      ServerNode,
      { label: 'redis', keysCount: 0, memoryUsed: 500, highlighted: false },
      false,
    )
    expect(shell.textContent).not.toContain('undefined')
  })
})
